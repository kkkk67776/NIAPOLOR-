import crypto from 'crypto';
import fs from 'fs';
import {
  atomicWriteJsonSync,
  getDataFilePath,
  isCloudPersistenceEnabled,
  loadCloudJson,
  loadCloudJsonWithMeta,
  saveCloudJson,
  savePersistentJson,
} from './cloudPersistence';
import {
  isValidDelegationForGovernorate,
  isValidGovernorate,
  normalizeTunisianPhone,
} from '../src/data/governorates';
import {
  AuthLang,
  containsDangerousHtml,
  getCustomerAuthMessage,
  isValidCustomerEmail,
  mapPasswordReasonToMsgKey,
  validateCustomerPasswordStrength,
} from '../src/lib/customerAuthMessages';
import type { CustomerAddress, CustomerUser } from '../src/types/index';

export interface StoredCustomerRecord {
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

const CUSTOMER_ACCOUNTS_FILE = getDataFilePath('customer_accounts.json');
const CLOUD_CUSTOMER_KEY = 'echox:customer_accounts';
const PBKDF2_ITERATIONS = 120000;
const CUSTOMER_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
// Precomputed dummy salt/hash so non-existent email logins take comparable PBKDF2 time
const DUMMY_PBKDF2_SALT = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');

function phoneDigits8(phone: string): string {
  return String(phone || '').replace(/\D/g, '').slice(-8);
}

function pruneRevokedSessions(raw?: Record<string, number>): Record<string, number> {
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

function createEmptyDb(): CustomerAccountsDatabase {
  return {
    customers: [],
    revokedSessionIds: {},
    updatedAt: new Date(0).toISOString(),
  };
}

function loadCustomerDb(): CustomerAccountsDatabase {
  try {
    if (fs.existsSync(CUSTOMER_ACCOUNTS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CUSTOMER_ACCOUNTS_FILE, 'utf-8')) as Partial<CustomerAccountsDatabase>;
      if (parsed && Array.isArray(parsed.customers)) {
        return {
          customers: parsed.customers,
          revokedSessionIds: pruneRevokedSessions(parsed.revokedSessionIds),
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        };
      }
    }
  } catch (err) {
    console.warn('[CustomerEngine] Notice loading customer accounts:', err);
  }
  const initial = createEmptyDb();
  try {
    atomicWriteJsonSync(CUSTOMER_ACCOUNTS_FILE, initial);
  } catch {}
  return initial;
}

let customerDb: CustomerAccountsDatabase = loadCustomerDb();
const memoryRevokedCustomerSessions = new Map<string, number>();
for (const [sid, exp] of Object.entries(customerDb.revokedSessionIds || {})) {
  memoryRevokedCustomerSessions.set(sid, exp);
}
let lastCustomerSyncAt = 0;

// In-process async mutex queue so concurrent writes never lose updates
let dbWriteQueue: Promise<void> = Promise.resolve();

function withCustomerDbLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = dbWriteQueue.then(fn, fn);
  dbWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function mergeRemoteIntoMemory(remote: Partial<CustomerAccountsDatabase>): CustomerAccountsDatabase {
  const mergedRevoked = {
    ...pruneRevokedSessions(customerDb.revokedSessionIds),
    ...pruneRevokedSessions(remote.revokedSessionIds),
  };
  for (const [sid, exp] of Object.entries(mergedRevoked)) {
    memoryRevokedCustomerSessions.set(sid, exp);
  }
  const merged: CustomerAccountsDatabase = {
    customers: Array.isArray(remote.customers) ? remote.customers : [],
    revokedSessionIds: mergedRevoked,
    updatedAt: typeof remote.updatedAt === 'string' ? remote.updatedAt : new Date().toISOString(),
  };
  customerDb = merged;
  try {
    atomicWriteJsonSync(CUSTOMER_ACCOUNTS_FILE, merged);
  } catch {}
  return merged;
}

async function persistCustomerDb(
  next: CustomerAccountsDatabase,
  expectedUpdateTime?: string
) {
  return savePersistentJson(CLOUD_CUSTOMER_KEY, CUSTOMER_ACCOUNTS_FILE, next, {
    allowEphemeral: process.env.NODE_ENV !== 'production',
    expectedUpdateTime,
  });
}

async function mutateCustomerDbSerialized<R>(
  lang: AuthLang,
  mutator: (current: CustomerAccountsDatabase) => Promise<{
    skipWrite?: boolean;
    nextDb?: CustomerAccountsDatabase;
    result: R;
  }>
): Promise<{ ok: boolean; statusCode?: number; error?: string; result?: R }> {
  return withCustomerDbLock(async () => {
    const cloudActive = isCloudPersistenceEnabled();
    const maxAttempts = cloudActive ? 4 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let currentSnapshot = customerDb;
      let expectedUpdateTime: string | undefined;

      if (cloudActive) {
        const meta = await loadCloudJsonWithMeta<Partial<CustomerAccountsDatabase>>(CLOUD_CUSTOMER_KEY);
        if (meta.data && Array.isArray(meta.data.customers)) {
          currentSnapshot = mergeRemoteIntoMemory(meta.data);
          expectedUpdateTime = meta.updateTime;
        }
        lastCustomerSyncAt = Date.now();
      }

      const plan = await mutator({
        customers: currentSnapshot.customers,
        revokedSessionIds: pruneRevokedSessions(currentSnapshot.revokedSessionIds),
        updatedAt: currentSnapshot.updatedAt,
      });

      if (plan.skipWrite || !plan.nextDb) {
        return { ok: true, result: plan.result };
      }

      const persisted = await persistCustomerDb(plan.nextDb, expectedUpdateTime);
      if (persisted.ok) {
        customerDb = plan.nextDb;
        for (const [sid, exp] of Object.entries(plan.nextDb.revokedSessionIds || {})) {
          memoryRevokedCustomerSessions.set(sid, exp);
        }
        lastCustomerSyncAt = Date.now();
        return { ok: true, result: plan.result };
      }

      if (persisted.conflict && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 40 * attempt));
        continue;
      }

      return {
        ok: false,
        statusCode: 503,
        error: getCustomerAuthMessage(lang, 'dbSaveFailed'),
      };
    }

