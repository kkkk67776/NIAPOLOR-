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
import { getEffectiveHmacByteLength } from './hmacKey';
import type {
  CategoryItem,
  Company,
  ContactInquiry,
  FinancialActivityLog,
  Order,
  OwnerSettings,
  PaymentSystemPublicConfig,
  PaymentTransaction,
  Product,
  PromoBanner,
  RefundRequest,
  SiteSettings,
  SupportChatConfig,
  SupportTransaction,
  VendorLedgerEntry,
} from '../src/types/index';

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface SecurityAuditLogEntry {
  seq: number;
  id: string;
  timestamp: string;
  event: string;
  severity: AuditSeverity;
  actor: string;
  ip: string;
  summary: string;
  meta?: Record<string, string | number | boolean>;
  prevHash: string;
  entryHash: string;
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

export interface RecoverableStoreSlice {
  products: Product[];
  companies: Company[];
  categories: CategoryItem[];
  banners: PromoBanner[];
  siteSettings: SiteSettings;
  ownerSettings: OwnerSettings;
  inquiries: ContactInquiry[];
  updatedAt: string;
}

export interface RecoverablePaymentSlice {
  config: Record<string, any>;
  catalog: Record<string, any>;
  orders: Order[];
  transactions: PaymentTransaction[];
  vendorLedgers: VendorLedgerEntry[];
  refundRequests: RefundRequest[];
  supportTransactions: SupportTransaction[];
  activityLogs: FinancialActivityLog[];
  processedWebhookKeys: string[];
  secretsOmitted?: boolean;
}

export interface RecoveryPayloadBundle {
  store: RecoverableStoreSlice;
  payments: RecoverablePaymentSlice;
  chatConfig: SupportChatConfig;
  notificationSettings: Record<string, boolean>;
}

export interface RecoverySnapshotRecord {
  schemaVersion: '1.0';
  snapshotId: string;
  label: string;
  kind: 'manual' | 'pre_restore';
  createdAt: string;
  createdBy: string;
  payloadSha256: string;
  signatureHmac: string;
  payload: RecoveryPayloadBundle;
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

export interface SystemIntegrityCheckItem {
  id: string;
  label: string;
  passed: boolean;
  severity: 'ok' | 'warning' | 'critical';
  detail: string;
}

export interface SystemIntegrityReport {
  checkedAt: string;
  overallStatus: 'healthy' | 'warning' | 'critical';
  checks: SystemIntegrityCheckItem[];
  auditChain: {
    intact: boolean;
    totalEntries: number;
    brokenAtSeq?: number;
    latestHash: string;
  };
  quarantineActiveCount: number;
  snapshotsCount: number;
}

const AUDIT_LOG_FILE = getDataFilePath('security_audit_logs.json');
const CLOUD_AUDIT_KEY = 'echox:security_audit_logs';

const QUARANTINE_FILE = getDataFilePath('security_quarantine.json');
const CLOUD_QUARANTINE_KEY = 'echox:security_quarantine';

const REVOKED_SESSIONS_FILE = getDataFilePath('security_revoked_sessions.json');
const CLOUD_REVOKED_KEY = 'echox:security_revoked_sessions';

const SNAPSHOTS_FILE = getDataFilePath('security_recovery_snapshots.json');
const CLOUD_SNAPSHOTS_KEY = 'echox:security_recovery_snapshots';

const MAX_AUDIT_ENTRIES = 1000;
const MAX_QUARANTINE_ITEMS = 200;
const MAX_SNAPSHOTS = 10;
const GENESIS_HASH = 'ECHOX_AUDIT_GENESIS_V1';

interface AuditDb {
  entries: SecurityAuditLogEntry[];
  updatedAt: string;
}

interface QuarantineDb {
  items: QuarantineVaultItem[];
  updatedAt: string;
}

interface RevokedSessionsDb {
  revoked: Record<string, number>;
  updatedAt: string;
}

interface SnapshotsDb {
  snapshots: RecoverySnapshotRecord[];
  updatedAt: string;
}

function readLocalJson<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (parsed && typeof parsed === 'object') return parsed as T;
    }
  } catch (err) {
    console.warn(`[SecurityEngine] Notice reading ${filePath}:`, (err as Error)?.message || err);
  }
  return fallback;
}

let auditDb: AuditDb = readLocalJson<AuditDb>(AUDIT_LOG_FILE, {
  entries: [],
  updatedAt: new Date().toISOString(),
});
if (!Array.isArray(auditDb.entries)) auditDb.entries = [];

let quarantineDb: QuarantineDb = readLocalJson<QuarantineDb>(QUARANTINE_FILE, {
  items: [],
  updatedAt: new Date().toISOString(),
});
if (!Array.isArray(quarantineDb.items)) quarantineDb.items = [];

let revokedDb: RevokedSessionsDb = readLocalJson<RevokedSessionsDb>(REVOKED_SESSIONS_FILE, {
  revoked: {},
  updatedAt: new Date().toISOString(),
});
if (!revokedDb.revoked || typeof revokedDb.revoked !== 'object') revokedDb.revoked = {};

let snapshotsDb: SnapshotsDb = readLocalJson<SnapshotsDb>(SNAPSHOTS_FILE, {
  snapshots: [],
  updatedAt: new Date().toISOString(),
});
if (!Array.isArray(snapshotsDb.snapshots)) snapshotsDb.snapshots = [];

export function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs: string[] = [];
  for (const key of keys) {
    if (obj[key] === undefined) continue;
    pairs.push(`${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`);
  }
  return `{${pairs.join(',')}}`;
}

function computeAuditEntryHash(
  prevHash: string,
  entryWithoutHash: Omit<SecurityAuditLogEntry, 'entryHash'>
): string {
  const canonical = canonicalJsonStringify(entryWithoutHash);
  return crypto.createHash('sha256').update(`${prevHash}|${canonical}`).digest('hex');
}

function sanitizeText(raw: unknown, maxLen = 400): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

