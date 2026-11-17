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
import type http from 'http';

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

    // Trigger progressive brute-force lockout from isolated IP
    for (let i = 0; i < 4; i++) {
      const badPin = await fetch(`${baseUrl}/api/security/verifyPin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.55' },
        body: JSON.stringify({ pin: '000000' }),
      });
      assertEq(badPin.status, 401, `Wrong PIN attempt #${i + 1} returns 401`);
    }
    const lockedPinRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.55' },
      body: JSON.stringify({ pin: '000000' }),
    });
    assertEq(lockedPinRes.status, 429, '5th wrong PIN triggers brute-force lockout (429)');

    // Login cleanly from admin IP
    const loginRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
      body: JSON.stringify({ pin: TEST_PIN }),
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

    // Public visitor tracking strips PII (customerEmail & notes)
    const publicTrackRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(trackingCode)}`);
    assertEq(publicTrackRes.status, 200, 'Public order tracking returns 200');
    const publicTrackJson = (await publicTrackRes.json()) as any;
    assertEq(publicTrackJson.order.customerEmail, '', 'Anonymous tracking strips customerEmail');
    assertEq(publicTrackJson.order.notes, '', 'Anonymous tracking strips internal notes');

    // Authenticated owner sees full order on track endpoint
    const adminTrackRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(trackingCode)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminTrackJson = (await adminTrackRes.json()) as any;
    assertEq(adminTrackJson.order.customerEmail, 'secret-customer@example.com', 'Owner sees unmasked order email');

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

    // Verify Hash-Chained Audit Log integrity after all events
    const auditRes = await fetch(`${baseUrl}/api/admin/security/audit-logs?limit=150`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertEq(auditRes.status, 200, 'Audit logs endpoint returns 200');
    const auditJson = (await auditRes.json()) as any;
    assertTrue(auditJson.chainIntact === true, 'SHA-256 audit log chain remains intact across all operations');

    // =========================================================
    // 6. Session Revocation on Logout
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
