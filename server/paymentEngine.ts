import crypto from 'crypto';
import fs from 'fs';
import {
  atomicWriteJsonSync,
  getDataFilePath,
  isCloudPersistenceEnabled,
  isRenderRuntime,
  loadCloudJson,
  loadCloudJsonWithMeta,
  saveCloudJson,
  savePersistentJson,
} from './cloudPersistence';
import {
  quarantineSuspiciousItem,
  validateRasterImageMagicBytes,
  type RecoverablePaymentSlice,
} from './securityEngine';
import { getValidatedHmacSecret, requireServerHmacSecret } from './hmacKey';
import type {
  CouponRule,
  DelegationShippingOverride,
  GovernorateShippingRule,
  InventoryAuditEntry,
  MultilingualText,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethodType,
  PaymentStatus,
  PaymentSystemPublicConfig,
  PaymentTransaction,
  Product,
  VendorLedgerEntry,
  VendorSubOrder,
  RefundRequest,
  SupportTransaction,
  FinancialActivityLog,
  TransferProof,
  PosteCcpTransferDetails,
} from '../src/types/index';
import {
  getGovernorateName,
  isValidDelegationForGovernorate,
  isValidGovernorate,
  normalizeTunisianPhone,
  TUNISIAN_GOVERNORATES,
} from '../src/data/governorates';
import { INITIAL_PRODUCTS } from '../src/data/initialData';

const PAYMENT_DATA_FILE = getDataFilePath('payment_system_data.json');
const CLOUD_PAYMENT_KEY = 'echox:payment_system_data';

interface ServerSecretsConfig {
  apiKey: string;
  walletId: string;
  webhookSecret: string;
}

interface InternalPaymentConfig extends PaymentSystemPublicConfig {
  secrets: ServerSecretsConfig;
  bankIntegritySeal?: string;
  shipping: {
    standardShippingFee: number | null;
    freeShippingThreshold: number | null;
    governorateRules: Record<string, GovernorateShippingRule>;
  };
  coupons: CouponRule[];
}

interface ProductCatalogEntry {
  id: string;
  sku?: string;
  name?: MultilingualText;
  image?: string;
  price: number;
  stock: number;
  companyId: string;
  companyName: string;
  active: boolean;
}

interface RecentCheckoutEntry {
  key: string;
  orderId: string;
  paymentUrl?: string;
  encryptedTrackingToken?: string;
  createdAt: number;
}

interface PaymentSystemDatabase {
  config: InternalPaymentConfig;
  catalog: Record<string, ProductCatalogEntry>;
  orders: Order[];
  transactions: PaymentTransaction[];
  vendorLedgers: VendorLedgerEntry[];
  refundRequests: RefundRequest[];
  supportTransactions: SupportTransaction[];
  activityLogs: FinancialActivityLog[];
  inventoryLogs: InventoryAuditEntry[];
  processedWebhookKeys: string[];
  recentCheckoutRequests?: RecentCheckoutEntry[];
}

interface StoreProductBridge {
  getProducts: () => Product[];
  adjustStockBatch: (adjustments: Array<{ productId: string; delta: number }>) => Promise<{ ok: boolean; error?: string }>;
}

let storeProductBridge: StoreProductBridge | null = null;

export function registerStoreProductBridge(bridge: StoreProductBridge): void {
  storeProductBridge = bridge;
}

function maskSecret(val: string): string | undefined {
  if (!val || val.trim().length === 0) return undefined;
  const trimmed = val.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

function buildDefaultCatalog(): Record<string, ProductCatalogEntry> {
  const map: Record<string, ProductCatalogEntry> = {};
  for (const prod of INITIAL_PRODUCTS) {
    map[prod.id] = {
      id: prod.id,
      sku: prod.sku || prod.id.toUpperCase(),
      name: prod.name,
      image: prod.images?.[0] || '',
      price: prod.price,
      stock: typeof prod.stock === 'number' && Number.isFinite(prod.stock) ? Math.max(0, Math.floor(prod.stock)) : 0,
      companyId: prod.companyId || 'comp_echox',
      companyName: prod.companyName || 'NIAPOLOR Distribution Tunisie',
      active: prod.active !== false,
    };
  }
  return map;
}

const DEFAULT_CATALOG: Record<string, ProductCatalogEntry> = buildDefaultCatalog();

const DEFAULT_COUPONS: CouponRule[] = [
  {
    code: 'NIAPOLOR2026',
    discountType: 'percentage',
    discountValue: 10,
    active: true,
    minSubtotal: 0,
    description: '10% launch promotion',
  },
  {
    code: 'NIAPOLOR10',
    discountType: 'percentage',
    discountValue: 10,
    active: true,
    minSubtotal: 0,
    description: '10% welcome discount',
  },
  {
    code: 'ECHOX2026',
    discountType: 'percentage',
    discountValue: 10,
    active: true,
    minSubtotal: 0,
    description: '10% store discount',
  },
  {
    code: 'ECHOX10',
    discountType: 'percentage',
    discountValue: 10,
    active: true,
    minSubtotal: 0,
    description: '10% voucher',
  },
];

function buildDefaultGovernorateRules(standardFee: number | null = 7.0): Record<string, GovernorateShippingRule> {
  const rules: Record<string, GovernorateShippingRule> = {};
  for (const gov of TUNISIAN_GOVERNORATES) {
    rules[gov.id] = {
      governorateId: gov.id,
      enabled: true,
      fee: standardFee,
      useStandardFee: true,
      estimatedDelivery: gov.deliveryEstimateDays,
      freeShippingThreshold: null,
      delegationOverrides: {},
    };
  }
  return rules;
}

function createInitialDb(): PaymentSystemDatabase {
  const now = new Date().toISOString();
  return {
    config: {
      currency: 'TND',
      commissionRatePercent: 10,
      taxRatePercent: 0,
      shipping: {
        standardShippingFee: 7.0,
        freeShippingThreshold: 150.0,
        governorateRules: buildDefaultGovernorateRules(7.0),
      },
      coupons: DEFAULT_COUPONS.map((c) => ({ ...c })),
      methods: {
        cod: { enabled: true },
        bank_transfer: {
          enabled: false, // Bank RIB is sealed internally for merchant settlement and never shown publicly
          accountHolder: 'ECHOX STORE TUNISIE SUARL',
          bankName: 'BIAT — Banque Internationale Arabe de Tunisie',
          ibanOrRib: 'TN59 0800 0000 1234 5678 9012',
          swiftCode: 'BIATTNTT',
          instructions: {
            ar: 'يرجى إجراء التحويل بالمبلغ الدقيق مع إدراج الرقم المرجعي للطلب في خانة البيان (Motif)، ثم إرسال إثبات التحويل للمراجعة والاعتماد.',
            fr: 'Veuillez effectuer le virement du montant exact en mentionnant la référence unique dans le motif, puis soumettre votre justificatif pour validation.',
            en: 'Please transfer the exact total amount including the unique order reference in the transfer note, then submit your transfer proof for admin verification.',
          },
        },
        online_payment: {
          enabled: false, // Disabled by default until live credentials & webhook secret are configured & verified
          provider: 'konnect',
          mode: 'sandbox',
          hasApiKey: false,
          hasWalletId: false,
          hasWebhookSecret: false,
          readyForLive: false,
        },
        poste_ccp: {
          enabled: true, // Uses sealed merchant RIB only on-demand when customer selects Poste Tunisienne / CCP Transfer
          instructions: {
            ar: 'يرجى إجراء التحويل عبر البريد التونسي (CCP / RIB) بالمبلغ الدقيق مع إدراج مرجع التحويل الفريد الخاص بالطلب في خانة البيان، ثم رفع وصل التحويل للمراجعة اليدوية من المالك.',
            fr: 'Veuillez effectuer le virement Poste Tunisienne (CCP / RIB) du montant exact avec la référence unique de commande, puis téléverser votre reçu pour vérification manuelle.',
            en: 'Please transfer the exact total via Poste Tunisienne / CCP using your unique order transfer reference, then upload the receipt for manual verification by the owner.',
          },
        },
      },
      secrets: {
        apiKey: process.env.KONNECT_API_KEY || '',
        walletId: process.env.KONNECT_WALLET_ID || '',
        webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
      },
      bankIntegritySeal: '',
      updatedAt: now,
    },
    catalog: { ...DEFAULT_CATALOG },
    orders: [],
    transactions: [],
    vendorLedgers: [],
    refundRequests: [],
    supportTransactions: [],
    activityLogs: [
      {
        id: `log_init_${Date.now()}`,
        action: 'PAYMENT_ENGINE_INITIALIZED',
        actor: 'system',
        details: 'Initialized NIAPOLOR multi-vendor payment engine (COD active, internal RIB sealed and hidden from storefront, Online Gateway pending credentials).',
        timestamp: now,
      },
    ],
    inventoryLogs: [],
    processedWebhookKeys: [],
  };
}

function mergeCatalogWithDefaults(rawCatalog?: Record<string, Partial<ProductCatalogEntry>>): Record<string, ProductCatalogEntry> {
  const merged: Record<string, ProductCatalogEntry> = { ...DEFAULT_CATALOG };
  if (!rawCatalog || typeof rawCatalog !== 'object') return merged;
  for (const [id, entry] of Object.entries(rawCatalog)) {
    if (!entry || typeof entry !== 'object') continue;
    const def = DEFAULT_CATALOG[id];
    merged[id] = {
      id: entry.id || id,
      sku: entry.sku ?? def?.sku ?? id.toUpperCase(),
      name: entry.name ?? def?.name,
      image: entry.image ?? def?.image ?? '',
      price: typeof entry.price === 'number' && Number.isFinite(entry.price) ? entry.price : def?.price ?? 0,
      stock:
        typeof entry.stock === 'number' && Number.isFinite(entry.stock)
          ? Math.max(0, Math.floor(entry.stock))
          : def?.stock ?? 0,
      companyId: entry.companyId || def?.companyId || 'comp_echox',
      companyName: entry.companyName || def?.companyName || 'NIAPOLOR Distribution Tunisie',
      active: entry.active !== undefined ? entry.active !== false : def?.active ?? true,
    };
  }
  return merged;
}

function mergeGovernorateRules(
  rawRules: Record<string, GovernorateShippingRule> | undefined,
  standardFee: number | null
): Record<string, GovernorateShippingRule> {
  const defaults = buildDefaultGovernorateRules(standardFee);
  if (!rawRules || typeof rawRules !== 'object') return defaults;
  const merged: Record<string, GovernorateShippingRule> = { ...defaults };
  for (const [govId, rule] of Object.entries(rawRules)) {
    if (!rule || typeof rule !== 'object') continue;
    const def = defaults[govId];
    merged[govId] = {
      governorateId: rule.governorateId || govId,
      enabled: rule.enabled !== undefined ? Boolean(rule.enabled) : def?.enabled ?? true,
      fee:
        rule.fee === null
          ? null
          : typeof rule.fee === 'number' && Number.isFinite(rule.fee) && rule.fee >= 0
          ? round3(rule.fee)
          : def?.fee ?? null,
      useStandardFee: rule.useStandardFee !== undefined ? Boolean(rule.useStandardFee) : false,
      estimatedDelivery:
        typeof rule.estimatedDelivery === 'string' && rule.estimatedDelivery.trim()
          ? rule.estimatedDelivery.trim()
          : def?.estimatedDelivery || '48 ساعة',
      freeShippingThreshold:
        rule.freeShippingThreshold === null
          ? null
          : typeof rule.freeShippingThreshold === 'number' && Number.isFinite(rule.freeShippingThreshold)
          ? round3(rule.freeShippingThreshold)
          : def?.freeShippingThreshold ?? null,
      delegationOverrides:
        rule.delegationOverrides && typeof rule.delegationOverrides === 'object'
          ? rule.delegationOverrides
          : {},
    };
  }
  return merged;
}

function mergeDatabaseSnapshot(raw: Partial<PaymentSystemDatabase>): PaymentSystemDatabase {
  const def = createInitialDb();
  const standardFee =
    raw.config?.shipping?.standardShippingFee === null
      ? null
      : typeof raw.config?.shipping?.standardShippingFee === 'number' &&
        Number.isFinite(raw.config.shipping.standardShippingFee)
      ? round3(raw.config.shipping.standardShippingFee)
      : def.config.shipping.standardShippingFee;
  const freeThreshold =
    raw.config?.shipping?.freeShippingThreshold === null
      ? null
      : typeof raw.config?.shipping?.freeShippingThreshold === 'number' &&
        Number.isFinite(raw.config.shipping.freeShippingThreshold)
      ? round3(raw.config.shipping.freeShippingThreshold)
      : def.config.shipping.freeShippingThreshold;

  return {
    ...def,
    ...raw,
    config: {
      ...def.config,
      ...(raw.config || {}),
      shipping: {
        standardShippingFee: standardFee,
        freeShippingThreshold: freeThreshold,
        governorateRules: mergeGovernorateRules(raw.config?.shipping?.governorateRules, standardFee),
      },
      coupons:
        Array.isArray(raw.config?.coupons)
          ? raw.config!.coupons
          : def.config.coupons,
      methods: {
        cod: { ...def.config.methods.cod, ...(raw.config?.methods?.cod || {}) },
        bank_transfer: {
          ...def.config.methods.bank_transfer,
          ...(raw.config?.methods?.bank_transfer || {}),
          instructions: {
            ...def.config.methods.bank_transfer.instructions,
            ...(raw.config?.methods?.bank_transfer?.instructions || {}),
          },
        },
        online_payment: {
          ...def.config.methods.online_payment,
          ...(raw.config?.methods?.online_payment || {}),
        },
        poste_ccp: {
          ...def.config.methods.poste_ccp,
          ...(raw.config?.methods?.poste_ccp || {}),
          instructions: {
            ...def.config.methods.poste_ccp.instructions,
            ...(raw.config?.methods?.poste_ccp?.instructions || {}),
          },
        },
      },
      secrets: {
        ...def.config.secrets,
        ...(raw.config?.secrets || {}),
      },
    },
    catalog: mergeCatalogWithDefaults(raw.catalog as Record<string, Partial<ProductCatalogEntry>>),
    orders: Array.isArray(raw.orders) ? raw.orders : [],
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    vendorLedgers: Array.isArray(raw.vendorLedgers) ? raw.vendorLedgers : [],
    refundRequests: Array.isArray(raw.refundRequests) ? raw.refundRequests : [],
    supportTransactions: Array.isArray(raw.supportTransactions) ? raw.supportTransactions : [],
    activityLogs: Array.isArray(raw.activityLogs) ? raw.activityLogs : def.activityLogs,
    inventoryLogs: Array.isArray(raw.inventoryLogs) ? raw.inventoryLogs : [],
    processedWebhookKeys: Array.isArray(raw.processedWebhookKeys) ? raw.processedWebhookKeys : [],
  };
}

function loadDatabase(): PaymentSystemDatabase {
  try {
    if (fs.existsSync(PAYMENT_DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PAYMENT_DATA_FILE, 'utf-8'));
      return mergeDatabaseSnapshot(raw);
    }
  } catch (err) {
    console.warn('[PaymentEngine] Notice loading payment DB, initializing fresh file:', err);
  }
  const initial = createInitialDb();
  if (!isRenderRuntime() || isCloudPersistenceEnabled()) {
    try {
      atomicWriteJsonSync(PAYMENT_DATA_FILE, initial);
    } catch (err) {
      console.warn('[PaymentEngine] Notice bootstrapping payment DB file:', err);
    }
  }
  return initial;
}

let paymentDb: PaymentSystemDatabase = loadDatabase();
let lastPaymentCloudSyncAt = 0;
let lastPaymentCloudUpdateTime: string | undefined;

// In-process serialized async mutex so concurrent checkouts, stock deductions & admin writes cannot interleave
let paymentWriteQueue: Promise<void> = Promise.resolve();

function withPaymentMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = paymentWriteQueue.then(fn, fn);
  paymentWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function saveDatabaseStrict(snapshotBeforeMutation?: string): Promise<{
  ok: boolean;
  statusCode?: number;
  error?: string;
  conflict?: boolean;
}> {
  const res = await savePersistentJson(CLOUD_PAYMENT_KEY, PAYMENT_DATA_FILE, paymentDb, {
    expectedUpdateTime: lastPaymentCloudUpdateTime,
  });
  if (!res.ok) {
    if (snapshotBeforeMutation) {
      try {
        paymentDb = JSON.parse(snapshotBeforeMutation) as PaymentSystemDatabase;
      } catch {
        // fallback leave unchanged
      }
    }
    return {
      ok: false,
      statusCode: res.conflict ? 409 : 503,
      conflict: res.conflict,
      error: res.error || 'تعذر تأكيد الحفظ الدائم لبيانات الدفع والطلبات.',
    };
  }
  lastPaymentCloudUpdateTime = undefined;
  lastPaymentCloudSyncAt = Date.now();
  return { ok: true };
}

function saveDatabaseBestEffort(): void {
  lastPaymentCloudSyncAt = Date.now();
  void savePersistentJson(CLOUD_PAYMENT_KEY, PAYMENT_DATA_FILE, paymentDb, { allowEphemeral: true }).catch(
    (err) => {
      console.warn('[PaymentEngine] Best-effort telemetry save notice:', err);
    }
  );
}

function getBankIntegritySecret(): string {
  return requireServerHmacSecret();
}

function getCanonicalBankFields(bank: {
  accountHolder?: string;
  bankName?: string;
  ibanOrRib?: string;
  swiftCode?: string;
}): string {
  return [
    (bank.accountHolder || '').trim(),
    (bank.bankName || '').trim(),
    (bank.ibanOrRib || '').trim(),
    (bank.swiftCode || '').trim(),
  ].join('|');
}

function computeBankSealWithKey(
  bank: {
    accountHolder?: string;
    bankName?: string;
    ibanOrRib?: string;
    swiftCode?: string;
  },
  secret: string
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`bank:${getCanonicalBankFields(bank)}`)
    .digest('hex');
}

function computeBankSeal(bank: {
  accountHolder?: string;
  bankName?: string;
  ibanOrRib?: string;
  swiftCode?: string;
}): string {
  return computeBankSealWithKey(bank, getBankIntegritySecret());
}

function computeIbanFingerprint(ibanOrRib: string): string {
  const clean = (ibanOrRib || '').replace(/\s+/g, '').toUpperCase();
  if (!clean) return 'NONE';
  const digest = crypto.createHash('sha256').update(clean).digest('hex').slice(0, 8).toUpperCase();
  return `${digest.slice(0, 4)}-${digest.slice(4, 8)}`;
}

export async function ensureInitialBankSealAfterHydrate(): Promise<void> {
  const hmacSecret = getValidatedHmacSecret();
  if (!hmacSecret) return;
  if (!paymentDb.config.bankIntegritySeal) {
    paymentDb.config.bankIntegritySeal = computeBankSealWithKey(
      paymentDb.config.methods.bank_transfer,
      hmacSecret
    );
    if (isCloudPersistenceEnabled()) {
      await saveCloudJson(CLOUD_PAYMENT_KEY, paymentDb).catch(() => {});
    }
    try {
      atomicWriteJsonSync(PAYMENT_DATA_FILE, paymentDb);
    } catch {}
  }
}

export async function hydratePaymentDbFromCloud(): Promise<void> {
  if (!isCloudPersistenceEnabled()) {
    await ensureInitialBankSealAfterHydrate();
    return;
  }
  const meta = await loadCloudJsonWithMeta<Partial<PaymentSystemDatabase>>(CLOUD_PAYMENT_KEY);
  lastPaymentCloudSyncAt = Date.now();
  lastPaymentCloudUpdateTime = meta.updateTime;
  const remote = meta.data;
  const hmacSecret = getValidatedHmacSecret();
  if (remote && typeof remote === 'object') {
    paymentDb = mergeDatabaseSnapshot(remote);
    if (!paymentDb.config.bankIntegritySeal && hmacSecret) {
      paymentDb.config.bankIntegritySeal = computeBankSealWithKey(
        paymentDb.config.methods.bank_transfer,
        hmacSecret
      );
      await saveCloudJson(CLOUD_PAYMENT_KEY, paymentDb).catch(() => {});
    }
    try {
      atomicWriteJsonSync(PAYMENT_DATA_FILE, paymentDb);
    } catch (err) {
      console.warn('[PaymentEngine] Notice syncing cloud snapshot to local file:', err);
    }
  } else {
    if (!paymentDb.config.bankIntegritySeal && hmacSecret) {
      paymentDb.config.bankIntegritySeal = computeBankSealWithKey(
        paymentDb.config.methods.bank_transfer,
        hmacSecret
      );
    }
    const seedRes = await saveCloudJson(CLOUD_PAYMENT_KEY, paymentDb);
    if (!seedRes.ok) {
      console.warn('[PaymentEngine] Initial cloud seed notice:', seedRes.error);
    } else {
      lastPaymentCloudUpdateTime = seedRes.updateTime;
    }
  }
}