    return {
      ok: false,
      statusCode: 503,
      error: getCustomerAuthMessage(lang, 'dbSaveFailed'),
    };
  });
}

export async function hydrateCustomerAccountsFromCloud(): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  const remote = await loadCloudJson<Partial<CustomerAccountsDatabase>>(CLOUD_CUSTOMER_KEY);
  lastCustomerSyncAt = Date.now();
  if (remote && Array.isArray(remote.customers)) {
    mergeRemoteIntoMemory(remote);
  } else {
    await saveCloudJson(CLOUD_CUSTOMER_KEY, customerDb).catch(() => {});
  }
}

export async function syncCustomerAccountsIfStale(force = false, maxAgeMs = 3000): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  if (!force && Date.now() - lastCustomerSyncAt < maxAgeMs) return;
  const remote = await loadCloudJson<Partial<CustomerAccountsDatabase>>(CLOUD_CUSTOMER_KEY);
  lastCustomerSyncAt = Date.now();
  if (remote && Array.isArray(remote.customers)) {
    mergeRemoteIntoMemory(remote);
  }
}

function hashCustomerPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt}$${derived}`;
}

function verifyCustomerPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const hashHex = parts[3];
  if (!Number.isFinite(iterations) || iterations < 10000 || !/^[a-f0-9]+$/i.test(saltHex) || !/^[a-f0-9]+$/i.test(hashHex)) {
    return false;
  }
  const derived = crypto.pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), iterations, 32, 'sha256').toString('hex');
  if (derived.length !== hashHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hashHex, 'hex'));
}

export function toPublicCustomerUser(rec: StoredCustomerRecord): CustomerUser {
  return {
    id: rec.id,
    fullName: rec.fullName,
    email: rec.email,
    phone: rec.phone,
    addresses: Array.isArray(rec.addresses) ? rec.addresses : [],
    wishlist: Array.isArray(rec.wishlist) ? rec.wishlist : [],
  };
}

export function signCustomerSessionToken(customerId: string, secret: string): { token: string; expiresAt: number } {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + CUSTOMER_SESSION_TTL_MS;
  const payload = `cust1.${customerId}.${sessionId}.${issuedAt}.${expiresAt}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return {
    token: `${payload}.${hmac}`,
    expiresAt,
  };
}

