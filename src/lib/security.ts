// ECHOX OWNER SECURITY & OS PHONE LOCK (PATTERN & PIN)
import { auth, db } from './firebase';
import { 
  RecaptchaVerifier, 
  signInWithPhoneNumber, 
  ConfirmationResult, 
  UserCredential 
} from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

export const DEFAULT_OWNER_EMAIL = '';
export const DEFAULT_OWNER_PHONE = '';

export function getAuthorizedOwnerEmail(): string {
  try {
    const saved = localStorage.getItem('echox_owner_login_email');
    if (saved && saved.trim()) return saved.trim();
  } catch {}
  return '';
}

export function setAuthorizedOwnerEmail(email: string) {
  try {
    localStorage.setItem('echox_owner_login_email', email.trim().toLowerCase());
  } catch (e) {
    console.warn('Storage email write error:', e);
  }
}

export function getAuthorizedOwnerPhone(): string {
  try {
    const saved = localStorage.getItem('echox_owner_phone');
    if (saved && saved.trim()) return saved.trim();
  } catch {}
  return '';
}

export function setAuthorizedOwnerPhone(phone: string) {
  try {
    localStorage.setItem('echox_owner_phone', phone.trim());
  } catch (e) {
    console.warn('Storage phone write error:', e);
  }
}

export const OWNER_EMAIL = DEFAULT_OWNER_EMAIL;
export const OWNER_PHONE_MASKED = '+216 *** *** **';
export const OWNER_PHONE_FULL = DEFAULT_OWNER_PHONE;

export interface OwnerAuthState {
  currentUser: { email: string; uid: string } | null;
  customClaims: { owner?: boolean };
}

export interface OwnerLockConfig {
  lock_type: 'pattern' | 'pin';
  lock_hash: string;
  code_hash?: string;
  updated_at?: string;
  failed_attempts?: Array<{ timestamp: string; type: string }>;
}

// Memory & Session storage key for Google user
const GOOGLE_USER_KEY = 'echox_owner_google_user';
const CUSTOM_CLAIMS_KEY = 'echox_owner_custom_claims';
const OWNER_UNLOCKED_KEY = 'echox_owner_os_unlocked';

export function getOwnerGoogleUser(): { email: string; uid: string } | null {
  try {
    const raw = sessionStorage.getItem(GOOGLE_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setOwnerGoogleUser(user: { email: string; uid: string } | null) {
  if (user) {
    sessionStorage.setItem(GOOGLE_USER_KEY, JSON.stringify(user));
  } else {
    sessionStorage.removeItem(GOOGLE_USER_KEY);
  }
}

export function getOwnerCustomClaims(): { owner?: boolean } {
  try {
    const raw = sessionStorage.getItem(CUSTOM_CLAIMS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setOwnerCustomClaims(claims: { owner?: boolean }) {
  sessionStorage.setItem(CUSTOM_CLAIMS_KEY, JSON.stringify(claims));
}

export function isOwnerUnlocked(): boolean {
  return sessionStorage.getItem(OWNER_UNLOCKED_KEY) === 'true';
}

export function setOwnerUnlocked(unlocked: boolean) {
  if (unlocked) {
    sessionStorage.setItem(OWNER_UNLOCKED_KEY, 'true');
    sessionStorage.setItem('echox_owner_code_verified', 'true');
  } else {
    sessionStorage.removeItem(OWNER_UNLOCKED_KEY);
    sessionStorage.removeItem('echox_owner_code_verified');
  }
}

let activeMemorySessionToken: string | null = null;
let activeCsrfToken: string | null = null;
let activeVaultGateToken: { token: string; expiresAt: number } | null = null;

// Purge any legacy bearer token left in Web Storage from older builds
try {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('echox_admin_session_token');
    localStorage.removeItem('echox_admin_session_token');
  }
} catch {}

export function setPendingVaultGateToken(token: string | null) {
  if (token && token.trim()) {
    activeVaultGateToken = {
      token: token.trim(),
      expiresAt: Date.now() + 3 * 60 * 1000,
    };
  } else {
    activeVaultGateToken = null;
  }
}

export function consumePendingVaultGateToken(): string | null {
  if (!activeVaultGateToken) return null;
  const { token, expiresAt } = activeVaultGateToken;
  activeVaultGateToken = null;
  if (Date.now() > expiresAt) return null;
  return token;
}

export function hasPendingVaultGateToken(): boolean {
  if (!activeVaultGateToken) return false;
  if (Date.now() > activeVaultGateToken.expiresAt) {
    activeVaultGateToken = null;
    return false;
  }
  return true;
}

function readCookie(name: string): string | null {
  try {
    if (typeof document === 'undefined' || !document.cookie) return null;
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        const val = decodeURIComponent(trimmed.slice(prefix.length)).trim();
        return val || null;
      }
    }
  } catch {}
  return null;
}

export function setMemorySessionToken(token: string | null) {
  activeMemorySessionToken = token && token.trim() ? token.trim() : null;
}

export function setMemoryCsrfToken(token: string | null) {
  activeCsrfToken = token && token.trim() ? token.trim() : null;
}

export function getCsrfToken(): string | null {
  if (activeCsrfToken) return activeCsrfToken;
  const fromCookie = readCookie('echox_csrf');
  if (fromCookie) {
    activeCsrfToken = fromCookie;
    return fromCookie;
  }
  return null;
}

export function getAdminAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (activeMemorySessionToken) {
    headers['Authorization'] = `Bearer ${activeMemorySessionToken}`;
  }
  const csrf = getCsrfToken();
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }
  return headers;
}

export function clearOwnerSecuritySession() {
  activeMemorySessionToken = null;
  activeCsrfToken = null;
  activeVaultGateToken = null;
  try {
    sessionStorage.removeItem('echox_admin_session_token');
    sessionStorage.removeItem(GOOGLE_USER_KEY);
    sessionStorage.removeItem(CUSTOM_CLAIMS_KEY);
    sessionStorage.removeItem(OWNER_UNLOCKED_KEY);
    sessionStorage.removeItem('echox_owner_code_verified');
    sessionStorage.removeItem('echox_owner_session');
    localStorage.removeItem('echox_owner_settings');
    localStorage.removeItem('echox_owner_login_email');
    localStorage.removeItem('echox_owner_phone');
  } catch {}
  if (typeof window !== 'undefined' && (window as any).confirmationResult) {
    delete (window as any).confirmationResult;
  }
}

export function notifySessionExpired() {
  clearOwnerSecuritySession();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('echox_session_expired'));
  }
}