export async function syncPaymentDbIfStale(force = false, maxAgeMs = 2500): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  if (!force && Date.now() - lastPaymentCloudSyncAt < maxAgeMs) return;
  const meta = await loadCloudJsonWithMeta<Partial<PaymentSystemDatabase>>(CLOUD_PAYMENT_KEY);
  lastPaymentCloudSyncAt = Date.now();
  lastPaymentCloudUpdateTime = meta.updateTime;
  if (meta.data && typeof meta.data === 'object') {
    paymentDb = mergeDatabaseSnapshot(meta.data);
    try {
      atomicWriteJsonSync(PAYMENT_DATA_FILE, paymentDb);
    } catch {}
  }
}

export function isEnvLockedBank(): boolean {
  return Boolean((process.env.LOCKED_BANK_IBAN || '').trim().length >= 8);
}

export function getVerifiedBankTransferPublic(): PaymentSystemPublicConfig['methods']['bank_transfer'] {
  const cfg = paymentDb.config;
  const rawBank = cfg.methods.bank_transfer;

  // Layer 1: Immutable Environment Variable Override
  const envIban = (process.env.LOCKED_BANK_IBAN || '').trim();
  if (envIban.length >= 8) {
    const accountHolder = (process.env.LOCKED_BANK_HOLDER || rawBank.accountHolder || '').trim();
    const bankName = (process.env.LOCKED_BANK_NAME || rawBank.bankName || '').trim();
    const swiftCode = (process.env.LOCKED_BANK_SWIFT || rawBank.swiftCode || '').trim();
    return {
      ...rawBank,
      accountHolder,
      bankName,
      ibanOrRib: envIban,
      swiftCode,
      integrityVerified: true,
      lockedByEnv: true,
      tamperDetected: false,
      ibanFingerprint: computeIbanFingerprint(envIban),
    };
  }

  // Layer 2: HMAC-SHA256 Seal Verification against disk/DB tampering
  const hmacSecret = getValidatedHmacSecret();
  if (!hmacSecret) {
    return {
      ...rawBank,
      enabled: false,
      ibanOrRib: '⚠️ التحويل البنكي معطّل مؤقتاً لعدم ضبط مفتاح التوقيع الخادمي',
      integrityVerified: false,
      lockedByEnv: false,
      tamperDetected: false,
      ibanFingerprint: 'UNCONFIGURED',
    };
  }
  const expectedSeal = computeBankSealWithKey(rawBank, hmacSecret);
  const storedSeal = (cfg.bankIntegritySeal || '').trim();
  const sealValid =
    storedSeal.length === expectedSeal.length &&
    crypto.timingSafeEqual(Buffer.from(storedSeal), Buffer.from(expectedSeal));

  if (!sealValid) {
    return {
      ...rawBank,
      enabled: false,
      ibanOrRib: '⚠️ تم تعليق التحويل البنكي تلقائياً لاكتشاف تعديل غير مصرّح به',
      integrityVerified: false,
      lockedByEnv: false,
      tamperDetected: true,
      ibanFingerprint: 'TAMPERED',
    };
  }

  return {
    ...rawBank,
    integrityVerified: true,
    lockedByEnv: false,
    tamperDetected: false,
    ibanFingerprint: computeIbanFingerprint(rawBank.ibanOrRib),
  };
}

export function isBankIdentityChange(incoming?: Partial<InternalPaymentConfig['methods']['bank_transfer']>): boolean {
  if (!incoming) return false;
  const current = paymentDb.config.methods.bank_transfer;
  const check = (nextVal: string | undefined, curVal: string | undefined) =>
    typeof nextVal === 'string' && nextVal.trim() !== (curVal || '').trim();
  return (
    check(incoming.ibanOrRib, current.ibanOrRib) ||
    check(incoming.accountHolder, current.accountHolder) ||
    check(incoming.bankName, current.bankName) ||
    check(incoming.swiftCode, current.swiftCode) ||
    (incoming.enabled === true && getVerifiedBankTransferPublic().tamperDetected === true)
  );
}

export function getActiveCatalogProductIds(): string[] {
  const activeIds = Object.values(paymentDb.catalog || {})
    .filter((item) => item && item.id && item.active !== false)
    .map((item) => String(item.id));
  return Array.from(new Set([...Object.keys(DEFAULT_CATALOG), ...activeIds]));
}

function appendActivity(
  action: string,
  actor: FinancialActivityLog['actor'],
  details: string,
  targetId?: string,
  amount?: number
): void {
  const entry: FinancialActivityLog = {
    id: `flog_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    action,
    actor,
    targetId,
    details,
    amount,
    timestamp: new Date().toISOString(),
  };
  paymentDb.activityLogs = [entry, ...paymentDb.activityLogs].slice(0, 300);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '').slice(-8);
}

function sanitizeReceiptImageDataUrl(
  raw?: string,
  context?: { source?: string; actorIp?: string }
): { ok: boolean; value?: string; error?: string } {
  const check = validateRasterImageMagicBytes(raw);
  if (!check.ok) {
    quarantineSuspiciousItem({
      source: context?.source || 'receipt_upload',
      reason: check.suspiciousReason || check.error || 'Rejected image receipt',
      severity: 'critical',
      actorIp: context?.actorIp || 'unknown',
      mimeDeclared: check.mime || 'unknown',
      payloadHash: check.payloadHash,
      payloadPreview: check.payloadPreview,
    });
    return { ok: false, error: check.error };
  }
  return { ok: true, value: check.value };
}

function isSafeHttpsUrl(rawUrl?: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function toMinorUnits(amount: number, currency: string): number {
  return currency === 'TND' ? Math.round(amount * 1000) : Math.round(amount * 100);
}

export function normalizePaymentMethod(method: PaymentMethodType): 'cod' | 'bank_transfer' | 'poste_ccp' | 'online_payment' {
  if (method === 'poste_ccp') return 'poste_ccp';
  if (method === 'bank_transfer') return 'bank_transfer';
  if (method === 'online_payment' || method === 'konnect' || method === 'flouci') return 'online_payment';
  return 'cod';
}

export const CCP_MANUAL_VERIFICATION_NOTICE =
  'لا يوجد تحقق آلي من CCP عبر API رسمي — يتم التحقق من وصول المبلغ الفعلي يدوياً في كشف الحساب البريدي/البنكي من طرف المالك قبل اعتماد الطلب وشحنه.';

export function getPosteCcpTransferDetails(): {
  ok: boolean;
  statusCode?: number;
  error?: string;
  details?: PosteCcpTransferDetails;
} {
  const cfg = paymentDb.config;
  if (!cfg.methods.poste_ccp?.enabled) {
    return {
      ok: false,
      statusCode: 403,
      error: 'وسيلة الدفع عبر Poste Tunisienne / CCP غير مفعّلة حالياً من مركز التحكم.',
    };
  }
  const verifiedBank = getVerifiedBankTransferPublic();
  if (verifiedBank.tamperDetected || verifiedBank.integrityVerified === false) {
    return {
      ok: false,
      statusCode: 403,
      error: 'تم تعليق عرض بيانات التحويل مؤقتاً لاكتشاف خلل في ختم الأمان الخاص بالحساب.',
    };
  }
  if (!verifiedBank.ibanOrRib || !verifiedBank.ibanOrRib.trim()) {
    return {
      ok: false,
      statusCode: 503,
      error: 'بيانات الـ RIB / CCP غير مضبوطة بعد في إعدادات المالك.',
    };
  }
  return {
    ok: true,
    details: {
      enabled: true,
      accountHolder: verifiedBank.accountHolder,
      bankName: verifiedBank.bankName,
      ibanOrRib: verifiedBank.ibanOrRib,
      swiftCode: verifiedBank.swiftCode,
      instructions: cfg.methods.bank_transfer.instructions || cfg.methods.poste_ccp.instructions,
      manualVerificationNotice: CCP_MANUAL_VERIFICATION_NOTICE,
    },
  };
}

export function isOnlineGatewayReady(): boolean {
  const s = paymentDb.config.secrets;
  const provider = paymentDb.config.methods.online_payment.provider || 'konnect';
  const hasBasicKeys = Boolean(s.apiKey && s.apiKey.trim().length >= 8 && s.walletId && s.walletId.trim().length >= 4);
  if (!hasBasicKeys) return false;
  if (provider === 'stripe_custom') {
    return Boolean(s.webhookSecret && s.webhookSecret.trim().length >= 8);
  }
  return true;
}

function getHiddenBankTransferPublic(): PaymentSystemPublicConfig['methods']['bank_transfer'] {
  return {
    enabled: false,
    accountHolder: '',
    bankName: '',
    ibanOrRib: '',
    swiftCode: '',
    instructions: { ar: '', fr: '', en: '' },
  };
}

function serializePublicCoupons(coupons: CouponRule[]): CouponRule[] {
  return (coupons || []).map((c) => ({
    code: c.code,
    discountType: c.discountType,
    discountValue: c.discountValue,
    active: c.active,
    expiresAt: c.expiresAt,
    minSubtotal: c.minSubtotal,
    maxDiscount: c.maxDiscount,
    description: c.description,
  }));
}

export function getPublicPaymentConfig(): PaymentSystemPublicConfig {
  const cfg = paymentDb.config;
  const ready = isOnlineGatewayReady();
  const provider = cfg.methods.online_payment.provider || 'konnect';
  const verifiedBank = getVerifiedBankTransferPublic();
  const posteCcpReady =
    Boolean(cfg.methods.poste_ccp?.enabled) &&
    verifiedBank.integrityVerified !== false &&
    !verifiedBank.tamperDetected &&
    Boolean(verifiedBank.ibanOrRib && verifiedBank.ibanOrRib.trim().length > 0);
  return {
    currency: cfg.currency,
    commissionRatePercent: cfg.commissionRatePercent,
    taxRatePercent: cfg.taxRatePercent,
    standardShippingFee: cfg.shipping.standardShippingFee,
    freeShippingThreshold: cfg.shipping.freeShippingThreshold,
    shippingRules: JSON.parse(JSON.stringify(cfg.shipping.governorateRules || {})),
    methods: {
      cod: { enabled: !!cfg.methods.cod.enabled },
      bank_transfer: getHiddenBankTransferPublic(),
      poste_ccp: {
        enabled: posteCcpReady,
        instructions: cfg.methods.poste_ccp?.instructions || { ar: '', fr: '', en: '' },
        integrityVerified: verifiedBank.integrityVerified,
        tamperDetected: verifiedBank.tamperDetected,
      },
      online_payment: {
        enabled: !!cfg.methods.online_payment.enabled && ready,
        provider,
        mode: cfg.methods.online_payment.mode || 'sandbox',
        hasApiKey: Boolean(cfg.secrets.apiKey && cfg.secrets.apiKey.trim().length > 0),
        hasWalletId: Boolean(cfg.secrets.walletId && cfg.secrets.walletId.trim().length > 0),
        hasWebhookSecret: Boolean(cfg.secrets.webhookSecret && cfg.secrets.webhookSecret.trim().length > 0),
        readyForLive: ready,
        lastConnectionCheck: cfg.methods.online_payment.lastConnectionCheck,
      },
    },
    updatedAt: cfg.updatedAt,
  };
}

export function getAdminPaymentConfig(): PaymentSystemPublicConfig {
  const cfg = paymentDb.config;
  const ready = isOnlineGatewayReady();
  const provider = cfg.methods.online_payment.provider || 'konnect';
  const verifiedBank = getVerifiedBankTransferPublic();
  return {
    currency: cfg.currency,
    commissionRatePercent: cfg.commissionRatePercent,
    taxRatePercent: cfg.taxRatePercent,
    standardShippingFee: cfg.shipping.standardShippingFee,
    freeShippingThreshold: cfg.shipping.freeShippingThreshold,
    shippingRules: JSON.parse(JSON.stringify(cfg.shipping.governorateRules || {})),
    coupons: serializePublicCoupons(cfg.coupons || []),
    methods: {
      cod: { enabled: !!cfg.methods.cod.enabled },
      bank_transfer: verifiedBank,
      poste_ccp: {
        enabled: !!cfg.methods.poste_ccp?.enabled,
        instructions: cfg.methods.poste_ccp?.instructions || { ar: '', fr: '', en: '' },
        integrityVerified: verifiedBank.integrityVerified,
        tamperDetected: verifiedBank.tamperDetected,
      },
      online_payment: {
        enabled: !!cfg.methods.online_payment.enabled && ready,
        provider,
        mode: cfg.methods.online_payment.mode || 'sandbox',
        hasApiKey: Boolean(cfg.secrets.apiKey && cfg.secrets.apiKey.trim().length > 0),
        hasWalletId: Boolean(cfg.secrets.walletId && cfg.secrets.walletId.trim().length > 0),
        hasWebhookSecret: Boolean(cfg.secrets.webhookSecret && cfg.secrets.webhookSecret.trim().length > 0),
        apiKeyMasked: maskSecret(cfg.secrets.apiKey),
        walletIdMasked: maskSecret(cfg.secrets.walletId),
        readyForLive: ready,
        lastConnectionCheck: cfg.methods.online_payment.lastConnectionCheck,
        webhookPath: `/api/payments/webhook/${provider}`,
      },
    },
    updatedAt: cfg.updatedAt,
  };
}

export async function syncCatalogSnapshot(
  products: Array<{
    id: string;
    sku?: string;
    name?: MultilingualText;
    images?: string[];
    image?: string;
    price: number;
    stock?: number;
    companyId?: string;
    companyName?: string;
    active?: boolean;
  }>,
  options?: { replaceAll?: boolean; allowEphemeral?: boolean }
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  if (!Array.isArray(products)) return { ok: true };
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);
    const snapshot = JSON.stringify(paymentDb);
    const seenIds = new Set<string>();
    for (const p of products) {
      if (!p || !p.id || typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price < 0) continue;
      seenIds.add(p.id);
      const prev = paymentDb.catalog[p.id];
      const nextStock =
        typeof p.stock === 'number' && Number.isFinite(p.stock)
          ? Math.max(0, Math.floor(p.stock))
          : prev?.stock ?? DEFAULT_CATALOG[p.id]?.stock ?? 0;
      const nextImage =
        typeof p.image === 'string' && p.image
          ? p.image
          : Array.isArray(p.images) && typeof p.images[0] === 'string'
          ? p.images[0]
          : prev?.image ?? DEFAULT_CATALOG[p.id]?.image ?? '';
      paymentDb.catalog[p.id] = {
        id: p.id,
        sku: p.sku || prev?.sku || p.id.toUpperCase(),
        name: p.name || prev?.name || DEFAULT_CATALOG[p.id]?.name,
        image: nextImage,
        price: round3(p.price),
        stock: nextStock,
        companyId: p.companyId || prev?.companyId || 'comp_echox',
        companyName: p.companyName || prev?.companyName || 'NIAPOLOR Distribution Tunisie',
        active: p.active !== false,
      };
    }
    if (options?.replaceAll) {
      Object.keys(paymentDb.catalog).forEach((catId) => {
        if (!seenIds.has(catId) && paymentDb.catalog[catId]) {
          paymentDb.catalog[catId].active = false;
        }
      });
    }
    if (options?.allowEphemeral) {
      saveDatabaseBestEffort();
      return { ok: true };
    }
    return saveDatabaseStrict(snapshot);
  });
}

export async function hardRemoveCatalogProduct(
  productId: string
): Promise<{ ok: boolean; statusCode?: number; error?: string; removed: boolean }> {
  const cleanId = (productId || '').trim();
  if (!cleanId) return { ok: true, removed: false };
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);
    if (!Object.prototype.hasOwnProperty.call(paymentDb.catalog, cleanId)) {
      return { ok: true, removed: false };
    }
    const snapshot = JSON.stringify(paymentDb);
    delete paymentDb.catalog[cleanId];
    appendActivity('CATALOG_PRODUCT_PURGED', 'admin', `Permanently removed product ${cleanId} from payment catalog.`, cleanId);
    const saved = await saveDatabaseStrict(snapshot);
    if (!saved.ok) {
      return { ok: false, statusCode: saved.statusCode || 503, error: saved.error, removed: false };
    }
    return { ok: true, removed: true };
  });
}

export async function updateAdminPaymentConfig(payload: {
  currency?: 'TND' | 'EUR' | 'USD';
  commissionRatePercent?: number;
  taxRatePercent?: number;
  standardShippingFee?: number | null;
  freeShippingThreshold?: number | null;
  shippingRules?: Record<string, Partial<GovernorateShippingRule>>;
  coupons?: CouponRule[];
  codEnabled?: boolean;
  posteCcpEnabled?: boolean;
  posteCcp?: { enabled?: boolean; instructions?: Partial<InternalPaymentConfig['methods']['poste_ccp']['instructions']> };
  bankTransfer?: Partial<InternalPaymentConfig['methods']['bank_transfer']>;
  onlinePayment?: {
    enabled?: boolean;
    provider?: 'konnect' | 'flouci' | 'stripe_custom';
    mode?: 'sandbox' | 'live';
    apiKey?: string;
    walletId?: string;
    webhookSecret?: string;
  };
}): Promise<{ ok: boolean; statusCode?: number; error?: string; config?: PaymentSystemPublicConfig }> {
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);
    const snapshot = JSON.stringify(paymentDb);
    const cfg = paymentDb.config;

    if (payload.currency && ['TND', 'EUR', 'USD'].includes(payload.currency)) {
      cfg.currency = payload.currency;
    }
    if (typeof payload.commissionRatePercent === 'number') {
      if (payload.commissionRatePercent < 0 || payload.commissionRatePercent > 50) {
        return { ok: false, statusCode: 400, error: 'نسبة عمولة المنصة يجب أن تكون بين 0% و 50%.' };
      }
      cfg.commissionRatePercent = round3(payload.commissionRatePercent);
    }
    if (typeof payload.taxRatePercent === 'number') {
      if (payload.taxRatePercent < 0 || payload.taxRatePercent > 40) {
        return { ok: false, statusCode: 400, error: 'نسبة الضريبة يجب أن تكون بين 0% و 40%.' };
      }
      cfg.taxRatePercent = round3(payload.taxRatePercent);
    }
    if (payload.standardShippingFee === null) {
      cfg.shipping.standardShippingFee = null;
      for (const rule of Object.values(cfg.shipping.governorateRules || {})) {
        if (rule.useStandardFee) {
          rule.fee = null;
        }
      }
    } else if (typeof payload.standardShippingFee === 'number' && Number.isFinite(payload.standardShippingFee) && payload.standardShippingFee >= 0) {
      const nextStd = round3(payload.standardShippingFee);
      cfg.shipping.standardShippingFee = nextStd;
      for (const rule of Object.values(cfg.shipping.governorateRules || {})) {
        if (rule.useStandardFee) {
          rule.fee = nextStd;
        }
      }
    }
    if (payload.freeShippingThreshold === null) {
      cfg.shipping.freeShippingThreshold = null;
    } else if (typeof payload.freeShippingThreshold === 'number' && Number.isFinite(payload.freeShippingThreshold) && payload.freeShippingThreshold >= 0) {
      cfg.shipping.freeShippingThreshold = round3(payload.freeShippingThreshold);
    }
    if (payload.shippingRules && typeof payload.shippingRules === 'object') {
      for (const [govId, patchRule] of Object.entries(payload.shippingRules)) {
        if (!isValidGovernorate(govId) || !patchRule || typeof patchRule !== 'object') {
          paymentDb = JSON.parse(snapshot) as PaymentSystemDatabase;
          return { ok: false, statusCode: 400, error: `قواعد الشحن للولاية (${govId}) غير صالحة.` };
        }
        const existingRule = cfg.shipping.governorateRules[govId] || buildDefaultGovernorateRules(cfg.shipping.standardShippingFee)[govId];
        if (
          patchRule.fee !== undefined &&
          patchRule.fee !== null &&
          (typeof patchRule.fee !== 'number' || !Number.isFinite(patchRule.fee) || patchRule.fee < 0)
        ) {
          paymentDb = JSON.parse(snapshot) as PaymentSystemDatabase;
          return { ok: false, statusCode: 400, error: `تعريفة الشحن للولاية (${govId}) غير صالحة.` };
        }
        const resolvedFee =
          patchRule.fee !== undefined
            ? patchRule.fee === null
              ? null
              : round3(patchRule.fee)
            : existingRule.fee;
        const resolvedUseStd =
          patchRule.useStandardFee !== undefined
            ? Boolean(patchRule.useStandardFee)
            : patchRule.fee !== undefined
            ? false
            : Boolean(existingRule.useStandardFee);

        const cleanOverrides: Record<string, DelegationShippingOverride> = {
          ...(existingRule.delegationOverrides || {}),
        };
        if (patchRule.delegationOverrides && typeof patchRule.delegationOverrides === 'object') {
          for (const [delName, delPatch] of Object.entries(patchRule.delegationOverrides)) {
            if (delPatch === null) {
              delete cleanOverrides[delName];
              continue;
            }
            if (!isValidDelegationForGovernorate(govId, delName)) {
              paymentDb = JSON.parse(snapshot) as PaymentSystemDatabase;
              return { ok: false, statusCode: 400, error: `المعتمدية (${delName}) غير تابعة لولاية ${govId}.` };
            }
            if (
              delPatch.fee !== undefined &&
              delPatch.fee !== null &&
              (typeof delPatch.fee !== 'number' || !Number.isFinite(delPatch.fee) || delPatch.fee < 0)
            ) {
              paymentDb = JSON.parse(snapshot) as PaymentSystemDatabase;
              return { ok: false, statusCode: 400, error: `تعريفة المعتمدية (${delName}) غير صالحة.` };
            }
            cleanOverrides[delName] = {
              ...(cleanOverrides[delName] || {}),
              ...(delPatch.enabled !== undefined ? { enabled: Boolean(delPatch.enabled) } : {}),
              ...(delPatch.fee !== undefined
                ? { fee: delPatch.fee === null ? null : round3(delPatch.fee) }
                : {}),
              ...(typeof delPatch.estimatedDelivery === 'string' && delPatch.estimatedDelivery.trim()
                ? { estimatedDelivery: delPatch.estimatedDelivery.trim().slice(0, 60) }
                : {}),
            };
          }
        }

        cfg.shipping.governorateRules[govId] = {
          governorateId: govId,
          enabled: patchRule.enabled !== undefined ? Boolean(patchRule.enabled) : existingRule.enabled,
          fee: resolvedFee,
          useStandardFee: resolvedUseStd,
          estimatedDelivery:
            typeof patchRule.estimatedDelivery === 'string' && patchRule.estimatedDelivery.trim()
              ? patchRule.estimatedDelivery.trim().slice(0, 60)
              : existingRule.estimatedDelivery,
          freeShippingThreshold:
            patchRule.freeShippingThreshold === null
              ? null
              : typeof patchRule.freeShippingThreshold === 'number' && Number.isFinite(patchRule.freeShippingThreshold) && patchRule.freeShippingThreshold >= 0
              ? round3(patchRule.freeShippingThreshold)
              : existingRule.freeShippingThreshold ?? null,
          delegationOverrides: cleanOverrides,
        };
      }
    }
    if (Array.isArray(payload.coupons)) {
      const normalizedCoupons: CouponRule[] = [];
      const seenCodes = new Set<string>();
      for (const rawCoupon of payload.coupons) {
        if (!rawCoupon || typeof rawCoupon.code !== 'string') continue;
        const code = rawCoupon.code.trim().toUpperCase();
        if (!code || code.length < 3 || seenCodes.has(code)) continue;
        const val = Number(rawCoupon.discountValue);
        const type = rawCoupon.discountType === 'fixed' ? 'fixed' : 'percentage';
        if (!Number.isFinite(val) || val <= 0 || (type === 'percentage' && val > 90)) {
          paymentDb = JSON.parse(snapshot) as PaymentSystemDatabase;
          return { ok: false, statusCode: 400, error: `قيمة الخصم لكود (${code}) غير صالحة.` };
        }
        seenCodes.add(code);
        normalizedCoupons.push({
          code,
          discountType: type,
          discountValue: round3(val),
          active: rawCoupon.active !== false,
          ...(typeof rawCoupon.expiresAt === 'string' && rawCoupon.expiresAt.trim()
            ? { expiresAt: rawCoupon.expiresAt.trim() }
            : {}),
          ...(typeof rawCoupon.minSubtotal === 'number' && Number.isFinite(rawCoupon.minSubtotal) && rawCoupon.minSubtotal >= 0
            ? { minSubtotal: round3(rawCoupon.minSubtotal) }
            : {}),
          ...(typeof rawCoupon.maxDiscount === 'number' && Number.isFinite(rawCoupon.maxDiscount) && rawCoupon.maxDiscount > 0
            ? { maxDiscount: round3(rawCoupon.maxDiscount) }
            : {}),
          ...(typeof rawCoupon.description === 'string' && rawCoupon.description.trim()
            ? { description: rawCoupon.description.trim().slice(0, 140) }
            : {}),
        });
      }
      cfg.coupons = normalizedCoupons;
    }

    if (typeof payload.codEnabled === 'boolean') {
      cfg.methods.cod.enabled = payload.codEnabled;
    }
    if (typeof payload.posteCcpEnabled === 'boolean') {
      cfg.methods.poste_ccp = {
        ...(cfg.methods.poste_ccp || { enabled: true, instructions: { ar: '', fr: '', en: '' } }),
        enabled: payload.posteCcpEnabled,
      };
    }
    if (payload.posteCcp) {
      cfg.methods.poste_ccp = {
        ...(cfg.methods.poste_ccp || { enabled: true, instructions: { ar: '', fr: '', en: '' } }),
        ...(typeof payload.posteCcp.enabled === 'boolean' ? { enabled: payload.posteCcp.enabled } : {}),
        instructions: {
          ...(cfg.methods.poste_ccp?.instructions || { ar: '', fr: '', en: '' }),
          ...(payload.posteCcp.instructions || {}),
        },
      };
    }
    if (payload.bankTransfer) {
      const identityChanged = isBankIdentityChange(payload.bankTransfer);
      if (identityChanged && isEnvLockedBank()) {
        return {
          ok: false,
          statusCode: 403,
          error: 'الحساب البنكي مقفول من متغيرات البيئة (LOCKED_BANK_IBAN) لحمايته من الاختراق ولا يمكن تغييره من اللوحة.',
        };
      }

      const prevIbanMask = maskSecret(cfg.methods.bank_transfer.ibanOrRib) || 'NONE';
      cfg.methods.bank_transfer = {
        ...cfg.methods.bank_transfer,
        ...payload.bankTransfer,
        instructions: {
          ...cfg.methods.bank_transfer.instructions,
          ...(payload.bankTransfer.instructions || {}),
        },
      };
      cfg.bankIntegritySeal = computeBankSeal(cfg.methods.bank_transfer);

      if (identityChanged) {
        const nextIbanMask = maskSecret(cfg.methods.bank_transfer.ibanOrRib) || 'NONE';
        appendActivity(
          'BANK_ACCOUNT_MODIFIED',
          'admin',
          `PIN-verified bank account update (${prevIbanMask} -> ${nextIbanMask}, fingerprint: ${computeIbanFingerprint(cfg.methods.bank_transfer.ibanOrRib)}).`
        );
      }
    }
    if (payload.onlinePayment) {
      if (payload.onlinePayment.provider) {
        cfg.methods.online_payment.provider = payload.onlinePayment.provider;
      }
      if (payload.onlinePayment.mode) {
        cfg.methods.online_payment.mode = payload.onlinePayment.mode;
      }
      if (typeof payload.onlinePayment.apiKey === 'string' && payload.onlinePayment.apiKey.trim().length > 0) {
        cfg.secrets.apiKey = payload.onlinePayment.apiKey.trim();
      }
      if (typeof payload.onlinePayment.walletId === 'string' && payload.onlinePayment.walletId.trim().length > 0) {
        cfg.secrets.walletId = payload.onlinePayment.walletId.trim();
      }
      if (typeof payload.onlinePayment.webhookSecret === 'string' && payload.onlinePayment.webhookSecret.trim().length > 0) {
        cfg.secrets.webhookSecret = payload.onlinePayment.webhookSecret.trim();
      }
      if (typeof payload.onlinePayment.enabled === 'boolean') {
        if (payload.onlinePayment.enabled && !isOnlineGatewayReady()) {
          paymentDb = JSON.parse(snapshot) as PaymentSystemDatabase;
          return {
            ok: false,
            statusCode: 400,
            error: 'تعذر تفعيل الدفع الإلكتروني: يجب إدخال مفتاح API ومعرّف المحفظة الحقيقيين (Wallet ID & API Key) على الخادم أولاً.',
          };
        }
        cfg.methods.online_payment.enabled = payload.onlinePayment.enabled;
      }
    }

    cfg.updatedAt = new Date().toISOString();
    appendActivity('PAYMENT_CONFIG_UPDATED', 'admin', 'Updated payment settings / shipping rules / coupons / rates from Admin Panel.');
    const saved = await saveDatabaseStrict(snapshot);
    if (!saved.ok) {
      return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
    }
    return { ok: true, config: getAdminPaymentConfig() };
  });
}

export async function testOnlineGatewayConnection(): Promise<{ ok: boolean; message: string; checkedAt: string }> {
  await syncPaymentDbIfStale(true);
  const checkedAt = new Date().toISOString();
  const provider = paymentDb.config.methods.online_payment.provider || 'konnect';
  const mode = paymentDb.config.methods.online_payment.mode || 'sandbox';

  if (!isOnlineGatewayReady()) {
    const msg =
      provider === 'stripe_custom'
        ? 'Gateway credentials missing: Custom/Stripe Bridge requires API Key, Wallet ID, and Webhook HMAC Secret.'
        : 'Gateway credentials missing: Configure real Provider API Key/App Token and Wallet ID/App Secret on server first.';
    paymentDb.config.methods.online_payment.lastConnectionCheck = { checkedAt, ok: false, message: msg };
    await saveDatabaseStrict();
    return { ok: false, message: msg, checkedAt };
  }

  if (provider === 'konnect') {
    const baseUrl =
      mode === 'live'
        ? 'https://api.konnect.network/api/v2/payments/test-check'
        : 'https://api.sandbox.konnect.network/api/v2/payments/test-check';
    try {
      const resp = await fetch(baseUrl, {
        method: 'GET',
        headers: {
          'x-api-key': paymentDb.config.secrets.apiKey,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.status === 401 || resp.status === 403) {
        const msg = `Konnect rejected credentials (HTTP ${resp.status}). Verify API Key matches ${mode} environment.`;
        paymentDb.config.methods.online_payment.lastConnectionCheck = { checkedAt, ok: false, message: msg };
        await saveDatabaseStrict();
        return { ok: false, message: msg, checkedAt };
      }
      const msg = `Konnect endpoint reachable (${mode}) and API key accepted (HTTP ${resp.status}).`;
      paymentDb.config.methods.online_payment.lastConnectionCheck = { checkedAt, ok: true, message: msg };
      appendActivity('GATEWAY_TEST_PASSED', 'admin', msg);
      await saveDatabaseStrict();
      return { ok: true, message: msg, checkedAt };
    } catch (err: any) {
      const msg = `Konnect connection check failed: ${err?.message || 'Network error'}`;
      paymentDb.config.methods.online_payment.lastConnectionCheck = { checkedAt, ok: false, message: msg };
      await saveDatabaseStrict();
      return { ok: false, message: msg, checkedAt };
    }
  }

  if (provider === 'flouci') {
    if (paymentDb.config.currency !== 'TND') {
      const msg = 'Flouci Tunisia supports TND currency only. Change store currency to TND first.';
      paymentDb.config.methods.online_payment.lastConnectionCheck = { checkedAt, ok: false, message: msg };
      await saveDatabaseStrict();
      return { ok: false, message: msg, checkedAt };
    }
    try {
      const resp = await fetch('https://developers.flouci.com/api/verify_payment/test_check', {
        method: 'GET',
        headers: {
          apppublic: paymentDb.config.secrets.apiKey,
          appsecret: paymentDb.config.secrets.walletId,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.status === 401 || resp.status === 403) {
        const msg = `Flouci rejected App Token / App Secret (HTTP ${resp.status}).`;
        paymentDb.config.methods.online_payment.lastConnectionCheck = { checkedAt, ok: false, message: msg };
        await saveDatabaseStrict();
        return { ok: false, message: msg, checkedAt };
      }
      const msg = `Flouci endpoint reachable and credentials format accepted (HTTP ${resp.status}).`;
      paymentDb.config.methods.online_payment.lastConnectionCheck = { checkedAt, ok: true, message: msg };
      appendActivity('GATEWAY_TEST_PASSED', 'admin', msg);
      await saveDatabaseStrict();
      return { ok: true, message: msg, checkedAt };
    } catch (err: any) {
      const msg = `Flouci connection check failed: ${err?.message || 'Network error'}`;
      paymentDb.config.methods.online_payment.lastConnectionCheck = { checkedAt, ok: false, message: msg };
      await saveDatabaseStrict();
      return { ok: false, message: msg, checkedAt };
    }
  }

  const msg = `Custom/Stripe Bridge configured with HMAC Webhook secret. Note: automatic checkout redirect requires Konnect or Flouci.`;
  paymentDb.config.methods.online_payment.lastConnectionCheck = { checkedAt, ok: true, message: msg };
  await saveDatabaseStrict();
  return { ok: true, message: msg, checkedAt };
}

function sanitizeOrigin(rawOrigin?: string): string {
  const fallback = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://echox-store.onrender.com').trim().replace(/\/$/, '');
  if (!rawOrigin || typeof rawOrigin !== 'string') return fallback;
  try {
    const u = new URL(rawOrigin.trim());
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      return `${u.protocol}//${u.host}`;
    }
  } catch {}
  return fallback;
}

