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
  CURRENT_LEGAL_POLICY_VERSION,
  getLegalConsentErrorMessage,
} from '../src/lib/legal';
import type {
  Language,
  LegalConsentAuditEntry,
  LegalConsentRecord,
} from '../src/types/index';

interface LegalConsentsDatabase {
  entries: LegalConsentAuditEntry[];
  updatedAt: string;
}

const LEGAL_CONSENTS_FILE = getDataFilePath('legal_consents.json');
const CLOUD_LEGAL_CONSENTS_KEY = 'echox:legal_consents';
const MAX_AUDIT_ENTRIES = 2000;

function createEmptyLegalDb(): LegalConsentsDatabase {
  return {
    entries: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function loadLegalConsentsDb(): LegalConsentsDatabase {
  try {
    if (fs.existsSync(LEGAL_CONSENTS_FILE)) {
      const parsed = JSON.parse(
        fs.readFileSync(LEGAL_CONSENTS_FILE, 'utf-8')
      ) as Partial<LegalConsentsDatabase>;
      if (parsed && Array.isArray(parsed.entries)) {
        return {
          entries: parsed.entries.slice(0, MAX_AUDIT_ENTRIES),
          updatedAt:
            typeof parsed.updatedAt === 'string'
              ? parsed.updatedAt
              : new Date().toISOString(),
        };
      }
    }
  } catch (err) {
    console.warn('[LegalEngine] Notice loading legal consents log:', err);
  }
  const initial = createEmptyLegalDb();
  try {
    atomicWriteJsonSync(LEGAL_CONSENTS_FILE, initial);
  } catch {}
  return initial;
}

let legalDb: LegalConsentsDatabase = loadLegalConsentsDb();
let lastLegalSyncAt = 0;

let legalWriteQueue: Promise<void> = Promise.resolve();
function withLegalDbLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = legalWriteQueue.then(fn, fn);
  legalWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function mergeRemoteIntoMemory(remote: Partial<LegalConsentsDatabase>): LegalConsentsDatabase {
  const merged: LegalConsentsDatabase = {
    entries: Array.isArray(remote.entries)
      ? remote.entries.slice(0, MAX_AUDIT_ENTRIES)
      : [],
    updatedAt:
      typeof remote.updatedAt === 'string'
        ? remote.updatedAt
        : new Date().toISOString(),
  };
  legalDb = merged;
  try {
    atomicWriteJsonSync(LEGAL_CONSENTS_FILE, merged);
  } catch {}
  return merged;
}

export async function hydrateLegalConsentsFromCloud(): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  const remote = await loadCloudJson<Partial<LegalConsentsDatabase>>(CLOUD_LEGAL_CONSENTS_KEY);
  lastLegalSyncAt = Date.now();
  if (remote && Array.isArray(remote.entries)) {
    mergeRemoteIntoMemory(remote);
  } else {
    await saveCloudJson(CLOUD_LEGAL_CONSENTS_KEY, legalDb).catch(() => {});
  }
}

export async function syncLegalConsentsIfStale(force = false, maxAgeMs = 3000): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  if (!force && Date.now() - lastLegalSyncAt < maxAgeMs) return;
  const remote = await loadCloudJson<Partial<LegalConsentsDatabase>>(CLOUD_LEGAL_CONSENTS_KEY);
  lastLegalSyncAt = Date.now();
  if (remote && Array.isArray(remote.entries)) {
    mergeRemoteIntoMemory(remote);
  }
}

