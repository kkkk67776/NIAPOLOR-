export interface EdgeEnv {
  BACKEND_ORIGIN?: string;
  SITE_URL?: string;
  VITE_SITE_URL?: string;
  ENVIRONMENT?: string;
  EDGE_MODE_DISABLED?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  FIREBASE_FIRESTORE_DATABASE_ID?: string;
  VITE_FIREBASE_FIRESTORE_DATABASE_ID?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  ECHOX_SECURITY_HMAC_SECRET?: string;
  ECHOX_OWNER_EMAIL?: string;
  LOCKED_BANK_IBAN?: string;
  LOCKED_BANK_HOLDER?: string;
  LOCKED_BANK_NAME?: string;
  LOCKED_BANK_SWIFT?: string;
  GOOGLE_OAUTH_TOKEN_URL?: string;
  FIRESTORE_REST_ORIGIN?: string;
  CF_PROXY_SECRET?: string;
  [key: string]: string | undefined;
}

export interface EdgeContext {
  request: Request;
  env: EdgeEnv;
  waitUntil?: (promise: Promise<unknown>) => void;
}

interface ParsedServiceAccount {
  clientEmail: string;
  privateKeyPem: string;
  projectId: string;
  databaseId: string;
  tokenUri: string;
}

export const DEFAULT_PROJECT_ID = 'gen-lang-client-0499444627';
export const DEFAULT_DATABASE_ID = 'ai-studio-echoxstore-9e1d54e8-7960-44b2-951a-524166c61a13';
export const DEFAULT_OWNER_EMAIL = 'abdelkaderbahri570@gmail.com';
export const DEFAULT_RENDER_BACKEND = 'https://echox-store.onrender.com';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