function computeOrderWebhookToken(trackingRef: string): string {
  return crypto
    .createHmac('sha256', getBankIntegritySecret())
    .update(`wh1:${trackingRef}`)
    .digest('hex')
    .slice(0, 32);
}

async function initiateGatewaySession(params: {
  amount: number;
  currency: 'TND' | 'EUR' | 'USD';
  trackingRef: string;
  description: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  origin?: string;
}): Promise<{ ok: boolean; statusCode?: number; error?: string; externalPaymentId?: string; paymentUrl?: string; provider?: string }> {
  const cfg = paymentDb.config;
  const provider = cfg.methods.online_payment.provider || 'konnect';
  const mode = cfg.methods.online_payment.mode || 'sandbox';
  const origin = sanitizeOrigin(params.origin);
  const amountMinor = toMinorUnits(params.amount, params.currency);

  const successUrl = `${origin}/?payment_return=success&provider=${encodeURIComponent(provider)}&tracking=${encodeURIComponent(params.trackingRef)}`;
  const failUrl = `${origin}/?payment_return=fail&provider=${encodeURIComponent(provider)}&tracking=${encodeURIComponent(params.trackingRef)}`;

  if (provider === 'konnect') {
    const endpoint =
      mode === 'live'
        ? 'https://api.konnect.network/api/v2/payments/init-payment'
        : 'https://api.sandbox.konnect.network/api/v2/payments/init-payment';
    const whToken = computeOrderWebhookToken(params.trackingRef);
    try {
      const initRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.secrets.apiKey,
        },
        body: JSON.stringify({
          receiverWalletId: cfg.secrets.walletId,
          token: params.currency,
          amount: amountMinor,
          type: 'immediate',
          description: params.description,
          acceptedPaymentMethods: ['wallet', 'bank_card', 'e-DINAR'],
          lifespan: 20,
          checkoutForm: true,
          addPaymentFeesToAmount: false,
          orderId: params.trackingRef,
          firstName: params.customerName.trim(),
          phoneNumber: params.customerPhone.trim(),
          email: params.customerEmail?.trim() || undefined,
          webhook: `${origin}/api/payments/webhook/konnect/${whToken}`,
          successUrl,
          failUrl,
          silentWebhook: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const initJson: any = await initRes.json().catch(() => ({}));
      if (!initRes.ok || !isSafeHttpsUrl(initJson?.payUrl)) {
        appendActivity(
          'ONLINE_GATEWAY_INIT_FAILED',
          'system',
          `Konnect init failed for ${params.trackingRef}: HTTP ${initRes.status} ${JSON.stringify(initJson)}`
        );
        saveDatabaseBestEffort();
        return {
          ok: false,
          statusCode: 502,
          error: initJson?.message || 'فشل إنشاء جلسة الدفع الإلكتروني مع بوابة Konnect. يرجى التحقق من المفاتيح أو اختيار الدفع عند الاستلام.',
        };
      }
      return {
        ok: true,
        provider: 'konnect',
        externalPaymentId: String(initJson.paymentRef || ''),
        paymentUrl: initJson.payUrl,
      };
    } catch (err: any) {
      appendActivity('ONLINE_GATEWAY_NETWORK_ERROR', 'system', `Konnect init network failure: ${err?.message}`);
      saveDatabaseBestEffort();
      return {
        ok: false,
        statusCode: 502,
        error: 'تعذر الاتصال ببوابة Konnect حالياً. يرجى المحاولة لاحقاً أو اختيار الدفع عند الاستلام.',
      };
    }
  }

  if (provider === 'flouci') {
    if (params.currency !== 'TND') {
      return {
        ok: false,
        statusCode: 400,
        error: 'بوابة Flouci Tunisia تقبل عملة الدينار التونسي (TND) فقط.',
      };
    }
    try {
      const initRes = await fetch('https://developers.flouci.com/api/generate_payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_token: cfg.secrets.apiKey,
          app_secret: cfg.secrets.walletId,
          amount: amountMinor,
          accept_card: 'true',
          session_timeout_secs: 1200,
          success_link: successUrl,
          fail_link: failUrl,
          developer_tracking_id: params.trackingRef,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const initJson: any = await initRes.json().catch(() => ({}));
      const payLink = initJson?.result?.link;
      const payId = initJson?.result?.payment_id;
      if (!initRes.ok || !initJson?.result?.success || !isSafeHttpsUrl(payLink)) {
        appendActivity(
          'ONLINE_GATEWAY_INIT_FAILED',
          'system',
          `Flouci init failed for ${params.trackingRef}: HTTP ${initRes.status} ${JSON.stringify(initJson)}`
        );
        saveDatabaseBestEffort();
        return {
          ok: false,
          statusCode: 502,
          error: 'فشل إنشاء جلسة الدفع عبر بوابة Flouci. يرجى التحقق من App Token و App Secret في مركز التحكم.',
        };
      }
      return {
        ok: true,
        provider: 'flouci',
        externalPaymentId: String(payId || ''),
        paymentUrl: payLink,
      };
    } catch (err: any) {
      appendActivity('ONLINE_GATEWAY_NETWORK_ERROR', 'system', `Flouci init network failure: ${err?.message}`);
      saveDatabaseBestEffort();
      return {
        ok: false,
        statusCode: 502,
        error: 'تعذر الاتصال ببوابة Flouci حالياً. يرجى المحاولة لاحقاً أو اختيار الدفع عند الاستلام.',
      };
    }
  }

  return {
    ok: false,
    statusCode: 400,
    error: 'البوابة المختارة (Custom Bridge) تتطلب ربط رابط دفع خارجي مخصص؛ يرجى اختيار Konnect أو Flouci للدفع المباشر.',
  };
}

async function verifyGatewayPaymentRef(params: {
  provider: string;
  payRef: string;
  expectedAmount: number;
  expectedCurrency: string;
  expectedOrderId?: string;
}): Promise<{ ok: boolean; status: 'completed' | 'pending' | 'failed'; reason?: string; statusCode?: number }> {
  const cfg = paymentDb.config;
  const secrets = cfg.secrets;
  const expectedMinor = toMinorUnits(params.expectedAmount, params.expectedCurrency);

  if (params.provider === 'konnect') {
    if (!secrets.apiKey) return { ok: false, status: 'failed', reason: 'Missing Konnect API key', statusCode: 503 };
    const baseUrl =
      cfg.methods.online_payment.mode === 'live'
        ? `https://api.konnect.network/api/v2/payments/${encodeURIComponent(params.payRef)}`
        : `https://api.sandbox.konnect.network/api/v2/payments/${encodeURIComponent(params.payRef)}`;
    try {
      const checkRes = await fetch(baseUrl, {
        headers: { 'x-api-key': secrets.apiKey },
        signal: AbortSignal.timeout(10000),
      });
      const checkJson: any = await checkRes.json().catch(() => ({}));
      if (!checkRes.ok || !checkJson?.payment) {
        return { ok: false, status: 'failed', reason: `Konnect returned HTTP ${checkRes.status}`, statusCode: 502 };
      }
      const pStatus = String(checkJson.payment.status || '').toLowerCase();
      const paidAmount = Number(checkJson.payment.amount);
      const paidToken = String(checkJson.payment.token || params.expectedCurrency).toUpperCase();
      const gatewayOrderId = String(checkJson.payment.orderId || '').trim();

      if (
        params.expectedOrderId &&
        gatewayOrderId &&
        gatewayOrderId.toUpperCase() !== params.expectedOrderId.trim().toUpperCase()
      ) {
        return {
          ok: false,
          status: 'failed',
          reason: `Konnect orderId mismatch (${gatewayOrderId} != ${params.expectedOrderId})`,
          statusCode: 403,
        };
      }
      if (paidToken !== String(params.expectedCurrency).toUpperCase()) {
        return { ok: false, status: 'failed', reason: `Currency mismatch (${paidToken} != ${params.expectedCurrency})`, statusCode: 403 };
      }
      if (Number.isFinite(paidAmount) && Math.abs(paidAmount - expectedMinor) > 1) {
        return {
          ok: false,
          status: 'failed',
          reason: `Amount tamper mismatch (${paidAmount} != ${expectedMinor})`,
          statusCode: 403,
        };
      }
      if (pStatus === 'completed' || pStatus === 'paid') {
        return { ok: true, status: 'completed' };
      }
      if (pStatus === 'pending') {
        return { ok: true, status: 'pending' };
      }
      return { ok: true, status: 'failed', reason: `Konnect status=${pStatus}` };
    } catch {
      return { ok: false, status: 'failed', reason: 'Failed to reach Konnect verification API', statusCode: 502 };
    }
  }

  if (params.provider === 'flouci') {
    if (!secrets.apiKey || !secrets.walletId) {
      return { ok: false, status: 'failed', reason: 'Missing Flouci credentials', statusCode: 503 };
    }
    try {
      const checkRes = await fetch(`https://developers.flouci.com/api/verify_payment/${encodeURIComponent(params.payRef)}`, {
        method: 'GET',
        headers: {
          apppublic: secrets.apiKey,
          appsecret: secrets.walletId,
        },
        signal: AbortSignal.timeout(10000),
      });
      const checkJson: any = await checkRes.json().catch(() => ({}));
      const result = checkJson?.result;
      if (!checkRes.ok || !result) {
        return { ok: false, status: 'failed', reason: `Flouci returned HTTP ${checkRes.status}`, statusCode: 502 };
      }
      const gatewayTrackId = String(result.developer_tracking_id || '').trim();
      if (
        params.expectedOrderId &&
        gatewayTrackId &&
        gatewayTrackId.toUpperCase() !== params.expectedOrderId.trim().toUpperCase()
      ) {
        return {
          ok: false,
          status: 'failed',
          reason: `Flouci order tracking mismatch (${gatewayTrackId} != ${params.expectedOrderId})`,
          statusCode: 403,
        };
      }
      const fStatus = String(result.status || '').toUpperCase();
      if (fStatus === 'SUCCESS') {
        if (typeof result.amount === 'number' && Math.abs(result.amount - expectedMinor) > 1) {
          return {
            ok: false,
            status: 'failed',
            reason: `Flouci amount tamper mismatch (${result.amount} != ${expectedMinor})`,
            statusCode: 403,
          };
        }
        return { ok: true, status: 'completed' };
      }
      if (fStatus === 'PENDING' || fStatus === 'CREATED') {
        return { ok: true, status: 'pending' };
      }
      return { ok: true, status: 'failed', reason: `Flouci status=${fStatus}` };
    } catch {
      return { ok: false, status: 'failed', reason: 'Failed to reach Flouci verification API', statusCode: 502 };
    }
  }

  return { ok: false, status: 'failed', reason: 'Unsupported provider verification', statusCode: 400 };
}

function hashTrackingToken(rawToken: string): string {
  return crypto
    .createHmac('sha256', requireServerHmacSecret())
    .update(`trk1:${rawToken.trim()}`)
    .digest('hex');
}

function verifyTrackingTokenMatch(order: Order, rawToken?: string): boolean {
  const clean = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!clean || clean.length < 16 || !order.trackingTokenHash) return false;
  const candidate = hashTrackingToken(clean);
  const a = Buffer.from(candidate);
  const b = Buffer.from(order.trackingTokenHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encryptRecoveryTrackingToken(rawToken: string): string {
  const key = crypto.createHash('sha256').update(`rec1:${requireServerHmacSecret()}`).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${enc.toString('hex')}`;
}

function decryptRecoveryTrackingToken(cipherText?: string): string | undefined {
  if (!cipherText || typeof cipherText !== 'string') return undefined;
  const parts = cipherText.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const key = crypto.createHash('sha256').update(`rec1:${requireServerHmacSecret()}`).digest();
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const enc = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

export function stripOrderSecrets(order: Order): Order {
  const { trackingTokenHash: _omitHash, trackingToken: _omitTok, ...clean } = order;
  return clean;
}

function appendInventoryAudit(entry: Omit<InventoryAuditEntry, 'id' | 'timestamp'>): void {
  const full: InventoryAuditEntry = {
    ...entry,
    id: `inv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    timestamp: new Date().toISOString(),
  };
  paymentDb.inventoryLogs = [full, ...(paymentDb.inventoryLogs || [])].slice(0, 500);
}

export function calculateShippingForLocation(params: {
  governorate: string;
  delegation?: string;
  subtotal: number;
}): {
  ok: boolean;
  statusCode?: number;
  code?: 'SHIPPING_UNAVAILABLE' | 'SHIPPING_UNCONFIGURED' | 'INVALID_LOCATION';
  error?: string;
  shippingFee: number;
  baseFee: number;
  estimatedDelivery: string;
  freeShippingApplied: boolean;
} {
  const gov = String(params.governorate || '').trim();
  const delegation = String(params.delegation || '').trim();
  if (!isValidGovernorate(gov)) {
    return {
      ok: false,
      statusCode: 400,
      code: 'INVALID_LOCATION',
      error: 'يرجى اختيار الولاية التونسية من القائمة المعتمدة.',
      shippingFee: 0,
      baseFee: 0,
      estimatedDelivery: '',
      freeShippingApplied: false,
    };
  }
  if (delegation && !isValidDelegationForGovernorate(gov, delegation)) {
    return {
      ok: false,
      statusCode: 400,
      code: 'INVALID_LOCATION',
      error: 'يرجى اختيار المعتمدية التابعة للولاية المختارة.',
      shippingFee: 0,
      baseFee: 0,
      estimatedDelivery: '',
      freeShippingApplied: false,
    };
  }

  const cfg = paymentDb.config;
  const rules = cfg.shipping?.governorateRules || {};
  const rule = rules[gov];
  if (!rule) {
    return {
      ok: false,
      statusCode: 400,
      code: 'SHIPPING_UNCONFIGURED',
      error: 'قواعد الشحن لهذه الولاية غير مهيأة حالياً — يرجى التواصل مع الإدارة.',
      shippingFee: 0,
      baseFee: 0,
      estimatedDelivery: '',
      freeShippingApplied: false,
    };
  }

  const delOverride = delegation && rule.delegationOverrides ? rule.delegationOverrides[delegation] : undefined;
  if (rule.enabled === false || delOverride?.enabled === false) {
    return {
      ok: false,
      statusCode: 400,
      code: 'SHIPPING_UNAVAILABLE',
      error: 'التوصيل غير متاح حالياً لهذه المنطقة.',
      shippingFee: 0,
      baseFee: 0,
      estimatedDelivery: '',
      freeShippingApplied: false,
    };
  }

  let rawBaseFee: number | null | undefined;
  if (delOverride && delOverride.fee !== undefined) {
    rawBaseFee = delOverride.fee;
  } else if (rule.useStandardFee) {
    rawBaseFee = cfg.shipping.standardShippingFee;
  } else {
    rawBaseFee = rule.fee;
  }

  if (typeof rawBaseFee !== 'number' || !Number.isFinite(rawBaseFee) || rawBaseFee < 0) {
    return {
      ok: false,
      statusCode: 400,
      code: 'SHIPPING_UNCONFIGURED',
      error: 'تعريفة الشحن لهذه الولاية لم يتم ضبطها بعد.',
      shippingFee: 0,
      baseFee: 0,
      estimatedDelivery: '',
      freeShippingApplied: false,
    };
  }

  const baseFee = round3(rawBaseFee);
  const threshold =
    rule.freeShippingThreshold !== undefined && rule.freeShippingThreshold !== null
      ? rule.freeShippingThreshold
      : cfg.shipping.freeShippingThreshold;

  const freeShippingApplied =
    typeof threshold === 'number' && Number.isFinite(threshold) && threshold > 0 && params.subtotal >= threshold;
  const shippingFee = freeShippingApplied ? 0 : baseFee;
  const estimatedDelivery =
    (delOverride?.estimatedDelivery && delOverride.estimatedDelivery.trim()) ||
    rule.estimatedDelivery ||
    '48 ساعة';

  return {
    ok: true,
    shippingFee,
    baseFee,
    estimatedDelivery,
    freeShippingApplied,
  };
}

export function validateCouponServer(params: {
  couponCode?: string;
  subtotal: number;
}): {
  ok: boolean;
  statusCode?: number;
  code?: 'INVALID_COUPON' | 'EXPIRED_COUPON' | 'COUPON_MIN_SUBTOTAL';
  error?: string;
  discount: number;
  coupon: CouponRule | null;
} {
  const cleanCode = String(params.couponCode || '').trim().toUpperCase();
  if (!cleanCode) {
    return { ok: true, discount: 0, coupon: null };
  }
  const coupons = paymentDb.config.coupons || [];
  const found = coupons.find((c) => c.code.trim().toUpperCase() === cleanCode);
  if (!found || found.active === false) {
    return {
      ok: false,
      statusCode: 400,
      code: 'INVALID_COUPON',
      error: 'كود الخصم غير صالح أو تم إيقافه.',
      discount: 0,
      coupon: null,
    };
  }
  if (found.expiresAt) {
    const expMs = new Date(found.expiresAt).getTime();
    if (Number.isFinite(expMs) && expMs <= Date.now()) {
      return {
        ok: false,
        statusCode: 400,
        code: 'EXPIRED_COUPON',
        error: 'انتهت صلاحية كود الخصم هذا.',
        discount: 0,
        coupon: null,
      };
    }
  }
  if (typeof found.minSubtotal === 'number' && Number.isFinite(found.minSubtotal) && params.subtotal < found.minSubtotal) {
    return {
      ok: false,
      statusCode: 400,
      code: 'COUPON_MIN_SUBTOTAL',
      error: `يتطلب هذا الكوبون حداً أدنى للمشتريات قدره ${found.minSubtotal.toFixed(3)} ${paymentDb.config.currency}.`,
      discount: 0,
      coupon: null,
    };
  }

  let rawDiscount =
    found.discountType === 'fixed'
      ? found.discountValue
      : params.subtotal * (Math.min(100, Math.max(0, found.discountValue)) / 100);
  if (typeof found.maxDiscount === 'number' && Number.isFinite(found.maxDiscount) && found.maxDiscount > 0) {
    rawDiscount = Math.min(rawDiscount, found.maxDiscount);
  }
  const discount = round3(Math.min(params.subtotal, Math.max(0, rawDiscount)));

  return {
    ok: true,
    discount,
    coupon: { ...found },
  };
}

export interface ServerQuoteInput {
  items: Array<{
    productId: string;
    productName?: OrderItem['productName'];
    productImage?: string;
    unitPrice?: number;
    quantity: number;
  }>;
  governorate?: string;
  delegation?: string;
  couponCode?: string;
}

export function calculateServerOrderQuote(input: ServerQuoteInput): {
  ok: boolean;
  statusCode?: number;
  code?: string;
  error?: string;
  updatedPrices?: Array<{ productId: string; oldPrice: number; newPrice: number }>;
  verifiedItems?: OrderItem[];
  requestedQtyByProduct?: Map<string, number>;
  subtotal?: number;
  discount?: number;
  coupon?: CouponRule | null;
  taxAmount?: number;
  shippingFee?: number;
  estimatedDelivery?: string;
  freeShippingApplied?: boolean;
  totalAmount?: number;
  currency?: string;
} {
  if (!input || !Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, statusCode: 400, code: 'EMPTY_CART', error: 'السلة فارغة — لا يمكن حساب الفاتورة.' };
  }

  const cfg = paymentDb.config;
  const qtyByProduct = new Map<string, number>();
  const verifiedItems: OrderItem[] = [];
  const priceMismatches: Array<{ productId: string; oldPrice: number; newPrice: number }> = [];

  for (const rawItem of input.items) {
    const productId = String(rawItem?.productId || '').trim();
    const qty = Math.floor(Number(rawItem?.quantity));
    if (!productId || !Number.isFinite(qty) || qty <= 0 || qty > 1000) {
      return { ok: false, statusCode: 400, code: 'INVALID_QUANTITY', error: `كمية غير صالحة للمنتج ${productId || '?'}.` };
    }

    const catalogItem = paymentDb.catalog[productId];
    if (!catalogItem) {
      return {
        ok: false,
        statusCode: 400,
        code: 'UNKNOWN_PRODUCT',
        error: `تم رفض الطلب: المنتج (${productId}) غير موجود في الكاتالوج المعتمد على الخادم.`,
      };
    }
    if (!catalogItem.active) {
      return {
        ok: false,
        statusCode: 400,
        code: 'PRODUCT_INACTIVE',
        error: `المنتج ${productId} غير متاح حالياً للشراء.`,
      };
    }

    if (typeof rawItem.unitPrice === 'number' && Math.abs(rawItem.unitPrice - catalogItem.price) > 0.01) {
      priceMismatches.push({
        productId,
        oldPrice: rawItem.unitPrice,
        newPrice: catalogItem.price,
      });
    }

    qtyByProduct.set(productId, (qtyByProduct.get(productId) || 0) + qty);
    verifiedItems.push({
      productId,
      sku: catalogItem.sku || productId.toUpperCase(),
      productName:
        catalogItem.name ||
        (rawItem.productName && typeof rawItem.productName === 'object'
          ? rawItem.productName
          : { ar: productId, fr: productId, en: productId }),
      productImage: catalogItem.image || rawItem.productImage || '',
      companyId: catalogItem.companyId,
      companyName: catalogItem.companyName,
      unitPrice: catalogItem.price,
      quantity: qty,
      totalPrice: round3(catalogItem.price * qty),
    });
  }

  for (const [productId, totalQty] of qtyByProduct.entries()) {
    const catalogItem = paymentDb.catalog[productId];
    const availableStock = typeof catalogItem?.stock === 'number' ? Math.max(0, Math.floor(catalogItem.stock)) : 0;
    if (availableStock < totalQty) {
      return {
        ok: false,
        statusCode: 409,
        code: 'STOCK_UNAVAILABLE',
        error:
          availableStock === 0
            ? `عذراً، المنتج (${catalogItem.name?.ar || productId}) نفد من المخزون.`
            : `الكمية المطلوبة للمنتج (${catalogItem.name?.ar || productId}) تتجاوز المخزون المتوفر (${availableStock}).`,
      };
    }
  }

  const subtotal = round3(verifiedItems.reduce((sum, it) => sum + it.totalPrice, 0));

  const couponCheck = validateCouponServer({ couponCode: input.couponCode, subtotal });
  if (!couponCheck.ok) {
    return {
      ok: false,
      statusCode: couponCheck.statusCode || 400,
      code: couponCheck.code,
      error: couponCheck.error,
    };
  }

  const discount = couponCheck.discount;
  if (discount > 0 && subtotal > 0) {
    verifiedItems.forEach((it) => {
      it.discountApplied = round3(discount * (it.totalPrice / subtotal));
    });
  }
  const netItemsTotal = Math.max(0, round3(subtotal - discount));
  const taxAmount = round3(netItemsTotal * (cfg.taxRatePercent / 100));

  let shippingFee = 0;
  let estimatedDelivery = '';
  let freeShippingApplied = false;

  if (input.governorate && String(input.governorate).trim()) {
    const shipCheck = calculateShippingForLocation({
      governorate: String(input.governorate),
      delegation: input.delegation,
      subtotal,
    });
    if (!shipCheck.ok) {
      return {
        ok: false,
        statusCode: shipCheck.statusCode || 400,
        code: shipCheck.code,
        error: shipCheck.error,
      };
    }
    shippingFee = shipCheck.shippingFee;
    estimatedDelivery = shipCheck.estimatedDelivery;
    freeShippingApplied = shipCheck.freeShippingApplied;
  }

  const totalAmount = round3(netItemsTotal + taxAmount + shippingFee);

  if (priceMismatches.length > 0) {
    return {
      ok: false,
      statusCode: 400,
      code: 'PRICE_CHANGED',
      error: 'تم رفض الطلب: السعر المرسل لا يطابق السعر المعتمد على الخادم (تم تحديث الأسعار).',
      updatedPrices: priceMismatches,
      verifiedItems,
      subtotal,
      discount,
      coupon: couponCheck.coupon,
      taxAmount,
      shippingFee,
      estimatedDelivery,
      freeShippingApplied,
      totalAmount,
      currency: cfg.currency,
    };
  }

  return {
    ok: true,
    verifiedItems,
    requestedQtyByProduct: qtyByProduct,
    subtotal,
    discount,
    coupon: couponCheck.coupon,
    taxAmount,
    shippingFee,
    estimatedDelivery,
    freeShippingApplied,
    totalAmount,
    currency: cfg.currency,
  };
}

export async function recoverCheckoutByRequestId(clientRequestId: string): Promise<{
  ok: boolean;
  found: boolean;
  order?: Order;
  transaction?: PaymentTransaction;
  paymentUrl?: string;
  trackingToken?: string;
  transferDetails?: PosteCcpTransferDetails;
}> {
  const cleanKey = String(clientRequestId || '').trim();
  if (!cleanKey || cleanKey.length < 8) {
    return { ok: false, found: false };
  }
  await syncPaymentDbIfStale(true);
  const nowMs = Date.now();
  const entry = (paymentDb.recentCheckoutRequests || []).find(
    (r) => r.key === cleanKey && nowMs - r.createdAt < 10 * 60 * 1000
  );
  if (!entry) {
    return { ok: true, found: false };
  }
  const order = paymentDb.orders.find((o) => o.id === entry.orderId);
  const transaction = paymentDb.transactions.find((t) => t.orderId === entry.orderId);
  if (!order || !transaction) {
    return { ok: true, found: false };
  }
  const ccpDetails =
    order.paymentMethod === 'poste_ccp' ? getPosteCcpTransferDetails() : undefined;
  return {
    ok: true,
    found: true,
    order: stripOrderSecrets(order),
    transaction,
    paymentUrl: entry.paymentUrl,
    trackingToken: decryptRecoveryTrackingToken(entry.encryptedTrackingToken),
    transferDetails: ccpDetails?.ok ? ccpDetails.details : undefined,
  };
}

export interface ServerCheckoutInput {
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  shippingAddress: Order['shippingAddress'];
  items: Array<{
    productId: string;
    productName: OrderItem['productName'];
    productImage?: string;
    unitPrice?: number;
    quantity: number;
    companyId?: string;
    companyName?: string;
  }>;
  couponCode?: string;
  paymentMethod: PaymentMethodType;
  clientExpectedTotal?: number;
  carrierName?: string;
  notes?: string;
  transferProof?: Partial<TransferProof>;
  origin?: string;
  clientRequestId?: string;
  actorIp?: string;
}

export async function processServerCheckout(input: ServerCheckoutInput): Promise<{
  ok: boolean;
  statusCode?: number;
  code?: string;
  error?: string;
  updatedPrices?: Array<{ productId: string; oldPrice: number; newPrice: number }>;
  updatedQuote?: {
    subtotal: number;
    discount: number;
    taxAmount: number;
    shippingFee: number;
    totalAmount: number;
    estimatedDelivery?: string;
  };
  order?: Order;
  transaction?: PaymentTransaction;
  paymentUrl?: string;
  trackingToken?: string;
  transferDetails?: PosteCcpTransferDetails;
}> {
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);

    // Sync any newly added admin products stock from storefront bridge if missing in payment catalog
    if (storeProductBridge) {
      try {
        const storeProducts = storeProductBridge.getProducts();
        for (const sp of storeProducts) {
          if (sp && sp.id && !paymentDb.catalog[sp.id]) {
            paymentDb.catalog[sp.id] = {
              id: sp.id,
              sku: sp.sku || sp.id.toUpperCase(),
              name: sp.name,
              image: sp.images?.[0] || '',
              price: round3(sp.price),
              stock: typeof sp.stock === 'number' ? Math.max(0, Math.floor(sp.stock)) : 0,
              companyId: sp.companyId || 'comp_echox',
              companyName: sp.companyName || 'NIAPOLOR Distribution Tunisie',
              active: sp.active !== false,
            };
          }
        }
      } catch {}
    }

    if (!input || !Array.isArray(input.items) || input.items.length === 0) {
      return { ok: false, statusCode: 400, code: 'EMPTY_CART', error: 'السلة فارغة — لا يمكن إتمام الطلب.' };
    }
    const cleanName = String(input.customerName || '').trim();
    if (cleanName.length < 2) {
      return { ok: false, statusCode: 400, error: 'يرجى إدخال الاسم الكامل للمستلم.' };
    }
    const phoneCheck = normalizeTunisianPhone(String(input.customerPhone || ''));
    if (!phoneCheck.valid) {
      return { ok: false, statusCode: 400, error: 'يرجى إدخال رقم هاتف تونسي صحيح مكوّن من 8 أرقام (مثال: 21511162).' };
    }
    const cleanGov = String(input.shippingAddress?.governorate || '').trim();
    if (!isValidGovernorate(cleanGov)) {
      return { ok: false, statusCode: 400, error: 'يرجى اختيار الولاية التونسية من القائمة المعتمدة.' };
    }
    const cleanDelegation = String(input.shippingAddress?.delegation || input.shippingAddress?.city || '').trim();
    if (!isValidDelegationForGovernorate(cleanGov, cleanDelegation)) {
      return { ok: false, statusCode: 400, error: 'يرجى اختيار المعتمدية التابعة للولاية المختارة.' };
    }
    const cleanStreet = String(input.shippingAddress?.street || '').trim();
    if (cleanStreet.length < 4) {
      return { ok: false, statusCode: 400, error: 'يرجى إدخال العنوان التفصيلي (الحي، الشارع ورقم المنزل أو أقرب علامة مميزة).' };
    }
    const cleanEmail = String(input.customerEmail || '').trim();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { ok: false, statusCode: 400, error: 'صيغة البريد الإلكتروني غير صحيحة.' };
    }

    // Idempotency replay protection against double-clicks & timeout retries
    const reqKey = (input.clientRequestId || '').trim();
    if (reqKey && reqKey.length >= 8) {
      const nowMs = Date.now();
      paymentDb.recentCheckoutRequests = (paymentDb.recentCheckoutRequests || []).filter(
        (r) => nowMs - r.createdAt < 10 * 60 * 1000
      );
      const existingReq = paymentDb.recentCheckoutRequests.find((r) => r.key === reqKey);
      if (existingReq) {
        const existingOrder = paymentDb.orders.find((o) => o.id === existingReq.orderId);
        const existingTxn = paymentDb.transactions.find((t) => t.orderId === existingReq.orderId);
        if (existingOrder && existingTxn) {
          const recoveredToken = decryptRecoveryTrackingToken(existingReq.encryptedTrackingToken);
          return {
            ok: true,
            order: stripOrderSecrets(existingOrder),
            transaction: existingTxn,
            paymentUrl: existingReq.paymentUrl,
            ...(recoveredToken ? { trackingToken: recoveredToken } : {}),
            ...(existingOrder.paymentMethod === 'poste_ccp'
              ? (() => {
                  const det = getPosteCcpTransferDetails();
                  return det.ok && det.details ? { transferDetails: det.details } : {};
                })()
              : {}),
          };
        }
      }
    }

    const normalizedMethod = normalizePaymentMethod(input.paymentMethod);
    const cfg = paymentDb.config;

    if (normalizedMethod === 'cod' && !cfg.methods.cod.enabled) {
      return { ok: false, statusCode: 400, error: 'وسيلة الدفع عند الاستلام معطلة حالياً من مركز التحكم.' };
    }
    let resolvedPosteCcpDetails: PosteCcpTransferDetails | undefined;
    if (normalizedMethod === 'poste_ccp') {
      const ccpCheck = getPosteCcpTransferDetails();
      if (!ccpCheck.ok || !ccpCheck.details) {
        if (ccpCheck.statusCode === 403 && /ختم الأمان/.test(ccpCheck.error || '')) {
          appendActivity('BANK_INTEGRITY_TAMPER_BLOCKED', 'system', 'Blocked Poste Tunisienne / CCP checkout due to failed HMAC integrity seal on RIB settings.');
          saveDatabaseBestEffort();
        }
        return {
          ok: false,
          statusCode: ccpCheck.statusCode || 400,
          error: ccpCheck.error || 'وسيلة Poste Tunisienne / CCP غير متاحة حالياً.',
        };
      }
      resolvedPosteCcpDetails = ccpCheck.details;
    }
    if (normalizedMethod === 'bank_transfer') {
      const bankPublic = getVerifiedBankTransferPublic();
      if (bankPublic.tamperDetected) {
        appendActivity('BANK_INTEGRITY_TAMPER_BLOCKED', 'system', 'Blocked bank transfer checkout due to failed HMAC integrity seal on bank account settings.');
        saveDatabaseBestEffort();
        return {
          ok: false,
          statusCode: 403,
          error: 'تم تعليق التحويل البنكي مؤقتاً لعدم تطابق ختم الأمان الخاص بالحساب البنكي. يرجى التواصل مع الإدارة.',
        };
      }
      if (!bankPublic.enabled) {
        return { ok: false, statusCode: 400, error: 'وسيلة التحويل البنكي معطلة حالياً من مركز التحكم.' };
      }
    }
    if (normalizedMethod === 'online_payment') {
      if (!cfg.methods.online_payment.enabled || !isOnlineGatewayReady()) {
        return {
          ok: false,
          statusCode: 400,
          error: 'الدفع الإلكتروني غير مفعّل بعد: يرجى إعداد مفاتيح البوابة المعتمدة في مركز التحكم أو اختيار الدفع عند الاستلام.',
        };
      }
    }

    const quote = calculateServerOrderQuote({
      items: input.items,
      governorate: cleanGov,
      delegation: cleanDelegation,
      couponCode: input.couponCode,
    });

    if (!quote.ok) {
      if (quote.code === 'PRICE_CHANGED' || quote.code === 'UNKNOWN_PRODUCT') {
        appendActivity(
          quote.code === 'PRICE_CHANGED' ? 'TAMPER_PRICE_REJECTED' : 'TAMPER_UNKNOWN_PRODUCT_REJECTED',
          'system',
          quote.error || 'Rejected checkout quote validation.',
          input.items[0]?.productId
        );
        saveDatabaseBestEffort();
      }
      return {
        ok: false,
        statusCode: quote.statusCode || 400,
        code: quote.code,
        error: quote.error,
        updatedPrices: quote.updatedPrices,
        ...(quote.subtotal !== undefined
          ? {
              updatedQuote: {
                subtotal: quote.subtotal,
                discount: quote.discount || 0,
                taxAmount: quote.taxAmount || 0,
                shippingFee: quote.shippingFee || 0,
                totalAmount: quote.totalAmount || 0,
                estimatedDelivery: quote.estimatedDelivery,
              },
            }
          : {}),
      };
    }

    const verifiedItems = quote.verifiedItems!;
    const qtyByProduct = quote.requestedQtyByProduct!;
    const subtotal = quote.subtotal!;
    const discount = quote.discount!;
    const taxAmount = quote.taxAmount!;
    const shippingFee = quote.shippingFee!;
    const estimatedDelivery = quote.estimatedDelivery || '';
    const totalAmount = quote.totalAmount!;

    if (typeof input.clientExpectedTotal === 'number' && Math.abs(input.clientExpectedTotal - totalAmount) > 0.05) {
      appendActivity(
        'TAMPER_TOTAL_REJECTED',
        'system',
        `Rejected mismatched checkout total: client=${input.clientExpectedTotal}, server=${totalAmount}`
      );
      saveDatabaseBestEffort();
      return {
        ok: false,
        statusCode: 400,
        code: 'TOTAL_MISMATCH',
        error: 'تم رفض الطلب لعدم تطابق المبلغ الإجمالي المحسوب خادمياً.',
        updatedQuote: {
          subtotal,
          discount,
          taxAmount,
          shippingFee,
          totalAmount,
          estimatedDelivery,
        },
      };
    }

    const checkoutSnapshot = JSON.stringify(paymentDb);
    const now = new Date().toISOString();
    const orderId = `ord_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    const trackingNumber = `ECH-TN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const rawTrackingToken = crypto.randomBytes(16).toString('hex');
    const trackingTokenHash = hashTrackingToken(rawTrackingToken);

    const refPrefix = normalizedMethod === 'poste_ccp' ? 'ECH-CCP' : 'ECH-REF';
    let paymentReference = `${refPrefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    while (
      paymentDb.orders.some(o => o.paymentReference === paymentReference) ||
      paymentDb.transactions.some(t => t.paymentReference === paymentReference)
    ) {
      paymentReference = `${refPrefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    }
    const transactionId = `txn_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    // Validate transfer proof BEFORE external gateway or stock mutation
    let initialPaymentStatus: PaymentStatus = 'Cash on Delivery';
    let submittedProof: TransferProof | undefined;

    if (normalizedMethod === 'bank_transfer' || normalizedMethod === 'poste_ccp') {
      if (input.transferProof && (input.transferProof.referenceNumber?.trim() || input.transferProof.receiptImageDataUrl?.trim())) {
        const cleanImg = sanitizeReceiptImageDataUrl(input.transferProof.receiptImageDataUrl, {
          source: normalizedMethod === 'poste_ccp' ? 'checkout_poste_ccp_proof' : 'checkout_bank_proof',
          actorIp: input.actorIp,
        });
        if (!cleanImg.ok) {
          return { ok: false, statusCode: 400, error: cleanImg.error };
        }
        initialPaymentStatus = 'Payment Verification';
        submittedProof = {
          referenceNumber: (input.transferProof.referenceNumber || paymentReference).trim(),
          senderName: (input.transferProof.senderName || input.customerName).trim(),
          transferDate: input.transferProof.transferDate || now.split('T')[0],
          receiptImageDataUrl: cleanImg.value,
          notes: input.transferProof.notes?.trim(),
          submittedAt: now,
        };
      } else {
        initialPaymentStatus = 'Awaiting Bank Transfer';
      }
    } else if (normalizedMethod === 'online_payment') {
      initialPaymentStatus = 'Pending Payment';
    }

    // If online payment is configured and enabled, initialize external gateway session cleanly
    let externalPaymentId: string | undefined;
    let paymentUrl: string | undefined;

    if (normalizedMethod === 'online_payment') {
      const gatewayInit = await initiateGatewaySession({
        amount: totalAmount,
        currency: cfg.currency,
        trackingRef: trackingNumber,
        description: `NIAPOLOR Store Order ${trackingNumber}`,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail,
        origin: input.origin,
      });
      if (!gatewayInit.ok) {
        return {
          ok: false,
          statusCode: gatewayInit.statusCode || 502,
          error: gatewayInit.error,
        };
      }
      externalPaymentId = gatewayInit.externalPaymentId;
      paymentUrl = gatewayInit.paymentUrl;
    }

    // Split multi-vendor items into vendor sub-orders + commission calculation
    const groupedByVendor = new Map<string, { vendorName: string; items: OrderItem[] }>();
    for (const item of verifiedItems) {
      const vId = item.companyId || 'comp_echox';
      const vName = item.companyName || 'NIAPOLOR Distribution Tunisie';
      if (!groupedByVendor.has(vId)) {
        groupedByVendor.set(vId, { vendorName: vName, items: [] });
      }
      groupedByVendor.get(vId)!.items.push(item);
    }

    const subOrders: VendorSubOrder[] = [];
    let platformCommissionTotal = 0;

    groupedByVendor.forEach((group, vendorId) => {
      const rawGross = round3(group.items.reduce((s, it) => s + it.totalPrice, 0));
      const proratedDiscount = subtotal > 0 ? round3(discount * (rawGross / subtotal)) : 0;
      const grossAfterDiscount = Math.max(0, round3(rawGross - proratedDiscount));
      const commAmount = round3(grossAfterDiscount * (cfg.commissionRatePercent / 100));
      const netVendor = round3(grossAfterDiscount - commAmount);
      platformCommissionTotal = round3(platformCommissionTotal + commAmount);

      const subOrderId = `sub_${Date.now()}_${vendorId.slice(-6)}_${crypto.randomBytes(2).toString('hex')}`;
      subOrders.push({
        subOrderId,
        masterOrderId: orderId,
        trackingNumber,
        vendorId,
        vendorName: group.vendorName,
        items: group.items,
        grossAmount: grossAfterDiscount,
        commissionRate: cfg.commissionRatePercent,
        commissionAmount: commAmount,
        netVendorAmount: netVendor,
        payoutStatus: 'pending',
        createdAt: now,
        updatedAt: now,
      });
    });

    // Deduct stock atomically inside mutex lock & record inventory audit log
    const stockAdjustments: Array<{ productId: string; delta: number }> = [];
    for (const [productId, qty] of qtyByProduct.entries()) {
      const cat = paymentDb.catalog[productId];
      const prevStock = typeof cat.stock === 'number' ? Math.max(0, Math.floor(cat.stock)) : 0;
      if (prevStock < qty) {
        paymentDb = JSON.parse(checkoutSnapshot) as PaymentSystemDatabase;
        return {
          ok: false,
          statusCode: 409,
          code: 'STOCK_UNAVAILABLE',
          error: `الكمية المطلوبة للمنتج (${cat.name?.ar || productId}) غير متوفرة حالياً.`,
        };
      }
      const nextStock = prevStock - qty;
      cat.stock = nextStock;
      stockAdjustments.push({ productId, delta: -qty });
      appendInventoryAudit({
        productId,
        sku: cat.sku,
        productName: cat.name?.ar || cat.name?.en || productId,
        delta: -qty,
        previousStock: prevStock,
        newStock: nextStock,
        reason: 'checkout_deduct',
        orderId,
        trackingNumber,
        actor: input.customerId || 'guest',
      });
    }

    const sanitizedShippingAddress: Order['shippingAddress'] = {
      id: String(input.shippingAddress?.id || `addr_${Date.now()}`),
      isDefault: Boolean(input.shippingAddress?.isDefault ?? true),
      fullName: cleanName,
      phone: phoneCheck.normalized,
      governorate: cleanGov,
      delegation: cleanDelegation,
      city: cleanDelegation,
      ...(input.shippingAddress?.postalCode?.trim() ? { postalCode: input.shippingAddress.postalCode.trim() } : {}),
      street: cleanStreet,
      ...(input.shippingAddress?.notes?.trim() ? { notes: input.shippingAddress.notes.trim() } : {}),
    };

    const order: Order = {
      id: orderId,
      trackingNumber,
      trackingTokenHash,
      customerId: input.customerId,
      customerName: cleanName,
      customerEmail: cleanEmail,
      customerPhone: phoneCheck.normalized,
      shippingAddress: sanitizedShippingAddress,
      items: verifiedItems,
      subtotal,
      discount,
      ...(quote.coupon ? { couponCode: quote.coupon.code } : {}),
      taxAmount,
      shippingFee,
      estimatedDelivery,
      totalAmount,
      platformCommissionTotal,
      currency: cfg.currency,
      status: 'new',
      paymentMethod: normalizedMethod,
      paymentStatus: initialPaymentStatus,
      paymentReference,
      transferProof: submittedProof,
      subOrders,
      transactionId,
      stockDeducted: true,
      stockRestored: false,
      carrierName: input.carrierName || 'NIAPOLOR Delivery Tunisie',
      createdAt: now,
      updatedAt: now,
      notes: input.notes?.trim() || '',
      statusHistory: [
        {
          status: 'new',
          timestamp: now,
          note:
            normalizedMethod === 'poste_ccp'
              ? `تم تسجيل الطلب (${trackingNumber}) — مرجع تحويل البريد التونسي / CCP: ${paymentReference}`
              : normalizedMethod === 'bank_transfer'
              ? `تم تسجيل الطلب (${trackingNumber}) — مرجع التحويل: ${paymentReference}`
              : normalizedMethod === 'online_payment'
              ? `تم تسجيل الطلب (${trackingNumber}) — بانتظار تأكيد الدفع عبر بوابة ${cfg.methods.online_payment.provider}`
              : 'تم تسجيل الطلب بنجاح عبر منصة NIAPOLOR (الدفع عند الاستلام)',
        },
      ],
    };

    const transaction: PaymentTransaction = {
      id: transactionId,
      orderId,
      trackingNumber,
      paymentReference,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      method: normalizedMethod,
      provider:
        normalizedMethod === 'online_payment'
          ? cfg.methods.online_payment.provider
          : normalizedMethod === 'poste_ccp'
          ? 'poste_ccp'
          : undefined,
      externalPaymentId,
      amount: totalAmount,
      currency: cfg.currency,
      taxAmount,
      commissionTotal: platformCommissionTotal,
      status: initialPaymentStatus,
      transferProof: submittedProof,
      createdAt: now,
      updatedAt: now,
    };

    const ledgerEntries: VendorLedgerEntry[] = subOrders.map(sub => ({
      id: `vled_${sub.subOrderId}`,
      vendorId: sub.vendorId,
      vendorName: sub.vendorName,
      orderId,
      subOrderId: sub.subOrderId,
      trackingNumber,
      grossAmount: sub.grossAmount,
      commissionAmount: sub.commissionAmount,
      netAmount: sub.netVendorAmount,
      paymentStatus: initialPaymentStatus,
      payoutStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    }));

    paymentDb.orders = [order, ...paymentDb.orders];
    paymentDb.transactions = [transaction, ...paymentDb.transactions];
    paymentDb.vendorLedgers = [...ledgerEntries, ...paymentDb.vendorLedgers];
    if (reqKey && reqKey.length >= 8) {
      paymentDb.recentCheckoutRequests = [
        {
          key: reqKey,
          orderId,
          paymentUrl,
          encryptedTrackingToken: encryptRecoveryTrackingToken(rawTrackingToken),
          createdAt: Date.now(),
        },
        ...(paymentDb.recentCheckoutRequests || []).slice(0, 99),
      ];
    }
    appendActivity(
      'ORDER_PAYMENT_CREATED',
      'customer',
      `Order ${trackingNumber} (${normalizedMethod}, ref=${paymentReference}) created with status "${initialPaymentStatus}" & ${subOrders.length} vendor sub-order(s).`,
      orderId,
      totalAmount
    );

    const savedCheckout = await saveDatabaseStrict(checkoutSnapshot);
    if (!savedCheckout.ok) {
      return { ok: false, statusCode: savedCheckout.statusCode || 503, error: savedCheckout.error };
    }

    if (storeProductBridge && stockAdjustments.length > 0) {
      await storeProductBridge.adjustStockBatch(stockAdjustments).catch(() => {});
    }

    return {
      ok: true,
      order: stripOrderSecrets(order),
      transaction,
      paymentUrl,
      trackingToken: rawTrackingToken,
      transferDetails: resolvedPosteCcpDetails,
    };
  });
}

export async function submitBankTransferProof(payload: {
  trackingNumber: string;
  trackingToken?: string;
  customerId?: string;
  referenceNumber: string;
  senderName: string;
  transferDate?: string;
  receiptImageDataUrl?: string;
  notes?: string;
  isAdmin?: boolean;
  actorIp?: string;
}): Promise<{ ok: boolean; statusCode?: number; error?: string; order?: Order }> {
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);
    const cleanTrack = (payload.trackingNumber || '').trim().toUpperCase();
    const order = paymentDb.orders.find(o => o.trackingNumber.toUpperCase() === cleanTrack);
    if (!order) {
      return { ok: false, statusCode: 404, error: 'لم يتم العثور على الطلب بهذا الرقم.' };
    }
    if (!payload.isAdmin) {
      const ownsByCustomer = Boolean(payload.customerId && order.customerId && order.customerId === payload.customerId);
      const validToken = verifyTrackingTokenMatch(order, payload.trackingToken);
      if (!ownsByCustomer && !validToken) {
        return {
          ok: false,
          statusCode: payload.trackingToken ? 403 : 401,
          error: 'رمز التتبع السري غير صالح أو مفقود لإرفاق إثبات التحويل لهذا الطلب.',
        };
      }
    }
    if (order.paymentMethod !== 'bank_transfer' && order.paymentMethod !== 'poste_ccp') {
      return { ok: false, statusCode: 400, error: 'هذا الطلب ليس من نوع التحويل البريدي / البنكي.' };
    }
    if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Refunded' || order.paymentStatus === 'Cancelled') {
      return { ok: false, statusCode: 400, error: `لا يمكن تعديل إثبات الدفع لحالة (${order.paymentStatus}).` };
    }
    if (!payload.referenceNumber?.trim() || !payload.senderName?.trim()) {
      return { ok: false, statusCode: 400, error: 'يرجى إدخال رقم العملية بالوصل واسم المحوّل.' };
    }

    const cleanImg = sanitizeReceiptImageDataUrl(payload.receiptImageDataUrl, {
      source: order.paymentMethod === 'poste_ccp' ? 'submit_poste_ccp_proof' : 'submit_bank_transfer_proof',
      actorIp: payload.actorIp,
    });
    if (!cleanImg.ok) {
      return { ok: false, statusCode: 400, error: cleanImg.error };
    }

    const snapshot = JSON.stringify(paymentDb);
    const now = new Date().toISOString();
    const proof: TransferProof = {
      referenceNumber: payload.referenceNumber.trim(),
      senderName: payload.senderName.trim(),
      transferDate: payload.transferDate || now.split('T')[0],
      receiptImageDataUrl: cleanImg.value,
      notes: payload.notes?.trim(),
      submittedAt: now,
    };

    order.transferProof = proof;
    order.paymentStatus = 'Payment Verification';
    order.updatedAt = now;

    const txn = paymentDb.transactions.find(t => t.orderId === order.id);
    if (txn) {
      txn.transferProof = proof;
      txn.status = 'Payment Verification';
      txn.updatedAt = now;
    }

    paymentDb.vendorLedgers.forEach(l => {
      if (l.orderId === order.id) {
        l.paymentStatus = 'Payment Verification';
        l.updatedAt = now;
      }
    });

    appendActivity(
      order.paymentMethod === 'poste_ccp' ? 'POSTE_CCP_PROOF_SUBMITTED' : 'BANK_TRANSFER_PROOF_SUBMITTED',
      payload.isAdmin ? 'admin' : 'customer',
      `Submitted ${order.paymentMethod === 'poste_ccp' ? 'Poste/CCP' : 'bank'} transfer proof (${proof.referenceNumber}) for ${order.trackingNumber}. Awaiting owner manual funds verification.`,
      order.id,
      order.totalAmount
    );
    const saved = await saveDatabaseStrict(snapshot);
    if (!saved.ok) {
      return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
    }
    return { ok: true, order: stripOrderSecrets(order) };
  });
}

export async function adminVerifyPayment(payload: {
  orderId?: string;
  transactionId?: string;
  action: 'approve' | 'reject';
  reason?: string;
  confirmFundsReceived?: boolean;
  verificationNote?: string;
  adminEmail?: string;
}): Promise<{ ok: boolean; statusCode?: number; error?: string; order?: Order; transaction?: PaymentTransaction }> {
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);
    const txn = paymentDb.transactions.find(
      t => (payload.transactionId && t.id === payload.transactionId) || (payload.orderId && t.orderId === payload.orderId)
    );
    const order = paymentDb.orders.find(
      o => (payload.orderId && o.id === payload.orderId) || (txn && o.id === txn.orderId)
    );

    if (!order && !txn) {
      return { ok: false, statusCode: 404, error: 'المعاملة المالية غير موجودة.' };
    }

    if (order && (order.paymentStatus === 'Refunded' || order.paymentStatus === 'Cancelled' || order.status === 'cancelled')) {
      return { ok: false, statusCode: 400, error: 'لا يمكن اعتماد أو تعديل معاملة لطلب ملغى أو مسترجع مسبقاً.' };
    }
    if (txn && (txn.status === 'Refunded' || txn.status === 'Cancelled')) {
      return { ok: false, statusCode: 400, error: 'لا يمكن تعديل معاملة ملغاة أو مسترجعة.' };
    }

    if (
      payload.action === 'approve' &&
      (order?.paymentMethod === 'poste_ccp' || txn?.method === 'poste_ccp') &&
      payload.confirmFundsReceived !== true
    ) {
      return {
        ok: false,
        statusCode: 400,
        error: 'يجب تأكيد التحقق الفعلي من وصول الأموال في حساب CCP / البنك قبل اعتماد طلب Poste Tunisienne كمدفوع.',
      };
    }

    const snapshot = JSON.stringify(paymentDb);
    const now = new Date().toISOString();
    const nextStatus: PaymentStatus = payload.action === 'approve' ? 'Paid' : 'Payment Failed';
    const cleanVerifyNote = typeof payload.verificationNote === 'string' ? payload.verificationNote.trim() : '';

    if (order) {
      order.paymentStatus = nextStatus;
      order.updatedAt = now;
      if (order.paymentMethod === 'poste_ccp') {
        order.statusHistory = [
          ...order.statusHistory,
          {
            status: order.status,
            timestamp: now,
            note:
              payload.action === 'approve'
                ? `تم التحقق يدوياً من وصول الأموال (${order.totalAmount.toFixed(3)} ${order.currency || 'TND'}) واعتماد الدفع عبر Poste Tunisienne / CCP${cleanVerifyNote ? ` — ${cleanVerifyNote}` : ''}`
                : `تم رفض وصل التحويل البريدي / CCP${payload.reason ? `: ${payload.reason}` : ''}`,
          },
        ];
      }
      if (order.subOrders) {
        order.subOrders.forEach(sub => {
          sub.payoutStatus = payload.action === 'approve' ? 'eligible' : 'pending';
          sub.updatedAt = now;
        });
      }
    }

    if (txn) {
      txn.status = nextStatus;
      txn.failureReason = payload.action === 'reject' ? (payload.reason || 'Rejected by Admin') : undefined;
      txn.fundsVerifiedNote = payload.action === 'approve' && cleanVerifyNote ? cleanVerifyNote : txn.fundsVerifiedNote;
      txn.verifiedByAdmin = payload.adminEmail || 'Admin Panel';
      txn.verifiedAt = now;
      txn.updatedAt = now;
    }

    const targetOrderId = order?.id || txn?.orderId || '';
    paymentDb.vendorLedgers.forEach(entry => {
      if (entry.orderId === targetOrderId) {
        entry.paymentStatus = nextStatus;
        entry.payoutStatus = payload.action === 'approve' ? 'eligible' : 'pending';
        entry.updatedAt = now;
      }
    });

    appendActivity(
      payload.action === 'approve'
        ? order?.paymentMethod === 'poste_ccp' || txn?.method === 'poste_ccp'
          ? 'POSTE_CCP_FUNDS_CONFIRMED_PAID'
          : 'PAYMENT_APPROVED_PAID'
        : 'PAYMENT_REJECTED_FAILED',
      'admin',
      `${payload.action === 'approve' ? 'Confirmed funds arrived & marked Paid' : 'Rejected payment'} for ${order?.trackingNumber || txn?.trackingNumber}${cleanVerifyNote ? ` [ref: ${cleanVerifyNote}]` : ''}${payload.reason ? ` (${payload.reason})` : ''}.`,
      targetOrderId,
      txn?.amount || order?.totalAmount
    );
    const saved = await saveDatabaseStrict(snapshot);
    if (!saved.ok) {
      return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
    }
    return { ok: true, order: order ? stripOrderSecrets(order) : undefined, transaction: txn };
  });
}

function restoreOrderStockOnceUnlocked(
  order: Order,
  reason: 'order_cancel_restore' | 'order_refund_restore',
  actor: string
): Array<{ productId: string; delta: number }> {
  if (!order.stockDeducted || order.stockRestored) {
    return [];
  }
  const adjustments: Array<{ productId: string; delta: number }> = [];
  const qtyByProduct = new Map<string, number>();
  for (const item of order.items || []) {
    if (!item?.productId) continue;
    const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
    if (qty > 0) {
      qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) || 0) + qty);
    }
  }
  for (const [productId, qty] of qtyByProduct.entries()) {
    const cat = paymentDb.catalog[productId];
    if (cat) {
      const prevStock = typeof cat.stock === 'number' ? Math.max(0, Math.floor(cat.stock)) : 0;
      const nextStock = prevStock + qty;
      cat.stock = nextStock;
      appendInventoryAudit({
        productId,
        sku: cat.sku,
        productName: cat.name?.ar || cat.name?.en || productId,
        delta: qty,
        previousStock: prevStock,
        newStock: nextStock,
        reason,
        orderId: order.id,
        trackingNumber: order.trackingNumber,
        actor,
      });
    }
    adjustments.push({ productId, delta: qty });
  }
  order.stockRestored = true;
  return adjustments;
}

export async function adminProcessRefundOrCancel(payload: {
  orderId: string;
  action: 'refund' | 'cancel' | 'reject_refund';
  reason?: string;
}): Promise<{ ok: boolean; statusCode?: number; error?: string; order?: Order }> {
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);
    const order = paymentDb.orders.find(o => o.id === payload.orderId || o.trackingNumber === payload.orderId);
    if (!order) {
      return { ok: false, statusCode: 404, error: 'الطلب غير موجود بالنظام المالي.' };
    }

    const snapshot = JSON.stringify(paymentDb);
    const now = new Date().toISOString();
    const txn = paymentDb.transactions.find(t => t.orderId === order.id);

    if (payload.action === 'reject_refund') {
      const req = paymentDb.refundRequests.find(r => r.orderId === order.id && r.status === 'requested');
      if (req) {
        req.status = 'rejected';
        req.adminNote = payload.reason || 'تم رفض طلب الاسترجاع من مركز التحكم';
        req.updatedAt = now;
      }
      appendActivity('REFUND_REQUEST_REJECTED', 'admin', `Rejected refund request for ${order.trackingNumber}.`, order.id);
      const savedReject = await saveDatabaseStrict(snapshot);
      if (!savedReject.ok) {
        return { ok: false, statusCode: savedReject.statusCode || 503, error: savedReject.error };
      }
      return { ok: true, order: stripOrderSecrets(order) };
    }

    const isRefund = payload.action === 'refund';
    if (isRefund && order.paymentStatus === 'Refunded') {
      return { ok: false, statusCode: 400, error: 'تم استرجاع مبلغ هذا الطلب مسبقاً.' };
    }
    if (!isRefund && order.paymentStatus === 'Cancelled' && order.status === 'cancelled') {
      return { ok: false, statusCode: 400, error: 'هذا الطلب ملغى مسبقاً.' };
    }
    const nextPayStatus: PaymentStatus = isRefund ? 'Refunded' : 'Cancelled';

    const cleanReason =
      payload.reason?.trim() || (isRefund ? 'تم استرجاع المبلغ من مركز التحكم' : 'تم إلغاء الطلب والدفع');

    order.paymentStatus = nextPayStatus;
    order.status = 'cancelled';
    order.refundReason = cleanReason;
    order.cancelReason = cleanReason;
    order.updatedAt = now;
    order.statusHistory = [
      ...order.statusHistory,
      { status: 'cancelled', timestamp: now, note: cleanReason },
    ];

    const restoredAdjustments = restoreOrderStockOnceUnlocked(
      order,
      isRefund ? 'order_refund_restore' : 'order_cancel_restore',
      'admin'
    );

    if (order.subOrders) {
      order.subOrders.forEach(s => {
        s.payoutStatus = 'reversed';
        s.updatedAt = now;
      });
    }

    if (txn) {
      txn.status = nextPayStatus;
      txn.refundAmount = isRefund ? txn.amount : 0;
      txn.refundReason = cleanReason;
      txn.updatedAt = now;
    }

    paymentDb.vendorLedgers.forEach(entry => {
      if (entry.orderId === order.id) {
        entry.paymentStatus = nextPayStatus;
        entry.payoutStatus = 'reversed';
        entry.updatedAt = now;
      }
    });

    const existingReq = paymentDb.refundRequests.find(r => r.orderId === order.id);
    if (existingReq) {
      existingReq.status = 'processed';
      existingReq.adminNote = cleanReason;
      existingReq.updatedAt = now;
    } else if (isRefund) {
      paymentDb.refundRequests = [
        {
          id: `ref_${Date.now()}`,
          orderId: order.id,
          trackingNumber: order.trackingNumber,
          transactionId: txn?.id,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          amount: order.totalAmount,
          reason: cleanReason || 'Admin Refund',
          status: 'processed',
          createdAt: now,
          updatedAt: now,
        },
        ...paymentDb.refundRequests,
      ];
    }

    appendActivity(
      isRefund ? 'PAYMENT_REFUNDED' : 'PAYMENT_CANCELLED',
      'admin',
      `${isRefund ? 'Refunded' : 'Cancelled'} order ${order.trackingNumber}, restored stock (${restoredAdjustments.length} SKU(s)), and reversed vendor ledger balances.`,
      order.id,
      order.totalAmount
    );
    const saved = await saveDatabaseStrict(snapshot);
    if (!saved.ok) {
      return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
    }
    if (storeProductBridge && restoredAdjustments.length > 0) {
      await storeProductBridge.adjustStockBatch(restoredAdjustments).catch(() => {});
    }
    return { ok: true, order: stripOrderSecrets(order) };
  });
}

export async function createCustomerRefundOrCancelRequest(payload: {
  trackingNumber: string;
  trackingToken?: string;
  customerId?: string;
  reason: string;
}): Promise<{ ok: boolean; statusCode?: number; error?: string; refundRequest?: RefundRequest }> {
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);
    const cleanTrack = (payload.trackingNumber || '').trim().toUpperCase();
    const order = paymentDb.orders.find(o => o.trackingNumber.toUpperCase() === cleanTrack);
    if (!order) {
      return { ok: false, statusCode: 404, error: 'الطلب غير موجود.' };
    }
    const ownsByCustomer = Boolean(payload.customerId && order.customerId && order.customerId === payload.customerId);
    const validToken = verifyTrackingTokenMatch(order, payload.trackingToken);
    if (!ownsByCustomer && !validToken) {
      return {
        ok: false,
        statusCode: payload.trackingToken ? 403 : 401,
        error: 'رمز التتبع السري غير صالح أو مفقود لتقديم طلب الإلغاء/الاسترجاع.',
      };
    }

    const snapshot = JSON.stringify(paymentDb);
    const now = new Date().toISOString();
    const req: RefundRequest = {
      id: `refreq_${Date.now()}`,
      orderId: order.id,
      trackingNumber: order.trackingNumber,
      transactionId: order.transactionId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      amount: order.totalAmount,
      reason: payload.reason?.trim() || 'طلب إلغاء / استرجاع من الحريف',
      status: 'requested',
      createdAt: now,
      updatedAt: now,
    };

    paymentDb.refundRequests = [req, ...paymentDb.refundRequests];
    appendActivity('CUSTOMER_REFUND_REQUESTED', 'customer', `Refund/cancellation requested for ${order.trackingNumber}: ${req.reason}`, order.id, order.totalAmount);
    const saved = await saveDatabaseStrict(snapshot);
    if (!saved.ok) {
      return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
    }
    return { ok: true, refundRequest: req };
  });
}

export function canOrderShip(order: Pick<Order, 'paymentMethod' | 'paymentStatus'>): boolean {
  const norm = normalizePaymentMethod(order.paymentMethod);
  if (norm === 'cod') return true;
  return order.paymentStatus === 'Paid' || order.paymentStatus === 'paid';
}

export async function adminUpdateOrderStatus(
  orderId: string,
  status: OrderStatus,
  note?: string,
  reason?: string
): Promise<{
  ok: boolean;
  statusCode?: number;
  error?: string;
  order?: Order;
}> {
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);
    const order = paymentDb.orders.find(o => o.id === orderId || o.trackingNumber === orderId);
    if (!order) {
      return { ok: false, statusCode: 404, error: 'الطلب غير موجود.' };
    }

    if (order.status === 'cancelled' && status !== 'cancelled') {
      return {
        ok: false,
        statusCode: 409,
        error: 'لا يمكن شحن أو تفعيل طلب ملغى مالياً.',
      };
    }

    const shippingStatuses: OrderStatus[] = ['preparing', 'out_for_delivery', 'delivered'];
    if (shippingStatuses.includes(status) && !canOrderShip(order)) {
      return {
        ok: false,
        statusCode: 409,
        error: 'لا يمكن شحن أو تجهيز أو تسليم هذا الطلب قبل تأكيد حالة الدفع كـ "مدفوع" (Paid).',
      };
    }

    const snapshot = JSON.stringify(paymentDb);
    const now = new Date().toISOString();
    order.status = status;
    order.updatedAt = now;
    const statusNote = note || reason || `Updated shipping status to ${status}`;
    order.statusHistory = [
      ...order.statusHistory,
      { status, timestamp: now, note: statusNote },
    ];

    let restoredAdjustments: Array<{ productId: string; delta: number }> = [];
    if (status === 'cancelled') {
      const cancelNote = (reason || note || 'تم إلغاء الطلب من لوحة الإدارة').trim();
      order.cancelReason = cancelNote;
      if (order.paymentStatus !== 'Refunded') {
        order.paymentStatus = 'Cancelled';
        const txn = paymentDb.transactions.find(t => t.orderId === order.id);
        if (txn) {
          txn.status = 'Cancelled';
          txn.refundReason = cancelNote;
          txn.updatedAt = now;
        }
        paymentDb.vendorLedgers.forEach(entry => {
          if (entry.orderId === order.id) {
            entry.paymentStatus = 'Cancelled';
            entry.payoutStatus = 'reversed';
            entry.updatedAt = now;
          }
        });
        order.subOrders?.forEach(sub => {
          sub.payoutStatus = 'reversed';
          sub.updatedAt = now;
        });
      }
      restoredAdjustments = restoreOrderStockOnceUnlocked(order, 'order_cancel_restore', 'admin');
    }

    // Logical COD lifecycle settlement: once COD parcel is delivered, mark payment Paid & unlock vendor earnings
    if (
      status === 'delivered' &&
      normalizePaymentMethod(order.paymentMethod) === 'cod' &&
      order.paymentStatus !== 'Paid' &&
      order.paymentStatus !== 'paid' &&
      order.paymentStatus !== 'Refunded' &&
      order.paymentStatus !== 'Cancelled'
    ) {
      order.paymentStatus = 'Paid';
      const txn = paymentDb.transactions.find(t => t.orderId === order.id);
      if (txn) {
        txn.status = 'Paid';
        txn.verifiedByAdmin = 'COD Auto-Settlement on Delivery';
        txn.verifiedAt = now;
        txn.updatedAt = now;
      }
      if (order.subOrders) {
        order.subOrders.forEach(sub => {
          if (sub.payoutStatus === 'pending') sub.payoutStatus = 'eligible';
          sub.updatedAt = now;
        });
      }
      paymentDb.vendorLedgers.forEach(entry => {
        if (entry.orderId === order.id && entry.payoutStatus === 'pending') {
          entry.paymentStatus = 'Paid';
          entry.payoutStatus = 'eligible';
          entry.updatedAt = now;
        } else if (entry.orderId === order.id) {
          entry.paymentStatus = 'Paid';
          entry.updatedAt = now;
        }
      });
      appendActivity('COD_COLLECTED_ON_DELIVERY', 'system', `Marked COD order ${order.trackingNumber} Paid upon delivery and unlocked vendor balances.`, order.id, order.totalAmount);
    }

    appendActivity('ORDER_STATUS_UPDATED', 'admin', `Order ${order.trackingNumber} transitioned to "${status}".`, order.id);
    const saved = await saveDatabaseStrict(snapshot);
    if (!saved.ok) {
      return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
    }
    if (storeProductBridge && restoredAdjustments.length > 0) {
      await storeProductBridge.adjustStockBatch(restoredAdjustments).catch(() => {});
    }
    return { ok: true, order: stripOrderSecrets(order) };
  });
}

export async function adminSettleVendorPayout(vendorId: string, settlementNote?: string): Promise<{
  ok: boolean;
  statusCode?: number;
  error?: string;
  settledCount: number;
  settledTotal: number;
}> {
  await syncPaymentDbIfStale(true);
  const snapshot = JSON.stringify(paymentDb);
  const now = new Date().toISOString();
  let settledCount = 0;
  let settledTotal = 0;

  paymentDb.vendorLedgers.forEach(entry => {
    if (entry.vendorId === vendorId && entry.payoutStatus === 'eligible') {
      entry.payoutStatus = 'settled';
      entry.settledAt = now;
      entry.settlementNote = settlementNote || 'Settled manually from Admin Panel';
      entry.updatedAt = now;
      settledCount++;
      settledTotal = round3(settledTotal + entry.netAmount);
    }
  });

  paymentDb.orders.forEach(o => {
    o.subOrders?.forEach(sub => {
      if (sub.vendorId === vendorId && sub.payoutStatus === 'eligible') {
        sub.payoutStatus = 'settled';
        sub.updatedAt = now;
      }
    });
  });

  if (settledCount > 0) {
    appendActivity(
      'VENDOR_PAYOUT_SETTLED',
      'admin',
      `Marked ${settledCount} ledger item(s) settled for vendor ${vendorId} (${settledTotal.toFixed(3)} ${paymentDb.config.currency}). Note: bank payouts are settled manually outside automated split.`,
      vendorId,
      settledTotal
    );
    const saved = await saveDatabaseStrict(snapshot);
    if (!saved.ok) {
      return { ok: false, statusCode: saved.statusCode || 503, error: saved.error, settledCount: 0, settledTotal: 0 };
    }
  }

  return { ok: true, settledCount, settledTotal };
}

export function getScopedVendorFinancials(vendorId: string) {
  // STRICT VENDOR ISOLATION: only entries and sub-orders matching exact vendorId
  const entries = paymentDb.vendorLedgers.filter(e => e.vendorId === vendorId);
  const grossTotal = round3(entries.filter(e => e.payoutStatus !== 'reversed').reduce((s, e) => s + e.grossAmount, 0));
  const commissionTotal = round3(entries.filter(e => e.payoutStatus !== 'reversed').reduce((s, e) => s + e.commissionAmount, 0));
  const netPending = round3(entries.filter(e => e.payoutStatus === 'pending').reduce((s, e) => s + e.netAmount, 0));
  const netEligible = round3(entries.filter(e => e.payoutStatus === 'eligible').reduce((s, e) => s + e.netAmount, 0));
  const netSettled = round3(entries.filter(e => e.payoutStatus === 'settled').reduce((s, e) => s + e.netAmount, 0));

  const subOrders = paymentDb.orders.flatMap(o =>
    (o.subOrders || [])
      .filter(s => s.vendorId === vendorId)
      .map(s => ({
        ...s,
        orderPaymentStatus: o.paymentStatus,
        orderTrackingStatus: o.status,
        paymentMethod: o.paymentMethod,
      }))
  );

  return {
    vendorId,
    currency: paymentDb.config.currency,
    grossTotal,
    commissionTotal,
    netPending,
    netEligible,
    netSettled,
    subOrders,
    ledgerEntries: entries,
  };
}

export async function adminCreateManualOrder(input: Partial<Order>): Promise<{
  ok: boolean;
  statusCode?: number;
  error?: string;
  order?: Order;
}> {
  await syncPaymentDbIfStale(true);
  const customerName = (input.customerName || '').trim();
  const customerPhone = (input.customerPhone || '').trim();
  const amount = round3(Number(input.totalAmount ?? input.subtotal ?? 0));

  if (!customerName || !customerPhone || !Number.isFinite(amount) || amount < 0) {
    return { ok: false, statusCode: 400, error: 'بيانات الطلب اليدوي غير مكتملة أو غير صالحة.' };
  }

  const snapshot = JSON.stringify(paymentDb);
  const now = new Date().toISOString();
  const orderId = input.id && input.id.startsWith('ord_')
    ? input.id
    : `ord_manual_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
  const trackingNumber =
    (input.trackingNumber || '').trim().toUpperCase() ||
    `ECH-TN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const paymentMethod = normalizePaymentMethod(input.paymentMethod || 'cod');
  const paymentStatus: PaymentStatus =
    input.paymentStatus ||
    (paymentMethod === 'cod' ? 'Cash on Delivery' : 'Pending Payment');

  const created: Order = {
    id: orderId,
    trackingNumber,
    customerName,
    customerEmail: (input.customerEmail || '').trim(),
    customerPhone,
    shippingAddress: input.shippingAddress || {
      id: `addr_${Date.now()}`,
      isDefault: true,
      fullName: customerName,
      phone: customerPhone,
      governorate: 'tunis',
      city: 'تونس العاصمة',
      postalCode: '1000',
      street: 'طلب مباشر عبر الهاتف / واتساب',
    },
    items:
      Array.isArray(input.items) && input.items.length > 0
        ? input.items
        : [
            {
              productId: 'manual_item',
              productName: {
                ar: 'طلب هاتفي مباشر',
                fr: 'Commande directe',
                en: 'Direct Order',
              },
              productImage: '/assets/images/echox-logo.webp',
              unitPrice: amount,
              quantity: 1,
              totalPrice: amount,
            },
          ],
    subtotal: round3(Number(input.subtotal ?? amount)),
    discount: round3(Number(input.discount ?? 0)),
    taxAmount: round3(Number(input.taxAmount ?? 0)),
    shippingFee: round3(Number(input.shippingFee ?? 0)),
    totalAmount: amount,
    currency: paymentDb.config.currency,
    status: input.status || 'new',
    paymentMethod,
    paymentStatus,
    carrierName: (input.carrierName || '').trim() || 'NIAPOLOR Delivery Tunisie',
    createdAt: now,
    updatedAt: now,
    notes: (input.notes || '').trim() || 'تم التسجيل يدوياً من لوحة التحكم',
    statusHistory: [
      {
        status: input.status || 'new',
        timestamp: now,
        note: 'تم تسجيل الطلب يدوياً عبر الهاتف / واتساب',
      },
    ],
  };

  paymentDb.orders = [created, ...paymentDb.orders.filter(o => o.id !== created.id)];
  appendActivity(
    'MANUAL_ORDER_CREATED',
    'admin',
    `Admin recorded manual order ${created.trackingNumber} for ${created.customerName}.`,
    created.id,
    created.totalAmount
  );
  const saved = await saveDatabaseStrict(snapshot);
  if (!saved.ok) {
    return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
  }
  return { ok: true, order: created };
}

export async function adminDeleteOrder(orderId: string): Promise<{
  ok: boolean;
  statusCode?: number;
  error?: string;
}> {
  await syncPaymentDbIfStale(true);
  const cleanId = (orderId || '').trim();
  const target = paymentDb.orders.find(o => o.id === cleanId || o.trackingNumber === cleanId);
  if (!target) {
    return { ok: false, statusCode: 404, error: 'الطلب غير موجود على الخادم.' };
  }

  const linkedTransactions = paymentDb.transactions.filter(t => t.orderId === target.id);
  const linkedLedgers = paymentDb.vendorLedgers.filter(v => v.orderId === target.id);
  const hasProtectedFinancialStatus =
    target.paymentStatus === 'Paid' ||
    target.paymentStatus === 'Payment Verification' ||
    target.paymentStatus === 'Refunded' ||
    linkedTransactions.some(
      t => t.status === 'Paid' || t.status === 'Payment Verification' || t.status === 'Refunded'
    ) ||
    linkedLedgers.some(
      v => v.paymentStatus === 'Paid' || v.payoutStatus === 'settled' || v.payoutStatus === 'eligible'
    );

  if (hasProtectedFinancialStatus) {
    return {
      ok: false,
      statusCode: 409,
      error:
        'لا يمكن حذف هذا الطلب نهائياً لوجود معاملات مالية مدفوعة أو قيد المراجعة أو تسويات بائعين مرتبطة به يجب الاحتفاظ بها قانونياً. استخدم الإلغاء أو الاسترجاع بدلاً من الحذف.',
    };
  }

  const snapshot = JSON.stringify(paymentDb);
  paymentDb.orders = paymentDb.orders.filter(o => o.id !== target.id);
  paymentDb.transactions = paymentDb.transactions.filter(t => t.orderId !== target.id);
  paymentDb.vendorLedgers = paymentDb.vendorLedgers.filter(v => v.orderId !== target.id);
  paymentDb.refundRequests = paymentDb.refundRequests.filter(r => r.orderId !== target.id);

  appendActivity(
    'ORDER_DELETED',
    'admin',
    `Admin permanently deleted unpaid/non-financial order ${target.trackingNumber} (${target.customerName}).`,
    target.id,
    target.totalAmount
  );
  const saved = await saveDatabaseStrict(snapshot);
  if (!saved.ok) {
    return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
  }
  return { ok: true };
}

function maskPersonName(raw: string): string {
  const cleaned = String(raw || '').trim();
  if (!cleaned) return '***';
  const parts = cleaned.split(/\s+/);
  return parts
    .map((p) => (p.length <= 1 ? '*' : `${p.slice(0, 1)}${'*'.repeat(Math.min(4, p.length - 1))}`))
    .join(' ');
}

function maskPhoneNumber(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${digits.slice(0, 2)}****${digits.slice(-2)}`;
}