export function maskIpForAudit(ip?: string): string | undefined {
  const raw = String(ip || '').trim();
  if (!raw) return undefined;
  // IPv4: mask last octet
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    const parts = raw.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  // IPv6: keep first 3 groups
  if (raw.includes(':')) {
    const parts = raw.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':')}::`;
  }
  return undefined;
}

function normalizeLanguage(raw?: unknown): Language {
  return raw === 'fr' || raw === 'en' ? raw : 'ar';
}

export function validateExplicitConsentPayload(
  rawConsent: unknown,
  fallbackLang: Language,
  opts: {
    source: 'customer_registration' | 'checkout_order';
    policyVersion?: string;
    requireReturns?: boolean;
  }
): { ok: true; record: LegalConsentRecord } | { ok: false; statusCode: number; error: string } {
  const kind = opts.source === 'checkout_order' ? 'checkout' : 'register';
  if (!rawConsent || typeof rawConsent !== 'object') {
    return {
      ok: false,
      statusCode: 400,
      error: getLegalConsentErrorMessage(fallbackLang, kind),
    };
  }
  const obj = rawConsent as Record<string, unknown>;
  const lang = obj.language === 'fr' || obj.language === 'en' || obj.language === 'ar'
    ? obj.language
    : fallbackLang;

  const termsAccepted = obj.termsAccepted === true;
  const privacyAccepted = obj.privacyAccepted === true;
  const returnsAccepted = opts.requireReturns ? obj.returnsAccepted !== false : undefined;

  if (!termsAccepted || !privacyAccepted || (opts.requireReturns && returnsAccepted === false)) {
    return {
      ok: false,
      statusCode: 400,
      error: getLegalConsentErrorMessage(lang, kind),
    };
  }

  const version =
    typeof opts.policyVersion === 'string' && opts.policyVersion.trim()
      ? opts.policyVersion.trim().slice(0, 32)
      : CURRENT_LEGAL_POLICY_VERSION;

  const clientTermsVersion =
    typeof obj.termsVersion === 'string' && obj.termsVersion.trim()
      ? obj.termsVersion.trim().slice(0, 32)
      : version;
  const clientPrivacyVersion =
    typeof obj.privacyVersion === 'string' && obj.privacyVersion.trim()
      ? obj.privacyVersion.trim().slice(0, 32)
      : version;

  const record: LegalConsentRecord = {
    termsAccepted: true,
    privacyAccepted: true,
    ...(opts.requireReturns ? { returnsAccepted: true } : {}),
    termsVersion: clientTermsVersion,
    privacyVersion: clientPrivacyVersion,
    acceptedAt: new Date().toISOString(),
    language: lang,
    source: opts.source,
  };

  return { ok: true, record };
}

export async function recordLegalConsentEvent(
  input: Omit<LegalConsentAuditEntry, 'id' | 'acceptedAt'> & { acceptedAt?: string }
): Promise<{ ok: boolean; entry?: LegalConsentAuditEntry }> {
  return withLegalDbLock(async () => {
    const cloudActive = isCloudPersistenceEnabled();
    const maxAttempts = cloudActive ? 3 : 1;

    const entry: LegalConsentAuditEntry = {
      id: `leg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      source: input.source,
      actorType: input.actorType,
      ...(input.actorId ? { actorId: String(input.actorId).slice(0, 120) } : {}),
      ...(input.actorLabel ? { actorLabel: String(input.actorLabel).slice(0, 140) } : {}),
      ...(input.trackingNumber ? { trackingNumber: String(input.trackingNumber).slice(0, 60) } : {}),
      termsAccepted: Boolean(input.termsAccepted),
      privacyAccepted: Boolean(input.privacyAccepted),
      ...(input.returnsAccepted !== undefined ? { returnsAccepted: Boolean(input.returnsAccepted) } : {}),
      ...(input.partnerAgreementAccepted !== undefined
        ? { partnerAgreementAccepted: Boolean(input.partnerAgreementAccepted) }
        : {}),
      ...(input.cookieConsentChoice ? { cookieConsentChoice: input.cookieConsentChoice } : {}),
      ...(input.requestType ? { requestType: input.requestType } : {}),
      ...(input.requestDetails ? { requestDetails: String(input.requestDetails).trim().slice(0, 800) } : {}),
      ...(input.requestStatus ? { requestStatus: input.requestStatus } : {}),
      termsVersion: String(input.termsVersion || CURRENT_LEGAL_POLICY_VERSION).slice(0, 32),
      privacyVersion: String(input.privacyVersion || CURRENT_LEGAL_POLICY_VERSION).slice(0, 32),
      language: normalizeLanguage(input.language),
      ...(input.ipMasked ? { ipMasked: input.ipMasked } : {}),
      acceptedAt: input.acceptedAt || new Date().toISOString(),
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let currentSnapshot = legalDb;
      let expectedUpdateTime: string | undefined;

      if (cloudActive) {
        const meta = await loadCloudJsonWithMeta<Partial<LegalConsentsDatabase>>(CLOUD_LEGAL_CONSENTS_KEY);
        if (meta.data && Array.isArray(meta.data.entries)) {
          currentSnapshot = mergeRemoteIntoMemory(meta.data);
          expectedUpdateTime = meta.updateTime;
        }
        lastLegalSyncAt = Date.now();
      }

      const now = new Date().toISOString();
      const nextDb: LegalConsentsDatabase = {
        entries: [entry, ...currentSnapshot.entries].slice(0, MAX_AUDIT_ENTRIES),
        updatedAt: now,
      };

      const persisted = await savePersistentJson(
        CLOUD_LEGAL_CONSENTS_KEY,
        LEGAL_CONSENTS_FILE,
        nextDb,
        {
          allowEphemeral: process.env.NODE_ENV !== 'production',
          expectedUpdateTime,
        }
      );

      if (persisted.ok) {
        legalDb = nextDb;
        lastLegalSyncAt = Date.now();
        return { ok: true, entry };
      }

      if (persisted.conflict && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 35 * attempt));
        continue;
      }

      return { ok: false };
    }

    return { ok: false };
  });
}

