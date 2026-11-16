import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type PersistenceProvider =
  | 'firestore'
  | 'upstash-redis'
  | 'persistent-disk'
  | 'local-atomic-disk'
  | 'ephemeral-render-disk';

export interface PersistenceStatus {
  provider: PersistenceProvider;
  storageMode: string;
  cloudEnabled: boolean;
  durable: boolean;
  isRender: boolean;
  dataDir: string;
  firestoreProjectId?: string;
  firestoreDatabaseId?: string;
  lastCloudWriteAt: string | null;
  lastCloudError: string | null;
}

export interface PersistResult {
  ok: boolean;
  durable: boolean;
  provider: PersistenceProvider;
  error?: string;
}

interface ServiceAccountCreds {
  clientEmail: string;
  privateKey: string;
  projectId: string;
  tokenUri: string;
}

const inflightSyncs = new Set<Promise<unknown>>();
let lastCloudWriteAt: string | null = null;
let lastCloudError: string | null = null;

let cachedAccessToken: { token: string; expiresAtMs: number; cacheKey: string } | null = null;

function readAppletFirebaseConfig(): { projectId: string; databaseId: string } {
  let projectId =
    (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  let databaseId =
    (
      process.env.FIREBASE_FIRESTORE_DATABASE_ID ||
      process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
      ''
    ).trim();

  if (databaseId === 'G-LLXC1GEL75') {
    databaseId = 'ai-studio-echoxstore-9e1d54e8-7960-44b2-951a-524166c61a13';
  }

  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as {
        projectId?: string;
        firestoreDatabaseId?: string;
      };
      if (!projectId && typeof parsed.projectId === 'string') {
        projectId = parsed.projectId.trim();
      }
      if (!databaseId && typeof parsed.firestoreDatabaseId === 'string') {
        databaseId = parsed.firestoreDatabaseId.trim();
      }
    }
  } catch {
    // ignore invalid applet config file
  }

  return {
    projectId: projectId || 'gen-lang-client-0499444627',
    databaseId: databaseId || '(default)',
  };
}

let cachedEnvCredsSignature = '';
let cachedEnvCredsResult: ServiceAccountCreds | null = null;
let cachedEnvCredsError: string | null = null;