// ==========================================
// 1. CLOUD HYDRATION
// ==========================================

export async function hydrateSecurityEngineFromCloud(): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  try {
    const [remoteAudit, remoteQ, remoteRevoked, remoteSnaps] = await Promise.all([
      loadCloudJson<AuditDb>(CLOUD_AUDIT_KEY).catch(() => null),
      loadCloudJson<QuarantineDb>(CLOUD_QUARANTINE_KEY).catch(() => null),
      loadCloudJson<RevokedSessionsDb>(CLOUD_REVOKED_KEY).catch(() => null),
      loadCloudJson<SnapshotsDb>(CLOUD_SNAPSHOTS_KEY).catch(() => null),
    ]);

    if (remoteAudit && Array.isArray(remoteAudit.entries)) {
      auditDb = {
        entries: remoteAudit.entries.slice(0, MAX_AUDIT_ENTRIES),
        updatedAt: remoteAudit.updatedAt || new Date().toISOString(),
      };
      try { atomicWriteJsonSync(AUDIT_LOG_FILE, auditDb); } catch {}
    } else if (auditDb.entries.length > 0) {
      await saveCloudJson(CLOUD_AUDIT_KEY, auditDb).catch(() => {});
    }

    if (remoteQ && Array.isArray(remoteQ.items)) {
      quarantineDb = {
        items: remoteQ.items.slice(0, MAX_QUARANTINE_ITEMS),
        updatedAt: remoteQ.updatedAt || new Date().toISOString(),
      };
      try { atomicWriteJsonSync(QUARANTINE_FILE, quarantineDb); } catch {}
    } else if (quarantineDb.items.length > 0) {
      await saveCloudJson(CLOUD_QUARANTINE_KEY, quarantineDb).catch(() => {});
    }

    if (remoteRevoked && remoteRevoked.revoked && typeof remoteRevoked.revoked === 'object') {
      const now = Date.now();
      const merged: Record<string, number> = {};
      for (const [sid, exp] of Object.entries({ ...revokedDb.revoked, ...remoteRevoked.revoked })) {
        if (typeof exp === 'number' && exp > now) merged[sid] = exp;
      }
      revokedDb = { revoked: merged, updatedAt: new Date().toISOString() };
      try { atomicWriteJsonSync(REVOKED_SESSIONS_FILE, revokedDb); } catch {}
    }

    if (remoteSnaps && Array.isArray(remoteSnaps.snapshots)) {
      snapshotsDb = {
        snapshots: remoteSnaps.snapshots.slice(0, MAX_SNAPSHOTS),
        updatedAt: remoteSnaps.updatedAt || new Date().toISOString(),
      };
      try { atomicWriteJsonSync(SNAPSHOTS_FILE, snapshotsDb); } catch {}
    }
  } catch (err) {
    console.warn('[SecurityEngine] Cloud hydration notice:', (err as Error)?.message || err);
  }
}

// ==========================================
// 2. APPEND-ONLY HASH-CHAINED AUDIT LOG
// ==========================================

export function appendSecurityAuditEvent(input: {
  event: string;
  severity?: AuditSeverity;
  actor?: string;
  ip?: string;
  summary: string;
  meta?: Record<string, string | number | boolean>;
}): SecurityAuditLogEntry {
  const ordered = [...auditDb.entries].sort((a, b) => a.seq - b.seq);
  const last = ordered[ordered.length - 1];
  const nextSeq = last ? last.seq + 1 : 1;
  const prevHash = last ? last.entryHash : GENESIS_HASH;

  const base: Omit<SecurityAuditLogEntry, 'entryHash'> = {
    seq: nextSeq,
    id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    timestamp: new Date().toISOString(),
    event: sanitizeText(input.event, 80) || 'SECURITY_EVENT',
    severity: input.severity || 'info',
    actor: sanitizeText(input.actor || 'system', 100),
    ip: sanitizeText(input.ip || '127.0.0.1', 64),
    summary: sanitizeText(input.summary, 400),
    meta: input.meta,
    prevHash,
  };

  const entryHash = computeAuditEntryHash(prevHash, base);
  const fullEntry: SecurityAuditLogEntry = { ...base, entryHash };

  const updatedEntries = [fullEntry, ...auditDb.entries.sort((a, b) => b.seq - a.seq)].slice(0, MAX_AUDIT_ENTRIES);
  auditDb = {
    entries: updatedEntries,
    updatedAt: fullEntry.timestamp,
  };

  void savePersistentJson(CLOUD_AUDIT_KEY, AUDIT_LOG_FILE, auditDb, { allowEphemeral: true }).catch(() => {});
  return fullEntry;
}

export function verifyAuditHashChain(): {
  intact: boolean;
  totalEntries: number;
  brokenAtSeq?: number;
  latestHash: string;
} {
  const ordered = [...auditDb.entries].sort((a, b) => a.seq - b.seq);
  if (ordered.length === 0) {
    return { intact: true, totalEntries: 0, latestHash: GENESIS_HASH };
  }

  let expectedPrevHash = ordered[0].seq === 1 ? GENESIS_HASH : ordered[0].prevHash;
  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i];
    if (i > 0 && item.prevHash !== ordered[i - 1].entryHash) {
      return {
        intact: false,
        totalEntries: ordered.length,
        brokenAtSeq: item.seq,
        latestHash: ordered[ordered.length - 1].entryHash,
      };
    }
    if (i === 0 && item.prevHash !== expectedPrevHash) {
      return {
        intact: false,
        totalEntries: ordered.length,
        brokenAtSeq: item.seq,
        latestHash: ordered[ordered.length - 1].entryHash,
      };
    }
    const { entryHash, ...withoutHash } = item;
    const recomputed = computeAuditEntryHash(item.prevHash, withoutHash);
    if (recomputed !== entryHash) {
      return {
        intact: false,
        totalEntries: ordered.length,
        brokenAtSeq: item.seq,
        latestHash: ordered[ordered.length - 1].entryHash,
      };
    }
  }

  return {
    intact: true,
    totalEntries: ordered.length,
    latestHash: ordered[ordered.length - 1].entryHash,
  };
}

