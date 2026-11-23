import crypto from 'crypto';
import fs from 'fs';
import {
  atomicWriteJsonSync,
  getDataFilePath,
  isCloudPersistenceEnabled,
  loadCloudJson,
  saveCloudJson,
  savePersistentJson,
} from './cloudPersistence';
import {
  isValidDelegationForGovernorate,
  isValidGovernorate,
  normalizeTunisianPhone,
} from '../src/data/governorates';
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

async function persistCustomerDb(next: CustomerAccountsDatabase) {
  return savePersistentJson(CLOUD_CUSTOMER_KEY, CUSTOMER_ACCOUNTS_FILE, next, {
    allowEphemeral: process.env.NODE_ENV !== 'production',
  });
}

export async function hydrateCustomerAccountsFromCloud(): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  const remote = await loadCloudJson<Partial<CustomerAccountsDatabase>>(CLOUD_CUSTOMER_KEY);
  lastCustomerSyncAt = Date.now();
  if (remote && Array.isArray(remote.customers)) {
    const mergedRevoked = {
      ...pruneRevokedSessions(customerDb.revokedSessionIds),
      ...pruneRevokedSessions(remote.revokedSessionIds),
    };
    for (const [sid, exp] of Object.entries(mergedRevoked)) {
      memoryRevokedCustomerSessions.set(sid, exp);
    }
    customerDb = {
      customers: remote.customers,
      revokedSessionIds: mergedRevoked,
      updatedAt: typeof remote.updatedAt === 'string' ? remote.updatedAt : new Date().toISOString(),
    };
    try {
      atomicWriteJsonSync(CUSTOMER_ACCOUNTS_FILE, customerDb);
    } catch {}
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
    const mergedRevoked = {
      ...pruneRevokedSessions(customerDb.revokedSessionIds),
      ...pruneRevokedSessions(remote.revokedSessionIds),
    };
    for (const [sid, exp] of Object.entries(mergedRevoked)) {
      memoryRevokedCustomerSessions.set(sid, exp);
    }
    customerDb = {
      customers: remote.customers,
      revokedSessionIds: mergedRevoked,
      updatedAt: typeof remote.updatedAt === 'string' ? remote.updatedAt : new Date().toISOString(),
    };
    try {
      atomicWriteJsonSync(CUSTOMER_ACCOUNTS_FILE, customerDb);
    } catch {}
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

function containsDangerousHtml(value: string): boolean {
  return /<[^>]*>|<script|<iframe|javascript:|onerror=|onload=/i.test(value);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email) && email.length <= 140;
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
  const pruned = pruneRevokedSessions(customerDb.revokedSessionIds);
  pruned[sessionId] = exp;
  const next: CustomerAccountsDatabase = {
    customers: customerDb.customers,
    revokedSessionIds: pruned,
    updatedAt: new Date().toISOString(),
  };
  customerDb = next;
  await persistCustomerDb(next).catch(() => {});
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
}): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  await syncCustomerAccountsIfStale(true);
  const fullName = String(input.fullName || '').trim().slice(0, 100);
  const email = String(input.email || '').trim().toLowerCase();
  const phoneCheck = normalizeTunisianPhone(String(input.phone || ''));
  const password = String(input.password || '');

  if (!fullName || fullName.length < 3 || containsDangerousHtml(fullName)) {
    return { ok: false, statusCode: 400, error: 'يرجى إدخال الاسم الكامل بشكل صحيح (3 أحرف على الأقل).' };
  }
  if (!isValidEmail(email)) {
    return { ok: false, statusCode: 400, error: 'يرجى إدخال بريد إلكتروني صالح.' };
  }
  if (!phoneCheck.valid) {
    return { ok: false, statusCode: 400, error: 'يرجى إدخال رقم هاتف تونسي صحيح (8 أرقام).' };
  }
  if (password.length < 8 || password.length > 128) {
    return { ok: false, statusCode: 400, error: 'كلمة المرور يجب أن تتكون من 8 أحرف على الأقل.' };
  }

  const duplicate = customerDb.customers.find((c) => c.email.toLowerCase() === email);
  if (duplicate) {
    return { ok: false, statusCode: 409, error: 'هذا البريد الإلكتروني مسجل مسبقاً. يرجى تسجيل الدخول.' };
  }

  const now = new Date().toISOString();
  const record: StoredCustomerRecord = {
    id: `cust_${crypto.randomBytes(8).toString('hex')}`,
    fullName,
    email,
    phone: phoneCheck.normalized,
    passwordHash: hashCustomerPassword(password),
    addresses: [],
    wishlist: [],
    createdAt: now,
    updatedAt: now,
  };

  const next: CustomerAccountsDatabase = {
    customers: [record, ...customerDb.customers],
    revokedSessionIds: pruneRevokedSessions(customerDb.revokedSessionIds),
    updatedAt: now,
  };
  const persisted = await persistCustomerDb(next);
  if (!persisted.ok) {
    return { ok: false, statusCode: 503, error: persisted.error || 'تعذر حفظ الحساب في قاعدة البيانات.' };
  }
  customerDb = next;
  lastCustomerSyncAt = Date.now();
  return { ok: true, customer: toPublicCustomerUser(record) };
}

