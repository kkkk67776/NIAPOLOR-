/**
 * ECHOX SAFE BACKUP v5.3
 * Read-only, fail-closed storefront & local cache backup exporter for ECHOX STORE.
 *
 * Security & Integrity Guarantees:
 * - Zero mutations: never writes to localStorage, sessionStorage, cookies, Firestore, or server endpoints.
 * - Zero access to admin/owner/customer/order/notification/session endpoints or storage keys.
 * - Strictly reads ONLY the 7 approved storefront/UI localStorage keys via direct getItem().
 * - Strips Company contact PII (phone, email, address), SiteSettings contact/address PII
 *   (officialEmail, supportPhone, whatsappPhone, address, addressMultilingual),
 *   Product individual reviews, and sensitive payment/bank/diagnostic fields.
 * - Fail-closed unknown-field detection, duplicate-ID detection, free-text PII/secret scanning,
 *   URL & raster Base64 magic-byte validation, size quotas, and pre/post immutability checks.
 * - Deterministic canonical JSON + SHA-256 verification + round-trip JSON re-parse check.
 * - Local-only Blob export (never uploads or transmits backup payloads).
 */

export const SAFE_BACKUP_VERSION = '5.3.0' as const;

export type BackupMode = 'local-only' | 'storefront-readonly';

export const ALLOWED_LOCAL_STORAGE_KEYS = [
  'echox_products',
  'echox_companies',
  'echox_categories',
  'echox_banners',
  'echox_site_settings',
  'echox_language',
  'echox_theme',
] as const;

export type AllowedLocalStorageKey = (typeof ALLOWED_LOCAL_STORAGE_KEYS)[number];

export const ALLOWED_PUBLIC_ENDPOINTS = {
  storeState: '/api/store/state',
  chatConfig: '/api/chat/config',
  paymentPublicConfig: '/api/payments/config',
  health: '/api/health',
  securitySystemStatus: '/api/security/systemStatus',
} as const;

const BLOCKED_PATH_PREFIXES = [
  '/api/admin/',
  '/api/owner/',
  '/api/orders/',
  '/api/payments/track',
  '/api/notifications/',
  '/api/vendor/',
  '/api/support/',
] as const;

const FORBIDDEN_OUTPUT_KEYS = new Set<string>([
  // Owner / Admin / Inquiries
  'ownersettings',
  'ownername',
  'loginemail',
  'primaryphone',
  'secondaryphone',
  'contactemail',
  'bio',
  'inquiries',
  // SiteSettings PII excluded in v5.1+
  'officialemail',
  'supportphone',
  'whatsappphone',
  'address',
  'addressmultilingual',
  // Company PII excluded
  'phone',
  'email',
  // Product individual reviews excluded in v5.1+
  'reviews',
  'authorname',
  'comment',
  // Orders / Transactions / Customer PII
  'orders',
  'transactions',
  'vendorledgers',
  'vendorsummaries',
  'refundrequests',
  'supporttransactions',
  'supporttotalpaid',
  'activitylogs',
  'suborders',
  'shippingaddress',
  'customername',
  'customeremail',
  'customerphone',
  'customerid',
  'trackingnumber',
  'paymentreference',
  'transferproof',
  'receiptimagedataurl',
  'sendername',
  // Payment secrets & bank identity
  'ibanorrib',
  'ibanfingerprint',
  'accountholder',
  'bankname',
  'swiftcode',
  'bankintegrityseal',
  'apikey',
  'apikeymasked',
  'walletid',
  'walletidmasked',
  'webhooksecret',
  'webhookpath',
  'hasapikey',
  'haswalletid',
  'haswebhooksecret',
  'lastconnectioncheck',
  'integrityverified',
  'lockedbyenv',
  'tamperdetected',
  'secrets',
  // Notifications / Auth / System internals
  'vapidpublickey',
  'vapidprivatekey',
  'vapidkeys',
  'subscriptions',
  'adminsubscriptions',
  'publicsubscriptions',
  'events',
  'notificationsettings',
  'publicannouncements',
  'activesessionscount',
  'datadir',
  'lastclouderror',
  'access_code_argon2',
  'pin_argon2',
  'lock_hash',
  'code_hash',
  'password',
  'passwd',
  'privatekey',
  'private_key',
  'clientemail',
  'client_email',
  'serviceaccount',
  'sessionid',
  'threads',
  'messages',
  '__proto__',
  'constructor',
  'prototype',
]);

const SENSITIVE_QUERY_PARAMS = new Set<string>([
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'code',
  'auth',
  'sig',
  'signature',
  'x-amz-signature',
  'x-amz-credential',
  'x-amz-security-token',
  'x-goog-signature',
  'x-goog-credential',
  'x-goog-algorithm',
  'key',
  'api_key',
  'apikey',
  'secret',
  'client_secret',
  'password',
  'passwd',
  'private_key',
  'session',
  'jwt',
]);

const VALID_DURABLE_PROVIDERS = new Set<string>([
  'firestore',
  'upstash-redis',
  'persistent-disk',
  'local-atomic-disk',
]);

const INSECURE_STORAGE_MODES = new Set<string>([
  'ephemeral-render-disk',
  'proxy-fallback',
]);

export interface BackupLimits {
  maxProducts: number;
  maxCompanies: number;
  maxCategories: number;
  maxBanners: number;
  maxChatRules: number;
  maxSpecsPerProduct: number;
  maxImagesPerProduct: number;
  maxStringLength: number;
  maxImageBase64Bytes: number;
  maxTotalPayloadBytes: number;
}

export const DEFAULT_BACKUP_LIMITS: BackupLimits = {
  maxProducts: 5000,
  maxCompanies: 1000,
  maxCategories: 500,
  maxBanners: 200,
  maxChatRules: 200,
  maxSpecsPerProduct: 100,
  maxImagesPerProduct: 30,
  maxStringLength: 20_000,
  maxImageBase64Bytes: 4 * 1024 * 1024,
  maxTotalPayloadBytes: 15 * 1024 * 1024,
};

export interface StorageLike {
  getItem(key: string): string | null;
}

export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface SafeBackupOptions {
  mode?: BackupMode;
  includeDiagnostics?: boolean;
  includePaymentPublicSummary?: boolean;
  includeChatConfig?: boolean;
  origin?: string;
  storage?: StorageLike;
  fetchFn?: FetchLike;
  limits?: Partial<BackupLimits>;
}

export interface MultilingualText {
  ar: string;
  fr: string;
  en: string;
}

export interface SanitizedProduct {
  schemaVariant: 'canonical-v2';
  id: string;
  name: MultilingualText;
  description: MultilingualText;
  category: string;
  price: number;
  stock: number;
  companyId: string;
  companyName: string;
  governorate: string;
  images: string[];
  active: boolean;
  deliveryTimeDays?: number;
  rating?: number;
  reviewCount?: number;
  originalPrice?: number;
  featured?: boolean;
  videoUrl?: string;
  freeDeliveryThreshold?: number;
  specs?: Array<{ key: MultilingualText; value: MultilingualText }>;
}

export interface SanitizedLegacyMasterProduct {
  schemaVariant: 'legacy-master-v1';
  id: string | number;
  name: string;
  price: string | number;
  stock: string | number;
  status?: string;
  image?: string;
}

export type SanitizedAnyProduct = SanitizedProduct | SanitizedLegacyMasterProduct;

export interface SanitizedCompany {
  id: string;
  name: string;
  logo: string;
  governorate: string;
  description: MultilingualText;
  website?: string;
}

export interface SanitizedCategory {
  id: string;
  label: string;
  icon?: string;
  desc?: string;
}

export interface SanitizedBanner {
  id: string;
  tag: string;
  title: string;
  subtitle: string;
  active: boolean;
  link?: string;
  bgGradient?: string;
}

export interface SanitizedSiteSettings {
  schemaVariant: 'canonical-v2' | 'legacy-partial';
  storeName?: string;
  slogan?: MultilingualText;
  description?: MultilingualText;
  governorate?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  tiktokUrl?: string;
  workingHours?: MultilingualText;
  standardShippingFee?: number;
  freeShippingThreshold?: number;
  enableCOD?: boolean;
  enableBankTransfer?: boolean;
  enableKonnect?: boolean;
  enableFlouci?: boolean;
  announcementText?: MultilingualText;
  showAnnouncement?: boolean;
}

export interface SanitizedPaymentPublicSummary {
  currency: string;
  commissionRatePercent: number;
  taxRatePercent: number;
  standardShippingFee?: number;
  freeShippingThreshold?: number;
  methods: {
    cod: { enabled: boolean };
    bank_transfer: { enabled: boolean };
    online_payment: {
      enabled: boolean;
      provider: string;
      mode: string;
      readyForLive: boolean;
    };
  };
  updatedAt: string;
}

export interface SanitizedChatConfig {
  autoReplyEnabled: boolean;
  welcomeMessage: MultilingualText;
  fallbackMessage: MultilingualText;
  customRules: Array<{
    id: string;
    keyword: string;
    replyAr: string;
    replyFr: string;
    replyEn: string;
  }>;
  updatedAt: string;
}

export interface ServerReportedPersistence {
  reportedIndicatorsOnly: true;
  writeTestPerformed: false;
  note: string;
  allServerReportedIndicatorsNominal: boolean;
  indicators: Record<string, boolean>;
  unmetIndicators: string[];
  healthPersistence: {
    provider: string;
    storageMode: string;
    cloudEnabled: boolean;
    durable: boolean;
    isRender: boolean;
    firestoreProjectId?: string;
    firestoreDatabaseId?: string;
    lastCloudWriteAt: string | null;
  };
  securitySystem: {
    argon2idEnabled: boolean;
    hashingAlgorithm: string;
    serverSideEnforced: boolean;
    accessCodeConfigured: boolean;
    pinConfigured: boolean;
    edgeMode?: boolean;
    updatedAt: string;
  };
  healthMeta: {
    status: string;
    service: string;
    securityEngine: string;
    edgeMode?: boolean;
    timestamp: string;
  };
}

