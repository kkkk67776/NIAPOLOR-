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

function parseServiceAccountFromEnv(): ServiceAccountCreds | null {
  const { projectId: fallbackProject } = readAppletFirebaseConfig();

  const rawJsonEnv = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJsonEnv) {
    try {
      const jsonText = rawJsonEnv.startsWith('{')
        ? rawJsonEnv
        : Buffer.from(rawJsonEnv, 'base64').toString('utf-8');
      const parsed = JSON.parse(jsonText) as Record<string, string>;
      if (parsed.client_email && parsed.private_key) {
        return {
          clientEmail: parsed.client_email.trim(),
          privateKey: parsed.private_key.replace(/\\n/g, '\n'),
          projectId: (parsed.project_id || fallbackProject).trim(),
          tokenUri: (parsed.token_uri || 'https://oauth2.googleapis.com/token').trim(),
        };
      }
    } catch (err) {
      lastCloudError = `FIREBASE_SERVICE_ACCOUNT_JSON غير صالح: ${(err as Error)?.message || err}`;
    }
  }

  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim();
  if (clientEmail && privateKey) {
    return {
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
      projectId: fallbackProject,
      tokenUri: 'https://oauth2.googleapis.com/token',
    };
  }

  const credPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (credPath && fs.existsSync(credPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(credPath, 'utf-8')) as Record<string, string>;
      if (parsed.client_email && parsed.private_key) {
        return {
          clientEmail: parsed.client_email.trim(),
          privateKey: parsed.private_key.replace(/\\n/g, '\n'),
          projectId: (parsed.project_id || fallbackProject).trim(),
          tokenUri: (parsed.token_uri || 'https://oauth2.googleapis.com/token').trim(),
        };
      }
    } catch {
      // ignore invalid file
    }
  }

  return null;
}

export function getDataDir(): string {
  const configured = (process.env.DATA_DIR || '').trim();
  const dir = configured ? path.resolve(configured) : process.cwd();
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
      process.env.RENDER_INSTANCE_ID
  );
}

export function getPersistenceStatus(): PersistenceStatus {
  const hasDataDir = Boolean((process.env.DATA_DIR || '').trim());
  const isRender = isRenderRuntime();
  const { projectId, databaseId } = readAppletFirebaseConfig();

  if (isFirestoreServiceAccountEnabled()) {
    return {
      provider: 'firestore',
      storageMode: 'firestore+local-atomic',
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

async function loadFromFirestore<T>(key: string): Promise<T | null> {
  const creds = parseServiceAccountFromEnv();
  if (!creds) return null;
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
    if (res.status === 404) return null;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Firestore read HTTP ${res.status}: ${errText.slice(0, 160)}`);
    }
    const doc = (await res.json()) as {
      fields?: { payloadJson?: { stringValue?: string } };
    };
    const raw = doc?.fields?.payloadJson?.stringValue;
    if (!raw || typeof raw !== 'string') return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[CloudPersistence][Firestore] Notice loading ${key}:`, (err as Error)?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function saveToFirestore(key: string, data: unknown): Promise<{ ok: boolean; error?: string }> {
  const creds = parseServiceAccountFromEnv();
  if (!creds) return { ok: false, error: 'Firestore service account credentials not configured.' };

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
    const url = buildFirestoreDocUrl(creds, key);
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
      throw new Error(`Firestore HTTP ${res.status}: ${errText.slice(0, 180)}`);
    }
    lastCloudWriteAt = nowIso;
    lastCloudError = null;
    return { ok: true };
  } catch (err) {
    const msg = `فشل الحفظ في قاعدة بيانات Firestore: ${(err as Error)?.message || String(err)}`;
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

export async function loadCloudJson<T>(key: string): Promise<T | null> {
  if (isFirestoreServiceAccountEnabled()) {
    return loadFromFirestore<T>(key);
  }
  if (isUpstashEnabled()) {
    return loadFromUpstash<T>(key);
  }
  return null;
}

export async function saveCloudJson(key: string, data: unknown): Promise<{ ok: boolean; error?: string }> {
  if (isFirestoreServiceAccountEnabled()) {
    return saveToFirestore(key, data);
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