export function isCustomerSessionRevoked(sessionId: string): boolean {
  if (!sessionId) return true;
  const memExp = memoryRevokedCustomerSessions.get(sessionId);
  if (typeof memExp === 'number' && memExp > Date.now()) return true;
  const dbExp = customerDb.revokedSessionIds?.[sessionId];
  return typeof dbExp === 'number' && dbExp > Date.now();
}

export async function revokeCustomerSession(sessionId: string, expiresAt?: number): Promise<void> {
  if (!sessionId) return;
  const exp =
    typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > Date.now()
      ? expiresAt
      : Date.now() + CUSTOMER_SESSION_TTL_MS;
  memoryRevokedCustomerSessions.set(sessionId, exp);

  const res = await mutateCustomerDbSerialized('ar', async (current) => {
    const pruned = pruneRevokedSessions(current.revokedSessionIds);
    pruned[sessionId] = exp;
    return {
      nextDb: {
        customers: current.customers,
        revokedSessionIds: pruned,
        updatedAt: new Date().toISOString(),
      },
      result: true,
    };
  });

  if (!res.ok) {
    console.warn('[CustomerEngine] Notice persisting revoked session ID to storage.');
  }
}

export function verifyCustomerSessionToken(
  token: string,
  secret: string
): { customerId: string; sessionId: string; issuedAt: number; expiresAt: number } | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 6 || parts[0] !== 'cust1') return null;
  const [ver, customerId, sessionId, iatStr, expStr, hmac] = parts;
  if (!customerId || !sessionId || !hmac) return null;
  const payload = `${ver}.${customerId}.${sessionId}.${iatStr}.${expStr}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (hmac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
  const issuedAt = Number(iatStr);
  const expiresAt = Number(expStr);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }
  if (isCustomerSessionRevoked(sessionId)) {
    return null;
  }
  return { customerId, sessionId, issuedAt, expiresAt };
}

export async function registerCustomerAccount(input: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword?: unknown;
  lang?: AuthLang;
}): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  const lang: AuthLang = input.lang || 'ar';
  const fullName = String(input.fullName || '').trim().slice(0, 100);
  const email = String(input.email || '').trim().toLowerCase();
  const phoneCheck = normalizeTunisianPhone(String(input.phone || ''));
  const password = String(input.password || '');

  if (!fullName || fullName.length < 3 || containsDangerousHtml(fullName)) {
    return { ok: false, statusCode: 400, error: getCustomerAuthMessage(lang, 'invalidFullName') };
  }
  if (!isValidCustomerEmail(email)) {
    return { ok: false, statusCode: 400, error: getCustomerAuthMessage(lang, 'invalidEmail') };
  }
  if (!phoneCheck.valid) {
    return { ok: false, statusCode: 400, error: getCustomerAuthMessage(lang, 'invalidPhone') };
  }
  const pwdCheck = validateCustomerPasswordStrength(password, input.confirmPassword);
  if (!pwdCheck.valid) {
    return {
      ok: false,
      statusCode: 400,
      error: getCustomerAuthMessage(lang, mapPasswordReasonToMsgKey(pwdCheck.reason)),
    };
  }

  const newPhoneDigits = phoneDigits8(phoneCheck.normalized);
  const passwordHash = hashCustomerPassword(password);

  const mut = await mutateCustomerDbSerialized<{
    conflictKey?: 'duplicateEmail' | 'duplicatePhone';
    customer?: CustomerUser;
  }>(lang, async (current) => {
    const emailDup = current.customers.find((c) => c.email.toLowerCase() === email);
    if (emailDup) {
      return { skipWrite: true, result: { conflictKey: 'duplicateEmail' } };
    }
    const phoneDup = current.customers.find((c) => phoneDigits8(c.phone) === newPhoneDigits);
    if (phoneDup) {
      return { skipWrite: true, result: { conflictKey: 'duplicatePhone' } };
    }

    const now = new Date().toISOString();
    const record: StoredCustomerRecord = {
      id: `cust_${crypto.randomBytes(8).toString('hex')}`,
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
      nextDb: {
        customers: [record, ...current.customers],
        revokedSessionIds: pruneRevokedSessions(current.revokedSessionIds),
        updatedAt: now,
      },
      result: { customer: toPublicCustomerUser(record) },
    };
  });

  if (!mut.ok) {
    return { ok: false, statusCode: mut.statusCode || 503, error: mut.error };
  }
  if (mut.result?.conflictKey) {
    return {
      ok: false,
      statusCode: 409,
      error: getCustomerAuthMessage(lang, mut.result.conflictKey),
    };
  }
  if (!mut.result?.customer) {
    return { ok: false, statusCode: 503, error: getCustomerAuthMessage(lang, 'dbSaveFailed') };
  }
  return { ok: true, customer: mut.result.customer };
}

export async function authenticateCustomerAccount(input: {
  email: string;
  password: string;
  lang?: AuthLang;
}): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  const lang: AuthLang = input.lang || 'ar';
  await syncCustomerAccountsIfStale(true);
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');

  if (!isValidCustomerEmail(email) || !password) {
    return { ok: false, statusCode: 400, error: getCustomerAuthMessage(lang, 'loginRequiredFields') };
  }

  const found = customerDb.customers.find((c) => c.email.toLowerCase() === email);
  if (!found) {
    // Perform equal-cost dummy PBKDF2 to avoid email enumeration timing side-channel
    crypto.pbkdf2Sync(password, DUMMY_PBKDF2_SALT, PBKDF2_ITERATIONS, 32, 'sha256');
    return { ok: false, statusCode: 401, error: getCustomerAuthMessage(lang, 'invalidCredentials') };
  }
  if (!verifyCustomerPassword(password, found.passwordHash)) {
    return { ok: false, statusCode: 401, error: getCustomerAuthMessage(lang, 'invalidCredentials') };
  }

  return { ok: true, customer: toPublicCustomerUser(found) };
}

export function getCustomerById(customerId: string): CustomerUser | null {
  const found = customerDb.customers.find((c) => c.id === customerId);
  return found ? toPublicCustomerUser(found) : null;
}

export async function updateCustomerProfileServer(
  customerId: string,
  input: { fullName?: string; phone?: string; lang?: AuthLang }
): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  const lang: AuthLang = input.lang || 'ar';
  const mut = await mutateCustomerDbSerialized<{
    errStatus?: number;
    errKey?: 'accountNotFound' | 'invalidFullName' | 'invalidPhone' | 'duplicatePhone';
    customer?: CustomerUser;
  }>(lang, async (current) => {
    const idx = current.customers.findIndex((c) => c.id === customerId);
    if (idx === -1) {
      return { skipWrite: true, result: { errStatus: 404, errKey: 'accountNotFound' } };
    }
    const existing = current.customers[idx];

    const fullName =
      input.fullName !== undefined
        ? String(input.fullName || '').trim().slice(0, 100)
        : existing.fullName;
    if (!fullName || fullName.length < 3 || containsDangerousHtml(fullName)) {
      return { skipWrite: true, result: { errStatus: 400, errKey: 'invalidFullName' } };
    }

    let nextPhone = existing.phone;
    if (input.phone !== undefined) {
      const phoneCheck = normalizeTunisianPhone(String(input.phone || ''));
      if (!phoneCheck.valid) {
        return { skipWrite: true, result: { errStatus: 400, errKey: 'invalidPhone' } };
      }
      const nextDigits = phoneDigits8(phoneCheck.normalized);
      const phoneOwner = current.customers.find(
        (c) => c.id !== customerId && phoneDigits8(c.phone) === nextDigits
      );
      if (phoneOwner) {
        return { skipWrite: true, result: { errStatus: 409, errKey: 'duplicatePhone' } };
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
      nextDb: {
        customers: current.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
        revokedSessionIds: current.revokedSessionIds,
        updatedAt: now,
      },
      result: { customer: toPublicCustomerUser(updatedCustomer) },
    };
  });

  if (!mut.ok) return { ok: false, statusCode: mut.statusCode || 503, error: mut.error };
  if (mut.result?.errKey) {
    return {
      ok: false,
      statusCode: mut.result.errStatus || 400,
      error: getCustomerAuthMessage(lang, mut.result.errKey),
    };
  }
  return { ok: true, customer: mut.result?.customer };
}

export async function syncCustomerWishlistServer(
  customerId: string,
  wishlistIds: unknown,
  lang: AuthLang = 'ar'
): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  if (!Array.isArray(wishlistIds)) {
    return { ok: false, statusCode: 400, error: getCustomerAuthMessage(lang, 'invalidWishlistPayload') };
  }

  const sanitizedWishlist = Array.from(
    new Set(
      wishlistIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= 80 && !containsDangerousHtml(id))
    )
  ).slice(0, 100);

  const mut = await mutateCustomerDbSerialized<{
    errStatus?: number;
    errKey?: 'accountNotFound';
    customer?: CustomerUser;
  }>(lang, async (current) => {
    const idx = current.customers.findIndex((c) => c.id === customerId);
    if (idx === -1) {
      return { skipWrite: true, result: { errStatus: 404, errKey: 'accountNotFound' } };
    }
    const existing = current.customers[idx];
    const now = new Date().toISOString();
    const updatedCustomer: StoredCustomerRecord = {
      ...existing,
      wishlist: sanitizedWishlist,
      updatedAt: now,
    };
    return {
      nextDb: {
        customers: current.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
        revokedSessionIds: current.revokedSessionIds,
        updatedAt: now,
      },
      result: { customer: toPublicCustomerUser(updatedCustomer) },
    };
  });

  if (!mut.ok) return { ok: false, statusCode: mut.statusCode || 503, error: mut.error };
  if (mut.result?.errKey) {
    return {
      ok: false,
      statusCode: mut.result.errStatus || 404,
      error: getCustomerAuthMessage(lang, mut.result.errKey),
    };
  }
  return { ok: true, customer: mut.result?.customer };
}

export async function addCustomerAddressServer(
  customerId: string,
  addressInput: {
    fullName?: string;
    phone: string;
    governorate: string;
    delegation?: string;
    city?: string;
    street: string;
    notes?: string;
    isDefault?: boolean;
  },
  lang: AuthLang = 'ar'
): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  const mut = await mutateCustomerDbSerialized<{
    errStatus?: number;
    errKey?:
      | 'accountNotFound'
      | 'invalidRecipientName'
      | 'invalidPhone'
      | 'invalidGovernorate'
      | 'invalidDelegation'
      | 'invalidStreet';
    customer?: CustomerUser;
  }>(lang, async (current) => {
    const idx = current.customers.findIndex((c) => c.id === customerId);
    if (idx === -1) {
      return { skipWrite: true, result: { errStatus: 404, errKey: 'accountNotFound' } };
    }

    const existingCustomer = current.customers[idx];
    const fullName = String(addressInput.fullName || existingCustomer.fullName || '').trim().slice(0, 100);
    const phoneCheck = normalizeTunisianPhone(String(addressInput.phone || existingCustomer.phone || ''));
    const governorate = String(addressInput.governorate || '').trim();
    const delegation = String(addressInput.delegation || addressInput.city || '').trim();
    const street = String(addressInput.street || '').trim().slice(0, 240);
    const notes = String(addressInput.notes || '').trim().slice(0, 200);

    if (!fullName || containsDangerousHtml(fullName)) {
      return { skipWrite: true, result: { errStatus: 400, errKey: 'invalidRecipientName' } };
    }
    if (!phoneCheck.valid) {
      return { skipWrite: true, result: { errStatus: 400, errKey: 'invalidPhone' } };
    }
    if (!isValidGovernorate(governorate)) {
      return { skipWrite: true, result: { errStatus: 400, errKey: 'invalidGovernorate' } };
    }
    if (!delegation || !isValidDelegationForGovernorate(governorate, delegation)) {
      return { skipWrite: true, result: { errStatus: 400, errKey: 'invalidDelegation' } };
    }
    if (!street || street.length < 4 || containsDangerousHtml(street) || containsDangerousHtml(notes)) {
      return { skipWrite: true, result: { errStatus: 400, errKey: 'invalidStreet' } };
    }

    const shouldDefault = Boolean(addressInput.isDefault) || existingCustomer.addresses.length === 0;
    const newAddress: CustomerAddress = {
      id: `addr_${crypto.randomBytes(6).toString('hex')}`,
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
      ...existingCustomer.addresses.map((a) => ({
        ...a,
        isDefault: shouldDefault ? false : a.isDefault,
      })),
    ].slice(0, 15);

    const now = new Date().toISOString();
    const updatedCustomer: StoredCustomerRecord = {
      ...existingCustomer,
      addresses: updatedAddresses,
      updatedAt: now,
    };

    return {
      nextDb: {
        customers: current.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
        revokedSessionIds: current.revokedSessionIds,
        updatedAt: now,
      },
      result: { customer: toPublicCustomerUser(updatedCustomer) },
    };
  });

  if (!mut.ok) return { ok: false, statusCode: mut.statusCode || 503, error: mut.error };
  if (mut.result?.errKey) {
    return {
      ok: false,
      statusCode: mut.result.errStatus || 400,
      error: getCustomerAuthMessage(lang, mut.result.errKey),
    };
  }
  return { ok: true, customer: mut.result?.customer };
}

export async function setDefaultCustomerAddressServer(
  customerId: string,
  addressId: string,
  lang: AuthLang = 'ar'
): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  const cleanAddressId = String(addressId || '').trim();
  const mut = await mutateCustomerDbSerialized<{
    errStatus?: number;
    errKey?: 'accountNotFound' | 'addressNotFound';
    customer?: CustomerUser;
  }>(lang, async (current) => {
    const idx = current.customers.findIndex((c) => c.id === customerId);
    if (idx === -1) {
      return { skipWrite: true, result: { errStatus: 404, errKey: 'accountNotFound' } };
    }
    const existingCustomer = current.customers[idx];
    if (!existingCustomer.addresses.some((a) => a.id === cleanAddressId)) {
      return { skipWrite: true, result: { errStatus: 404, errKey: 'addressNotFound' } };
    }

    const now = new Date().toISOString();
    const updatedCustomer: StoredCustomerRecord = {
      ...existingCustomer,
      addresses: existingCustomer.addresses.map((a) => ({
        ...a,
        isDefault: a.id === cleanAddressId,
      })),
      updatedAt: now,
    };

    return {
      nextDb: {
        customers: current.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
        revokedSessionIds: current.revokedSessionIds,
        updatedAt: now,
      },
      result: { customer: toPublicCustomerUser(updatedCustomer) },
    };
  });

  if (!mut.ok) return { ok: false, statusCode: mut.statusCode || 503, error: mut.error };
  if (mut.result?.errKey) {
    return {
      ok: false,
      statusCode: mut.result.errStatus || 404,
      error: getCustomerAuthMessage(lang, mut.result.errKey),
    };
  }
  return { ok: true, customer: mut.result?.customer };
}

export async function deleteCustomerAddressServer(
  customerId: string,
  addressId: string,
  lang: AuthLang = 'ar'
): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  const cleanAddressId = String(addressId || '').trim();
  const mut = await mutateCustomerDbSerialized<{
    errStatus?: number;
    errKey?: 'accountNotFound' | 'addressNotFound';
    customer?: CustomerUser;
  }>(lang, async (current) => {
    const idx = current.customers.findIndex((c) => c.id === customerId);
    if (idx === -1) {
      return { skipWrite: true, result: { errStatus: 404, errKey: 'accountNotFound' } };
    }
    const existingCustomer = current.customers[idx];
    const target = existingCustomer.addresses.find((a) => a.id === cleanAddressId);
    if (!target) {
      return { skipWrite: true, result: { errStatus: 404, errKey: 'addressNotFound' } };
    }

    let remaining = existingCustomer.addresses.filter((a) => a.id !== cleanAddressId);
    if (target.isDefault && remaining.length > 0 && !remaining.some((a) => a.isDefault)) {
      remaining = remaining.map((a, i) => (i === 0 ? { ...a, isDefault: true } : a));
    }

    const now = new Date().toISOString();
    const updatedCustomer: StoredCustomerRecord = {
      ...existingCustomer,
      addresses: remaining,
      updatedAt: now,
    };

    return {
      nextDb: {
        customers: current.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
        revokedSessionIds: current.revokedSessionIds,
        updatedAt: now,
      },
      result: { customer: toPublicCustomerUser(updatedCustomer) },
    };
  });

  if (!mut.ok) return { ok: false, statusCode: mut.statusCode || 503, error: mut.error };
  if (mut.result?.errKey) {
    return {
      ok: false,
      statusCode: mut.result.errStatus || 404,
      error: getCustomerAuthMessage(lang, mut.result.errKey),
    };
  }
  return { ok: true, customer: mut.result?.customer };
}