function doesPhoneMatchOrder(orderPhone: string, submittedPhone?: string): boolean {
  const submitted = String(submittedPhone || '').trim();
  if (!submitted) return false;
  const orderNorm = normalizeTunisianPhone(orderPhone || '');
  const subNorm = normalizeTunisianPhone(submitted);
  if (orderNorm.valid && subNorm.valid) {
    return orderNorm.normalized === subNorm.normalized;
  }
  const oDigits = String(orderPhone || '').replace(/\D/g, '').slice(-8);
  const sDigits = submitted.replace(/\D/g, '').slice(-8);
  return oDigits.length >= 6 && sDigits.length >= 6 && oDigits === sDigits;
}

export function trackPublicOrder(
  code: string,
  options?: {
    isAdmin?: boolean;
    customerId?: string;
    trackingToken?: string;
  }
): {
  ok: boolean;
  statusCode?: number;
  error?: string;
  order?: Order;
} {
  const clean = (code || '').trim().toUpperCase();
  if (!clean || clean.length < 6) {
    return { ok: false, statusCode: 400, error: 'يرجى إدخال رقم تتبع صالح (6 محارف على الأقل).' };
  }
  // Never allow internal sequential/database IDs as public tracking credentials
  if (!options?.isAdmin && /^ORD_/i.test(clean)) {
    return { ok: false, statusCode: 403, error: 'رقم الطلب الداخلي غير مصرح به للتتبع العام — استخدم مرجع الطلب ورمز التتبع السري.' };
  }

  const found = paymentDb.orders.find(
    o =>
      o.trackingNumber.toUpperCase() === clean ||
      (o.paymentReference && o.paymentReference.toUpperCase() === clean)
  );
  if (!found) {
    return { ok: false, statusCode: 404, error: 'لم يتم العثور على طلب بهذا الرمز.' };
  }

  const cleanFound = stripOrderSecrets(found);

  if (options?.isAdmin) {
    return { ok: true, order: cleanFound };
  }

  const ownsByCustomer = Boolean(
    options?.customerId && found.customerId && found.customerId === options.customerId
  );
  const validToken = verifyTrackingTokenMatch(found, options?.trackingToken);

  if (!ownsByCustomer && !validToken) {
    return {
      ok: false,
      statusCode: options?.trackingToken ? 403 : 401,
      error: 'يتطلب تتبع الطلب رمز التتبع السري المرفق بالطلب أو تسجيل الدخول بحساب صاحب الطلب.',
    };
  }

  const ccpDetails =
    found.paymentMethod === 'poste_ccp' &&
    found.paymentStatus !== 'Paid' &&
    found.paymentStatus !== 'Refunded' &&
    found.paymentStatus !== 'Cancelled'
      ? getPosteCcpTransferDetails()
      : undefined;

  if (ownsByCustomer) {
    return {
      ok: true,
      order: {
        ...cleanFound,
        ...(ccpDetails?.ok && ccpDetails.details ? { transferDetails: ccpDetails.details } : {}),
        piiMasked: false,
      },
    };
  }

  // Authorized via guest trackingToken: return status, items, totals, delivery estimate, and CCP payment instructions, while masking sensitive customer PII
  const maskedOrder: Order = {
    ...cleanFound,
    customerName: maskPersonName(found.customerName),
    customerPhone: maskPhoneNumber(found.customerPhone),
    customerEmail: '',
    notes: '',
    shippingAddress: {
      ...found.shippingAddress,
      fullName: maskPersonName(found.shippingAddress?.fullName || found.customerName),
      phone: maskPhoneNumber(found.shippingAddress?.phone || found.customerPhone),
      street: '***',
      notes: undefined,
    },
    subOrders: undefined,
    platformCommissionTotal: undefined,
    transferProof: undefined,
    ...(ccpDetails?.ok && ccpDetails.details ? { transferDetails: ccpDetails.details } : {}),
    piiMasked: true,
  };
  return { ok: true, order: maskedOrder };
}