// ==========================================
// 🔐 CRYPTOGRAPHIC SHA-256 HASHING
// ==========================================
export async function hashSecurityInput(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ==========================================
// 📱 FIRESTORE & SERVER CONFIGURATION SYNC
// ==========================================

/**
 * Reads lock configuration from Firestore (store_settings/owner_security),
 * with graceful fallback to /api/security/ownerLockConfig.
 */
export async function fetchOwnerLockConfig(): Promise<{
  configured: boolean;
  config: OwnerLockConfig | null;
  lockedOut?: boolean;
  remainingSeconds?: number;
}> {
  // 1. Try reading from Firestore: store_settings/owner_security
  try {
    const docRef = doc(db, 'store_settings', 'owner_security');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data() as any;
      const hash = data.lock_hash || data.code_hash;
      if (hash && hash.trim().length > 0) {
        return {
          configured: true,
          config: {
            lock_type: data.lock_type === 'pin' ? 'pin' : 'pattern',
            lock_hash: hash,
            code_hash: hash,
            updated_at: data.updated_at,
            failed_attempts: data.failed_attempts || []
          }
        };
      }
    }
  } catch (err) {
    console.info('[Security] Firestore direct read notice, using server sync fallback:', err);
  }

  // 2. Fallback to server API
  try {
    const res = await fetch('/api/security/ownerLockConfig');
    if (res.ok) {
      const data = await res.json();
      if (data.configured && (data.lock_hash || data.code_hash)) {
        return {
          configured: true,
          config: {
            lock_type: data.lock_type || 'pattern',
            lock_hash: data.lock_hash || data.code_hash,
            code_hash: data.code_hash || data.lock_hash,
            updated_at: data.updated_at,
            failed_attempts: data.failed_attempts || []
          },
          lockedOut: data.lockedOut,
          remainingSeconds: data.remainingSeconds
        };
      }
      return {
        configured: false,
        config: null,
        lockedOut: data.lockedOut,
        remainingSeconds: data.remainingSeconds
      };
    }
  } catch (err) {
    console.warn('[Security] API config fetch notice:', err);
  }

  return { configured: false, config: null };
}

/**
 * Saves the lock configuration to Firestore (store_settings/owner_security)
 * and syncs with the server API.
 */
