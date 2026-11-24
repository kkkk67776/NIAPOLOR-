/**
 * NIAPOLOR Phase 3 End-to-End Verification Suite (30 Mandatory Scenarios)
 * Runs against isolated temporary DATA_DIR and ephemeral server port.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import argon2 from 'argon2';

const TEST_PIN = '918273';
const TEST_ACCESS_CODE = '#NiapolorPhase3Test2026!';

const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_PNG_DATA_URL = `data:image/png;base64,${VALID_PNG_BASE64}`;
const SPOOFED_SVG_DATA_URL =
  'data:image/png;base64,' +
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf-8').toString('base64');

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message} (expected=${String(expected)}, actual=${String(actual)})`);
  }
}

function extractCookie(res: Response, cookieName: string): string {
  const anyHeaders = res.headers as any;
  const setCookies: string[] =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : res.headers.get('set-cookie')
      ? [res.headers.get('set-cookie')!]
      : [];
  for (const raw of setCookies) {
    const first = raw.split(';')[0].trim();
    if (first.startsWith(`${cookieName}=`)) {
      return first;
    }
  }
  return '';
}

let ipSeq = 10;
function nextIp(): string {
  const a = 10 + Math.floor(ipSeq / 240);
  const b = (ipSeq % 240) + 1;
  ipSeq++;
  return `198.51.${a}.${b}`;
}

async function run(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niapolor-phase3-test-'));
  let appServer: http.Server | null = null;
  let mockKonnectServer: http.Server | null = null;
  const originalFetch = globalThis.fetch;
  let passedCount = 0;

  const markPass = (num: number, label: string) => {
    passedCount++;
    console.log(`  [${num}/30] ✅ ${label}`);
  };

  try {
    process.env.ECHOX_DISABLE_LISTEN = '1';
    process.env.DATA_DIR = tmpDir;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    process.env.ECHOX_SECURITY_HMAC_SECRET = 'niapolor_phase3_isolated_hmac_secret_min_32_bytes_ok';

    // Seed Argon2id owner credentials in isolated temp DATA_DIR
    const pinHash = await argon2.hash(TEST_PIN, { type: argon2.argon2id });
    const accessHash = await argon2.hash(TEST_ACCESS_CODE, { type: argon2.argon2id });
    fs.writeFileSync(
      path.join(tmpDir, 'central_security_config.json'),
      JSON.stringify({
        access_code_argon2: accessHash,
        pin_argon2: pinHash,
        updated_at: new Date().toISOString(),
        history: [{ type: 'PHASE3_TEST_SEED', timestamp: new Date().toISOString() }],
      }),
      'utf-8'
    );

    // Mock Konnect S2S Sandbox server
    interface MockKonnectRecord {
      paymentRef: string;
      amount: number;
      token: string;
      orderId: string;
      webhookUrl: string;
      status: 'pending' | 'completed' | 'failed';
    }
    const mockPayments = new Map<string, MockKonnectRecord>();
    mockKonnectServer = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const ch of req) chunks.push(ch as Buffer);
        const bodyStr = Buffer.concat(chunks).toString('utf-8');

        if (req.method === 'POST' && req.url === '/api/v2/payments/init-payment') {
          const parsed = JSON.parse(bodyStr || '{}');
          const paymentRef = `kpay_p3_${crypto.randomBytes(4).toString('hex')}`;
          mockPayments.set(paymentRef, {
            paymentRef,
            amount: parsed.amount,
            token: parsed.token || 'TND',
            orderId: parsed.orderId,
            webhookUrl: parsed.webhook,
            status: 'pending',
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              payUrl: `https://sandbox.konnect.network/pay/${paymentRef}`,
              paymentRef,
            })
          );
          return;
        }
        if (req.method === 'GET' && req.url?.startsWith('/api/v2/payments/')) {
          const paymentRef = decodeURIComponent(req.url.split('/').pop() || '');
          const rec = mockPayments.get(paymentRef);
          if (!rec) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Not Found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              payment: {
                id: rec.paymentRef,
                status: rec.status,
                amount: rec.amount,
                token: rec.token,
                orderId: rec.orderId,
              },
            })
          );
          return;
        }
        res.writeHead(404);
        res.end();
      });
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    const konnectAddr = mockKonnectServer.address();
    if (!konnectAddr || typeof konnectAddr === 'string') throw new Error('Mock Konnect bind error');
    const mockKonnectBase = `http://127.0.0.1:${konnectAddr.port}`;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith('https://api.sandbox.konnect.network/')) {
        const rewritten = urlStr.replace('https://api.sandbox.konnect.network', mockKonnectBase);
        return originalFetch(rewritten, init);
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const { app, ensureServerInitialized } = await import('../server');
    await ensureServerInitialized();

    appServer = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = appServer.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind ephemeral server');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Sign in as Admin
    const acRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    assertEq(acRes.status, 200, 'Admin access code verified');
    const { gateToken } = (await acRes.json()) as any;
    const pinRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ pin: TEST_PIN, gateToken }),
    });
    assertEq(pinRes.status, 200, 'Admin PIN verified');
    const { sessionToken: adminToken, csrfToken } = (await pinRes.json()) as any;
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'X-CSRF-Token': csrfToken,
      'x-forwarded-for': nextIp(),
    };

    // Prepare controlled test products in store state (synced automatically to payment catalog)
    const adminStoreRes = await fetch(`${baseUrl}/api/admin/store/state`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertEq(adminStoreRes.status, 200, 'Load admin store state');
    const adminStore = (await adminStoreRes.json()) as any;
    const baseProducts = [...adminStore.products];
    const primaryProd = { ...baseProducts[0], price: 50, stock: 20, active: true, sku: 'NIA-P3-PRIMARY' };
    const limitedProd = {
      ...baseProducts[1],
      id: 'prod_p3_limited',
      sku: 'NIA-P3-LIMITED',
      name: { ar: 'منتج محدود المخزون', fr: 'Stock Limité', en: 'Limited Stock Item' },
      price: 40,
      stock: 3,
      active: true,
    };
    const multiLineProd = {
      ...baseProducts[1],
      id: 'prod_p3_multiline',
      sku: 'NIA-P3-MULTILINE',
      name: { ar: 'منتج متعدد السطور', fr: 'Multi Line Item', en: 'Multi Line Item' },
      price: 35,
      stock: 2,
      active: true,
    };
    const inactiveProd = {
      ...baseProducts[1],
      id: 'prod_p3_inactive',
      sku: 'NIA-P3-INACTIVE',
      name: { ar: 'منتج غير متاح', fr: 'Inactif', en: 'Inactive Item' },
      price: 25,
      stock: 10,
      active: false,
    };
    const snapshotProd = {
      ...baseProducts[1],
      id: 'prod_p3_snapshot',
      sku: 'NIA-P3-SNAP-01',
      name: { ar: 'اسم أصلي قبل التعديل', fr: 'Nom Original', en: 'Original Product Name' },
      price: 60,
      stock: 10,
      active: true,
    };
    const bridgeProd = {
      ...baseProducts[1],
      id: 'prod_p3_bridge',
      sku: 'NIA-P3-BRIDGE',
      name: { ar: 'منتج مزامنة المخزون', fr: 'Bridge Stock', en: 'Bridge Stock Item' },
      price: 45,
      stock: 5,
      active: true,
    };

    const allTestProducts = [primaryProd, limitedProd, multiLineProd, inactiveProd, snapshotProd, bridgeProd, ...baseProducts.slice(2)];
    const updateStoreRes = await fetch(`${baseUrl}/api/admin/store/state`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ products: allTestProducts }),
    });
    assertEq(updateStoreRes.status, 200, 'Seed Phase 3 test products in store & payment catalog');

    // Register two distinct customers (Customer A and Customer B)
    const regARes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'NIAPOLOR-Customer', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        fullName: 'يوسف القابسي',
        email: 'cust.a.p3@niapolor.tn',
        phone: '+216 21 100 200',
        password: 'Customer#Phase3A!',
        confirmPassword: 'Customer#Phase3A!',
        lang: 'ar',
      }),
    });
    assertEq(regARes.status, 201, 'Customer A registered');
    const custACookie = extractCookie(regARes, '__customer_session');
    const custAId = ((await regARes.json()) as any).customer.id;

    const regBRes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'NIAPOLOR-Customer', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        fullName: 'سلمى المهدوي',
        email: 'cust.b.p3@niapolor.tn',
        phone: '+216 22 300 400',
        password: 'Customer#Phase3B!',
        confirmPassword: 'Customer#Phase3B!',
        lang: 'ar',
      }),
    });
    assertEq(regBRes.status, 201, 'Customer B registered');
    const custBCookie = extractCookie(regBRes, '__customer_session');

    // =========================================================================
    // Test 1: Guest checkout succeeds & returns trackingNumber + trackingToken
    // =========================================================================
    const guestRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'زائر تونسي',
        customerPhone: '22111222',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'نهج القصبة عدد 4' },
        paymentMethod: 'cod',
        items: [{ productId: primaryProd.id, productName: primaryProd.name, quantity: 1, unitPrice: primaryProd.price }],
      }),
    });
    assertEq(guestRes.status, 200, 'Guest checkout returns 200');
    const guestJson = (await guestRes.json()) as any;
    const guestOrder = guestJson.order;
    const guestToken: string = guestJson.trackingToken;
    assertTrue(/^ECH-TN-[A-Z0-9]+$/.test(guestOrder.trackingNumber), 'Guest order receives ECH-TN trackingNumber');
    assertTrue(typeof guestToken === 'string' && guestToken.length === 32, 'Guest order receives 32-hex trackingToken');
    assertTrue(!guestOrder.customerId, 'Guest order has no customerId');
    markPass(1, 'Guest checkout returns trackingNumber & trackingToken');

    // =========================================================================
    // Test 2: Signed-in customer checkout ignores forged customerId & binds session
    // =========================================================================
    const custCheckoutRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: custACookie, 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerId: 'cust_forged_hacker_999',
        customerName: 'يوسف القابسي',
        customerPhone: '21100200',
        shippingAddress: { governorate: 'tunis', delegation: 'باردو', street: 'شارع الاستقلال 12' },
        paymentMethod: 'cod',
        items: [{ productId: primaryProd.id, productName: primaryProd.name, quantity: 1, unitPrice: primaryProd.price }],
      }),
    });
    assertEq(custCheckoutRes.status, 200, 'Signed-in customer checkout succeeds');
    const custOrder = ((await custCheckoutRes.json()) as any).order;
    assertEq(custOrder.customerId, custAId, 'Forged customerId ignored; authenticated session customerId bound');
    markPass(2, 'Signed-in customer ignores forged customerId & binds session');

    // =========================================================================
    // Test 3: Tampered prices/totals rejected (PRICE_CHANGED / TOTAL_MISMATCH) + quote returned
    // =========================================================================
    const tamperPriceRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'محتال السعر',
        customerPhone: '55112233',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الجمهورية' },
        paymentMethod: 'cod',
        items: [{ productId: primaryProd.id, productName: primaryProd.name, quantity: 1, unitPrice: 1.5 }],
      }),
    });
    assertEq(tamperPriceRes.status, 400, 'Tampered unitPrice rejected with 400');
    const tamperPriceJson = (await tamperPriceRes.json()) as any;
    assertEq(tamperPriceJson.code, 'PRICE_CHANGED', 'Returns PRICE_CHANGED code');
    assertTrue(Array.isArray(tamperPriceJson.updatedPrices) && tamperPriceJson.updatedPrices[0].newPrice === primaryProd.price, 'Returns updatedPrices');
    assertEq(tamperPriceJson.updatedQuote?.subtotal, primaryProd.price, 'Returns authoritative updatedQuote');

    const tamperTotalRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'محتال الإجمالي',
        customerPhone: '55112233',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الجمهورية' },
        paymentMethod: 'cod',
        clientExpectedTotal: 2.0,
        items: [{ productId: primaryProd.id, productName: primaryProd.name, quantity: 1, unitPrice: primaryProd.price }],
      }),
    });
    assertEq(tamperTotalRes.status, 400, 'Tampered clientExpectedTotal rejected (TOTAL_MISMATCH)');
    assertEq(((await tamperTotalRes.json()) as any).code, 'TOTAL_MISMATCH', 'Returns TOTAL_MISMATCH code');
    markPass(3, 'Tampered prices/totals rejected with updatedPrices/updatedQuote');

    // =========================================================================
    // Test 4: Inactive/unavailable product rejected (400)
    // =========================================================================
    const inactiveRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'زبون عادي',
        customerPhone: '55112233',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الحرية' },
        paymentMethod: 'cod',
        items: [{ productId: inactiveProd.id, productName: inactiveProd.name, quantity: 1, unitPrice: inactiveProd.price }],
      }),
    });
    assertEq(inactiveRes.status, 400, 'Inactive product checkout rejected (400)');
    assertEq(((await inactiveRes.json()) as any).code, 'PRODUCT_INACTIVE', 'Returns PRODUCT_INACTIVE code');
    markPass(4, 'Inactive product rejected with 400 PRODUCT_INACTIVE');

    // =========================================================================
    // Test 5: Coupon valid/expired/inactive/minSubtotal/maxDiscount validated
    // =========================================================================
    const couponConfigRes = await fetch(`${baseUrl}/api/admin/payments/config`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        coupons: [
          { code: 'P3CAP20', discountType: 'percentage', discountValue: 50, active: true, maxDiscount: 12, minSubtotal: 30 },
          { code: 'P3EXPIRED', discountType: 'fixed', discountValue: 10, active: true, expiresAt: '2020-01-01T00:00:00Z' },
          { code: 'P3DISABLED', discountType: 'fixed', discountValue: 10, active: false },
          { code: 'P3MIN200', discountType: 'fixed', discountValue: 15, active: true, minSubtotal: 200 },
        ],
      }),
    });
    assertEq(couponConfigRes.status, 200, 'Admin configures test coupons');

    const cValidRes = await fetch(`${baseUrl}/api/payments/apply-coupon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ couponCode: 'P3CAP20', subtotal: 50 }),
    });
    assertEq(cValidRes.status, 200, 'Valid coupon accepted');
    assertEq(((await cValidRes.json()) as any).discount, 12, 'maxDiscount cap enforced (50% of 50 = 25 -> capped at 12)');

    const cExpiredRes = await fetch(`${baseUrl}/api/payments/apply-coupon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ couponCode: 'P3EXPIRED', subtotal: 50 }),
    });
    assertEq(cExpiredRes.status, 400, 'Expired coupon rejected');
    assertEq(((await cExpiredRes.json()) as any).code, 'EXPIRED_COUPON', 'EXPIRED_COUPON code returned');

    const cDisabledRes = await fetch(`${baseUrl}/api/payments/apply-coupon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ couponCode: 'P3DISABLED', subtotal: 50 }),
    });
    assertEq(cDisabledRes.status, 400, 'Inactive coupon rejected');

    const cMinRes = await fetch(`${baseUrl}/api/payments/apply-coupon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ couponCode: 'P3MIN200', subtotal: 50 }),
    });
    assertEq(cMinRes.status, 400, 'Coupon below minSubtotal rejected');
    assertEq(((await cMinRes.json()) as any).code, 'COUPON_MIN_SUBTOTAL', 'COUPON_MIN_SUBTOTAL code returned');
    markPass(5, 'Server coupon validation (valid, maxDiscount, expired, inactive, minSubtotal)');

    // =========================================================================
    // Test 6, 7, 8, 25, 29: Shipping fee rules, overrides, disabled, unconfigured & free threshold
    // =========================================================================
    const shipCfgRes = await fetch(`${baseUrl}/api/admin/payments/config`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        standardShippingFee: 8,
        freeShippingThreshold: 120,
        shippingRules: {
          tunis: {
            governorateId: 'tunis',
            enabled: true,
            fee: 5.5,
            useStandardFee: false,
            estimatedDelivery: '24 ساعة',
            delegationOverrides: {
              قرطاج: { enabled: true, fee: 9.25, estimatedDelivery: '12-24 ساعة' },
            },
          },
          tataouine: {
            governorateId: 'tataouine',
            enabled: false,
            fee: 15,
            useStandardFee: false,
            estimatedDelivery: '96 ساعة',
          },
          kasserine: {
            governorateId: 'kasserine',
            enabled: true,
            fee: null,
            useStandardFee: false,
            estimatedDelivery: '72 ساعة',
          },
        },
      }),
    });
    assertEq(shipCfgRes.status, 200, 'Admin updates governorate + delegation shipping rules');

    // Test 6 & 25: Per-governorate & per-delegation quote/checkout
    const govQuoteRes = await fetch(`${baseUrl}/api/payments/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        governorate: 'tunis',
        delegation: 'المدينة',
        items: [{ productId: primaryProd.id, quantity: 1 }],
      }),
    });
    const govQuote = (await govQuoteRes.json()) as any;
    assertEq(govQuote.shippingFee, 5.5, 'Per-governorate shipping fee used');
    assertEq(govQuote.estimatedDelivery, '24 ساعة', 'Per-governorate estimatedDelivery returned');

    const delQuoteRes = await fetch(`${baseUrl}/api/payments/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        governorate: 'tunis',
        delegation: 'قرطاج',
        items: [{ productId: primaryProd.id, quantity: 1 }],
      }),
    });
    const delQuote = (await delQuoteRes.json()) as any;
    assertEq(delQuote.shippingFee, 9.25, 'Per-delegation override shipping fee used');
    assertEq(delQuote.estimatedDelivery, '12-24 ساعة', 'Per-delegation override delivery estimate used');
    markPass(6, 'Per-governorate & per-delegation shipping fee + delivery estimate');
    markPass(25, 'Admin updated shipping rules take effect immediately in quote/checkout');

    // Test 7: Disabled region -> 400 SHIPPING_UNAVAILABLE
    const disabledGovRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'زبون تطاوين',
        customerPhone: '22999888',
        shippingAddress: { governorate: 'tataouine', delegation: 'تطاوين الشمالية', street: 'شارع الحبيب بورقيبة' },
        paymentMethod: 'cod',
        items: [{ productId: primaryProd.id, quantity: 1, unitPrice: primaryProd.price }],
      }),
    });
    assertEq(disabledGovRes.status, 400, 'Disabled shipping region rejected (400)');
    assertEq(((await disabledGovRes.json()) as any).code, 'SHIPPING_UNAVAILABLE', 'Returns SHIPPING_UNAVAILABLE');
    markPass(7, 'Disabled shipping region rejected with 400 SHIPPING_UNAVAILABLE');

    // Test 8: Unconfigured region -> 400 SHIPPING_UNCONFIGURED (never defaults to 0)
    const unconfGovRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'زبون القصرين',
        customerPhone: '22999777',
        shippingAddress: { governorate: 'kasserine', delegation: 'القصرين الشمالية', street: 'شارع الشهداء' },
        paymentMethod: 'cod',
        items: [{ productId: primaryProd.id, quantity: 1, unitPrice: primaryProd.price }],
      }),
    });
    assertEq(unconfGovRes.status, 400, 'Unconfigured shipping region rejected (400)');
    assertEq(((await unconfGovRes.json()) as any).code, 'SHIPPING_UNCONFIGURED', 'Returns SHIPPING_UNCONFIGURED');
    markPass(8, 'Unconfigured shipping region rejected (never defaults to 0)');

    // Test 29: Free shipping threshold respected & null threshold disables free shipping
    const freeShipQuoteRes = await fetch(`${baseUrl}/api/payments/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        governorate: 'tunis',
        delegation: 'المدينة',
        items: [{ productId: primaryProd.id, quantity: 3 }], // subtotal = 150 >= 120
      }),
    });
    const freeShipQuote = (await freeShipQuoteRes.json()) as any;
    assertEq(freeShipQuote.freeShippingApplied, true, 'Free shipping applies above threshold');
    assertEq(freeShipQuote.shippingFee, 0, 'Shipping fee becomes 0 above threshold');

    await fetch(`${baseUrl}/api/admin/payments/config`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ freeShippingThreshold: null }),
    });
    const nullThresholdQuoteRes = await fetch(`${baseUrl}/api/payments/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        governorate: 'tunis',
        delegation: 'المدينة',
        items: [{ productId: primaryProd.id, quantity: 3 }],
      }),
    });
    const nullThresholdQuote = (await nullThresholdQuoteRes.json()) as any;
    assertEq(nullThresholdQuote.freeShippingApplied, false, 'Disabled/null free threshold does NOT apply free shipping');
    assertEq(nullThresholdQuote.shippingFee, 5.5, 'Regular shipping fee preserved when threshold is null');
    markPass(29, 'Free shipping threshold & disabled/null threshold accurate');

    // =========================================================================
    // Test 9: Concurrent checkouts on limited stock (stock=3, 5 concurrent qty=1)
    // =========================================================================
    const concurrentReqs = Array.from({ length: 5 }, (_, idx) =>
      fetch(`${baseUrl}/api/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
        body: JSON.stringify({
          customerName: `مشتري متزامن ${idx}`,
          customerPhone: `2211000${idx}`,
          shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع متزامن 10' },
          paymentMethod: 'cod',
          items: [{ productId: limitedProd.id, productName: limitedProd.name, quantity: 1, unitPrice: limitedProd.price }],
        }),
      })
    );
    const concurrentRes = await Promise.all(concurrentReqs);
    const okCount = concurrentRes.filter((r) => r.status === 200).length;
    const conflictCount = concurrentRes.filter((r) => r.status === 409).length;
    assertEq(okCount, 3, 'Exactly 3 concurrent orders succeed when stock=3');
    assertEq(conflictCount, 2, 'Remaining 2 concurrent orders fail with 409 STOCK_UNAVAILABLE');
    const storeAfterConc = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
    const limitedAfter = storeAfterConc.products.find((p: any) => p.id === limitedProd.id);
    assertEq(limitedAfter.stock, 0, 'Limited product stock never goes negative');
    markPass(9, 'Concurrent checkouts on limited stock: atomic 3 succeed, 2 get 409, stock=0');

    // =========================================================================
    // Test 10: Multi-line same product in one cart checks consolidated stock
    // =========================================================================
    const multiLineRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'مشتري سطور متعددة',
        customerPhone: '22334455',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع التجمع 5' },
        paymentMethod: 'cod',
        items: [
          { productId: multiLineProd.id, quantity: 2, unitPrice: multiLineProd.price },
          { productId: multiLineProd.id, quantity: 1, unitPrice: multiLineProd.price },
        ],
      }),
    });
    assertEq(multiLineRes.status, 409, 'Consolidated multi-line cart exceeding stock (2+1 > 2) rejected with 409');
    assertEq(((await multiLineRes.json()) as any).code, 'STOCK_UNAVAILABLE', 'Returns STOCK_UNAVAILABLE');
    markPass(10, 'Multi-line same product in one cart checks consolidated stock');

    // =========================================================================
    // Test 11 & 28: Duplicate clientRequestId idempotency + /api/payments/checkout/status recovery
    // =========================================================================
    const idemReqId = 'req_phase3_idem_timeout_recovery_001';
    const idemBody = {
      customerName: 'زبون الاسترداد',
      customerPhone: '55990011',
      shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع النصر 99' },
      paymentMethod: 'cod',
      clientRequestId: idemReqId,
      items: [{ productId: bridgeProd.id, quantity: 1, unitPrice: bridgeProd.price }], // bridgeProd stock 5 -> 4
    };
    const idem1 = await (
      await fetch(`${baseUrl}/api/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
        body: JSON.stringify(idemBody),
      })
    ).json() as any;
    const idem2 = await (
      await fetch(`${baseUrl}/api/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
        body: JSON.stringify(idemBody),
      })
    ).json() as any;
    assertEq(idem1.order.id, idem2.order.id, 'Duplicate clientRequestId returns same order ID');
    assertEq(idem1.trackingToken, idem2.trackingToken, 'Duplicate clientRequestId returns same trackingToken');

    const storeAfterIdem = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
    const bridgeAfter1 = storeAfterIdem.products.find((p: any) => p.id === bridgeProd.id);
    assertEq(bridgeAfter1.stock, 4, 'Stock deducted only once on duplicate clientRequestId (5 -> 4)');

    const recGet = (await (await fetch(`${baseUrl}/api/payments/checkout/status/${encodeURIComponent(idemReqId)}`)).json()) as any;
    assertEq(recGet.found, true, 'GET checkout/status finds completed order');
    assertEq(recGet.order.id, idem1.order.id, 'GET checkout/status matches order ID');
    assertEq(recGet.trackingToken, idem1.trackingToken, 'GET checkout/status recovers decrypted trackingToken');

    const recPost = (await (
      await fetch(`${baseUrl}/api/payments/checkout/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
        body: JSON.stringify({ clientRequestId: idemReqId }),
      })
    ).json()) as any;
    assertEq(recPost.found, true, 'POST checkout/status recovers order cleanly');
    assertEq(recPost.trackingToken, idem1.trackingToken, 'POST checkout/status recovers trackingToken');
    markPass(11, 'Duplicate clientRequestId idempotent (single order & single stock deduction)');
    markPass(28, 'Checkout status recovery endpoint recovers order & trackingToken');

    // =========================================================================
    // Test 12: Purchase-time snapshot preserved after admin edits product price/name
    // =========================================================================
    const snapOrderRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'مشتري اللقطة التاريخية',
        customerPhone: '29112233',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الهادي شاكر' },
        paymentMethod: 'cod',
        items: [{ productId: snapshotProd.id, quantity: 2, unitPrice: snapshotProd.price }],
      }),
    });
    assertEq(snapOrderRes.status, 200, 'Snapshot order succeeds');
    const snapOrder = ((await snapOrderRes.json()) as any).order;
    const snapToken = snapOrder.trackingToken;

    // Now admin edits snapshotProd price (60 -> 199) and name (fetching fresh store products first)
    const freshStoreBeforeEdit = (await (
      await fetch(`${baseUrl}/api/admin/store/state`, { headers: { Authorization: `Bearer ${adminToken}` } })
    ).json()) as any;
    const editedProducts = (freshStoreBeforeEdit.products || []).map((p: any) =>
      p.id === snapshotProd.id
        ? { ...p, price: 199, name: { ar: 'اسم جديد معدل', fr: 'Nom Modifié', en: 'Edited Name' } }
        : p
    );
    await fetch(`${baseUrl}/api/admin/store/state`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ products: editedProducts }),
    });
    const adminCheckSnap = (await (
      await fetch(`${baseUrl}/api/admin/orders?q=${encodeURIComponent(snapOrder.trackingNumber)}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    ).json()) as any;
    const fetchedSnapOrder = adminCheckSnap.orders[0];
    assertEq(fetchedSnapOrder.items[0].sku, 'NIA-P3-SNAP-01', 'Snapshot preserves SKU');
    assertEq(fetchedSnapOrder.items[0].unitPrice, 60, 'Snapshot preserves historical unitPrice after catalog edit');
    assertEq(fetchedSnapOrder.items[0].productName.en, 'Original Product Name', 'Snapshot preserves historical productName');
    assertEq(fetchedSnapOrder.items[0].quantity, 2, 'Snapshot preserves quantity');
    void snapToken;
    markPass(12, 'Purchase-time snapshot (SKU, name, unitPrice, qty) preserved after catalog edits');

    // =========================================================================
    // Test 13, 14, 30: Storefront stock sync, admin cancel restores stock ONCE, inventoryLogs
    // =========================================================================
    // bridgeProd currently has stock 4 from Test 11 (idem1 bought qty=1 from 5 -> 4).
    const cancel1Res = await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(idem1.order.id)}/status`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'cancelled', reason: 'إلغاء لاختبار استرجاع المخزون' }),
    });
    assertEq(cancel1Res.status, 200, 'Admin cancels order with reason');
    const cancel1Json = (await cancel1Res.json()) as any;
    assertEq(cancel1Json.order.cancelReason, 'إلغاء لاختبار استرجاع المخزون', 'Cancel reason saved');

    // Check store state stock restored back 4 -> 5
    const storeRestored = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
    const bridgeRestored = storeRestored.products.find((p: any) => p.id === bridgeProd.id);
    assertEq(bridgeRestored.stock, 5, 'Storefront stock synced down on checkout (5->4) and restored on cancel (4->5)');

    // Check inventoryLogs contains checkout_deduct & order_cancel_restore
    const ovInv = (await (
      await fetch(`${baseUrl}/api/admin/payments/overview`, { headers: { Authorization: `Bearer ${adminToken}` } })
    ).json()) as any;
    const cancelLogs = (ovInv.inventoryLogs || []).filter(
      (l: any) => l.orderId === idem1.order.id && l.reason === 'order_cancel_restore'
    );
    assertEq(cancelLogs.length, 1, 'inventoryLogs recorded order_cancel_restore');

    // Repeat cancel & attempt refund on same already-cancelled order -> NO double stock restore
    await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(idem1.order.id)}/status`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'cancelled', reason: 'تكرار الإلغاء' }),
    });
    await fetch(`${baseUrl}/api/admin/payments/refund`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ orderId: idem1.order.id, action: 'refund', reason: 'استرجاع متكرر' }),
    });
    const storeAfterRepeat = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
    const bridgeAfterRepeat = storeAfterRepeat.products.find((p: any) => p.id === bridgeProd.id);
    assertEq(bridgeAfterRepeat.stock, 5, 'Repeating cancel/refund does NOT double-restore stock (still 5)');
    markPass(13, 'Admin cancel restores stock once & writes inventoryLogs');
    markPass(14, 'Repeating cancel/refund blocked from double-restoring stock');
    markPass(30, 'Storefront product stock syncs down on checkout and restores via bridge');

    // =========================================================================
    // Test 15 & 26: Poste/CCP proof validation, manual confirmFundsReceived, unpaid shipping blocked
    // =========================================================================
    const ccpOrderRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'عميل البريد التونسي',
        customerPhone: '55778899',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع محمد الخامس' },
        paymentMethod: 'poste_ccp',
        items: [{ productId: primaryProd.id, quantity: 1, unitPrice: primaryProd.price }],
      }),
    });
    assertEq(ccpOrderRes.status, 200, 'Poste/CCP checkout succeeds');
    const ccpJson = (await ccpOrderRes.json()) as any;
    const ccpOrder = ccpJson.order;
    const ccpToken: string = ccpJson.trackingToken;
    assertEq(ccpOrder.paymentStatus, 'Awaiting Bank Transfer', 'Starts as Awaiting Bank Transfer');

    // Unpaid non-COD shipping blocked (409)
    const blockShipRes = await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(ccpOrder.id)}/status`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'preparing' }),
    });
    assertEq(blockShipRes.status, 409, 'Unpaid non-COD order blocked from shipping (409)');

    // Spoofed SVG rejected
    const badSvgProof = await fetch(`${baseUrl}/api/payments/poste-ccp/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        trackingNumber: ccpOrder.trackingNumber,
        trackingToken: ccpToken,
        referenceNumber: 'CCP-SVG',
        senderName: 'Test',
        receiptImageDataUrl: SPOOFED_SVG_DATA_URL,
      }),
    });
    assertEq(badSvgProof.status, 400, 'Spoofed SVG proof rejected (400)');

    // Valid PNG proof accepted -> Payment Verification
    const goodPngProof = await fetch(`${baseUrl}/api/payments/poste-ccp/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        trackingNumber: ccpOrder.trackingNumber,
        trackingToken: ccpToken,
        referenceNumber: 'CCP-REAL-2026',
        senderName: 'عميل البريد التونسي',
        receiptImageDataUrl: VALID_PNG_DATA_URL,
      }),
    });
    assertEq(goodPngProof.status, 200, 'Valid PNG receipt accepted');
    assertEq(((await goodPngProof.json()) as any).order.paymentStatus, 'Payment Verification', 'Transitions to Payment Verification');

    // Approve without confirmFundsReceived fails (400)
    const noConfirmRes = await fetch(`${baseUrl}/api/admin/payments/verify`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ orderId: ccpOrder.id, action: 'approve' }),
    });
    assertEq(noConfirmRes.status, 400, 'Approval without confirmFundsReceived rejected (400)');

    const yesConfirmRes = await fetch(`${baseUrl}/api/admin/payments/verify`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ orderId: ccpOrder.id, action: 'approve', confirmFundsReceived: true, verificationNote: 'CCP-OK' }),
    });
    assertEq(yesConfirmRes.status, 200, 'Approval with confirmFundsReceived marks Paid');
    markPass(15, 'Poste/CCP lifecycle, raster magic-bytes, manual confirmFundsReceived');
    markPass(26, 'Unpaid non-COD order blocked from shipping (409)');

    // =========================================================================
    // Test 16, 17, 18: Online Konnect gateway S2S webhook, failures & tamper checks
    // =========================================================================
    const webhookSecret = 'whsec_phase3_konnect_secret_2026';
    await fetch(`${baseUrl}/api/admin/payments/config`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        onlinePayment: {
          enabled: true,
          provider: 'konnect',
          mode: 'sandbox',
          apiKey: 'test_konnect_api_key',
          walletId: 'wallet_phase3_001',
          webhookSecret,
        },
      }),
    });

    const onlineRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'مشتري كونكت',
        customerPhone: '29887766',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الحرية' },
        paymentMethod: 'online_payment',
        items: [{ productId: primaryProd.id, quantity: 1, unitPrice: primaryProd.price }],
      }),
    });
    assertEq(onlineRes.status, 200, 'Online Konnect checkout succeeds');
    const onlineJson = (await onlineRes.json()) as any;
    const onOrder = onlineJson.order;
    const payRef = onlineJson.paymentUrl.split('/').pop()!;
    const kRec = mockPayments.get(payRef)!;
    const whTok = kRec.webhookUrl.split('/').pop()!;

    // Test 18: Amount, currency, and orderId tamper mismatches rejected (403)
    kRec.status = 'completed';
    const origAmt = kRec.amount;
    kRec.amount = 100;
    assertEq(
      (await fetch(`${baseUrl}/api/payments/webhook/konnect/${whTok}?payment_ref=${payRef}`)).status,
      403,
      'Webhook rejects amount mismatch (403)'
    );
    kRec.amount = origAmt;

    const origCur = kRec.token;
    kRec.token = 'EUR';
    assertEq(
      (await fetch(`${baseUrl}/api/payments/webhook/konnect/${whTok}?payment_ref=${payRef}`)).status,
      403,
      'Webhook rejects currency mismatch (403)'
    );
    kRec.token = origCur;

    const origOrdId = kRec.orderId;
    kRec.orderId = 'ECH-TN-OTHER99';
    assertEq(
      (await fetch(`${baseUrl}/api/payments/webhook/konnect/${whTok}?payment_ref=${payRef}`)).status,
      403,
      'Webhook rejects orderId mismatch (403)'
    );
    kRec.orderId = origOrdId;
    markPass(18, 'Gateway webhook/verify rejects amount, currency, & orderId mismatch (403)');

    // Test 16: Valid webhook marks Paid idempotently; replay ignored
    const okWh = await fetch(`${baseUrl}/api/payments/webhook/konnect/${whTok}?payment_ref=${payRef}`);
    assertEq(okWh.status, 200, 'Valid Konnect webhook marks Paid');
    const dupWh = (await (await fetch(`${baseUrl}/api/payments/webhook/konnect/${whTok}?payment_ref=${payRef}`)).json()) as any;
    assertEq(dupWh.idempotentDuplicate, true, 'Duplicate webhook ignored idempotently');
    markPass(16, 'Online gateway S2S webhook marks Paid & ignores duplicate replays');

    // Test 17: Failed online gateway leaves unpaid & blocked from shipping
    const onlineFailRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({
        customerName: 'مشتري فاشل',
        customerPhone: '29665544',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع باريس' },
        paymentMethod: 'online_payment',
        items: [{ productId: primaryProd.id, quantity: 1, unitPrice: primaryProd.price }],
      }),
    });
    const failJson = (await onlineFailRes.json()) as any;
    const failOrder = failJson.order;
    const failRef = failJson.paymentUrl.split('/').pop()!;
    const failRec = mockPayments.get(failRef)!;
    failRec.status = 'failed';
    const failWhTok = failRec.webhookUrl.split('/').pop()!;
    const failWh = await fetch(`${baseUrl}/api/payments/webhook/konnect/${failWhTok}?payment_ref=${failRef}`);
    assertEq(failWh.status, 200, 'Failed webhook recorded cleanly');
    const shipFailRes = await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(failOrder.id)}/status`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'preparing' }),
    });
    assertEq(shipFailRes.status, 409, 'Failed online payment blocked from shipping (409)');
    markPass(17, 'Failed online gateway leaves unpaid & blocked from shipping');

    // =========================================================================
    // Test 19, 20, 21, 22, 23: Tracking Auth & Cross-Customer Isolation
    // =========================================================================
    assertEq(
      (await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(guestOrder.trackingNumber)}`)).status,
      401,
      '19: Guest track without token fails (401)'
    );
    markPass(19, 'Guest tracking without trackingToken fails (401)');

    assertEq(
      (
        await fetch(`${baseUrl}/api/payments/track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
          body: JSON.stringify({ trackingNumber: guestOrder.trackingNumber, trackingToken: '00001111222233334444555566667777' }),
        })
      ).status,
      403,
      '20: Guest track with wrong token fails (403)'
    );
    markPass(20, 'Guest tracking with wrong trackingToken fails (403)');

    assertEq(
      (
        await fetch(`${baseUrl}/api/payments/track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
          body: JSON.stringify({ trackingNumber: guestOrder.id, trackingToken: guestToken }),
        })
      ).status,
      403,
      '21: Tracking via internal ord_* ID rejected (403)'
    );
    markPass(21, 'Tracking using internal DB ID (ord_*) rejected (403)');

    assertEq(
      (
        await fetch(
          `${baseUrl}/api/payments/track/${encodeURIComponent(guestOrder.trackingNumber)}?phone=22111222`
        )
      ).status,
      401,
      '22: Phone-only tracking rejected (401)'
    );
    markPass(22, 'Phone-only tracking rejected (401)');

    // Test 23: Authenticated Customer A views own order without token; Customer B cannot access it
    const ownTrackRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(custOrder.trackingNumber)}`, {
      headers: { Cookie: custACookie, 'x-forwarded-for': nextIp() },
    });
    assertEq(ownTrackRes.status, 200, 'Customer A views own order without token');
    const ownTrackJson = (await ownTrackRes.json()) as any;
    assertEq(ownTrackJson.order.piiMasked, false, 'Authenticated customer sees unmasked own order');

    const crossTrackRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(custOrder.trackingNumber)}`, {
      headers: { Cookie: custBCookie, 'x-forwarded-for': nextIp() },
    });
    assertEq(crossTrackRes.status, 401, 'Customer B blocked from viewing Customer A order');
    const custBOrdersJson = (await (
      await fetch(`${baseUrl}/api/customer/orders`, { headers: { Cookie: custBCookie } })
    ).json()) as any;
    assertTrue(
      !(custBOrdersJson.orders || []).some((o: any) => o.id === custOrder.id),
      'Customer A order absent from Customer B /api/customer/orders'
    );
    markPass(23, 'Customer sees own order unmasked; cross-customer access blocked');

    // =========================================================================
    // Test 24 & 27: Admin search/filter + COD auto-settlement on delivered
    // =========================================================================
    const filterPaidRes = await fetch(
      `${baseUrl}/api/admin/orders?q=${encodeURIComponent(onOrder.trackingNumber)}&paymentStatus=Paid`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    assertEq(filterPaidRes.status, 200, 'Admin filtered orders returns 200');
    const filterPaidJson = (await filterPaidRes.json()) as any;
    assertEq(filterPaidJson.orders.length, 1, 'Filtered search returns exact matching Paid order');
    markPass(24, 'Admin search & filter /api/admin/orders works accurately');

    const codDelivRes = await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(custOrder.id)}/status`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'delivered', note: 'تم التسليم والدفع' }),
    });
    assertEq(codDelivRes.status, 200, 'Admin delivers COD order');
    const codDelivJson = (await codDelivRes.json()) as any;
    assertEq(codDelivJson.order.paymentStatus, 'Paid', 'Delivered COD order auto-settled to Paid');

    const ovAfterCod = (await (
      await fetch(`${baseUrl}/api/admin/payments/overview`, { headers: { Authorization: `Bearer ${adminToken}` } })
    ).json()) as any;
    const codLedger = (ovAfterCod.vendorLedgers || []).find((l: any) => l.orderId === custOrder.id);
    assertEq(codLedger.payoutStatus, 'eligible', 'Delivered COD order unlocks vendor ledger to eligible');
    markPass(27, 'COD order delivered auto-settles to Paid & unlocks vendor ledger');

    console.log(`\n🎉 ALL ${passedCount}/30 NIAPOLOR Phase 3 Checkout, Orders & Payments tests PASSED!`);
    assertEq(passedCount, 30, 'Exact count of 30 mandatory scenarios');
  } finally {
    globalThis.fetch = originalFetch;
    if (appServer) {
      await new Promise<void>((resolve) => appServer!.close(() => resolve()));
    }
    if (mockKonnectServer) {
      await new Promise<void>((resolve) => mockKonnectServer!.close(() => resolve()));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('❌ phase3CheckoutOrders.test.ts FAILED:', err);
  process.exit(1);
});