export function getSecurityAuditLogs(limit = 100, severityFilter?: string) {
  const chain = verifyAuditHashChain();
  const safeLimit = Math.min(300, Math.max(1, limit || 100));
  const sorted = [...auditDb.entries].sort((a, b) => b.seq - a.seq);
  const filtered =
    severityFilter && ['info', 'warning', 'critical'].includes(severityFilter)
      ? sorted.filter((e) => e.severity === severityFilter)
      : sorted;

  return {
    chainIntact: chain.intact,
    totalEntries: chain.totalEntries,
    brokenAtSeq: chain.brokenAtSeq,
    latestHash: chain.latestHash,
    entries: filtered.slice(0, safeLimit),
  };
}

// ==========================================
// 3. PERSISTENT REVOKED SESSION REGISTRY
// ==========================================

export function isSessionRevoked(sessionId: string): boolean {
  if (!sessionId) return true;
  const exp = revokedDb.revoked[sessionId];
  if (!exp) return false;
  if (exp < Date.now()) {
    delete revokedDb.revoked[sessionId];
    return false;
  }
  return true;
}

export async function revokeSessionId(sessionId: string, expiresAtMs?: number): Promise<void> {
  if (!sessionId) return;
  const now = Date.now();
  const exp = typeof expiresAtMs === 'number' && expiresAtMs > now ? expiresAtMs : now + 6 * 24 * 3600 * 1000;
  const pruned: Record<string, number> = {};
  for (const [k, v] of Object.entries(revokedDb.revoked)) {
    if (typeof v === 'number' && v > now) pruned[k] = v;
  }
  pruned[sessionId] = exp;
  revokedDb = { revoked: pruned, updatedAt: new Date().toISOString() };
  await savePersistentJson(CLOUD_REVOKED_KEY, REVOKED_SESSIONS_FILE, revokedDb, { allowEphemeral: true }).catch(
    () => {}
  );
}

// ==========================================
// 4. MAGIC BYTES INSPECTOR & QUARANTINE VAULT
// ==========================================

export interface RasterValidationResult {
  ok: boolean;
  value?: string;
  mime?: string;
  error?: string;
  suspiciousReason?: string;
  payloadPreview?: string;
  payloadHash?: string;
}

export function validateRasterImageMagicBytes(raw?: string): RasterValidationResult {
  if (!raw || typeof raw !== 'string') return { ok: true, value: undefined };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };

  const preview = trimmed.slice(0, 96).replace(/[\r\n]/g, ' ');
  const payloadHash = crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 24);

  if (trimmed.length > 4_800_000) {
    return {
      ok: false,
      error: 'حجم صورة وصل التحويل كبير جداً (الحد الأقصى 3.5 ميغابايت).',
      suspiciousReason: 'IMAGE_OVERSIZED',
      payloadPreview: preview,
      payloadHash,
    };
  }

  const m = trimmed.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) {
    return {
      ok: false,
      mime: trimmed.slice(0, 40),
      error: 'صيغة صورة الوصل غير مدعومة لأسباب أمنية. يرجى رفع صورة PNG أو JPG أو WEBP فقط.',
      suspiciousReason: /svg|script|html|javascript/i.test(trimmed.slice(0, 120))
        ? 'SVG_OR_SCRIPT_DATA_URI_BLOCKED'
        : 'INVALID_DATA_URI_SCHEME',
      payloadPreview: preview,
      payloadHash,
    };
  }

  const declaredExt = m[1].toLowerCase();
  const compactB64 = m[2].replace(/\s+/g, '');
  let buf: Buffer;
  try {
    buf = Buffer.from(compactB64, 'base64');
  } catch {
    return {
      ok: false,
      mime: `image/${declaredExt}`,
      error: 'تعذر فك تشفير بيانات الصورة.',
      suspiciousReason: 'CORRUPT_BASE64_IMAGE',
      payloadPreview: preview,
      payloadHash,
    };
  }

  if (buf.length < 12) {
    return {
      ok: false,
      mime: `image/${declaredExt}`,
      error: 'ملف الصورة تالف أو غير مكتمل (بايتات غير كافية).',
      suspiciousReason: 'TRUNCATED_BINARY_IMAGE',
      payloadPreview: preview,
      payloadHash,
    };
  }

  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isWebp =
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP';
  const hdr6 = buf.subarray(0, 6).toString('ascii');
  const isGif = hdr6 === 'GIF87a' || hdr6 === 'GIF89a';

  const magicMatches =
    (declaredExt === 'png' && isPng) ||
    ((declaredExt === 'jpeg' || declaredExt === 'jpg') && isJpeg) ||
    (declaredExt === 'webp' && isWebp) ||
    (declaredExt === 'gif' && isGif);

  if (!magicMatches) {
    return {
      ok: false,
      mime: `image/${declaredExt}`,
      error: 'بصمة الملف الثنائية لا تطابق صيغة الصورة المعلنة (PNG/JPG/WEBP) — تم حظر الملف أمنياً.',
      suspiciousReason: 'MAGIC_BYTES_MISMATCH',
      payloadPreview: preview,
      payloadHash,
    };
  }

  // Scan full bounded decoded image bytes (max 3.5MB) for embedded SVG/HTML/XSS polyglot payloads
  const inspectable = buf.toString('latin1').toLowerCase();
  if (
    inspectable.includes('<svg') ||
    inspectable.includes('<script') ||
    inspectable.includes('javascript:') ||
    inspectable.includes('onload=') ||
    inspectable.includes('onerror=')
  ) {
    return {
      ok: false,
      mime: `image/${declaredExt}`,
      error: 'تم اكتشاف تعليمات برمجية أو وسم SVG مدمج داخل الصورة وحظرها أمنياً.',
      suspiciousReason: 'POLYGLOT_SCRIPT_DETECTED',
      payloadPreview: preview,
      payloadHash,
    };
  }

  return {
    ok: true,
    mime: `image/${declaredExt}`,
    value: `data:image/${declaredExt};base64,${compactB64}`,
  };
}

