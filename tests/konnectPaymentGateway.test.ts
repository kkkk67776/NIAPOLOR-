/**
 * Isolated Integration & Security Test Suite for Konnect Payment API v2 + Zero Public RIB Exposure
 *
 * Runs against an ephemeral in-process Express server (127.0.0.1:0) + in-process mock Konnect API v2 server
 * via scoped fetch interception for api.sandbox.konnect.network.
 */

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import argon2 from 'argon2';

const TEST_PIN = '739146';
const TEST_ACCESS_CODE = '#TestVault2026';

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

interface MockKonnectPayment {
  paymentRef: string;
  receiverWalletId: string;
  token: string;
  amount: number;
  orderId: string;
  status: 'pending' | 'completed' | 'failed';
  webhookUrl: string;
  successUrl: string;
  failUrl: string;
  silentWebhook: boolean;
}

async function run(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echox-konnect-test-'));
  let appServer: http.Server | null = null;
  let mockKonnectServer: http.Server | null = null;
  const originalFetch = globalThis.fetch;

  const mockPayments = new Map<string, MockKonnectPayment>();
  let initCounter = 0;

  try {
    // 1. Start in-process Mock Konnect API v2 Server
    mockKonnectServer = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const apiKey = req.headers['x-api-key'];
      res.setHeader('Content-Type', 'application/json');

      if (apiKey !== 'konnect_sandbox_secret_key_998877') {
        res.statusCode = 401;
        res.end(JSON.stringify({ message: 'Invalid Konnect x-api-key' }));
        return;
      }

      if (req.method === 'POST' && reqUrl.pathname === '/api/v2/payments/init-payment') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        if (!body.receiverWalletId || !body.amount || !body.orderId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ message: 'Missing receiverWalletId, amount, or orderId' }));
          return;
        }
        initCounter += 1;
        const paymentRef = `kpay_ref_${initCounter}_${Date.now()}`;
        mockPayments.set(paymentRef, {
          paymentRef,
          receiverWalletId: String(body.receiverWalletId),
          token: String(body.token || 'TND'),
          amount: Number(body.amount),
          orderId: String(body.orderId),
          status: 'pending',
          webhookUrl: String(body.webhook || ''),
          successUrl: String(body.successUrl || ''),
          failUrl: String(body.failUrl || ''),
          silentWebhook: Boolean(body.silentWebhook),
        });
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            payUrl: `https://sandbox.konnect.network/pay/${paymentRef}`,
            paymentRef,
          })
        );
        return;
      }

      if (req.method === 'GET' && reqUrl.pathname === '/api/v2/payments/test-check') {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: 'Payment test-check reference not found (API key accepted)' }));
        return;
      }

      if (req.method === 'GET' && reqUrl.pathname.startsWith('/api/v2/payments/')) {
        const ref = decodeURIComponent(reqUrl.pathname.replace('/api/v2/payments/', ''));
        const rec = mockPayments.get(ref);
        if (!rec) {
          res.statusCode = 404;
          res.end(JSON.stringify({ message: 'Payment not found' }));
          return;
        }
        res.statusCode = 200;
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

      res.statusCode = 404;
      res.end(JSON.stringify({ message: 'Unknown mock route' }));
    });

    await new Promise<void>((resolve) => mockKonnectServer!.listen(0, '127.0.0.1', () => resolve()));
    const konnectAddr = mockKonnectServer.address();
    if (!konnectAddr || typeof konnectAddr === 'string') {
      throw new Error('Failed to bind mock Konnect server');
    }
    const mockKonnectBaseUrl = `http://127.0.0.1:${konnectAddr.port}`;

    // Scoped fetch shim: route only api.sandbox.konnect.network to our in-process mock server
    globalThis.fetch = ((input: Parameters<typeof originalFetch>[0], init?: Parameters<typeof originalFetch>[1]) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.startsWith('https://api.sandbox.konnect.network/')) {
        const rewritten = urlStr.replace('https://api.sandbox.konnect.network', mockKonnectBaseUrl);
        return originalFetch(rewritten, init);
      }
      return originalFetch(input, init);
    }) as typeof originalFetch;

    // 2. Isolate environment and bootstrap Express server
    process.env.ECHOX_DISABLE_LISTEN = '1';
    process.env.DATA_DIR = tmpDir;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    process.env.ECHOX_SECURITY_HMAC_SECRET = 'test_hmac_konnect_gateway_2026_secret';

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

    // 3. Verify Public Config Strictly Hides Internal RIB & Gateway Secrets
    const publicCfgRes = await fetch(`${baseUrl}/api/payments/config`);
    assertEq(publicCfgRes.status, 200, 'Public payment config returns 200');
    const publicCfgJson = (await publicCfgRes.json()) as any;
    const publicCfgStr = JSON.stringify(publicCfgJson);
    assertEq(publicCfgJson.methods.cod.enabled, true, 'COD remains enabled by default');
    assertEq(publicCfgJson.methods.bank_transfer.enabled, false, 'Public bank_transfer is hidden/disabled');
    assertEq(publicCfgJson.methods.bank_transfer.ibanOrRib, '', 'Public bank_transfer.ibanOrRib is scrubbed');
    assertEq(publicCfgJson.methods.bank_transfer.accountHolder, '', 'Public bank_transfer.accountHolder is scrubbed');
    assertEq(publicCfgJson.methods.online_payment.readyForLive, false, 'Online gateway not ready until configured');
    assertTrue(!publicCfgStr.includes('TN59') && !publicCfgStr.includes('BIAT'), 'Zero RIB/BIAT strings in public config');

    // 4. Authenticate Owner via Secret Access Code + PIN Flow (Preserved Unchanged)
    const acRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.70' },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    assertEq(acRes.status, 200, 'Secret access code verified');
    const { gateToken } = (await acRes.json()) as any;

    const pinRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.70' },
      body: JSON.stringify({ pin: TEST_PIN, gateToken }),
    });
    assertEq(pinRes.status, 200, 'PIN verified');
    const { sessionToken: adminToken, csrfToken } = (await pinRes.json()) as any;

    // 5. Configure Konnect Sandbox via Admin Control Room API (Keep Secret Keys Server-Side Only)
    const webhookSecret = 'konnect_hmac_webhook_secret_2026';
    const walletId = 'wallet_echox_665544';
    const apiKey = 'konnect_sandbox_secret_key_998877';

    const updateCfgRes = await fetch(`${baseUrl}/api/admin/payments/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        onlinePayment: {
          enabled: true,
          provider: 'konnect',
          mode: 'sandbox',
          apiKey,
          walletId,
          webhookSecret,
        },
      }),
    });
    assertEq(updateCfgRes.status, 200, 'Admin configures Konnect sandbox gateway (200)');
    const updateCfgJson = (await updateCfgRes.json()) as any;
    assertTrue(
      String(updateCfgJson.config.methods.bank_transfer.ibanOrRib || '').includes('TN59'),
      'Admin config still retains internal RIB for merchant settlement'
    );
    assertEq(updateCfgJson.config.methods.online_payment.readyForLive, true, 'Gateway flagged readyForLive');

    // Verify public config STILL hides all keys, masked secrets, webhookPath, and bank RIB
    const postEnablePubRes = await fetch(`${baseUrl}/api/payments/config`);
    const postEnablePubJson = (await postEnablePubRes.json()) as any;
    const postEnablePubText = JSON.stringify(postEnablePubJson);
    assertEq(postEnablePubJson.methods.online_payment.enabled, true, 'Online payment now enabled publicly');
    assertEq(postEnablePubJson.methods.online_payment.readyForLive, true, 'Online payment readyForLive publicly');
    assertEq(postEnablePubJson.methods.online_payment.apiKeyMasked, undefined, 'Public config omits apiKeyMasked');
    assertEq(postEnablePubJson.methods.online_payment.walletIdMasked, undefined, 'Public config omits walletIdMasked');
    assertEq(postEnablePubJson.methods.online_payment.webhookPath, undefined, 'Public config omits webhookPath');
    assertTrue(!postEnablePubText.includes(apiKey) && !postEnablePubText.includes(walletId) && !postEnablePubText.includes(webhookSecret), 'Public config leaks zero Konnect credentials');
    assertTrue(!postEnablePubText.includes('TN59') && !postEnablePubText.includes('BIAT'), 'Public config leaks zero bank RIB details');

    // Run Server Gateway Connection Test
    const testConnRes = await fetch(`${baseUrl}/api/admin/payments/test-gateway`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-CSRF-Token': csrfToken,
      },
    });
    assertEq(testConnRes.status, 200, 'Admin Konnect connection check returns 200');
    const testConnJson = (await testConnRes.json()) as any;
    assertTrue(testConnJson.ok === true, 'Konnect connection check passed against sandbox API');

    // 6. Fetch catalog product and create an independent Konnect checkout session
    const storeRes = await fetch(`${baseUrl}/api/store/state`);
    const storeData = (await storeRes.json()) as any;
    const prod = storeData.products[0];

    // 6a. Tampered unitPrice must be rejected before creating Konnect session
    const tamperCheckoutRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.71' },
      body: JSON.stringify({
        customerName: 'عميل محتال',
        customerPhone: '22112233',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الجمهورية' },
        paymentMethod: 'online_payment',
        items: [{ productId: prod.id, productName: prod.name?.ar || prod.id, quantity: 1, unitPrice: 1 }],
      }),
    });
    assertEq(tamperCheckoutRes.status, 400, 'Tampered price rejected on online checkout (400)');

    // 6b. Valid online checkout creates Konnect payment session in millimes + tokenized webhook
    const okCheckoutRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.72' },
      body: JSON.stringify({
        customerName: 'سليم بن يوسف',
        customerPhone: '55112233',
        customerEmail: 'salim@example.com',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الحبيب ثامر' },
        paymentMethod: 'online_payment',
        items: [{ productId: prod.id, productName: prod.name?.ar || prod.id, quantity: 1, unitPrice: prod.price }],
        clientRequestId: 'konnect_order_req_1',
      }),
    });
    assertEq(okCheckoutRes.status, 200, 'Online Konnect checkout succeeds (200)');
    const okCheckoutJson = (await okCheckoutRes.json()) as any;
    const order = okCheckoutJson.order;
    const orderTrackingToken: string = okCheckoutJson.trackingToken;
    assertTrue(typeof okCheckoutJson.paymentUrl === 'string' && okCheckoutJson.paymentUrl.startsWith('https://sandbox.konnect.network/pay/'), 'Returns HTTPS Konnect payUrl');
    assertEq(order.paymentStatus, 'Pending Payment', 'Order starts as Pending Payment before Konnect confirmation');

    const payRef = okCheckoutJson.paymentUrl.split('/').pop()!;
    const konnectRecord = mockPayments.get(payRef);
    assertTrue(Boolean(konnectRecord), 'Mock Konnect received init-payment call');
    assertEq(konnectRecord!.receiverWalletId, walletId, 'Konnect receiverWalletId matches merchant wallet');
    assertEq(konnectRecord!.token, 'TND', 'Konnect currency token is TND');
    assertEq(konnectRecord!.amount, Math.round(order.totalAmount * 1000), 'Konnect amount matches exact order total in TND millimes');
    assertEq(konnectRecord!.orderId, order.trackingNumber, 'Konnect orderId binds to order trackingNumber');
    assertEq(konnectRecord!.silentWebhook, true, 'Konnect silentWebhook enabled');
    assertTrue(
      /\/api\/payments\/webhook\/konnect\/[a-f0-9]{32}$/.test(konnectRecord!.webhookUrl),
      'Konnect webhook URL carries per-order 32-hex HMAC token'
    );

    const whToken = konnectRecord!.webhookUrl.split('/').pop()!;

    // 7. Security Negative Tests on Webhook & Verification
    // 7a. Forged per-order webhook token rejected (403)
    const badTokenWh = await fetch(
      `${baseUrl}/api/payments/webhook/konnect/00000000000000000000000000000000?payment_ref=${encodeURIComponent(payRef)}`
    );
    assertEq(badTokenWh.status, 403, 'Forged per-order webhook token rejected (403)');

    // 7b. Unsigned POST webhook rejected when webhookSecret is configured (401)
    const unsignedPostWh = await fetch(`${baseUrl}/api/payments/webhook/konnect/${whToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_ref: payRef, orderId: order.trackingNumber, status: 'completed' }),
    });
    assertEq(unsignedPostWh.status, 401, 'Unsigned POST webhook rejected (401)');

    // 7c. Pending payment status on Konnect does NOT mark order Paid
    const pendingWh = await fetch(`${baseUrl}/api/payments/webhook/konnect/${whToken}?payment_ref=${encodeURIComponent(payRef)}`);
    assertEq(pendingWh.status, 200, 'Pending Konnect webhook returns 200 without marking Paid');
    const trackPendingRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(order.trackingNumber)}`, {
      headers: { 'x-tracking-token': orderTrackingToken },
    });
    const trackPendingJson = (await trackPendingRes.json()) as any;
    assertEq(trackPendingJson.order.paymentStatus, 'Pending Payment', 'Pending Konnect status does NOT mark order Paid');

    // 7d. Tampered orderId returned by gateway rejected (403)
    const originalOrderId = konnectRecord!.orderId;
    konnectRecord!.status = 'completed';
    konnectRecord!.orderId = 'ECX-OTHER-ORDER';
    const orderMismatchWh = await fetch(`${baseUrl}/api/payments/webhook/konnect/${whToken}?payment_ref=${encodeURIComponent(payRef)}`);
    assertEq(orderMismatchWh.status, 403, 'Konnect orderId mismatch rejected (403)');
    konnectRecord!.orderId = originalOrderId;

    // 7e. Tampered millime amount returned by gateway rejected (403)
    const originalAmount = konnectRecord!.amount;
    konnectRecord!.amount = 1000;
    const amountMismatchWh = await fetch(`${baseUrl}/api/payments/webhook/konnect/${whToken}?payment_ref=${encodeURIComponent(payRef)}`);
    assertEq(amountMismatchWh.status, 403, 'Konnect millime amount mismatch rejected (403)');
    konnectRecord!.amount = originalAmount;

    // 8. Valid Konnect Silent GET Webhook Marks Order Paid + Replay Protection
    const validWhRes = await fetch(`${baseUrl}/api/payments/webhook/konnect/${whToken}?payment_ref=${encodeURIComponent(payRef)}`);
    assertEq(validWhRes.status, 200, 'Valid Konnect silent webhook returns 200');
    const validWhJson = (await validWhRes.json()) as any;
    assertTrue(validWhJson.ok === true && /Paid/i.test(validWhJson.message), 'Order confirmed Paid after S2S Konnect verification');

    const trackPaidRes = await fetch(`${baseUrl}/api/payments/track/${encodeURIComponent(order.trackingNumber)}`, {
      headers: { 'x-tracking-token': orderTrackingToken },
    });
    const trackPaidJson = (await trackPaidRes.json()) as any;
    assertEq(trackPaidJson.order.paymentStatus, 'Paid', 'Tracked order status updated to Paid');

    // 8a. Replay / duplicate silentWebhook is idempotent
    const replayWhRes = await fetch(`${baseUrl}/api/payments/webhook/konnect/${whToken}?payment_ref=${encodeURIComponent(payRef)}`);
    assertEq(replayWhRes.status, 200, 'Duplicate silentWebhook returns 200');
    const replayWhJson = (await replayWhRes.json()) as any;
    assertEq(replayWhJson.idempotentDuplicate, true, 'Duplicate silentWebhook ignored idempotently');

    // 9. Signed POST Webhook Replay & Return Verification Endpoint
    const okCheckout2Res = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.73' },
      body: JSON.stringify({
        customerName: 'مريم الطرابلسي',
        customerPhone: '98765432',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع باريس' },
        paymentMethod: 'online_payment',
        items: [{ productId: prod.id, productName: prod.name?.ar || prod.id, quantity: 1, unitPrice: prod.price }],
        clientRequestId: 'konnect_order_req_2',
      }),
    });
    assertEq(okCheckout2Res.status, 200, 'Second independent online Konnect checkout succeeds (200)');
    const okCheckout2Json = (await okCheckout2Res.json()) as any;
    const order2 = okCheckout2Json.order;
    const payRef2 = okCheckout2Json.paymentUrl.split('/').pop()!;
    assertTrue(payRef2 !== payRef, 'Each order receives an independent Konnect payment session');
    const rec2 = mockPayments.get(payRef2)!;
    rec2.status = 'completed';
    const whToken2 = rec2.webhookUrl.split('/').pop()!;

    const postBody = JSON.stringify({ eventId: `evt_${payRef2}_paid`, payment_ref: payRef2, orderId: order2.trackingNumber });
    const sigHex = crypto.createHmac('sha256', webhookSecret).update(postBody).digest('hex');

    const signedPostWh = await fetch(`${baseUrl}/api/payments/webhook/konnect/${whToken2}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-konnect-signature': `sha256=${sigHex}`,
      },
      body: postBody,
    });
    assertEq(signedPostWh.status, 200, 'Signed POST Konnect webhook accepted (200)');

    // Verify return endpoint confirms Paid without duplicating payment
    const verifyRetRes = await fetch(
      `${baseUrl}/api/payments/verify-return?provider=konnect&tracking=${encodeURIComponent(order2.trackingNumber)}&payment_ref=${encodeURIComponent(payRef2)}`
    );
    assertEq(verifyRetRes.status, 200, 'Verify-return endpoint returns 200');
    const verifyRetJson = (await verifyRetRes.json()) as any;
    assertEq(verifyRetJson.paymentStatus, 'Paid', 'Verify-return confirms Paid status');

    // 10. Cash on Delivery (COD) Preserved & Unchanged
    const codRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.74' },
      body: JSON.stringify({
        customerName: 'كريم العياري',
        customerPhone: '29334455',
        shippingAddress: { governorate: 'tunis', delegation: 'المدينة', street: 'شارع الحرية' },
        paymentMethod: 'cod',
        items: [{ productId: prod.id, productName: prod.name?.ar || prod.id, quantity: 1, unitPrice: prod.price }],
      }),
    });
    assertEq(codRes.status, 200, 'COD checkout continues working end-to-end (200)');
    const codJson = (await codRes.json()) as any;
    assertEq(codJson.order.paymentMethod, 'cod', 'COD paymentMethod preserved');
    assertEq(codJson.order.paymentStatus, 'Cash on Delivery', 'COD paymentStatus preserved');

    console.log('ALL KONNECT PAYMENT GATEWAY & ZERO PUBLIC RIB TESTS PASSED');
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

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