export async function saveOwnerLockConfig(
  lock_type: 'pattern' | 'pin',
  rawInputOrHash: string,
  isAlreadyHashed: boolean = false
): Promise<{ success: boolean; hash: string; error?: string }> {
  const finalHash = isAlreadyHashed
    ? rawInputOrHash
    : await hashSecurityInput(rawInputOrHash);

  const payload: OwnerLockConfig = {
    lock_type,
    lock_hash: finalHash,
    code_hash: finalHash,
    updated_at: new Date().toISOString(),
  };

  try {
    const res = await fetch('/api/security/saveLockConfig', {
      method: 'POST',
      headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    const data = await safeReadJson(res);
    if (res.status === 401 || res.status === 403) {
      notifySessionExpired();
      return { success: false, hash: '', error: data.error || 'انتهت جلسة مركز التحكم.' };
    }
    if (!res.ok || !data.success) {
      return { success: false, hash: '', error: data.error || 'تعذر حفظ إعدادات القفل بشكل دائم على الخادم.' };
    }
  } catch {
    return { success: false, hash: '', error: 'تعذر الاتصال بالخادم لحفظ إعدادات القفل.' };
  }

  try {
    const docRef = doc(db, 'store_settings', 'owner_security');
    await setDoc(docRef, payload, { merge: true });
  } catch {
    // Server DB persistence already succeeded
  }

  return { success: true, hash: finalHash };
}

/**
 * Verifies the pattern or PIN entry against stored hash and handles lockout.
 */
export async function verifyOwnerLockInput(
  _rawInput: string,
  _storedHash: string,
  _type: 'pattern' | 'pin'
): Promise<{
  success: boolean;
  lockedOut?: boolean;
  remainingSeconds?: number;
  attemptsLeft?: number;
  error?: string;
}> {
  return {
    success: false,
    error: 'تم إيقاف التحقق المحلي نهائياً. يرجى استخدام التحقق الخادمي المعتمد via Argon2id.',
  };
}

/**
 * Records a failed attempt in Firestore and the backend log.
 */
export async function logFailedAttemptCall(type: 'pattern' | 'pin') {
  try {
    await fetch('/api/security/logFailedAttempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
  } catch (err) {
    console.warn('logFailedAttempt notice:', err);
  }
}

/**
 * Resets lock configuration in Firestore & backend when user confirms "Forgot Code".
 */
export async function resetOwnerLockConfig(): Promise<boolean> {
  try {
    const res = await fetch('/api/security/resetLockConfig', {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAdminAuthHeaders(),
    });
    if (res.status === 401 || res.status === 403) {
      notifySessionExpired();
      return false;
    }
    if (!res.ok) return false;
  } catch {
    return false;
  }

  try {
    const docRef = doc(db, 'store_settings', 'owner_security');
    await deleteDoc(docRef);
  } catch {}

  clearOwnerSecuritySession();
  return true;
}

/**
 * Logs out of all devices and clears server sessions.
 */
export async function logoutAllDevices(): Promise<boolean> {
  let ok = false;
  try {
    const res = await fetch('/api/security/logoutAllDevices', {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAdminAuthHeaders(),
    });
    ok = res.ok;
  } catch (e) {
    console.warn('logoutAllDevices notice:', e);
  }
  clearOwnerSecuritySession();
  return ok;
}

// Backward compatibility helpers
export const isSecurityCodeVerified = isOwnerUnlocked;
export const setSecurityCodeVerified = setOwnerUnlocked;

export async function createOwnerSessionCall(_email: string, _customToken?: string) {
  return {
    success: false,
    error: 'تم تعطيل إنشاء الجلسات المباشرة؛ المصادقة تمر حصرياً عبر /api/security/verifyPin.',
  };
}

export async function refreshCsrfTokenFromServer(): Promise<string | null> {
  try {
    const res = await fetch('/api/security/csrf', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: activeMemorySessionToken ? { Authorization: `Bearer ${activeMemorySessionToken}` } : {},
    });
    if (!res.ok) return null;
    const data = await safeReadJson(res);
    if (typeof data.csrfToken === 'string' && data.csrfToken) {
      setMemoryCsrfToken(data.csrfToken);
      return data.csrfToken;
    }
  } catch {}
  return getCsrfToken();
}

export async function checkServerSession() {
  try {
    const send = () =>
      fetch('/api/owner/me', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: getAdminAuthHeaders()
      });

    let res = await send();
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      res = await send();
    }
    if (!res.ok) return false;
    const data = await res.json();
    const ok = data.authenticated === true && data.owner === true && data.codeVerified === true;
    if (ok && !getCsrfToken()) {
      await refreshCsrfTokenFromServer();
    }
    return ok;
  } catch {
    return false;
  }
}

