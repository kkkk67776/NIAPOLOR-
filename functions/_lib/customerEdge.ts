import {
  isValidDelegationForGovernorate,
  isValidGovernorate,
  normalizeTunisianPhone,
} from '../../src/data/governorates';
import {
  AuthLang,
  containsDangerousHtml,
  getCustomerAuthMessage,
  isValidCustomerEmail,
  mapPasswordReasonToMsgKey,
  resolveCustomerLang,
  validateCustomerPasswordStrength,
} from '../../src/lib/customerAuthMessages';
import type { CustomerAddress, CustomerUser, Order } from '../../src/types/index';
import {
  checkEdgeSlidingWindowLimit,
  EdgeEnv,
  getEdgeClientIp,
  hmacSha256Hex,
  isAllowedEdgeOrigin,
  jsonResponse,
  loadEdgeDocWithMeta,
  mutateEdgeDocWithRetry,
  parseEdgeCookies,
  randomHex,
  resolveSharedHmacSecret,
  timingSafeEqualHex,
} from './firestoreEdge';

interface StoredCustomerRecord {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  passwordHash: string;
  addresses: CustomerAddress[];
  wishlist: string[];
  createdAt: string;
  updatedAt: string;
}

interface CustomerAccountsDatabase {
  customers: StoredCustomerRecord[];
  revokedSessionIds?: Record<string, number>;
  updatedAt: string;
}

function pruneEdgeRevokedSessions(raw?: Record<string, number>): Record<string, number> {
  const now = Date.now();
  const next: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return next;
  for (const [sid, exp] of Object.entries(raw)) {
    if (typeof sid === 'string' && sid && typeof exp === 'number' && Number.isFinite(exp) && exp > now) {
      next[sid] = exp;
    }
  }
  return next;
}

const CLOUD_CUSTOMER_KEY = 'echox:customer_accounts';
const CLOUD_PAYMENT_KEY = 'echox:payment_system_data';
const PBKDF2_ITERATIONS = 120000;
const CUSTOMER_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function resolveOrCreateEdgeHmacSecret(env: EdgeEnv): Promise<string | null> {
  return resolveSharedHmacSecret(env);
}