export async function updatePrivacyRequestStatus(
  entryId: string,
  nextStatus: 'reviewed' | 'completed'
): Promise<{ ok: boolean; statusCode?: number; error?: string; entry?: LegalConsentAuditEntry }> {
  return withLegalDbLock(async () => {
    const cloudActive = isCloudPersistenceEnabled();
    const maxAttempts = cloudActive ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let currentSnapshot = legalDb;
      let expectedUpdateTime: string | undefined;

      if (cloudActive) {
        const meta = await loadCloudJsonWithMeta<Partial<LegalConsentsDatabase>>(CLOUD_LEGAL_CONSENTS_KEY);
        if (meta.data && Array.isArray(meta.data.entries)) {
          currentSnapshot = mergeRemoteIntoMemory(meta.data);
          expectedUpdateTime = meta.updateTime;
        }
        lastLegalSyncAt = Date.now();
      }

      const idx = currentSnapshot.entries.findIndex((e) => e.id === entryId && e.source === 'privacy_request');
      if (idx === -1) {
        return { ok: false, statusCode: 404, error: 'طلب الخصوصية غير موجود.' };
      }

      const updated: LegalConsentAuditEntry = {
        ...currentSnapshot.entries[idx],
        requestStatus: nextStatus,
      };
      const nextDb: LegalConsentsDatabase = {
        entries: currentSnapshot.entries.map((e, i) => (i === idx ? updated : e)),
        updatedAt: new Date().toISOString(),
      };

      const persisted = await savePersistentJson(
        CLOUD_LEGAL_CONSENTS_KEY,
        LEGAL_CONSENTS_FILE,
        nextDb,
        {
          allowEphemeral: process.env.NODE_ENV !== 'production',
          expectedUpdateTime,
        }
      );

      if (persisted.ok) {
        legalDb = nextDb;
        lastLegalSyncAt = Date.now();
        return { ok: true, entry: updated };
      }

      if (persisted.conflict && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 35 * attempt));
        continue;
      }

      return { ok: false, statusCode: 503, error: 'تعذر تحديث حالة طلب الخصوصية.' };
    }

    return { ok: false, statusCode: 503, error: 'تعذر تحديث حالة طلب الخصوصية.' };
  });
}

export function getAdminLegalConsents(opts?: {
  source?: string;
  limit?: number;
}): {
  entries: LegalConsentAuditEntry[];
  summary: {
    totalConsents: number;
    checkoutConsents: number;
    registrationConsents: number;
    sellerConsents: number;
    cookieChoices: number;
    privacyRequests: number;
    pendingPrivacyRequests: number;
  };
} {
  const all = legalDb.entries || [];
  const sourceFilter = typeof opts?.source === 'string' && opts.source.trim() ? opts.source.trim() : '';
  const limit = Math.min(300, Math.max(10, Number(opts?.limit) || 100));

  const filtered = sourceFilter ? all.filter((e) => e.source === sourceFilter) : all;

  return {
    entries: filtered.slice(0, limit),
    summary: {
      totalConsents: all.length,
      checkoutConsents: all.filter((e) => e.source === 'checkout_order').length,
      registrationConsents: all.filter((e) => e.source === 'customer_registration').length,
      sellerConsents: all.filter((e) => e.source === 'seller_onboarding').length,
      cookieChoices: all.filter((e) => e.source === 'cookie_preferences').length,
      privacyRequests: all.filter((e) => e.source === 'privacy_request').length,
      pendingPrivacyRequests: all.filter(
        (e) => e.source === 'privacy_request' && e.requestStatus !== 'completed'
      ).length,
    },
  };
}