export async function checkServerSessionPreCode() {
  return checkServerSession();
}

export async function logoutOwnerServer() {
  await logoutAllDevices();
}

export async function sendFirebasePhoneOtp(): Promise<any> { return null; }
export async function confirmFirebasePhoneOtp(): Promise<any> { return null; }
export async function sendOtpCall(): Promise<any> { return { success: false, error: 'Unsupported route' }; }
export async function verifyOtpCall(): Promise<any> { return { success: false, error: 'Unsupported route' }; }
export async function verifySecurityCodeCall(code: string) {
  return await verifyPinServer(code);
}
export async function updateSecurityCodeCall(curr: string, next: string) {
  return await updatePinServer(curr, next);
}
export async function emergencyLockdownCall() {
  return await logoutAllDevices();
}
export async function getSecurityStatusCall() {
  return fetchSecuritySystemStatus();
}

// ==========================================
// 🛡️ SERVER-SIDE ARGON2ID SECURITY CLIENT APIS
// ==========================================

async function safeReadJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function fetchSecurityPostWithWakeRetry(
  url: string,
  payload: Record<string, unknown>
): Promise<{ res: Response; data: any }> {
  const send = () =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify(payload)
    });

  let res = await send();
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    res = await send();
  }
  const data = await safeReadJson(res);
  return { res, data };
}

export async function verifyAccessCodeServer(code: string): Promise<{
  success: boolean;
  gateToken?: string;
  lockedOut?: boolean;
  remainingSeconds?: number;
  attemptsLeft?: number;
  httpStatus?: number;
  error?: string;
}> {
  try {
    const { res, data } = await fetchSecurityPostWithWakeRetry('/api/security/verifyAccessCode', {
      code: code.trim()
    });
    if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 400) {
      return {
        success: false,
        httpStatus: res.status,
      };
    }
    if (data.success && typeof data.gateToken === 'string' && data.gateToken) {
      setPendingVaultGateToken(data.gateToken);
    }
    return {
      success: Boolean(data.success),
      gateToken: typeof data.gateToken === 'string' ? data.gateToken : undefined,
      httpStatus: res.status
    };
  } catch {
    return { success: false, httpStatus: 0 };
  }
}

export async function verifyPinServer(pin: string): Promise<{
  success: boolean;
  sessionId?: string;
  lockedOut?: boolean;
  remainingSeconds?: number;
  attemptsLeft?: number;
  httpStatus?: number;
  error?: string;
}> {
  try {
    const { res, data } = await fetchSecurityPostWithWakeRetry('/api/security/verifyPin', {
      pin: pin.trim()
    });
    if (res.status === 503) {
      return {
        success: false,
        httpStatus: 503,
        error:
          data.error ||
          'الخادم الخلفي في وضع الاستيقاظ الآن، يرجى الانتظار 15 ثانية ثم إعادة المحاولة.'
      };
    }
    if (res.status >= 500) {
      return {
        success: false,
        httpStatus: res.status,
        error: data.error || 'تعذر الاتصال بخادم التحقق الخلفي حالياً، يرجى المحاولة بعد لحظات.'
      };
    }
    if (data.success) {
      setOwnerUnlocked(true);
      if (typeof data.sessionToken === 'string' && data.sessionToken) {
        setMemorySessionToken(data.sessionToken);
      }
      if (typeof data.csrfToken === 'string' && data.csrfToken) {
        setMemoryCsrfToken(data.csrfToken);
      }
    }
    return {
      ...data,
      success: Boolean(data.success),
      httpStatus: res.status
    };
  } catch (err) {
    console.warn('[Security] verifyPinServer notice:', err);
    return { success: false, httpStatus: 0, error: 'فشل الاتصال بالخادم للتحقق من PIN.' };
  }
}