let cachedParsedCredsSig = '';
let cachedParsedCreds: ParsedServiceAccount | null = null;
let cachedParsedError: string | null = null;
let cachedOAuthToken: { token: string; expiresAtMs: number; cacheKey: string } | null = null;
let lastEdgeCloudWriteAt: string | null = null;

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
      const inner = current.slice(1, -1).trim();
      if (current.startsWith('"') && inner.startsWith('{\\"')) {
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

  const normalizedQuotes = trimmed
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  if (normalizedQuotes !== trimmed) {
    attempts.push(normalizedQuotes);
  }

  if (trimmed.includes('\\"')) {
    attempts.push(trimmed.replace(/\\"/g, '"').replace(/\\\\n/g, '\\n'));
  }

  if (trimmed.startsWith('{') && /[\r\n]/.test(trimmed)) {
    attempts.push(escapeLiteralNewlinesInsideJsonStrings(trimmed));
  }

  for (const candidate of attempts) {
    try {
      let parsed: unknown = JSON.parse(candidate);
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
      // try next repair attempt
    }
  }
  return null;
}

function decodeBase64ToBytes(b64: string): Uint8Array | null {
  try {
    const clean = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const padLen = clean.length % 4;
    const padded = padLen === 0 ? clean : clean + '='.repeat(4 - padLen);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function tryDecodeBase64JsonObject(raw: string): Record<string, unknown> | null {
  const withoutDataUri = raw.replace(/^data:[^;]+;base64,/i, '').trim();
  const compact = withoutDataUri.replace(/\s+/g, '');
  if (!compact || compact.length < 24 || !/^[A-Za-z0-9+/_=-]+$/.test(compact)) {
    return null;
  }
  const bytes = decodeBase64ToBytes(compact);
  if (!bytes) return null;
  const decoded = decoder.decode(bytes);
  if (!decoded || decoded.includes('\uFFFD')) return null;
  const cleanDecoded = stripBomAndZeroWidth(decoded);
  if (!cleanDecoded.startsWith('{')) return null;
  return tryParseJsonObject(cleanDecoded);
}

function normalizePrivateKeyPemText(rawKey: string): string | null {
  let key = stripBomAndZeroWidth(rawKey);
  key = unwrapOuterQuotes(key);
  if (!key) return null;

  if (!key.includes('BEGIN ') && /^[A-Za-z0-9+/_=\s-]+$/.test(key) && key.length > 64) {
    const bytes = decodeBase64ToBytes(key);
    if (bytes) {
      const decoded = decoder.decode(bytes);
      if (decoded.includes('BEGIN ') && !decoded.includes('\uFFFD')) {
        key = decoded;
      }
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

  const pemMatch = key.match(
    /^(-----BEGIN [A-Z0-9 ]+-----)([\s\S]+)(-----END [A-Z0-9 ]+-----)$/
  );
  if (!pemMatch) return null;

  const header = pemMatch[1];
  const body = pemMatch[2].replace(/\s+/g, '');
  const footer = pemMatch[3];
  const wrappedBody = body.match(/.{1,64}/g)?.join('\n') || body;
  return `${header}\n${wrappedBody}\n${footer}\n`;
}

function resolveDatabaseConfig(env: EdgeEnv): { projectId: string; databaseId: string } {
  const projectId = (env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID).trim();
  let databaseId = (
    env.FIREBASE_FIRESTORE_DATABASE_ID ||
    env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
    DEFAULT_DATABASE_ID
  ).trim();
  if (databaseId === 'G-LLXC1GEL75') {
    databaseId = DEFAULT_DATABASE_ID;
  }
  return { projectId, databaseId };
}

export function sanitizeEdgeErrorMessage(err: unknown, prefix: string): string {
  const raw = (err as Error)?.message || String(err || '');
  const cleaned = raw
    .replace(/-----BEGIN[\s\S]*?-----END[^-\n]*-----/g, '[REDACTED_PEM]')
    .replace(/ya29\.[A-Za-z0-9\-_]+/g, '[REDACTED_TOKEN]')
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '[REDACTED_B64]')
    .slice(0, 180);
  return `${prefix}: ${cleaned}`;
}

export function parseServiceAccountFromEdgeEnv(env: EdgeEnv): {
  creds: ParsedServiceAccount | null;
  error: string | null;
} {
  const { projectId: fallbackProject, databaseId } = resolveDatabaseConfig(env);
  const rawJsonInput = env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  const rawEmailInput = env.FIREBASE_CLIENT_EMAIL || '';
  const rawKeyInput = env.FIREBASE_PRIVATE_KEY || '';
  const signature = `${fallbackProject}|${databaseId}|${rawJsonInput}|${rawEmailInput}|${rawKeyInput}`;

  if (signature === cachedParsedCredsSig) {
    return { creds: cachedParsedCreds, error: cachedParsedError };
  }

  cachedParsedCredsSig = signature;
  cachedParsedCreds = null;
  cachedParsedError = null;

  let rawJsonEnv = stripBomAndZeroWidth(rawJsonInput);
  if (rawJsonEnv) {
    rawJsonEnv = rawJsonEnv.replace(/^(?:export\s+)?FIREBASE_SERVICE_ACCOUNT_JSON\s*=\s*/i, '').trim();
    rawJsonEnv = unwrapOuterQuotes(rawJsonEnv);

    const parsed =
      rawJsonEnv.startsWith('{') || rawJsonEnv.startsWith('"{\\"')
        ? tryParseJsonObject(rawJsonEnv)
        : tryDecodeBase64JsonObject(rawJsonEnv) || tryParseJsonObject(rawJsonEnv);

    if (!parsed) {
      cachedParsedError =
        'FIREBASE_SERVICE_ACCOUNT_JSON غير صالح في Cloudflare Pages: تأكد من لصق ملف Service Account JSON كاملاً.';
      return { creds: null, error: cachedParsedError };
    }

    const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : '';
    const rawPrivateKey = typeof parsed.private_key === 'string' ? parsed.private_key : '';
    if (!clientEmail || !clientEmail.includes('@') || !rawPrivateKey) {
      cachedParsedError = 'FIREBASE_SERVICE_ACCOUNT_JSON يفتقد client_email أو private_key.';
      return { creds: null, error: cachedParsedError };
    }

    const normalizedPem = normalizePrivateKeyPemText(rawPrivateKey);
    if (!normalizedPem) {
      cachedParsedError = 'حقل private_key داخل FIREBASE_SERVICE_ACCOUNT_JSON غير صالح.';
      return { creds: null, error: cachedParsedError };
    }

    cachedParsedCreds = {
      clientEmail,
      privateKeyPem: normalizedPem,
      projectId: (typeof parsed.project_id === 'string' && parsed.project_id.trim()) || fallbackProject,
      databaseId,
      tokenUri:
        (typeof parsed.token_uri === 'string' && parsed.token_uri.trim()) ||
        'https://oauth2.googleapis.com/token',
    };
    return { creds: cachedParsedCreds, error: null };
  }

  const clientEmail = unwrapOuterQuotes(stripBomAndZeroWidth(rawEmailInput));
  const rawPrivateKey = stripBomAndZeroWidth(rawKeyInput);
  if (clientEmail && rawPrivateKey) {
    const normalizedPem = normalizePrivateKeyPemText(rawPrivateKey);
    if (!normalizedPem) {
      cachedParsedError = 'FIREBASE_PRIVATE_KEY غير صالح أو مبتور.';
      return { creds: null, error: cachedParsedError };
    }
    cachedParsedCreds = {
      clientEmail,
      privateKeyPem: normalizedPem,
      projectId: fallbackProject,
      databaseId,
      tokenUri: 'https://oauth2.googleapis.com/token',
    };
    return { creds: cachedParsedCreds, error: null };
  }

  return { creds: null, error: null };
}

export function isEdgeUpstashEnabled(env: EdgeEnv): boolean {
  const url = (env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return Boolean(/^https?:\/\//i.test(url) && token.length > 0);
}

export function isEdgePersistenceConfigured(env: EdgeEnv): boolean {
  if ((env.EDGE_MODE_DISABLED || '').trim().toLowerCase() === 'true') {
    return false;
  }
  const { creds } = parseServiceAccountFromEdgeEnv(env);
  return creds !== null || isEdgeUpstashEnabled(env);
}

export function getEdgePersistenceStatus(env: EdgeEnv, lastError?: string | null) {
  const { creds, error } = parseServiceAccountFromEdgeEnv(env);
  const { projectId, databaseId } = resolveDatabaseConfig(env);
  if (creds) {
    return {
      provider: 'firestore' as const,
      storageMode: 'cloudflare-edge+firestore',
      cloudEnabled: true,
      durable: true,
      isRender: false,
      dataDir: 'cloudflare-pages-edge',
      firestoreProjectId: creds.projectId || projectId,
      firestoreDatabaseId: databaseId,
      lastCloudWriteAt: lastEdgeCloudWriteAt,
      lastCloudError: lastError ?? null,
    };
  }
  if (isEdgeUpstashEnabled(env)) {
    return {
      provider: 'upstash-redis' as const,
      storageMode: 'cloudflare-edge+upstash-redis',
      cloudEnabled: true,
      durable: true,
      isRender: false,
      dataDir: 'cloudflare-pages-edge',
      firestoreProjectId: projectId,
      firestoreDatabaseId: databaseId,
      lastCloudWriteAt: lastEdgeCloudWriteAt,
      lastCloudError: lastError ?? error ?? null,
    };
  }
  return {
    provider: 'ephemeral-render-disk' as const,
    storageMode: 'proxy-fallback',
    cloudEnabled: false,
    durable: false,
    isRender: false,
    dataDir: 'cloudflare-pages-edge',
    firestoreProjectId: projectId,
    firestoreDatabaseId: databaseId,
    lastCloudWriteAt: lastEdgeCloudWriteAt,
    lastCloudError: lastError ?? error ?? null,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeDerLength(len: number): number[] {
  if (len < 128) return [len];
  const bytes: number[] = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function wrapPkcs1InPkcs8(pkcs1Bytes: Uint8Array): Uint8Array {
  // Wrap PKCS#1 RSAPrivateKey DER in PKCS#8 PrivateKeyInfo if needed
  const version = [0x02, 0x01, 0x00];
  const algId = [
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ];
  const octetHeader = [0x04, ...encodeDerLength(pkcs1Bytes.length)];
  const bodyLen = version.length + algId.length + octetHeader.length + pkcs1Bytes.length;
  const seqHeader = [0x30, ...encodeDerLength(bodyLen)];
  const out = new Uint8Array(seqHeader.length + bodyLen);
  let offset = 0;
  for (const part of [seqHeader, version, algId, octetHeader]) {
    out.set(part, offset);
    offset += part.length;
  }
  out.set(pkcs1Bytes, offset);
  return out;
}

async function importServiceAccountPrivateKey(pem: string): Promise<CryptoKey> {
  const isPkcs1 = pem.includes('BEGIN RSA PRIVATE KEY');
  const b64 = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  const rawBytes = decodeBase64ToBytes(b64);
  if (!rawBytes || rawBytes.length < 64) {
    throw new Error('Invalid private key DER payload');
  }
  const pkcs8Bytes = isPkcs1 ? wrapPkcs1InPkcs8(rawBytes) : rawBytes;
  const keyBuffer = pkcs8Bytes.buffer.slice(
    pkcs8Bytes.byteOffset,
    pkcs8Bytes.byteOffset + pkcs8Bytes.byteLength
  ) as ArrayBuffer;
  return crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function getEdgeFirestoreAccessToken(creds: ParsedServiceAccount, env: EdgeEnv): Promise<string> {
  const tokenUrl = (env.GOOGLE_OAUTH_TOKEN_URL || creds.tokenUri || 'https://oauth2.googleapis.com/token').trim();
  const cacheKey = `${creds.projectId}:${creds.clientEmail}:${tokenUrl}`;
  const nowMs = Date.now();
  if (cachedOAuthToken && cachedOAuthToken.cacheKey === cacheKey && nowMs < cachedOAuthToken.expiresAtMs - 60_000) {
    return cachedOAuthToken.token;
  }

  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 3600;
  const headerB64 = toBase64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claimB64 = toBase64Url(
    encoder.encode(
      JSON.stringify({
        iss: creds.clientEmail,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: tokenUrl,
        iat,
        exp,
      })
    )
  );
  const signingInput = `${headerB64}.${claimB64}`;
  const cryptoKey = await importServiceAccountPrivateKey(creds.privateKeyPem);
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(signingInput));
  const assertion = `${signingInput}.${toBase64Url(new Uint8Array(sigBuf))}`;

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
    cachedOAuthToken = {
      token: body.access_token,
      expiresAtMs: nowMs + (body.expires_in || 3600) * 1000,
      cacheKey,
    };
    return body.access_token;
  } finally {
    clearTimeout(timer);
  }
}

function toFirestoreDocId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildEdgeFirestoreDocUrl(creds: ParsedServiceAccount, env: EdgeEnv, key: string): string {
  const origin = (env.FIRESTORE_REST_ORIGIN || 'https://firestore.googleapis.com')
    .trim()
    .replace(/\/$/, '');
  const docId = toFirestoreDocId(key);
  return `${origin}/v1/projects/${encodeURIComponent(creds.projectId)}/databases/${encodeURIComponent(
    creds.databaseId
  )}/documents/echox_system_state/${encodeURIComponent(docId)}`;
}

export interface EdgeLoadResult<T> {
  ok: boolean;
  exists: boolean;
  data: T | null;
  updateTime?: string;
  error?: string;
}

export interface EdgeSaveResult {
  ok: boolean;
  conflict?: boolean;
  updateTime?: string;
  error?: string;
}

export async function loadEdgeDocWithMeta<T>(env: EdgeEnv, key: string): Promise<EdgeLoadResult<T>> {
  const { creds, error: credsError } = parseServiceAccountFromEdgeEnv(env);
  if (creds) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const token = await getEdgeFirestoreAccessToken(creds, env);
      const url = buildEdgeFirestoreDocUrl(creds, env, key);
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.status === 404) {
        const bodyText = await res.text().catch(() => '');
        if (/database .* does not exist/i.test(bodyText)) {
          return {
            ok: false,
            exists: false,
            data: null,
            error: 'قاعدة بيانات Firestore المحددة غير موجودة أو المعرّف غير مطابق.',
          };
        }
        return { ok: true, exists: false, data: null };
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          ok: false,
          exists: false,
          data: null,
          error: `Firestore HTTP ${res.status}: ${errText.slice(0, 140)}`,
        };
      }
      const doc = (await res.json()) as {
        updateTime?: string;
        fields?: { payloadJson?: { stringValue?: string } };
      };
      const raw = doc?.fields?.payloadJson?.stringValue;
      if (!raw || typeof raw !== 'string') {
        return { ok: true, exists: true, data: null, updateTime: doc?.updateTime };
      }
      return {
        ok: true,
        exists: true,
        data: JSON.parse(raw) as T,
        updateTime: doc?.updateTime,
      };
    } catch (err) {
      return {
        ok: false,
        exists: false,
        data: null,
        error: sanitizeEdgeErrorMessage(err, 'فشل قراءة بيانات Firestore'),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  if (isEdgeUpstashEnabled(env)) {
    const url = env.UPSTASH_REDIS_REST_URL!.trim().replace(/\/$/, '');
    const token = env.UPSTASH_REDIS_REST_TOKEN!.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        return { ok: false, exists: false, data: null, error: `Upstash HTTP ${res.status}` };
      }
      const payload = (await res.json()) as { result?: string | null };
      if (!payload || typeof payload.result !== 'string' || !payload.result) {
        return { ok: true, exists: false, data: null };
      }
      return { ok: true, exists: true, data: JSON.parse(payload.result) as T };
    } catch (err) {
      return {
        ok: false,
        exists: false,
        data: null,
        error: sanitizeEdgeErrorMessage(err, 'فشل قراءة Upstash Redis'),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, exists: false, data: null, error: credsError || 'Cloud persistence not configured.' };
}

export async function saveEdgeDoc(
  env: EdgeEnv,
  key: string,
  data: unknown,
  options?: { expectedUpdateTime?: string }
): Promise<EdgeSaveResult> {
  const { creds, error: credsError } = parseServiceAccountFromEdgeEnv(env);
  if (creds) {
    const serialized = JSON.stringify(data);
    if (encoder.encode(serialized).byteLength > 950_000) {
      return {
        ok: false,
        error: 'حجم البيانات يتجاوز الحد المسموح لمستند Firestore (950KB).',
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const token = await getEdgeFirestoreAccessToken(creds, env);
      let url = buildEdgeFirestoreDocUrl(creds, env, key);
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
          return { ok: false, conflict: true, error: 'Firestore concurrent write conflict.' };
        }
        return { ok: false, error: `Firestore HTTP ${res.status}: ${errText.slice(0, 140)}` };
      }
      const savedDoc = (await res.json().catch(() => ({}))) as { updateTime?: string };
      lastEdgeCloudWriteAt = nowIso;
      return { ok: true, updateTime: savedDoc?.updateTime };
    } catch (err) {
      return {
        ok: false,
        error: sanitizeEdgeErrorMessage(err, 'فشل الحفظ في قاعدة بيانات Firestore'),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  if (isEdgeUpstashEnabled(env)) {
    const url = env.UPSTASH_REDIS_REST_URL!.trim().replace(/\/$/, '');
    const token = env.UPSTASH_REDIS_REST_TOKEN!.trim();
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
        return { ok: false, error: `Upstash HTTP ${res.status}` };
      }
      lastEdgeCloudWriteAt = new Date().toISOString();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: sanitizeEdgeErrorMessage(err, 'فشل الحفظ في Upstash Redis'),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: credsError || 'Cloud persistence not configured.' };
}

export async function mutateEdgeDocWithRetry<TDoc, TResult>(
  env: EdgeEnv,
  key: string,
  mutator: (current: Partial<TDoc> | null) => Promise<{
    nextDoc?: TDoc;
    result: TResult;
    skipWrite?: boolean;
  }>,
  maxRetries = 3
): Promise<{ ok: boolean; result?: TResult; error?: string; statusCode?: number }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const loaded = await loadEdgeDocWithMeta<Partial<TDoc>>(env, key);
    if (!loaded.ok) {
      return { ok: false, statusCode: 503, error: loaded.error || 'تعذر قراءة قاعدة البيانات.' };
    }
    const mutated = await mutator(loaded.data);
    if (mutated.skipWrite || !mutated.nextDoc) {
      return { ok: true, result: mutated.result };
    }
    const saved = await saveEdgeDoc(env, key, mutated.nextDoc, {
      expectedUpdateTime: loaded.updateTime,
    });
    if (saved.ok) {
      return { ok: true, result: mutated.result };
    }
    if (!saved.conflict) {
      return { ok: false, statusCode: 503, error: saved.error || 'تعذر حفظ التعديلات في قاعدة البيانات.' };
    }
  }
  return { ok: false, statusCode: 503, error: 'تعارض متزامن أثناء الحفظ، يرجى المحاولة مجدداً.' };
}

export async function probeEdgeFirestoreConnection(env: EdgeEnv): Promise<{
  ok: boolean;
  provider: string;
  error?: string;
}> {
  const loaded = await loadEdgeDocWithMeta<unknown>(env, 'echox:central_security_config');
  const status = getEdgePersistenceStatus(env, loaded.error);
  return {
    ok: loaded.ok,
    provider: status.provider,
    error: loaded.ok ? undefined : loaded.error,
  };
}

// ==========================================
// WebCrypto Security & Session Helpers
// ==========================================

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(message));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function randomHex(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

let cachedCloudHmacSecret: { secret: string; fetchedAt: number } | null = null;

export async function resolveSharedHmacSecret(env: EdgeEnv): Promise<string | null> {
  const fromEnv = (env.ECHOX_SECURITY_HMAC_SECRET || '').trim();
  if (fromEnv.length >= 16) return fromEnv;

  if (cachedCloudHmacSecret && Date.now() - cachedCloudHmacSecret.fetchedAt < 30_000) {
    return cachedCloudHmacSecret.secret;
  }

  const loaded = await loadEdgeDocWithMeta<{ secret?: string }>(env, 'echox:security_hmac_secret');
  if (loaded.ok && loaded.data?.secret && loaded.data.secret.length >= 16) {
    cachedCloudHmacSecret = { secret: loaded.data.secret, fetchedAt: Date.now() };
    return loaded.data.secret;
  }
  return null;
}

export function parseEdgeCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = request.headers.get('cookie') || '';
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (name) {
      try {
        out[name] = decodeURIComponent(val);
      } catch {
        out[name] = val;
      }
    }
  }
  return out;
}

export function extractEdgeSessionToken(request: Request): string {
  const cookies = parseEdgeCookies(request);
  if (cookies['__session']) return cookies['__session'];
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

export interface VerifiedEdgeSession {
  sessionId: string;
  email: string;
  owner: boolean;
  codeVerified: boolean;
  issuedAt: number;
  expiresAt: number;
}

const CLOUD_REVOKED_SESSIONS_KEY = 'echox:security_revoked_sessions';

export function isAllowedEdgeOrigin(origin: string, env: EdgeEnv): boolean {
  if (!origin) return false;
  if (
    origin === 'https://echoxstore.pages.dev' ||
    origin === 'https://echox-store.onrender.com' ||
    origin === 'https://niapolor.pages.dev' ||
    origin === 'https://niapolor.com' ||
    origin === 'https://www.niapolor.com' ||
    origin === 'https://niapolor.tn' ||
    origin === 'https://www.niapolor.tn' ||
    (env.SITE_URL && origin === env.SITE_URL.trim().replace(/\/$/, '')) ||
    (env.VITE_SITE_URL && origin === env.VITE_SITE_URL.trim().replace(/\/$/, '')) ||
    (env.CORS_ORIGIN && origin === env.CORS_ORIGIN.trim().replace(/\/$/, ''))
  ) {
    return true;
  }
  try {
    const u = new URL(origin);
    if (
      u.protocol === 'https:' &&
      (/^([a-z0-9-]+\.)*echox[a-z0-9-]*\.pages\.dev$/i.test(u.hostname) ||
        /^([a-z0-9-]+\.)*niapolor[a-z0-9-]*\.pages\.dev$/i.test(u.hostname))
    ) {
      return true;
    }
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function isEdgeSessionRevoked(env: EdgeEnv, sessionId: string): Promise<boolean> {
  if (!sessionId) return true;
  const loaded = await loadEdgeDocWithMeta<{ revoked?: Record<string, number> }>(
    env,
    CLOUD_REVOKED_SESSIONS_KEY
  );
  if (!loaded.ok || !loaded.data?.revoked) return false;
  const exp = loaded.data.revoked[sessionId];
  return typeof exp === 'number' && exp > Date.now();
}

export async function revokeEdgeSessionId(
  env: EdgeEnv,
  sessionId: string,
  expiresAtMs?: number
): Promise<boolean> {
  if (!sessionId) return false;
  const now = Date.now();
  const exp = typeof expiresAtMs === 'number' && expiresAtMs > now ? expiresAtMs : now + 6 * 24 * 3600 * 1000;
  const mut = await mutateEdgeDocWithRetry<{ revoked: Record<string, number>; updatedAt: string }, boolean>(
    env,
    CLOUD_REVOKED_SESSIONS_KEY,
    async (raw) => {
      const nextRevoked: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw?.revoked || {})) {
        if (typeof v === 'number' && v > now) nextRevoked[k] = v;
      }
      nextRevoked[sessionId] = exp;
      return {
        nextDoc: { revoked: nextRevoked, updatedAt: new Date().toISOString() },
        result: true,
      };
    }
  );
  return mut.ok;
}

export async function computeEdgeSessionHint(sessionId: string): Promise<string> {
  const digest = await sha256Hex(sessionId || 'anon');
  return digest.slice(0, 12);
}

export async function issueEdgeCsrfToken(env: EdgeEnv, sessionId: string): Promise<string | null> {
  const secret = await resolveSharedHmacSecret(env);
  if (!secret) return null;
  const nonce = randomHex(12);
  const exp = Date.now() + 5 * 24 * 60 * 60 * 1000;
  const sidHint = await computeEdgeSessionHint(sessionId);
  const payload = `csrf1.${nonce}.${exp}.${sidHint}`;
  const sig = await hmacSha256Hex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyEdgeCsrfToken(
  token: string,
  env: EdgeEnv,
  expectedSessionId: string
): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const parts = token.trim().split('.');
  if (parts.length !== 5 || parts[0] !== 'csrf1') return false;
  const [ver, nonce, expStr, sidHint, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expectedHint = await computeEdgeSessionHint(expectedSessionId);
  if (sidHint !== expectedHint) return false;
  const secret = await resolveSharedHmacSecret(env);
  if (!secret) return false;
  const payload = `${ver}.${nonce}.${expStr}.${sidHint}`;
  const expected = await hmacSha256Hex(secret, payload);
  return timingSafeEqualHex(sig, expected);
}

export async function verifyEdgeOwnerSession(
  request: Request,
  env: EdgeEnv
): Promise<VerifiedEdgeSession | null> {
  const token = extractEdgeSessionToken(request);
  if (!token || !token.includes('.')) return null;

  const parts = token.split('.');
  if (parts.length !== 6 || parts[0] !== 'v2') {
    return null;
  }

  const [ver, sessionId, iatStr, expStr, cvStr, hmac] = parts;
  const issuedAt = Number(iatStr);
  const expiresAt = Number(expStr);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }

  const secret = await resolveSharedHmacSecret(env);
  if (!secret) return null;

  const payload = `${ver}.${sessionId}.${iatStr}.${expStr}.${cvStr}`;
  const expected = await hmacSha256Hex(secret, payload);
  if (!timingSafeEqualHex(hmac, expected)) {
    return null;
  }

  if (await isEdgeSessionRevoked(env, sessionId)) {
    return null;
  }

  const secCfg = await loadEdgeDocWithMeta<{ min_session_valid_after?: number }>(
    env,
    'echox:central_security_config'
  );
  const minValidAfter = secCfg.data?.min_session_valid_after || 0;
  if (issuedAt < minValidAfter) {
    return null;
  }

  const ownerEmail = (env.ECHOX_OWNER_EMAIL || DEFAULT_OWNER_EMAIL).trim().toLowerCase();
  return {
    sessionId,
    email: ownerEmail,
    owner: true,
    codeVerified: cvStr === '1',
    issuedAt,
    expiresAt,
  };
}

export async function requireEdgeAdminAuth(
  request: Request,
  env: EdgeEnv
): Promise<{ ok: true; session: VerifiedEdgeSession } | { ok: false; response: Response }> {
  const session = await verifyEdgeOwnerSession(request, env);
  if (!session) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'وصول مرفوض: جلسة مركز التحكم مطلوبة أو منتهية.' },
        401
      ),
    };
  }
  if (!session.owner || !session.codeVerified) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'وصول غير مصرح به: صلاحيات مركز التحكم مطلوبة.' },
        403
      ),
    };
  }

  const method = request.method.toUpperCase();
  const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  if (isMutating) {
    const reqOrigin = request.headers.get('origin') || '';
    const reqHost = request.headers.get('host') || new URL(request.url).host;
    if (reqOrigin && !isAllowedEdgeOrigin(reqOrigin, env)) {
      let sameHost = false;
      try {
        sameHost = new URL(reqOrigin).host === reqHost;
      } catch {
        sameHost = false;
      }
      if (!sameHost) {
        return {
          ok: false,
          response: jsonResponse({ error: 'حماية CSRF: مصدر الطلب غير مسموح به.' }, 403),
        };
      }
    }

    const csrfHeader = request.headers.get('x-csrf-token') || '';
    const cookies = parseEdgeCookies(request);
    const csrfCookie = cookies['echox_csrf'];
    const cookieMismatch = Boolean(csrfCookie && csrfCookie !== csrfHeader);
    const csrfValid = await verifyEdgeCsrfToken(csrfHeader, env, session.sessionId);
    if (!csrfValid || cookieMismatch) {
      return {
        ok: false,
        response: jsonResponse(
          { error: 'رمز الحماية CSRF مفقود أو غير صالح — يرجى تجديد الجلسة.' },
          403
        ),
      };
    }
  }

  return { ok: true, session };
}