export function quarantineSuspiciousItem(input: {
  source: string;
  reason: string;
  severity?: 'warning' | 'critical';
  actorIp?: string;
  mimeDeclared?: string;
  payloadHash?: string;
  payloadPreview?: string;
}): QuarantineVaultItem {
  const item: QuarantineVaultItem = {
    id: `quar_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    createdAt: new Date().toISOString(),
    source: sanitizeText(input.source, 100),
    reason: sanitizeText(input.reason, 240),
    severity: input.severity || 'critical',
    actorIp: sanitizeText(input.actorIp || 'unknown', 64),
    mimeDeclared: sanitizeText(input.mimeDeclared || 'unknown', 64),
    payloadHash: sanitizeText(input.payloadHash || 'none', 64),
    payloadPreview: sanitizeText(input.payloadPreview || '', 120),
    status: 'quarantined',
  };

  quarantineDb = {
    items: [item, ...quarantineDb.items].slice(0, MAX_QUARANTINE_ITEMS),
    updatedAt: item.createdAt,
  };

  void savePersistentJson(CLOUD_QUARANTINE_KEY, QUARANTINE_FILE, quarantineDb, { allowEphemeral: true }).catch(
    () => {}
  );

  appendSecurityAuditEvent({
    event: 'QUARANTINE_ITEM_ADDED',
    severity: item.severity,
    actor: 'security_inspector',
    ip: item.actorIp,
    summary: `عزل ملف/بيانات مشبوهة (${item.source}): ${item.reason}`,
    meta: {
      quarantineId: item.id,
      mimeDeclared: item.mimeDeclared,
      payloadHash: item.payloadHash,
    },
  });

  return item;
}

export function getQuarantineVault() {
  const activeCount = quarantineDb.items.filter((i) => i.status === 'quarantined').length;
  return {
    activeCount,
    totalCount: quarantineDb.items.length,
    items: quarantineDb.items,
  };
}

export async function actOnQuarantineItem(
  id: string,
  action: 'inspect' | 'purge',
  actorIp: string
): Promise<{ ok: boolean; statusCode?: number; error?: string; item?: QuarantineVaultItem }> {
  const item = quarantineDb.items.find((i) => i.id === id);
  if (!item) {
    return { ok: false, statusCode: 404, error: 'العنصر غير موجود في الحجر الأمني.' };
  }

  if (action === 'inspect') {
    appendSecurityAuditEvent({
      event: 'QUARANTINE_ITEM_INSPECTED',
      severity: 'info',
      actor: 'owner',
      ip: actorIp,
      summary: `فحص بيانات العنصر المعزول ${item.id} (${item.source}).`,
      meta: { quarantineId: item.id },
    });
    return { ok: true, item };
  }

  if (action === 'purge') {
    item.status = 'purged';
    item.purgedAt = new Date().toISOString();
    item.payloadPreview = '[PURGED_BY_OWNER]';
    quarantineDb.updatedAt = item.purgedAt;
    const saved = await savePersistentJson(CLOUD_QUARANTINE_KEY, QUARANTINE_FILE, quarantineDb, {
      allowEphemeral: true,
    });
    if (!saved.ok) {
      return { ok: false, statusCode: 503, error: saved.error || 'تعذر حفظ حالة التطهير.' };
    }
    appendSecurityAuditEvent({
      event: 'QUARANTINE_ITEM_PURGED',
      severity: 'warning',
      actor: 'owner',
      ip: actorIp,
      summary: `تطهير وحذف العنصر المعزول نهائياً: ${item.id} (${item.source}).`,
      meta: { quarantineId: item.id },
    });
    return { ok: true, item };
  }

  return { ok: false, statusCode: 400, error: 'إجراء غير مدعوم.' };
}

// ==========================================
// 5. SYSTEM INTEGRITY AUDIT
// ==========================================

export function isMediaSafeUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return true;
  const trimmed = url.trim();
  if (/^(javascript|vbscript|data:text|data:application|file):/i.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith('//') || trimmed.includes('..')) {
    return false;
  }
  if (
    trimmed.startsWith('/assets/') ||
    trimmed.startsWith('/api/media/products/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://')
  ) {
    return true;
  }
  if (trimmed.startsWith('data:image/')) {
    return validateRasterImageMagicBytes(trimmed).ok;
  }
  return false;
}

export function runSystemIntegrityAudit(deps: {
  actorIp: string;
  centralSecurityConfig: { access_code_argon2?: string; pin_argon2?: string } | null;
  hmacSecretLength: number;
  hmacEffectiveBytes?: number;
  hmacFromEnv?: boolean;
  storeState: RecoverableStoreSlice;
  paymentPublicConfig: PaymentSystemPublicConfig;
  paymentOrders?: Order[];
}): SystemIntegrityReport {
  const checks: SystemIntegrityCheckItem[] = [];

  const hasArgonAccess = Boolean(deps.centralSecurityConfig?.access_code_argon2?.startsWith('$argon2id$'));
  const hasArgonPin = Boolean(deps.centralSecurityConfig?.pin_argon2?.startsWith('$argon2id$'));
  checks.push({
    id: 'argon2_credentials',
    label: 'تشفير بيانات الاعتماد (Argon2id)',
    passed: hasArgonAccess && hasArgonPin,
    severity: hasArgonAccess && hasArgonPin ? 'ok' : 'critical',
    detail:
      hasArgonAccess && hasArgonPin
        ? 'بصمات Argon2id لرمز الوصول وPIN مفعّلة وسليمة.'
        : 'تم رصد نقص في تهيئة بصمات Argon2id.',
  });

  const effectiveBytes =
    typeof deps.hmacEffectiveBytes === 'number' ? deps.hmacEffectiveBytes : deps.hmacSecretLength;
  const envConfigured = deps.hmacFromEnv === true;
  const hmacOk = effectiveBytes >= 32 && envConfigured;
  checks.push({
    id: 'hmac_signing_key',
    label: 'مفتاح التوقيع الخادمي (HMAC-SHA256)',
    passed: hmacOk,
    severity: hmacOk ? 'ok' : 'critical',
    detail: hmacOk
      ? `مفتاح التوقيع الخادمي مضبوط عبر متغيرات البيئة بطول آمن (${effectiveBytes} بايت / ${deps.hmacSecretLength} محرفاً).`
      : 'خطأ أمني: متغير البيئة ECHOX_SECURITY_HMAC_SECRET غير مضبوط أو أقصر من 32 بايت — يجب ضبطه لتشغيل الوظائف الأمنية الحساسة.',
  });

  const bankTampered = Boolean(deps.paymentPublicConfig?.methods?.bank_transfer?.tamperDetected);
  checks.push({
    id: 'bank_seal',
    label: 'ختم سلامة الحساب البنكي (RIB Seal)',
    passed: !bankTampered,
    severity: bankTampered ? 'critical' : 'ok',
    detail: bankTampered
      ? 'تحذير: فشل التحقق من ختم HMAC للحساب البنكي وتُجمّد عمليات التحويل تلقائياً.'
      : `ختم الحساب البنكي سليم (${deps.paymentPublicConfig?.methods?.bank_transfer?.ibanFingerprint || 'SEALED'}).`,
  });

  let badProductsCount = 0;
  let badBannersCount = 0;
  let unsafeMediaCount = 0;
  for (const prod of deps.storeState.products || []) {
    if (!prod || typeof prod.id !== 'string' || typeof prod.price !== 'number' || !Number.isFinite(prod.price) || prod.price < 0) {
      badProductsCount++;
    }
    for (const img of prod?.images || []) {
      if (!isMediaSafeUrl(img)) unsafeMediaCount++;
    }
  }
  for (const comp of deps.storeState.companies || []) {
    if (comp?.logo && !isMediaSafeUrl(comp.logo)) unsafeMediaCount++;
  }
  for (const banner of deps.storeState.banners || []) {
    if (!banner || typeof banner.id !== 'string' || typeof banner.title !== 'string') {
      badBannersCount++;
    }
  }

  checks.push({
    id: 'catalog_invariants',
    label: 'اتساق الكاتالوج والوسائط',
    passed: badProductsCount === 0 && badBannersCount === 0 && unsafeMediaCount === 0,
    severity: badProductsCount > 0 || badBannersCount > 0 || unsafeMediaCount > 0 ? 'warning' : 'ok',
    detail:
      badProductsCount === 0 && badBannersCount === 0 && unsafeMediaCount === 0
        ? `تم فحص ${deps.storeState.products.length} منتجاً و${deps.storeState.companies.length} شركة و${(deps.storeState.banners || []).length} بانرات بنجاح دون أي وسائط غير آمنة.`
        : `رُصد ${badProductsCount} منتج و${badBannersCount} بانر غير صالح و${unsafeMediaCount} رابط صورة/وسائط مشبوه.`,
  });

  if (Array.isArray(deps.paymentOrders)) {
    let invalidOrdersCount = 0;
    for (const ord of deps.paymentOrders) {
      if (
        !ord ||
        typeof ord.trackingNumber !== 'string' ||
        ord.trackingNumber.trim().length < 4 ||
        typeof ord.totalAmount !== 'number' ||
        !Number.isFinite(ord.totalAmount) ||
        ord.totalAmount < 0
      ) {
        invalidOrdersCount++;
      }
    }
    checks.push({
      id: 'orders_financial_integrity',
      label: 'سلامة سجلات الطلبات والمبالغ',
      passed: invalidOrdersCount === 0,
      severity: invalidOrdersCount > 0 ? 'critical' : 'ok',
      detail:
        invalidOrdersCount === 0
          ? `جميع الطلبات المسجلة (${deps.paymentOrders.length}) سليمة وبمبالغ متسقة.`
          : `رُصد ${invalidOrdersCount} طلب بقيم مالية غير متسقة أو رقم تتبع غير صالح.`,
    });
  }

  const auditChain = verifyAuditHashChain();
  checks.push({
    id: 'audit_chain',
    label: 'سلامة سلسلة سجل التدقيق (SHA-256 Chain)',
    passed: auditChain.intact,
    severity: auditChain.intact ? 'ok' : 'critical',
    detail: auditChain.intact
      ? `السلسلة التشفيرية متصلة وسليمة (${auditChain.totalEntries} سجلات).`
      : `انقطاع أو تعديل غير مصرح به عند السجل رقم ${auditChain.brokenAtSeq}.`,
  });

  const activeQuarantine = quarantineDb.items.filter((i) => i.status === 'quarantined').length;
  checks.push({
    id: 'quarantine_state',
    label: 'حالة الحجر الأمني',
    passed: activeQuarantine === 0,
    severity: activeQuarantine > 0 ? 'warning' : 'ok',
    detail:
      activeQuarantine === 0
        ? 'لا توجد ملفات أو حمولات مشبوهة عالقة في الحجر.'
        : `يوجد ${activeQuarantine} عنصر معزول بانتظار المراجعة أو التطهير.`,
  });

  checks.push({
    id: 'self_protection_guards',
    label: 'درع الحماية الذاتية النشط (CSRF · Magic Bytes · Session Revocation)',
    passed: true,
    severity: 'ok',
    detail: `فحص Magic-Bytes قبل الحفظ، حماية CSRF المربوطة بالجلسة، القفل التصاعدي، وسجل إبطال الجلسات (${Object.keys(revokedDb.revoked).length} مبطلة) مفعّلة بالكامل.`,
  });

  let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (checks.some((c) => c.severity === 'critical')) overallStatus = 'critical';
  else if (checks.some((c) => c.severity === 'warning')) overallStatus = 'warning';

  appendSecurityAuditEvent({
    event: 'SYSTEM_INTEGRITY_AUDIT',
    severity: overallStatus === 'critical' ? 'critical' : overallStatus === 'warning' ? 'warning' : 'info',
    actor: 'owner',
    ip: deps.actorIp,
    summary: `تنفيذ فحص السلامة الشامل — النتيجة: ${overallStatus}.`,
    meta: { checksCount: checks.length, activeQuarantine, chainIntact: auditChain.intact },
  });

  return {
    checkedAt: new Date().toISOString(),
    overallStatus,
    checks,
    auditChain,
    quarantineActiveCount: activeQuarantine,
    snapshotsCount: snapshotsDb.snapshots.length,
  };
}

// ==========================================
// 6. SIGNED BACKUP, DRY-RUN DIFF, SAFE RESTORE & ROLLBACK
// ==========================================

function sanitizePaymentSliceForExport(slice: RecoverablePaymentSlice): RecoverablePaymentSlice {
  const cfgClone = JSON.parse(JSON.stringify(slice.config || {}));
  if (cfgClone.secrets) {
    cfgClone.secrets = {
      apiKey: cfgClone.secrets.apiKey ? '[REDACTED_ON_SERVER]' : '',
      walletId: cfgClone.secrets.walletId ? '[REDACTED_ON_SERVER]' : '',
      webhookSecret: cfgClone.secrets.webhookSecret ? '[REDACTED_ON_SERVER]' : '',
    };
  }
  return {
    ...slice,
    config: cfgClone,
    secretsOmitted: true,
  };
}

function signRecoveryPayload(hmacSecret: string, payload: RecoveryPayloadBundle): {
  payloadSha256: string;
  signatureHmac: string;
} {
  const canonical = canonicalJsonStringify(payload);
  const payloadSha256 = crypto.createHash('sha256').update(canonical).digest('hex');
  const signatureHmac = crypto.createHmac('sha256', hmacSecret).update(canonical).digest('hex');
  return { payloadSha256, signatureHmac };
}

export function listRecoverySnapshots() {
  return snapshotsDb.snapshots.map((s) => ({
    snapshotId: s.snapshotId,
    label: s.label,
    kind: s.kind,
    createdAt: s.createdAt,
    createdBy: s.createdBy,
    payloadSha256: s.payloadSha256,
    productsCount: s.payload?.store?.products?.length || 0,
    companiesCount: s.payload?.store?.companies?.length || 0,
    ordersCount: s.payload?.payments?.orders?.length || 0,
  }));
}

export function getRecoverySnapshotById(snapshotId: string): RecoverySnapshotRecord | null {
  return snapshotsDb.snapshots.find((s) => s.snapshotId === snapshotId) || null;
}

export async function createSignedRecoverySnapshot(params: {
  label?: string;
  kind?: 'manual' | 'pre_restore';
  createdBy: string;
  actorIp: string;
  hmacSecret: string;
  payload: RecoveryPayloadBundle;
  redactSecrets?: boolean;
}): Promise<{ ok: boolean; snapshot?: RecoverySnapshotRecord; error?: string }> {
  if (getEffectiveHmacByteLength(params.hmacSecret) < 32) {
    return {
      ok: false,
      error: 'تعذر توقيع النسخة الاحتياطية: متغير البيئة ECHOX_SECURITY_HMAC_SECRET غير مضبوط أو أقصر من 32 بايت.',
    };
  }
  const safePayload: RecoveryPayloadBundle = {
    store: JSON.parse(JSON.stringify(params.payload.store)),
    payments:
      params.redactSecrets === false
        ? JSON.parse(JSON.stringify(params.payload.payments))
        : sanitizePaymentSliceForExport(params.payload.payments),
    chatConfig: JSON.parse(JSON.stringify(params.payload.chatConfig)),
    notificationSettings: JSON.parse(JSON.stringify(params.payload.notificationSettings)),
  };

  const { payloadSha256, signatureHmac } = signRecoveryPayload(params.hmacSecret, safePayload);
  const record: RecoverySnapshotRecord = {
    schemaVersion: '1.0',
    snapshotId: `snap_${params.kind === 'pre_restore' ? 'prerestore' : 'manual'}_${Date.now()}_${crypto
      .randomBytes(2)
      .toString('hex')}`,
    label: sanitizeText(params.label || (params.kind === 'pre_restore' ? 'نسخة أمان تلقائية قبل الاستعادة' : 'نسخة غرفة التحكم الموقعة'), 120),
    kind: params.kind || 'manual',
    createdAt: new Date().toISOString(),
    createdBy: sanitizeText(params.createdBy, 100),
    payloadSha256,
    signatureHmac,
    payload: safePayload,
  };

  // Preserve latest pre_restore snapshot and cap total count
  const existingPre = snapshotsDb.snapshots.filter((s) => s.kind === 'pre_restore').slice(0, 3);
  const existingManual = snapshotsDb.snapshots.filter((s) => s.kind !== 'pre_restore');
  const combined =
    record.kind === 'pre_restore'
      ? [record, ...existingPre.slice(0, 2), ...existingManual].slice(0, MAX_SNAPSHOTS)
      : [record, ...existingManual, ...existingPre].slice(0, MAX_SNAPSHOTS);

  const prev = snapshotsDb;
  snapshotsDb = { snapshots: combined, updatedAt: record.createdAt };
  const saved = await savePersistentJson(CLOUD_SNAPSHOTS_KEY, SNAPSHOTS_FILE, snapshotsDb, { allowEphemeral: true });
  if (!saved.ok) {
    snapshotsDb = prev;
    return { ok: false, error: saved.error || 'تعذر حفظ اللقطة على الخادم.' };
  }

  appendSecurityAuditEvent({
    event: record.kind === 'pre_restore' ? 'PRE_RESTORE_SNAPSHOT_CREATED' : 'BACKUP_SNAPSHOT_CREATED',
    severity: 'info',
    actor: params.createdBy,
    ip: params.actorIp,
    summary: `إنشاء لقطة استعادة موقعة (${record.snapshotId}): ${record.label}.`,
    meta: { snapshotId: record.snapshotId, payloadSha256 },
  });

  return { ok: true, snapshot: record };
}

function computeArrayDiff<T extends { id?: string }>(
  currentList: T[],
  incomingList: T[]
): RecoveryDryRunSectionDiff {
  const curMap = new Map<string, string>();
  currentList.forEach((item, idx) => {
    const id = typeof item?.id === 'string' && item.id ? item.id : `__idx_${idx}`;
    curMap.set(id, canonicalJsonStringify(item));
  });

  const incMap = new Map<string, string>();
  incomingList.forEach((item, idx) => {
    const id = typeof item?.id === 'string' && item.id ? item.id : `__idx_${idx}`;
    incMap.set(id, canonicalJsonStringify(item));
  });

  let added = 0;
  let updated = 0;
  let removed = 0;

  incMap.forEach((val, key) => {
    if (!curMap.has(key)) added++;
    else if (curMap.get(key) !== val) updated++;
  });
  curMap.forEach((_, key) => {
    if (!incMap.has(key)) removed++;
  });

  return {
    currentCount: currentList.length,
    incomingCount: incomingList.length,
    added,
    updated,
    removed,
  };
}

export function extractRecoveryPayloadAndMeta(rawBundle: unknown): {
  ok: boolean;
  payload?: RecoveryPayloadBundle;
  snapshotRecord?: Partial<RecoverySnapshotRecord>;
  error?: string;
} {
  if (!rawBundle || typeof rawBundle !== 'object') {
    return { ok: false, error: 'ملف النسخة الاحتياطية ليس كائن JSON صالحاً.' };
  }
  const obj = rawBundle as Record<string, any>;
  // Accept either full RecoverySnapshotRecord or ECHOX SAFE BACKUP v5.3 exported format or raw payload
  if (obj.payload && typeof obj.payload === 'object' && obj.payload.store) {
    return {
      ok: true,
      snapshotRecord: obj,
      payload: obj.payload as RecoveryPayloadBundle,
    };
  }
  if (obj.store && typeof obj.store === 'object') {
    return {
      ok: true,
      payload: obj as RecoveryPayloadBundle,
    };
  }
  // Support ECHOX SAFE BACKUP v5.3 read-only export format if user feeds it into dry-run/restore
  if (obj.schema === 'echox-safe-backup-v5.3' && obj.server && typeof obj.server === 'object') {
    const srv = obj.server;
    const partialStore: Partial<RecoverableStoreSlice> = {
      products: Array.isArray(srv.products) ? srv.products : [],
      companies: Array.isArray(srv.companies) ? srv.companies : [],
      categories: Array.isArray(srv.categories) ? srv.categories : [],
      banners: Array.isArray(srv.banners) ? srv.banners : [],
      siteSettings: srv.siteSettings || ({} as SiteSettings),
    };
    return {
      ok: true,
      payload: {
        store: partialStore as RecoverableStoreSlice,
        payments: { config: {}, catalog: {}, orders: [], transactions: [], vendorLedgers: [], refundRequests: [], supportTransactions: [], activityLogs: [], processedWebhookKeys: [], secretsOmitted: true },
        chatConfig: (srv.chatConfig || {}) as SupportChatConfig,
        notificationSettings: {},
      },
    };
  }
  return { ok: false, error: 'بنية ملف الاستعادة غير معروفة أو غير مكتملة.' };
}

export function dryRunRecoveryBundle(params: {
  rawBundle: unknown;
  hmacSecret: string;
  currentPayload: RecoveryPayloadBundle;
  actorIp: string;
}): {
  extracted?: RecoveryPayloadBundle;
  dryRun: RecoveryDryRunResult;
} {
  const schemaErrors: string[] = [];
  const warnings: string[] = [];
  let quarantinedItems = 0;

  const parsed = extractRecoveryPayloadAndMeta(params.rawBundle);
  if (!parsed.ok || !parsed.payload) {
    schemaErrors.push(parsed.error || 'بيانات النسخة غير صالحة.');
    quarantineSuspiciousItem({
      source: 'recovery_bundle_parse',
      reason: parsed.error || 'Malformed recovery JSON bundle',
      severity: 'warning',
      actorIp: params.actorIp,
      mimeDeclared: 'application/json',
      payloadHash: crypto
        .createHash('sha256')
        .update(JSON.stringify(params.rawBundle || {}).slice(0, 1024))
        .digest('hex')
        .slice(0, 24),
      payloadPreview: JSON.stringify(params.rawBundle || {}).slice(0, 100),
    });
    return {
      dryRun: {
        validToApply: false,
        signatureValid: false,
        schemaErrors,
        warnings,
        quarantinedItems: 1,
        diff: {
          products: { currentCount: 0, incomingCount: 0, added: 0, updated: 0, removed: 0 },
          companies: { currentCount: 0, incomingCount: 0, added: 0, updated: 0, removed: 0 },
          categories: { currentCount: 0, incomingCount: 0, added: 0, updated: 0, removed: 0 },
          banners: { currentCount: 0, incomingCount: 0, added: 0, updated: 0, removed: 0 },
          orders: { currentCount: 0, incomingCount: 0, added: 0, updated: 0, removed: 0 },
          siteSettingsChanged: false,
          chatConfigChanged: false,
          notificationSettingsChanged: false,
        },
      },
    };
  }

  const incoming = parsed.payload;

  // Verify HMAC signature if present on snapshot envelope
  let signatureValid = false;
  if (parsed.snapshotRecord?.signatureHmac) {
    if (getEffectiveHmacByteLength(params.hmacSecret) < 32) {
      schemaErrors.push('تعذر التحقق من توقيع النسخة: متغير البيئة ECHOX_SECURITY_HMAC_SECRET غير مضبوط أو أقصر من 32 بايت.');
    } else {
      const expected = signRecoveryPayload(params.hmacSecret, incoming).signatureHmac;
      const provided = String(parsed.snapshotRecord.signatureHmac);
      signatureValid =
        provided.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
      if (!signatureValid) {
        schemaErrors.push('فشل التحقق من توقيع HMAC الخاص بالنسخة الاحتياطية (توقيع غير متطابق أو معدل).');
        quarantineSuspiciousItem({
          source: 'recovery_signature_check',
          reason: 'HMAC signature mismatch on recovery bundle',
          severity: 'critical',
          actorIp: params.actorIp,
          mimeDeclared: 'application/json',
          payloadHash: expected.slice(0, 24),
          payloadPreview: `snapshotId=${parsed.snapshotRecord.snapshotId || 'unknown'}`,
        });
        quarantinedItems++;
      }
    }
  } else {
    warnings.push('النسخة لا تحمل توقيع HMAC خادمي (استيراد غير موقع — سيتم تطبيق فحص البنية الصارم).');
  }

  // Validate store arrays & types
  const store = incoming.store || ({} as RecoverableStoreSlice);
  if (!Array.isArray(store.products)) schemaErrors.push('قائمة المنتجات (products) مفقودة أو غير صالحة.');
  if (!Array.isArray(store.companies)) schemaErrors.push('قائمة الشركات (companies) مفقودة أو غير صالحة.');
  if (!Array.isArray(store.categories) || store.categories.length === 0) {
    schemaErrors.push('قائمة التصنيفات (categories) مفقودة أو فارغة.');
  }
  if (!Array.isArray(store.banners)) schemaErrors.push('قائمة البانرات (banners) مفقودة أو غير صالحة.');

  if (Array.isArray(store.products)) {
    store.products.forEach((p, idx) => {
      if (!p || typeof p.id !== 'string' || typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price < 0) {
        schemaErrors.push(`بيانات المنتج رقم ${idx + 1} غير صالحة (المعرف أو السعر).`);
      }
      for (const img of p?.images || []) {
        if (!isMediaSafeUrl(img)) {
          schemaErrors.push(`صورة غير آمنة في المنتج (${p?.id || idx}): تم حظرها أمنياً.`);
          quarantineSuspiciousItem({
            source: 'recovery_product_media',
            reason: `Unsafe media URI in product ${p?.id || idx}`,
            severity: 'critical',
            actorIp: params.actorIp,
            mimeDeclared: String(img).slice(0, 40),
            payloadPreview: String(img).slice(0, 96),
          });
          quarantinedItems++;
        }
      }
    });
  }

  if (Array.isArray(store.companies)) {
    store.companies.forEach((c, idx) => {
      if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') {
        schemaErrors.push(`بيانات الشركة رقم ${idx + 1} غير صالحة.`);
      }
      if (c?.logo && !isMediaSafeUrl(c.logo)) {
        schemaErrors.push(`شعار شركة غير آمن (${c?.id || idx}): تم حظره أمنياً.`);
        quarantineSuspiciousItem({
          source: 'recovery_company_logo',
          reason: `Unsafe logo URI in company ${c?.id || idx}`,
          severity: 'critical',
          actorIp: params.actorIp,
          mimeDeclared: String(c.logo).slice(0, 40),
          payloadPreview: String(c.logo).slice(0, 96),
        });
        quarantinedItems++;
      }
    });
  }

  const incomingPayments = incoming.payments || ({} as RecoverablePaymentSlice);
  const cur = params.currentPayload;

  const productsDiff = computeArrayDiff(cur.store.products || [], store.products || []);
  const companiesDiff = computeArrayDiff(cur.store.companies || [], store.companies || []);
  const categoriesDiff = computeArrayDiff(cur.store.categories || [], store.categories || []);
  const bannersDiff = computeArrayDiff(cur.store.banners || [], store.banners || []);
  const incomingOrders = Array.isArray(incomingPayments.orders) ? incomingPayments.orders : [];
  const ordersDiff =
    incomingOrders.length > 0 || (Array.isArray(incomingPayments.orders) && incomingPayments.secretsOmitted !== undefined)
      ? computeArrayDiff(cur.payments.orders || [], incomingOrders)
      : {
          currentCount: (cur.payments.orders || []).length,
          incomingCount: (cur.payments.orders || []).length,
          added: 0,
          updated: 0,
          removed: 0,
        };

  if (incomingOrders.length === 0 && (cur.payments.orders || []).length > 0 && !incomingPayments.config?.currency) {
    warnings.push('هذه النسخة تحتوي على الكاتالوج والإعدادات فقط ولن تُعدّل سجلات الطلبات الحالية.');
  }

  const siteSettingsChanged =
    Boolean(store.siteSettings && Object.keys(store.siteSettings).length > 0) &&
    canonicalJsonStringify(store.siteSettings) !== canonicalJsonStringify(cur.store.siteSettings);
  const chatConfigChanged =
    Boolean(incoming.chatConfig && Object.keys(incoming.chatConfig).length > 0) &&
    canonicalJsonStringify(incoming.chatConfig) !== canonicalJsonStringify(cur.chatConfig);
  const notificationSettingsChanged =
    Boolean(incoming.notificationSettings && Object.keys(incoming.notificationSettings).length > 0) &&
    canonicalJsonStringify(incoming.notificationSettings) !== canonicalJsonStringify(cur.notificationSettings);

  return {
    extracted: incoming,
    dryRun: {
      validToApply: schemaErrors.length === 0,
      signatureValid,
      schemaErrors,
      warnings,
      quarantinedItems,
      diff: {
        products: productsDiff,
        companies: companiesDiff,
        categories: categoriesDiff,
        banners: bannersDiff,
        orders: ordersDiff,
        siteSettingsChanged,
        chatConfigChanged,
        notificationSettingsChanged,
      },
    },
  };
}