export async function updateAccessCodeServer(currentPinOrCode: string, newCode: string): Promise<{
  success: boolean;
  unauthorized?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/security/updateAccessCode', {
      method: 'POST',
      headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify({ currentPinOrCode, newCode })
    });
    const data = await safeReadJson(res);
    if (res.status === 401 || res.status === 403) {
      notifySessionExpired();
      return {
        success: false,
        unauthorized: true,
        error: data.error || 'وصول مرفوض: جلسة مركز التحكم مطلوبة أو منتهية.'
      };
    }
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'تعذر حفظ رمز الوصول الجديد بشكل دائم على الخادم.'
      };
    }
    return data;
  } catch {
    return { success: false, error: 'تعذر تحديث رمز الوصول على الخادم.' };
  }
}

export async function updatePinServer(currentPin: string, newPin: string): Promise<{
  success: boolean;
  unauthorized?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/security/updatePin', {
      method: 'POST',
      headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'same-origin',
      body: JSON.stringify({ currentPin, newPin })
    });
    const data = await safeReadJson(res);
    if (res.status === 401 || res.status === 403) {
      notifySessionExpired();
      return {
        success: false,
        unauthorized: true,
        error: data.error || 'وصول مرفوض: جلسة مركز التحكم مطلوبة أو منتهية.'
      };
    }
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'تعذر حفظ رمز الـ PIN الجديد بشكل دائم على الخادم.'
      };
    }
    return data;
  } catch {
    return { success: false, error: 'تعذر تحديث رمز الـ PIN على الخادم.' };
  }
}

export async function fetchActiveSessions(): Promise<{
  sessions: Array<{ id: string; ip: string; userAgent: string; createdAt: string; isCurrent: boolean }>;
  securityEngine: string;
  unauthorized?: boolean;
}> {
  try {
    const res = await fetch('/api/security/sessions', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: getAdminAuthHeaders()
    });
    if (res.status === 401 || res.status === 403) {
      return { sessions: [], securityEngine: 'Argon2id', unauthorized: true };
    }
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return { sessions: [], securityEngine: 'Argon2id' };
}

export async function revokeAllSessionsServer(): Promise<{ success: boolean; unauthorized?: boolean; message: string }> {
  try {
    const res = await fetch('/api/security/logoutAllDevices', {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAdminAuthHeaders()
    });
    const data = await safeReadJson(res);
    if (res.status === 401 || res.status === 403) {
      notifySessionExpired();
      return { success: false, unauthorized: true, message: data.error || 'انتهت صلاحية الجلسة.' };
    }
    clearOwnerSecuritySession();
    return data;
  } catch {
    return { success: false, message: 'فشل إنهاء الجلسات.' };
  }
}

export async function fetchSecuritySystemStatus(): Promise<any> {
  try {
    const res = await fetch('/api/security/systemStatus', { credentials: 'same-origin' });
    if (res.ok) return await res.json();
  } catch {}
  return { argon2idEnabled: true, serverSideEnforced: true };
}

// ==========================================
// 🏰 SECRET CONTROL ROOM APIS
// ==========================================

export type SecurityAuditSeverity = 'info' | 'warning' | 'critical';

export interface SecurityAuditLogEntry {
  seq: number;
  id: string;
  timestamp: string;
  event: string;
  severity: SecurityAuditSeverity;
  actor: string;
  ip: string;
  summary: string;
  meta?: Record<string, string | number | boolean>;
  prevHash: string;
  entryHash: string;
}

export interface SystemIntegrityCheck {
  id: string;
  label: string;
  passed: boolean;
  severity: 'ok' | 'warning' | 'critical';
  detail: string;
}

export interface SystemIntegrityReport {
  checkedAt: string;
  overallStatus: 'healthy' | 'warning' | 'critical';
  checks: SystemIntegrityCheck[];
  auditChain: { intact: boolean; totalEntries: number; brokenAtSeq?: number; latestHash: string };
  quarantineActiveCount: number;
  snapshotsCount: number;
}

export interface QuarantineVaultItem {
  id: string;
  createdAt: string;
  source: string;
  reason: string;
  severity: 'warning' | 'critical';
  actorIp: string;
  mimeDeclared: string;
  payloadHash: string;
  payloadPreview: string;
  status: 'quarantined' | 'purged';
  purgedAt?: string;
}

export interface RecoverySnapshotSummary {
  snapshotId: string;
  label: string;
  kind: 'manual' | 'pre_restore';
  createdAt: string;
  createdBy: string;
  payloadSha256: string;
  productsCount: number;
  companiesCount: number;
  ordersCount: number;
}

export interface RecoveryDryRunSectionDiff {
  currentCount: number;
  incomingCount: number;
  added: number;
  updated: number;
  removed: number;
}