export interface SafeBackupEnvelope {
  meta: {
    backupFormat: 'ECHOX_SAFE_BACKUP';
    version: typeof SAFE_BACKUP_VERSION;
    mode: BackupMode;
    exportedAt: string;
    origin: string;
    readOnly: true;
    strippedByPolicyCounts: Record<string, number>;
    counts: {
      serverProducts: number;
      serverCompanies: number;
      serverCategories: number;
      serverBanners: number;
      localProducts: number;
      localCompanies: number;
      localCategories: number;
      localBanners: number;
      chatRules: number;
    };
    excludedByPolicy: string[];
  };
  serverReportedPersistence: ServerReportedPersistence | null;
  server: {
    storeState: {
      products: SanitizedProduct[];
      companies: SanitizedCompany[];
      categories: SanitizedCategory[];
      banners: SanitizedBanner[];
      siteSettings: SanitizedSiteSettings;
      updatedAt: string;
    } | null;
    paymentPublicSummary: SanitizedPaymentPublicSummary | null;
    chatConfig: SanitizedChatConfig | null;
  } | null;
  browserCache: {
    allowedKeysOnly: readonly AllowedLocalStorageKey[];
    keysStatus: Record<AllowedLocalStorageKey, 'present' | 'missing'>;
    data: {
      echox_products?: SanitizedAnyProduct[];
      echox_companies?: SanitizedCompany[];
      echox_categories?: SanitizedCategory[];
      echox_banners?: SanitizedBanner[];
      echox_site_settings?: SanitizedSiteSettings;
      echox_language?: 'ar' | 'fr' | 'en';
      echox_theme?: 'dark' | 'light';
    };
  };
  integrity: {
    algorithm: 'SHA-256';
    canonicalization: 'sorted-keys-json';
    verifiedServerReRead: boolean;
    verifiedLocalStorageImmutability: boolean;
    payloadBytes: number;
    sectionHashes: {
      serverStoreState: string | null;
      serverPaymentPublicSummary: string | null;
      serverChatConfig: string | null;
      browserCache: string;
    };
    payloadSha256: string;
  };
}

export interface SafeBackupResult {
  envelope: SafeBackupEnvelope;
  jsonText: string;
  fileName: string;
}

export class SafeBackupError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(`[ECHOX SAFE BACKUP ${code}] ${message}`);
    this.name = 'SafeBackupError';
    this.code = code;
  }
}

// ---------- Low-Level Guards ----------

function fail(code: string, message: string): never {
  throw new SafeBackupError(code, message);
}

function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) {
    fail(code, message);
  }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function getOwnSafeKeys(obj: Record<string, unknown>, context: string): string[] {
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      fail('PROTOTYPE_POLLUTION_KEY', `Forbidden prototype key "${k}" detected at ${context}`);
    }
  }
  return keys;
}

function assertNoUnknownKeys(
  obj: Record<string, unknown>,
  allowedKeys: Set<string>,
  policyExcludedKeys: Set<string>,
  context: string,
  auditCounts: Record<string, number>,
  auditPrefix: string
): void {
  const keys = getOwnSafeKeys(obj, context);
  for (const k of keys) {
    if (allowedKeys.has(k)) continue;
    if (policyExcludedKeys.has(k)) {
      const auditKey = `${auditPrefix}.${k}`;
      auditCounts[auditKey] = (auditCounts[auditKey] || 0) + 1;
      continue;
    }
    fail('UNKNOWN_FIELD', `Unrecognized field "${k}" at ${context}; refusing silent drop`);
  }
}

function assertUniqueIds(items: Array<{ id: string | number }>, context: string): void {
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const normalizedId = String(items[i].id).trim();
    if (seen.has(normalizedId)) {
      fail('DUPLICATE_ID', `Duplicate id "${normalizedId}" detected at ${context}[${i}]`);
    }
    seen.add(normalizedId);
  }
}

export function canonicalNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalNormalize(item));
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      if (value[k] !== undefined) {
        sorted[k] = canonicalNormalize(value[k]);
      }
    }
    return sorted;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalNormalize(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  assert(Boolean(subtle), 'CRYPTO_UNAVAILABLE', 'Web Crypto SHA-256 is unavailable in this environment.');
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------- Sensitive Content & Media Inspection ----------

const FREE_TEXT_SECRET_AND_PII_PATTERNS: Array<{ re: RegExp; code: string; label: string }> = [
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i, code: 'SECRET_PEM', label: 'PEM private key' },
  { re: /\$argon2(?:id|i|d)\$/i, code: 'SECRET_ARGON2', label: 'Argon2 hash' },
  { re: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}/, code: 'SECRET_BCRYPT', label: 'Bcrypt hash' },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/, code: 'SECRET_JWT', label: 'JWT token' },
  { re: /\bAIza[0-9A-Za-z\-_]{20,}\b/, code: 'SECRET_GOOGLE_KEY', label: 'Google API key pattern' },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/, code: 'SECRET_GITHUB_TOKEN', label: 'GitHub token pattern' },
  { re: /\b(?:sk_live|rk_live|sk_test|pk_live)_[0-9A-Za-z]{16,}\b/, code: 'SECRET_GATEWAY_KEY', label: 'Gateway API key pattern' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, code: 'SECRET_AWS_KEY', label: 'AWS access key pattern' },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, code: 'SECRET_SLACK_TOKEN', label: 'Slack token pattern' },
  { re: /\bBearer\s+[A-Za-z0-9\-._~+/]{12,}=*/i, code: 'SECRET_BEARER', label: 'Bearer token' },
  { re: /"type"\s*:\s*"service_account"/i, code: 'SECRET_SERVICE_ACCOUNT', label: 'Service account JSON' },
  {
    re: /(?:x-amz-signature|x-goog-signature|access_token|refresh_token|client_secret|webhooksecret|private_key)=/i,
    code: 'SECRET_URL_PARAM',
    label: 'Credential or signed URL parameter',
  },
  { re: /\bTN\d{2}(?:[\s-]?\d{2,4}){4,6}\b/i, code: 'PII_IBAN_TN', label: 'Tunisian IBAN/RIB number' },
  { re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/, code: 'PII_IBAN_GENERIC', label: 'IBAN account pattern' },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, code: 'PII_EMAIL', label: 'Email address in free text' },
  {
    re: /(?:^|[\s(:،,])(?:\+|00)\s*[1-9]\d{0,2}(?:[\s.-]*\d){6,12}(?=$|[\s).,،;!؟])/,
    code: 'PII_PHONE_INTL',
    label: 'International phone number in free text',
  },
  {
    re: /(?:هاتف|تلفون|جوال|اتصل|tel|tél|phone|gsm|whatsapp|واتساب)[:\s.-]*[24579]\d[\s.-]*\d{3}[\s.-]*\d{3}\b/i,
    code: 'PII_PHONE_LOCAL',
    label: 'Phone number with contact context in free text',
  },
  { re: /<\s*(?:script|iframe|object|embed|svg)\b/i, code: 'UNSAFE_HTML_TAG', label: 'Executable HTML/SVG tag' },
  { re: /\bon(?:error|load|click|mouseover)\s*=/i, code: 'UNSAFE_INLINE_EVENT', label: 'Inline DOM event handler' },
  { re: /javascript\s*:/i, code: 'UNSAFE_JS_URI', label: 'javascript: scheme' },
];

export function assertNoSensitiveValue(value: string, context: string): void {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    fail('CONTROL_CHAR', `Control character detected at ${context}`);
  }
  for (const { re, code, label } of FREE_TEXT_SECRET_AND_PII_PATTERNS) {
    if (re.test(value)) {
      fail(code, `Rejected (${label}) at ${context}`);
    }
  }
}

