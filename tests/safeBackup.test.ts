/**
 * Local Offline Test Suite for ECHOX SAFE BACKUP v5.3
 * Uses strictly synthetic/mock data in RAM — zero production files, zero real network calls.
 */

import {
  ALLOWED_LOCAL_STORAGE_KEYS,
  canonicalStringify,
  createSafeBackup,
  runSafeBackupAndDownload,
  SafeBackupError,
  sha256Hex,
  type FetchLike,
  type StorageLike,
} from '../src/lib/safeBackup';

// Real minimal raster image headers encoded in Base64 (1x1 valid binary prefixes)
const VALID_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const VALID_WEBP_BASE64 =
  'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
const FAKE_PNG_TEXT_BASE64 = 'data:image/png;base64,SGVsbG8td29ybGQ='; // "Hello-world"
const SVG_DATA_URI = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=';

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message} (expected=${String(expected)}, actual=${String(actual)})`);
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function expectBackupError(
  fn: () => Promise<unknown>,
  expectedCode: string,
  label: string
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof SafeBackupError) {
      if (err.code !== expectedCode) {
        throw new Error(
          `[${label}] Expected SafeBackupError code "${expectedCode}", got "${err.code}": ${err.message}`
        );
      }
      return;
    }
    throw err;
  }
  throw new Error(`[${label}] Expected failure with code "${expectedCode}", but succeeded.`);
}

function createMockStorage(initial: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial));
  const readLog: string[] = [];
  const allowedSet = new Set<string>(ALLOWED_LOCAL_STORAGE_KEYS);

  const storage: StorageLike = {
    getItem(key: string): string | null {
      readLog.push(key);
      if (!allowedSet.has(key)) {
        throw new Error(`SECURITY VIOLATION: Attempted to read non-allowlisted localStorage key "${key}"`);
      }
      return store.has(key) ? store.get(key)! : null;
    },
  };

  return { storage, store, readLog };
}

function makeDummyCanonicalProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod_test_1',
    name: { ar: 'مثقاب اختبار', fr: 'Perceuse Test', en: 'Test Drill' },
    description: { ar: 'وصف تقني نظيف 20V بدون أي بيانات شخصية', fr: 'Description technique propre', en: 'Clean hardware description' },
    category: 'power_tools',
    price: 250,
    originalPrice: 300,
    stock: 10,
    companyId: 'comp_test_1',
    companyName: 'Test Hardware Co',
    governorate: 'tunis',
    images: ['/assets/images/product_drill_cordless_pro.webp', VALID_PNG_BASE64],
    featured: true,
    active: true,
    deliveryTimeDays: 2,
    rating: 4.8,
    reviewCount: 12,
    reviews: [
      {
        id: 'rev_dummy_1',
        authorName: 'Dummy Reviewer',
        rating: 5,
        comment: 'Great synthetic item',
        date: '2026-11-01',
        verifiedPurchase: true,
      },
    ],
    specs: [
      {
        key: { ar: 'الجهد', fr: 'Tension', en: 'Voltage' },
        value: { ar: '20 فولت', fr: '20V', en: '20V' },
      },
    ],
    ...overrides,
  };
}

function makeDummyCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: 'comp_test_1',
    name: 'Test Hardware Co',
    logo: VALID_WEBP_BASE64,
    phone: '+216 00 000 000',
    email: 'dummy-vendor@example.invalid',
    address: 'Rue Test 123, Tunis',
    governorate: 'tunis',
    description: { ar: 'شركة تجريبية', fr: 'Société test', en: 'Synthetic test company' },
    website: 'https://example.invalid',
    ...overrides,
  };
}

function makeDummyCategory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'power_tools',
    label: 'أدوات اختبار',
    icon: '🔧',
    desc: 'تصنيف تجريبي',
    ...overrides,
  };
}

function makeDummyBanner(overrides: Record<string, unknown> = {}) {
  return {
    id: 'banner_test_1',
    tag: 'اختبار',
    title: 'عرض تجريبي',
    subtitle: 'بيانات وهمية محلية',
    active: true,
    link: '/store?category=power_tools',
    bgGradient: 'from-orange-500 to-amber-500',
    ...overrides,
  };
}

function makeDummySiteSettings(overrides: Record<string, unknown> = {}) {
  return {
    storeName: 'ECHOX Test Store',
    slogan: { ar: 'شعار تجريبي', fr: 'Slogan test', en: 'Test slogan' },
    description: { ar: 'متجر تجريبي', fr: 'Boutique test', en: 'Test store description' },
    officialEmail: 'public-store@example.invalid',
    address: 'Secret Test Street 99',
    addressMultilingual: { ar: 'شارع اختبار', fr: 'Rue test', en: 'Test street' },
    governorate: 'ariana',
    supportPhone: '+216 11 111 111',
    whatsappPhone: '21611111111',
    facebookUrl: 'https://facebook.com/example',
    instagramUrl: '',
    tiktokUrl: 'https://tiktok.com/@example',
    workingHours: { ar: '09:00 - 17:00', fr: '09:00 - 17:00', en: '09:00 - 17:00' },
    standardShippingFee: 7,
    freeShippingThreshold: 150,
    enableCOD: true,
    enableKonnect: false,
    enableFlouci: false,
    announcementText: { ar: 'إعلان تجريبي', fr: 'Annonce test', en: 'Test announcement' },
    showAnnouncement: true,
    ...overrides,
  };
}

function makeMockFetch(
  routes: Record<string, () => { status?: number; contentType?: string; body: unknown }>,
  counter: { calls: string[] }
): FetchLike {
  return async (input: string, init?: RequestInit) => {
    counter.calls.push(`${init?.method || 'GET'} ${input}`);
    assertEq(init?.method || 'GET', 'GET', `Only GET allowed, got ${init?.method}`);
    assertEq(init?.credentials, 'omit', 'Credentials must be omitted');
    const handler = routes[input];
    if (!handler) {
      return {
        status: 404,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'Not mocked' }),
      };
    }
    const res = handler();
    return {
      status: res.status ?? 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? res.contentType ?? 'application/json' : null) },
      json: async () => res.body,
    };
  };
}

async function runAllTests(): Promise<void> {
  // Global tripwire: guarantee zero accidental globalThis.fetch network calls
  const originalFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = () => {
    throw new Error('NETWORK VIOLATION: globalThis.fetch must NEVER be called during offline local tests!');
  };

  const results: Array<{ name: string; status: 'PASS' }> = [];
  const runTest = async (name: string, fn: () => Promise<void>) => {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log(`PASS: ${name}`);
  };

  try {
    // 1. Valid local-only backup + 7 keys + zero mutation + Blob download callback + SHA-256 check
    await runTest('1. Valid local-only backup (all 7 keys, PII stripping, SHA-256 & Blob)', async () => {
      const initialMap: Record<string, string> = {
        echox_products: JSON.stringify([makeDummyCanonicalProduct()]),
        echox_companies: JSON.stringify([makeDummyCompany()]),
        echox_categories: JSON.stringify([makeDummyCategory()]),
        echox_banners: JSON.stringify([makeDummyBanner()]),
        echox_site_settings: JSON.stringify(makeDummySiteSettings()),
        echox_language: 'ar',
        echox_theme: 'dark',
        // Non-allowlisted keys present in browser must NEVER be accessed
        echox_orders: JSON.stringify([{ id: 'ord_secret', customerPhone: '+216 99 999 999' }]),
        echox_owner_settings: JSON.stringify({ loginEmail: 'secret@example.invalid' }),
      };

      const snapshotBefore = { ...initialMap };
      const { storage, store, readLog } = createMockStorage(initialMap);

      let downloadedFile = '';
      let downloadedContent = '';
      const result = await runSafeBackupAndDownload({
        mode: 'local-only',
        storage,
        origin: 'http://localhost.test',
        downloadFn: (fileName, jsonText) => {
          downloadedFile = fileName;
          downloadedContent = jsonText;
        },
      });

      assertTrue(downloadedFile.startsWith('echox-safe-backup-v5.3-'), 'Backup filename prefix');
      assertTrue(downloadedContent === result.jsonText, 'Downloaded content matches result');
      assertEq(result.envelope.server, null, 'No server payload in local-only mode');
      assertEq(result.envelope.browserCache.data.echox_language, 'ar', 'Language preserved');
      assertEq(result.envelope.browserCache.data.echox_theme, 'dark', 'Theme preserved');

      // Verify SiteSettings PII & Company PII & Product reviews were stripped
      const exportedProduct = result.envelope.browserCache.data.echox_products![0] as unknown as Record<string, unknown>;
      assertEq(exportedProduct.reviews, undefined, 'Individual product reviews stripped');
      assertEq(exportedProduct.rating, 4.8, 'Aggregate rating preserved');
      assertEq(exportedProduct.reviewCount, 12, 'Aggregate reviewCount preserved');

      const exportedCompany = result.envelope.browserCache.data.echox_companies![0] as unknown as Record<string, unknown>;
      assertEq(exportedCompany.phone, undefined, 'Company phone stripped');
      assertEq(exportedCompany.email, undefined, 'Company email stripped');
      assertEq(exportedCompany.address, undefined, 'Company address stripped');

      const exportedSettings = result.envelope.browserCache.data.echox_site_settings as unknown as Record<string, unknown>;
      assertEq(exportedSettings.officialEmail, undefined, 'officialEmail stripped');
      assertEq(exportedSettings.supportPhone, undefined, 'supportPhone stripped');
      assertEq(exportedSettings.whatsappPhone, undefined, 'whatsappPhone stripped');
      assertEq(exportedSettings.address, undefined, 'address stripped');
      assertEq(exportedSettings.addressMultilingual, undefined, 'addressMultilingual stripped');

      // Verify ONLY the 7 allowed keys were ever queried
      const uniqueReadKeys = new Set(readLog);
      assertEq(uniqueReadKeys.size, 7, 'Exactly 7 allowed keys read');
      for (const k of uniqueReadKeys) {
        assertTrue((ALLOWED_LOCAL_STORAGE_KEYS as readonly string[]).includes(k), `Allowed key ${k}`);
      }

      // Verify original storage untouched
      for (const [k, v] of Object.entries(snapshotBefore)) {
        assertEq(store.get(k), v, `Original key ${k} unmodified`);
      }

      // Independent SHA-256 verification
      const parsed = JSON.parse(downloadedContent);
      const { integrity, ...core } = parsed;
      const recomputed = await sha256Hex(canonicalStringify(core));
      assertEq(recomputed, integrity.payloadSha256, 'Independent SHA-256 verification');
    });

    // 2. Valid storefront-readonly mode with mocked fetch & multi-indicator persistence reporting
    await runTest('2. Storefront read-only mode (mock fetch, no real network, honest persistence)', async () => {
      const { storage } = createMockStorage({}); // All 7 localStorage keys missing
      const fetchCalls = { calls: [] as string[] };
      const fetchFn = makeMockFetch(
        {
          '/api/store/state': () => ({
            body: {
              success: true,
              products: [makeDummyCanonicalProduct()],
              companies: [makeDummyCompany()],
              categories: [makeDummyCategory()],
              banners: [makeDummyBanner()],
              siteSettings: makeDummySiteSettings(),
              updatedAt: '2026-11-17T00:00:00.000Z',
            },
          }),
          '/api/payments/config': () => ({
            body: {
              currency: 'TND',
              commissionRatePercent: 10,
              taxRatePercent: 0,
              standardShippingFee: 7,
              freeShippingThreshold: 150,
              methods: {
                cod: { enabled: true },
                bank_transfer: {
                  enabled: true,
                  accountHolder: 'REDACTED HOLDER',
                  bankName: 'BIAT',
                  ibanOrRib: 'TN5908000000123456789012',
                  swiftCode: 'BIATTNTT',
                  ibanFingerprint: 'ABCD-1234',
                  instructions: { ar: 'ت', fr: 't', en: 't' },
                },
                online_payment: {
                  enabled: false,
                  provider: 'konnect',
                  mode: 'sandbox',
                  hasApiKey: false,
                  hasWalletId: false,
                  hasWebhookSecret: false,
                  apiKeyMasked: '••••1234',
                  walletIdMasked: '••••5678',
                  readyForLive: false,
                  webhookPath: '/api/payments/webhook/konnect',
                },
              },
              updatedAt: '2026-11-17T00:00:00.000Z',
            },
          }),
          '/api/chat/config': () => ({
            body: {
              success: true,
              config: {
                autoReplyEnabled: true,
                welcomeMessage: { ar: 'مرحبا', fr: 'Bonjour', en: 'Welcome' },
                fallbackMessage: { ar: 'تم استلام رسالتك', fr: 'Message reçu', en: 'Message received' },
                customRules: [],
                updatedAt: '2026-11-17T00:00:00.000Z',
              },
            },
          }),
          '/api/health': () => ({
            body: {
              status: 'ok',
              service: 'echox-store-api',
              uptimeSeconds: 10,
              storageMode: 'ephemeral-render-disk',
              durablePersistence: false,
              persistence: {
                provider: 'ephemeral-render-disk',
                storageMode: 'ephemeral-render-disk',
                cloudEnabled: false,
                durable: false,
                isRender: true,
                lastCloudWriteAt: null,
                lastCloudError: null,
              },
              securityEngine: 'Argon2id + HMAC-SHA256',
              timestamp: '2026-11-17T00:00:00.000Z',
            },
          }),
          '/api/security/systemStatus': () => ({
            body: {
              argon2idEnabled: true,
              hashingAlgorithm: 'Argon2id (m=65536, t=3, p=4)',
              serverSideEnforced: true,
              storageMode: 'ephemeral-render-disk',
              durablePersistence: false,
              persistence: {
                provider: 'ephemeral-render-disk',
                storageMode: 'ephemeral-render-disk',
                cloudEnabled: false,
                durable: false,
                isRender: true,
                lastCloudWriteAt: null,
                lastCloudError: null,
              },
              activeSessionsCount: 2,
              accessCodeConfigured: true,
              pinConfigured: true,
              updatedAt: '2026-11-17T00:00:00.000Z',
            },
          }),
        },
        fetchCalls
      );

      const res = await createSafeBackup({
        mode: 'storefront-readonly',
        includePaymentPublicSummary: true,
        includeChatConfig: true,
        includeDiagnostics: true,
        storage,
        fetchFn,
      });

      assertEq(res.envelope.browserCache.keysStatus.echox_products, 'missing', 'Missing local key status');
      assertEq(res.envelope.integrity.verifiedServerReRead, true, 'Server re-read verified');
      assertEq(res.envelope.serverReportedPersistence?.reportedIndicatorsOnly, true, 'Honest server-reported flag');
      assertEq(res.envelope.serverReportedPersistence?.writeTestPerformed, false, 'Write test not performed');
      assertEq(
        res.envelope.serverReportedPersistence?.allServerReportedIndicatorsNominal,
        false,
        'Ephemeral disk correctly flagged as non-nominal'
      );

      const paySummary = res.envelope.server!.paymentPublicSummary as unknown as Record<string, any>;
      assertEq(paySummary.methods.bank_transfer.ibanOrRib, undefined, 'IBAN excluded from payment summary');
      assertEq(paySummary.methods.bank_transfer.accountHolder, undefined, 'Account holder excluded');
      assertEq(paySummary.methods.online_payment.apiKeyMasked, undefined, 'Masked API key excluded');
      assertTrue(!fetchCalls.calls.some((c) => c.includes('/api/admin/')), 'Never called admin routes');
    });

    // 3. Missing/corrupt data & no fabricated defaults
    await runTest('3. Missing/corrupt data fails closed without inventing defaults', async () => {
      const { storage: badJson } = createMockStorage({ echox_products: '{broken-json' });
      await expectBackupError(() => createSafeBackup({ storage: badJson }), 'CORRUPT_JSON', 'Corrupt JSON');

      const { storage: badLang } = createMockStorage({ echox_language: 'de' });
      await expectBackupError(() => createSafeBackup({ storage: badLang }), 'CORRUPT_LOCAL_STORAGE', 'Invalid lang');

      const incompleteProd = makeDummyCanonicalProduct();
      delete (incompleteProd as Record<string, unknown>).price;
      const { storage: missingPrice } = createMockStorage({ echox_products: JSON.stringify([incompleteProd]) });
      await expectBackupError(() => createSafeBackup({ storage: missingPrice }), 'INVALID_NUMBER', 'Missing price');

      // Optional fields omitted must remain undefined (never defaulted)
      const minimalProd = makeDummyCanonicalProduct();
      delete (minimalProd as Record<string, unknown>).rating;
      delete (minimalProd as Record<string, unknown>).reviewCount;
      delete (minimalProd as Record<string, unknown>).originalPrice;
      const { storage: okMin } = createMockStorage({ echox_products: JSON.stringify([minimalProd]) });
      const res = await createSafeBackup({ storage: okMin });
      const exported = res.envelope.browserCache.data.echox_products![0] as unknown as Record<string, unknown>;
      assertEq('rating' in exported, false, 'Optional rating not fabricated');
      assertEq('reviewCount' in exported, false, 'Optional reviewCount not fabricated');
    });

    // 4. Unknown fields rejected (zero silent dropping) + prototype pollution guard
    await runTest('4. Unknown fields & prototype pollution rejected', async () => {
      const prodWithUnknown = makeDummyCanonicalProduct({ surpriseField: 'hidden' });
      const { storage: unkStorage } = createMockStorage({ echox_products: JSON.stringify([prodWithUnknown]) });
      await expectBackupError(() => createSafeBackup({ storage: unkStorage }), 'UNKNOWN_FIELD', 'Unknown product field');

      const { storage: protoStorage } = createMockStorage({
        echox_categories: '[{"id":"c1","label":"Test","constructor":"evil"}]',
      });
      await expectBackupError(
        () => createSafeBackup({ storage: protoStorage }),
        'PROTOTYPE_POLLUTION_KEY',
        'Prototype pollution key'
      );
    });

    // 5. Sensitive PII / secrets in free text rejected
    await runTest('5. Sensitive PII & secrets inside free text rejected', async () => {
      const emailInDesc = makeDummyCanonicalProduct({
        description: { ar: 'تواصل معنا على leak@example.com', fr: 'x', en: 'x' },
      });
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_products: JSON.stringify([emailInDesc]) }).storage }),
        'PII_EMAIL',
        'Email inside product description'
      );

      const phoneInBanner = makeDummyBanner({ subtitle: 'اتصل فوراً على +216 21 511 162' });
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_banners: JSON.stringify([phoneInBanner]) }).storage }),
        'PII_PHONE_INTL',
        'Phone inside banner subtitle'
      );

      const ibanInBanner = makeDummyBanner({ subtitle: 'TN59 0800 0000 1234 5678 9012' });
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_banners: JSON.stringify([ibanInBanner]) }).storage }),
        'PII_IBAN_TN',
        'IBAN inside banner subtitle'
      );

      const secretInTitle = makeDummyCategory({ label: 'AIzaSyDummyGoogleKeyPattern1234567890' });
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_categories: JSON.stringify([secretInTitle]) }).storage }),
        'SECRET_GOOGLE_KEY',
        'API key pattern in category'
      );
    });

    // 6. Invalid images, SVG XSS, magic-byte spoofing, and signed/credential URLs rejected
    await runTest('6. Invalid images, spoofed magic bytes, SVG, and signed URLs rejected', async () => {
      const svgProd = makeDummyCanonicalProduct({ images: [SVG_DATA_URI] });
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_products: JSON.stringify([svgProd]) }).storage }),
        'DISALLOWED_DATA_URI',
        'SVG data URI blocked'
      );

      const spoofedPng = makeDummyCanonicalProduct({ images: [FAKE_PNG_TEXT_BASE64] });
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_products: JSON.stringify([spoofedPng]) }).storage }),
        'INVALID_IMAGE_MAGIC',
        'Spoofed PNG magic bytes blocked'
      );

      const credsCompany = makeDummyCompany({ website: 'https://admin:pass123@example.invalid' });
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_companies: JSON.stringify([credsCompany]) }).storage }),
        'URL_CREDENTIALS',
        'URL credentials blocked'
      );

      const signedImg = makeDummyCanonicalProduct({
        images: ['https://cdn.example.invalid/item.png?X-Amz-Signature=deadbeef'],
      });
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_products: JSON.stringify([signedImg]) }).storage }),
        'SENSITIVE_QUERY_PARAM',
        'Signed query param blocked'
      );

      const traversalImg = makeDummyCanonicalProduct({ images: ['/assets/../../secret.png'] });
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_products: JSON.stringify([traversalImg]) }).storage }),
        'PATH_TRAVERSAL',
        'Path traversal blocked'
      );
    });

    // 7. Legacy structures preserved cleanly without corruption (OwnerDashboardMaster + partial SiteSettings)
    await runTest('7. Recognized legacy structures preserved without corruption', async () => {
      const legacyMasterProducts = [
        {
          id: 101,
          name: 'قطع غيار ميكانيكية تجريبية',
          price: '345.000',
          stock: '14 قطع',
          status: 'معروض',
          image: VALID_PNG_BASE64,
        },
      ];
      const legacyPartialSettings = {
        storeName: 'Legacy Local Cache Store',
        governorate: 'sfax',
        enableCOD: true,
      };
      const { storage } = createMockStorage({
        echox_products: JSON.stringify(legacyMasterProducts),
        echox_site_settings: JSON.stringify(legacyPartialSettings),
      });

      const res = await createSafeBackup({ mode: 'local-only', storage });
      const exportedProd = res.envelope.browserCache.data.echox_products![0];
      assertEq(exportedProd.schemaVariant, 'legacy-master-v1', 'Legacy product schema tagged');
      assertEq(exportedProd.name, 'قطع غيار ميكانيكية تجريبية', 'Legacy string name preserved intact');

      const exportedSettings = res.envelope.browserCache.data.echox_site_settings!;
      assertEq(exportedSettings.schemaVariant, 'legacy-partial', 'Legacy partial settings tagged');
      assertEq('workingHours' in exportedSettings, false, 'Omitted field not fabricated on legacy settings');
    });

    // 8. Duplicate IDs rejected
    await runTest('8. Duplicate IDs rejected across collections', async () => {
      const dupProducts = [makeDummyCanonicalProduct({ id: 'dup_1' }), makeDummyCanonicalProduct({ id: 'dup_1' })];
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_products: JSON.stringify(dupProducts) }).storage }),
        'DUPLICATE_ID',
        'Duplicate product ID'
      );

      const dupCompanies = [makeDummyCompany({ id: 'c_dup' }), makeDummyCompany({ id: 'c_dup' })];
      await expectBackupError(
        () => createSafeBackup({ storage: createMockStorage({ echox_companies: JSON.stringify(dupCompanies) }).storage }),
        'DUPLICATE_ID',
        'Duplicate company ID'
      );
    });

    // 9. Mid-backup LocalStorage & Server drift + size limits detected
    await runTest('9. Mid-backup LocalStorage drift, server drift & size limit detection', async () => {
      let langReadCount = 0;
      const driftingStorage: StorageLike = {
        getItem(key: string): string | null {
          if (key === 'echox_language') {
            langReadCount += 1;
            return langReadCount === 1 ? 'ar' : 'fr';
          }
          return null;
        },
      };
      await expectBackupError(
        () => createSafeBackup({ storage: driftingStorage }),
        'LOCAL_STORAGE_DRIFT',
        'LocalStorage drift detected'
      );

      let storeReadCount = 0;
      const driftingFetch = makeMockFetch(
        {
          '/api/store/state': () => {
            storeReadCount += 1;
            return {
              body: {
                success: true,
                products: [makeDummyCanonicalProduct({ price: storeReadCount === 1 ? 250 : 255 })],
                companies: [makeDummyCompany()],
                categories: [makeDummyCategory()],
                banners: [makeDummyBanner()],
                siteSettings: makeDummySiteSettings(),
                updatedAt: '2026-11-17T00:00:00.000Z',
              },
            };
          },
        },
        { calls: [] }
      );
      await expectBackupError(
        () =>
          createSafeBackup({
            mode: 'storefront-readonly',
            includeDiagnostics: false,
            storage: createMockStorage({}).storage,
            fetchFn: driftingFetch,
          }),
        'SERVER_DATA_DRIFT',
        'Server data drift detected'
      );

      // Per-key raw input size quota enforcement
      await expectBackupError(
        () =>
          createSafeBackup({
            storage: createMockStorage({ echox_products: JSON.stringify([makeDummyCanonicalProduct()]) }).storage,
            limits: { maxTotalPayloadBytes: 200 },
          }),
        'SIZE_LIMIT',
        'Per-key raw size quota enforced'
      );

      // Final assembled envelope size quota enforcement
      await expectBackupError(
        () =>
          createSafeBackup({
            storage: createMockStorage({ echox_language: 'ar' }).storage,
            limits: { maxTotalPayloadBytes: 800 },
          }),
        'PAYLOAD_SIZE_LIMIT',
        'Final envelope payload size quota enforced'
      );

      // Server chatConfig containing embedded phone number must fail closed
      const piiChatFetch = makeMockFetch(
        {
          '/api/store/state': () => ({
            body: {
              success: true,
              products: [makeDummyCanonicalProduct()],
              companies: [makeDummyCompany()],
              categories: [makeDummyCategory()],
              banners: [makeDummyBanner()],
              siteSettings: makeDummySiteSettings({ tiktokUrl: 'https://tiktok.com/@echoxstore.tn' }),
              updatedAt: '2026-11-17T00:00:00.000Z',
            },
          }),
          '/api/chat/config': () => ({
            body: {
              success: true,
              config: {
                autoReplyEnabled: true,
                welcomeMessage: { ar: 'مرحبا', fr: 'Bonjour', en: 'Welcome' },
                fallbackMessage: {
                  ar: 'تواصل على +216 21 511 162',
                  fr: 'Appelez +216 21 511 162',
                  en: 'Call +216 21 511 162',
                },
                customRules: [],
                updatedAt: '2026-11-17T00:00:00.000Z',
              },
            },
          }),
        },
        { calls: [] }
      );
      await expectBackupError(
        () =>
          createSafeBackup({
            mode: 'storefront-readonly',
            includeChatConfig: true,
            includeDiagnostics: false,
            storage: createMockStorage({}).storage,
            fetchFn: piiChatFetch,
          }),
        'PII_PHONE_INTL',
        'Server chatConfig fallback phone PII rejected fail-closed'
      );
    });

    // 10. Server HTTP/success validation contract tests
    await runTest('10. Server HTTP & success === true response contract enforcement', async () => {
      const badSuccessFetch = makeMockFetch(
        {
          '/api/store/state': () => ({
            body: {
              // Missing success: true
              products: [makeDummyCanonicalProduct()],
              companies: [],
              categories: [],
              banners: [],
              siteSettings: makeDummySiteSettings(),
              updatedAt: '2026-11-17T00:00:00.000Z',
            },
          }),
        },
        { calls: [] }
      );
      await expectBackupError(
        () =>
          createSafeBackup({
            mode: 'storefront-readonly',
            includeDiagnostics: false,
            storage: createMockStorage({}).storage,
            fetchFn: badSuccessFetch,
          }),
        'INVALID_SUCCESS_FLAG',
        'Missing success === true rejected'
      );

      // Tampering test on exported JSON SHA-256
      const cleanRes = await createSafeBackup({
        storage: createMockStorage({ echox_language: 'en' }).storage,
      });
      const tampered = JSON.parse(cleanRes.jsonText);
      tampered.browserCache.data.echox_language = 'fr';
      const { integrity, ...tamperedCore } = tampered;
      const tamperedHash = await sha256Hex(canonicalStringify(tamperedCore));
      assertTrue(tamperedHash !== integrity.payloadSha256, 'Tampering invalidates SHA-256');
    });

    console.log(`\nALL ${results.length}/${results.length} ECHOX SAFE BACKUP v5.3 TESTS PASSED (ZERO NETWORK CALLS).`);
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
  }
}

runAllTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  throw err;
});