export interface RecoveryDryRunResult {
  validToApply: boolean;
  signatureValid: boolean;
  schemaErrors: string[];
  warnings: string[];
  quarantinedItems: number;
  diff: {
    products: RecoveryDryRunSectionDiff;
    companies: RecoveryDryRunSectionDiff;
    categories: RecoveryDryRunSectionDiff;
    banners: RecoveryDryRunSectionDiff;
    orders: RecoveryDryRunSectionDiff;
    siteSettingsChanged: boolean;
    chatConfigChanged: boolean;
    notificationSettingsChanged: boolean;
  };
}

export async function fetchSecurityAuditLogs(limit = 100, severity?: string): Promise<{
  success: boolean;
  entries: SecurityAuditLogEntry[];
  chainIntact: boolean;
  totalEntries: number;
  brokenAtSeq?: number;
  unauthorized?: boolean;
  error?: string;
}> {
  try {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (severity && severity !== 'all') qs.set('severity', severity);
    const res = await fetch(`/api/admin/security/audit-logs?${qs.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: getAdminAuthHeaders(),
    });
    const data = await safeReadJson(res);
    if (res.status === 401 || res.status === 403) {
      notifySessionExpired();
      return { success: false, entries: [], chainIntact: false, totalEntries: 0, unauthorized: true, error: data.error };
    }
    if (!res.ok) return { success: false, entries: [], chainIntact: false, totalEntries: 0, error: data.error };
    return {
      success: Boolean(data.success),
      entries: Array.isArray(data.entries) ? data.entries : [],
      chainIntact: Boolean(data.chainIntact),
      totalEntries: Number(data.totalEntries || 0),
      brokenAtSeq: data.brokenAtSeq,
    };
  } catch {
    return { success: false, entries: [], chainIntact: false, totalEntries: 0, error: 'تعذر تحميل سجل التدقيق الأمني.' };
  }
}

export async function fetchSystemIntegrityAudit(): Promise<{
  success: boolean;
  report?: SystemIntegrityReport;
  persistenceStatus?: Record<string, unknown>;
  unauthorized?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch('/api/admin/security/integrity', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: getAdminAuthHeaders(),
    });
    const data = await safeReadJson(res);
    if (res.status === 401 || res.status === 403) {
      notifySessionExpired();
      return { success: false, unauthorized: true, error: data.error };
    }
    if (!res.ok) return { success: false, error: data.error || 'تعذر تنفيذ فحص السلامة.' };
    return {
      success: Boolean(data.success),
      report: data.report,
      persistenceStatus: data.persistenceStatus,
    };
  } catch {
    return { success: false, error: 'تعذر الاتصال بخدمة فحص السلامة.' };
  }
}

export async function fetchSecurityQuarantine(): Promise<{
  success: boolean;
  items: QuarantineVaultItem[];
  activeCount: number;
  unauthorized?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch('/api/admin/security/quarantine', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: getAdminAuthHeaders(),
    });
    const data = await safeReadJson(res);
    if (res.status === 401 || res.status === 403) {
      notifySessionExpired();
      return { success: false, items: [], activeCount: 0, unauthorized: true, error: data.error };
    }
    if (!res.ok) return { success: false, items: [], activeCount: 0, error: data.error };
    return {
      success: Boolean(data.success),
      items: Array.isArray(data.items) ? data.items : [],
      activeCount: Number(data.activeCount || 0),
    };
  } catch {
    return { success: false, items: [], activeCount: 0, error: 'تعذر جلب خزينة الحجر الأمني.' };
  }
}

export async function actOnQuarantineItem(
  id: string,
  action: 'inspect' | 'purge'
): Promise<{ success: boolean; item?: QuarantineVaultItem; error?: string }> {
  try {
    const res = await fetch(`/api/admin/security/quarantine/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action }),
    });
    const data = await safeReadJson(res);
    if (res.status === 401 || res.status === 403) {
      notifySessionExpired();
      return { success: false, error: data.error || 'الجلسة منتهية.' };
    }
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'فشل تنفيذ الإجراء على عنصر الحجر.' };
    }
    return { success: true, item: data.item };
  } catch {
    return { success: false, error: 'تعذر الاتصال بالخادم.' };
  }
}