function decodeBase64Bytes(b64: string, context: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    fail('INVALID_BASE64', `Corrupt base64 encoding at ${context}`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function verifyRasterMagicBytes(mime: string, bytes: Uint8Array, context: string): void {
  const m = mime.toLowerCase();
  if (m === 'image/png') {
    const ok =
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    assert(ok, 'INVALID_IMAGE_MAGIC', `PNG header mismatch at ${context}`);
    return;
  }
  if (m === 'image/jpeg' || m === 'image/jpg') {
    const ok = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    assert(ok, 'INVALID_IMAGE_MAGIC', `JPEG header mismatch at ${context}`);
    return;
  }
  if (m === 'image/gif') {
    const ok =
      bytes.length >= 6 &&
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38;
    assert(ok, 'INVALID_IMAGE_MAGIC', `GIF header mismatch at ${context}`);
    return;
  }
  if (m === 'image/webp') {
    const ok =
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;
    assert(ok, 'INVALID_IMAGE_MAGIC', `WEBP header mismatch at ${context}`);
    return;
  }
  fail('DISALLOWED_IMAGE_MIME', `Unsupported image MIME "${mime}" at ${context}`);
}

function validateBase64Image(dataUrl: string, context: string, limits: BackupLimits): string {
  assertNoSensitiveValue(dataUrl, context);
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(
    dataUrl.trim()
  );
  assert(match !== null, 'DISALLOWED_DATA_URI', `Invalid or disallowed data URI at ${context} (SVG/non-raster blocked)`);

  const mime = match[1].toLowerCase();
  const b64Payload = match[2];
  assert(b64Payload.length > 0 && b64Payload.length % 4 === 0, 'INVALID_BASE64', `Invalid base64 padding at ${context}`);

  const estimatedBytes = Math.floor((b64Payload.length * 3) / 4);
  assert(
    estimatedBytes <= limits.maxImageBase64Bytes,
    'IMAGE_SIZE_LIMIT',
    `Base64 image exceeds max limit (${limits.maxImageBase64Bytes} bytes) at ${context}`
  );

  const bytes = decodeBase64Bytes(b64Payload, context);
  verifyRasterMagicBytes(mime, bytes, context);

  // Inspect ASCII prefix inside decoded image bytes for embedded scripts or leaked secrets
  const previewLen = Math.min(bytes.length, 65536);
  let asciiPreview = '';
  for (let i = 0; i < previewLen; i++) {
    asciiPreview += String.fromCharCode(bytes[i]);
  }
  assert(
    !/<script|<svg|javascript:|PRIVATE KEY|AIza|Bearer\s+/i.test(asciiPreview),
    'SUSPICIOUS_IMAGE_CONTENT',
    `Suspicious script or secret bytes detected inside image at ${context}`
  );

  return `data:${mime};base64,${b64Payload}`;
}

export function validateUrlOrMedia(
  raw: unknown,
  context: string,
  limits: BackupLimits,
  options: {
    allowEmpty?: boolean;
    allowRelativePath?: boolean;
    allowDataImage?: boolean;
  } = {}
): string {
  const { allowEmpty = false, allowRelativePath = true, allowDataImage = true } = options;

  assert(typeof raw === 'string', 'INVALID_TYPE', `Expected string URL/media at ${context}`);
  assert(raw.length <= limits.maxImageBase64Bytes * 1.4, 'STRING_SIZE_LIMIT', `Media string exceeds size limit at ${context}`);

  const trimmed = raw.trim();
  if (trimmed === '') {
    assert(allowEmpty, 'EMPTY_MEDIA_URL', `Empty URL/media is not allowed at ${context}`);
    return '';
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('data:')) {
    assert(allowDataImage, 'DISALLOWED_DATA_URI', `Data URI not allowed at ${context}`);
    return validateBase64Image(trimmed, context, limits);
  }

  assert(trimmed.length <= limits.maxStringLength, 'STRING_SIZE_LIMIT', `URL exceeds max string length at ${context}`);

  assert(
    !lower.startsWith('javascript:') &&
      !lower.startsWith('vbscript:') &&
      !lower.startsWith('file:') &&
      !lower.startsWith('blob:') &&
      !lower.startsWith('//'),
    'UNSAFE_URL_SCHEME',
    `Unsafe URL scheme rejected at ${context}`
  );

  if (trimmed.startsWith('/')) {
    assert(allowRelativePath, 'DISALLOWED_RELATIVE_URL', `Relative path not allowed at ${context}`);
    assert(!trimmed.includes('..') && !trimmed.includes('\\'), 'PATH_TRAVERSAL', `Path traversal rejected at ${context}`);
    const parsedRel = new URL(trimmed, 'https://echox.local');
    for (const key of parsedRel.searchParams.keys()) {
      assert(!SENSITIVE_QUERY_PARAMS.has(key.toLowerCase()), 'SENSITIVE_QUERY_PARAM', `Sensitive query param "${key}" at ${context}`);
    }
    assertNoSensitiveValue(trimmed, context);
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    assertNoSensitiveValue(trimmed, context);
    fail('MALFORMED_URL', `Malformed URL at ${context}`);
  }

  assert(parsed.protocol === 'https:' || parsed.protocol === 'http:', 'UNSAFE_URL_PROTOCOL', `Only http/https allowed at ${context}`);
  assert(!parsed.username && !parsed.password, 'URL_CREDENTIALS', `URL credentials rejected at ${context}`);

  for (const key of parsed.searchParams.keys()) {
    assert(!SENSITIVE_QUERY_PARAMS.has(key.toLowerCase()), 'SENSITIVE_QUERY_PARAM', `Sensitive query param "${key}" at ${context}`);
  }

  if (parsed.hash) {
    const hashLower = parsed.hash.toLowerCase();
    for (const sKey of SENSITIVE_QUERY_PARAMS) {
      assert(!hashLower.includes(`${sKey}=`), 'SENSITIVE_URL_FRAGMENT', `Sensitive fragment param "${sKey}" at ${context}`);
    }
  }

  assertNoSensitiveValue(trimmed, context);
  return trimmed;
}

// ---------- Typed Primitive Validators ----------

function requireCleanString(
  val: unknown,
  context: string,
  limits: BackupLimits,
  allowEmpty = false
): string {
  assert(typeof val === 'string', 'INVALID_TYPE', `Expected string at ${context}`);
  assert(val.length <= limits.maxStringLength, 'STRING_SIZE_LIMIT', `String exceeds ${limits.maxStringLength} chars at ${context}`);
  assertNoSensitiveValue(val, context);
  if (!allowEmpty) {
    assert(val.trim().length > 0, 'EMPTY_REQUIRED_STRING', `Required string is empty at ${context}`);
  }
  return val;
}

function requireFiniteNumber(
  val: unknown,
  context: string,
  min = -Infinity,
  max = Infinity
): number {
  assert(
    typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max,
    'INVALID_NUMBER',
    `Expected finite number in [${min}, ${max}] at ${context}`
  );
  return val;
}

function requireBoolean(val: unknown, context: string): boolean {
  assert(typeof val === 'boolean', 'INVALID_BOOLEAN', `Expected boolean at ${context}`);
  return val;
}

function sanitizeMultilingual(
  val: unknown,
  context: string,
  limits: BackupLimits,
  allowEmptyStrings = true
): MultilingualText {
  assert(isPlainObject(val), 'INVALID_MULTILINGUAL', `Expected MultilingualText object at ${context}`);
  const keys = getOwnSafeKeys(val, context);
  for (const k of keys) {
    assert(k === 'ar' || k === 'fr' || k === 'en', 'UNKNOWN_FIELD', `Unexpected key "${k}" in MultilingualText at ${context}`);
  }
  return {
    ar: requireCleanString(val.ar, `${context}.ar`, limits, allowEmptyStrings),
    fr: requireCleanString(val.fr, `${context}.fr`, limits, allowEmptyStrings),
    en: requireCleanString(val.en, `${context}.en`, limits, allowEmptyStrings),
  };
}

// ---------- Deep Output Tree Scanner ----------

export function scanTreeForForbiddenData(node: unknown, path = 'root'): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    if (!/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(node)) {
      assertNoSensitiveValue(node, path);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      scanTreeForForbiddenData(node[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const keys = getOwnSafeKeys(obj, path);
    for (const k of keys) {
      if (FORBIDDEN_OUTPUT_KEYS.has(k.toLowerCase())) {
        fail('FORBIDDEN_KEY_LEAK', `Forbidden key "${k}" present in output at ${path}`);
      }
      scanTreeForForbiddenData(obj[k], `${path}.${k}`);
    }
  }
}

// ---------- Domain Sanitizers ----------

const PRODUCT_ALLOWED_KEYS = new Set<string>([
  'id',
  'name',
  'description',
  'category',
  'price',
  'originalPrice',
  'stock',
  'companyId',
  'companyName',
  'governorate',
  'images',
  'featured',
  'active',
  'videoUrl',
  'deliveryTimeDays',
  'freeDeliveryThreshold',
  'rating',
  'reviewCount',
  'specs',
]);
const PRODUCT_POLICY_EXCLUDED_KEYS = new Set<string>(['reviews']);

const LEGACY_MASTER_PRODUCT_ALLOWED_KEYS = new Set<string>([
  'id',
  'name',
  'price',
  'stock',
  'status',
  'image',
]);

function isRecognizedLegacyMasterProduct(p: Record<string, unknown>): boolean {
  return (
    typeof p.name === 'string' &&
    p.description === undefined &&
    p.companyId === undefined &&
    (typeof p.id === 'number' || typeof p.id === 'string') &&
    (typeof p.price === 'string' || typeof p.price === 'number') &&
    (typeof p.stock === 'string' || typeof p.stock === 'number')
  );
}

export function sanitizeProducts(
  rawProducts: unknown,
  context: string,
  limits: BackupLimits,
  auditCounts: Record<string, number>,
  options: { allowLegacyMaster?: boolean } = {}
): SanitizedAnyProduct[] {
  assert(Array.isArray(rawProducts), 'INVALID_ARRAY', `Expected array at ${context}`);
  assert(rawProducts.length <= limits.maxProducts, 'COUNT_LIMIT', `Product count exceeds ${limits.maxProducts} at ${context}`);

  const out: SanitizedAnyProduct[] = rawProducts.map((item, idx) => {
    const pCtx = `${context}[${idx}]`;
    assert(isPlainObject(item), 'INVALID_RECORD', `Invalid product object at ${pCtx}`);

    if (options.allowLegacyMaster && isRecognizedLegacyMasterProduct(item)) {
      assertNoUnknownKeys(
        item,
        LEGACY_MASTER_PRODUCT_ALLOWED_KEYS,
        new Set<string>(),
        pCtx,
        auditCounts,
        'productLegacy'
      );
      const id =
        typeof item.id === 'number'
          ? requireFiniteNumber(item.id, `${pCtx}.id`, 0)
          : requireCleanString(item.id, `${pCtx}.id`, limits, false);
      const price =
        typeof item.price === 'number'
          ? requireFiniteNumber(item.price, `${pCtx}.price`, 0)
          : requireCleanString(item.price, `${pCtx}.price`, limits, false);
      const stock =
        typeof item.stock === 'number'
          ? requireFiniteNumber(item.stock, `${pCtx}.stock`, 0)
          : requireCleanString(item.stock, `${pCtx}.stock`, limits, false);

      const legacyClean: SanitizedLegacyMasterProduct = {
        schemaVariant: 'legacy-master-v1',
        id,
        name: requireCleanString(item.name, `${pCtx}.name`, limits, false),
        price,
        stock,
      };
      if (item.status !== undefined) {
        legacyClean.status = requireCleanString(item.status, `${pCtx}.status`, limits, true);
      }
      if (item.image !== undefined) {
        legacyClean.image = validateUrlOrMedia(item.image, `${pCtx}.image`, limits, {
          allowEmpty: true,
          allowRelativePath: true,
          allowDataImage: true,
        });
      }
      return legacyClean;
    }

    assertNoUnknownKeys(
      item,
      PRODUCT_ALLOWED_KEYS,
      PRODUCT_POLICY_EXCLUDED_KEYS,
      pCtx,
      auditCounts,
      'product'
    );

    assert(Array.isArray(item.images), 'INVALID_TYPE', `Expected images array at ${pCtx}.images`);
    assert(
      item.images.length <= limits.maxImagesPerProduct,
      'COUNT_LIMIT',
      `Too many images on product at ${pCtx}.images`
    );

    const images = item.images.map((img, iIdx) =>
      validateUrlOrMedia(img, `${pCtx}.images[${iIdx}]`, limits, {
        allowEmpty: false,
        allowRelativePath: true,
        allowDataImage: true,
      })
    );

    const clean: SanitizedProduct = {
      schemaVariant: 'canonical-v2',
      id: requireCleanString(item.id, `${pCtx}.id`, limits, false),
      name: sanitizeMultilingual(item.name, `${pCtx}.name`, limits, false),
      description: sanitizeMultilingual(item.description, `${pCtx}.description`, limits, true),
      category: requireCleanString(item.category, `${pCtx}.category`, limits, false),
      price: requireFiniteNumber(item.price, `${pCtx}.price`, 0),
      stock: requireFiniteNumber(item.stock, `${pCtx}.stock`, 0),
      companyId: requireCleanString(item.companyId, `${pCtx}.companyId`, limits, false),
      companyName: requireCleanString(item.companyName, `${pCtx}.companyName`, limits, false),
      governorate: requireCleanString(item.governorate, `${pCtx}.governorate`, limits, false),
      images,
      active: requireBoolean(item.active, `${pCtx}.active`),
    };

    // Preserve optional or unvalidated fields strictly without fabricating defaults
    if (item.deliveryTimeDays !== undefined) {
      clean.deliveryTimeDays = requireFiniteNumber(item.deliveryTimeDays, `${pCtx}.deliveryTimeDays`, 0);
    }
    if (item.rating !== undefined) {
      clean.rating = requireFiniteNumber(item.rating, `${pCtx}.rating`, 0, 5);
    }
    if (item.reviewCount !== undefined) {
      const count = requireFiniteNumber(item.reviewCount, `${pCtx}.reviewCount`, 0);
      assert(Number.isInteger(count), 'INVALID_NUMBER', `Expected integer reviewCount at ${pCtx}.reviewCount`);
      clean.reviewCount = count;
    }
    if (item.originalPrice !== undefined) {
      clean.originalPrice = requireFiniteNumber(item.originalPrice, `${pCtx}.originalPrice`, 0);
    }
    if (item.featured !== undefined) {
      clean.featured = requireBoolean(item.featured, `${pCtx}.featured`);
    }
    if (item.videoUrl !== undefined) {
      clean.videoUrl = validateUrlOrMedia(item.videoUrl, `${pCtx}.videoUrl`, limits, {
        allowEmpty: true,
        allowRelativePath: true,
        allowDataImage: false,
      });
    }
    if (item.freeDeliveryThreshold !== undefined) {
      clean.freeDeliveryThreshold = requireFiniteNumber(
        item.freeDeliveryThreshold,
        `${pCtx}.freeDeliveryThreshold`,
        0
      );
    }
    if (item.specs !== undefined) {
      assert(Array.isArray(item.specs), 'INVALID_TYPE', `Expected specs array at ${pCtx}.specs`);
      assert(
        item.specs.length <= limits.maxSpecsPerProduct,
        'COUNT_LIMIT',
        `Too many specs at ${pCtx}.specs`
      );
      clean.specs = item.specs.map((sp, sIdx) => {
        const sCtx = `${pCtx}.specs[${sIdx}]`;
        assert(isPlainObject(sp), 'INVALID_RECORD', `Invalid spec object at ${sCtx}`);
        const spKeys = getOwnSafeKeys(sp, sCtx);
        for (const k of spKeys) {
          assert(k === 'key' || k === 'value', 'UNKNOWN_FIELD', `Unexpected spec key "${k}" at ${sCtx}`);
        }
        return {
          key: sanitizeMultilingual(sp.key, `${sCtx}.key`, limits, false),
          value: sanitizeMultilingual(sp.value, `${sCtx}.value`, limits, false),
        };
      });
    }

    return clean;
  });

  assert(out.length === rawProducts.length, 'COUNT_MISMATCH', `Product count mismatch at ${context}`);
  assertUniqueIds(out, context);
  return out;
}

const COMPANY_ALLOWED_KEYS = new Set<string>([
  'id',
  'name',
  'logo',
  'governorate',
  'description',
  'website',
]);
const COMPANY_POLICY_EXCLUDED_KEYS = new Set<string>(['phone', 'email', 'address']);

export function sanitizeCompanies(
  rawCompanies: unknown,
  context: string,
  limits: BackupLimits,
  auditCounts: Record<string, number>
): SanitizedCompany[] {
  assert(Array.isArray(rawCompanies), 'INVALID_ARRAY', `Expected array at ${context}`);
  assert(rawCompanies.length <= limits.maxCompanies, 'COUNT_LIMIT', `Company count exceeds ${limits.maxCompanies} at ${context}`);

  const out: SanitizedCompany[] = rawCompanies.map((item, idx) => {
    const cCtx = `${context}[${idx}]`;
    assert(isPlainObject(item), 'INVALID_RECORD', `Invalid company object at ${cCtx}`);
    assertNoUnknownKeys(
      item,
      COMPANY_ALLOWED_KEYS,
      COMPANY_POLICY_EXCLUDED_KEYS,
      cCtx,
      auditCounts,
      'company'
    );

    const clean: SanitizedCompany = {
      id: requireCleanString(item.id, `${cCtx}.id`, limits, false),
      name: requireCleanString(item.name, `${cCtx}.name`, limits, false),
      logo: validateUrlOrMedia(item.logo, `${cCtx}.logo`, limits, {
        allowEmpty: false,
        allowRelativePath: true,
        allowDataImage: true,
      }),
      governorate: requireCleanString(item.governorate, `${cCtx}.governorate`, limits, false),
      description: sanitizeMultilingual(item.description, `${cCtx}.description`, limits, true),
    };

    if (item.website !== undefined) {
      clean.website = validateUrlOrMedia(item.website, `${cCtx}.website`, limits, {
        allowEmpty: true,
        allowRelativePath: false,
        allowDataImage: false,
      });
    }

    return clean;
  });

  assert(out.length === rawCompanies.length, 'COUNT_MISMATCH', `Company count mismatch at ${context}`);
  assertUniqueIds(out, context);
  return out;
}

const CATEGORY_ALLOWED_KEYS = new Set<string>(['id', 'label', 'icon', 'desc']);

export function sanitizeCategories(
  rawCategories: unknown,
  context: string,
  limits: BackupLimits,
  auditCounts: Record<string, number>
): SanitizedCategory[] {
  assert(Array.isArray(rawCategories), 'INVALID_ARRAY', `Expected array at ${context}`);
  assert(
    rawCategories.length <= limits.maxCategories,
    'COUNT_LIMIT',
    `Category count exceeds ${limits.maxCategories} at ${context}`
  );

  const out: SanitizedCategory[] = rawCategories.map((item, idx) => {
    const catCtx = `${context}[${idx}]`;
    assert(isPlainObject(item), 'INVALID_RECORD', `Invalid category object at ${catCtx}`);
    assertNoUnknownKeys(
      item,
      CATEGORY_ALLOWED_KEYS,
      new Set<string>(),
      catCtx,
      auditCounts,
      'category'
    );

    const clean: SanitizedCategory = {
      id: requireCleanString(item.id, `${catCtx}.id`, limits, false),
      label: requireCleanString(item.label, `${catCtx}.label`, limits, false),
    };
    if (item.icon !== undefined) clean.icon = requireCleanString(item.icon, `${catCtx}.icon`, limits, true);
    if (item.desc !== undefined) clean.desc = requireCleanString(item.desc, `${catCtx}.desc`, limits, true);
    return clean;
  });

  assert(out.length === rawCategories.length, 'COUNT_MISMATCH', `Category count mismatch at ${context}`);
  assertUniqueIds(out, context);
  return out;
}

const BANNER_ALLOWED_KEYS = new Set<string>(['id', 'tag', 'title', 'subtitle', 'active', 'link', 'bgGradient']);

export function sanitizeBanners(
  rawBanners: unknown,
  context: string,
  limits: BackupLimits,
  auditCounts: Record<string, number>
): SanitizedBanner[] {
  assert(Array.isArray(rawBanners), 'INVALID_ARRAY', `Expected array at ${context}`);
  assert(rawBanners.length <= limits.maxBanners, 'COUNT_LIMIT', `Banner count exceeds ${limits.maxBanners} at ${context}`);

  const out: SanitizedBanner[] = rawBanners.map((item, idx) => {
    const bCtx = `${context}[${idx}]`;
    assert(isPlainObject(item), 'INVALID_RECORD', `Invalid banner object at ${bCtx}`);
    assertNoUnknownKeys(
      item,
      BANNER_ALLOWED_KEYS,
      new Set<string>(),
      bCtx,
      auditCounts,
      'banner'
    );

    const clean: SanitizedBanner = {
      id: requireCleanString(item.id, `${bCtx}.id`, limits, false),
      tag: requireCleanString(item.tag, `${bCtx}.tag`, limits, true),
      title: requireCleanString(item.title, `${bCtx}.title`, limits, false),
      subtitle: requireCleanString(item.subtitle, `${bCtx}.subtitle`, limits, true),
      active: requireBoolean(item.active, `${bCtx}.active`),
    };
    if (item.link !== undefined) {
      clean.link = validateUrlOrMedia(item.link, `${bCtx}.link`, limits, {
        allowEmpty: true,
        allowRelativePath: true,
        allowDataImage: false,
      });
    }
    if (item.bgGradient !== undefined) {
      clean.bgGradient = requireCleanString(item.bgGradient, `${bCtx}.bgGradient`, limits, true);
    }
    return clean;
  });

  assert(out.length === rawBanners.length, 'COUNT_MISMATCH', `Banner count mismatch at ${context}`);
  assertUniqueIds(out, context);
  return out;
}

const SITE_SETTINGS_ALLOWED_KEYS = new Set<string>([
  'storeName',
  'slogan',
  'description',
  'governorate',
  'facebookUrl',
  'instagramUrl',
  'tiktokUrl',
  'workingHours',
  'standardShippingFee',
  'freeShippingThreshold',
  'enableCOD',
  'enableBankTransfer',
  'enableKonnect',
  'enableFlouci',
  'announcementText',
  'showAnnouncement',
]);
const SITE_SETTINGS_POLICY_EXCLUDED_KEYS = new Set<string>([
  'officialEmail',
  'supportPhone',
  'whatsappPhone',
  'address',
  'addressMultilingual',
]);

export function sanitizeSiteSettings(
  rawSettings: unknown,
  context: string,
  limits: BackupLimits,
  auditCounts: Record<string, number>,
  options: { allowLegacyPartial?: boolean } = {}
): SanitizedSiteSettings {
  assert(isPlainObject(rawSettings), 'INVALID_RECORD', `Expected SiteSettings object at ${context}`);
  assertNoUnknownKeys(
    rawSettings,
    SITE_SETTINGS_ALLOWED_KEYS,
    SITE_SETTINGS_POLICY_EXCLUDED_KEYS,
    context,
    auditCounts,
    'siteSettings'
  );

  const allowPartial = Boolean(options.allowLegacyPartial);
  const requiredOnCanonical = [
    'storeName',
    'slogan',
    'description',
    'governorate',
    'facebookUrl',
    'instagramUrl',
    'tiktokUrl',
    'workingHours',
    'standardShippingFee',
    'freeShippingThreshold',
    'enableCOD',
    'enableKonnect',
    'enableFlouci',
    'announcementText',
    'showAnnouncement',
  ];

  const missingCanonicalKeys = requiredOnCanonical.filter((k) => rawSettings[k] === undefined);
  if (!allowPartial && missingCanonicalKeys.length > 0) {
    fail(
      'MISSING_REQUIRED_FIELD',
      `Missing canonical SiteSettings fields (${missingCanonicalKeys.join(', ')}) at ${context}`
    );
  }

  // Even for legacy partial SiteSettings, require storeName so completely broken objects fail
  assert(rawSettings.storeName !== undefined, 'MISSING_REQUIRED_FIELD', `Missing storeName at ${context}`);

  const clean: SanitizedSiteSettings = {
    schemaVariant: missingCanonicalKeys.length > 0 ? 'legacy-partial' : 'canonical-v2',
  };

  if (rawSettings.storeName !== undefined) {
    clean.storeName = requireCleanString(rawSettings.storeName, `${context}.storeName`, limits, false);
  }
  if (rawSettings.slogan !== undefined) {
    clean.slogan = sanitizeMultilingual(rawSettings.slogan, `${context}.slogan`, limits, true);
  }
  if (rawSettings.description !== undefined) {
    clean.description = sanitizeMultilingual(rawSettings.description, `${context}.description`, limits, true);
  }
  if (rawSettings.governorate !== undefined) {
    clean.governorate = requireCleanString(rawSettings.governorate, `${context}.governorate`, limits, false);
  }
  if (rawSettings.facebookUrl !== undefined) {
    clean.facebookUrl = validateUrlOrMedia(rawSettings.facebookUrl, `${context}.facebookUrl`, limits, {
      allowEmpty: true,
      allowRelativePath: false,
      allowDataImage: false,
    });
  }
  if (rawSettings.instagramUrl !== undefined) {
    clean.instagramUrl = validateUrlOrMedia(rawSettings.instagramUrl, `${context}.instagramUrl`, limits, {
      allowEmpty: true,
      allowRelativePath: false,
      allowDataImage: false,
    });
  }
  if (rawSettings.tiktokUrl !== undefined) {
    clean.tiktokUrl = validateUrlOrMedia(rawSettings.tiktokUrl, `${context}.tiktokUrl`, limits, {
      allowEmpty: true,
      allowRelativePath: false,
      allowDataImage: false,
    });
  }
  if (rawSettings.workingHours !== undefined) {
    clean.workingHours = sanitizeMultilingual(rawSettings.workingHours, `${context}.workingHours`, limits, true);
  }
  if (rawSettings.standardShippingFee !== undefined) {
    clean.standardShippingFee = requireFiniteNumber(rawSettings.standardShippingFee, `${context}.standardShippingFee`, 0);
  }
  if (rawSettings.freeShippingThreshold !== undefined) {
    clean.freeShippingThreshold = requireFiniteNumber(
      rawSettings.freeShippingThreshold,
      `${context}.freeShippingThreshold`,
      0
    );
  }
  if (rawSettings.enableCOD !== undefined) {
    clean.enableCOD = requireBoolean(rawSettings.enableCOD, `${context}.enableCOD`);
  }
  if (rawSettings.enableBankTransfer !== undefined) {
    clean.enableBankTransfer = requireBoolean(rawSettings.enableBankTransfer, `${context}.enableBankTransfer`);
  }
  if (rawSettings.enableKonnect !== undefined) {
    clean.enableKonnect = requireBoolean(rawSettings.enableKonnect, `${context}.enableKonnect`);
  }
  if (rawSettings.enableFlouci !== undefined) {
    clean.enableFlouci = requireBoolean(rawSettings.enableFlouci, `${context}.enableFlouci`);
  }
  if (rawSettings.announcementText !== undefined) {
    clean.announcementText = sanitizeMultilingual(rawSettings.announcementText, `${context}.announcementText`, limits, true);
  }
  if (rawSettings.showAnnouncement !== undefined) {
    clean.showAnnouncement = requireBoolean(rawSettings.showAnnouncement, `${context}.showAnnouncement`);
  }

  return clean;
}

const PAYMENT_CONFIG_TOP_ALLOWED = new Set<string>([
  'currency',
  'commissionRatePercent',
  'taxRatePercent',
  'standardShippingFee',
  'freeShippingThreshold',
  'methods',
  'updatedAt',
]);

const BANK_TRANSFER_ALLOWED = new Set<string>(['enabled']);
const BANK_TRANSFER_POLICY_EXCLUDED = new Set<string>([
  'accountHolder',
  'bankName',
  'ibanOrRib',
  'swiftCode',
  'instructions',
  'integrityVerified',
  'lockedByEnv',
  'tamperDetected',
  'ibanFingerprint',
]);

const ONLINE_PAYMENT_ALLOWED = new Set<string>(['enabled', 'provider', 'mode', 'readyForLive']);
const ONLINE_PAYMENT_POLICY_EXCLUDED = new Set<string>([
  'hasApiKey',
  'hasWalletId',
  'hasWebhookSecret',
  'apiKeyMasked',
  'walletIdMasked',
  'lastConnectionCheck',
  'webhookPath',
]);

export function sanitizePaymentPublicSummary(
  rawCfg: unknown,
  context: string,
  limits: BackupLimits,
  auditCounts: Record<string, number>
): SanitizedPaymentPublicSummary {
  assert(isPlainObject(rawCfg), 'INVALID_RECORD', `Expected PaymentSystemPublicConfig object at ${context}`);
  assertNoUnknownKeys(
    rawCfg,
    PAYMENT_CONFIG_TOP_ALLOWED,
    new Set<string>(),
    context,
    auditCounts,
    'paymentConfig'
  );

  assert(isPlainObject(rawCfg.methods), 'INVALID_RECORD', `Expected methods object at ${context}.methods`);
  const methodKeys = getOwnSafeKeys(rawCfg.methods, `${context}.methods`);
  for (const mk of methodKeys) {
    assert(
      mk === 'cod' || mk === 'bank_transfer' || mk === 'online_payment',
      'UNKNOWN_FIELD',
      `Unknown payment method key "${mk}" at ${context}.methods`
    );
  }

  assert(isPlainObject(rawCfg.methods.cod), 'INVALID_RECORD', `Expected cod object at ${context}.methods.cod`);
  assertNoUnknownKeys(
    rawCfg.methods.cod,
    new Set(['enabled']),
    new Set<string>(),
    `${context}.methods.cod`,
    auditCounts,
    'paymentConfig.cod'
  );

  assert(
    isPlainObject(rawCfg.methods.bank_transfer),
    'INVALID_RECORD',
    `Expected bank_transfer object at ${context}.methods.bank_transfer`
  );
  assertNoUnknownKeys(
    rawCfg.methods.bank_transfer,
    BANK_TRANSFER_ALLOWED,
    BANK_TRANSFER_POLICY_EXCLUDED,
    `${context}.methods.bank_transfer`,
    auditCounts,
    'paymentConfig.bank_transfer'
  );

  assert(
    isPlainObject(rawCfg.methods.online_payment),
    'INVALID_RECORD',
    `Expected online_payment object at ${context}.methods.online_payment`
  );
  assertNoUnknownKeys(
    rawCfg.methods.online_payment,
    ONLINE_PAYMENT_ALLOWED,
    ONLINE_PAYMENT_POLICY_EXCLUDED,
    `${context}.methods.online_payment`,
    auditCounts,
    'paymentConfig.online_payment'
  );

  const clean: SanitizedPaymentPublicSummary = {
    currency: requireCleanString(rawCfg.currency, `${context}.currency`, limits, false),
    commissionRatePercent: requireFiniteNumber(rawCfg.commissionRatePercent, `${context}.commissionRatePercent`, 0, 100),
    taxRatePercent: requireFiniteNumber(rawCfg.taxRatePercent, `${context}.taxRatePercent`, 0, 100),
    methods: {
      cod: {
        enabled: requireBoolean(rawCfg.methods.cod.enabled, `${context}.methods.cod.enabled`),
      },
      bank_transfer: {
        enabled: requireBoolean(rawCfg.methods.bank_transfer.enabled, `${context}.methods.bank_transfer.enabled`),
      },
      online_payment: {
        enabled: requireBoolean(rawCfg.methods.online_payment.enabled, `${context}.methods.online_payment.enabled`),
        provider: requireCleanString(rawCfg.methods.online_payment.provider, `${context}.methods.online_payment.provider`, limits, false),
        mode: requireCleanString(rawCfg.methods.online_payment.mode, `${context}.methods.online_payment.mode`, limits, false),
        readyForLive: requireBoolean(rawCfg.methods.online_payment.readyForLive, `${context}.methods.online_payment.readyForLive`),
      },
    },
    updatedAt: requireCleanString(rawCfg.updatedAt, `${context}.updatedAt`, limits, false),
  };

  if (rawCfg.standardShippingFee !== undefined) {
    clean.standardShippingFee = requireFiniteNumber(rawCfg.standardShippingFee, `${context}.standardShippingFee`, 0);
  }
  if (rawCfg.freeShippingThreshold !== undefined) {
    clean.freeShippingThreshold = requireFiniteNumber(rawCfg.freeShippingThreshold, `${context}.freeShippingThreshold`, 0);
  }

  return clean;
}

const CHAT_CONFIG_ALLOWED = new Set<string>([
  'autoReplyEnabled',
  'welcomeMessage',
  'fallbackMessage',
  'customRules',
  'updatedAt',
]);
const CHAT_RULE_ALLOWED = new Set<string>(['id', 'keyword', 'replyAr', 'replyFr', 'replyEn']);

export function sanitizeChatConfig(
  rawConfig: unknown,
  context: string,
  limits: BackupLimits,
  auditCounts: Record<string, number>
): SanitizedChatConfig {
  assert(isPlainObject(rawConfig), 'INVALID_RECORD', `Expected SupportChatConfig object at ${context}`);
  assertNoUnknownKeys(rawConfig, CHAT_CONFIG_ALLOWED, new Set<string>(), context, auditCounts, 'chatConfig');

  assert(Array.isArray(rawConfig.customRules), 'INVALID_ARRAY', `Expected customRules array at ${context}.customRules`);
  assert(rawConfig.customRules.length <= limits.maxChatRules, 'COUNT_LIMIT', `Chat rules exceed ${limits.maxChatRules}`);

  const customRules = rawConfig.customRules.map((rule, idx) => {
    const rCtx = `${context}.customRules[${idx}]`;
    assert(isPlainObject(rule), 'INVALID_RECORD', `Invalid rule object at ${rCtx}`);
    assertNoUnknownKeys(rule, CHAT_RULE_ALLOWED, new Set<string>(), rCtx, auditCounts, 'chatRule');
    return {
      id: requireCleanString(rule.id, `${rCtx}.id`, limits, false),
      keyword: requireCleanString(rule.keyword, `${rCtx}.keyword`, limits, false),
      replyAr: requireCleanString(rule.replyAr, `${rCtx}.replyAr`, limits, true),
      replyFr: requireCleanString(rule.replyFr, `${rCtx}.replyFr`, limits, true),
      replyEn: requireCleanString(rule.replyEn, `${rCtx}.replyEn`, limits, true),
    };
  });

  assertUniqueIds(customRules, `${context}.customRules`);

  return {
    autoReplyEnabled: requireBoolean(rawConfig.autoReplyEnabled, `${context}.autoReplyEnabled`),
    welcomeMessage: sanitizeMultilingual(rawConfig.welcomeMessage, `${context}.welcomeMessage`, limits, true),
    fallbackMessage: sanitizeMultilingual(rawConfig.fallbackMessage, `${context}.fallbackMessage`, limits, true),
    customRules,
    updatedAt: requireCleanString(rawConfig.updatedAt, `${context}.updatedAt`, limits, false),
  };
}

function buildServerReportedPersistence(
  healthRaw: Record<string, unknown>,
  sysStatusRaw: Record<string, unknown>,
  limits: BackupLimits
): ServerReportedPersistence {
  assert(healthRaw.status === 'ok' && healthRaw.service === 'echox-store-api', 'INVALID_RESPONSE', 'Invalid /api/health metadata');
  assert(isPlainObject(healthRaw.persistence), 'INVALID_RESPONSE', 'Missing persistence object in /api/health');
  assert(isPlainObject(sysStatusRaw.persistence), 'INVALID_RESPONSE', 'Missing persistence object in /api/security/systemStatus');

  const hp = healthRaw.persistence;
  const sp = sysStatusRaw.persistence;

  const indicators: Record<string, boolean> = {
    healthTopLevelDurable: healthRaw.durablePersistence === true,
    healthNestedDurable: hp.durable === true,
    sysStatusTopLevelDurable: sysStatusRaw.durablePersistence === true,
    sysStatusNestedDurable: sp.durable === true,
    healthValidProvider: typeof hp.provider === 'string' && VALID_DURABLE_PROVIDERS.has(hp.provider),
    sysStatusValidProvider: typeof sp.provider === 'string' && VALID_DURABLE_PROVIDERS.has(sp.provider),
    providersAgree: typeof hp.provider === 'string' && hp.provider === sp.provider,
    notInsecureStorageMode:
      typeof healthRaw.storageMode === 'string' &&
      typeof hp.storageMode === 'string' &&
      typeof sysStatusRaw.storageMode === 'string' &&
      typeof sp.storageMode === 'string' &&
      !INSECURE_STORAGE_MODES.has(healthRaw.storageMode) &&
      !INSECURE_STORAGE_MODES.has(hp.storageMode) &&
      !INSECURE_STORAGE_MODES.has(sysStatusRaw.storageMode) &&
      !INSECURE_STORAGE_MODES.has(sp.storageMode),
    renderBackedByCloudOrDisk:
      (hp.isRender !== true || hp.cloudEnabled === true || hp.provider === 'persistent-disk') &&
      (sp.isRender !== true || sp.cloudEnabled === true || sp.provider === 'persistent-disk'),
    noReportedCloudError:
      (hp.lastCloudError === null || hp.lastCloudError === undefined || hp.lastCloudError === '') &&
      (sp.lastCloudError === null || sp.lastCloudError === undefined || sp.lastCloudError === ''),
  };

  const unmetIndicators = Object.entries(indicators)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    reportedIndicatorsOnly: true,
    writeTestPerformed: false,
    note: 'Server-reported indicators read via GET /api/health & GET /api/security/systemStatus; no write-read persistence test was executed.',
    allServerReportedIndicatorsNominal: unmetIndicators.length === 0,
    indicators,
    unmetIndicators,
    healthPersistence: {
      provider: requireCleanString(hp.provider, 'health.persistence.provider', limits, false),
      storageMode: requireCleanString(hp.storageMode, 'health.persistence.storageMode', limits, false),
      cloudEnabled: requireBoolean(hp.cloudEnabled, 'health.persistence.cloudEnabled'),
      durable: requireBoolean(hp.durable, 'health.persistence.durable'),
      isRender: requireBoolean(hp.isRender, 'health.persistence.isRender'),
      ...(hp.firestoreProjectId !== undefined
        ? { firestoreProjectId: requireCleanString(hp.firestoreProjectId, 'health.persistence.firestoreProjectId', limits, true) }
        : {}),
      ...(hp.firestoreDatabaseId !== undefined
        ? { firestoreDatabaseId: requireCleanString(hp.firestoreDatabaseId, 'health.persistence.firestoreDatabaseId', limits, true) }
        : {}),
      lastCloudWriteAt:
        hp.lastCloudWriteAt === null
          ? null
          : requireCleanString(hp.lastCloudWriteAt, 'health.persistence.lastCloudWriteAt', limits, true),
    },
    securitySystem: {
      argon2idEnabled: requireBoolean(sysStatusRaw.argon2idEnabled, 'systemStatus.argon2idEnabled'),
      hashingAlgorithm: requireCleanString(sysStatusRaw.hashingAlgorithm, 'systemStatus.hashingAlgorithm', limits, false),
      serverSideEnforced: requireBoolean(sysStatusRaw.serverSideEnforced, 'systemStatus.serverSideEnforced'),
      accessCodeConfigured: requireBoolean(sysStatusRaw.accessCodeConfigured, 'systemStatus.accessCodeConfigured'),
      pinConfigured: requireBoolean(sysStatusRaw.pinConfigured, 'systemStatus.pinConfigured'),
      ...(sysStatusRaw.edgeMode !== undefined
        ? { edgeMode: requireBoolean(sysStatusRaw.edgeMode, 'systemStatus.edgeMode') }
        : {}),
      updatedAt: requireCleanString(sysStatusRaw.updatedAt, 'systemStatus.updatedAt', limits, false),
    },
    healthMeta: {
      status: requireCleanString(healthRaw.status, 'health.status', limits, false),
      service: requireCleanString(healthRaw.service, 'health.service', limits, false),
      securityEngine: requireCleanString(healthRaw.securityEngine, 'health.securityEngine', limits, false),
      ...(healthRaw.edgeMode !== undefined
        ? { edgeMode: requireBoolean(healthRaw.edgeMode, 'health.edgeMode') }
        : {}),
      timestamp: requireCleanString(healthRaw.timestamp, 'health.timestamp', limits, false),
    },
  };
}

// ---------- LocalStorage & HTTP Readers ----------

interface RawLocalSnapshot {
  [key: string]: {
    status: 'present' | 'missing';
    rawValue: string | null;
  };
}

function readAllowedLocalStorageRaw(storage: StorageLike): RawLocalSnapshot {
  const out: RawLocalSnapshot = {};
  for (const key of ALLOWED_LOCAL_STORAGE_KEYS) {
    const val = storage.getItem(key);
    out[key] = {
      status: val === null ? 'missing' : 'present',
      rawValue: val,
    };
  }
  return out;
}

function parseAndSanitizeLocalStorage(
  rawSnapshot: RawLocalSnapshot,
  limits: BackupLimits,
  auditCounts: Record<string, number>
): SafeBackupEnvelope['browserCache'] {
  const keysStatus = {} as Record<AllowedLocalStorageKey, 'present' | 'missing'>;
  const data: SafeBackupEnvelope['browserCache']['data'] = {};

  for (const key of ALLOWED_LOCAL_STORAGE_KEYS) {
    const entry = rawSnapshot[key];
    keysStatus[key] = entry.status;
    if (entry.status === 'missing') continue;

    const raw = entry.rawValue;
    assert(typeof raw === 'string' && raw.length > 0, 'CORRUPT_LOCAL_STORAGE', `Empty localStorage value for "${key}"`);

    if (key === 'echox_language') {
      assert(raw === 'ar' || raw === 'fr' || raw === 'en', 'CORRUPT_LOCAL_STORAGE', `Invalid echox_language: "${raw}"`);
      data.echox_language = raw;
      continue;
    }

    if (key === 'echox_theme') {
      assert(raw === 'dark' || raw === 'light', 'CORRUPT_LOCAL_STORAGE', `Invalid echox_theme: "${raw}"`);
      data.echox_theme = raw;
      continue;
    }

    assert(raw.length <= limits.maxTotalPayloadBytes, 'SIZE_LIMIT', `localStorage key "${key}" exceeds max payload size`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail('CORRUPT_JSON', `Invalid JSON in localStorage key "${key}"`);
    }

    if (key === 'echox_products') {
      data.echox_products = sanitizeProducts(parsed, 'localStorage.echox_products', limits, auditCounts, {
        allowLegacyMaster: true,
      });
    } else if (key === 'echox_companies') {
      data.echox_companies = sanitizeCompanies(parsed, 'localStorage.echox_companies', limits, auditCounts);
    } else if (key === 'echox_categories') {
      data.echox_categories = sanitizeCategories(parsed, 'localStorage.echox_categories', limits, auditCounts);
    } else if (key === 'echox_banners') {
      data.echox_banners = sanitizeBanners(parsed, 'localStorage.echox_banners', limits, auditCounts);
    } else if (key === 'echox_site_settings') {
      data.echox_site_settings = sanitizeSiteSettings(parsed, 'localStorage.echox_site_settings', limits, auditCounts, {
        allowLegacyPartial: true,
      });
    }
  }

  return {
    allowedKeysOnly: ALLOWED_LOCAL_STORAGE_KEYS,
    keysStatus,
    data,
  };
}

async function safeFetchPublicJson(path: string, fetchFn: FetchLike): Promise<Record<string, unknown>> {
  assert(typeof path === 'string' && path.startsWith('/api/'), 'DISALLOWED_PATH', `Disallowed endpoint "${path}"`);
  for (const blocked of BLOCKED_PATH_PREFIXES) {
    assert(!path.startsWith(blocked), 'BLOCKED_SENSITIVE_PATH', `Refused access to restricted endpoint "${path}"`);
  }

  const res = await fetchFn(path, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });

  assert(res.status === 200, 'HTTP_ERROR', `Expected HTTP 200 from ${path}, received ${res.status}`);
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  assert(contentType.includes('application/json'), 'NON_JSON_RESPONSE', `Non-JSON content-type from ${path}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    fail('INVALID_JSON_BODY', `Failed parsing JSON response from ${path}`);
  }

  assert(isPlainObject(body), 'INVALID_RESPONSE', `Expected plain JSON object from ${path}`);
  assert(body.success !== false, 'API_FAILURE_FLAG', `API returned success: false from ${path}`);
  return body;
}

const STORE_STATE_RESPONSE_KEYS = new Set<string>([
  'success',
  'products',
  'companies',
  'categories',
  'banners',
  'siteSettings',
  'updatedAt',
]);

function extractSanitizedServerStoreState(
  raw: Record<string, unknown>,
  context: string,
  limits: BackupLimits,
  auditCounts: Record<string, number>
) {
  assert(raw.success === true, 'INVALID_SUCCESS_FLAG', `GET ${ALLOWED_PUBLIC_ENDPOINTS.storeState} must return success === true`);
  assert(
    raw.ownerSettings === undefined && raw.inquiries === undefined,
    'SENSITIVE_SERVER_LEAK',
    `Unexpected admin/PII fields returned by ${ALLOWED_PUBLIC_ENDPOINTS.storeState}`
  );
  assertNoUnknownKeys(raw, STORE_STATE_RESPONSE_KEYS, new Set<string>(), context, auditCounts, 'storeResponse');

  return {
    products: sanitizeProducts(raw.products, `${context}.products`, limits, auditCounts, {
      allowLegacyMaster: false,
    }) as SanitizedProduct[],
    companies: sanitizeCompanies(raw.companies, `${context}.companies`, limits, auditCounts),
    categories: sanitizeCategories(raw.categories, `${context}.categories`, limits, auditCounts),
    banners: sanitizeBanners(raw.banners, `${context}.banners`, limits, auditCounts),
    siteSettings: sanitizeSiteSettings(raw.siteSettings, `${context}.siteSettings`, limits, auditCounts, {
      allowLegacyPartial: false,
    }),
    updatedAt: requireCleanString(raw.updatedAt, `${context}.updatedAt`, limits, false),
  };
}

// ---------- Main Safe Backup Pipeline ----------

export async function createSafeBackup(options: SafeBackupOptions = {}): Promise<SafeBackupResult> {
  const mode: BackupMode = options.mode || 'local-only';
  const limits: BackupLimits = { ...DEFAULT_BACKUP_LIMITS, ...(options.limits || {}) };
  const includeDiagnostics = options.includeDiagnostics !== false;
  const includePaymentPublicSummary = Boolean(options.includePaymentPublicSummary);
  const includeChatConfig = Boolean(options.includeChatConfig);
  const origin =
    options.origin ||
    (typeof window !== 'undefined' && window.location ? window.location.origin : 'local-offline');

  const storage: StorageLike =
    options.storage ||
    (typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : fail('NO_STORAGE', 'No localStorage implementation available'));

  const strippedByPolicyCounts: Record<string, number> = {};

  // 1. Snapshot T0 LocalStorage raw strings BEFORE any other operations
  const localRawBefore = readAllowedLocalStorageRaw(storage);
  const localRawBeforeHash = await sha256Hex(canonicalStringify(localRawBefore));
  const browserCache = parseAndSanitizeLocalStorage(localRawBefore, limits, strippedByPolicyCounts);
  const browserCacheHash = await sha256Hex(canonicalStringify(browserCache));

  let serverData: SafeBackupEnvelope['server'] = null;
  let serverReportedPersistence: ServerReportedPersistence | null = null;
  let serverStoreHash: string | null = null;
  let serverPaymentHash: string | null = null;
  let serverChatHash: string | null = null;
  let verifiedServerReRead = false;

  // 2. Optional Storefront Read-Only Mode (explicit opt-in)
  if (mode === 'storefront-readonly') {
    const fetchFn: FetchLike =
      options.fetchFn ||
      (typeof window !== 'undefined' && typeof window.fetch === 'function'
        ? (window.fetch.bind(window) as unknown as FetchLike)
        : fail('NO_FETCH', 'No fetch implementation available for storefront-readonly mode'));

    const storeRes1 = await safeFetchPublicJson(ALLOWED_PUBLIC_ENDPOINTS.storeState, fetchFn);
    const storeState1 = extractSanitizedServerStoreState(storeRes1, 'server.storeState', limits, strippedByPolicyCounts);
    serverStoreHash = await sha256Hex(canonicalStringify(storeState1));

    let paymentPublicSummary: SanitizedPaymentPublicSummary | null = null;
    if (includePaymentPublicSummary) {
      const payRes1 = await safeFetchPublicJson(ALLOWED_PUBLIC_ENDPOINTS.paymentPublicConfig, fetchFn);
      paymentPublicSummary = sanitizePaymentPublicSummary(
        payRes1,
        'server.paymentPublicSummary',
        limits,
        strippedByPolicyCounts
      );
      serverPaymentHash = await sha256Hex(canonicalStringify(paymentPublicSummary));
    }

    let chatConfig: SanitizedChatConfig | null = null;
    if (includeChatConfig) {
      const chatRes1 = await safeFetchPublicJson(ALLOWED_PUBLIC_ENDPOINTS.chatConfig, fetchFn);
      assert(chatRes1.success === true, 'INVALID_SUCCESS_FLAG', `GET ${ALLOWED_PUBLIC_ENDPOINTS.chatConfig} must return success === true`);
      chatConfig = sanitizeChatConfig(chatRes1.config, 'server.chatConfig', limits, strippedByPolicyCounts);
      serverChatHash = await sha256Hex(canonicalStringify(chatConfig));
    }

    if (includeDiagnostics) {
      const [healthRes, sysStatusRes] = await Promise.all([
        safeFetchPublicJson(ALLOWED_PUBLIC_ENDPOINTS.health, fetchFn),
        safeFetchPublicJson(ALLOWED_PUBLIC_ENDPOINTS.securitySystemStatus, fetchFn),
      ]);
      serverReportedPersistence = buildServerReportedPersistence(healthRes, sysStatusRes, limits);
    }

    // Re-read mutable server endpoints to detect mid-backup drift
    const storeRes2 = await safeFetchPublicJson(ALLOWED_PUBLIC_ENDPOINTS.storeState, fetchFn);
    const storeState2 = extractSanitizedServerStoreState(storeRes2, 'reRead.storeState', limits, { ...strippedByPolicyCounts });
    assert(storeState1.products.length === storeState2.products.length, 'COUNT_DRIFT', 'Product count changed during backup');
    assert(storeState1.companies.length === storeState2.companies.length, 'COUNT_DRIFT', 'Company count changed during backup');
    assert(storeState1.categories.length === storeState2.categories.length, 'COUNT_DRIFT', 'Category count changed during backup');
    assert(storeState1.banners.length === storeState2.banners.length, 'COUNT_DRIFT', 'Banner count changed during backup');

    const storeHash2 = await sha256Hex(canonicalStringify(storeState2));
    assert(serverStoreHash === storeHash2, 'SERVER_DATA_DRIFT', 'Store state changed between initial GET and verification GET');

    if (includePaymentPublicSummary && serverPaymentHash !== null) {
      const payRes2 = await safeFetchPublicJson(ALLOWED_PUBLIC_ENDPOINTS.paymentPublicConfig, fetchFn);
      const pay2 = sanitizePaymentPublicSummary(payRes2, 'reRead.paymentPublicSummary', limits, { ...strippedByPolicyCounts });
      const payHash2 = await sha256Hex(canonicalStringify(pay2));
      assert(serverPaymentHash === payHash2, 'SERVER_DATA_DRIFT', 'Payment public config changed during backup');
    }

    if (includeChatConfig && serverChatHash !== null) {
      const chatRes2 = await safeFetchPublicJson(ALLOWED_PUBLIC_ENDPOINTS.chatConfig, fetchFn);
      assert(chatRes2.success === true, 'INVALID_SUCCESS_FLAG', `Re-read GET ${ALLOWED_PUBLIC_ENDPOINTS.chatConfig} must return success === true`);
      const chat2 = sanitizeChatConfig(chatRes2.config, 'reRead.chatConfig', limits, { ...strippedByPolicyCounts });
      const chatHash2 = await sha256Hex(canonicalStringify(chat2));
      assert(serverChatHash === chatHash2, 'SERVER_DATA_DRIFT', 'Chat config changed during backup');
    }

    verifiedServerReRead = true;
    serverData = {
      storeState: storeState1,
      paymentPublicSummary,
      chatConfig,
    };
  }

  // 3. Re-read LocalStorage to verify zero mutation during backup execution
  const localRawAfter = readAllowedLocalStorageRaw(storage);
  const localRawAfterHash = await sha256Hex(canonicalStringify(localRawAfter));
  assert(
    localRawBeforeHash === localRawAfterHash,
    'LOCAL_STORAGE_DRIFT',
    'Allowed localStorage keys changed during backup execution'
  );

  // 4. Build core payload and scan entire tree
  const corePayload = {
    meta: {
      backupFormat: 'ECHOX_SAFE_BACKUP' as const,
      version: SAFE_BACKUP_VERSION,
      mode,
      exportedAt: new Date().toISOString(),
      origin,
      readOnly: true as const,
      strippedByPolicyCounts,
      counts: {
        serverProducts: serverData?.storeState?.products.length ?? 0,
        serverCompanies: serverData?.storeState?.companies.length ?? 0,
        serverCategories: serverData?.storeState?.categories.length ?? 0,
        serverBanners: serverData?.storeState?.banners.length ?? 0,
        localProducts: browserCache.data.echox_products?.length ?? 0,
        localCompanies: browserCache.data.echox_companies?.length ?? 0,
        localCategories: browserCache.data.echox_categories?.length ?? 0,
        localBanners: browserCache.data.echox_banners?.length ?? 0,
        chatRules: serverData?.chatConfig?.customRules.length ?? 0,
      },
      excludedByPolicy: [
        '/api/admin/* (/api/admin/payments/overview, /api/admin/store/state, /api/admin/notifications, /api/admin/orders)',
        '/api/owner/*, /api/orders/*, /api/payments/track/*, /api/notifications/*',
        'SiteSettings PII (officialEmail, supportPhone, whatsappPhone, address, addressMultilingual)',
        'Company PII (phone, email, address)',
        'Product individual reviews (authorName, comment, date, verifiedPurchase)',
        'Sensitive payment & bank fields (ibanOrRib, ibanFingerprint, accountHolder, bankName, swiftCode, secrets, masked keys)',
        'sessionStorage, document.cookie, auth tokens, and all non-allowlisted localStorage keys',
      ],
    },
    serverReportedPersistence,
    server: serverData,
    browserCache,
  };

  scanTreeForForbiddenData(corePayload, 'corePayload');

  const payloadSha256 = await sha256Hex(canonicalStringify(corePayload));
  const preliminaryJson = JSON.stringify({
    ...corePayload,
    integrity: {
      algorithm: 'SHA-256' as const,
      canonicalization: 'sorted-keys-json' as const,
      verifiedServerReRead,
      verifiedLocalStorageImmutability: true,
      payloadBytes: 0,
      sectionHashes: {
        serverStoreState: serverStoreHash,
        serverPaymentPublicSummary: serverPaymentHash,
        serverChatConfig: serverChatHash,
        browserCache: browserCacheHash,
      },
      payloadSha256,
    },
  });

  const payloadBytes = new TextEncoder().encode(preliminaryJson).length;
  assert(
    payloadBytes <= limits.maxTotalPayloadBytes,
    'PAYLOAD_SIZE_LIMIT',
    `Backup payload (${payloadBytes} bytes) exceeds limit (${limits.maxTotalPayloadBytes} bytes)`
  );

  const envelope: SafeBackupEnvelope = {
    ...corePayload,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: 'sorted-keys-json',
      verifiedServerReRead,
      verifiedLocalStorageImmutability: true,
      payloadBytes,
      sectionHashes: {
        serverStoreState: serverStoreHash,
        serverPaymentPublicSummary: serverPaymentHash,
        serverChatConfig: serverChatHash,
        browserCache: browserCacheHash,
      },
      payloadSha256,
    },
  };

  // 5. Final JSON round-trip validation & SHA-256 self-check
  const jsonText = JSON.stringify(envelope, null, 2);
  let reparsed: unknown;
  try {
    reparsed = JSON.parse(jsonText);
  } catch {
    fail('JSON_ROUNDTRIP_FAILED', 'Serialized backup JSON failed round-trip parse');
  }

  assert(isPlainObject(reparsed), 'JSON_ROUNDTRIP_FAILED', 'Reparsed root is not a plain object');
  scanTreeForForbiddenData(reparsed, 'reparsedEnvelope');

  const reparsedIntegrity = reparsed.integrity;
  assert(isPlainObject(reparsedIntegrity), 'INTEGRITY_MISSING', 'Missing integrity block after round-trip');
  const { integrity: _omitted, ...reparsedCore } = reparsed;
  const recomputedHash = await sha256Hex(canonicalStringify(reparsedCore));
  assert(
    recomputedHash === reparsedIntegrity.payloadSha256,
    'SHA256_VERIFICATION_FAILED',
    'Recomputed SHA-256 does not match integrity.payloadSha256'
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `echox-safe-backup-v5.3-${stamp}.json`;

  return { envelope, jsonText, fileName };
}

export async function runSafeBackupAndDownload(
  options: SafeBackupOptions & {
    downloadFn?: (fileName: string, jsonText: string) => void;
  } = {}
): Promise<SafeBackupResult> {
  const result = await createSafeBackup(options);

  if (options.downloadFn) {
    options.downloadFn(result.fileName, result.jsonText);
    return result;
  }

  assert(
    typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined',
    'NO_BROWSER_BLOB',
    'Browser DOM/Blob APIs are required for local file download'
  );

  const blob = new Blob([result.jsonText], { type: 'application/json;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = result.fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

  return result;
}
