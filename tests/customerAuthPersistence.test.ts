/**
 * Phase 2 Automated Customer Auth, Account Security & Persistence Test Suite
 *
 * Covers all 17 mandatory Phase 2 scenarios using isolated temporary DATA_DIR storage.
 * Never touches production databases or live customer records.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawnSync } from 'child_process';
import argon2 from 'argon2';

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

function extractCookie(res: Response, name: string): string {
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[]; get(k: string): string | null };
  const rawList =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : [anyHeaders.get('set-cookie') || ''];
  for (const entry of rawList) {
    for (const part of String(entry || '').split(/,(?=\s*[^;]+=)/)) {
      const m = part.trim().match(new RegExp(`^(${name}=[^;]+)`));
      if (m) return m[1];
    }
  }
  return '';
}

async function run(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niapolor-cust-p2-'));
  let server: http.Server | null = null;
  let passed = 0;
  const pass = (label: string) => {
    passed += 1;
    console.log(`  [PASS ${passed}/17] ${label}`);
  };

  try {
    process.env.ECHOX_DISABLE_LISTEN = '1';
    process.env.DATA_DIR = tmpDir;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    process.env.ECHOX_SECURITY_HMAC_SECRET = 'phase2_isolated_hmac_secret_key_for_niapolor_testing_2026';

    const pinHash = await argon2.hash('739146', { type: argon2.argon2id });
    const accessHash = await argon2.hash('#Phase2Vault2026', { type: argon2.argon2id });
    fs.writeFileSync(
      path.join(tmpDir, 'central_security_config.json'),
      JSON.stringify({
        access_code_argon2: accessHash,
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
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind ephemeral port');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Storefront state to get valid productId for order/wishlist tests
    const storeRes = await fetch(`${baseUrl}/api/store/state`);
    assertEq(storeRes.status, 200, 'Store state loaded');
    const storeJson = (await storeRes.json()) as any;
    const firstProductId = storeJson.products?.[0]?.id;
    assertTrue(Boolean(firstProductId), 'Storefront contains at least 1 product');

    // =========================================================
    // 1. Successful customer registration
    // =========================================================
    const custAPass = 'Niapolor#2026A';
    const regARes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'Accept-Language': 'en',
        'x-forwarded-for': '198.51.100.11',
      },
      body: JSON.stringify({
        fullName: 'Amine Ben Ali',
        email: 'Amine.Test@Niapolor.tn',
        phone: '+216 22 444 555',
        password: custAPass,
        confirmPassword: custAPass,
        lang: 'en',
      }),
    });
    assertEq(regARes.status, 201, '1. Registration returns 201');
    const regAJson = (await regARes.json()) as any;
    assertEq(regAJson.success, true, '1. Registration success flag true');
    assertEq(regAJson.customer.email, 'amine.test@niapolor.tn', '1. Email normalized lowercase');
    assertEq(regAJson.customer.phone, '+216 22 444 555', '1. Tunisian phone normalized');
    assertEq(regAJson.customer.passwordHash, undefined, '1. Password hash never exposed');
    const custACookie = extractCookie(regARes, '__customer_session');
    assertTrue(custACookie.startsWith('__customer_session=cust1.'), '1. Signed session cookie issued');
    const custAId = regAJson.customer.id;
    pass('Successful customer registration');

    // =========================================================
    // 2. Duplicate email & duplicate phone registration rejection
    // =========================================================
    const dupEmailRes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': '198.51.100.12',
      },
      body: JSON.stringify({
        fullName: 'Duplicate Email User',
        email: '  AMINE.test@niapolor.tn ',
        phone: '98 111 222',
        password: 'AnotherStrong#Password1',
        lang: 'fr',
      }),
    });
    assertEq(dupEmailRes.status, 409, '2a. Normalized duplicate email rejected with 409');

    const dupPhoneRes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': '198.51.100.13',
      },
      body: JSON.stringify({
        fullName: 'Duplicate Phone User',
        email: 'other.person@niapolor.tn',
        phone: '22444555',
        password: 'AnotherStrong#Password2',
        lang: 'en',
      }),
    });
    assertEq(dupPhoneRes.status, 409, '2b. Duplicate Tunisian phone rejected with 409');
    pass('Duplicate email and phone registration rejection');

    // =========================================================
    // 3. Invalid email rejection
    // =========================================================
    const badEmailRes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': '198.51.100.14',
      },
      body: JSON.stringify({
        fullName: 'Bad Email User',
        email: 'not-an-email',
        phone: '55112233',
        password: 'StrongPassword#2026',
        lang: 'en',
      }),
    });
    assertEq(badEmailRes.status, 400, '3. Invalid email rejected with 400');
    pass('Invalid email rejection');

    // =========================================================
    // 4. Invalid phone rejection
    // =========================================================
    const badPhoneRes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': '198.51.100.15',
      },
      body: JSON.stringify({
        fullName: 'Bad Phone User',
        email: 'badphone@niapolor.tn',
        phone: '12345',
        password: 'StrongPassword#2026',
        lang: 'fr',
      }),
    });
    assertEq(badPhoneRes.status, 400, '4. Invalid Tunisian phone rejected with 400');
    pass('Invalid phone rejection');

    // =========================================================
    // 5. Weak password & mismatch rejection
    // =========================================================
    for (const weakPwd of ['1234567', '12345678', 'password', '        ', 'abcdefgh']) {
      const weakRes = await fetch(`${baseUrl}/api/customer/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'NIAPOLOR-Customer',
          'x-forwarded-for': '198.51.100.16',
        },
        body: JSON.stringify({
          fullName: 'Weak Password User',
          email: 'weak@niapolor.tn',
          phone: '29112233',
          password: weakPwd,
          lang: 'en',
        }),
      });
      assertEq(weakRes.status, 400, `5. Weak password "${weakPwd}" rejected with 400`);
    }
    const mismatchRes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': '198.51.100.16',
      },
      body: JSON.stringify({
        fullName: 'Mismatch User',
        email: 'mismatch@niapolor.tn',
        phone: '29112234',
        password: 'StrongPassword#1',
        confirmPassword: 'StrongPassword#2',
        lang: 'en',
      }),
    });
    assertEq(mismatchRes.status, 400, '5. Mismatched confirmPassword rejected with 400');
    pass('Weak password and mismatch rejection');

    // =========================================================
    // 6. Successful login
    // =========================================================
    const loginARes = await fetch(`${baseUrl}/api/customer/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': '198.51.100.17',
      },
      body: JSON.stringify({
        email: 'amine.test@niapolor.tn',
        password: custAPass,
        lang: 'en',
      }),
    });
    assertEq(loginARes.status, 200, '6. Customer A login returns 200');
    const loginAJson = (await loginARes.json()) as any;
    assertEq(loginAJson.success, true, '6. Login response success true');
    assertEq(loginAJson.customer.id, custAId, '6. Login returns matching customer ID');
    const loginACookie = extractCookie(loginARes, '__customer_session');
    assertTrue(loginACookie.startsWith('__customer_session=cust1.'), '6. Login refreshes session cookie');
    pass('Successful login');

    // =========================================================
    // 7. Incorrect password & unknown email rejection (non-enumerating)
    // =========================================================
    const wrongPwdRes = await fetch(`${baseUrl}/api/customer/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': '198.51.100.18',
      },
      body: JSON.stringify({
        email: 'amine.test@niapolor.tn',
        password: 'WrongPassword#999',
        lang: 'en',
      }),
    });
    assertEq(wrongPwdRes.status, 401, '7a. Wrong password returns 401');
    const wrongPwdJson = (await wrongPwdRes.json()) as any;

    const unknownEmailRes = await fetch(`${baseUrl}/api/customer/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': '198.51.100.19',
      },
      body: JSON.stringify({
        email: 'nobody.here@niapolor.tn',
        password: 'WrongPassword#999',
        lang: 'en',
      }),
    });
    assertEq(unknownEmailRes.status, 401, '7b. Unknown email returns 401');
    const unknownEmailJson = (await unknownEmailRes.json()) as any;
    assertEq(wrongPwdJson.error, unknownEmailJson.error, '7c. Login error message does not enumerate email existence');
    pass('Incorrect password rejection without email enumeration');

    // =========================================================
    // 8. Unauthenticated access rejection
    // =========================================================
    const unauthChecks = await Promise.all([
      fetch(`${baseUrl}/api/customer/me`),
      fetch(`${baseUrl}/api/customer/profile`),
      fetch(`${baseUrl}/api/customer/orders`),
      fetch(`${baseUrl}/api/customer/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'NIAPOLOR-Customer' },
        body: JSON.stringify({ governorate: 'tunis', delegation: 'المدينة', street: 'Rue de France', phone: '22112233' }),
      }),
      fetch(`${baseUrl}/api/customer/wishlist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'NIAPOLOR-Customer' },
        body: JSON.stringify({ wishlist: [firstProductId] }),
      }),
    ]);
    for (const r of unauthChecks) {
      assertEq(r.status, 401, `8. Unauthenticated request to ${r.url} rejected with 401`);
    }
    pass('Unauthenticated access rejection');

    // =========================================================
    // 9. Authenticated customer profile retrieval & updates
    // =========================================================
    const meRes = await fetch(`${baseUrl}/api/customer/me`, {
      headers: { Cookie: loginACookie },
    });
    assertEq(meRes.status, 200, '9. GET /api/customer/me returns 200');
    const meJson = (await meRes.json()) as any;
    assertEq(meJson.success, true, '9. GET /api/customer/me includes success: true');
    assertEq(meJson.authenticated, true, '9. GET /api/customer/me includes authenticated: true');
    assertEq(meJson.customer.id, custAId, '9. Correct customer profile returned');

    // Save address, wishlist & profile update for Customer A
    const addAddrARes = await fetch(`${baseUrl}/api/customer/addresses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        Cookie: loginACookie,
      },
      body: JSON.stringify({
        fullName: 'Amine Ben Ali',
        phone: '+21622444555',
        governorate: 'tunis',
        delegation: 'المدينة',
        street: '10 Avenue Habib Bourguiba',
        isDefault: true,
      }),
    });
    assertEq(addAddrARes.status, 200, '9. Customer A saves delivery address');
    const addrAId = ((await addAddrARes.json()) as any).customer.addresses[0].id;

    const wlRes = await fetch(`${baseUrl}/api/customer/wishlist`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        Cookie: loginACookie,
      },
      body: JSON.stringify({ wishlist: [firstProductId] }),
    });
    assertEq(wlRes.status, 200, '9. Customer A wishlist persisted on server');

    // Create order scoped to Customer A
    const checkoutARes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: loginACookie,
        'x-forwarded-for': '198.51.100.17',
      },
      body: JSON.stringify({
        customerId: 'spoofed_other_id',
        customerName: 'Amine Ben Ali',
        customerEmail: 'amine.test@niapolor.tn',
        customerPhone: '+216 22 444 555',
        shippingAddress: {
          fullName: 'Amine Ben Ali',
          phone: '+216 22 444 555',
          governorate: 'tunis',
          delegation: 'المدينة',
          street: '10 Avenue Habib Bourguiba',
        },
        items: [{ productId: firstProductId, quantity: 1 }],
        paymentMethod: 'cod',
      }),
    });
    assertEq(checkoutARes.status, 200, '9. Order created for Customer A');
    const orderAJson = (await checkoutARes.json()) as any;
    assertEq(orderAJson.order.customerId, custAId, '9. Server bound order to session customerId ignoring spoof');
    pass('Authenticated customer profile, address, wishlist & order retrieval');

    // =========================================================
    // 10. Customer A cannot access Customer B profile (IDOR check)
    // =========================================================
    const regBRes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': '198.51.100.20',
      },
      body: JSON.stringify({
        fullName: 'Salma Gharbi',
        email: 'salma.test@niapolor.tn',
        phone: '+216 55 666 777',
        password: 'SalmaStrong#2026',
      }),
    });
    assertEq(regBRes.status, 201, '10. Customer B registered');
    const custBId = ((await regBRes.json()) as any).customer.id;
    const custBCookie = extractCookie(regBRes, '__customer_session');

    const idorMeRes = await fetch(`${baseUrl}/api/customer/me?customerId=${encodeURIComponent(custBId)}`, {
      headers: { Cookie: loginACookie },
    });
    assertEq(idorMeRes.status, 403, '10a. IDOR ?customerId on /me blocked with 403');

    const idorProfilePatch = await fetch(`${baseUrl}/api/customer/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        Cookie: loginACookie,
      },
      body: JSON.stringify({ customerId: custBId, fullName: 'Tampered Name' }),
    });
    assertEq(idorProfilePatch.status, 403, '10b. IDOR body customerId on PATCH /profile blocked with 403');
    pass('Customer A cannot access or mutate Customer B profile (IDOR check)');

    // =========================================================
    // 11. Customer A cannot access Customer B orders or addresses (and vice versa)
    // =========================================================
    const bOrdersRes = await fetch(`${baseUrl}/api/customer/orders`, {
      headers: { Cookie: custBCookie },
    });
    assertEq(bOrdersRes.status, 200, '11a. Customer B orders endpoint returns 200');
    const bOrdersJson = (await bOrdersRes.json()) as any;
    assertEq(bOrdersJson.orders.length, 0, '11a. Customer B sees zero of Customer A orders');

    const bOrdersSpoofRes = await fetch(
      `${baseUrl}/api/customer/orders?customerId=${encodeURIComponent(custAId)}`,
      { headers: { Cookie: custBCookie } }
    );
    assertEq(bOrdersSpoofRes.status, 403, '11b. IDOR ?customerId on /orders rejected with 403');

    const bDeleteAAddr = await fetch(`${baseUrl}/api/customer/addresses/${encodeURIComponent(addrAId)}`, {
      method: 'DELETE',
      headers: { 'X-Requested-With': 'NIAPOLOR-Customer', Cookie: custBCookie },
    });
    assertEq(bDeleteAAddr.status, 404, '11c. Customer B cannot delete Customer A address (404 scoped)');

    const bMeAfter = await fetch(`${baseUrl}/api/customer/me`, {
      headers: { Cookie: custBCookie },
    });
    const bMeJson = (await bMeAfter.json()) as any;
    assertEq(bMeJson.customer.addresses.length, 0, '11d. Customer B sees none of Customer A addresses');
    pass('Cross-customer isolation for orders and addresses');

    // =========================================================
    // 12. Successful logout and server-side session revocation
    // =========================================================
    const logoutRes = await fetch(`${baseUrl}/api/customer/logout`, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'NIAPOLOR-Customer',
        Cookie: loginACookie,
      },
    });
    assertEq(logoutRes.status, 200, '12a. POST /api/customer/logout returns 200');
    const replayMeRes = await fetch(`${baseUrl}/api/customer/me`, {
      headers: { Cookie: loginACookie },
    });
    assertEq(replayMeRes.status, 401, '12b. Replaying revoked session cookie returns 401');
    const replayAddrRes = await fetch(`${baseUrl}/api/customer/addresses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        Cookie: loginACookie,
      },
      body: JSON.stringify({
        fullName: 'Revoked',
        phone: '+21622444555',
        governorate: 'tunis',
        delegation: 'المدينة',
        street: '10 Rue Revoked',
      }),
    });
    assertEq(replayAddrRes.status, 401, '12c. Revoked cookie rejected on mutations (401)');
    pass('Successful logout and server-side session revocation');

    // =========================================================
    // 13. Session restoration after page refresh (fresh valid cookie)
    // =========================================================
    const freshLoginARes = await fetch(`${baseUrl}/api/customer/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': '198.51.100.21',
      },
      body: JSON.stringify({ email: 'amine.test@niapolor.tn', password: custAPass }),
    });
    assertEq(freshLoginARes.status, 200, '13a. Re-login returns 200');
    const freshCookieA = extractCookie(freshLoginARes, '__customer_session');

    const restoreMeRes = await fetch(`${baseUrl}/api/customer/me`, {
      headers: { Cookie: freshCookieA },
    });
    assertEq(restoreMeRes.status, 200, '13b. Refresh GET /api/customer/me restores session (200)');
    const restoreJson = (await restoreMeRes.json()) as any;
    assertEq(restoreJson.success, true, '13c. Response contains success: true for StoreContext restoration');
    assertEq(restoreJson.authenticated, true, '13d. Response contains authenticated: true');
    assertEq(restoreJson.customer.addresses.length, 1, '13e. Restored customer retains saved addresses');
    assertEq(restoreJson.customer.wishlist[0], firstProductId, '13f. Restored customer retains wishlist');
    pass('Session restoration after page refresh');

    // =========================================================
    // 14. Customer data persistence across simulated server restart
    // =========================================================
    // Close active server and run a fresh Node process pointed at the same tmpDir
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;

    const restartScript = `
      process.env.ECHOX_DISABLE_LISTEN = '1';
      process.env.DATA_DIR = ${JSON.stringify(tmpDir)};
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
      process.env.UPSTASH_REDIS_REST_URL = '';
      process.env.UPSTASH_REDIS_REST_TOKEN = '';
      process.env.ECHOX_SECURITY_HMAC_SECRET = 'phase2_isolated_hmac_secret_key_for_niapolor_testing_2026';
      (async () => {
        const { app, ensureServerInitialized } = await import('./server');
        await ensureServerInitialized();
        const http = await import('http');
        const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
        const port = srv.address().port;
        const me = await fetch('http://127.0.0.1:' + port + '/api/customer/me', {
          headers: { Cookie: ${JSON.stringify(freshCookieA)} }
        });
        if (me.status !== 200) throw new Error('Expected 200 on restart /me, got ' + me.status);
        const meJson = await me.json();
        if (meJson.customer.email !== 'amine.test@niapolor.tn' || meJson.customer.addresses.length !== 1) {
          throw new Error('Customer data mismatch after restart');
        }
        const revokedOld = await fetch('http://127.0.0.1:' + port + '/api/customer/me', {
          headers: { Cookie: ${JSON.stringify(loginACookie)} }
        });
        if (revokedOld.status !== 401) {
          throw new Error('Revoked session must stay revoked across restart, got ' + revokedOld.status);
        }
        srv.close();
        process.exit(0);
      })().catch((e) => { console.error(e); process.exit(1); });
    `;
    const restartRun = spawnSync('npx', ['tsx', '--eval', restartScript], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 30000,
    });
    assertEq(restartRun.status, 0, `14. Simulated restart verification failed: ${restartRun.stderr || restartRun.stdout}`);
    pass('Customer data and revoked sessions persist across simulated server restart');

    // Re-bind fresh server for remaining live tests (15-17)
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr2 = server.address();
    if (!addr2 || typeof addr2 === 'string') throw new Error('Failed to rebind port');
    const baseUrl2 = `http://127.0.0.1:${addr2.port}`;

    // =========================================================
    // 15. Database failure handling (fail closed, no fake success)
    // =========================================================
    const ephemeralTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'niapolor-ephemeral-'));
    const failScript = `
      process.env.NODE_ENV = 'production';
      process.env.RENDER = 'true';
      process.env.ECHOX_DISABLE_LISTEN = '1';
      delete process.env.DATA_DIR;
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
      process.env.UPSTASH_REDIS_REST_URL = '';
      process.env.UPSTASH_REDIS_REST_TOKEN = '';
      process.env.ECHOX_SECURITY_HMAC_SECRET = 'phase2_isolated_hmac_secret_key_for_niapolor_testing_2026';
      (async () => {
        const { registerCustomerAccount, authenticateCustomerAccount } = await import('./server/customerEngine');
        const res = await registerCustomerAccount({
          fullName: 'Fail Closed User',
          email: 'failclosed@niapolor.tn',
          phone: '22999888',
          password: 'ValidPassword#1',
          lang: 'en',
        });
        if (res.ok || res.statusCode !== 503) {
          throw new Error('Expected 503 fail-closed when DB unavailable in production, got: ' + JSON.stringify(res));
        }
        const loginCheck = await authenticateCustomerAccount({
          email: 'failclosed@niapolor.tn',
          password: 'ValidPassword#1',
          lang: 'en',
        });
        if (loginCheck.ok) {
          throw new Error('Failed write leaked customer record into memory!');
        }
        process.exit(0);
      })().catch((e) => { console.error(e); process.exit(1); });
    `;
    const failRun = spawnSync('npx', ['tsx', '--eval', failScript], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 30000,
    });
    fs.rmSync(ephemeralTmp, { recursive: true, force: true });
    assertEq(failRun.status, 0, `15. Database failure test failed: ${failRun.stderr || failRun.stdout}`);
    pass('Database failure fails closed (503) with zero memory leak');

    // =========================================================
    // 16. Duplicate submission / concurrent registration protection
    // =========================================================
    const raceRequests = Array.from({ length: 4 }, (_, idx) =>
      fetch(`${baseUrl2}/api/customer/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'NIAPOLOR-Customer',
          'x-forwarded-for': `198.51.100.${50 + idx}`,
        },
        body: JSON.stringify({
          fullName: 'Race Test User',
          email: 'race.user@niapolor.tn',
          phone: '+216 24 888 999',
          password: 'RaceStrong#2026',
        }),
      })
    );
    const raceResponses = await Promise.all(raceRequests);
    const createdCount = raceResponses.filter((r) => r.status === 201).length;
    const conflictCount = raceResponses.filter((r) => r.status === 409).length;
    assertEq(createdCount, 1, '16a. Exactly ONE concurrent registration succeeds (201)');
    assertEq(conflictCount, 3, '16b. Remaining concurrent duplicate registrations rejected (409)');
    pass('Concurrent duplicate registration race protection');

    // =========================================================
    // 17. CSRF protection
    // =========================================================
    const missingXrw = await fetch(`${baseUrl2}/api/customer/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'CSRF Attacker',
        email: 'csrf@evil.test',
        phone: '20112233',
        password: 'ValidPassword#1',
      }),
    });
    assertEq(missingXrw.status, 403, '17a. Missing X-Requested-With header rejected with 403');

    const badOrigin = await fetch(`${baseUrl2}/api/customer/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        Origin: 'https://evil-phishing-site.example',
      },
      body: JSON.stringify({ email: 'amine.test@niapolor.tn', password: custAPass }),
    });
    assertEq(badOrigin.status, 403, '17b. Disallowed Origin rejected with 403');

    const badReferer = await fetch(`${baseUrl2}/api/customer/logout`, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'NIAPOLOR-Customer',
        Referer: 'https://evil-phishing-site.example/form.html',
        Cookie: freshCookieA,
      },
    });
    assertEq(badReferer.status, 403, '17c. Disallowed Referer rejected with 403');
    pass('CSRF protection (X-Requested-With, Origin, Referer)');

    console.log(`\nALL ${passed}/17 PHASE 2 CUSTOMER AUTH & PERSISTENCE TESTS PASSED.`);
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('Phase 2 test suite failed:', err);
  process.exit(1);
});
