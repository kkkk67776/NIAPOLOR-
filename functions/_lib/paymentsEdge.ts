import type {
  FinancialActivityLog,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethodType,
  PaymentStatus,
  PaymentSystemPublicConfig,
  PaymentTransaction,
  Product,
  RefundRequest,
  SupportTransaction,
  TransferProof,
  VendorLedgerEntry,
  VendorSubOrder,
} from '../../src/types/index';
import {
  checkEdgeSlidingWindowLimit,
  EdgeEnv,
  getEdgeClientIp,
  getEdgeRequestOrigin,
  hmacSha256Hex,
  jsonResponse,
  loadEdgeDocWithMeta,
  mutateEdgeDocWithRetry,
  randomHex,
  requireEdgeAdminAuth,
  resolveSharedHmacSecret,
  saveEdgeDoc,
  sha256Hex,
  timingSafeEqualHex,
  verifyEdgeOwnerSession,
} from './firestoreEdge';
import { appendEdgeAdminNotification } from './notificationsEdge';

const CLOUD_PAYMENT_KEY = 'echox:payment_system_data';
const CLOUD_STORE_KEY = 'echox:storefront_state';

interface ServerSecretsConfig {
  apiKey: string;
  walletId: string;
  webhookSecret: string;
}

interface InternalPaymentConfig extends PaymentSystemPublicConfig {
  secrets: ServerSecretsConfig;
  bankIntegritySeal?: string;
  shipping: {
    standardShippingFee: number;
    freeShippingThreshold: number;
  };
}

interface ProductCatalogEntry {
  id: string;
  price: number;
  companyId: string;
  companyName: string;
  active: boolean;
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
  processedWebhookKeys: string[];
  recentCheckoutRequests?: Array<{ key: string; orderId: string; paymentUrl?: string; createdAt: number }>;
}

const DEFAULT_CATALOG: Record<string, ProductCatalogEntry> = {
  prod_titan_drill: {
    id: 'prod_titan_drill',
    price: 345.0,
    companyId: 'comp_echox',
    companyName: 'ECHOX Distribution Tunisie',
    active: true,
  },
  prod_aether_headlight: {
    id: 'prod_aether_headlight',
    price: 680.0,
    companyId: 'comp_atlas',
    companyName: 'Atlas Mécanique & Pièces Sfax',
    active: true,
  },
  prod_fluke_multimeter: {
    id: 'prod_fluke_multimeter',
    price: 520.0,
    companyId: 'comp_med_elec',
    companyName: 'Méditerranée Électronique & Mesure',
    active: true,
  },
};

function createInitialDb(env?: EdgeEnv): PaymentSystemDatabase {
  const now = new Date().toISOString();
  return {
    config: {
      currency: 'TND',
      commissionRatePercent: 10,
      taxRatePercent: 0,
      shipping: {
        standardShippingFee: 7.0,
        freeShippingThreshold: 150.0,
      },
      methods: {
        cod: { enabled: true },
        bank_transfer: {
          enabled: true,
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
          enabled: false,
          provider: 'konnect',
          mode: 'sandbox',
          hasApiKey: false,
          hasWalletId: false,
          hasWebhookSecret: false,
          readyForLive: false,
        },
      },
      secrets: {
        apiKey: (env?.KONNECT_API_KEY || '').trim(),
        walletId: (env?.KONNECT_WALLET_ID || '').trim(),
        webhookSecret: (env?.PAYMENT_WEBHOOK_SECRET || '').trim(),
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
        details: 'Initialized ECHOX STORE multi-vendor payment engine.',
        timestamp: now,
      },
    ],
    processedWebhookKeys: [],
  };
}

function mergePaymentDb(raw: Partial<PaymentSystemDatabase> | null, env?: EdgeEnv): PaymentSystemDatabase {
  const def = createInitialDb(env);
  if (!raw || typeof raw !== 'object') return def;
  return {
    ...def,
    ...raw,
    config: {
      ...def.config,
      ...(raw.config || {}),
      shipping: {
        ...def.config.shipping,
        ...(raw.config?.shipping || {}),
      },
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
      },
      secrets: {
        ...def.config.secrets,
        ...(raw.config?.secrets || {}),
      },
    },
    catalog: { ...DEFAULT_CATALOG, ...(raw.catalog || {}) },
    orders: Array.isArray(raw.orders) ? raw.orders : [],
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    vendorLedgers: Array.isArray(raw.vendorLedgers) ? raw.vendorLedgers : [],
    refundRequests: Array.isArray(raw.refundRequests) ? raw.refundRequests : [],
    supportTransactions: Array.isArray(raw.supportTransactions) ? raw.supportTransactions : [],
    activityLogs: Array.isArray(raw.activityLogs) ? raw.activityLogs : def.activityLogs,
    processedWebhookKeys: Array.isArray(raw.processedWebhookKeys) ? raw.processedWebhookKeys : [],
    recentCheckoutRequests: Array.isArray(raw.recentCheckoutRequests) ? raw.recentCheckoutRequests : [],
  };
}

function maskSecret(val: string): string | undefined {
  if (!val || val.trim().length === 0) return undefined;
  const trimmed = val.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '').slice(-8);
}

function toMinorUnits(amount: number, currency: string): number {
  return currency === 'TND' ? Math.round(amount * 1000) : Math.round(amount * 100);
}