function stripBomAndZeroWidth(input: string): string {
  return input
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

function unwrapOuterQuotes(input: string): string {
  let current = input.trim();
  for (let i = 0; i < 3; i++) {
    if (
      (current.startsWith("'") && current.endsWith("'") && current.length >= 2) ||
      (current.startsWith('"') && current.endsWith('"') && current.length >= 2) ||
      (current.startsWith('`') && current.endsWith('`') && current.length >= 2)
    ) {
      // Only unwrap outer quotes if inner looks like JSON, key=val, or base64 (or double-encoded JSON string)
      const inner = current.slice(1, -1).trim();
      if (current.startsWith('"') && inner.startsWith('{\\"')) {
        // Double-encoded JSON string will be parsed cleanly by JSON.parse directly
        break;
      }
      current = inner;
    } else {
      break;
    }
  }
  return current;
}

function escapeLiteralNewlinesInsideJsonStrings(raw: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch === '\n') {
      out += '\\n';
      continue;
    }
    if (inString && ch === '\r') {
      continue;
    }
    out += ch;
  }
  return out;
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const attempts: string[] = [];
  const trimmed = raw.trim();
  if (!trimmed) return null;

  attempts.push(trimmed);

  // Repair smart curly quotes pasted from mobile / rich-text notes
  const normalizedQuotes = trimmed
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  if (normalizedQuotes !== trimmed) {
    attempts.push(normalizedQuotes);
  }

  // Handle escaped JSON snippet (e.g. {\"type\":\"service_account\",...})
  if (trimmed.includes('\\"')) {
    attempts.push(
      trimmed
        .replace(/\\"/g, '"')
        .replace(/\\\\n/g, '\\n')
    );
  }

  // Handle multi-line JSON pasted with literal raw newlines inside string values
  if (trimmed.startsWith('{') && /[\r\n]/.test(trimmed)) {
    attempts.push(escapeLiteralNewlinesInsideJsonStrings(trimmed));
  }

  for (const candidate of attempts) {
    try {
      let parsed: unknown = JSON.parse(candidate);
      // Handle double-encoded JSON string: "\"{\\\"type\\\":...}\""
      if (typeof parsed === 'string') {
        const inner = parsed.trim();
        if (inner.startsWith('{')) {
          parsed = JSON.parse(inner);
        }
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next repair strategy
    }
  }
  return null;
}

function tryDecodeBase64JsonObject(raw: string): Record<string, unknown> | null {
  const withoutDataUri = raw.replace(/^data:[^;]+;base64,/i, '').trim();
  const compact = withoutDataUri.replace(/\s+/g, '');
  // Must strictly look like Base64 / Base64URL and never plain JSON starting with quotes/braces
  if (!compact || compact.length < 24 || !/^[A-Za-z0-9+/_=-]+$/.test(compact)) {
    return null;
  }
  try {
    const standardB64 = compact.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(standardB64, 'base64').toString('utf-8');
    // Reject binary corruption (replacement characters \uFFFD)
    if (!decoded || decoded.includes('\uFFFD')) {
      return null;
    }
    const cleanDecoded = stripBomAndZeroWidth(decoded);
    if (!cleanDecoded.startsWith('{')) {
      return null;
    }
    return tryParseJsonObject(cleanDecoded);
  } catch {
    return null;
  }
}

function normalizePrivateKeyPem(rawKey: string): string | null {
  let key = stripBomAndZeroWidth(rawKey);
  key = unwrapOuterQuotes(key);
  if (!key) return null;

  // Support Base64-encoded PEM if user encoded only FIREBASE_PRIVATE_KEY
  if (!key.includes('BEGIN ') && /^[A-Za-z0-9+/_=\s-]+$/.test(key) && key.length > 64) {
    try {
      const decoded = Buffer.from(key.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
      if (decoded.includes('BEGIN ') && !decoded.includes('\uFFFD')) {
        key = decoded;
      }
    } catch {
      // ignore
    }
  }

  key = key
    .replace(/\\\\r\\\\n/g, '\n')
    .replace(/\\\\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  // Re-wrap flattened PEM headers if spaces replaced newlines
  const pemMatch = key.match(
    /^(-----BEGIN [A-Z0-9 ]+-----)([\s\S]+)(-----END [A-Z0-9 ]+-----)$/
  );
  if (pemMatch) {
    const header = pemMatch[1];
    const body = pemMatch[2].replace(/\s+/g, '');
    const footer = pemMatch[3];
    const wrappedBody = body.match(/.{1,64}/g)?.join('\n') || body;
    key = `${header}\n${wrappedBody}\n${footer}\n`;
  }

  try {
    crypto.createPrivateKey({ key, format: 'pem' });
    return key;
  } catch {
    return null;
  }
}

function sanitizeSafeErrorMessage(err: unknown, prefix: string): string {
  const raw = (err as Error)?.message || String(err || '');
  // Never leak private keys, bearer tokens, or email fragments into UI/logs
  const cleaned = raw
    .replace(/-----BEGIN[\s\S]*?-----END[^-\n]*-----/g, '[REDACTED_PEM]')
    .replace(/ya29\.[A-Za-z0-9\-_]+/g, '[REDACTED_TOKEN]')
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '[REDACTED_B64]')
    .slice(0, 180);
  return `${prefix}: ${cleaned}`;
}

function parseServiceAccountFromEnv(): ServiceAccountCreds | null {
  const { projectId: fallbackProject } = readAppletFirebaseConfig();
  const rawJsonEnvInput = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  const rawEmailInput = process.env.FIREBASE_CLIENT_EMAIL || '';
  const rawKeyInput = process.env.FIREBASE_PRIVATE_KEY || '';
  const rawCredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';

  const signature = `${fallbackProject}|${rawJsonEnvInput}|${rawEmailInput}|${rawKeyInput}|${rawCredPath}`;
  if (signature === cachedEnvCredsSignature) {
    if (cachedEnvCredsError && !lastCloudError) {
      lastCloudError = cachedEnvCredsError;
    }
    return cachedEnvCredsResult;
  }

  cachedEnvCredsSignature = signature;
  cachedEnvCredsResult = null;
  cachedEnvCredsError = null;

  const setParseFailure = (safeMsg: string) => {
    cachedEnvCredsError = safeMsg;
    lastCloudError = safeMsg;
  };

  let rawJsonEnv = stripBomAndZeroWidth(rawJsonEnvInput);
  if (rawJsonEnv) {
    // Strip accidental "FIREBASE_SERVICE_ACCOUNT_JSON=" prefix if copied from .env
    rawJsonEnv = rawJsonEnv.replace(/^(?:export\s+)?FIREBASE_SERVICE_ACCOUNT_JSON\s*=\s*/i, '').trim();
    rawJsonEnv = unwrapOuterQuotes(rawJsonEnv);

    let parsed: Record<string, unknown> | null = null;
    if (rawJsonEnv.startsWith('{') || rawJsonEnv.startsWith('"{\\"')) {
      parsed = tryParseJsonObject(rawJsonEnv);
    } else {
      parsed = tryDecodeBase64JsonObject(rawJsonEnv) || tryParseJsonObject(rawJsonEnv);
    }

    if (!parsed) {
      setParseFailure(
        'FIREBASE_SERVICE_ACCOUNT_JSON غير صالح: تأكد من لصق محتوى ملف Service Account JSON كاملاً في Render بدون علامات اقتباس مفردة أو مزدوجة خارجية وبدون ترميز تالف.'
      );
    } else {
      const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : '';
      const rawPrivateKey = typeof parsed.private_key === 'string' ? parsed.private_key : '';
      if (!clientEmail || !clientEmail.includes('@') || !rawPrivateKey) {
        setParseFailure(
          'FIREBASE_SERVICE_ACCOUNT_JSON يفتقد حقول الخدمة المطلوبة (client_email أو private_key). تأكد أنه ملف Service Account وليس إعدادات Web App.'
        );
      } else {
        const normalizedKey = normalizePrivateKeyPem(rawPrivateKey);
        if (!normalizedKey) {
          setParseFailure(
            'حقل private_key داخل FIREBASE_SERVICE_ACCOUNT_JSON غير صالح أو مبتور. أعد نسخ ملف JSON الأصلي كاملاً من Firebase Console.'
          );
        } else {
          const creds: ServiceAccountCreds = {
            clientEmail,
            privateKey: normalizedKey,
            projectId:
              (typeof parsed.project_id === 'string' && parsed.project_id.trim()) || fallbackProject,
            tokenUri:
              (typeof parsed.token_uri === 'string' && parsed.token_uri.trim()) ||
              'https://oauth2.googleapis.com/token',
          };
          cachedEnvCredsResult = creds;
          if (lastCloudError && lastCloudError.includes('FIREBASE_SERVICE_ACCOUNT_JSON')) {
            lastCloudError = null;
          }
          return creds;
        }
      }
    }
  }

  const clientEmail = unwrapOuterQuotes(stripBomAndZeroWidth(rawEmailInput));
  const rawPrivateKey = stripBomAndZeroWidth(rawKeyInput);
  if (clientEmail && rawPrivateKey) {
    const normalizedKey = normalizePrivateKeyPem(rawPrivateKey);
    if (!normalizedKey) {
      setParseFailure('FIREBASE_PRIVATE_KEY غير صالح أو مبتور (تأكد من تضمين BEGIN/END PRIVATE KEY كاملاً).');
    } else {
      const creds: ServiceAccountCreds = {
        clientEmail,
        privateKey: normalizedKey,
        projectId: fallbackProject,
        tokenUri: 'https://oauth2.googleapis.com/token',
      };
      cachedEnvCredsResult = creds;
      lastCloudError = null;
      return creds;
    }
  }

  const credPath = rawCredPath.trim();
  if (credPath && fs.existsSync(credPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(credPath, 'utf-8')) as Record<string, string>;
      if (parsed.client_email && parsed.private_key) {
        const normalizedKey = normalizePrivateKeyPem(parsed.private_key);
        if (normalizedKey) {
          const creds: ServiceAccountCreds = {
            clientEmail: parsed.client_email.trim(),
            privateKey: normalizedKey,
            projectId: (parsed.project_id || fallbackProject).trim(),
            tokenUri: (parsed.token_uri || 'https://oauth2.googleapis.com/token').trim(),
          };
          cachedEnvCredsResult = creds;
          lastCloudError = null;
          return creds;
        }
      }
    } catch {
      // ignore invalid credentials file path
    }
  }

  return null;
}

export function getDataDir(): string {
  const configured = (process.env.DATA_DIR || '').trim();
  const isServerlessEphemeral = Boolean(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
  );
  const dir = configured
    ? path.resolve(configured)
    : isServerlessEphemeral
    ? '/tmp/echox_data'
    : process.cwd();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getDataFilePath(filename: string): string {
  return path.join(getDataDir(), filename);
}

export function atomicWriteJsonSync(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

function isUpstashEnabled(): boolean {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return Boolean(/^https?:\/\//i.test(url) && token.length > 0);
}

function isFirestoreServiceAccountEnabled(): boolean {
  return parseServiceAccountFromEnv() !== null;
}

export function isCloudPersistenceEnabled(): boolean {
  return isFirestoreServiceAccountEnabled() || isUpstashEnabled();
}

export function isRenderRuntime(): boolean {
  return Boolean(
    process.env.RENDER === 'true' ||
      process.env.RENDER_SERVICE_ID ||
      process.env.RENDER_INSTANCE_ID ||
      process.env.VERCEL === '1' ||
      process.env.AWS_LAMBDA_FUNCTION_NAME
  );
}

export function getPersistenceStatus(): PersistenceStatus {
  const hasDataDir = Boolean((process.env.DATA_DIR || '').trim());
  const isRender = isRenderRuntime();
  const { projectId, databaseId } = readAppletFirebaseConfig();
  const serviceAccount = parseServiceAccountFromEnv();

  if (serviceAccount) {
    return {
      provider: 'firestore',
      storageMode: 'firestore+local-atomic',
      cloudEnabled: true,
      durable: true,
      isRender,
      dataDir: getDataDir(),
      firestoreProjectId: serviceAccount.projectId || projectId,
      firestoreDatabaseId: databaseId,
      lastCloudWriteAt,
      lastCloudError,
    };
  }

  if (isUpstashEnabled()) {
    return {
      provider: 'upstash-redis',
      storageMode: 'upstash-redis+local-atomic',
      cloudEnabled: true,
      durable: true,
      isRender,
      dataDir: getDataDir(),
      firestoreProjectId: projectId,
      firestoreDatabaseId: databaseId,
      lastCloudWriteAt,
      lastCloudError,
    };
  }

  if (hasDataDir) {
    return {
      provider: 'persistent-disk',
      storageMode: 'persistent-disk',
      cloudEnabled: false,
      durable: true,
      isRender,
      dataDir: getDataDir(),
      firestoreProjectId: projectId,
      firestoreDatabaseId: databaseId,
      lastCloudWriteAt,
      lastCloudError,
    };
  }

  if (isRender) {
    return {
      provider: 'ephemeral-render-disk',
      storageMode: 'ephemeral-render-disk',
      cloudEnabled: false,
      durable: false,
      isRender: true,
      dataDir: getDataDir(),
      firestoreProjectId: projectId,
      firestoreDatabaseId: databaseId,
      lastCloudWriteAt,
      lastCloudError,
    };
  }

  return {
    provider: 'local-atomic-disk',
    storageMode: 'local-atomic-disk',
    cloudEnabled: false,
    durable: true,
    isRender: false,
    dataDir: getDataDir(),
    firestoreProjectId: projectId,
    firestoreDatabaseId: databaseId,
    lastCloudWriteAt,
    lastCloudError,
  };
}

function toFirestoreDocId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getFirestoreAccessToken(creds: ServiceAccountCreds): Promise<string> {
  const tokenUrl = (process.env.GOOGLE_OAUTH_TOKEN_URL || creds.tokenUri || 'https://oauth2.googleapis.com/token').trim();
  const cacheKey = `${creds.projectId}:${creds.clientEmail}:${tokenUrl}`;
  const nowMs = Date.now();
  if (cachedAccessToken && cachedAccessToken.cacheKey === cacheKey && nowMs < cachedAccessToken.expiresAtMs - 60_000) {
    return cachedAccessToken.token;
  }

  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 3600;
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: tokenUrl,
      iat,
      exp,
    })
  );
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(creds.privateKey));
  const assertion = `${signingInput}.${signature}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
      error?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new Error(body.error_description || body.error || `OAuth2 HTTP ${res.status}`);
    }
    cachedAccessToken = {
      token: body.access_token,
      expiresAtMs: nowMs + (body.expires_in || 3600) * 1000,
      cacheKey,
    };
    return body.access_token;
  } finally {
    clearTimeout(timer);
  }
}

function buildFirestoreDocUrl(creds: ServiceAccountCreds, key: string): string {
  const origin = (process.env.FIRESTORE_REST_ORIGIN || 'https://firestore.googleapis.com')
    .trim()
    .replace(/\/$/, '');
  const { databaseId } = readAppletFirebaseConfig();
  const docId = toFirestoreDocId(key);
  return `${origin}/v1/projects/${encodeURIComponent(creds.projectId)}/databases/${encodeURIComponent(databaseId)}/documents/echox_system_state/${encodeURIComponent(docId)}`;
}

export interface LoadCloudMetaResult<T> {
  data: T | null;
  updateTime?: string;
}

export interface SaveCloudOptions {
  expectedUpdateTime?: string;
}

async function loadFromFirestoreWithMeta<T>(key: string): Promise<LoadCloudMetaResult<T>> {
  const creds = parseServiceAccountFromEnv();
  if (!creds) return { data: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const token = await getFirestoreAccessToken(creds);
    const url = buildFirestoreDocUrl(creds, key);
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.status === 404) {
      // Distinguish "document not created yet" from "Firestore database does not exist"
      const bodyText = await res.text().catch(() => '');
      if (/database .* does not exist/i.test(bodyText)) {
        lastCloudError = 'قاعدة بيانات Firestore المحددة غير موجودة أو المعرّف (firestoreDatabaseId) غير مطابق.';
        console.error(`[CloudPersistence][Firestore] Database mismatch for ${key}`);
      } else {
        lastCloudError = null;
      }
      return { data: null };
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Firestore read HTTP ${res.status}: ${errText.slice(0, 160)}`);
    }
    lastCloudError = null;
    const doc = (await res.json()) as {
      updateTime?: string;
      fields?: { payloadJson?: { stringValue?: string } };
    };
    const raw = doc?.fields?.payloadJson?.stringValue;
    if (!raw || typeof raw !== 'string') return { data: null, updateTime: doc?.updateTime };
    return { data: JSON.parse(raw) as T, updateTime: doc?.updateTime };
  } catch (err) {
    lastCloudError = sanitizeSafeErrorMessage(err, 'فشل الاتصال أو صلاحيات القراءة في Firestore');
    console.warn(`[CloudPersistence][Firestore] Notice loading ${key}:`, lastCloudError);
    return { data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function loadFromFirestore<T>(key: string): Promise<T | null> {
  const res = await loadFromFirestoreWithMeta<T>(key);
  return res.data;
}

export async function probeCloudPersistenceConnection(): Promise<{
  ok: boolean;
  provider: PersistenceProvider;
  error?: string;
}> {
  const status = getPersistenceStatus();
  if (status.provider === 'firestore') {
    const creds = parseServiceAccountFromEnv();
    if (!creds) {
      return { ok: false, provider: status.provider, error: lastCloudError || 'Invalid service account.' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const token = await getFirestoreAccessToken(creds);
      const url = buildFirestoreDocUrl(creds, 'echox:central_security_config');
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.ok) {
        lastCloudError = null;
        return { ok: true, provider: 'firestore' };
      }
      const errText = await res.text().catch(() => '');
      if (res.status === 404 && !/database .* does not exist/i.test(errText)) {
        lastCloudError = null;
        return { ok: true, provider: 'firestore' };
      }
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 140)}`);
    } catch (err) {
      const msg = sanitizeSafeErrorMessage(err, 'فشل فحص اتصال Firestore أو صلاحيات حساب الخدمة');
      lastCloudError = msg;
      return { ok: false, provider: 'firestore', error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: status.durable, provider: status.provider, error: lastCloudError || undefined };
}

async function saveToFirestore(
  key: string,
  data: unknown,
  options?: SaveCloudOptions
): Promise<{ ok: boolean; error?: string; conflict?: boolean; updateTime?: string }> {
  const creds = parseServiceAccountFromEnv();
  if (!creds) return { ok: false, error: lastCloudError || 'Firestore service account credentials not configured.' };

  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, 'utf8') > 950_000) {
    return {
      ok: false,
      error: 'حجم البيانات يتجاوز الحد المسموح لمستند Firestore (950KB). يرجى تقليل حجم الصور المضمنة.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const token = await getFirestoreAccessToken(creds);
    let url = buildFirestoreDocUrl(creds, key);
    if (options?.expectedUpdateTime) {
      url += `?currentDocument.updateTime=${encodeURIComponent(options.expectedUpdateTime)}`;
    }
    const nowIso = new Date().toISOString();
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          key: { stringValue: key },
          payloadJson: { stringValue: serialized },
          updatedAt: { stringValue: nowIso },
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const isConflict =
        res.status === 409 ||
        res.status === 412 ||
        (res.status === 400 && /FAILED_PRECONDITION|ABORTED|updateTime/i.test(errText));
      if (isConflict) {
        return { ok: false, conflict: true, error: 'Firestore concurrent write conflict detected.' };
      }
      throw new Error(`Firestore HTTP ${res.status}: ${errText.slice(0, 180)}`);
    }
    const savedDoc = (await res.json().catch(() => ({}))) as { updateTime?: string };
    lastCloudWriteAt = nowIso;
    lastCloudError = null;
    return { ok: true, updateTime: savedDoc?.updateTime };
  } catch (err) {
    const msg = sanitizeSafeErrorMessage(err, 'فشل الحفظ في قاعدة بيانات Firestore');
    lastCloudError = msg;
    console.error(`[CloudPersistence][Firestore] Write error for ${key}:`, msg);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function deleteFromFirestore(key: string): Promise<{ ok: boolean; error?: string }> {
  const creds = parseServiceAccountFromEnv();
  if (!creds) return { ok: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const token = await getFirestoreAccessToken(creds);
    const url = buildFirestoreDocUrl(creds, key);
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.status === 404 || res.ok) return { ok: true };
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore delete HTTP ${res.status}: ${errText.slice(0, 160)}`);
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function loadFromUpstash<T>(key: string): Promise<T | null> {
  if (!isUpstashEnabled()) return null;
  const url = process.env.UPSTASH_REDIS_REST_URL!.trim().replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { result?: string | null };
    if (!payload || typeof payload.result !== 'string' || !payload.result) {
      return null;
    }
    return JSON.parse(payload.result) as T;
  } catch (err) {
    console.warn(`[CloudPersistence][Upstash] Notice loading ${key}:`, (err as Error)?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function saveToUpstash(key: string, data: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!isUpstashEnabled()) {
    return { ok: false, error: 'Upstash Redis REST credentials not configured.' };
  }
  const url = process.env.UPSTASH_REDIS_REST_URL!.trim().replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upstash HTTP ${res.status}: ${errText.slice(0, 160)}`);
    }
    lastCloudWriteAt = new Date().toISOString();
    lastCloudError = null;
    return { ok: true };
  } catch (err) {
    const msg = `فشل الحفظ في قاعدة بيانات Upstash Redis: ${(err as Error)?.message || String(err)}`;
    lastCloudError = msg;
    console.error(`[CloudPersistence][Upstash] Write error for ${key}:`, msg);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function deleteFromUpstash(key: string): Promise<{ ok: boolean; error?: string }> {
  if (!isUpstashEnabled()) return { ok: true };
  const url = process.env.UPSTASH_REDIS_REST_URL!.trim().replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${url}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Upstash delete HTTP ${res.status}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadCloudJsonWithMeta<T>(key: string): Promise<LoadCloudMetaResult<T>> {
  if (isFirestoreServiceAccountEnabled()) {
    return loadFromFirestoreWithMeta<T>(key);
  }
  if (isUpstashEnabled()) {
    const data = await loadFromUpstash<T>(key);
    return { data };
  }
  return { data: null };
}

export async function loadCloudJson<T>(key: string): Promise<T | null> {
  const res = await loadCloudJsonWithMeta<T>(key);
  return res.data;
}

export async function saveCloudJson(
  key: string,
  data: unknown,
  options?: SaveCloudOptions
): Promise<{ ok: boolean; error?: string; conflict?: boolean; updateTime?: string }> {
  if (isFirestoreServiceAccountEnabled()) {
    return saveToFirestore(key, data, options);
  }
  if (isUpstashEnabled()) {
    return saveToUpstash(key, data);
  }
  return { ok: false, error: 'No cloud persistence backend configured.' };
}

export async function savePersistentJson(
  cloudKey: string,
  localFilePath: string,
  data: unknown,
  options: { allowEphemeral?: boolean } = {}
): Promise<PersistResult> {
  const status = getPersistenceStatus();

  if (!status.durable && !options.allowEphemeral) {
    return {
      ok: false,
      durable: false,
      provider: status.provider,
      error:
        'تعذر تأكيد الحفظ الدائم: خادم Render يعمل حالياً بقرص مؤقت بدون قاعدة بيانات سحابية مربوطة. أضف FIREBASE_SERVICE_ACCOUNT_JSON أو UPSTASH_REDIS_REST_URL أو قرصاً دائماً (DATA_DIR) في إعدادات Render.',
    };
  }

  if (status.cloudEnabled) {
    const cloudTask = saveCloudJson(cloudKey, data);
    inflightSyncs.add(cloudTask);
    try {
      const cloudRes = await cloudTask;
      if (!cloudRes.ok) {
        return {
          ok: false,
          durable: false,
          provider: status.provider,
          error: cloudRes.error || 'فشل تأكيد الحفظ في قاعدة البيانات السحابية.',
        };
      }
    } finally {
      inflightSyncs.delete(cloudTask);
    }
  }

  try {
    atomicWriteJsonSync(localFilePath, data);
  } catch (err) {
    const errMsg = `فشل الكتابة على قرص الخادم: ${(err as Error)?.message || String(err)}`;
    console.error(`[CloudPersistence] Local disk error (${localFilePath}):`, err);
    if (!status.cloudEnabled) {
      return {
        ok: false,
        durable: false,
        provider: status.provider,
        error: errMsg,
      };
    }
  }

  return {
    ok: true,
    durable: status.durable,
    provider: status.provider,
  };
}

export async function deletePersistentJson(
  cloudKey: string,
  localFilePath: string
): Promise<PersistResult> {
  const status = getPersistenceStatus();
  if (!status.durable) {
    return {
      ok: false,
      durable: false,
      provider: status.provider,
      error:
        'تعذر تأكيد الحذف الدائم لأن الخادم يعمل حالياً على قرص مؤقت في Render بدون قاعدة بيانات مربوطة.',
    };
  }

  if (isFirestoreServiceAccountEnabled()) {
    const delRes = await deleteFromFirestore(cloudKey);
    if (!delRes.ok) {
      return { ok: false, durable: false, provider: status.provider, error: delRes.error };
    }
  } else if (isUpstashEnabled()) {
    const delRes = await deleteFromUpstash(cloudKey);
    if (!delRes.ok) {
      return { ok: false, durable: false, provider: status.provider, error: delRes.error };
    }
  }

  try {
    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }
  } catch (err) {
    if (!status.cloudEnabled) {
      return { ok: false, durable: false, provider: status.provider, error: (err as Error)?.message };
    }
  }

  return { ok: true, durable: status.durable, provider: status.provider };
}

export function pushCloudJson(key: string, data: unknown): void {
  if (!isCloudPersistenceEnabled()) return;
  const task = saveCloudJson(key, data).catch((err) => {
    console.warn(`[CloudPersistence] Notice syncing ${key}:`, (err as Error)?.message || err);
  });
  inflightSyncs.add(task);
  task.finally(() => {
    inflightSyncs.delete(task);
  });
}

export async function flushCloudWrites(): Promise<void> {
  if (inflightSyncs.size === 0) return;
  await Promise.allSettled(Array.from(inflightSyncs));
}
