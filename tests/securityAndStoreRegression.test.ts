/**
 * Isolated Integration & Security Regression Suite for ECHOX STORE + Secret Control Room
 *
 * Runs against an ephemeral in-process Express server bound to 127.0.0.1:0 with a
 * temporary DATA_DIR and synthetic Argon2id credentials. Never touches production
 * databases, files, or external payment gateways.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import argon2 from 'argon2';
import http from 'http';

const TEST_PIN = '739146';
const TEST_ACCESS_CODE = '#TestVault2026';

const VALID_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const FAKE_PNG_TEXT_BASE64 = 'data:image/png;base64,SGVsbG8td29ybGQ='; // "Hello-world"
const SVG_DATA_URI = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=';

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echox-sec-test-'));
  let server: http.Server | null = null;

  try {
    // Isolate DATA_DIR and disable cloud writes & automatic listening before importing server.ts
    process.env.ECHOX_DISABLE_LISTEN = '1';
    process.env.DATA_DIR = tmpDir;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    process.env.ECHOX_SECURITY_HMAC_SECRET = 'test_hmac_secret_echox_store_control_room_2026';

    const pinHash = await argon2.hash(TEST_PIN, { type: argon2.argon2id });
    const accessHash = await argon2.hash(TEST_ACCESS_CODE, { type: argon2.argon2id });
    fs.writeFileSync(
      path.join(tmpDir, 'central_security_config.json'),
      JSON.stringify({
        access_code_argon2: accessHash,
        pin_argon2: pinHash,
        updated_at: new Date().toISOString(),
        history: [{ type: 'TEST_SEED', timestamp: new Date().toISOString() }],
      }),
      'utf-8'
    );

    const { app, ensureServerInitialized } = await import('../server');
    await ensureServerInitialized();

    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral localhost port');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // =========================================================
    // 1. Storefront & Security Headers Check
    // =========================================================
    const storeRes = await fetch(`${baseUrl}/api/store/state`);
    assertEq(storeRes.status, 200, 'GET /api/store/state returns 200');
    const cspHeader = storeRes.headers.get('content-security-policy') || '';
    const nosniffHeader = storeRes.headers.get('x-content-type-options') || '';
    assertTrue(cspHeader.includes("default-src 'self'"), 'CSP header present');
    assertTrue(cspHeader.includes('frame-ancestors'), 'CSP frame-ancestors policy present');
    assertEq(nosniffHeader, 'nosniff', 'X-Content-Type-Options header is nosniff');
    const storeData = (await storeRes.json()) as any;
    assertTrue(storeData.success === true, 'store state success === true');
    assertTrue(Array.isArray(storeData.products) && storeData.products.length > 0, 'storefront has products');

    // Preview vs Production framing policy parity
    const previewHdrRes = await fetch(`${baseUrl}/api/store/state`, {
      headers: { 'x-forwarded-host': 'ais-dev-preview.europe-west2.run.app' },
    });
    assertEq(previewHdrRes.headers.get('x-frame-options'), null, 'Preview proxy omits X-Frame-Options for AI Studio iframe');
    assertTrue(
      (previewHdrRes.headers.get('content-security-policy') || '').includes('https://aistudio.google.com'),
      'Preview proxy allows https://aistudio.google.com frame-ancestors'
    );

    const prodHdrRes = await fetch(`${baseUrl}/api/store/state`, {
      headers: { 'x-forwarded-host': 'echox-store.onrender.com' },
    });
    assertEq(prodHdrRes.headers.get('x-frame-options'), 'SAMEORIGIN', 'Production host enforces X-Frame-Options: SAMEORIGIN');
    assertTrue(
      (prodHdrRes.headers.get('content-security-policy') || '').endsWith("frame-ancestors 'self'"),
      'Production host enforces strict frame-ancestors self'
    );

    // Adversarial header spoofing tests (raw http.request so Host header is respected)
    const rawHttpGet = (headers: Record<string, string>) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: addr.port, path: '/api/store/state', method: 'GET', headers },
          (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers }));
          }
        );
        req.on('error', reject);
        req.end();
      });

    // 1a. Substring spoof domain evil.run.app.attacker.com must NOT get preview framing
    const evilSubdomainRes = await rawHttpGet({ Host: 'evil.run.app.attacker.com' });
    assertEq(evilSubdomainRes.headers['x-frame-options'], 'SAMEORIGIN', 'evil.run.app.attacker.com blocked from preview framing');
    assertTrue(
      String(evilSubdomainRes.headers['content-security-policy'] || '').endsWith("frame-ancestors 'self'"),
      'evil.run.app.attacker.com restricted to frame-ancestors self'
    );

    // 1b. Production Host with forged X-Forwarded-Host + forged Referer + forged Origin MUST keep SAMEORIGIN
    const prodSpoofRes = await rawHttpGet({
      Host: 'echox-store.onrender.com',
      'X-Forwarded-Host': 'ais-dev-fake.europe-west2.run.app',
      Referer: 'https://evil.com/?aistudio.google.com',
      Origin: 'https://evil.com/?aistudio.google.com',
    });
    assertEq(prodSpoofRes.headers['x-frame-options'], 'SAMEORIGIN', 'Forged X-Forwarded-Host/Referer/Origin cannot disable X-Frame-Options on production');
    assertTrue(
      String(prodSpoofRes.headers['content-security-policy'] || '').endsWith("frame-ancestors 'self'"),
      'Forged preview headers cannot widen CSP frame-ancestors on production'
    );

    // 1c. Verify SameSite=Lax on production vs SameSite=None on verified HTTPS preview login cookie
    const prodAcRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.11' },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    const prodAcJson = (await prodAcRes.json()) as any;
    const prodLoginRaw = await new Promise<{ headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const body = JSON.stringify({ pin: TEST_PIN, gateToken: prodAcJson.gateToken });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path: '/api/security/verifyPin',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Host: 'echox-store.onrender.com',
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-Host': 'ais-dev-fake.europe-west2.run.app',
            'X-Forwarded-For': '198.51.100.11',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ headers: res.headers }));
        }
      );
      req.on('error', reject);
      req.end(body);
    });
    const prodSetCookies = (prodLoginRaw.headers['set-cookie'] || []).join(' | ');
    assertTrue(prodSetCookies.includes('SameSite=Lax'), 'Production session cookie uses SameSite=Lax despite forged X-Forwarded-Host');
    assertTrue(!prodSetCookies.includes('SameSite=None'), 'Production session cookie never downgrades to SameSite=None');

    const payCfgRes = await fetch(`${baseUrl}/api/payments/config`);
    assertEq(payCfgRes.status, 200, 'GET /api/payments/config returns 200');

    // =========================================================
    // 2. Legacy Session Bypass Blocked & Vendor Financials Protected
    // =========================================================
    const legacyRes = await fetch(`${baseUrl}/api/createOwnerSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'attacker@example.com' }),
    });
    assertEq(legacyRes.status, 403, 'POST /api/createOwnerSession must return 403');

    const unauthVendorRes = await fetch(`${baseUrl}/api/vendor/comp_echox/financials`);
    assertEq(unauthVendorRes.status, 401, 'GET /api/vendor/:id/financials requires admin session (401)');

    // =========================================================
    // 3. Access Code + PIN Auth, CSRF & Progressive Brute-Force Lockout
    // =========================================================
    const acRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    assertEq(acRes.status, 200, 'Valid access code accepted');
    const acJson = (await acRes.json()) as any;

    // Acquire gateToken for isolated brute-force IP and verify progressive lockout
    const bfAcRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.55' },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    const bfAcJson = (await bfAcRes.json()) as any;

    for (let i = 0; i < 4; i++) {
      const badPin = await fetch(`${baseUrl}/api/security/verifyPin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.55' },
        body: JSON.stringify({ pin: '000000', gateToken: bfAcJson.gateToken }),
      });
      assertEq(badPin.status, 401, `Wrong PIN attempt #${i + 1} returns 401`);
    }
    const lockedPinRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.55' },
      body: JSON.stringify({ pin: '000000', gateToken: bfAcJson.gateToken }),
    });
    assertEq(lockedPinRes.status, 429, '5th wrong PIN triggers brute-force lockout (429)');

    // Login cleanly from admin IP using its single-use gateToken
    const loginRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
      body: JSON.stringify({ pin: TEST_PIN, gateToken: acJson.gateToken }),
    });
    assertEq(loginRes.status, 200, 'Valid PIN returns 200');
    const loginJson = (await loginRes.json()) as any;
    assertTrue(loginJson.success === true, 'PIN verification success === true');
    assertTrue(typeof loginJson.sessionToken === 'string' && loginJson.sessionToken.startsWith('v2.'), 'v2 signed session token returned');
    assertTrue(typeof loginJson.csrfToken === 'string' && loginJson.csrfToken.startsWith('csrf1.'), 'HMAC CSRF token returned');

    const adminToken: string = loginJson.sessionToken;
    const csrfToken: string = loginJson.csrfToken;

    // CSRF rejection test (missing CSRF token on mutating admin route)
    const noCsrfRes = await fetch(`${baseUrl}/api/admin/security/backup/dry-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ bundle: {} }),
    });
    assertEq(noCsrfRes.status, 403, 'Mutating admin route without X-CSRF-Token returns 403');

    // Foreign Origin rejection test
    const badOriginRes = await fetch(`${baseUrl}/api/admin/security/backup/dry-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
        Origin: 'https://evil-attacker.invalid',
      },
      body: JSON.stringify({ bundle: {} }),
    });
    assertEq(badOriginRes.status, 403, 'Mutating admin route with untrusted Origin returns 403');

    // Scoped Vendor Financials allowed for authenticated admin
    const authVendorRes = await fetch(`${baseUrl}/api/vendor/comp_echox/financials`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertEq(authVendorRes.status, 200, 'Authenticated owner can read vendor financials (200)');

    // =========================================================
    // 4. Checkout Price Integrity, Order Tracking PII Stripping & Magic Bytes + Quarantine
    // =========================================================
    const firstProd = storeData.products[0];

    // First verify tampered unitPrice is explicitly rejected (400)
    const tamperedCheckoutRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.20' },
      body: JSON.stringify({
        customerName: 'عميل اختبار',
        customerPhone: '22123456',
        customerEmail: 'secret-customer@example.com',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الحبيب بورقيبة', notes: 'ملاحظة خاصة بالباب' },
        paymentMethod: 'cod',
        items: [
          {
            productId: firstProd.id,
            productName: firstProd.name?.ar || firstProd.id,
            quantity: 1,
            unitPrice: 0.01,
          },
        ],
      }),
    });
    assertEq(tamperedCheckoutRes.status, 400, 'Tampered client unitPrice rejected by server price authority (400)');

    // Legitimate checkout without tampered price
    const checkoutRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.21' },
      body: JSON.stringify({
        customerName: 'عميل اختبار',
        customerPhone: '22123456',
        customerEmail: 'secret-customer@example.com',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الحبيب بورقيبة', notes: 'ملاحظة خاصة بالباب' },
        notes: 'ملاحظة طلب داخلية',
        paymentMethod: 'cod',
        items: [
          {
            productId: firstProd.id,
            productName: firstProd.name?.ar || firstProd.id,
            quantity: 1,
            unitPrice: firstProd.price,
          },
        ],
      }),
    });
    assertEq(checkoutRes.status, 200, 'Server checkout accepts valid order and computes authoritative total');
    const checkoutData = (await checkoutRes.json()) as any;
    const trackingCode: string = checkoutData.order.trackingNumber;
    assertTrue(checkoutData.order.items[0].unitPrice === firstProd.price, 'Server enforced authoritative product unitPrice');

    // Tracking code shorter than 6 chars rejected
    const shortTrackRes = await fetch(`${baseUrl}/api/payments/track/ABC`);
    assertEq(shortTrackRes.status, 400, 'Tracking code shorter than 6 chars returns 400');

    // Public visitor tracking masks PII (customerEmail, notes, customerName, customerPhone, street, transferProof)
    const publicTrackRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(trackingCode)}`);
    assertEq(publicTrackRes.status, 200, 'Public order tracking returns 200');
    const publicTrackJson = (await publicTrackRes.json()) as any;
    assertEq(publicTrackJson.order.piiMasked, true, 'Anonymous tracking marks piiMasked: true');
    assertEq(publicTrackJson.order.customerEmail, '', 'Anonymous tracking strips customerEmail');
    assertEq(publicTrackJson.order.notes, '', 'Anonymous tracking strips internal notes');
    assertEq(publicTrackJson.order.shippingAddress.street, '***', 'Anonymous tracking masks street address');
    assertTrue(publicTrackJson.order.customerPhone !== '22123456' && publicTrackJson.order.customerPhone.includes('*'), 'Anonymous tracking masks customerPhone');

    // Phone proof reveals non-sensitive recipient delivery fields while keeping notes/email private
    const phoneTrackRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(trackingCode)}?phone=22123456`);
    const phoneTrackJson = (await phoneTrackRes.json()) as any;
    assertEq(phoneTrackJson.order.piiMasked, false, 'Phone proof unmasks order tracking details');
    assertEq(phoneTrackJson.order.shippingAddress.street, 'شارع الحبيب بورقيبة', 'Phone proof reveals street');

    // Authenticated owner sees full order on track endpoint
    const adminTrackRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(trackingCode)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminTrackJson = (await adminTrackRes.json()) as any;
    assertEq(adminTrackJson.order.customerEmail, 'secret-customer@example.com', 'Owner sees unmasked order email');

    // Buyer validation errors: invalid Tunisian phone & mismatched delegation
    const badPhoneCheckoutRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.23' },
      body: JSON.stringify({
        customerName: 'مشتري تونسي',
        customerPhone: '12345',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الحرية' },
        paymentMethod: 'cod',
        items: [{ productId: firstProd.id, productName: firstProd.name?.ar || firstProd.id, quantity: 1, unitPrice: firstProd.price }],
      }),
    });
    assertEq(badPhoneCheckoutRes.status, 400, 'Invalid Tunisian phone rejected (400)');

    const badDelCheckoutRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.24' },
      body: JSON.stringify({
        customerName: 'مشتري تونسي',
        customerPhone: '55123456',
        shippingAddress: { governorate: 'sfax', delegation: 'غير_موجودة', street: 'طريق تنيور' },
        paymentMethod: 'cod',
        items: [{ productId: firstProd.id, productName: firstProd.name?.ar || firstProd.id, quantity: 1, unitPrice: firstProd.price }],
      }),
    });
    assertEq(badDelCheckoutRes.status, 400, 'Unknown delegation for governorate rejected (400)');

    // Valid buyer checkout WITHOUT email (optional email) across Sfax + Sfax Ville
    const noEmailCheckoutRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.25' },
      body: JSON.stringify({
        customerName: 'أحمد الصفاقسي',
        customerPhone: '+216 55 123 456',
        shippingAddress: { governorate: 'sfax', delegation: 'صفاقس المدينة', street: 'طريق قرمدة كم 3' },
        paymentMethod: 'cod',
        items: [{ productId: firstProd.id, productName: firstProd.name?.ar || firstProd.id, quantity: 1, unitPrice: firstProd.price }],
      }),
    });
    assertEq(noEmailCheckoutRes.status, 200, 'Checkout succeeds with optional empty email and normalized +216 phone');
    const noEmailTracking: string = ((await noEmailCheckoutRes.json()) as any).order.trackingNumber;

    // Customer refund/cancel request flow: wrong phone blocked (403), matching phone succeeds (200)
    const badRefundReqRes = await fetch(`${baseUrl}/api/payments/request-refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.25' },
      body: JSON.stringify({
        trackingNumber: noEmailTracking,
        customerPhone: '99887766',
        reason: 'محاولة إلغاء برقم مختلف',
      }),
    });
    assertEq(badRefundReqRes.status, 403, 'Customer refund/cancel request with mismatched phone blocked (403)');

    const refundReqRes = await fetch(`${baseUrl}/api/payments/request-refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.25' },
      body: JSON.stringify({
        trackingNumber: noEmailTracking,
        customerPhone: '55123456',
        reason: 'تغيير العنوان قبل الشحن',
      }),
    });
    assertEq(refundReqRes.status, 200, 'Customer refund/cancel request succeeds with matching phone (200)');

    // Phone-ownership check blocks spoofed submission when phone doesn't match (403)
    const phoneMismatchRes = await fetch(`${baseUrl}/api/payments/bank-transfer/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.30' },
      body: JSON.stringify({
        trackingNumber: trackingCode,
        customerPhone: '99999999',
        referenceNumber: 'REF-MISMATCH',
        senderName: 'Attacker',
        receiptImageDataUrl: VALID_PNG_BASE64,
      }),
    });
    assertEq(phoneMismatchRes.status, 403, 'Proof submission with mismatched customerPhone blocked (403)');

    // Create a bank_transfer order to test real receipt uploads
    const bankCheckoutRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.22' },
      body: JSON.stringify({
        customerName: 'عميل تحويل',
        customerPhone: '22123456',
        customerEmail: 'bank-buyer@example.com',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'نهج المقاومة' },
        paymentMethod: 'bank_transfer',
        items: [
          {
            productId: firstProd.id,
            productName: firstProd.name?.ar || firstProd.id,
            quantity: 1,
            unitPrice: firstProd.price,
          },
        ],
      }),
    });
    assertEq(bankCheckoutRes.status, 200, 'Bank transfer order created (200)');
    const bankOrderTracking: string = ((await bankCheckoutRes.json()) as any).order.trackingNumber;

    // Receipt upload: spoofed PNG ("Hello-world") & SVG polyglot rejected and quarantined
    const spoofProofRes = await fetch(`${baseUrl}/api/payments/bank-transfer/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.30' },
      body: JSON.stringify({
        trackingNumber: bankOrderTracking,
        customerPhone: '22123456',
        referenceNumber: 'REF-SPOOF-1',
        senderName: 'Spoofer',
        receiptImageDataUrl: FAKE_PNG_TEXT_BASE64,
      }),
    });
    assertEq(spoofProofRes.status, 400, 'Spoofed PNG Magic Bytes proof rejected (400)');

    const svgProofRes = await fetch(`${baseUrl}/api/payments/bank-transfer/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.31' },
      body: JSON.stringify({
        trackingNumber: bankOrderTracking,
        customerPhone: '22123456',
        referenceNumber: 'REF-SVG-1',
        senderName: 'XSS Tester',
        receiptImageDataUrl: SVG_DATA_URI,
      }),
    });
    assertEq(svgProofRes.status, 400, 'SVG proof rejected (400)');

    // Valid PNG passes magic-byte validator and succeeds (200)
    const validProofRes = await fetch(`${baseUrl}/api/payments/bank-transfer/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.32' },
      body: JSON.stringify({
        trackingNumber: bankOrderTracking,
        customerPhone: '22123456',
        referenceNumber: 'REF-VALID-1',
        senderName: 'Valid Buyer',
        receiptImageDataUrl: VALID_PNG_BASE64,
      }),
    });
    assertEq(validProofRes.status, 200, 'Valid PNG passes Magic Bytes validator (200)');

    // Check Quarantine Vault contains both blocked artifacts and supports inspect + purge
    const quarRes = await fetch(`${baseUrl}/api/admin/security/quarantine`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertEq(quarRes.status, 200, 'Quarantine Vault endpoint returns 200');
    const quarJson = (await quarRes.json()) as any;
    assertTrue(quarJson.activeCount >= 2, `Quarantine Vault captured blocked spoof/SVG attempts (found ${quarJson.activeCount})`);

    const firstQuarId = quarJson.items[0].id;
    const purgeRes = await fetch(`${baseUrl}/api/admin/security/quarantine/${encodeURIComponent(firstQuarId)}/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ action: 'purge' }),
    });
    assertEq(purgeRes.status, 200, 'Quarantine purge succeeds');

    // =========================================================
    // 5. Secret Control Room: Integrity, Signed Backup, Dry-Run, Restore & Rollback
    // =========================================================
    const integrityRes = await fetch(`${baseUrl}/api/admin/security/integrity`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertEq(integrityRes.status, 200, 'Integrity audit returns 200');
    const integrityJson = (await integrityRes.json()) as any;
    assertTrue(integrityJson.report.auditChain.intact === true, 'Integrity reports intact audit chain');
    assertTrue(
      integrityJson.report.checks.some((c: any) => c.id === 'orders_financial_integrity' && c.passed === true),
      'Integrity includes passing orders_financial_integrity check'
    );
    assertTrue(
      integrityJson.report.checks.some((c: any) => c.id === 'self_protection_guards' && c.passed === true),
      'Integrity includes passing self_protection_guards check'
    );

    // Pre-write Self-Protection: reject and quarantine unsafe product media & negative prices
    const unsafeProductPayload = storeData.products.map((p: any, idx: number) =>
      idx === 0 ? { ...p, images: [SVG_DATA_URI] } : p
    );
    const unsafeStoreRes = await fetch(`${baseUrl}/api/admin/store/state`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ products: unsafeProductPayload }),
    });
    assertEq(unsafeStoreRes.status, 400, 'PUT /api/admin/store/state blocks SVG data URI media (400)');

    const quarAfterStoreRes = await fetch(`${baseUrl}/api/admin/security/quarantine`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const quarAfterStoreJson = (await quarAfterStoreRes.json()) as any;
    assertTrue(
      quarAfterStoreJson.items.some((i: any) => i.source === 'admin_store_product_media'),
      'Blocked admin store media automatically quarantined'
    );

    const negPricePayload = storeData.products.map((p: any, idx: number) =>
      idx === 0 ? { ...p, price: -5 } : p
    );
    const negPriceRes = await fetch(`${baseUrl}/api/admin/store/state`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ products: negPricePayload }),
    });
    assertEq(negPriceRes.status, 400, 'PUT /api/admin/store/state rejects negative product price (400)');

    // Step-Up PIN required when creating signed snapshot
    const noPinBackupRes = await fetch(`${baseUrl}/api/admin/security/backup/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ label: 'No PIN Snapshot' }),
    });
    assertEq(noPinBackupRes.status, 403, 'Create signed backup requires Step-Up PIN (403)');

    // Create valid HMAC signed snapshot
    const createSnapRes = await fetch(`${baseUrl}/api/admin/security/backup/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ confirmPin: TEST_PIN, label: 'Baseline Signed Snapshot' }),
    });
    assertEq(createSnapRes.status, 200, 'Signed backup created with Step-Up PIN');
    const createSnapJson = (await createSnapRes.json()) as any;
    const baselineSnapId: string = createSnapJson.snapshot.snapshotId;
    const originalFirstTitle = storeData.products[0].name.ar;

    // Mutate live storefront state (change first product's Arabic title)
    const mutatedProducts = storeData.products.map((p: any, idx: number) =>
      idx === 0 ? { ...p, name: { ...p.name, ar: 'منتج معدل للاختبار' } } : p
    );
    const mutateRes = await fetch(`${baseUrl}/api/admin/store/state`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ products: mutatedProducts }),
    });
    assertEq(mutateRes.status, 200, 'Live storefront state mutated');

    // Run Dry-Run against baseline snapshot — should detect 1 updated product
    const dryRunRes = await fetch(`${baseUrl}/api/admin/security/backup/dry-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ snapshotId: baselineSnapId }),
    });
    assertEq(dryRunRes.status, 200, 'Dry-run succeeds (200)');
    const dryRunJson = (await dryRunRes.json()) as any;
    assertTrue(dryRunJson.dryRun.validToApply === true, 'Dry-run validates snapshot');
    assertTrue(dryRunJson.dryRun.signatureValid === true, 'Dry-run verifies HMAC signature');
    const prodDiff = dryRunJson.dryRun.diff.products;
    assertEq(prodDiff.updated, 1, 'Dry-run detects exact 1 updated product diff');

    // Apply Recovery (restores original title + auto-creates pre_restore snapshot)
    const restoreRes = await fetch(`${baseUrl}/api/admin/security/backup/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ confirmPin: TEST_PIN, snapshotId: baselineSnapId }),
    });
    assertEq(restoreRes.status, 200, 'Safe restore succeeds');
    const restoreJson = (await restoreRes.json()) as any;
    assertTrue(typeof restoreJson.preRestoreSnapshotId === 'string', 'Restore created automatic pre_restore snapshot');

    const afterRestoreStore = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
    assertEq(afterRestoreStore.products[0].name.ar, originalFirstTitle, 'Store product restored to baseline');

    // Rollback to pre_restore snapshot — returns mutated title
    const rollbackRes = await fetch(`${baseUrl}/api/admin/security/backup/rollback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ confirmPin: TEST_PIN, snapshotId: restoreJson.preRestoreSnapshotId }),
    });
    assertEq(rollbackRes.status, 200, 'Pre-restore rollback succeeds');
    const afterRollbackStore = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
    assertEq(afterRollbackStore.products[0].name.ar, 'منتج معدل للاختبار', 'Rollback reverted to pre-restore state');

    // Tampered recovery bundle (wrong HMAC signature) must be rejected without modifying store state
    const tamperedRestoreRes = await fetch(`${baseUrl}/api/admin/security/backup/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        confirmPin: TEST_PIN,
        allowUnsigned: false,
        bundle: {
          schemaVersion: '1.0',
          snapshotId: 'tampered-1',
          createdAt: new Date().toISOString(),
          signatureHmac: '0'.repeat(64),
          payloadSha256: '1'.repeat(64),
          payload: {
            products: [{ id: 'hack', name: { ar: 'مهكر', fr: 'Hack', en: 'Hack' }, price: 1, stock: 1, category: 'all', companyId: 'comp_echox', companyName: 'x', governorate: 'tunis', images: ['/a.png'], description: { ar: 'x', fr: 'x', en: 'x' } }],
            companies: storeData.companies,
            categories: storeData.categories,
            banners: storeData.banners,
            siteSettings: storeData.siteSettings,
            orders: [],
          },
        },
      }),
    });
    assertEq(tamperedRestoreRes.status, 400, 'Tampered HMAC recovery bundle rejected (400) when allowUnsigned is false');
    const afterTamperStore = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
    assertEq(afterTamperStore.products[0].name.ar, 'منتج معدل للاختبار', 'Failed restore leaves storefront data intact');

    // Verify Hash-Chained Audit Log integrity after all events
    const auditRes = await fetch(`${baseUrl}/api/admin/security/audit-logs?limit=150`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertEq(auditRes.status, 200, 'Audit logs endpoint returns 200');
    const auditJson = (await auditRes.json()) as any;
    assertTrue(auditJson.chainIntact === true, 'SHA-256 audit log chain remains intact across all operations');

    // =========================================================
    // 6. Session Revocation on Logout & Emergency Lockdown
    // =========================================================
    const logoutRes = await fetch(`${baseUrl}/api/owner/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
    });
    assertEq(logoutRes.status, 200, 'POST /api/owner/logout with CSRF succeeds');

    const reusedTokenRes = await fetch(`${baseUrl}/api/owner/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertEq(reusedTokenRes.status, 401, 'Revoked v2 session token rejected with 401 after logout');

    // Re-authenticate with fresh gateToken, then verify Emergency Lockdown invalidates active token immediately
    const reloginAcRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    const reloginAcJson = (await reloginAcRes.json()) as any;
    const reloginRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
      body: JSON.stringify({ pin: TEST_PIN, gateToken: reloginAcJson.gateToken }),
    });
    assertEq(reloginRes.status, 200, 'Re-login succeeds (200)');
    const reloginJson = (await reloginRes.json()) as any;

    const lockdownRes = await fetch(`${baseUrl}/api/security/emergencyLockdown`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${reloginJson.sessionToken}`,
        'X-CSRF-Token': reloginJson.csrfToken,
      },
    });
    assertEq(lockdownRes.status, 200, 'Emergency lockdown succeeds (200)');

    const postLockdownMeRes = await fetch(`${baseUrl}/api/owner/me`, {
      headers: { Authorization: `Bearer ${reloginJson.sessionToken}` },
    });
    assertEq(postLockdownMeRes.status, 401, 'Emergency lockdown immediately invalidates active session tokens (401)');

    // =========================================================
    // 7. Banking-Grade Hardening Checks (XSS, Legacy Routes, Info Minimization, Catalog Integrity, Chat & Push HMAC)
    // =========================================================
    const xssGoogleRes = await fetch(`${baseUrl}/google%3Cscript%3Ealert(1)%3C/script%3E.html`);
    assertEq(xssGoogleRes.status, 404, 'Malicious /google<script>.html verification route returns 404');

    const lockHashRes = await fetch(`${baseUrl}/api/security/verifyLockHash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: 'abc' }),
    });
    assertEq(lockHashRes.status, 403, 'Legacy /api/security/verifyLockHash is blocked (403)');

    const logFailRes = await fetch(`${baseUrl}/api/security/logFailedAttempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pin' }),
    });
    assertEq(logFailRes.status, 403, 'Legacy /api/security/logFailedAttempt is blocked (403)');

    const pubHealthJson = (await (await fetch(`${baseUrl}/api/health`)).json()) as any;
    assertEq(pubHealthJson.dataDir, undefined, 'Public /api/health hides internal dataDir path');
    const pubSysJson = (await (await fetch(`${baseUrl}/api/security/systemStatus`)).json()) as any;
    assertEq(pubSysJson.defaultCodeAvailable, undefined, 'Public /api/security/systemStatus hides defaultCodeAvailable');

    const unknownProdRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.77' },
      body: JSON.stringify({
        customerName: 'عميل اختبار',
        customerPhone: '22123456',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع اختبار' },
        paymentMethod: 'cod',
        items: [{ productId: 'nonexistent_prod_999', productName: 'Fake', quantity: 1, unitPrice: 1 }],
      }),
    });
    assertEq(unknownProdRes.status, 400, 'Checkout with unknown productId rejected with 400');

    // Chat token enforcement
    const chatPost = await fetch(`${baseUrl}/api/chat/session/sess_sec_test_1/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'ar',
        customerText: 'مرحباً <script>alert(1)</script>',
        autoReplyText: 'أهلاً بك',
        actionView: 'invalid_action_xx',
      }),
    });
    assertEq(chatPost.status, 200, 'Chat POST returns 200');
    const chatPostJson = (await chatPost.json()) as any;
    assertTrue(typeof chatPostJson.chatToken === 'string' && chatPostJson.chatToken.startsWith('chat1.'), 'Chat POST issues signed X-Chat-Token');
    assertTrue(!JSON.stringify(chatPostJson.thread).includes('<script>'), 'Chat sanitized HTML/script tags');
    assertEq(chatPostJson.thread.messages[1].actionView, undefined, 'Invalid actionView rejected');

    const chatNoTok = await fetch(`${baseUrl}/api/chat/session/sess_sec_test_1`);
    assertEq(chatNoTok.status, 403, 'Chat GET without X-Chat-Token returns 403');
    const chatWithTok = await fetch(`${baseUrl}/api/chat/session/sess_sec_test_1`, {
      headers: { 'X-Chat-Token': chatPostJson.chatToken },
    });
    assertEq(chatWithTok.status, 200, 'Chat GET with valid X-Chat-Token returns 200');

    // Public push unsubscribe HMAC enforcement
    const pubSubRes = await fetch(`${baseUrl}/api/notifications/public/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-endpoint-12345',
          keys: { p256dh: 'dGVzdA', auth: 'dGVzdA' },
        },
      }),
    });
    assertEq(pubSubRes.status, 200, 'Public push subscribe returns 200');
    const pubSubJson = (await pubSubRes.json()) as any;
    assertTrue(typeof pubSubJson.unsubscribeToken === 'string' && pubSubJson.unsubscribeToken.startsWith('unsub1.'), 'Public push subscribe returns HMAC unsubscribeToken');

    const badUnsubRes = await fetch(`${baseUrl}/api/notifications/public/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-endpoint-12345',
        unsubscribeToken: 'unsub1.invalid',
      }),
    });
    assertEq(badUnsubRes.status, 403, 'Public push unsubscribe without valid HMAC token returns 403');

    const okUnsubRes = await fetch(`${baseUrl}/api/notifications/public/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-endpoint-12345',
        unsubscribeToken: pubSubJson.unsubscribeToken,
      }),
    });
    assertEq(okUnsubRes.status, 200, 'Public push unsubscribe with valid HMAC token succeeds (200)');

    console.log('ALL ECHOX SECURITY & CONTROL ROOM REGRESSION TESTS PASSED');
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