function normalizePaymentMethod(method: PaymentMethodType): 'cod' | 'bank_transfer' | 'online_payment' {
  if (method === 'bank_transfer') return 'bank_transfer';
  if (method === 'online_payment' || method === 'konnect' || method === 'flouci') return 'online_payment';
  return 'cod';
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

function sanitizeReceiptImageDataUrl(raw?: string): { ok: boolean; value?: string; error?: string } {
  if (!raw || typeof raw !== 'string') return { ok: true, value: undefined };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (trimmed.length > 4_800_000) {
    return { ok: false, error: 'حجم صورة وصل التحويل كبير جداً (الحد الأقصى 3.5 ميغابايت).' };
  }
  const rasterMatch = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed);
  if (!rasterMatch) {
    return {
      ok: false,
      error: 'صيغة صورة الوصل غير مدعومة لأسباب أمنية. يرجى رفع صورة PNG أو JPG أو WEBP فقط.',
    };
  }
  return { ok: true, value: trimmed.replace(/\s+/g, '') };
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

async function computeBankSealWithKey(
  bank: {
    accountHolder?: string;
    bankName?: string;
    ibanOrRib?: string;
    swiftCode?: string;
  },
  secret: string
): Promise<string> {
  return hmacSha256Hex(secret, `bank:${getCanonicalBankFields(bank)}`);
}

async function computeIbanFingerprint(ibanOrRib: string): Promise<string> {
  const clean = (ibanOrRib || '').replace(/\s+/g, '').toUpperCase();
  if (!clean) return 'NONE';
  const digest = (await sha256Hex(clean)).slice(0, 8).toUpperCase();
  return `${digest.slice(0, 4)}-${digest.slice(4, 8)}`;
}

async function resolveOrCreateEdgeHmacSecret(env: EdgeEnv): Promise<string | null> {
  const existing = await resolveSharedHmacSecret(env);
  if (existing) return existing;
  const generated = randomHex(48);
  const saved = await saveEdgeDoc(env, 'echox:security_hmac_secret', {
    secret: generated,
    updatedAt: new Date().toISOString(),
  });
  return saved.ok ? generated : null;
}

function isEnvLockedBank(env: EdgeEnv): boolean {
  return Boolean((env.LOCKED_BANK_IBAN || '').trim().length >= 8);
}

async function getVerifiedBankTransferPublicEdge(
  env: EdgeEnv,
  cfg: InternalPaymentConfig,
  docExists: boolean
): Promise<PaymentSystemPublicConfig['methods']['bank_transfer']> {
  const rawBank = cfg.methods.bank_transfer;
  const envIban = (env.LOCKED_BANK_IBAN || '').trim();
  if (envIban.length >= 8) {
    const accountHolder = (env.LOCKED_BANK_HOLDER || rawBank.accountHolder || '').trim();
    const bankName = (env.LOCKED_BANK_NAME || rawBank.bankName || '').trim();
    const swiftCode = (env.LOCKED_BANK_SWIFT || rawBank.swiftCode || '').trim();
    return {
      ...rawBank,
      accountHolder,
      bankName,
      ibanOrRib: envIban,
      swiftCode,
      integrityVerified: true,
      lockedByEnv: true,
      tamperDetected: false,
      ibanFingerprint: await computeIbanFingerprint(envIban),
    };
  }

  const storedSeal = (cfg.bankIntegritySeal || '').trim();
  const sharedSecret = await resolveSharedHmacSecret(env);
  if (!docExists && !storedSeal) {
    return {
      ...rawBank,
      integrityVerified: true,
      lockedByEnv: false,
      tamperDetected: false,
      ibanFingerprint: await computeIbanFingerprint(rawBank.ibanOrRib),
    };
  }

  if (sharedSecret) {
    const expectedSeal = await computeBankSealWithKey(rawBank, sharedSecret);
    const sealValid = Boolean(storedSeal && timingSafeEqualHex(storedSeal, expectedSeal));
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
  }

  return {
    ...rawBank,
    integrityVerified: true,
    lockedByEnv: false,
    tamperDetected: false,
    ibanFingerprint: await computeIbanFingerprint(rawBank.ibanOrRib),
  };
}

function isOnlineGatewayReady(cfg: InternalPaymentConfig): boolean {
  const s = cfg.secrets;
  const provider = cfg.methods.online_payment.provider || 'konnect';
  const hasBasicKeys = Boolean(
    s.apiKey && s.apiKey.trim().length >= 8 && s.walletId && s.walletId.trim().length >= 4
  );
  if (!hasBasicKeys) return false;
  if (provider === 'stripe_custom') {
    return Boolean(s.webhookSecret && s.webhookSecret.trim().length >= 8);
  }
  return true;
}

async function getPublicPaymentConfigEdge(
  env: EdgeEnv,
  db: PaymentSystemDatabase,
  docExists: boolean
): Promise<PaymentSystemPublicConfig> {
  const cfg = db.config;
  const ready = isOnlineGatewayReady(cfg);
  const provider = cfg.methods.online_payment.provider || 'konnect';
  return {
    currency: cfg.currency,
    commissionRatePercent: cfg.commissionRatePercent,
    taxRatePercent: cfg.taxRatePercent,
    standardShippingFee: cfg.shipping.standardShippingFee,
    freeShippingThreshold: cfg.shipping.freeShippingThreshold,
    methods: {
      cod: { enabled: !!cfg.methods.cod.enabled },
      bank_transfer: await getVerifiedBankTransferPublicEdge(env, cfg, docExists),
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

function makeActivity(
  action: string,
  actor: FinancialActivityLog['actor'],
  details: string,
  targetId?: string,
  amount?: number
): FinancialActivityLog {
  return {
    id: `flog_${Date.now()}_${randomHex(3)}`,
    action,
    actor,
    targetId,
    details,
    amount,
    timestamp: new Date().toISOString(),
  };
}

function prependActivity(
  db: PaymentSystemDatabase,
  action: string,
  actor: FinancialActivityLog['actor'],
  details: string,
  targetId?: string,
  amount?: number
): FinancialActivityLog[] {
  return [makeActivity(action, actor, details, targetId, amount), ...db.activityLogs].slice(0, 300);
}

function isBankIdentityChange(
  current: InternalPaymentConfig['methods']['bank_transfer'],
  bankPublicTampered: boolean,
  incoming?: Partial<InternalPaymentConfig['methods']['bank_transfer']>
): boolean {
  if (!incoming) return false;
  const check = (nextVal: string | undefined, curVal: string | undefined) =>
    typeof nextVal === 'string' && nextVal.trim() !== (curVal || '').trim();
  return (
    check(incoming.ibanOrRib, current.ibanOrRib) ||
    check(incoming.accountHolder, current.accountHolder) ||
    check(incoming.bankName, current.bankName) ||
    check(incoming.swiftCode, current.swiftCode) ||
    (incoming.enabled === true && bankPublicTampered)
  );
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function initiateGatewaySessionEdge(
  cfg: InternalPaymentConfig,
  params: {
    amount: number;
    currency: 'TND' | 'EUR' | 'USD';
    trackingRef: string;
    description: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    origin: string;
  }
): Promise<{
  ok: boolean;
  statusCode?: number;
  error?: string;
  externalPaymentId?: string;
  paymentUrl?: string;
  provider?: string;
}> {
  const provider = cfg.methods.online_payment.provider || 'konnect';
  const mode = cfg.methods.online_payment.mode || 'sandbox';
  const origin = params.origin.replace(/\/$/, '');
  const amountMinor = toMinorUnits(params.amount, params.currency);
  const successUrl = `${origin}/?payment_return=success&provider=${encodeURIComponent(provider)}&tracking=${encodeURIComponent(params.trackingRef)}`;
  const failUrl = `${origin}/?payment_return=fail&provider=${encodeURIComponent(provider)}&tracking=${encodeURIComponent(params.trackingRef)}`;

  if (provider === 'konnect') {
    const endpoint =
      mode === 'live'
        ? 'https://api.konnect.network/api/v2/payments/init-payment'
        : 'https://api.sandbox.konnect.network/api/v2/payments/init-payment';
    try {
      const initRes = await fetchWithTimeout(endpoint, {
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
          webhook: `${origin}/api/payments/webhook/konnect`,
          successUrl,
          failUrl,
          silentWebhook: true,
        }),
      });
      const initJson: any = await initRes.json().catch(() => ({}));
      if (!initRes.ok || !isSafeHttpsUrl(initJson?.payUrl)) {
        return {
          ok: false,
          statusCode: 502,
          error:
            initJson?.message ||
            'فشل إنشاء جلسة الدفع الإلكتروني مع بوابة Konnect. يرجى التحقق من المفاتيح أو اختيار وسيلة أخرى.',
        };
      }
      return {
        ok: true,
        provider: 'konnect',
        externalPaymentId: String(initJson.paymentRef || ''),
        paymentUrl: initJson.payUrl,
      };
    } catch {
      return {
        ok: false,
        statusCode: 502,
        error: 'تعذر الاتصال ببوابة Konnect حالياً. يرجى استخدام التحويل البنكي أو الدفع عند الاستلام.',
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
      const initRes = await fetchWithTimeout('https://developers.flouci.com/api/generate_payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      });
      const initJson: any = await initRes.json().catch(() => ({}));
      const payLink = initJson?.result?.link;
      const payId = initJson?.result?.payment_id;
      if (!initRes.ok || !initJson?.result?.success || !isSafeHttpsUrl(payLink)) {
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
    } catch {
      return {
        ok: false,
        statusCode: 502,
        error: 'تعذر الاتصال ببوابة Flouci حالياً. يرجى استخدام التحويل البنكي أو الدفع عند الاستلام.',
      };
    }
  }

  return {
    ok: false,
    statusCode: 400,
    error: 'البوابة المختارة (Custom Bridge) تتطلب ربط رابط دفع خارجي مخصص؛ يرجى اختيار Konnect أو Flouci للدفع المباشر.',
  };
}

async function verifyGatewayPaymentRefEdge(
  cfg: InternalPaymentConfig,
  params: {
    provider: string;
    payRef: string;
    expectedAmount: number;
    expectedCurrency: string;
  }
): Promise<{ ok: boolean; status: 'completed' | 'pending' | 'failed'; reason?: string; statusCode?: number }> {
  const secrets = cfg.secrets;
  const expectedMinor = toMinorUnits(params.expectedAmount, params.expectedCurrency);

  if (params.provider === 'konnect') {
    if (!secrets.apiKey) {
      return { ok: false, status: 'failed', reason: 'Missing Konnect API key', statusCode: 503 };
    }
    const baseUrl =
      cfg.methods.online_payment.mode === 'live'
        ? `https://api.konnect.network/api/v2/payments/${encodeURIComponent(params.payRef)}`
        : `https://api.sandbox.konnect.network/api/v2/payments/${encodeURIComponent(params.payRef)}`;
    try {
      const checkRes = await fetchWithTimeout(baseUrl, {
        headers: { 'x-api-key': secrets.apiKey },
      });
      const checkJson: any = await checkRes.json().catch(() => ({}));
      if (!checkRes.ok || !checkJson?.payment) {
        return { ok: false, status: 'failed', reason: `Konnect returned HTTP ${checkRes.status}`, statusCode: 502 };
      }
      const pStatus = String(checkJson.payment.status || '').toLowerCase();
      const paidAmount = Number(checkJson.payment.amount);
      const paidToken = String(checkJson.payment.token || params.expectedCurrency).toUpperCase();

      if (paidToken !== String(params.expectedCurrency).toUpperCase()) {
        return {
          ok: false,
          status: 'failed',
          reason: `Currency mismatch (${paidToken} != ${params.expectedCurrency})`,
          statusCode: 403,
        };
      }
      if (Number.isFinite(paidAmount) && Math.abs(paidAmount - expectedMinor) > 1) {
        return {
          ok: false,
          status: 'failed',
          reason: `Amount tamper mismatch (${paidAmount} != ${expectedMinor})`,
          statusCode: 403,
        };
      }
      if (pStatus === 'completed' || pStatus === 'paid') return { ok: true, status: 'completed' };
      if (pStatus === 'pending') return { ok: true, status: 'pending' };
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
      const checkRes = await fetchWithTimeout(
        `https://developers.flouci.com/api/verify_payment/${encodeURIComponent(params.payRef)}`,
        {
          method: 'GET',
          headers: {
            apppublic: secrets.apiKey,
            appsecret: secrets.walletId,
          },
        }
      );
      const checkJson: any = await checkRes.json().catch(() => ({}));
      const result = checkJson?.result;
      if (!checkRes.ok || !result) {
        return { ok: false, status: 'failed', reason: `Flouci returned HTTP ${checkRes.status}`, statusCode: 502 };
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
      if (fStatus === 'PENDING' || fStatus === 'CREATED') return { ok: true, status: 'pending' };
      return { ok: true, status: 'failed', reason: `Flouci status=${fStatus}` };
    } catch {
      return { ok: false, status: 'failed', reason: 'Failed to reach Flouci verification API', statusCode: 502 };
    }
  }

  return { ok: false, status: 'failed', reason: 'Unsupported provider verification', statusCode: 400 };
}

function getScopedVendorFinancialsFromDb(db: PaymentSystemDatabase, vendorId: string) {
  const entries = db.vendorLedgers.filter((e) => e.vendorId === vendorId);
  const grossTotal = round3(
    entries.filter((e) => e.payoutStatus !== 'reversed').reduce((s, e) => s + e.grossAmount, 0)
  );
  const commissionTotal = round3(
    entries.filter((e) => e.payoutStatus !== 'reversed').reduce((s, e) => s + e.commissionAmount, 0)
  );
  const netPending = round3(entries.filter((e) => e.payoutStatus === 'pending').reduce((s, e) => s + e.netAmount, 0));
  const netEligible = round3(
    entries.filter((e) => e.payoutStatus === 'eligible').reduce((s, e) => s + e.netAmount, 0)
  );
  const netSettled = round3(entries.filter((e) => e.payoutStatus === 'settled').reduce((s, e) => s + e.netAmount, 0));

  const subOrders = db.orders.flatMap((o) =>
    (o.subOrders || [])
      .filter((s) => s.vendorId === vendorId)
      .map((s) => ({
        ...s,
        orderPaymentStatus: o.paymentStatus,
        orderTrackingStatus: o.status,
        paymentMethod: o.paymentMethod,
      }))
  );

  return {
    vendorId,
    currency: db.config.currency,
    grossTotal,
    commissionTotal,
    netPending,
    netEligible,
    netSettled,
    subOrders,
    ledgerEntries: entries,
  };
}

function canOrderShip(order: Pick<Order, 'paymentMethod' | 'paymentStatus'>): boolean {
  const norm = normalizePaymentMethod(order.paymentMethod);
  if (norm === 'cod') return true;
  return order.paymentStatus === 'Paid' || order.paymentStatus === 'paid';
}

function applyGatewayStatusToOrder(
  db: PaymentSystemDatabase,
  txn: PaymentTransaction,
  nextStatus: PaymentStatus,
  sourceTag: string,
  failureReason?: string
): Order | undefined {
  const now = new Date().toISOString();
  if (txn.status === 'Refunded' || txn.status === 'Cancelled') {
    return db.orders.find((o) => o.id === txn.orderId);
  }
  if (txn.status === 'Paid' && nextStatus !== 'Paid') {
    return db.orders.find((o) => o.id === txn.orderId);
  }

  txn.status = nextStatus;
  txn.failureReason = nextStatus === 'Payment Failed' ? failureReason : undefined;
  txn.updatedAt = now;

  const order = db.orders.find((o) => o.id === txn.orderId);
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
        order.subOrders.forEach((s) => {
          s.payoutStatus = nextStatus === 'Paid' ? 'eligible' : 'pending';
          s.updatedAt = now;
        });
      }
    }
  }

  db.vendorLedgers.forEach((entry) => {
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

export async function syncEdgeCatalogSnapshot(
  env: EdgeEnv,
  products: Array<{ id: string; price: number; companyId?: string; companyName?: string; active?: boolean }>,
  options?: { replaceAll?: boolean }
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  if (!Array.isArray(products)) return { ok: true };
  const hmacSecret = await resolveOrCreateEdgeHmacSecret(env);

  const mut = await mutateEdgeDocWithRetry<PaymentSystemDatabase, boolean>(
    env,
    CLOUD_PAYMENT_KEY,
    async (raw) => {
      const db = mergePaymentDb(raw, env);
      const nextCatalog = { ...db.catalog };
      const seenIds = new Set<string>();
      for (const p of products) {
        if (!p || !p.id || typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price < 0) continue;
        seenIds.add(p.id);
        nextCatalog[p.id] = {
          id: p.id,
          price: round3(p.price),
          companyId: p.companyId || 'comp_echox',
          companyName: p.companyName || 'ECHOX Distribution Tunisie',
          active: p.active !== false,
        };
      }
      if (options?.replaceAll) {
        Object.keys(nextCatalog).forEach((catId) => {
          if (!seenIds.has(catId) && nextCatalog[catId]) {
            nextCatalog[catId] = { ...nextCatalog[catId], active: false };
          }
        });
      }
      const nextConfig = { ...db.config };
      if (!nextConfig.bankIntegritySeal && hmacSecret) {
        nextConfig.bankIntegritySeal = await computeBankSealWithKey(
          nextConfig.methods.bank_transfer,
          hmacSecret
        );
      }
      return {
        nextDoc: { ...db, config: nextConfig, catalog: nextCatalog },
        result: true,
      };
    }
  );
  if (!mut.ok) {
    return { ok: false, statusCode: mut.statusCode || 503, error: mut.error };
  }
  return { ok: true };
}

export async function handleEdgePaymentsRoute(
  request: Request,
  env: EdgeEnv,
  pathname: string,
  waitUntil?: (p: Promise<unknown>) => void,
  rawBodyText?: string
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  const parseJsonBody = async (): Promise<any> => {
    if (typeof rawBodyText === 'string' && rawBodyText.length > 0) {
      try {
        return JSON.parse(rawBodyText);
      } catch {
        return {};
      }
    }
    return request.json().catch(() => ({}));
  };

  // 1. Public Payment Config
  if (method === 'GET' && pathname === '/api/payments/config') {
    const loaded = await loadEdgeDocWithMeta<Partial<PaymentSystemDatabase>>(env, CLOUD_PAYMENT_KEY);
    if (!loaded.ok) return jsonResponse({ success: false, error: loaded.error }, 503);
    const db = mergePaymentDb(loaded.data, env);
    return jsonResponse(await getPublicPaymentConfigEdge(env, db, loaded.exists));
  }

  // 2. Catalog Price Sync (Admin)
  if (method === 'POST' && pathname === '/api/admin/payments/catalog-sync') {
    const auth = await requireEdgeAdminAuth(request, env);
    if (!auth.ok) return auth.response;
    const body = await parseJsonBody();
    const res = await syncEdgeCatalogSnapshot(env, body?.products, { replaceAll: false });
    if (!res.ok) return jsonResponse({ success: false, error: res.error }, res.statusCode || 503);
    return jsonResponse({ success: true });
  }

  // 3. Server-Verified Multi-Vendor Checkout
  if (method === 'POST' && pathname === '/api/payments/checkout') {
    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('checkout', ip, 20, 60_000);
    if (!rate.allowed) {
      return jsonResponse(
        { success: false, error: `تم تجاوز حد الطلبات، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` },
        429
      );
    }

    const input = await parseJsonBody();
    if (!input || !Array.isArray(input.items) || input.items.length === 0) {
      return jsonResponse({ success: false, error: 'السلة فارغة — لا يمكن إتمام الطلب.' }, 400);
    }
    if (!input.customerName?.trim() || !input.customerPhone?.trim() || !input.shippingAddress?.street?.trim()) {
      return jsonResponse({ success: false, error: 'يرجى إكمال بيانات المستلم وعنوان التوصيل.' }, 400);
    }
    const phoneDigits = String(input.customerPhone || '').replace(/\D/g, '');
    if (phoneDigits.length < 6 || phoneDigits.length > 15) {
      return jsonResponse({ success: false, error: 'يرجى إدخال رقم هاتف صحيح (بين 6 و15 رقماً).' }, 400);
    }
    if (
      input.customerEmail &&
      String(input.customerEmail).trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.customerEmail).trim())
    ) {
      return jsonResponse({ success: false, error: 'صيغة البريد الإلكتروني غير صحيحة.' }, 400);
    }

    const reqKey = String(input.clientRequestId || '').trim();
    const normalizedMethod = normalizePaymentMethod(input.paymentMethod);
    const origin = getEdgeRequestOrigin(request, env);

    // Load storefront products lazily only if needed for an item missing from catalog
    let storefrontProductsCache: Product[] | null | undefined;
    const getStorefrontProducts = async (): Promise<Product[] | null> => {
      if (storefrontProductsCache !== undefined) return storefrontProductsCache;
      const storeLoaded = await loadEdgeDocWithMeta<{ products?: Product[] }>(env, CLOUD_STORE_KEY);
      storefrontProductsCache = Array.isArray(storeLoaded.data?.products) ? storeLoaded.data!.products : null;
      return storefrontProductsCache;
    };

    const hmacSecret = await resolveOrCreateEdgeHmacSecret(env);

    // Validate & compute order outside/inside optimistic retry loop
    type CheckoutResult = {
      errStatus?: number;
      errMsg?: string;
      securityAlert?: string;
      order?: Order;
      transaction?: PaymentTransaction;
      paymentUrl?: string;
    };

    let createdGatewaySession: { externalPaymentId?: string; paymentUrl?: string } | null = null;

    const mut = await mutateEdgeDocWithRetry<PaymentSystemDatabase, CheckoutResult>(
      env,
      CLOUD_PAYMENT_KEY,
      async (raw) => {
        const docExists = raw !== null;
        const db = mergePaymentDb(raw, env);

        if (reqKey && reqKey.length >= 8) {
          const nowMs = Date.now();
          const validReqs = (db.recentCheckoutRequests || []).filter(
            (r) => nowMs - r.createdAt < 10 * 60 * 1000
          );
          const existingReq = validReqs.find((r) => r.key === reqKey);
          if (existingReq) {
            const existingOrder = db.orders.find((o) => o.id === existingReq.orderId);
            const existingTxn = db.transactions.find((t) => t.orderId === existingReq.orderId);
            if (existingOrder && existingTxn) {
              return {
                skipWrite: true,
                result: { order: existingOrder, transaction: existingTxn, paymentUrl: existingReq.paymentUrl },
              };
            }
          }
        }

        const cfg = db.config;
        if (normalizedMethod === 'cod' && !cfg.methods.cod.enabled) {
          return { skipWrite: true, result: { errStatus: 400, errMsg: 'وسيلة الدفع عند الاستلام معطلة حالياً من مركز التحكم.' } };
        }
        if (normalizedMethod === 'bank_transfer') {
          const bankPublic = await getVerifiedBankTransferPublicEdge(env, cfg, docExists);
          if (bankPublic.tamperDetected) {
            return {
              skipWrite: true,
              result: {
                errStatus: 403,
                errMsg: 'تم تعليق التحويل البنكي مؤقتاً لعدم تطابق ختم الأمان الخاص بالحساب البنكي. يرجى التواصل مع الإدارة.',
              },
            };
          }
          if (!bankPublic.enabled) {
            return { skipWrite: true, result: { errStatus: 400, errMsg: 'وسيلة التحويل البنكي معطلة حالياً من مركز التحكم.' } };
          }
        }
        if (normalizedMethod === 'online_payment') {
          if (!cfg.methods.online_payment.enabled || !isOnlineGatewayReady(cfg)) {
            return {
              skipWrite: true,
              result: {
                errStatus: 400,
                errMsg: 'الدفع الإلكتروني غير مفعّل بعد: يرجى إعداد مفاتيح البوابة المعتمدة في مركز التحكم أو اختيار الدفع عند الاستلام / التحويل البنكي.',
              },
            };
          }
        }

        const verifiedItems: OrderItem[] = [];
        const nextCatalog = { ...db.catalog };

        for (const rawItem of input.items) {
          const qty = Math.floor(Number(rawItem.quantity));
          if (!Number.isFinite(qty) || qty <= 0 || qty > 1000) {
            return { skipWrite: true, result: { errStatus: 400, errMsg: `كمية غير صالحة للمنتج ${rawItem.productId}.` } };
          }

          let catalogItem = nextCatalog[rawItem.productId];
          if (!catalogItem) {
            const storeProds = await getStorefrontProducts();
            const foundStoreProd = storeProds?.find((p) => p.id === rawItem.productId);
            if (foundStoreProd && typeof foundStoreProd.price === 'number') {
              catalogItem = {
                id: foundStoreProd.id,
                price: round3(foundStoreProd.price),
                companyId: foundStoreProd.companyId || 'comp_echox',
                companyName: 'ECHOX Distribution Tunisie',
                active: foundStoreProd.active !== false,
              };
              nextCatalog[catalogItem.id] = catalogItem;
            }
          }

          let authoritativeUnitPrice: number;
          let authoritativeVendorId: string;
          let authoritativeVendorName: string;

          if (catalogItem) {
            if (!catalogItem.active) {
              return { skipWrite: true, result: { errStatus: 400, errMsg: `المنتج ${rawItem.productId} غير متاح حالياً للشراء.` } };
            }
            if (typeof rawItem.unitPrice === 'number' && Math.abs(rawItem.unitPrice - catalogItem.price) > 0.01) {
              return {
                skipWrite: true,
                result: {
                  errStatus: 400,
                  errMsg: 'تم رفض الطلب: السعر المرسل لا يطابق السعر المعتمد على الخادم.',
                  securityAlert: `تلاعب بسعر المنتج ${rawItem.productId}`,
                },
              };
            }
            authoritativeUnitPrice = catalogItem.price;
            authoritativeVendorId = catalogItem.companyId;
            authoritativeVendorName = catalogItem.companyName;
          } else {
            const submittedPrice = Number(rawItem.unitPrice);
            if (!Number.isFinite(submittedPrice) || submittedPrice <= 0) {
              return { skipWrite: true, result: { errStatus: 400, errMsg: 'سعر المنتج غير صالح.' } };
            }
            authoritativeUnitPrice = round3(submittedPrice);
            authoritativeVendorId = rawItem.companyId || 'comp_echox';
            authoritativeVendorName = rawItem.companyName || 'ECHOX Distribution Tunisie';
            nextCatalog[rawItem.productId] = {
              id: rawItem.productId,
              price: authoritativeUnitPrice,
              companyId: authoritativeVendorId,
              companyName: authoritativeVendorName,
              active: true,
            };
          }

          verifiedItems.push({
            productId: rawItem.productId,
            productName: rawItem.productName,
            productImage: rawItem.productImage || '',
            companyId: authoritativeVendorId,
            companyName: authoritativeVendorName,
            unitPrice: authoritativeUnitPrice,
            quantity: qty,
            totalPrice: round3(authoritativeUnitPrice * qty),
          });
        }

        const subtotal = round3(verifiedItems.reduce((sum, it) => sum + it.totalPrice, 0));
        const cleanCoupon = String(input.couponCode || '').trim().toUpperCase();
        const discountRate = cleanCoupon === 'ECHOX2026' || cleanCoupon === 'ECHOX10' ? 0.1 : 0;
        const discount = round3(subtotal * discountRate);
        const netItemsTotal = Math.max(0, round3(subtotal - discount));
        const taxAmount = round3(netItemsTotal * (cfg.taxRatePercent / 100));
        const shippingFee =
          subtotal >= cfg.shipping.freeShippingThreshold ? 0 : round3(cfg.shipping.standardShippingFee);
        const totalAmount = round3(netItemsTotal + taxAmount + shippingFee);

        if (
          typeof input.clientExpectedTotal === 'number' &&
          Math.abs(input.clientExpectedTotal - totalAmount) > 0.05
        ) {
          return {
            skipWrite: true,
            result: {
              errStatus: 400,
              errMsg: 'تم رفض الطلب لعدم تطابق المبلغ الإجمالي المحسوب خادمياً.',
              securityAlert: `تلاعب بالمبلغ الإجمالي (${input.clientExpectedTotal} != ${totalAmount})`,
            },
          };
        }

        const now = new Date().toISOString();
        const orderId = `ord_${Date.now()}_${randomHex(2)}`;
        const trackingNumber = `ECH-TN-${Math.floor(100000 + Math.random() * 900000)}`;
        const paymentReference = `ECH-REF-${randomHex(4).toUpperCase()}`;
        const transactionId = `txn_${Date.now()}_${randomHex(3)}`;

        const groupedByVendor = new Map<string, { vendorName: string; items: OrderItem[] }>();
        for (const item of verifiedItems) {
          const vId = item.companyId || 'comp_echox';
          const vName = item.companyName || 'ECHOX Distribution Tunisie';
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

          const subOrderId = `sub_${Date.now()}_${vendorId.slice(-6)}_${randomHex(2)}`;
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

        let initialPaymentStatus: PaymentStatus = 'Cash on Delivery';
        let submittedProof: TransferProof | undefined;

        if (normalizedMethod === 'bank_transfer') {
          if (input.transferProof && input.transferProof.referenceNumber?.trim()) {
            const cleanImg = sanitizeReceiptImageDataUrl(input.transferProof.receiptImageDataUrl);
            if (!cleanImg.ok) {
              return {
                skipWrite: true,
                result: {
                  errStatus: 400,
                  errMsg: cleanImg.error,
                  securityAlert: cleanImg.error,
                },
              };
            }
            initialPaymentStatus = 'Payment Verification';
            submittedProof = {
              referenceNumber: String(input.transferProof.referenceNumber).trim(),
              senderName: String(input.transferProof.senderName || input.customerName).trim(),
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

        let externalPaymentId: string | undefined;
        let paymentUrl: string | undefined;

        if (normalizedMethod === 'online_payment') {
          if (!createdGatewaySession) {
            const gatewayInit = await initiateGatewaySessionEdge(cfg, {
              amount: totalAmount,
              currency: cfg.currency,
              trackingRef: trackingNumber,
              description: `ECHOX Store Order ${trackingNumber}`,
              customerName: input.customerName,
              customerPhone: input.customerPhone,
              customerEmail: input.customerEmail,
              origin,
            });
            if (!gatewayInit.ok) {
              return {
                skipWrite: true,
                result: { errStatus: gatewayInit.statusCode || 502, errMsg: gatewayInit.error },
              };
            }
            createdGatewaySession = {
              externalPaymentId: gatewayInit.externalPaymentId,
              paymentUrl: gatewayInit.paymentUrl,
            };
          }
          externalPaymentId = createdGatewaySession.externalPaymentId;
          paymentUrl = createdGatewaySession.paymentUrl;
        }

        const order: Order = {
          id: orderId,
          trackingNumber,
          customerId: input.customerId,
          customerName: String(input.customerName).trim(),
          customerEmail: String(input.customerEmail || '').trim(),
          customerPhone: String(input.customerPhone).trim(),
          shippingAddress: input.shippingAddress,
          items: verifiedItems,
          subtotal,
          discount,
          taxAmount,
          shippingFee,
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
          carrierName: input.carrierName || 'Aramex Express Tunisie',
          createdAt: now,
          updatedAt: now,
          notes: String(input.notes || '').trim(),
          statusHistory: [
            {
              status: 'new',
              timestamp: now,
              note:
                normalizedMethod === 'bank_transfer'
                  ? `تم تسجيل الطلب (${trackingNumber}) — مرجع التحويل: ${paymentReference}`
                  : normalizedMethod === 'online_payment'
                  ? `تم تسجيل الطلب (${trackingNumber}) — بانتظار تأكيد الدفع عبر بوابة ${cfg.methods.online_payment.provider}`
                  : 'تم تسجيل الطلب بنجاح عبر منصة ECHOX STORE (الدفع عند الاستلام)',
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
          provider: normalizedMethod === 'online_payment' ? cfg.methods.online_payment.provider : undefined,
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

        const ledgerEntries: VendorLedgerEntry[] = subOrders.map((sub) => ({
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

        const nextConfig = { ...cfg };
        if (!nextConfig.bankIntegritySeal && hmacSecret) {
          nextConfig.bankIntegritySeal = await computeBankSealWithKey(
            nextConfig.methods.bank_transfer,
            hmacSecret
          );
        }

        const nextRecentReqs =
          reqKey && reqKey.length >= 8
            ? [
                { key: reqKey, orderId, paymentUrl, createdAt: Date.now() },
                ...(db.recentCheckoutRequests || []).filter((r) => Date.now() - r.createdAt < 10 * 60 * 1000).slice(0, 99),
              ]
            : db.recentCheckoutRequests;

        const nextDoc: PaymentSystemDatabase = {
          ...db,
          config: nextConfig,
          catalog: nextCatalog,
          orders: [order, ...db.orders],
          transactions: [transaction, ...db.transactions],
          vendorLedgers: [...ledgerEntries, ...db.vendorLedgers],
          recentCheckoutRequests: nextRecentReqs,
          activityLogs: prependActivity(
            db,
            'ORDER_PAYMENT_CREATED',
            'customer',
            `Order ${trackingNumber} (${normalizedMethod}) created with status "${initialPaymentStatus}" & ${subOrders.length} vendor sub-order(s).`,
            orderId,
            totalAmount
          ),
        };

        return { nextDoc, result: { order, transaction, paymentUrl } };
      }
    );

    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    const out = mut.result!;
    if (out.errMsg) {
      if (out.securityAlert) {
        const alertTask = appendEdgeAdminNotification(env, {
          category: 'security',
          severity: 'critical',
          title: '🚨 صد محاولة تلاعب في الدفع أو الأسعار',
          body: `${out.securityAlert} (IP: ${ip})`,
          url: '/owner/dashboard',
        });
        if (waitUntil) waitUntil(alertTask);
        else await alertTask;
      }
      return jsonResponse({ success: false, error: out.errMsg }, out.errStatus || 400);
    }

    if (out.order) {
      const ord = out.order;
      const notifTask = appendEdgeAdminNotification(env, {
        category: 'order',
        severity: 'success',
        title: `🛒 طلب جديد #${ord.trackingNumber}`,
        body: `${ord.customerName} — ${ord.totalAmount} د.ت (${ord.shippingAddress?.governorate || ''})`,
        url: '/owner/dashboard',
        meta: { trackingNumber: ord.trackingNumber, total: ord.totalAmount },
      });
      if (waitUntil) waitUntil(notifTask);
      else await notifTask;
    }

    return jsonResponse({
      success: true,
      order: out.order,
      transaction: out.transaction,
      paymentUrl: out.paymentUrl,
    });
  }

  // 4. Customer Submit Bank Transfer Proof
  if (method === 'POST' && pathname === '/api/payments/bank-transfer/proof') {
    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('bankProof', ip, 20, 60_000);
    if (!rate.allowed) {
      return jsonResponse(
        { success: false, error: `تم تجاوز حد الإرسال، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` },
        429
      );
    }
    const body = await parseJsonBody();
    const sess = await verifyEdgeOwnerSession(request, env);
    const isAdmin = Boolean(sess && sess.codeVerified);

    const cleanImg = sanitizeReceiptImageDataUrl(body?.receiptImageDataUrl);
    if (!cleanImg.ok) {
      const alertTask = appendEdgeAdminNotification(env, {
        category: 'security',
        severity: 'critical',
        title: '🚨 صد ملف مشبوه في إثبات التحويل',
        body: `${cleanImg.error} (IP: ${ip})`,
        url: '/owner/dashboard',
      });
      if (waitUntil) waitUntil(alertTask);
      else await alertTask;
      return jsonResponse({ success: false, error: cleanImg.error }, 400);
    }

    if (!body?.referenceNumber?.trim() || !body?.senderName?.trim()) {
      return jsonResponse({ success: false, error: 'يرجى إدخال رقم العملية البنكية واسم المحوّل.' }, 400);
    }

    const cleanTrack = String(body?.trackingNumber || '').trim().toUpperCase();
    const mut = await mutateEdgeDocWithRetry<
      PaymentSystemDatabase,
      { errStatus?: number; errMsg?: string; order?: Order }
    >(env, CLOUD_PAYMENT_KEY, async (raw) => {
      const db = mergePaymentDb(raw, env);
      const orderIdx = db.orders.findIndex((o) => o.trackingNumber.toUpperCase() === cleanTrack);
      if (orderIdx < 0) {
        return { skipWrite: true, result: { errStatus: 404, errMsg: 'لم يتم العثور على الطلب بهذا الرقم.' } };
      }
      const order = { ...db.orders[orderIdx] };
      if (!isAdmin) {
        const orderPhone = normalizePhone(order.customerPhone);
        const reqPhone = normalizePhone(body?.customerPhone || '');
        if (orderPhone && reqPhone !== orderPhone) {
          return { skipWrite: true, result: { errStatus: 403, errMsg: 'رقم الهاتف لا يطابق رقم الطلب المسجل.' } };
        }
      }
      if (order.paymentMethod !== 'bank_transfer') {
        return { skipWrite: true, result: { errStatus: 400, errMsg: 'هذا الطلب ليس من نوع التحويل البنكي.' } };
      }
      if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Refunded' || order.paymentStatus === 'Cancelled') {
        return {
          skipWrite: true,
          result: { errStatus: 400, errMsg: `لا يمكن تعديل إثبات الدفع لحالة (${order.paymentStatus}).` },
        };
      }

      const now = new Date().toISOString();
      const proof: TransferProof = {
        referenceNumber: String(body.referenceNumber).trim(),
        senderName: String(body.senderName).trim(),
        transferDate: body.transferDate || now.split('T')[0],
        receiptImageDataUrl: cleanImg.value,
        notes: body.notes?.trim(),
        submittedAt: now,
      };

      order.transferProof = proof;
      order.paymentStatus = 'Payment Verification';
      order.updatedAt = now;

      const nextOrders = [...db.orders];
      nextOrders[orderIdx] = order;

      const nextTxns = db.transactions.map((t) =>
        t.orderId === order.id ? { ...t, transferProof: proof, status: 'Payment Verification' as PaymentStatus, updatedAt: now } : t
      );
      const nextLedgers = db.vendorLedgers.map((l) =>
        l.orderId === order.id ? { ...l, paymentStatus: 'Payment Verification' as PaymentStatus, updatedAt: now } : l
      );

      return {
        nextDoc: {
          ...db,
          orders: nextOrders,
          transactions: nextTxns,
          vendorLedgers: nextLedgers,
          activityLogs: prependActivity(
            db,
            'BANK_TRANSFER_PROOF_SUBMITTED',
            isAdmin ? 'admin' : 'customer',
            `Submitted bank transfer proof (${proof.referenceNumber}) for ${order.trackingNumber}. Awaiting Admin verification.`,
            order.id,
            order.totalAmount
          ),
        },
        result: { order },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    if (mut.result?.errMsg) return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);

    const notifTask = appendEdgeAdminNotification(env, {
      category: 'payment',
      severity: 'info',
      title: `🏦 إثبات تحويل بنكي جديد #${mut.result?.order?.trackingNumber || ''}`,
      body: `المرسل: ${mut.result?.order?.customerName || 'زبون'} — بانتظار المراجعة والاعتماد.`,
      url: '/owner/dashboard',
    });
    if (waitUntil) waitUntil(notifTask);
    else await notifTask;

    return jsonResponse({ success: true, order: mut.result?.order });
  }

  // 5. Customer Request Cancellation / Refund
  if (method === 'POST' && pathname === '/api/payments/request-refund') {
    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('refundReq', ip, 15, 60_000);
    if (!rate.allowed) {
      return jsonResponse(
        { success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` },
        429
      );
    }
    const body = await parseJsonBody();
    const cleanTrack = String(body?.trackingNumber || '').trim().toUpperCase();

    const mut = await mutateEdgeDocWithRetry<
      PaymentSystemDatabase,
      { errStatus?: number; errMsg?: string; refundRequest?: RefundRequest }
    >(env, CLOUD_PAYMENT_KEY, async (raw) => {
      const db = mergePaymentDb(raw, env);
      const order = db.orders.find((o) => o.trackingNumber.toUpperCase() === cleanTrack);
      if (!order) return { skipWrite: true, result: { errStatus: 404, errMsg: 'الطلب غير موجود.' } };
      const orderPhone = normalizePhone(order.customerPhone);
      const reqPhone = normalizePhone(body?.customerPhone || '');
      if (orderPhone && reqPhone !== orderPhone) {
        return { skipWrite: true, result: { errStatus: 403, errMsg: 'رقم الهاتف غير مطابق للطلب.' } };
      }

      const now = new Date().toISOString();
      const refundRequest: RefundRequest = {
        id: `refreq_${Date.now()}`,
        orderId: order.id,
        trackingNumber: order.trackingNumber,
        transactionId: order.transactionId,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        amount: order.totalAmount,
        reason: String(body?.reason || '').trim() || 'طلب إلغاء / استرجاع من الحريف',
        status: 'requested',
        createdAt: now,
        updatedAt: now,
      };
      return {
        nextDoc: {
          ...db,
          refundRequests: [refundRequest, ...db.refundRequests],
          activityLogs: prependActivity(
            db,
            'CUSTOMER_REFUND_REQUESTED',
            'customer',
            `Refund/cancellation requested for ${order.trackingNumber}: ${refundRequest.reason}`,
            order.id,
            order.totalAmount
          ),
        },
        result: { refundRequest },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    if (mut.result?.errMsg) return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);

    const notifTask = appendEdgeAdminNotification(env, {
      category: 'payment',
      severity: 'warning',
      title: '↩️ طلب إلغاء أو استرجاع من زبون',
      body: `رقم الطلب: ${mut.result?.refundRequest?.trackingNumber || ''} — ${mut.result?.refundRequest?.reason || ''}`,
      url: '/owner/dashboard',
    });
    if (waitUntil) waitUntil(notifTask);
    else await notifTask;

    return jsonResponse({ success: true, refundRequest: mut.result?.refundRequest });
  }

  // 6. Payment Webhook (GET & POST)
  const webhookMatch = pathname.match(/^\/api\/payments\/webhook\/([^/]+)$/);
  if ((method === 'GET' || method === 'POST') && webhookMatch) {
    const provider = decodeURIComponent(webhookMatch[1] || 'konnect');
    const urlObj = new URL(request.url);
    const queryObj: Record<string, string> = {};
    urlObj.searchParams.forEach((v, k) => {
      queryObj[k] = v;
    });
    const parsedBody = method === 'POST' ? await parseJsonBody() : {};
    const sigHeader =
      request.headers.get('x-konnect-signature') ||
      request.headers.get('x-signature') ||
      request.headers.get('x-webhook-signature') ||
      '';

    const mut = await mutateEdgeDocWithRetry<
      PaymentSystemDatabase,
      {
        ok: boolean;
        statusCode: number;
        message: string;
        idempotentDuplicate?: boolean;
        sigFraud?: boolean;
        paidNotify?: boolean;
      }
    >(env, CLOUD_PAYMENT_KEY, async (raw) => {
      const db = mergePaymentDb(raw, env);
      const secrets = db.config.secrets;
      const mergedInput: Record<string, any> = {
        ...queryObj,
        ...(parsedBody && typeof parsedBody === 'object' ? parsedBody : {}),
      };
      const isSilentKonnectGet =
        method === 'GET' && provider === 'konnect' && Boolean(mergedInput.payment_ref);

      if (!isSilentKonnectGet && secrets.webhookSecret && secrets.webhookSecret.trim().length > 0) {
        if (!sigHeader) {
          return {
            nextDoc: {
              ...db,
              activityLogs: prependActivity(
                db,
                'WEBHOOK_UNAUTHORIZED',
                'webhook',
                `Rejected ${provider} webhook missing signature header.`
              ),
            },
            result: { ok: false, statusCode: 401, message: 'Missing webhook signature header.' },
          };
        }
        const cleanSig = sigHeader.trim().replace(/^sha256=/i, '');
        const wireText =
          typeof rawBodyText === 'string' && rawBodyText.length > 0
            ? rawBodyText
            : JSON.stringify(parsedBody || {});
        const expectedHmac = await hmacSha256Hex(secrets.webhookSecret.trim(), wireText);
        if (!timingSafeEqualHex(cleanSig, expectedHmac)) {
          return {
            nextDoc: {
              ...db,
              activityLogs: prependActivity(
                db,
                'WEBHOOK_SIGNATURE_INVALID',
                'webhook',
                `Rejected ${provider} webhook with invalid HMAC signature.`
              ),
            },
            result: { ok: false, statusCode: 403, message: 'Invalid webhook signature.', sigFraud: true },
          };
        }
      } else if (!secrets.apiKey) {
        return {
          skipWrite: true,
          result: { ok: false, statusCode: 503, message: 'Gateway not configured on server.' },
        };
      }

      const payRefParam =
        mergedInput?.payment_ref || mergedInput?.paymentRef || mergedInput?.payment_id || '';
      const trackingOrRef =
        mergedInput?.orderId ||
        mergedInput?.trackingNumber ||
        mergedInput?.developer_tracking_id ||
        payRefParam;
      if (!trackingOrRef) {
        return {
          skipWrite: true,
          result: { ok: false, statusCode: 400, message: 'Missing payment or order identifier in webhook payload.' },
        };
      }

      const eventId =
        mergedInput?.eventId ||
        mergedInput?.id ||
        `${provider}:${payRefParam || trackingOrRef}:${mergedInput?.status || method}`;
      if (eventId && db.processedWebhookKeys.includes(eventId)) {
        return {
          skipWrite: true,
          result: {
            ok: true,
            statusCode: 200,
            message: 'Duplicate webhook safely ignored (idempotent).',
            idempotentDuplicate: true,
          },
        };
      }

      const txn = db.transactions.find(
        (t) =>
          t.trackingNumber === trackingOrRef ||
          t.externalPaymentId === trackingOrRef ||
          t.paymentReference === trackingOrRef ||
          (payRefParam && t.externalPaymentId === payRefParam)
      );
      const supTxn = !txn
        ? db.supportTransactions.find(
            (s) =>
              s.supportReference === trackingOrRef ||
              s.externalPaymentId === trackingOrRef ||
              (payRefParam && s.externalPaymentId === payRefParam)
          )
        : undefined;

      if (!txn && !supTxn) {
        return { skipWrite: true, result: { ok: false, statusCode: 404, message: 'Transaction not found.' } };
      }

      const targetAmount = txn ? txn.amount : supTxn!.amount;
      const targetCurrency = txn ? txn.currency : supTxn!.currency;
      const targetExternalRef = (
        txn?.externalPaymentId ||
        supTxn?.externalPaymentId ||
        payRefParam ||
        ''
      ).trim();

      if (
        payRefParam &&
        (txn?.externalPaymentId || supTxn?.externalPaymentId) &&
        payRefParam !== (txn?.externalPaymentId || supTxn?.externalPaymentId)
      ) {
        return {
          nextDoc: {
            ...db,
            activityLogs: prependActivity(
              db,
              'TAMPER_WEBHOOK_REF_MISMATCH',
              'webhook',
              `Rejected mismatched payment_ref (${payRefParam}) on ${trackingOrRef}.`
            ),
          },
          result: { ok: false, statusCode: 403, message: 'Payment reference mismatch.' },
        };
      }

      let verifiedStatus: 'completed' | 'pending' | 'failed' = 'failed';
      if ((provider === 'konnect' || provider === 'flouci') && targetExternalRef) {
        const check = await verifyGatewayPaymentRefEdge(db.config, {
          provider,
          payRef: targetExternalRef,
          expectedAmount: targetAmount,
          expectedCurrency: targetCurrency,
        });
        if (!check.ok) {
          return {
            skipWrite: true,
            result: {
              ok: false,
              statusCode: check.statusCode || 502,
              message: check.reason || 'Gateway verification error.',
            },
          };
        }
        verifiedStatus = check.status;
      } else if (secrets.webhookSecret) {
        const incomingStatus = String(mergedInput?.status || '').toLowerCase();
        verifiedStatus =
          incomingStatus === 'completed' ||
          incomingStatus === 'paid' ||
          incomingStatus === 'succeeded' ||
          incomingStatus === 'success'
            ? 'completed'
            : incomingStatus === 'pending'
            ? 'pending'
            : 'failed';
      }

      if (verifiedStatus === 'pending') {
        return {
          skipWrite: true,
          result: { ok: true, statusCode: 200, message: 'Payment is still pending confirmation.' },
        };
      }

      const nextStatus: PaymentStatus = verifiedStatus === 'completed' ? 'Paid' : 'Payment Failed';
      const targetRefLabel = txn ? txn.trackingNumber : supTxn!.supportReference;

      if (txn) {
        applyGatewayStatusToOrder(db, txn, nextStatus, `${provider} webhook`);
      } else if (supTxn) {
        if (
          supTxn.status !== 'Refunded' &&
          supTxn.status !== 'Cancelled' &&
          !(supTxn.status === 'Paid' && nextStatus !== 'Paid')
        ) {
          supTxn.status = nextStatus;
          supTxn.updatedAt = new Date().toISOString();
        }
      }

      const nextKeys = eventId ? [eventId, ...db.processedWebhookKeys].slice(0, 500) : db.processedWebhookKeys;

      return {
        nextDoc: {
          ...db,
          processedWebhookKeys: nextKeys,
          activityLogs: prependActivity(
            db,
            'WEBHOOK_PROCESSED',
            'webhook',
            `${provider} webhook updated ${targetRefLabel} to ${nextStatus}.`,
            txn ? txn.orderId : supTxn!.id,
            targetAmount
          ),
        },
        result: {
          ok: true,
          statusCode: 200,
          message: `Webhook processed: ${nextStatus}`,
          paidNotify: nextStatus === 'Paid',
        },
      };
    });

    if (!mut.ok) return jsonResponse({ ok: false, statusCode: mut.statusCode || 503, message: mut.error }, mut.statusCode || 503);
    const out = mut.result!;
    if (out.sigFraud) {
      const alertTask = appendEdgeAdminNotification(env, {
        category: 'security',
        severity: 'critical',
        title: `🚨 محاولة تزوير توقيع Webhook (${provider})`,
        body: `تم رفض إشعار دفع بتوقيع غير صالح من ${getEdgeClientIp(request)}.`,
        url: '/owner/dashboard',
      });
      if (waitUntil) waitUntil(alertTask);
      else await alertTask;
    } else if (out.paidNotify) {
      const notifTask = appendEdgeAdminNotification(env, {
        category: 'payment',
        severity: 'success',
        title: `💳 تأكيد دفع إلكتروني (${provider})`,
        body: `تم التحقق من دفع ناجح عبر البوابة: ${out.message}`,
        url: '/owner/dashboard',
      });
      if (waitUntil) waitUntil(notifTask);
      else await notifTask;
    }
    return jsonResponse(out, out.statusCode);
  }

  // 6.1 Verify Gateway Return
  if (method === 'GET' && pathname === '/api/payments/verify-return') {
    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('verifyReturn', ip, 30, 60_000);
    if (!rate.allowed) {
      return jsonResponse(
        { success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` },
        429
      );
    }
    const urlObj = new URL(request.url);
    const cleanTrack = String(urlObj.searchParams.get('tracking') || '').trim().toUpperCase();
    const cleanPayRef = String(
      urlObj.searchParams.get('payment_ref') || urlObj.searchParams.get('payment_id') || ''
    ).trim();
    const providerParam = String(urlObj.searchParams.get('provider') || '').trim();

    const mut = await mutateEdgeDocWithRetry<
      PaymentSystemDatabase,
      {
        errStatus?: number;
        errMsg?: string;
        kind?: 'order' | 'support';
        paymentStatus?: PaymentStatus;
        order?: Order;
        supportTransaction?: SupportTransaction;
        becamePaid?: boolean;
      }
    >(env, CLOUD_PAYMENT_KEY, async (raw) => {
      const db = mergePaymentDb(raw, env);
      const txn = db.transactions.find(
        (t) =>
          (cleanTrack &&
            (t.trackingNumber.toUpperCase() === cleanTrack ||
              t.paymentReference.toUpperCase() === cleanTrack)) ||
          (cleanPayRef && t.externalPaymentId === cleanPayRef)
      );
      const supTxn = !txn
        ? db.supportTransactions.find(
            (s) =>
              (cleanTrack && s.supportReference.toUpperCase() === cleanTrack) ||
              (cleanPayRef && s.externalPaymentId === cleanPayRef)
          )
        : undefined;

      if (!txn && !supTxn) {
        return { skipWrite: true, result: { errStatus: 404, errMsg: 'لم يتم العثور على المعاملة للتحقق منها.' } };
      }

      const targetStatus = txn ? txn.status : supTxn!.status;
      const targetProvider = (
        providerParam ||
        txn?.provider ||
        supTxn?.provider ||
        db.config.methods.online_payment.provider ||
        'konnect'
      ).toLowerCase();
      const extRef = txn?.externalPaymentId || supTxn?.externalPaymentId || cleanPayRef;

      if (targetStatus === 'Paid') {
        return {
          skipWrite: true,
          result: {
            kind: txn ? 'order' : 'support',
            paymentStatus: 'Paid',
            order: txn ? db.orders.find((o) => o.id === txn.orderId) : undefined,
            supportTransaction: supTxn,
          },
        };
      }

      if ((targetProvider === 'konnect' || targetProvider === 'flouci') && extRef) {
        const check = await verifyGatewayPaymentRefEdge(db.config, {
          provider: targetProvider,
          payRef: extRef,
          expectedAmount: txn ? txn.amount : supTxn!.amount,
          expectedCurrency: txn ? txn.currency : supTxn!.currency,
        });
        if (check.ok && (check.status === 'completed' || check.status === 'failed')) {
          const nextStatus: PaymentStatus = check.status === 'completed' ? 'Paid' : 'Payment Failed';
          if (txn) {
            const updatedOrder = applyGatewayStatusToOrder(
              db,
              txn,
              nextStatus,
              `${targetProvider} return verify`,
              check.reason
            );
            return {
              nextDoc: {
                ...db,
                activityLogs:
                  nextStatus === 'Paid'
                    ? prependActivity(
                        db,
                        'GATEWAY_RETURN_VERIFIED_PAID',
                        'system',
                        `Verified ${txn.trackingNumber} as Paid on return.`,
                        txn.orderId,
                        txn.amount
                      )
                    : db.activityLogs,
              },
              result: {
                kind: 'order',
                paymentStatus: nextStatus,
                order: updatedOrder,
                becamePaid: nextStatus === 'Paid',
              },
            };
          } else if (supTxn) {
            supTxn.status = nextStatus;
            supTxn.updatedAt = new Date().toISOString();
            return {
              nextDoc: {
                ...db,
                activityLogs:
                  nextStatus === 'Paid'
                    ? prependActivity(
                        db,
                        'SUPPORT_RETURN_VERIFIED_PAID',
                        'system',
                        `Verified support ${supTxn.supportReference} as Paid on return.`,
                        supTxn.id,
                        supTxn.amount
                      )
                    : db.activityLogs,
              },
              result: {
                kind: 'support',
                paymentStatus: nextStatus,
                supportTransaction: supTxn,
                becamePaid: nextStatus === 'Paid',
              },
            };
          }
        }
      }

      return {
        skipWrite: true,
        result: {
          kind: txn ? 'order' : 'support',
          paymentStatus: targetStatus,
          order: txn ? db.orders.find((o) => o.id === txn.orderId) : undefined,
          supportTransaction: supTxn,
        },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    const out = mut.result!;
    if (out.errMsg) return jsonResponse({ success: false, error: out.errMsg }, out.errStatus || 404);

    if (out.paymentStatus === 'Paid') {
      const notifTask = appendEdgeAdminNotification(env, {
        category: 'payment',
        severity: 'success',
        title: '💳 اكتمال دفع إلكتروني من الزبون',
        body: `الطلب/المساهمة #${out.order?.trackingNumber || out.supportTransaction?.id || ''} مدفوع ومؤكد.`,
        url: '/owner/dashboard',
      });
      if (waitUntil) waitUntil(notifTask);
      else await notifTask;
    }

    return jsonResponse({
      success: true,
      ok: true,
      kind: out.kind,
      paymentStatus: out.paymentStatus,
      order: out.order,
      supportTransaction: out.supportTransaction,
    });
  }

  // 7. Scoped Vendor Financials
  const vendorMatch = pathname.match(/^\/api\/vendor\/([^/]+)\/financials$/);
  if (method === 'GET' && vendorMatch) {
    const vendorId = decodeURIComponent(vendorMatch[1] || '').trim();
    if (!vendorId) return jsonResponse({ error: 'معرف البائع مطلوب.' }, 400);
    const loaded = await loadEdgeDocWithMeta<Partial<PaymentSystemDatabase>>(env, CLOUD_PAYMENT_KEY);
    if (!loaded.ok) return jsonResponse({ error: loaded.error }, 503);
    const db = mergePaymentDb(loaded.data, env);
    return jsonResponse(getScopedVendorFinancialsFromDb(db, vendorId));
  }

  // 8. Independent Support Contribution
  if (method === 'POST' && pathname === '/api/support/contribute') {
    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('supportContribute', ip, 15, 60_000);
    if (!rate.allowed) {
      return jsonResponse(
        { success: false, error: `تم تجاوز حد الطلبات، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` },
        429
      );
    }
    const payload = await parseJsonBody();
    const amt = round3(Number(payload?.amount));
    if (!Number.isFinite(amt) || amt <= 0 || amt > 50000) {
      return jsonResponse({ success: false, error: 'يرجى إدخال مبلغ دعم صالح (بين 0.5 و 50,000).' }, 400);
    }
    const payMethod = normalizePaymentMethod(payload?.method || 'cod');
    const origin = getEdgeRequestOrigin(request, env);
    let createdSupportGateway: { externalPaymentId?: string; paymentUrl?: string; provider?: string } | null = null;

    const mut = await mutateEdgeDocWithRetry<
      PaymentSystemDatabase,
      { errStatus?: number; errMsg?: string; supportTransaction?: SupportTransaction; paymentUrl?: string }
    >(env, CLOUD_PAYMENT_KEY, async (raw) => {
      const db = mergePaymentDb(raw, env);
      const cfg = db.config;
      if (payMethod === 'cod' && !cfg.methods.cod.enabled) {
        return { skipWrite: true, result: { errStatus: 400, errMsg: 'الدفع النقدي غير مفعّل حالياً.' } };
      }
      if (payMethod === 'bank_transfer') {
        const bankPublic = await getVerifiedBankTransferPublicEdge(env, cfg, raw !== null);
        if (bankPublic.tamperDetected || !bankPublic.enabled) {
          return { skipWrite: true, result: { errStatus: 400, errMsg: 'التحويل البنكي غير متاح حالياً.' } };
        }
      }
      if (payMethod === 'online_payment' && (!cfg.methods.online_payment.enabled || !isOnlineGatewayReady(cfg))) {
        return { skipWrite: true, result: { errStatus: 400, errMsg: 'الدفع الإلكتروني غير مفعّل بعد في مركز التحكم.' } };
      }

      const now = new Date().toISOString();
      const supportRef = `ECH-SUP-${randomHex(4).toUpperCase()}`;
      let initialStatus: PaymentStatus = 'Cash on Delivery';
      let proof: TransferProof | undefined;

      if (payMethod === 'bank_transfer') {
        if (payload?.transferProof?.referenceNumber?.trim()) {
          const cleanImg = sanitizeReceiptImageDataUrl(payload.transferProof.receiptImageDataUrl);
          if (!cleanImg.ok) {
            return { skipWrite: true, result: { errStatus: 400, errMsg: cleanImg.error } };
          }
          initialStatus = 'Payment Verification';
          proof = {
            referenceNumber: String(payload.transferProof.referenceNumber).trim(),
            senderName: String(payload.transferProof.senderName || payload.supporterName || 'داعم ECHOX').trim(),
            transferDate: payload.transferProof.transferDate || now.split('T')[0],
            receiptImageDataUrl: cleanImg.value,
            notes: payload.transferProof.notes?.trim(),
            submittedAt: now,
          };
        } else {
          initialStatus = 'Awaiting Bank Transfer';
        }
      } else if (payMethod === 'online_payment') {
        initialStatus = 'Pending Payment';
      }

      if (payMethod === 'online_payment' && !createdSupportGateway) {
        const gw = await initiateGatewaySessionEdge(cfg, {
          amount: amt,
          currency: cfg.currency,
          trackingRef: supportRef,
          description: `ECHOX Platform Support ${supportRef}`,
          customerName: payload.supporterName?.trim() || 'ECHOX Supporter',
          customerPhone: payload.supporterPhone?.trim() || '00000000',
          customerEmail: payload.supporterEmail,
          origin,
        });
        if (!gw.ok) {
          return { skipWrite: true, result: { errStatus: gw.statusCode || 502, errMsg: gw.error } };
        }
        createdSupportGateway = {
          externalPaymentId: gw.externalPaymentId,
          paymentUrl: gw.paymentUrl,
          provider: gw.provider,
        };
      }

      const supTxn: SupportTransaction = {
        id: `sup_${Date.now()}_${randomHex(2)}`,
        supportReference: supportRef,
        supporterName: payload.supporterName?.trim() || 'داعم ECHOX',
        supporterEmail: payload.supporterEmail?.trim() || '',
        supporterPhone: payload.supporterPhone?.trim() || '',
        note: payload.note?.trim() || '',
        amount: amt,
        currency: cfg.currency,
        method: payMethod,
        provider: createdSupportGateway?.provider,
        externalPaymentId: createdSupportGateway?.externalPaymentId,
        status: initialStatus,
        transferProof: proof,
        createdAt: now,
        updatedAt: now,
      };

      return {
        nextDoc: {
          ...db,
          supportTransactions: [supTxn, ...db.supportTransactions],
          activityLogs: prependActivity(
            db,
            'SUPPORT_CONTRIBUTION_CREATED',
            'customer',
            `Independent Support ECHOX contribution (${supportRef}) created via ${payMethod}. Isolated from orders/commissions.`,
            supTxn.id,
            amt
          ),
        },
        result: { supportTransaction: supTxn, paymentUrl: createdSupportGateway?.paymentUrl },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    const out = mut.result!;
    if (out.errMsg) return jsonResponse({ success: false, error: out.errMsg }, out.errStatus || 400);

    if (out.supportTransaction) {
      const notifTask = appendEdgeAdminNotification(env, {
        category: 'payment',
        severity: 'success',
        title: '🤝 مساهمة دعم جديدة لمنصة ECHOX',
        body: `${out.supportTransaction.supporterName || 'داعم'} — ${out.supportTransaction.amount} د.ت`,
        url: '/owner/dashboard',
      });
      if (waitUntil) waitUntil(notifTask);
      else await notifTask;
    }

    return jsonResponse({
      success: true,
      supportTransaction: out.supportTransaction,
      paymentUrl: out.paymentUrl,
    });
  }

  // 8.1 Public Track Order
  const trackMatch = pathname.match(/^\/api\/payments\/track\/([^/]+)$/);
  if (method === 'GET' && trackMatch) {
    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('trackOrder', ip, 40, 60_000);
    if (!rate.allowed) {
      return jsonResponse(
        { success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` },
        429
      );
    }
    const clean = decodeURIComponent(trackMatch[1] || '').trim().toUpperCase();
    if (!clean || clean.length < 4) {
      return jsonResponse({ success: false, error: 'يرجى إدخال رقم تتبع صالح.' }, 400);
    }
    const loaded = await loadEdgeDocWithMeta<Partial<PaymentSystemDatabase>>(env, CLOUD_PAYMENT_KEY);
    if (!loaded.ok) return jsonResponse({ success: false, error: loaded.error }, 503);
    const db = mergePaymentDb(loaded.data, env);
    const found = db.orders.find(
      (o) =>
        o.trackingNumber.toUpperCase() === clean ||
        (o.paymentReference && o.paymentReference.toUpperCase() === clean)
    );
    if (!found) {
      return jsonResponse({ success: false, error: 'لم يتم العثور على طلب بهذا الرمز.' }, 404);
    }
    return jsonResponse({ success: true, order: found });
  }

  // ==========================================
  // ADMIN PAYMENT & ORDER ENDPOINTS
  // ==========================================
  const isAdminPaymentPath =
    pathname.startsWith('/api/admin/payments/') ||
    pathname === '/api/admin/orders' ||
    pathname.startsWith('/api/admin/orders/') ||
    pathname === '/api/admin/support/verify';

  if (isAdminPaymentPath) {
    const auth = await requireEdgeAdminAuth(request, env);
    if (!auth.ok) return auth.response;

    if (method === 'GET' && pathname === '/api/admin/payments/config') {
      const loaded = await loadEdgeDocWithMeta<Partial<PaymentSystemDatabase>>(env, CLOUD_PAYMENT_KEY);
      if (!loaded.ok) return jsonResponse({ success: false, error: loaded.error }, 503);
      const db = mergePaymentDb(loaded.data, env);
      return jsonResponse(await getPublicPaymentConfigEdge(env, db, loaded.exists));
    }

    if (method === 'PUT' && pathname === '/api/admin/payments/config') {
      const body = await parseJsonBody();
      const preLoaded = await loadEdgeDocWithMeta<Partial<PaymentSystemDatabase>>(env, CLOUD_PAYMENT_KEY);
      if (!preLoaded.ok) return jsonResponse({ success: false, error: preLoaded.error }, 503);
      const preDb = mergePaymentDb(preLoaded.data, env);
      const preBankPublic = await getVerifiedBankTransferPublicEdge(env, preDb.config, preLoaded.exists);

      // Step-up Argon2id PIN verification required for any bank identity change -> delegate to Node!
      if (isBankIdentityChange(preDb.config.methods.bank_transfer, Boolean(preBankPublic.tamperDetected), body?.bankTransfer)) {
        if (isEnvLockedBank(env)) {
          return jsonResponse(
            {
              success: false,
              error: 'الحساب البنكي مقفول من متغيرات البيئة (LOCKED_BANK_IBAN) ولا يمكن تعديله من الموقع.',
            },
            403
          );
        }
        return null;
      }

      const hmacSecret = await resolveOrCreateEdgeHmacSecret(env);

      const mut = await mutateEdgeDocWithRetry<
        PaymentSystemDatabase,
        { errStatus?: number; errMsg?: string; config?: PaymentSystemPublicConfig }
      >(env, CLOUD_PAYMENT_KEY, async (raw) => {
        const docExists = raw !== null;
        const db = mergePaymentDb(raw, env);
        const cfg: InternalPaymentConfig = {
          ...db.config,
          shipping: { ...db.config.shipping },
          methods: {
            cod: { ...db.config.methods.cod },
            bank_transfer: {
              ...db.config.methods.bank_transfer,
              instructions: { ...db.config.methods.bank_transfer.instructions },
            },
            online_payment: { ...db.config.methods.online_payment },
          },
          secrets: { ...db.config.secrets },
        };

        const curBankPublic = await getVerifiedBankTransferPublicEdge(env, cfg, docExists);
        if (isBankIdentityChange(cfg.methods.bank_transfer, Boolean(curBankPublic.tamperDetected), body?.bankTransfer)) {
          return {
            skipWrite: true,
            result: {
              errStatus: 403,
              errMsg: 'لتعديل بيانات الحساب البنكي يجب التحقق عبر رمز PIN الأمني.',
            },
          };
        }

        if (body?.currency && ['TND', 'EUR', 'USD'].includes(body.currency)) {
          cfg.currency = body.currency;
        }
        if (typeof body?.commissionRatePercent === 'number') {
          if (body.commissionRatePercent < 0 || body.commissionRatePercent > 50) {
            return { skipWrite: true, result: { errStatus: 400, errMsg: 'نسبة عمولة المنصة يجب أن تكون بين 0% و 50%.' } };
          }
          cfg.commissionRatePercent = round3(body.commissionRatePercent);
        }
        if (typeof body?.taxRatePercent === 'number') {
          if (body.taxRatePercent < 0 || body.taxRatePercent > 40) {
            return { skipWrite: true, result: { errStatus: 400, errMsg: 'نسبة الضريبة يجب أن تكون بين 0% و 40%.' } };
          }
          cfg.taxRatePercent = round3(body.taxRatePercent);
        }
        if (typeof body?.standardShippingFee === 'number' && body.standardShippingFee >= 0) {
          cfg.shipping.standardShippingFee = round3(body.standardShippingFee);
        }
        if (typeof body?.freeShippingThreshold === 'number' && body.freeShippingThreshold >= 0) {
          cfg.shipping.freeShippingThreshold = round3(body.freeShippingThreshold);
        }
        if (typeof body?.codEnabled === 'boolean') {
          cfg.methods.cod.enabled = body.codEnabled;
        }
        if (body?.bankTransfer) {
          cfg.methods.bank_transfer = {
            ...cfg.methods.bank_transfer,
            ...body.bankTransfer,
            instructions: {
              ...cfg.methods.bank_transfer.instructions,
              ...(body.bankTransfer.instructions || {}),
            },
          };
          if (hmacSecret) {
            cfg.bankIntegritySeal = await computeBankSealWithKey(cfg.methods.bank_transfer, hmacSecret);
          }
        }
        if (body?.onlinePayment) {
          if (body.onlinePayment.provider) cfg.methods.online_payment.provider = body.onlinePayment.provider;
          if (body.onlinePayment.mode) cfg.methods.online_payment.mode = body.onlinePayment.mode;
          if (typeof body.onlinePayment.apiKey === 'string' && body.onlinePayment.apiKey.trim()) {
            cfg.secrets.apiKey = body.onlinePayment.apiKey.trim();
          }
          if (typeof body.onlinePayment.walletId === 'string' && body.onlinePayment.walletId.trim()) {
            cfg.secrets.walletId = body.onlinePayment.walletId.trim();
          }
          if (typeof body.onlinePayment.webhookSecret === 'string' && body.onlinePayment.webhookSecret.trim()) {
            cfg.secrets.webhookSecret = body.onlinePayment.webhookSecret.trim();
          }
          if (typeof body.onlinePayment.enabled === 'boolean') {
            if (body.onlinePayment.enabled && !isOnlineGatewayReady(cfg)) {
              return {
                skipWrite: true,
                result: {
                  errStatus: 400,
                  errMsg:
                    'تعذر تفعيل الدفع الإلكتروني: يجب إدخال مفتاح API ومعرّف المحفظة الحقيقيين (Wallet ID & API Key) على الخادم أولاً.',
                },
              };
            }
            cfg.methods.online_payment.enabled = body.onlinePayment.enabled;
          }
        }

        if (!cfg.bankIntegritySeal && hmacSecret) {
          cfg.bankIntegritySeal = await computeBankSealWithKey(cfg.methods.bank_transfer, hmacSecret);
        }
        cfg.updatedAt = new Date().toISOString();

        const nextDb: PaymentSystemDatabase = {
          ...db,
          config: cfg,
          activityLogs: prependActivity(
            db,
            'PAYMENT_CONFIG_UPDATED',
            'admin',
            'Updated payment settings / methods / rates from Admin Panel.'
          ),
        };
        return {
          nextDoc: nextDb,
          result: { config: await getPublicPaymentConfigEdge(env, nextDb, true) },
        };
      });

      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      if (mut.result?.errMsg) {
        return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);
      }

      const notifTask = appendEdgeAdminNotification(env, {
        category: 'activity',
        severity: 'info',
        title: '💳 تحديث إعدادات الدفع في غرفة التحكم',
        body: 'تم حفظ إعدادات بوابات الدفع والتحويل البنكي والعمولات.',
        url: '/owner/dashboard',
      });
      if (waitUntil) waitUntil(notifTask);
      else await notifTask;

      return jsonResponse({ success: true, config: mut.result?.config });
    }

    if (method === 'POST' && pathname === '/api/admin/payments/test-gateway') {
      const checkedAt = new Date().toISOString();
      const mut = await mutateEdgeDocWithRetry<
        PaymentSystemDatabase,
        { ok: boolean; message: string; checkedAt: string }
      >(env, CLOUD_PAYMENT_KEY, async (raw) => {
        const db = mergePaymentDb(raw, env);
        const cfg = db.config;
        const provider = cfg.methods.online_payment.provider || 'konnect';
        const mode = cfg.methods.online_payment.mode || 'sandbox';

        let ok = false;
        let msg = '';

        if (!isOnlineGatewayReady(cfg)) {
          msg =
            provider === 'stripe_custom'
              ? 'Gateway credentials missing: Custom/Stripe Bridge requires API Key, Wallet ID, and Webhook HMAC Secret.'
              : 'Gateway credentials missing: Configure real Provider API Key/App Token and Wallet ID/App Secret on server first.';
        } else if (provider === 'konnect') {
          const baseUrl =
            mode === 'live'
              ? 'https://api.konnect.network/api/v2/payments/test-check'
              : 'https://api.sandbox.konnect.network/api/v2/payments/test-check';
          try {
            const resp = await fetchWithTimeout(baseUrl, {
              method: 'GET',
              headers: { 'x-api-key': cfg.secrets.apiKey },
            });
            if (resp.status === 401 || resp.status === 403) {
              msg = `Konnect rejected credentials (HTTP ${resp.status}). Verify API Key matches ${mode} environment.`;
            } else {
              ok = true;
              msg = `Konnect endpoint reachable (${mode}) and API key accepted (HTTP ${resp.status}).`;
            }
          } catch (err: any) {
            msg = `Konnect connection check failed: ${err?.message || 'Network error'}`;
          }
        } else if (provider === 'flouci') {
          if (cfg.currency !== 'TND') {
            msg = 'Flouci Tunisia supports TND currency only. Change store currency to TND first.';
          } else {
            try {
              const resp = await fetchWithTimeout('https://developers.flouci.com/api/verify_payment/test_check', {
                method: 'GET',
                headers: {
                  apppublic: cfg.secrets.apiKey,
                  appsecret: cfg.secrets.walletId,
                },
              });
              if (resp.status === 401 || resp.status === 403) {
                msg = `Flouci rejected App Token / App Secret (HTTP ${resp.status}).`;
              } else {
                ok = true;
                msg = `Flouci endpoint reachable and credentials format accepted (HTTP ${resp.status}).`;
              }
            } catch (err: any) {
              msg = `Flouci connection check failed: ${err?.message || 'Network error'}`;
            }
          }
        } else {
          ok = true;
          msg =
            'Custom/Stripe Bridge configured with HMAC Webhook secret. Note: automatic checkout redirect requires Konnect or Flouci.';
        }

        const nextDb: PaymentSystemDatabase = {
          ...db,
          config: {
            ...cfg,
            methods: {
              ...cfg.methods,
              online_payment: {
                ...cfg.methods.online_payment,
                lastConnectionCheck: { checkedAt, ok, message: msg },
              },
            },
          },
          activityLogs: ok ? prependActivity(db, 'GATEWAY_TEST_PASSED', 'admin', msg) : db.activityLogs,
        };
        return { nextDoc: nextDb, result: { ok, message: msg, checkedAt } };
      });

      if (!mut.ok) return jsonResponse({ ok: false, message: mut.error || 'Failed connection test', checkedAt }, 503);
      return jsonResponse(mut.result!);
    }

    if (method === 'GET' && pathname === '/api/admin/payments/overview') {
      const loaded = await loadEdgeDocWithMeta<Partial<PaymentSystemDatabase>>(env, CLOUD_PAYMENT_KEY);
      if (!loaded.ok) return jsonResponse({ success: false, error: loaded.error }, 503);
      const db = mergePaymentDb(loaded.data, env);
      const vendorIds = Array.from(new Set(db.vendorLedgers.map((e) => e.vendorId)));
      const vendorSummaries = vendorIds.map((vId) => {
        const first = db.vendorLedgers.find((e) => e.vendorId === vId);
        const scoped = getScopedVendorFinancialsFromDb(db, vId);
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
        db.supportTransactions.filter((s) => s.status === 'Paid').reduce((sum, s) => sum + s.amount, 0)
      );
      return jsonResponse({
        config: await getPublicPaymentConfigEdge(env, db, loaded.exists),
        orders: db.orders,
        transactions: db.transactions,
        vendorLedgers: db.vendorLedgers,
        vendorSummaries,
        refundRequests: db.refundRequests,
        supportTransactions: db.supportTransactions,
        supportTotalPaid,
        activityLogs: db.activityLogs,
      });
    }

    if (method === 'POST' && pathname === '/api/admin/payments/verify') {
      const payload = await parseJsonBody();
      const mut = await mutateEdgeDocWithRetry<
        PaymentSystemDatabase,
        { errStatus?: number; errMsg?: string; order?: Order; transaction?: PaymentTransaction }
      >(env, CLOUD_PAYMENT_KEY, async (raw) => {
        const db = mergePaymentDb(raw, env);
        const txnIdx = db.transactions.findIndex(
          (t) =>
            (payload.transactionId && t.id === payload.transactionId) ||
            (payload.orderId && t.orderId === payload.orderId)
        );
        const txn = txnIdx >= 0 ? { ...db.transactions[txnIdx] } : undefined;
        const orderIdx = db.orders.findIndex(
          (o) => (payload.orderId && o.id === payload.orderId) || (txn && o.id === txn.orderId)
        );
        const order = orderIdx >= 0 ? { ...db.orders[orderIdx] } : undefined;

        if (!order && !txn) {
          return { skipWrite: true, result: { errStatus: 404, errMsg: 'المعاملة المالية غير موجودة.' } };
        }
        if (
          order &&
          (order.paymentStatus === 'Refunded' ||
            order.paymentStatus === 'Cancelled' ||
            order.status === 'cancelled')
        ) {
          return {
            skipWrite: true,
            result: { errStatus: 400, errMsg: 'لا يمكن اعتماد أو تعديل معاملة لطلب ملغى أو مسترجع مسبقاً.' },
          };
        }
        if (txn && (txn.status === 'Refunded' || txn.status === 'Cancelled')) {
          return { skipWrite: true, result: { errStatus: 400, errMsg: 'لا يمكن تعديل معاملة ملغاة أو مسترجعة.' } };
        }

        const now = new Date().toISOString();
        const nextStatus: PaymentStatus = payload.action === 'approve' ? 'Paid' : 'Payment Failed';
        const nextOrders = [...db.orders];
        if (order && orderIdx >= 0) {
          order.paymentStatus = nextStatus;
          order.updatedAt = now;
          if (order.subOrders) {
            order.subOrders = order.subOrders.map((sub) => ({
              ...sub,
              payoutStatus: payload.action === 'approve' ? 'eligible' : 'pending',
              updatedAt: now,
            }));
          }
          nextOrders[orderIdx] = order;
        }
        const nextTxns = [...db.transactions];
        if (txn && txnIdx >= 0) {
          txn.status = nextStatus;
          txn.failureReason =
            payload.action === 'reject' ? payload.reason || 'Rejected by Admin' : undefined;
          txn.verifiedByAdmin = auth.session.email || 'Admin Panel';
          txn.verifiedAt = now;
          txn.updatedAt = now;
          nextTxns[txnIdx] = txn;
        }
        const targetOrderId = order?.id || txn?.orderId || '';
        const nextLedgers = db.vendorLedgers.map((entry) =>
          entry.orderId === targetOrderId
            ? {
                ...entry,
                paymentStatus: nextStatus,
                payoutStatus: (payload.action === 'approve' ? 'eligible' : 'pending') as VendorLedgerEntry['payoutStatus'],
                updatedAt: now,
              }
            : entry
        );

        return {
          nextDoc: {
            ...db,
            orders: nextOrders,
            transactions: nextTxns,
            vendorLedgers: nextLedgers,
            activityLogs: prependActivity(
              db,
              payload.action === 'approve' ? 'PAYMENT_APPROVED_PAID' : 'PAYMENT_REJECTED_FAILED',
              'admin',
              `${payload.action === 'approve' ? 'Marked Paid' : 'Rejected payment'} for ${
                order?.trackingNumber || txn?.trackingNumber
              }${payload.reason ? ` (${payload.reason})` : ''}.`,
              targetOrderId,
              txn?.amount || order?.totalAmount
            ),
          },
          result: { order, transaction: txn },
        };
      });

      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      if (mut.result?.errMsg) return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);
      return jsonResponse({ success: true, order: mut.result?.order, transaction: mut.result?.transaction });
    }

    if (method === 'POST' && pathname === '/api/admin/payments/refund') {
      const payload = await parseJsonBody();
      const mut = await mutateEdgeDocWithRetry<
        PaymentSystemDatabase,
        { errStatus?: number; errMsg?: string; order?: Order }
      >(env, CLOUD_PAYMENT_KEY, async (raw) => {
        const db = mergePaymentDb(raw, env);
        const orderIdx = db.orders.findIndex(
          (o) => o.id === payload.orderId || o.trackingNumber === payload.orderId
        );
        if (orderIdx < 0) {
          return { skipWrite: true, result: { errStatus: 404, errMsg: 'الطلب غير موجود بالنظام المالي.' } };
        }
        const order = { ...db.orders[orderIdx] };
        const now = new Date().toISOString();

        if (payload.action === 'reject_refund') {
          const nextReqs = db.refundRequests.map((r) =>
            r.orderId === order.id && r.status === 'requested'
              ? {
                  ...r,
                  status: 'rejected' as const,
                  adminNote: payload.reason || 'تم رفض طلب الاسترجاع من مركز التحكم',
                  updatedAt: now,
                }
              : r
          );
          return {
            nextDoc: {
              ...db,
              refundRequests: nextReqs,
              activityLogs: prependActivity(
                db,
                'REFUND_REQUEST_REJECTED',
                'admin',
                `Rejected refund request for ${order.trackingNumber}.`,
                order.id
              ),
            },
            result: { order },
          };
        }

        const isRefund = payload.action === 'refund';
        if (isRefund && order.paymentStatus === 'Refunded') {
          return { skipWrite: true, result: { errStatus: 400, errMsg: 'تم استرجاع مبلغ هذا الطلب مسبقاً.' } };
        }
        if (!isRefund && order.paymentStatus === 'Cancelled' && order.status === 'cancelled') {
          return { skipWrite: true, result: { errStatus: 400, errMsg: 'هذا الطلب ملغى مسبقاً.' } };
        }

        const nextPayStatus: PaymentStatus = isRefund ? 'Refunded' : 'Cancelled';
        const reason = payload.reason || (isRefund ? 'تم استرجاع المبلغ من مركز التحكم' : 'تم إلغاء الطلب والدفع');

        order.paymentStatus = nextPayStatus;
        order.status = 'cancelled';
        order.refundReason = reason;
        order.updatedAt = now;
        order.statusHistory = [...order.statusHistory, { status: 'cancelled', timestamp: now, note: reason }];
        if (order.subOrders) {
          order.subOrders = order.subOrders.map((s) => ({ ...s, payoutStatus: 'reversed', updatedAt: now }));
        }

        const nextOrders = [...db.orders];
        nextOrders[orderIdx] = order;
        const txn = db.transactions.find((t) => t.orderId === order.id);
        const nextTxns = db.transactions.map((t) =>
          t.orderId === order.id
            ? { ...t, status: nextPayStatus, refundAmount: isRefund ? t.amount : 0, refundReason: reason, updatedAt: now }
            : t
        );
        const nextLedgers = db.vendorLedgers.map((entry) =>
          entry.orderId === order.id
            ? { ...entry, paymentStatus: nextPayStatus, payoutStatus: 'reversed' as const, updatedAt: now }
            : entry
        );

        let nextReqs = db.refundRequests;
        if (nextReqs.some((r) => r.orderId === order.id)) {
          nextReqs = nextReqs.map((r) =>
            r.orderId === order.id ? { ...r, status: 'processed', adminNote: reason, updatedAt: now } : r
          );
        } else if (isRefund) {
          nextReqs = [
            {
              id: `ref_${Date.now()}`,
              orderId: order.id,
              trackingNumber: order.trackingNumber,
              transactionId: txn?.id,
              customerName: order.customerName,
              customerPhone: order.customerPhone,
              amount: order.totalAmount,
              reason: reason || 'Admin Refund',
              status: 'processed',
              createdAt: now,
              updatedAt: now,
            },
            ...nextReqs,
          ];
        }

        return {
          nextDoc: {
            ...db,
            orders: nextOrders,
            transactions: nextTxns,
            vendorLedgers: nextLedgers,
            refundRequests: nextReqs,
            activityLogs: prependActivity(
              db,
              isRefund ? 'PAYMENT_REFUNDED' : 'PAYMENT_CANCELLED',
              'admin',
              `${isRefund ? 'Refunded' : 'Cancelled'} order ${order.trackingNumber} and reversed vendor ledger balances.`,
              order.id,
              order.totalAmount
            ),
          },
          result: { order },
        };
      });

      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      if (mut.result?.errMsg) return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);
      return jsonResponse({ success: true, order: mut.result?.order });
    }

    if (method === 'POST' && pathname === '/api/admin/payments/vendor-payout') {
      const { vendorId, settlementNote } = await parseJsonBody();
      if (!vendorId) return jsonResponse({ success: false, error: 'معرف البائع مطلوب.' }, 400);

      const mut = await mutateEdgeDocWithRetry<
        PaymentSystemDatabase,
        { settledCount: number; settledTotal: number }
      >(env, CLOUD_PAYMENT_KEY, async (raw) => {
        const db = mergePaymentDb(raw, env);
        const now = new Date().toISOString();
        let settledCount = 0;
        let settledTotal = 0;

        const nextLedgers = db.vendorLedgers.map((entry) => {
          if (entry.vendorId === vendorId && entry.payoutStatus === 'eligible') {
            settledCount += 1;
            settledTotal = round3(settledTotal + entry.netAmount);
            return {
              ...entry,
              payoutStatus: 'settled' as const,
              settledAt: now,
              settlementNote: settlementNote || 'Settled manually from Admin Panel',
              updatedAt: now,
            };
          }
          return entry;
        });

        if (settledCount === 0) {
          return { skipWrite: true, result: { settledCount: 0, settledTotal: 0 } };
        }

        const nextOrders = db.orders.map((o) =>
          o.subOrders
            ? {
                ...o,
                subOrders: o.subOrders.map((sub) =>
                  sub.vendorId === vendorId && sub.payoutStatus === 'eligible'
                    ? { ...sub, payoutStatus: 'settled' as const, updatedAt: now }
                    : sub
                ),
              }
            : o
        );

        return {
          nextDoc: {
            ...db,
            orders: nextOrders,
            vendorLedgers: nextLedgers,
            activityLogs: prependActivity(
              db,
              'VENDOR_PAYOUT_SETTLED',
              'admin',
              `Marked ${settledCount} ledger item(s) settled for vendor ${vendorId} (${settledTotal.toFixed(3)} ${
                db.config.currency
              }). Note: bank payouts are settled manually outside automated split.`,
              vendorId,
              settledTotal
            ),
          },
          result: { settledCount, settledTotal },
        };
      });

      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      return jsonResponse({ success: true, ok: true, ...mut.result });
    }

    if (method === 'POST' && pathname === '/api/admin/support/verify') {
      const { id, action } = await parseJsonBody();
      const mut = await mutateEdgeDocWithRetry<
        PaymentSystemDatabase,
        { errStatus?: number; errMsg?: string; supportTransaction?: SupportTransaction }
      >(env, CLOUD_PAYMENT_KEY, async (raw) => {
        const db = mergePaymentDb(raw, env);
        const idx = db.supportTransactions.findIndex((s) => s.id === id || s.supportReference === id);
        if (idx < 0) return { skipWrite: true, result: { errStatus: 404, errMsg: 'معاملة الدعم غير موجودة.' } };
        const sup = { ...db.supportTransactions[idx] };
        if (sup.status === 'Refunded' || sup.status === 'Cancelled') {
          return { skipWrite: true, result: { errStatus: 400, errMsg: 'لا يمكن تعديل معاملة دعم ملغاة أو مسترجعة.' } };
        }
        const now = new Date().toISOString();
        sup.status = action === 'approve' ? 'Paid' : 'Payment Failed';
        sup.updatedAt = now;
        const nextSups = [...db.supportTransactions];
        nextSups[idx] = sup;

        return {
          nextDoc: {
            ...db,
            supportTransactions: nextSups,
            activityLogs: prependActivity(
              db,
              action === 'approve' ? 'SUPPORT_CONTRIBUTION_PAID' : 'SUPPORT_CONTRIBUTION_FAILED',
              'admin',
              `Admin ${action === 'approve' ? 'verified Paid' : 'rejected'} Support ECHOX transaction ${sup.supportReference}.`,
              sup.id,
              sup.amount
            ),
          },
          result: { supportTransaction: sup },
        };
      });

      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      if (mut.result?.errMsg) return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 400);
      return jsonResponse({ success: true, supportTransaction: mut.result?.supportTransaction });
    }

    if (method === 'GET' && pathname === '/api/admin/orders') {
      const loaded = await loadEdgeDocWithMeta<Partial<PaymentSystemDatabase>>(env, CLOUD_PAYMENT_KEY);
      if (!loaded.ok) return jsonResponse({ success: false, error: loaded.error }, 503);
      const db = mergePaymentDb(loaded.data, env);
      return jsonResponse({ success: true, orders: db.orders || [] });
    }

    if (method === 'POST' && pathname === '/api/admin/orders') {
      const input = (await parseJsonBody()) as Partial<Order>;
      const customerName = (input.customerName || '').trim();
      const customerPhone = (input.customerPhone || '').trim();
      const amount = round3(Number(input.totalAmount ?? input.subtotal ?? 0));
      if (!customerName || !customerPhone || !Number.isFinite(amount) || amount < 0) {
        return jsonResponse({ success: false, error: 'بيانات الطلب اليدوي غير مكتملة أو غير صالحة.' }, 400);
      }

      const mut = await mutateEdgeDocWithRetry<PaymentSystemDatabase, Order>(env, CLOUD_PAYMENT_KEY, async (raw) => {
        const db = mergePaymentDb(raw, env);
        const now = new Date().toISOString();
        const orderId =
          input.id && input.id.startsWith('ord_') ? input.id : `ord_manual_${Date.now()}_${randomHex(2)}`;
        const trackingNumber =
          (input.trackingNumber || '').trim().toUpperCase() ||
          `ECH-TN-${Math.floor(100000 + Math.random() * 900000)}`;
        const payMethod = normalizePaymentMethod(input.paymentMethod || 'cod');
        const paymentStatus: PaymentStatus =
          input.paymentStatus || (payMethod === 'cod' ? 'Cash on Delivery' : 'Pending Payment');

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
          currency: db.config.currency,
          status: input.status || 'new',
          paymentMethod: payMethod,
          paymentStatus,
          carrierName: (input.carrierName || '').trim() || 'LivriTN Logistics',
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

        return {
          nextDoc: {
            ...db,
            orders: [created, ...db.orders.filter((o) => o.id !== created.id)],
            activityLogs: prependActivity(
              db,
              'MANUAL_ORDER_CREATED',
              'admin',
              `Admin recorded manual order ${created.trackingNumber} for ${created.customerName}.`,
              created.id,
              created.totalAmount
            ),
          },
          result: created,
        };
      });

      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      if (mut.result) {
        const notifTask = appendEdgeAdminNotification(env, {
          category: 'order',
          severity: 'info',
          title: `📝 إضافة طلب يدوي #${mut.result.trackingNumber}`,
          body: `${mut.result.customerName} — ${mut.result.totalAmount} د.ت`,
          url: '/owner/dashboard',
        });
        if (waitUntil) waitUntil(notifTask);
        else await notifTask;
      }
      return jsonResponse({ success: true, order: mut.result });
    }

    const orderStatusMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
    if (method === 'PATCH' && orderStatusMatch) {
      const orderId = decodeURIComponent(orderStatusMatch[1] || '');
      const { status, note } = (await parseJsonBody()) as { status: OrderStatus; note?: string };

      const mut = await mutateEdgeDocWithRetry<
        PaymentSystemDatabase,
        { errStatus?: number; errMsg?: string; order?: Order }
      >(env, CLOUD_PAYMENT_KEY, async (raw) => {
        const db = mergePaymentDb(raw, env);
        const orderIdx = db.orders.findIndex((o) => o.id === orderId || o.trackingNumber === orderId);
        if (orderIdx < 0) return { skipWrite: true, result: { errStatus: 404, errMsg: 'الطلب غير موجود.' } };
        const order = { ...db.orders[orderIdx] };
        if (order.status === 'cancelled' && status !== 'cancelled') {
          return { skipWrite: true, result: { errStatus: 409, errMsg: 'لا يمكن شحن أو تفعيل طلب ملغى مالياً.' } };
        }
        const shippingStatuses: OrderStatus[] = ['preparing', 'out_for_delivery', 'delivered'];
        if (shippingStatuses.includes(status) && !canOrderShip(order)) {
          return {
            skipWrite: true,
            result: {
              errStatus: 409,
              errMsg: 'لا يمكن شحن أو تجهيز أو تسليم هذا الطلب قبل تأكيد حالة الدفع كـ "مدفوع" (Paid).',
            },
          };
        }

        const now = new Date().toISOString();
        order.status = status;
        order.updatedAt = now;
        order.statusHistory = [
          ...order.statusHistory,
          { status, timestamp: now, note: note || `Updated shipping status to ${status}` },
        ];

        let nextTxns = db.transactions;
        let nextLedgers = db.vendorLedgers;
        let logs = db.activityLogs;

        if (
          status === 'delivered' &&
          normalizePaymentMethod(order.paymentMethod) === 'cod' &&
          order.paymentStatus !== 'Paid' &&
          order.paymentStatus !== 'paid' &&
          order.paymentStatus !== 'Refunded' &&
          order.paymentStatus !== 'Cancelled'
        ) {
          order.paymentStatus = 'Paid';
          nextTxns = db.transactions.map((t) =>
            t.orderId === order.id
              ? {
                  ...t,
                  status: 'Paid' as PaymentStatus,
                  verifiedByAdmin: 'COD Auto-Settlement on Delivery',
                  verifiedAt: now,
                  updatedAt: now,
                }
              : t
          );
          if (order.subOrders) {
            order.subOrders = order.subOrders.map((sub) => ({
              ...sub,
              payoutStatus: sub.payoutStatus === 'pending' ? 'eligible' : sub.payoutStatus,
              updatedAt: now,
            }));
          }
          nextLedgers = db.vendorLedgers.map((entry) =>
            entry.orderId === order.id
              ? {
                  ...entry,
                  paymentStatus: 'Paid' as PaymentStatus,
                  payoutStatus: entry.payoutStatus === 'pending' ? 'eligible' : entry.payoutStatus,
                  updatedAt: now,
                }
              : entry
          );
          logs = [
            makeActivity(
              'COD_COLLECTED_ON_DELIVERY',
              'system',
              `Marked COD order ${order.trackingNumber} Paid upon delivery and unlocked vendor balances.`,
              order.id,
              order.totalAmount
            ),
            ...logs,
          ];
        }

        const nextOrders = [...db.orders];
        nextOrders[orderIdx] = order;

        return {
          nextDoc: {
            ...db,
            orders: nextOrders,
            transactions: nextTxns,
            vendorLedgers: nextLedgers,
            activityLogs: [
              makeActivity(
                'ORDER_STATUS_UPDATED',
                'admin',
                `Order ${order.trackingNumber} transitioned to "${status}".`,
                order.id
              ),
              ...logs,
            ].slice(0, 300),
          },
          result: { order },
        };
      });

      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      if (mut.result?.errMsg) return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 409);
      return jsonResponse({ success: true, order: mut.result?.order });
    }

    const orderDeleteMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (method === 'DELETE' && orderDeleteMatch) {
      const cleanId = decodeURIComponent(orderDeleteMatch[1] || '').trim();
      const mut = await mutateEdgeDocWithRetry<
        PaymentSystemDatabase,
        { errStatus?: number; errMsg?: string }
      >(env, CLOUD_PAYMENT_KEY, async (raw) => {
        const db = mergePaymentDb(raw, env);
        const target = db.orders.find((o) => o.id === cleanId || o.trackingNumber === cleanId);
        if (!target) {
          return { skipWrite: true, result: { errStatus: 404, errMsg: 'الطلب غير موجود على الخادم.' } };
        }
        return {
          nextDoc: {
            ...db,
            orders: db.orders.filter((o) => o.id !== target.id),
            transactions: db.transactions.filter((t) => t.orderId !== target.id),
            vendorLedgers: db.vendorLedgers.filter((v) => v.orderId !== target.id),
            refundRequests: db.refundRequests.filter((r) => r.orderId !== target.id),
            activityLogs: prependActivity(
              db,
              'ORDER_DELETED',
              'admin',
              `Admin deleted order ${target.trackingNumber} (${target.customerName}).`,
              target.id,
              target.totalAmount
            ),
          },
          result: {},
        };
      });

      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      if (mut.result?.errMsg) return jsonResponse({ success: false, error: mut.result.errMsg }, mut.result.errStatus || 404);
      return jsonResponse({ success: true });
    }
  }

  return null;
}