export async function listServerBackupSnapshots(): Promise<{
  success: boolean;
  snapshots: RecoverySnapshotSummary[];
  unauthorized?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch('/api/admin/security/backup/snapshots', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: getAdminAuthHeaders(),
    });
    const data = await safeReadJson(res);
    if (res.status === 401 || res.status === 403) {
      notifySessionExpired();
      return { success: false, snapshots: [], unauthorized: true, error: data.error };
    }
    if (!res.ok) return { success: false, snapshots: [], error: data.error };
    return {
      success: Boolean(data.success),
      snapshots: Array.isArray(data.snapshots) ? data.snapshots : [],
    };
  } catch {
    return { success: false, snapshots: [], error: 'تعذر تحميل اللقطات الاحتياطية.' };
  }
}

export async function createServerSignedBackup(
  confirmPin: string,
  label?: string
): Promise<{
  success: boolean;
  snapshot?: any;
  snapshots?: RecoverySnapshotSummary[];
  requiresPinConfirmation?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch('/api/admin/security/backup/create', {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ confirmPin, label }),
    });
    const data = await safeReadJson(res);
    if (res.status === 401) {
      notifySessionExpired();
      return { success: false, error: data.error };
    }
    if (!res.ok || !data.success) {
      return {
        success: false,
        requiresPinConfirmation: Boolean(data.requiresPinConfirmation),
        error: data.error || 'تعذر إنشاء اللقطة الاحتياطية الموقعة.',
      };
    }
    return {
      success: true,
      snapshot: data.snapshot,
      snapshots: data.snapshots,
    };
  } catch {
    return { success: false, error: 'فشل الاتصال بالخادم لإنشاء اللقطة.' };
  }
}

export async function dryRunServerRecovery(params: {
  snapshotId?: string;
  bundle?: unknown;
}): Promise<{ success: boolean; dryRun?: RecoveryDryRunResult; error?: string }> {
  try {
    const res = await fetch('/api/admin/security/backup/dry-run', {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(params),
    });
    const data = await safeReadJson(res);
    if (res.status === 401) {
      notifySessionExpired();
      return { success: false, error: data.error };
    }
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'فشل الفحص المبدئي للنسخة الاحتياطية.' };
    }
    return { success: true, dryRun: data.dryRun };
  } catch {
    return { success: false, error: 'فشل الاتصال بالخادم أثناء الفحص المبدئي.' };
  }
}

export async function applyServerRecovery(params: {
  confirmPin: string;
  snapshotId?: string;
  bundle?: unknown;
  allowUnsigned?: boolean;
}): Promise<{
  success: boolean;
  preRestoreSnapshotId?: string;
  dryRun?: RecoveryDryRunResult;
  snapshots?: RecoverySnapshotSummary[];
  requiresPinConfirmation?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/admin/security/backup/restore', {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(params),
    });
    const data = await safeReadJson(res);
    if (res.status === 401) {
      notifySessionExpired();
      return { success: false, error: data.error };
    }
    if (!res.ok || !data.success) {
      return {
        success: false,
        requiresPinConfirmation: Boolean(data.requiresPinConfirmation),
        dryRun: data.dryRun,
        error: data.error || 'فشل تطبيق الاستعادة على الخادم.',
      };
    }
    return {
      success: true,
      preRestoreSnapshotId: data.preRestoreSnapshotId,
      dryRun: data.dryRun,
      snapshots: data.snapshots,
      message: data.message,
    };
  } catch {
    return { success: false, error: 'فشل الاتصال بالخادم أثناء الاستعادة.' };
  }
}

export async function rollbackServerRecovery(
  confirmPin: string,
  snapshotId?: string
): Promise<{
  success: boolean;
  restoredSnapshotId?: string;
  snapshots?: RecoverySnapshotSummary[];
  requiresPinConfirmation?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/admin/security/backup/rollback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ confirmPin, snapshotId }),
    });
    const data = await safeReadJson(res);
    if (res.status === 401) {
      notifySessionExpired();
      return { success: false, error: data.error };
    }
    if (!res.ok || !data.success) {
      return {
        success: false,
        requiresPinConfirmation: Boolean(data.requiresPinConfirmation),
        error: data.error || 'تعذر تنفيذ التراجع.',
      };
    }
    return {
      success: true,
      restoredSnapshotId: data.restoredSnapshotId,
      snapshots: data.snapshots,
      message: data.message,
    };
  } catch {
    return { success: false, error: 'تعذر الاتصال بالخادم لتنفيذ التراجع.' };
  }
}