async function hashEdgeCustomerPassword(password: string): Promise<string> {
  const saltHex = randomHex(16);
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${saltHex}$${bytesToHex(new Uint8Array(derivedBits))}`;
}

async function verifyEdgeCustomerPassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const hashHex = parts[3];
  if (
    !Number.isFinite(iterations) ||
    iterations < 10000 ||
    !/^[a-f0-9]+$/i.test(saltHex) ||
    !/^[a-f0-9]+$/i.test(hashHex)
  ) {
    return false;
  }
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex) as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  const derivedHex = bytesToHex(new Uint8Array(derivedBits));
  return timingSafeEqualHex(derivedHex, hashHex.toLowerCase());
}

function toPublicCustomerUser(rec: StoredCustomerRecord): CustomerUser {
  return {
    id: rec.id,
    fullName: rec.fullName,
    email: rec.email,
    phone: rec.phone,
    addresses: Array.isArray(rec.addresses) ? rec.addresses : [],
    wishlist: Array.isArray(rec.wishlist) ? rec.wishlist : [],
  };
}

function normalizePhoneDigits(phone: string): string {
  return (phone || '').replace(/\D/g, '').slice(-8);
}

function extractEdgeLang(request: Request, bodyLang?: unknown): AuthLang {
  const url = new URL(request.url);
  return resolveCustomerLang(
    bodyLang ?? url.searchParams.get('lang'),
    request.headers.get('accept-language')
  );
}

function checkEdgeIdorTampering(
  request: Request,
  sessionCustomerId: string,
  lang: AuthLang,
  bodyCustomerId?: unknown
): Response | null {
  const url = new URL(request.url);
  const queryId = (url.searchParams.get('customerId') || '').trim();
  const bId = typeof bodyCustomerId === 'string' ? bodyCustomerId.trim() : '';
  const supplied = queryId || bId;
  if (supplied && supplied !== sessionCustomerId) {
    return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'forbiddenIdor') }, 403);
  }
  return null;
}

function buildEdgeCustomerCookie(request: Request, value: string, maxAgeSeconds: number): string {
  const url = new URL(request.url);
  const isHttps =
    url.protocol === 'https:' || (request.headers.get('x-forwarded-proto') || '').includes('https');
  const host = (request.headers.get('host') || url.hostname || '').toLowerCase();
  const isPreview = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/i.test(host);
  const sameSite = isHttps && isPreview ? 'None' : 'Lax';
  const secureFlag = isHttps || sameSite === 'None' ? '; Secure' : '';
  return `__customer_session=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=${sameSite}; HttpOnly${secureFlag}`;
}

export async function signEdgeCustomerSession(customerId: string, env: EdgeEnv): Promise<string | null> {
  const secret = await resolveOrCreateEdgeHmacSecret(env);
  if (!secret) return null;
  const sessionId = randomHex(16);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + CUSTOMER_SESSION_TTL_MS;
  const payload = `cust1.${customerId}.${sessionId}.${issuedAt}.${expiresAt}`;
  const sig = await hmacSha256Hex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyEdgeCustomerSession(
  request: Request,
  env: EdgeEnv
): Promise<{ customerId: string; sessionId: string; expiresAt: number } | null> {
  const cookies = parseEdgeCookies(request);
  const raw = cookies['__customer_session'];
  if (!raw) return null;
  const parts = raw.trim().split('.');
  if (parts.length !== 6 || parts[0] !== 'cust1') return null;
  const [ver, customerId, sessionId, iatStr, expStr, hmac] = parts;
  if (!customerId || !sessionId || !hmac) return null;
  const secret = await resolveSharedHmacSecret(env);
  if (!secret) return null;
  const payload = `${ver}.${customerId}.${sessionId}.${iatStr}.${expStr}`;
  const expected = await hmacSha256Hex(secret, payload);
  if (!timingSafeEqualHex(hmac, expected)) return null;
  const issuedAt = Number(iatStr);
  const expiresAt = Number(expStr);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }
  const loaded = await loadEdgeDocWithMeta<Partial<CustomerAccountsDatabase>>(env, CLOUD_CUSTOMER_KEY);
  if (loaded.ok && loaded.data?.revokedSessionIds) {
    const revExp = loaded.data.revokedSessionIds[sessionId];
    if (typeof revExp === 'number' && revExp > Date.now()) {
      return null;
    }
  }
  return { customerId, sessionId, expiresAt };
}

function verifyEdgeCustomerMutationSecurity(request: Request, env: EdgeEnv, lang: AuthLang): Response | null {
  const reqOrigin = (request.headers.get('origin') || '').trim();
  if (reqOrigin && !isAllowedEdgeOrigin(reqOrigin, env)) {
    return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'csrfOriginDenied') }, 403);
  }
  if (!reqOrigin) {
    const reqReferer = (request.headers.get('referer') || '').trim();
    if (reqReferer && !isAllowedEdgeOrigin(reqReferer, env)) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'csrfOriginDenied') }, 403);
    }
  }
  const xrw = (request.headers.get('x-requested-with') || '').trim();
  if (xrw !== 'NIAPOLOR-Customer') {
    return jsonResponse(
      { success: false, error: getCustomerAuthMessage(lang, 'csrfHeaderMissing') },
      403
    );
  }
  return null;
}

function mergeCustomerDb(raw: Partial<CustomerAccountsDatabase> | null): CustomerAccountsDatabase {
  return {
    customers: Array.isArray(raw?.customers) ? raw!.customers : [],
    revokedSessionIds: pruneEdgeRevokedSessions(raw?.revokedSessionIds),
    updatedAt: typeof raw?.updatedAt === 'string' ? raw!.updatedAt : new Date().toISOString(),
  };
}

export async function getEdgeCustomerById(env: EdgeEnv, customerId: string): Promise<CustomerUser | null> {
  const loaded = await loadEdgeDocWithMeta<Partial<CustomerAccountsDatabase>>(env, CLOUD_CUSTOMER_KEY);
  const db = mergeCustomerDb(loaded.data);
  const found = db.customers.find((c) => c.id === customerId);
  return found ? toPublicCustomerUser(found) : null;
}

export async function handleEdgeCustomerRoute(
  request: Request,
  env: EdgeEnv,
  pathname: string
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  if (method === 'POST' && pathname === '/api/customer/register') {
    const body = (await request.json().catch(() => ({}))) as {
      fullName?: string;
      email?: string;
      phone?: string;
      password?: string;
      confirmPassword?: unknown;
      lang?: string;
    };
    const lang = extractEdgeLang(request, body.lang);
    const secErr = verifyEdgeCustomerMutationSecurity(request, env, lang);
    if (secErr) return secErr;

    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('custRegister', ip, 10, 15 * 60_000);
    if (!rate.allowed) {
      return jsonResponse(
        { success: false, error: getCustomerAuthMessage(lang, 'rateLimitRegister') },
        429
      );
    }

    const fullName = String(body.fullName || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().toLowerCase();
    const phoneCheck = normalizeTunisianPhone(String(body.phone || ''));
    const password = String(body.password || '');

    if (!fullName || fullName.length < 3 || containsDangerousHtml(fullName)) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'invalidFullName') }, 400);
    }
    if (!isValidCustomerEmail(email)) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'invalidEmail') }, 400);
    }
    if (!phoneCheck.valid) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'invalidPhone') }, 400);
    }
    const pwdCheck = validateCustomerPasswordStrength(password, body.confirmPassword);
    if (!pwdCheck.valid) {
      return jsonResponse(
        { success: false, error: getCustomerAuthMessage(lang, mapPasswordReasonToMsgKey(pwdCheck.reason)) },
        400
      );
    }

    const newPhoneDigits = normalizePhoneDigits(phoneCheck.normalized);
    const passwordHash = await hashEdgeCustomerPassword(password);
    const mut = await mutateEdgeDocWithRetry<
      CustomerAccountsDatabase,
      { conflictKey?: 'duplicateEmail' | 'duplicatePhone'; customer?: CustomerUser }
    >(env, CLOUD_CUSTOMER_KEY, async (raw) => {
      const db = mergeCustomerDb(raw);
      if (db.customers.some((c) => c.email.toLowerCase() === email)) {
        return { skipWrite: true, result: { conflictKey: 'duplicateEmail' } };
      }
      if (db.customers.some((c) => normalizePhoneDigits(c.phone) === newPhoneDigits)) {
        return { skipWrite: true, result: { conflictKey: 'duplicatePhone' } };
      }
      const now = new Date().toISOString();
      const record: StoredCustomerRecord = {
        id: `cust_${randomHex(8)}`,
        fullName,
        email,
        phone: phoneCheck.normalized,
        passwordHash,
        addresses: [],
        wishlist: [],
        createdAt: now,
        updatedAt: now,
      };
      return {
        nextDoc: {
          customers: [record, ...db.customers],
          revokedSessionIds: db.revokedSessionIds,
          updatedAt: now,
        },
        result: { customer: toPublicCustomerUser(record) },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'dbSaveFailed') }, mut.statusCode || 503);
    if (mut.result?.conflictKey) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, mut.result.conflictKey) }, 409);
    }
    if (!mut.result?.customer) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'dbSaveFailed') }, 503);
    }

    const cookieVal = await signEdgeCustomerSession(mut.result.customer.id, env);
    if (!cookieVal) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'sessionSignFailed') }, 503);
    }
    return jsonResponse({ success: true, customer: mut.result.customer }, 201, {
      'Set-Cookie': buildEdgeCustomerCookie(request, cookieVal, 14 * 24 * 3600),
      'Cache-Control': 'no-store',
    });
  }

  if (method === 'POST' && pathname === '/api/customer/login') {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      lang?: string;
    };
    const lang = extractEdgeLang(request, body.lang);
    const secErr = verifyEdgeCustomerMutationSecurity(request, env, lang);
    if (secErr) return secErr;

    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('custLogin', ip, 10, 5 * 60_000);
    if (!rate.allowed) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'rateLimitLogin') }, 429);
    }

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!isValidCustomerEmail(email) || !password) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredFields') }, 400);
    }

    const emailRate = checkEdgeSlidingWindowLimit('custLoginEmail', email, 8, 5 * 60_000);
    if (!emailRate.allowed) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'rateLimitLogin') }, 429);
    }

    const loaded = await loadEdgeDocWithMeta<Partial<CustomerAccountsDatabase>>(env, CLOUD_CUSTOMER_KEY);
    if (!loaded.ok) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'dbReadFailed') }, 503);
    }
    const db = mergeCustomerDb(loaded.data);
    const found = db.customers.find((c) => c.email.toLowerCase() === email);
    if (!found || !(await verifyEdgeCustomerPassword(password, found.passwordHash))) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'invalidCredentials') }, 401);
    }

    const customer = toPublicCustomerUser(found);
    const cookieVal = await signEdgeCustomerSession(customer.id, env);
    if (!cookieVal) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'sessionSignFailed') }, 503);
    }
    return jsonResponse({ success: true, customer }, 200, {
      'Set-Cookie': buildEdgeCustomerCookie(request, cookieVal, 14 * 24 * 3600),
      'Cache-Control': 'no-store',
    });
  }

  if (method === 'POST' && pathname === '/api/customer/logout') {
    const lang = extractEdgeLang(request);
    const secErr = verifyEdgeCustomerMutationSecurity(request, env, lang);
    if (secErr) return secErr;
    const sess = await verifyEdgeCustomerSession(request, env);
    if (sess) {
      await mutateEdgeDocWithRetry<CustomerAccountsDatabase, boolean>(env, CLOUD_CUSTOMER_KEY, async (raw) => {
        const db = mergeCustomerDb(raw);
        const pruned = pruneEdgeRevokedSessions(db.revokedSessionIds);
        pruned[sess.sessionId] = sess.expiresAt;
        return {
          nextDoc: {
            customers: db.customers,
            revokedSessionIds: pruned,
            updatedAt: new Date().toISOString(),
          },
          result: true,
        };
      }).catch(() => {});
    }
    return jsonResponse({ success: true }, 200, {
      'Set-Cookie': buildEdgeCustomerCookie(request, '', 0),
      'Cache-Control': 'no-store',
    });
  }

  if (method === 'GET' && pathname === '/api/customer/me') {
    const lang = extractEdgeLang(request);
    const sess = await verifyEdgeCustomerSession(request, env);
    if (!sess) {
      return jsonResponse({ success: false, authenticated: false, customer: null }, 401, {
        'Cache-Control': 'no-store',
      });
    }
    const idorErr = checkEdgeIdorTampering(request, sess.customerId, lang);
    if (idorErr) return idorErr;
    const customer = await getEdgeCustomerById(env, sess.customerId);
    if (!customer) {
      return jsonResponse({ success: false, authenticated: false, customer: null }, 401, {
        'Cache-Control': 'no-store',
      });
    }
    return jsonResponse({ success: true, authenticated: true, customer }, 200, {
      'Cache-Control': 'no-store',
    });
  }

  if (method === 'GET' && pathname === '/api/customer/profile') {
    const lang = extractEdgeLang(request);
    const sess = await verifyEdgeCustomerSession(request, env);
    if (!sess) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredProfile') }, 401);
    }
    const idorErr = checkEdgeIdorTampering(request, sess.customerId, lang);
    if (idorErr) return idorErr;
    const customer = await getEdgeCustomerById(env, sess.customerId);
    if (!customer) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'accountNotFound') }, 401);
    }
    return jsonResponse({ success: true, customer }, 200, { 'Cache-Control': 'no-store' });
  }

  if (method === 'PATCH' && pathname === '/api/customer/profile') {
    const body = (await request.json().catch(() => ({}))) as {
      fullName?: string;
      phone?: string;
      customerId?: string;
      lang?: string;
    };
    const lang = extractEdgeLang(request, body.lang);
    const secErr = verifyEdgeCustomerMutationSecurity(request, env, lang);
    if (secErr) return secErr;
    const sess = await verifyEdgeCustomerSession(request, env);
    if (!sess) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredProfile') }, 401);
    }
    const idorErr = checkEdgeIdorTampering(request, sess.customerId, lang, body.customerId);
    if (idorErr) return idorErr;

    const mut = await mutateEdgeDocWithRetry<
      CustomerAccountsDatabase,
      { errStatus?: number; errMsg?: string; customer?: CustomerUser }
    >(env, CLOUD_CUSTOMER_KEY, async (raw) => {
      const db = mergeCustomerDb(raw);
      const idx = db.customers.findIndex((c) => c.id === sess.customerId);
      if (idx === -1) {
        return { skipWrite: true, result: { errStatus: 404, errMsg: getCustomerAuthMessage(lang, 'accountNotFound') } };
      }
      const existing = db.customers[idx];
      const fullName =
        body.fullName !== undefined ? String(body.fullName || '').trim().slice(0, 100) : existing.fullName;
      if (!fullName || fullName.length < 3 || containsDangerousHtml(fullName)) {
        return { skipWrite: true, result: { errStatus: 400, errMsg: getCustomerAuthMessage(lang, 'invalidFullName') } };
      }

      let nextPhone = existing.phone;
      if (body.phone !== undefined) {
        const phoneCheck = normalizeTunisianPhone(String(body.phone || ''));
        if (!phoneCheck.valid) {
          return { skipWrite: true, result: { errStatus: 400, errMsg: getCustomerAuthMessage(lang, 'invalidPhone') } };
        }
        const digits = normalizePhoneDigits(phoneCheck.normalized);
        if (db.customers.some((c) => c.id !== sess.customerId && normalizePhoneDigits(c.phone) === digits)) {
          return { skipWrite: true, result: { errStatus: 409, errMsg: getCustomerAuthMessage(lang, 'duplicatePhone') } };
        }
        nextPhone = phoneCheck.normalized;
      }

      const now = new Date().toISOString();
      const updatedCustomer: StoredCustomerRecord = {
        ...existing,
        fullName,
        phone: nextPhone,
        updatedAt: now,
      };
      return {
        nextDoc: {
          customers: db.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
          revokedSessionIds: db.revokedSessionIds,
          updatedAt: now,
        },
        result: { customer: toPublicCustomerUser(updatedCustomer) },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'dbSaveFailed') }, mut.statusCode || 503);
    if (mut.result?.errMsg) {
      return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);
    }
    return jsonResponse({ success: true, customer: mut.result?.customer });
  }

  if (method === 'PUT' && pathname === '/api/customer/wishlist') {
    const body = (await request.json().catch(() => ({}))) as {
      wishlist?: unknown;
      customerId?: string;
      lang?: string;
    };
    const lang = extractEdgeLang(request, body.lang);
    const secErr = verifyEdgeCustomerMutationSecurity(request, env, lang);
    if (secErr) return secErr;
    const sess = await verifyEdgeCustomerSession(request, env);
    if (!sess) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredWishlist') }, 401);
    }
    const idorErr = checkEdgeIdorTampering(request, sess.customerId, lang, body.customerId);
    if (idorErr) return idorErr;
    if (!Array.isArray(body.wishlist)) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'invalidWishlistPayload') }, 400);
    }

    const sanitizedWishlist = Array.from(
      new Set(
        body.wishlist
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter((id) => id.length > 0 && id.length <= 80 && !containsDangerousHtml(id))
      )
    ).slice(0, 100);

    const mut = await mutateEdgeDocWithRetry<
      CustomerAccountsDatabase,
      { errStatus?: number; errMsg?: string; customer?: CustomerUser }
    >(env, CLOUD_CUSTOMER_KEY, async (raw) => {
      const db = mergeCustomerDb(raw);
      const idx = db.customers.findIndex((c) => c.id === sess.customerId);
      if (idx === -1) {
        return { skipWrite: true, result: { errStatus: 404, errMsg: getCustomerAuthMessage(lang, 'accountNotFound') } };
      }
      const existing = db.customers[idx];
      const now = new Date().toISOString();
      const updatedCustomer: StoredCustomerRecord = {
        ...existing,
        wishlist: sanitizedWishlist,
        updatedAt: now,
      };
      return {
        nextDoc: {
          customers: db.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
          revokedSessionIds: db.revokedSessionIds,
          updatedAt: now,
        },
        result: { customer: toPublicCustomerUser(updatedCustomer) },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'dbSaveFailed') }, mut.statusCode || 503);
    if (mut.result?.errMsg) {
      return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);
    }
    return jsonResponse({ success: true, customer: mut.result?.customer });
  }

  if (method === 'POST' && pathname === '/api/customer/addresses') {
    const body = (await request.json().catch(() => ({}))) as {
      fullName?: string;
      phone?: string;
      governorate?: string;
      delegation?: string;
      city?: string;
      street?: string;
      notes?: string;
      isDefault?: boolean;
      customerId?: string;
      lang?: string;
    };
    const lang = extractEdgeLang(request, body.lang);
    const secErr = verifyEdgeCustomerMutationSecurity(request, env, lang);
    if (secErr) return secErr;
    const sess = await verifyEdgeCustomerSession(request, env);
    if (!sess) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredAddresses') }, 401);
    }
    const idorErr = checkEdgeIdorTampering(request, sess.customerId, lang, body.customerId);
    if (idorErr) return idorErr;

    const mut = await mutateEdgeDocWithRetry<
      CustomerAccountsDatabase,
      { errStatus?: number; errMsg?: string; customer?: CustomerUser }
    >(env, CLOUD_CUSTOMER_KEY, async (raw) => {
      const db = mergeCustomerDb(raw);
      const idx = db.customers.findIndex((c) => c.id === sess.customerId);
      if (idx === -1) {
        return { skipWrite: true, result: { errStatus: 404, errMsg: getCustomerAuthMessage(lang, 'accountNotFound') } };
      }
      const existing = db.customers[idx];
      const fullName = String(body.fullName || existing.fullName || '').trim().slice(0, 100);
      const phoneCheck = normalizeTunisianPhone(String(body.phone || existing.phone || ''));
      const governorate = String(body.governorate || '').trim();
      const delegation = String(body.delegation || body.city || '').trim();
      const street = String(body.street || '').trim().slice(0, 240);
      const notes = String(body.notes || '').trim().slice(0, 200);

      if (!fullName || containsDangerousHtml(fullName)) {
        return { skipWrite: true, result: { errStatus: 400, errMsg: getCustomerAuthMessage(lang, 'invalidRecipientName') } };
      }
      if (!phoneCheck.valid) {
        return { skipWrite: true, result: { errStatus: 400, errMsg: getCustomerAuthMessage(lang, 'invalidPhone') } };
      }
      if (!isValidGovernorate(governorate)) {
        return { skipWrite: true, result: { errStatus: 400, errMsg: getCustomerAuthMessage(lang, 'invalidGovernorate') } };
      }
      if (!delegation || !isValidDelegationForGovernorate(governorate, delegation)) {
        return { skipWrite: true, result: { errStatus: 400, errMsg: getCustomerAuthMessage(lang, 'invalidDelegation') } };
      }
      if (!street || street.length < 4 || containsDangerousHtml(street) || containsDangerousHtml(notes)) {
        return { skipWrite: true, result: { errStatus: 400, errMsg: getCustomerAuthMessage(lang, 'invalidStreet') } };
      }

      const shouldDefault = Boolean(body.isDefault) || existing.addresses.length === 0;
      const newAddress: CustomerAddress = {
        id: `addr_${randomHex(6)}`,
        isDefault: shouldDefault,
        fullName,
        phone: phoneCheck.normalized,
        governorate,
        delegation,
        city: delegation,
        street,
        notes: notes || undefined,
      };
      const updatedAddresses = [
        newAddress,
        ...existing.addresses.map((a) => ({
          ...a,
          isDefault: shouldDefault ? false : a.isDefault,
        })),
      ].slice(0, 15);
      const now = new Date().toISOString();
      const updatedCustomer: StoredCustomerRecord = {
        ...existing,
        addresses: updatedAddresses,
        updatedAt: now,
      };
      return {
        nextDoc: {
          customers: db.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
          revokedSessionIds: db.revokedSessionIds,
          updatedAt: now,
        },
        result: { customer: toPublicCustomerUser(updatedCustomer) },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'dbSaveFailed') }, mut.statusCode || 503);
    if (mut.result?.errMsg) {
      return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);
    }
    return jsonResponse({ success: true, customer: mut.result?.customer });
  }

  if (method === 'PATCH' && pathname === '/api/customer/addresses/default') {
    const body = (await request.json().catch(() => ({}))) as {
      addressId?: string;
      customerId?: string;
      lang?: string;
    };
    const lang = extractEdgeLang(request, body.lang);
    const secErr = verifyEdgeCustomerMutationSecurity(request, env, lang);
    if (secErr) return secErr;
    const sess = await verifyEdgeCustomerSession(request, env);
    if (!sess) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredAddresses') }, 401);
    }
    const idorErr = checkEdgeIdorTampering(request, sess.customerId, lang, body.customerId);
    if (idorErr) return idorErr;
    const addressId = String(body.addressId || '').trim();

    const mut = await mutateEdgeDocWithRetry<
      CustomerAccountsDatabase,
      { errStatus?: number; errMsg?: string; customer?: CustomerUser }
    >(env, CLOUD_CUSTOMER_KEY, async (raw) => {
      const db = mergeCustomerDb(raw);
      const idx = db.customers.findIndex((c) => c.id === sess.customerId);
      if (idx === -1) return { skipWrite: true, result: { errStatus: 404, errMsg: getCustomerAuthMessage(lang, 'accountNotFound') } };
      const existing = db.customers[idx];
      if (!existing.addresses.some((a) => a.id === addressId)) {
        return { skipWrite: true, result: { errStatus: 404, errMsg: getCustomerAuthMessage(lang, 'addressNotFound') } };
      }
      const now = new Date().toISOString();
      const updatedCustomer: StoredCustomerRecord = {
        ...existing,
        addresses: existing.addresses.map((a) => ({ ...a, isDefault: a.id === addressId })),
        updatedAt: now,
      };
      return {
        nextDoc: {
          customers: db.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
          revokedSessionIds: db.revokedSessionIds,
          updatedAt: now,
        },
        result: { customer: toPublicCustomerUser(updatedCustomer) },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'dbSaveFailed') }, mut.statusCode || 503);
    if (mut.result?.errMsg) {
      return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);
    }
    return jsonResponse({ success: true, customer: mut.result?.customer });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/customer/addresses/')) {
    const addressId = decodeURIComponent(pathname.slice('/api/customer/addresses/'.length)).trim();
    const lang = extractEdgeLang(request);
    const secErr = verifyEdgeCustomerMutationSecurity(request, env, lang);
    if (secErr) return secErr;
    const sess = await verifyEdgeCustomerSession(request, env);
    if (!sess) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredAddresses') }, 401);
    }
    const idorErr = checkEdgeIdorTampering(request, sess.customerId, lang);
    if (idorErr) return idorErr;

    const mut = await mutateEdgeDocWithRetry<
      CustomerAccountsDatabase,
      { errStatus?: number; errMsg?: string; customer?: CustomerUser }
    >(env, CLOUD_CUSTOMER_KEY, async (raw) => {
      const db = mergeCustomerDb(raw);
      const idx = db.customers.findIndex((c) => c.id === sess.customerId);
      if (idx === -1) return { skipWrite: true, result: { errStatus: 404, errMsg: getCustomerAuthMessage(lang, 'accountNotFound') } };
      const existing = db.customers[idx];
      const target = existing.addresses.find((a) => a.id === addressId);
      if (!target) {
        return { skipWrite: true, result: { errStatus: 404, errMsg: getCustomerAuthMessage(lang, 'addressNotFound') } };
      }
      let remaining = existing.addresses.filter((a) => a.id !== addressId);
      if (target.isDefault && remaining.length > 0 && !remaining.some((a) => a.isDefault)) {
        remaining = remaining.map((a, i) => (i === 0 ? { ...a, isDefault: true } : a));
      }
      const now = new Date().toISOString();
      const updatedCustomer: StoredCustomerRecord = {
        ...existing,
        addresses: remaining,
        updatedAt: now,
      };
      return {
        nextDoc: {
          customers: db.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
          revokedSessionIds: db.revokedSessionIds,
          updatedAt: now,
        },
        result: { customer: toPublicCustomerUser(updatedCustomer) },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'dbSaveFailed') }, mut.statusCode || 503);
    if (mut.result?.errMsg) {
      return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);
    }
    return jsonResponse({ success: true, customer: mut.result?.customer });
  }

  if (method === 'GET' && pathname === '/api/customer/orders') {
    const lang = extractEdgeLang(request);
    const sess = await verifyEdgeCustomerSession(request, env);
    if (!sess) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredOrders') }, 401);
    }
    const idorErr = checkEdgeIdorTampering(request, sess.customerId, lang);
    if (idorErr) return idorErr;
    const customer = await getEdgeCustomerById(env, sess.customerId);
    if (!customer) {
      return jsonResponse({ success: false, error: getCustomerAuthMessage(lang, 'accountNotFound') }, 401);
    }
    const payLoaded = await loadEdgeDocWithMeta<{ orders?: Order[] }>(env, CLOUD_PAYMENT_KEY);
    const allOrders = Array.isArray(payLoaded.data?.orders) ? payLoaded.data!.orders : [];
    const scoped = allOrders
      .filter((o) => Boolean(o.customerId && o.customerId === customer.id))
      .map((o) => {
        const { trackingTokenHash: _h, trackingToken: _t, ...clean } = o;
        return clean;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return jsonResponse({ success: true, orders: scoped }, 200, { 'Cache-Control': 'no-store' });
  }

  return null;
}