export function getAdminOrdersFiltered(filters?: {
  q?: string;
  status?: string;
  paymentStatus?: string;
}): Order[] {
  const q = String(filters?.q || '').trim().toLowerCase();
  const statusFilter = String(filters?.status || '').trim().toLowerCase();
  const payFilter = String(filters?.paymentStatus || '').trim().toLowerCase();

  return paymentDb.orders
    .map(stripOrderSecrets)
    .filter((o) => {
      if (statusFilter && statusFilter !== 'all' && o.status.toLowerCase() !== statusFilter) {
        return false;
      }
      if (payFilter && payFilter !== 'all' && o.paymentStatus.toLowerCase() !== payFilter) {
        return false;
      }
      if (q) {
        const hay = `${o.id} ${o.trackingNumber} ${o.paymentReference || ''} ${o.customerName} ${o.customerPhone} ${o.customerEmail || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
}

export function getAdminPaymentOverview() {
  const vendorIds = Array.from(new Set(paymentDb.vendorLedgers.map(e => e.vendorId)));
  const vendorSummaries = vendorIds.map(vId => {
    const first = paymentDb.vendorLedgers.find(e => e.vendorId === vId);
    const scoped = getScopedVendorFinancials(vId);
    return {
      vendorId: vId,
      vendorName: first?.vendorName || vId,
      grossTotal: scoped.grossTotal,
      commissionTotal: scoped.commissionTotal,
      netPending: scoped.netPending,
      netEligible: scoped.netEligible,
      netSettled: scoped.netSettled,
      entriesCount: scoped.ledgerEntries.length,
    };
  });

  const supportTotalPaid = round3(
    paymentDb.supportTransactions
      .filter(s => s.status === 'Paid')
      .reduce((sum, s) => sum + s.amount, 0)
  );

  return {
    config: getAdminPaymentConfig(),
    orders: paymentDb.orders.map(stripOrderSecrets),
    transactions: paymentDb.transactions,
    vendorLedgers: paymentDb.vendorLedgers,
    vendorSummaries,
    refundRequests: paymentDb.refundRequests,
    supportTransactions: paymentDb.supportTransactions,
    supportTotalPaid,
    activityLogs: paymentDb.activityLogs,
    inventoryLogs: paymentDb.inventoryLogs || [],
  };
}

function markOrderPaymentFromGateway(txn: PaymentTransaction, nextStatus: PaymentStatus, sourceTag: string, failureReason?: string): Order | undefined {
  const now = new Date().toISOString();
  // Terminal / Paid immutability guard: never downgrade already Paid, Refunded, or Cancelled records
  if (txn.status === 'Refunded' || txn.status === 'Cancelled') return paymentDb.orders.find(o => o.id === txn.orderId);
  if (txn.status === 'Paid' && nextStatus !== 'Paid') return paymentDb.orders.find(o => o.id === txn.orderId);

  txn.status = nextStatus;
  txn.failureReason = nextStatus === 'Payment Failed' ? failureReason : undefined;
  txn.updatedAt = now;

  const order = paymentDb.orders.find(o => o.id === txn.orderId);
  if (order && order.paymentStatus !== 'Refunded' && order.paymentStatus !== 'Cancelled') {
    if (!(order.paymentStatus === 'Paid' && nextStatus !== 'Paid')) {
      order.paymentStatus = nextStatus;
      order.updatedAt = now;
      if (nextStatus === 'Paid') {
        order.statusHistory = [
          ...order.statusHistory,
          { status: order.status, timestamp: now, note: `تم تأكيد الدفع الإلكتروني تلقائياً (${sourceTag})` },
        ];
      }
      if (order.subOrders) {
        order.subOrders.forEach(s => {
          s.payoutStatus = nextStatus === 'Paid' ? 'eligible' : 'pending';
          s.updatedAt = now;
        });
      }
    }
  }

  paymentDb.vendorLedgers.forEach(entry => {
    if (entry.orderId === txn.orderId) {
      if (!(entry.paymentStatus === 'Paid' && nextStatus !== 'Paid')) {
        entry.paymentStatus = nextStatus;
        entry.payoutStatus = nextStatus === 'Paid' ? 'eligible' : 'pending';
        entry.updatedAt = now;
      }
    }
  });

  return order;
}

export async function handlePaymentWebhook(payload: {
  provider: string;
  webhookToken?: string;
  method?: 'GET' | 'POST';
  signatureHeader?: string;
  rawBody: any;
  rawBodyText?: string;
  query?: Record<string, any>;
}): Promise<{ ok: boolean; statusCode: number; message: string; idempotentDuplicate?: boolean }> {
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);
    const { provider, webhookToken, method = 'POST', signatureHeader, rawBody, rawBodyText, query } = payload;
    const secrets = paymentDb.config.secrets;
    const mergedInput = {
      ...(query || {}),
      ...(rawBody && typeof rawBody === 'object' ? rawBody : {}),
    };

    const isSilentKonnectGet = method === 'GET' && provider === 'konnect' && Boolean(mergedInput.payment_ref);

    if (!isSilentKonnectGet && secrets.webhookSecret && secrets.webhookSecret.trim().length > 0) {
      if (!signatureHeader) {
        appendActivity('WEBHOOK_UNAUTHORIZED', 'webhook', `Rejected ${provider} webhook missing signature header.`);
        saveDatabaseBestEffort();
        return { ok: false, statusCode: 401, message: 'Missing webhook signature header.' };
      }
      const cleanSig = signatureHeader.trim().replace(/^sha256=/i, '');
      const wireText =
        typeof rawBodyText === 'string' && rawBodyText.length > 0
          ? rawBodyText
          : typeof rawBody === 'string'
          ? rawBody
          : JSON.stringify(rawBody || {});
      const expectedHmac = crypto
        .createHmac('sha256', secrets.webhookSecret.trim())
        .update(wireText)
        .digest('hex');

      const sigBuf = Buffer.from(cleanSig);
      const expBuf = Buffer.from(expectedHmac);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        appendActivity('WEBHOOK_SIGNATURE_INVALID', 'webhook', `Rejected ${provider} webhook with invalid HMAC signature.`);
        saveDatabaseBestEffort();
        return { ok: false, statusCode: 403, message: 'Invalid webhook signature.' };
      }
    } else if (!secrets.apiKey) {
      appendActivity('WEBHOOK_REJECTED_UNCONFIGURED', 'webhook', `Rejected ${provider} webhook because gateway credentials are not configured.`);
      saveDatabaseBestEffort();
      return { ok: false, statusCode: 503, message: 'Gateway not configured on server.' };
    }

    const payRefParam = mergedInput?.payment_ref || mergedInput?.paymentRef || mergedInput?.payment_id || '';
    const trackingOrRef = mergedInput?.orderId || mergedInput?.trackingNumber || mergedInput?.developer_tracking_id || payRefParam;
    if (!trackingOrRef) {
      return { ok: false, statusCode: 400, message: 'Missing payment or order identifier in webhook payload.' };
    }

    const eventId =
      mergedInput?.eventId ||
      mergedInput?.id ||
      `${provider}:${payRefParam || trackingOrRef}:${mergedInput?.status || method}`;

    if (eventId && paymentDb.processedWebhookKeys.includes(eventId)) {
      return { ok: true, statusCode: 200, message: 'Duplicate webhook safely ignored (idempotent).', idempotentDuplicate: true };
    }

    const txn = paymentDb.transactions.find(
      t => t.trackingNumber === trackingOrRef || t.externalPaymentId === trackingOrRef || t.paymentReference === trackingOrRef || (payRefParam && t.externalPaymentId === payRefParam)
    );
    const supTxn = !txn
      ? paymentDb.supportTransactions.find(
          s => s.supportReference === trackingOrRef || s.externalPaymentId === trackingOrRef || (payRefParam && s.externalPaymentId === payRefParam)
        )
      : undefined;

    if (!txn && !supTxn) {
      return { ok: false, statusCode: 404, message: 'Transaction not found.' };
    }

    const targetRefLabel = txn ? txn.trackingNumber : supTxn!.supportReference;

    if (webhookToken && webhookToken.trim().length > 0) {
      const expectedWhToken = computeOrderWebhookToken(targetRefLabel);
      const inBuf = Buffer.from(webhookToken.trim());
      const expBuf = Buffer.from(expectedWhToken);
      if (inBuf.length !== expBuf.length || !crypto.timingSafeEqual(inBuf, expBuf)) {
        appendActivity('WEBHOOK_TOKEN_INVALID', 'webhook', `Rejected ${provider} webhook with invalid per-order webhook token on ${targetRefLabel}.`);
        saveDatabaseBestEffort();
        return { ok: false, statusCode: 403, message: 'Invalid webhook token.' };
      }
    }

    const targetAmount = txn ? txn.amount : supTxn!.amount;
    const targetCurrency = txn ? txn.currency : supTxn!.currency;
    const targetExternalRef = (txn?.externalPaymentId || supTxn?.externalPaymentId || payRefParam || '').trim();

    if (
      payRefParam &&
      (txn?.externalPaymentId || supTxn?.externalPaymentId) &&
      payRefParam !== (txn?.externalPaymentId || supTxn?.externalPaymentId)
    ) {
      appendActivity('TAMPER_WEBHOOK_REF_MISMATCH', 'webhook', `Rejected mismatched payment_ref (${payRefParam}) on ${trackingOrRef}.`);
      saveDatabaseBestEffort();
      return { ok: false, statusCode: 403, message: 'Payment reference mismatch.' };
    }

    let verifiedStatus: 'completed' | 'pending' | 'failed' = 'failed';

    if ((provider === 'konnect' || provider === 'flouci') && targetExternalRef) {
      const check = await verifyGatewayPaymentRef({
        provider,
        payRef: targetExternalRef,
        expectedAmount: targetAmount,
        expectedCurrency: targetCurrency,
        expectedOrderId: targetRefLabel,
      });
      if (!check.ok) {
        if (check.statusCode === 403) {
          appendActivity('TAMPER_WEBHOOK_AMOUNT_MISMATCH', 'webhook', `${provider} security violation on ${trackingOrRef}: ${check.reason}`);
          saveDatabaseBestEffort();
          return { ok: false, statusCode: 403, message: check.reason || 'Payment integrity verification failed.' };
        }
        return { ok: false, statusCode: check.statusCode || 502, message: check.reason || 'Gateway verification error.' };
      }
      verifiedStatus = check.status;
    } else if (secrets.webhookSecret && secrets.webhookSecret.trim().length > 0) {
      const incomingStatus = String(mergedInput?.status || '').toLowerCase();
      verifiedStatus =
        incomingStatus === 'completed' || incomingStatus === 'paid' || incomingStatus === 'succeeded' || incomingStatus === 'success'
          ? 'completed'
          : incomingStatus === 'pending'
          ? 'pending'
          : 'failed';
    } else {
      appendActivity('WEBHOOK_UNAUTHORIZED', 'webhook', `Rejected unauthenticated ${provider} webhook without HMAC secret or gateway S2S reference.`);
      saveDatabaseBestEffort();
      return { ok: false, statusCode: 401, message: 'Webhook HMAC secret required for unsigned POST webhooks.' };
    }

    if (verifiedStatus === 'pending') {
      return { ok: true, statusCode: 200, message: 'Payment is still pending confirmation.' };
    }

    const snapshot = JSON.stringify(paymentDb);
    const nextStatus: PaymentStatus = verifiedStatus === 'completed' ? 'Paid' : 'Payment Failed';

    if (txn) {
      markOrderPaymentFromGateway(txn, nextStatus, `${provider} webhook`);
    } else if (supTxn) {
      if (supTxn.status !== 'Refunded' && supTxn.status !== 'Cancelled' && !(supTxn.status === 'Paid' && nextStatus !== 'Paid')) {
        supTxn.status = nextStatus;
        supTxn.updatedAt = new Date().toISOString();
      }
    }

    if (eventId) {
      paymentDb.processedWebhookKeys = [eventId, ...paymentDb.processedWebhookKeys].slice(0, 500);
    }

    appendActivity(
      'WEBHOOK_PROCESSED',
      'webhook',
      `${provider} webhook updated ${targetRefLabel} to ${nextStatus}.`,
      txn ? txn.orderId : supTxn!.id,
      targetAmount
    );
    const saved = await saveDatabaseStrict(snapshot);
    if (!saved.ok) {
      return { ok: false, statusCode: saved.statusCode || 503, message: saved.error || 'Failed persisting webhook transaction.' };
    }
    return { ok: true, statusCode: 200, message: `Webhook processed: ${nextStatus}` };
  });
}

export async function verifyGatewayReturn(params: {
  tracking?: string;
  paymentRef?: string;
  provider?: string;
}): Promise<{
  ok: boolean;
  statusCode?: number;
  kind?: 'order' | 'support';
  paymentStatus?: PaymentStatus;
  order?: Order;
  supportTransaction?: SupportTransaction;
  error?: string;
}> {
  return withPaymentMutationLock(async () => {
    await syncPaymentDbIfStale(true);
    const cleanTrack = (params.tracking || '').trim().toUpperCase();
    const cleanPayRef = (params.paymentRef || '').trim();

    const txn = paymentDb.transactions.find(
      t =>
        (cleanTrack && (t.trackingNumber.toUpperCase() === cleanTrack || t.paymentReference.toUpperCase() === cleanTrack)) ||
        (cleanPayRef && t.externalPaymentId === cleanPayRef)
    );
    const supTxn = !txn
      ? paymentDb.supportTransactions.find(
          s =>
            (cleanTrack && s.supportReference.toUpperCase() === cleanTrack) ||
            (cleanPayRef && s.externalPaymentId === cleanPayRef)
        )
      : undefined;

    if (!txn && !supTxn) {
      return { ok: false, statusCode: 404, error: 'لم يتم العثور على المعاملة للتحقق منها.' };
    }

    const targetStatus = txn ? txn.status : supTxn!.status;
    const targetProvider = (params.provider || txn?.provider || supTxn?.provider || paymentDb.config.methods.online_payment.provider || 'konnect').toLowerCase();
    const extRef = txn?.externalPaymentId || supTxn?.externalPaymentId || cleanPayRef;

    if (targetStatus === 'Paid') {
      const ord = txn ? paymentDb.orders.find(o => o.id === txn.orderId) : undefined;
      return {
        ok: true,
        kind: txn ? 'order' : 'support',
        paymentStatus: 'Paid',
        order: ord ? stripOrderSecrets(ord) : undefined,
        supportTransaction: supTxn,
      };
    }

    if ((targetProvider === 'konnect' || targetProvider === 'flouci') && extRef) {
      const check = await verifyGatewayPaymentRef({
        provider: targetProvider,
        payRef: extRef,
        expectedAmount: txn ? txn.amount : supTxn!.amount,
        expectedCurrency: txn ? txn.currency : supTxn!.currency,
        expectedOrderId: txn ? txn.trackingNumber : supTxn!.supportReference,
      });
      if (check.ok && check.status === 'completed') {
        const snapshot = JSON.stringify(paymentDb);
        if (txn) {
          const order = markOrderPaymentFromGateway(txn, 'Paid', `${targetProvider} return verify`);
          appendActivity('GATEWAY_RETURN_VERIFIED_PAID', 'system', `Verified ${txn.trackingNumber} as Paid on return.`, txn.orderId, txn.amount);
          const saved = await saveDatabaseStrict(snapshot);
          if (!saved.ok) return { ok: false, statusCode: 503, error: saved.error };
          return { ok: true, kind: 'order', paymentStatus: 'Paid', order: order ? stripOrderSecrets(order) : undefined };
        } else if (supTxn) {
          supTxn.status = 'Paid';
          supTxn.updatedAt = new Date().toISOString();
          appendActivity('SUPPORT_RETURN_VERIFIED_PAID', 'system', `Verified support ${supTxn.supportReference} as Paid on return.`, supTxn.id, supTxn.amount);
          const saved = await saveDatabaseStrict(snapshot);
          if (!saved.ok) return { ok: false, statusCode: 503, error: saved.error };
          return { ok: true, kind: 'support', paymentStatus: 'Paid', supportTransaction: supTxn };
        }
      }
      if (check.ok && check.status === 'failed') {
        const snapshot = JSON.stringify(paymentDb);
        if (txn) {
          const order = markOrderPaymentFromGateway(txn, 'Payment Failed', `${targetProvider} return verify`, check.reason);
          const saved = await saveDatabaseStrict(snapshot);
          if (!saved.ok) return { ok: false, statusCode: 503, error: saved.error };
          return { ok: true, kind: 'order', paymentStatus: 'Payment Failed', order: order ? stripOrderSecrets(order) : undefined };
        } else if (supTxn) {
          supTxn.status = 'Payment Failed';
          supTxn.updatedAt = new Date().toISOString();
          const saved = await saveDatabaseStrict(snapshot);
          if (!saved.ok) return { ok: false, statusCode: 503, error: saved.error };
          return { ok: true, kind: 'support', paymentStatus: 'Payment Failed', supportTransaction: supTxn };
        }
      }
    }

    const ord = txn ? paymentDb.orders.find(o => o.id === txn.orderId) : undefined;
    return {
      ok: true,
      kind: txn ? 'order' : 'support',
      paymentStatus: targetStatus,
      order: ord ? stripOrderSecrets(ord) : undefined,
      supportTransaction: supTxn,
    };
  });
}

// ==========================================
// INDEPENDENT SUPPORT ECHOX ENGINE
// ==========================================
export async function createSupportContribution(payload: {
  amount: number;
  method: PaymentMethodType;
  supporterName?: string;
  supporterPhone?: string;
  supporterEmail?: string;
  note?: string;
  transferProof?: Partial<TransferProof>;
  origin?: string;
  actorIp?: string;
}): Promise<{ ok: boolean; statusCode?: number; error?: string; supportTransaction?: SupportTransaction; paymentUrl?: string }> {
  await syncPaymentDbIfStale(true);
  const amt = round3(Number(payload.amount));
  if (!Number.isFinite(amt) || amt <= 0 || amt > 50000) {
    return { ok: false, statusCode: 400, error: 'يرجى إدخال مبلغ دعم صالح (بين 0.5 و 50,000).' };
  }

  const method = normalizePaymentMethod(payload.method);
  const cfg = paymentDb.config;
  if (method === 'cod' && !cfg.methods.cod.enabled) {
    return { ok: false, statusCode: 400, error: 'الدفع النقدي غير مفعّل حالياً.' };
  }
  if (method === 'poste_ccp') {
    const ccpCheck = getPosteCcpTransferDetails();
    if (!ccpCheck.ok) {
      return { ok: false, statusCode: ccpCheck.statusCode || 400, error: ccpCheck.error || 'التحويل عبر Poste / CCP غير متاح حالياً.' };
    }
  }
  if (method === 'bank_transfer') {
    const bankPublic = getVerifiedBankTransferPublic();
    if (bankPublic.tamperDetected || !bankPublic.enabled) {
      return { ok: false, statusCode: 400, error: 'التحويل البنكي غير متاح حالياً.' };
    }
  }
  if (method === 'online_payment' && (!cfg.methods.online_payment.enabled || !isOnlineGatewayReady())) {
    return { ok: false, statusCode: 400, error: 'الدفع الإلكتروني غير مفعّل بعد في مركز التحكم.' };
  }

  const now = new Date().toISOString();
  const supportRef = `ECH-SUP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  let initialStatus: PaymentStatus = 'Cash on Delivery';
  let proof: TransferProof | undefined;

  if (method === 'bank_transfer' || method === 'poste_ccp') {
    if (payload.transferProof?.referenceNumber?.trim()) {
      const cleanImg = sanitizeReceiptImageDataUrl(payload.transferProof.receiptImageDataUrl, {
        source: 'support_bank_proof',
        actorIp: payload.actorIp,
      });
      if (!cleanImg.ok) {
        return { ok: false, statusCode: 400, error: cleanImg.error };
      }
      initialStatus = 'Payment Verification';
      proof = {
        referenceNumber: payload.transferProof.referenceNumber.trim(),
        senderName: (payload.transferProof.senderName || payload.supporterName || 'داعم NIAPOLOR').trim(),
        transferDate: payload.transferProof.transferDate || now.split('T')[0],
        receiptImageDataUrl: cleanImg.value,
        notes: payload.transferProof.notes?.trim(),
        submittedAt: now,
      };
    } else {
      initialStatus = 'Awaiting Bank Transfer';
    }
  } else if (method === 'online_payment') {
    initialStatus = 'Pending Payment';
  }

  let paymentUrl: string | undefined;
  let externalPaymentId: string | undefined;
  let provider: string | undefined;

  if (method === 'online_payment') {
    const gatewayInit = await initiateGatewaySession({
      amount: amt,
      currency: cfg.currency,
      trackingRef: supportRef,
      description: `NIAPOLOR Platform Support ${supportRef}`,
      customerName: payload.supporterName?.trim() || 'NIAPOLOR Supporter',
      customerPhone: payload.supporterPhone?.trim() || '00000000',
      customerEmail: payload.supporterEmail,
      origin: payload.origin,
    });
    if (!gatewayInit.ok) {
      return { ok: false, statusCode: gatewayInit.statusCode || 502, error: gatewayInit.error };
    }
    paymentUrl = gatewayInit.paymentUrl;
    externalPaymentId = gatewayInit.externalPaymentId;
    provider = gatewayInit.provider;
  }

  const snapshot = JSON.stringify(paymentDb);
  const supTxn: SupportTransaction = {
    id: `sup_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    supportReference: supportRef,
    supporterName: payload.supporterName?.trim() || 'داعم NIAPOLOR',
    supporterEmail: payload.supporterEmail?.trim() || '',
    supporterPhone: payload.supporterPhone?.trim() || '',
    note: payload.note?.trim() || '',
    amount: amt,
    currency: cfg.currency,
    method,
    provider,
    externalPaymentId,
    status: initialStatus,
    transferProof: proof,
    createdAt: now,
    updatedAt: now,
  };

  paymentDb.supportTransactions = [supTxn, ...paymentDb.supportTransactions];
  appendActivity(
    'SUPPORT_CONTRIBUTION_CREATED',
    'customer',
    `Independent Support ECHOX contribution (${supportRef}) created via ${method}. Isolated from orders/commissions.`,
    supTxn.id,
    amt
  );
  const saved = await saveDatabaseStrict(snapshot);
  if (!saved.ok) {
    return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
  }

  return { ok: true, supportTransaction: supTxn, paymentUrl };
}

export async function adminVerifySupportTransaction(id: string, action: 'approve' | 'reject'): Promise<{
  ok: boolean;
  statusCode?: number;
  error?: string;
  supportTransaction?: SupportTransaction;
}> {
  await syncPaymentDbIfStale(true);
  const sup = paymentDb.supportTransactions.find(s => s.id === id || s.supportReference === id);
  if (!sup) {
    return { ok: false, statusCode: 404, error: 'معاملة الدعم غير موجودة.' };
  }
  if (sup.status === 'Refunded' || sup.status === 'Cancelled') {
    return { ok: false, statusCode: 400, error: 'لا يمكن تعديل معاملة دعم ملغاة أو مسترجعة.' };
  }
  const snapshot = JSON.stringify(paymentDb);
  const now = new Date().toISOString();
  sup.status = action === 'approve' ? 'Paid' : 'Payment Failed';
  sup.updatedAt = now;
  appendActivity(
    action === 'approve' ? 'SUPPORT_CONTRIBUTION_PAID' : 'SUPPORT_CONTRIBUTION_FAILED',
    'admin',
    `Admin ${action === 'approve' ? 'verified Paid' : 'rejected'} Support ECHOX transaction ${sup.supportReference}.`,
    sup.id,
    sup.amount
  );
  const saved = await saveDatabaseStrict(snapshot);
  if (!saved.ok) {
    return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
  }
  return { ok: true, supportTransaction: sup };
}

export function getPaymentRecoverySnapshot(): RecoverablePaymentSlice {
  return JSON.parse(JSON.stringify(paymentDb));
}

export async function restorePaymentRecoverySnapshot(
  incoming?: Partial<RecoverablePaymentSlice>,
  options: { preserveLiveSecrets?: boolean } = { preserveLiveSecrets: true }
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  await syncPaymentDbIfStale(true);
  if (!incoming || typeof incoming !== 'object') {
    return { ok: true };
  }
  const hasRestorableOrders = Array.isArray(incoming.orders);
  const hasRestorableConfig = Boolean(incoming.config && Object.keys(incoming.config).length > 0 && incoming.config.currency);
  if (!hasRestorableOrders && !hasRestorableConfig) {
    return { ok: true };
  }

  const snapshot = JSON.stringify(paymentDb);
  const liveSecrets = { ...paymentDb.config.secrets };

  const merged = mergeDatabaseSnapshot({
    ...paymentDb,
    ...incoming,
    config: hasRestorableConfig
      ? ({
          ...paymentDb.config,
          ...incoming.config,
          secrets:
            options.preserveLiveSecrets || incoming.secretsOmitted
              ? liveSecrets
              : (incoming.config as any).secrets || liveSecrets,
        } as InternalPaymentConfig)
      : paymentDb.config,
  });

  if (merged.config.methods.bank_transfer.ibanOrRib) {
    merged.config.bankIntegritySeal = computeBankSeal(merged.config.methods.bank_transfer);
  }
  merged.config.updatedAt = new Date().toISOString();

  paymentDb = merged;
  appendActivity(
    'SYSTEM_RECOVERY_APPLIED',
    'admin',
    'Restored payment configuration/orders snapshot via Control Room Safe Recovery.'
  );
  const saved = await saveDatabaseStrict(snapshot);
  if (!saved.ok) {
    return { ok: false, statusCode: saved.statusCode || 503, error: saved.error };
  }
  return { ok: true };
}

export function hasVerifiedCustomerPurchase(params: {
  productId: string;
  customerId?: string;
  customerPhone?: string;
  orderTrackingNumber?: string;
  orderPhone?: string;
}): boolean {
  const cleanProductId = String(params.productId || '').trim();
  if (!cleanProductId) return false;

  const sessionPhoneDigits = normalizePhone(params.customerPhone || '');
  const trackingCode = String(params.orderTrackingNumber || '').trim().toUpperCase();
  const trackingPhoneDigits = normalizePhone(params.orderPhone || '');

  return paymentDb.orders.some((o) => {
    if (!o || o.status === 'cancelled') return false;
    if (
      o.paymentStatus === 'Cancelled' ||
      o.paymentStatus === 'Refunded' ||
      o.paymentStatus === 'Payment Failed' ||
      o.paymentStatus === 'failed'
    ) {
      return false;
    }
    const isCompletedOrPaid =
      o.paymentStatus === 'Paid' || o.paymentStatus === 'paid' || o.status === 'delivered';
    if (!isCompletedOrPaid) return false;

    const containsProduct =
      Array.isArray(o.items) && o.items.some((item) => item.productId === cleanProductId);
    if (!containsProduct) return false;

    const orderPhoneDigits = normalizePhone(o.customerPhone || '');
    const matchesCustomerId = Boolean(params.customerId && o.customerId && o.customerId === params.customerId);
    const matchesSessionPhone = Boolean(
      !o.customerId && sessionPhoneDigits.length === 8 && orderPhoneDigits === sessionPhoneDigits
    );
    const matchesTrackingProof = Boolean(
      trackingCode &&
        trackingPhoneDigits.length === 8 &&
        o.trackingNumber.toUpperCase() === trackingCode &&
        orderPhoneDigits === trackingPhoneDigits
    );

    return matchesCustomerId || matchesSessionPhone || matchesTrackingProof;
  });
}

export function getCustomerScopedOrders(customerId: string): Order[] {
  const cleanId = String(customerId || '').trim();
  if (!cleanId) return [];
  return paymentDb.orders
    .filter((o) => Boolean(o.customerId && o.customerId === cleanId))
    .map(stripOrderSecrets)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}