function isPlausibleIpLiteral(raw: string): boolean {
  if (!raw) return false;
  const cleaned = raw.replace(/^::ffff:/i, '').trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned)) {
    return cleaned.split('.').every((p) => {
      const n = Number(p);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }
  return cleaned.includes(':') && /^[0-9a-f:]{2,45}$/i.test(cleaned);
}

export function getEdgeClientIp(request: Request): string {
  const cfIp = (request.headers.get('cf-connecting-ip') || '').trim();
  if (isPlausibleIpLiteral(cfIp)) return cfIp;
  const fwd = request.headers.get('x-forwarded-for') || '';
  const first = fwd.split(',')[0]?.trim() || '';
  if (isPlausibleIpLiteral(first)) return first;
  return '127.0.0.1';
}

export function getEdgeRequestOrigin(request: Request, env: EdgeEnv): string {
  const hostHeader = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const protoHeader = request.headers.get('x-forwarded-proto') || 'https';
  const proto = protoHeader.split(',')[0].trim();
  if (
    hostHeader &&
    !hostHeader.includes('localhost') &&
    !hostHeader.includes('127.0.0.1') &&
    !hostHeader.includes('0.0.0.0')
  ) {
    return `${proto}://${hostHeader}`.replace(/\/$/, '');
  }
  const configured = (env.SITE_URL || env.VITE_SITE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  try {
    return new URL(request.url).origin;
  } catch {
    return 'https://echoxstore.pages.dev';
  }
}

const edgeRateBuckets = new Map<string, { attempts: number; windowStart: number }>();

export function checkEdgeSlidingWindowLimit(
  namespace: string,
  ip: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const key = `${namespace}:${ip}`;
  const now = Date.now();
  let bucket = edgeRateBuckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    bucket = { attempts: 0, windowStart: now };
    edgeRateBuckets.set(key, bucket);
  }
  bucket.attempts += 1;
  if (bucket.attempts > maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000)),
    };
  }
  if (edgeRateBuckets.size > 1000) {
    for (const [k, v] of edgeRateBuckets.entries()) {
      if (now - v.windowStart > windowMs) edgeRateBuckets.delete(k);
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    ...(extraHeaders || {}),
  };
  return new Response(JSON.stringify(data), { status, headers });
}
