/**
 * Isolated Integration & Security Test Suite for Poste Tunisienne / CCP Transfer
 * alongside preserved Konnect Payment API v2, COD, Zero Public RIB Exposure, and PIN security.
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import argon2 from 'argon2';

const TEST_PIN = '739146';
const TEST_ACCESS_CODE = '#TestVault2026';

// Minimal valid 1x1 PNG binary (89 50 4E 47 0D 0A 1A 0A ...)
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_PNG_DATA_URL = `data:image/png;base64,${VALID_PNG_BASE64}`;
const SPOOFED_SVG_DATA_URL =
  'data:image/png;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf-8').toString('base64');

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echox-poste-ccp-test-'));
  let appServer: http.Server | null = null;

  try {
    process.env.ECHOX_DISABLE_LISTEN = '1';
    process.env.DATA_DIR = tmpDir;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    process.env.ECHOX_SECURITY_HMAC_SECRET = 'test_hmac_poste_ccp_gateway_2026_secret';

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

    appServer = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = appServer.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral app server');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // 1. Public Payment Config: poste_ccp enabled, COD enabled, zero RIB/holder/secrets leaked
    const pubCfgRes = await fetch(`${baseUrl}/api/payments/config`);
    assertEq(pubCfgRes.status, 200, 'Public payment config returns 200');
    const pubCfg = (await pubCfgRes.json()) as any;
    const pubCfgStr = JSON.stringify(pubCfg);
    assertEq(pubCfg.methods.cod.enabled, true, 'COD preserved & enabled');
    assertEq(pubCfg.methods.poste_ccp.enabled, true, 'Poste Tunisienne / CCP enabled publicly');
    assertEq(pubCfg.methods.poste_ccp.integrityVerified, true, 'Poste CCP bank integrity seal verified');
    assertEq(pubCfg.methods.bank_transfer.enabled, false, 'Legacy public bank_transfer remains hidden');
    assertEq(pubCfg.methods.bank_transfer.ibanOrRib, '', 'Public config never includes RIB');
    assertTrue(!pubCfgStr.includes('TN59') && !pubCfgStr.includes('BIAT'), 'Zero RIB or BIAT text leaked in /api/payments/config');

    // 2. On-demand Poste/CCP Transfer Details endpoint returns saved RIB + manual verification notice
    const ccpDetailsRes = await fetch(`${baseUrl}/api/payments/poste-ccp/details`, {
      headers: { 'x-forwarded-for': '198.51.100.80' },
    });
    assertEq(ccpDetailsRes.status, 200, 'On-demand poste-ccp details returns 200 when selected');
    const ccpDetailsJson = (await ccpDetailsRes.json()) as any;
    assertTrue(ccpDetailsJson.success === true, 'poste-ccp details success is true');
    assertTrue(String(ccpDetailsJson.details?.ibanOrRib || '').includes('TN59'), 'poste-ccp details uses saved sealed RIB');
    assertTrue(Boolean(ccpDetailsJson.details?.accountHolder), 'poste-ccp details includes accountHolder');
    assertTrue(
      String(ccpDetailsJson.details?.manualVerificationNotice || '').includes('لا يوجد تحقق آلي'),
      'Explicitly states NO automated CCP verification API exists'
    );

    // 3. Fetch catalog product
    const storeRes = await fetch(`${baseUrl}/api/store/state`);
    const storeData = (await storeRes.json()) as any;
    const prod = storeData.products[0];
    assertTrue(Boolean(prod && prod.id), 'Catalog product loaded');

    // 3a. Tampered unitPrice must be rejected (400)
    const tamperCheckoutRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.81' },
      body: JSON.stringify({
        customerName: 'عميل محتال',
        customerPhone: '22998877',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'نهج الجمهورية' },
        paymentMethod: 'poste_ccp',
        items: [{ productId: prod.id, productName: prod.name?.ar || prod.id, quantity: 1, unitPrice: 0.5 }],
      }),
    });
    assertEq(tamperCheckoutRes.status, 400, 'Tampered price rejected on poste_ccp checkout (400)');

    // 3b. Checkout WITHOUT proof -> Awaiting Bank Transfer + unique ECH-CCP- reference + transferDetails
    const checkoutNoProofRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.82' },
      body: JSON.stringify({
        customerName: 'أحمد الطرابلسي',
        customerPhone: '55443322',
        shippingAddress: { governorate: 'tunis', delegation: 'باردو', street: 'شارع الاستقلال' },
        paymentMethod: 'poste_ccp',
        items: [{ productId: prod.id, productName: prod.name?.ar || prod.id, quantity: 1, unitPrice: prod.price }],
        clientRequestId: 'ccp_order_req_1',
      }),
    });
    assertEq(checkoutNoProofRes.status, 200, 'poste_ccp checkout without proof succeeds (200)');
    const checkoutNoProofJson = (await checkoutNoProofRes.json()) as any;
    const order1 = checkoutNoProofJson.order;
    const order1Token: string = checkoutNoProofJson.trackingToken;
    assertTrue(typeof order1Token === 'string' && order1Token.length >= 16, 'Checkout returns guest trackingToken');
    assertEq(order1.paymentMethod, 'poste_ccp', 'Order paymentMethod is poste_ccp');
    assertEq(order1.paymentStatus, 'Awaiting Bank Transfer', 'Order starts as Awaiting Bank Transfer without receipt');
    assertTrue(/^ECH-CCP-[A-Z0-9]{8}$/.test(String(order1.paymentReference || '')), 'Unique ECH-CCP-XXXXXXXX reference generated');
    assertTrue(String(checkoutNoProofJson.transferDetails?.ibanOrRib || '').includes('TN59'), 'Checkout returns transferDetails for poste_ccp');

    // Second poste_ccp checkout must yield a strictly different unique ECH-CCP reference
    const checkoutWithProofRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.83' },
      body: JSON.stringify({
        customerName: 'ليلى المنصوري',
        customerPhone: '55889911',
        shippingAddress: { governorate: 'sfax', delegation: 'صفاقس المدينة', street: 'طريق تونس' },
        paymentMethod: 'poste_ccp',
        items: [{ productId: prod.id, productName: prod.name?.ar || prod.id, quantity: 1, unitPrice: prod.price }],
        clientRequestId: 'ccp_order_req_2',
        transferProof: {
          referenceNumber: 'CCP-OP-9001',
          senderName: 'ليلى المنصوري',
          transferDate: '2026-11-20',
          receiptImageDataUrl: VALID_PNG_DATA_URL,
          notes: 'تحويل عبر البريد التونسي',
        },
      }),
    });
    assertEq(checkoutWithProofRes.status, 200, 'poste_ccp checkout WITH valid PNG proof succeeds (200)');
    const checkoutWithProofJson = (await checkoutWithProofRes.json()) as any;
    const order2 = checkoutWithProofJson.order;
    assertEq(order2.paymentStatus, 'Payment Verification', 'Order with receipt proof starts as Payment Verification');
    assertTrue(/^ECH-CCP-[A-Z0-9]{8}$/.test(String(order2.paymentReference || '')), 'Order2 also receives ECH-CCP reference');
    assertTrue(
      order1.paymentReference !== order2.paymentReference,
      'Each poste_ccp order receives a distinct unique transfer reference'
    );

    // 4. Proof upload validation via POST /api/payments/poste-ccp/proof
    // 4a. Missing or invalid trackingToken must be rejected (401/403)
    const missingTokProofRes = await fetch(`${baseUrl}/api/payments/poste-ccp/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.84' },
      body: JSON.stringify({
        trackingNumber: order1.trackingNumber,
        referenceNumber: 'CCP-REF-110',
        senderName: 'شخص غير مصرح',
        receiptImageDataUrl: VALID_PNG_DATA_URL,
      }),
    });
    assertEq(missingTokProofRes.status, 401, 'Poste/CCP proof upload without trackingToken rejected (401)');

    const wrongTokenProofRes = await fetch(`${baseUrl}/api/payments/poste-ccp/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.84' },
      body: JSON.stringify({
        trackingNumber: order1.trackingNumber,
        trackingToken: '00000000000000000000000000000000',
        referenceNumber: 'CCP-REF-111',
        senderName: 'شخص غير مصرح',
        receiptImageDataUrl: VALID_PNG_DATA_URL,
      }),
    });
    assertEq(wrongTokenProofRes.status, 403, 'Poste/CCP proof upload with invalid trackingToken rejected (403)');

    // 4b. Spoofed SVG disguised as PNG must be rejected (400) & quarantined
    const spoofedProofRes = await fetch(`${baseUrl}/api/payments/poste-ccp/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.85' },
      body: JSON.stringify({
        trackingNumber: order1.trackingNumber,
        trackingToken: order1Token,
        referenceNumber: 'CCP-REF-XSS',
        senderName: 'أحمد الطرابلسي',
        receiptImageDataUrl: SPOOFED_SVG_DATA_URL,
      }),
    });
    assertEq(spoofedProofRes.status, 400, 'Spoofed SVG receipt image rejected (400)');

    // 4c. Valid PNG proof with valid trackingToken succeeds (200) -> Payment Verification
    const validProofRes = await fetch(`${baseUrl}/api/payments/poste-ccp/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.86' },
      body: JSON.stringify({
        trackingNumber: order1.trackingNumber,
        trackingToken: order1Token,
        referenceNumber: 'CCP-2026-4455',
        senderName: 'أحمد الطرابلسي',
        transferDate: '2026-11-20',
        receiptImageDataUrl: VALID_PNG_DATA_URL,
        notes: 'وصل بريد تونس',
      }),
    });
    assertEq(validProofRes.status, 200, 'Valid PNG Poste/CCP proof upload succeeds (200)');
    const validProofJson = (await validProofRes.json()) as any;
    assertEq(validProofJson.order.paymentStatus, 'Payment Verification', 'Order1 transitioned to Payment Verification');

    // 5. Public Order Tracking Privacy: Rejected without trackingToken or with phone-only; guest token returns masked PII + transferDetails
    const unauthTrackRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(order1.trackingNumber)}`, {
      headers: { 'x-forwarded-for': '198.51.100.87' },
    });
    assertEq(unauthTrackRes.status, 401, 'Unauthenticated tracking without token rejected (401)');

    const phoneOnlyTrackRes = await fetch(
      `${baseUrl}/api/payments/track/${encodeURIComponent(order1.trackingNumber)}?phone=${encodeURIComponent('55443322')}`,
      { headers: { 'x-forwarded-for': '198.51.100.87' } }
    );
    assertEq(phoneOnlyTrackRes.status, 401, 'Phone-only tracking rejected (401)');

    const tokenTrackRes = await fetch(`${baseUrl}/api/payments/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.87',
      },
      body: JSON.stringify({
        trackingNumber: order1.trackingNumber,
        trackingToken: order1Token,
      }),
    });
    assertEq(tokenTrackRes.status, 200, 'Token-authorized tracking returns 200');
    const tokenTrackJson = (await tokenTrackRes.json()) as any;
    assertEq(tokenTrackJson.order.piiMasked, true, 'Guest token tracking masks PII');
    assertTrue(
      String(tokenTrackJson.order.transferDetails?.ibanOrRib || '').includes('TN59'),
      'Token-authorized unpaid poste_ccp tracking returns transferDetails'
    );

    // 6. Owner Authentication via existing Secret Access Code + Argon2id PIN (unchanged)
    const acRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.88' },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    assertEq(acRes.status, 200, 'Secret access code verified');
    const { gateToken } = (await acRes.json()) as any;

    const pinRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.88' },
      body: JSON.stringify({ pin: TEST_PIN, gateToken }),
    });
    assertEq(pinRes.status, 200, 'PIN verified');
    const { sessionToken: adminToken, csrfToken } = (await pinRes.json()) as any;

    // 7. Shipment must be BLOCKED (409) before manual funds confirmation marks order Paid
    const shipBlockedRes = await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(order1.id)}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ status: 'preparing', note: 'Attempt ship before CCP confirmation' }),
    });
    assertEq(shipBlockedRes.status, 409, 'Shipment blocked (409) until poste_ccp funds confirmed Paid');

    // 8. Owner Verification WITHOUT confirmFundsReceived === true must fail (400)
    const unconfirmedVerifyRes = await fetch(`${baseUrl}/api/admin/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        orderId: order1.id,
        action: 'approve',
      }),
    });
    assertEq(unconfirmedVerifyRes.status, 400, 'Owner approval without confirmFundsReceived rejected (400)');

    // 9. Owner Verification WITH confirmFundsReceived: true -> Paid + ledger eligible + activity log + unlocks shipping
    const confirmedVerifyRes = await fetch(`${baseUrl}/api/admin/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        orderId: order1.id,
        action: 'approve',
        confirmFundsReceived: true,
        verificationNote: 'CCP-EXT-778899',
      }),
    });
    assertEq(confirmedVerifyRes.status, 200, 'Owner approval with confirmFundsReceived succeeds (200)');
    const confirmedVerifyJson = (await confirmedVerifyRes.json()) as any;
    assertEq(confirmedVerifyJson.order.paymentStatus, 'Paid', 'Order1 marked Paid after manual CCP confirmation');
    assertEq(confirmedVerifyJson.transaction.fundsVerifiedNote, 'CCP-EXT-778899', 'Verification note saved on transaction');

    // Verify Admin Overview shows eligible ledger & POSTE_CCP_FUNDS_CONFIRMED_PAID audit log
    const overviewRes = await fetch(`${baseUrl}/api/admin/payments/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertEq(overviewRes.status, 200, 'Admin overview returns 200');
    const overviewJson = (await overviewRes.json()) as any;
    const ledger = (overviewJson.vendorLedgers || []).find((l: any) => l.orderId === order1.id);
    assertTrue(Boolean(ledger), 'Vendor ledger created for poste_ccp order');
    assertEq(ledger.payoutStatus, 'eligible', 'Vendor ledger payoutStatus upgraded to eligible on Paid');
    const ccpPaidLog = (overviewJson.activityLogs || []).find(
      (log: any) => log.action === 'POSTE_CCP_FUNDS_CONFIRMED_PAID' && log.targetId === order1.id
    );
    assertTrue(Boolean(ccpPaidLog), 'POSTE_CCP_FUNDS_CONFIRMED_PAID logged in activity logs');

    // Now shipping succeeds (200)
    const shipOkRes = await fetch(`${baseUrl}/api/admin/orders/${encodeURIComponent(order1.id)}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ status: 'preparing', note: 'Ready after CCP confirmation' }),
    });
    assertEq(shipOkRes.status, 200, 'Shipping unlocked (200) once poste_ccp order is Paid');

    // 10. Rejecting order2 marks it Payment Failed and preserves verification note/reason
    const rejectRes = await fetch(`${baseUrl}/api/admin/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        orderId: order2.id,
        action: 'reject',
        reason: 'المبلغ لم يصل بعد في كشف حساب البريد التونسي',
      }),
    });
    assertEq(rejectRes.status, 200, 'Owner rejecting unconfirmed CCP proof succeeds (200)');
    const rejectJson = (await rejectRes.json()) as any;
    assertEq(rejectJson.order.paymentStatus, 'Payment Failed', 'Rejected poste_ccp order becomes Payment Failed');

    // 11. Toggling posteCcpEnabled: false disables GET /api/payments/poste-ccp/details (403) while keeping COD & Konnect
    const disableCcpRes = await fetch(`${baseUrl}/api/admin/payments/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ posteCcpEnabled: false }),
    });
    assertEq(disableCcpRes.status, 200, 'Admin can toggle posteCcpEnabled: false');
    const disabledDetailsRes = await fetch(`${baseUrl}/api/payments/poste-ccp/details`, {
      headers: { 'x-forwarded-for': '198.51.100.89' },
    });
    assertEq(disabledDetailsRes.status, 403, 'Disabled poste_ccp hides transfer details (403)');

    // Re-enable for cleanliness
    await fetch(`${baseUrl}/api/admin/payments/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ posteCcpEnabled: true }),
    });

    console.log('✅ ALL Poste Tunisienne / CCP Transfer integration & security tests passed.');
  } finally {
    if (appServer) {
      await new Promise<void>((resolve) => appServer!.close(() => resolve()));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('❌ Poste CCP transfer test failed:', err);
  process.exit(1);
});