export async function authenticateCustomerAccount(input: {
  email: string;
  password: string;
}): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  await syncCustomerAccountsIfStale(true);
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');

  if (!isValidEmail(email) || !password) {
    return { ok: false, statusCode: 400, error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.' };
  }

  const found = customerDb.customers.find((c) => c.email.toLowerCase() === email);
  if (!found || !verifyCustomerPassword(password, found.passwordHash)) {
    return { ok: false, statusCode: 401, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' };
  }

  return { ok: true, customer: toPublicCustomerUser(found) };
}

export function getCustomerById(customerId: string): CustomerUser | null {
  const found = customerDb.customers.find((c) => c.id === customerId);
  return found ? toPublicCustomerUser(found) : null;
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
  }
): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  await syncCustomerAccountsIfStale(true);
  const idx = customerDb.customers.findIndex((c) => c.id === customerId);
  if (idx === -1) {
    return { ok: false, statusCode: 404, error: 'الحساب غير موجود.' };
  }

  const existingCustomer = customerDb.customers[idx];
  const fullName = String(addressInput.fullName || existingCustomer.fullName || '').trim().slice(0, 100);
  const phoneCheck = normalizeTunisianPhone(String(addressInput.phone || existingCustomer.phone || ''));
  const governorate = String(addressInput.governorate || '').trim();
  const delegation = String(addressInput.delegation || addressInput.city || '').trim();
  const street = String(addressInput.street || '').trim().slice(0, 240);
  const notes = String(addressInput.notes || '').trim().slice(0, 200);

  if (!fullName || containsDangerousHtml(fullName)) {
    return { ok: false, statusCode: 400, error: 'اسم المستلم غير صالح.' };
  }
  if (!phoneCheck.valid) {
    return { ok: false, statusCode: 400, error: 'رقم الهاتف التونسي غير صالح.' };
  }
  if (!isValidGovernorate(governorate)) {
    return { ok: false, statusCode: 400, error: 'يرجى اختيار ولاية تونسية صالحة.' };
  }
  if (!delegation || !isValidDelegationForGovernorate(governorate, delegation)) {
    return { ok: false, statusCode: 400, error: 'يرجى اختيار معتمدية مطابقة للولاية المختارة.' };
  }
  if (!street || street.length < 4 || containsDangerousHtml(street) || containsDangerousHtml(notes)) {
    return { ok: false, statusCode: 400, error: 'يرجى إدخال عنوان تفصيلي صالح.' };
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

  const next: CustomerAccountsDatabase = {
    customers: customerDb.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
    revokedSessionIds: pruneRevokedSessions(customerDb.revokedSessionIds),
    updatedAt: now,
  };
  const persisted = await persistCustomerDb(next);
  if (!persisted.ok) {
    return { ok: false, statusCode: 503, error: persisted.error || 'تعذر حفظ العنوان.' };
  }
  customerDb = next;
  lastCustomerSyncAt = Date.now();
  return { ok: true, customer: toPublicCustomerUser(updatedCustomer) };
}

export async function setDefaultCustomerAddressServer(
  customerId: string,
  addressId: string
): Promise<{ ok: boolean; statusCode?: number; error?: string; customer?: CustomerUser }> {
  await syncCustomerAccountsIfStale(true);
  const idx = customerDb.customers.findIndex((c) => c.id === customerId);
  if (idx === -1) {
    return { ok: false, statusCode: 404, error: 'الحساب غير موجود.' };
  }
  const existingCustomer = customerDb.customers[idx];
  const exists = existingCustomer.addresses.some((a) => a.id === addressId);
  if (!exists) {
    return { ok: false, statusCode: 404, error: 'العنوان غير موجود.' };
  }

  const now = new Date().toISOString();
  const updatedCustomer: StoredCustomerRecord = {
    ...existingCustomer,
    addresses: existingCustomer.addresses.map((a) => ({
      ...a,
      isDefault: a.id === addressId,
    })),
    updatedAt: now,
  };
  const next: CustomerAccountsDatabase = {
    customers: customerDb.customers.map((c, i) => (i === idx ? updatedCustomer : c)),
    revokedSessionIds: pruneRevokedSessions(customerDb.revokedSessionIds),
    updatedAt: now,
  };
  const persisted = await persistCustomerDb(next);
  if (!persisted.ok) {
    return { ok: false, statusCode: 503, error: persisted.error || 'تعذر تحديث العنوان الافتراضي.' };
  }
  customerDb = next;
  lastCustomerSyncAt = Date.now();
  return { ok: true, customer: toPublicCustomerUser(updatedCustomer) };
}
