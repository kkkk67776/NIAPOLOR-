/**
 * Isolated Checkout, Tunisian 24 Governorates & Dependent Delegations Verification Suite
 *
 * Tests:
 * 1. All 24 Tunisian governorates and unique non-empty official delegations.
 * 2. Dependent delegation lookup & cross-governorate mismatch rejection.
 * 3. Tunisian 8-digit phone normalization & validation.
 * 4. Server-side validation (POST /api/payments/checkout) in isolated temp DATA_DIR:
 *    - rejects missing delegation, cross-governorate delegation, invalid phone, missing street
 *    - allows empty/omitted customerEmail and omitted postalCode
 *    - saves governorate and delegation separately in shippingAddress (plus city mirror)
 *    - keeps shipping fee & order totals strictly identical to existing rules
 *    - preserves backward compatibility with legacy orders missing delegation
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import argon2 from 'argon2';
import type http from 'http';
import {
  TUNISIAN_GOVERNORATES,
  getDelegationsForGovernorate,
  getGovernorateName,
  isValidDelegationForGovernorate,
  isValidGovernorate,
  normalizeTunisianPhone,
} from '../src/data/governorates';

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

async function run(): Promise<void> {
  // 1. Verify 24 governorates & complete unique delegations
  assertEq(TUNISIAN_GOVERNORATES.length, 24, 'Exactly 24 Tunisian governorates exist');
  const seenGovIds = new Set<string>();
  let totalDelegations = 0;

  for (const gov of TUNISIAN_GOVERNORATES) {
    assertTrue(!seenGovIds.has(gov.id), `Governorate ID ${gov.id} is unique`);
    seenGovIds.add(gov.id);
    assertTrue(isValidGovernorate(gov.id), `isValidGovernorate(${gov.id}) returns true`);
    assertTrue(gov.majorDelegations.length >= 5, `Governorate ${gov.id} has official delegations`);

    const delSet = new Set(gov.majorDelegations);
    assertEq(delSet.size, gov.majorDelegations.length, `Governorate ${gov.id} has no duplicate delegations`);
    totalDelegations += gov.majorDelegations.length;

    const fetched = getDelegationsForGovernorate(gov.id);
    assertEq(fetched.length, gov.majorDelegations.length, `getDelegationsForGovernorate(${gov.id}) matches`);
    assertTrue(
      isValidDelegationForGovernorate(gov.id, gov.majorDelegations[0]),
      `First delegation of ${gov.id} validates`
    );
  }
  assertTrue(totalDelegations >= 250, `All Tunisian official delegations populated (count=${totalDelegations})`);

  // Cross-governorate mismatch checks
  assertTrue(!isValidDelegationForGovernorate('tunis', 'صفاقس المدينة'), 'Sfax delegation rejected under Tunis');
  assertTrue(!isValidDelegationForGovernorate('sfax', 'المرسى'), 'Tunis delegation rejected under Sfax');
  assertTrue(!isValidDelegationForGovernorate('tunis', ''), 'Empty delegation rejected');
  assertTrue(!isValidGovernorate('unknown_gov'), 'Unknown governorate rejected');

  // Phone normalization checks
  const p1 = normalizeTunisianPhone('+216 21 511 162');
  assertTrue(p1.valid, '+216 21 511 162 is valid');
  assertEq(p1.normalized, '+216 21 511 162', 'Formatted normalized phone');
  const p2 = normalizeTunisianPhone('98443210');
  assertTrue(p2.valid && p2.localDigits === '98443210', '8-digit local number accepted');
  const p3 = normalizeTunisianPhone('0021655123456');
  assertTrue(p3.valid && p3.normalized === '+216 55 123 456', '00216 prefix normalized');
  const pAr = normalizeTunisianPhone('٢١٥١١١٦٢');
  assertTrue(pAr.valid && pAr.localDigits === '21511162', 'Arabic-Indic numerals supported');
  assertTrue(!normalizeTunisianPhone('12345').valid, 'Short phone rejected');
  assertTrue(!normalizeTunisianPhone('12345678').valid, 'Invalid Tunisian leading digit (1) rejected');

  // 2. Isolated Express Server Checkout Tests
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echox-checkout-test-'));
  let server: http.Server | null = null;
  const TEST_PIN = '842619';
  const TEST_CODE = '#CheckoutTest2026';

  try {
    process.env.ECHOX_DISABLE_LISTEN = '1';
    process.env.DATA_DIR = tmpDir;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    process.env.ECHOX_SECURITY_HMAC_SECRET = 'test_hmac_checkout_delegations_2026';

    const pinHash = await argon2.hash(TEST_PIN, { type: argon2.argon2id });
    const codeHash = await argon2.hash(TEST_CODE, { type: argon2.argon2id });
    fs.writeFileSync(
      path.join(tmpDir, 'central_security_config.json'),
      JSON.stringify({
        access_code_argon2: codeHash,
        pin_argon2: pinHash,
        updated_at: new Date().toISOString(),
        history: [],
      }),
      'utf-8'
    );

    const { app, ensureServerInitialized } = await import('../server');
    await ensureServerInitialized();

    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind ephemeral server port');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const storeRes = await fetch(`${baseUrl}/api/store/state`);
    const storeJson = (await storeRes.json()) as any;
    const prod = storeJson.products[0];
    const payCfgRes = await fetch(`${baseUrl}/api/payments/config`);
    const payCfg = (await payCfgRes.json()) as any;

    const baseItem = {
      productId: prod.id,
      productName: prod.name,
      quantity: 1,
      unitPrice: prod.price,
    };

    // Case A: Missing delegation rejected (400)
    const missingDelRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.61' },
      body: JSON.stringify({
        customerName: 'سامي بن سالم',
        customerPhone: '22123456',
        shippingAddress: {
          governorate: 'tunis',
          street: 'حي النصر شارع البيئة عدد 12',
        },
        paymentMethod: 'cod',
        items: [baseItem],
      }),
    });
    assertEq(missingDelRes.status, 400, 'Checkout without delegation rejected (400)');

    // Case B: Mismatched governorate & delegation rejected (400)
    const mismatchDelRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.62' },
      body: JSON.stringify({
        customerName: 'سامي بن سالم',
        customerPhone: '22123456',
        shippingAddress: {
          governorate: 'ariana',
          delegation: 'جربة ميدون',
          street: 'شارع فطومة بورقيبة عمارة 3',
        },
        paymentMethod: 'cod',
        items: [baseItem],
      }),
    });
    assertEq(mismatchDelRes.status, 400, 'Mismatched governorate + delegation rejected (400)');

    // Case C: Invalid Tunisian phone rejected (400)
    const badPhoneRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.63' },
      body: JSON.stringify({
        customerName: 'سامي بن سالم',
        customerPhone: '12345',
        shippingAddress: {
          governorate: 'sfax',
          delegation: 'ساقية الزيت',
          street: 'طريق تونس كلم 4',
        },
        paymentMethod: 'cod',
        items: [baseItem],
      }),
    });
    assertEq(badPhoneRes.status, 400, 'Invalid phone rejected (400)');

    // Case D: Valid checkout WITHOUT email and WITHOUT postalCode succeeds (200)
    // and stores governorate and delegation separately!
    const validRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.64' },
      body: JSON.stringify({
        customerName: 'أميرة الغربي',
        customerPhone: '55123456',
        // customerEmail intentionally omitted (optional)
        shippingAddress: {
          governorate: 'sfax',
          delegation: 'ساقية الزيت',
          street: 'حي الأنس نهج الزيتون منزل 14',
          // postalCode intentionally omitted
        },
        paymentMethod: 'cod',
        items: [baseItem],
      }),
    });
    assertEq(validRes.status, 200, 'Valid checkout without email & postalCode returns 200');
    const validData = (await validRes.json()) as any;
    assertTrue(validData.success === true, 'Checkout response success === true');
    const order = validData.order;
    assertEq(order.customerEmail, '', 'Empty optional email persisted safely as empty string');
    assertEq(order.customerPhone, '+216 55 123 456', 'Tunisian phone normalized cleanly');
    assertEq(order.shippingAddress.governorate, 'sfax', 'Governorate saved separately');
    assertEq(order.shippingAddress.delegation, 'ساقية الزيت', 'Delegation saved separately');
    assertEq(order.shippingAddress.city, 'ساقية الزيت', 'Legacy city alias synced with delegation');
    assertEq(order.shippingAddress.postalCode, undefined, 'No fake postalCode injected on new order');
    assertEq(order.shippingAddress.street, 'حي الأنس نهج الزيتون منزل 14', 'Detailed address saved');

    // Shipping fee rules preserved
    const expectedShipping =
      prod.price >= payCfg.freeShippingThreshold ? 0 : payCfg.standardShippingFee;
    assertEq(order.shippingFee, expectedShipping, 'Existing shipping fee rules preserved');
    assertEq(order.subtotal, prod.price, 'Subtotal matches product price');

    // Verify public tracking returns separate governorate & delegation
    const trackRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(order.trackingNumber)}`);
    assertEq(trackRes.status, 200, 'Public tracking returns 200 for new order');
    const trackJson = (await trackRes.json()) as any;
    assertEq(trackJson.order.shippingAddress.governorate, 'sfax', 'Tracked order exposes governorate');
    assertEq(trackJson.order.shippingAddress.delegation, 'ساقية الزيت', 'Tracked order exposes delegation');
    assertEq(getGovernorateName(trackJson.order.shippingAddress.governorate, 'ar'), 'صفاقس', 'Governorate name resolves');

    // Verify admin sees full order & notification includes governorate + delegation
    await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.1' },
      body: JSON.stringify({ code: TEST_CODE }),
    });
    const loginRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.1' },
      body: JSON.stringify({ pin: TEST_PIN }),
    });
    const loginJson = (await loginRes.json()) as any;
    const overviewRes = await fetch(`${baseUrl}/api/admin/payments/overview`, {
      headers: { Authorization: `Bearer ${loginJson.sessionToken}` },
    });
    assertEq(overviewRes.status, 200, 'Admin payments overview returns 200');
    const overviewJson = (await overviewRes.json()) as any;
    const savedInAdmin = overviewJson.orders.find((o: any) => o.trackingNumber === order.trackingNumber);
    assertTrue(Boolean(savedInAdmin), 'Order appears in admin orders list');
    assertEq(savedInAdmin.shippingAddress.delegation, 'ساقية الزيت', 'Admin sees separate delegation');

    // Legacy compatibility: existing seeded order without delegation still loads cleanly
    const legacySeedOrder = overviewJson.orders.find((o: any) => o.id === 'ord_101');
    if (legacySeedOrder) {
      assertEq(legacySeedOrder.shippingAddress.city, 'المرسى', 'Legacy order city preserved');
      assertEq(legacySeedOrder.shippingAddress.postalCode, '2070', 'Legacy order postalCode preserved');
    }

    console.log('✅ checkoutDelegations.test.ts PASSED (24 governorates, delegations, phone, server/DB/admin)');
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('❌ checkoutDelegations.test.ts FAILED:', err);
  process.exit(1);
});
