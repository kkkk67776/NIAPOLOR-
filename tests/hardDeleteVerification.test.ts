/**
 * Permanent Hard Delete System Verification Suite
 *
 * Verifies:
 * 1. Security enforcement (401 unauthenticated / gateToken-only, 403 missing CSRF).
 * 2. Product hard delete removes record permanently from DB, payment catalog, public announcements,
 *    and deletes unique uploaded media files while preserving shared media used by other entities.
 * 3. Deleted products never reappear after server re-hydration / reload.
 * 4. Pre-existing recovery backup snapshots remain intact (honest retention policy).
 * 5. Cloudflare R2 S3v4 DELETE integration + HTTP 207 partial-failure reporting & audit logging.
 * 6. Legal financial order retention (409 Conflict on Paid orders) vs unpaid COD order hard delete.
 * 7. Category (preserves products), Company (deletes unshared uploaded logo), Banner, and Chat Thread hard deletes.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import argon2 from 'argon2';

const TEST_ACCESS_CODE = '#EchoxHardDelTest2026';
const TEST_PIN = '741852';

const VALID_PNG_BUF = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const VALID_JPEG_BUF = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xff, 0xd9,
]);

async function runTests(): Promise<void> {
  console.log('Running Permanent Hard Delete System Verification Tests...');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'echox-hard-delete-'));
  process.env.ECHOX_DISABLE_LISTEN = '1';
  process.env.DATA_DIR = tmpRoot;
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
  process.env.UPSTASH_REDIS_REST_URL = '';
  process.env.UPSTASH_REDIS_REST_TOKEN = '';
  process.env.ECHOX_SECURITY_HMAC_SECRET = 'test_hard_delete_hmac_secret_1234567890abcdef123456';

  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET_NAME;
  delete process.env.R2_ENDPOINT;
  delete process.env.R2_PUBLIC_URL;

  const accessHash = await argon2.hash(TEST_ACCESS_CODE, { type: argon2.argon2id });
  const pinHash = await argon2.hash(TEST_PIN, { type: argon2.argon2id });
  fs.writeFileSync(
    path.join(tmpRoot, 'central_security_config.json'),
    JSON.stringify({
      access_code_argon2: accessHash,
      pin_argon2: pinHash,
      updated_at: new Date().toISOString(),
      history: [{ type: 'TEST_SEED', timestamp: new Date().toISOString() }],
    }),
    'utf-8'
  );

  const { app, ensureServerInitialized } = await import('../server');
  const { hydrateStoreStateFromCloud, getStoreRecoverySnapshot } = await import('../server/storeEngine');
  const { getPaymentRecoverySnapshot } = await import('../server/paymentEngine');
  const {
    createSignedRecoverySnapshot,
    getRecoverySnapshotById,
    getSecurityAuditLogs,
  } = await import('../server/securityEngine');
  const { getNotificationSettingsSnapshot, getPublicAnnouncements, emitPublicStoreNotification } =
    await import('../server/notificationEngine');
  const { getPublicChatConfig } = await import('../server/chatEngine');

  await ensureServerInitialized();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Verify Security Guards on Hard Delete Endpoints (401 / 403)
    let gateTokenForPin = '';
    {
      const unauth = await fetch(`${baseUrl}/api/admin/store/products/prod_1`, {
        method: 'DELETE',
      });
      assert.equal(unauth.status, 401, 'Unauthenticated DELETE must return 401');

      const codeRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: TEST_ACCESS_CODE }),
      });
      const codeData = (await codeRes.json()) as { success: boolean; gateToken?: string };
      assert.equal(codeData.success, true);
      gateTokenForPin = codeData.gateToken || '';

      const gateOnly = await fetch(`${baseUrl}/api/admin/store/products/prod_1`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${codeData.gateToken}` },
      });
      assert.equal(gateOnly.status, 401, 'gateToken alone must NOT permit hard delete');
      console.log('✓ 1. Unauthenticated & gateToken-only DELETE blocked (401)');
    }

    // 2. Authenticate Owner via PIN
    const pinRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: TEST_PIN, gateToken: gateTokenForPin }),
    });
    assert.equal(pinRes.status, 200);
    const pinData = (await pinRes.json()) as {
      success: boolean;
      sessionToken: string;
      csrfToken: string;
    };
    assert.equal(pinData.success, true);

    const authHeaders = {
      Authorization: `Bearer ${pinData.sessionToken}`,
      'X-CSRF-Token': pinData.csrfToken,
    };

    // Missing CSRF check
    {
      const noCsrf = await fetch(`${baseUrl}/api/admin/store/products/prod_1`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${pinData.sessionToken}` },
      });
      assert.equal(noCsrf.status, 403, 'DELETE without X-CSRF-Token must return 403');
      console.log('✓ 2. Missing CSRF token rejected with 403');
    }

    // 3. Product Hard Delete: DB + Media + Payment Catalog + Announcements + Shared Media Preservation + Backup Honesty
    {
      const upUniqueRes = await fetch(`${baseUrl}/api/admin/media/upload`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'image/png', 'X-File-Name': 'unique.png' },
        body: VALID_PNG_BUF,
      });
      assert.equal(upUniqueRes.status, 201);
      const upUniqueJson = (await upUniqueRes.json()) as { url: string; fileName: string; mediaId: string };

      const upSharedRes = await fetch(`${baseUrl}/api/admin/media/upload`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'image/jpeg', 'X-File-Name': 'shared.jpg' },
        body: VALID_JPEG_BUF,
      });
      assert.equal(upSharedRes.status, 201);
      const upSharedJson = (await upSharedRes.json()) as { url: string; fileName: string; mediaId: string };

      const stateRes = await fetch(`${baseUrl}/api/store/state`);
      const currState = (await stateRes.json()) as any;
      const categoryId = currState.categories.find((c: any) => c.id !== 'all')?.id || 'power_tools';
      const companyId = currState.companies[0]?.id || 'comp_echox';
      const companyName = currState.companies[0]?.name || 'ECHOX';

      const targetProd = {
        id: 'prod_hard_del_target',
        name: { ar: 'منتج للحذف النهائي', fr: 'Produit à supprimer', en: 'Delete Target Product' },
        description: { ar: 'وصف', fr: 'Desc', en: 'Desc' },
        category: categoryId,
        price: 145,
        stock: 3,
        rating: 5,
        reviewCount: 1,
        reviews: [
          {
            id: 'rev_del_1',
            authorName: 'حريف',
            rating: 5,
            comment: 'جيد',
            date: '2026-11-18',
          },
        ],
        companyId,
        companyName,
        governorate: 'tunis',
        images: [upUniqueJson.url, upSharedJson.url],
        featured: false,
        active: true,
        deliveryTimeDays: 2,
      };

      const keepProd = {
        id: 'prod_keep_shared',
        name: { ar: 'منتج باقٍ بصورة مشتركة', fr: 'Produit conservé', en: 'Keep Shared Product' },
        description: { ar: 'يبقى محفوظاً', fr: 'Keep', en: 'Keep' },
        category: categoryId,
        price: 220,
        stock: 8,
        rating: 5,
        reviewCount: 0,
        companyId,
        companyName,
        governorate: 'tunis',
        images: [upSharedJson.url],
        featured: false,
        active: true,
        deliveryTimeDays: 2,
      };

      const putRes = await fetch(`${baseUrl}/api/admin/store/state`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: [targetProd, keepProd, ...currState.products],
        }),
      });
      assert.equal(putRes.status, 200);

      // Emit a public announcement pointing to the target product (added by PUT state automatically too, ensure present)
      await emitPublicStoreNotification({
        tag: 'منتج جديد',
        title: 'منتج للحذف النهائي',
        body: 'اختبار إزالة الإشعار التابع',
        url: `/?product=${encodeURIComponent(targetProd.id)}`,
      });
      assert.ok(
        getPublicAnnouncements().some((a) => (a.url || '').includes(targetProd.id)),
        'Announcement for target product should exist prior to deletion'
      );

      // Create a pre-existing backup snapshot prior to deletion
      const backupBefore = await createSignedRecoverySnapshot({
        kind: 'manual',
        createdBy: 'owner@test.tn',
        actorIp: '127.0.0.1',
        hmacSecret: process.env.ECHOX_SECURITY_HMAC_SECRET!,
        label: 'Pre-delete snapshot',
        payload: {
          store: getStoreRecoverySnapshot(),
          payments: getPaymentRecoverySnapshot(),
          chatConfig: getPublicChatConfig(),
          notificationSettings: { ...getNotificationSettingsSnapshot() } as unknown as Record<string, boolean>,
        },
      });
      assert.equal(backupBefore.ok, true);
      assert.ok(backupBefore.snapshot);
      const snapId = backupBefore.snapshot!.snapshotId;

      // Verify both images serve 200 before delete
      assert.equal((await fetch(`${baseUrl}${upUniqueJson.url}`)).status, 200);
      assert.equal((await fetch(`${baseUrl}${upSharedJson.url}`)).status, 200);

      // Execute permanent hard delete of targetProd
      const delRes = await fetch(`${baseUrl}/api/admin/store/products/${targetProd.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.equal(delRes.status, 200);
      const delJson = (await delRes.json()) as any;
      assert.equal(delJson.success, true);
      assert.equal(delJson.verifiedRemovedFromDb, true);
      assert.ok(delJson.deletedMediaFiles.includes(upUniqueJson.url), 'Unique media must be deleted');
      assert.ok(delJson.skippedSharedMediaFiles.includes(upSharedJson.url), 'Shared media must be protected');
      assert.ok(typeof delJson.backupRetentionNote === 'string' && delJson.backupRetentionNote.length > 0);

      // Verify targetProd removed from public store, admin store, raw store_state.json, payment catalog & announcements
      const pubAfter = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
      assert.equal(pubAfter.products.some((p: any) => p.id === targetProd.id), false);
      assert.equal(pubAfter.products.some((p: any) => p.id === keepProd.id), true);

      const diskStore = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'store_state.json'), 'utf-8'));
      assert.equal(diskStore.products.some((p: any) => p.id === targetProd.id), false);

      assert.equal(
        Object.prototype.hasOwnProperty.call(getPaymentRecoverySnapshot().catalog, targetProd.id),
        false,
        'Deleted product must be purged from payment catalog'
      );
      assert.equal(
        getPublicAnnouncements().some((a) => (a.url || '').includes(targetProd.id)),
        false,
        'Deleted product announcements must be cleaned up'
      );

      // Verify unique image returns 404 & disk files unlinked, while shared image STILL serves 200
      assert.equal((await fetch(`${baseUrl}${upUniqueJson.url}`)).status, 404);
      assert.equal(
        fs.existsSync(path.join(tmpRoot, 'media_uploads', upUniqueJson.fileName)),
        false,
        'Unique uploaded binary file must be unlinked from disk'
      );
      assert.equal(
        fs.existsSync(path.join(tmpRoot, 'media_uploads', `${upUniqueJson.mediaId}.meta.json`)),
        false,
        'Unique uploaded meta file must be unlinked from disk'
      );
      assert.equal((await fetch(`${baseUrl}${upSharedJson.url}`)).status, 200);

      // Re-hydrate from persistent storage (simulates reload / re-login / restart)
      await hydrateStoreStateFromCloud();
      const pubReload = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
      assert.equal(
        pubReload.products.some((p: any) => p.id === targetProd.id),
        false,
        'Deleted product must never return after reload/rehydration'
      );

      // Verify pre-existing backup snapshot was NOT altered retroactively
      const snapCheck = getRecoverySnapshotById(snapId);
      assert.ok(snapCheck, 'Pre-existing backup snapshot remains intact');
      assert.ok(
        snapCheck!.payload.store.products.some((p: any) => p.id === targetProd.id),
        'Pre-existing backup snapshot honestly retains historical state from before deletion'
      );

      assert.ok(
        getSecurityAuditLogs().entries.some((e) => e.event === 'HARD_DELETE_CONFIRMED'),
        'Audit log must record HARD_DELETE_CONFIRMED'
      );
      console.log('✓ 3. Product DB + unique media + dependencies hard delete & shared media/backup honesty passed');
    }

    // 4. Cloudflare R2 S3v4 DELETE Integration & Partial Failure (HTTP 207) Verification
    {
      const r2StoredObjects = new Map<string, { body: Buffer; contentType: string }>();
      let forceR2DeleteFailure = false;
      const deleteRequestsSeen: string[] = [];

      const mockR2Server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          if (req.method === 'PUT') {
            r2StoredObjects.set(req.url || '', {
              body,
              contentType: String(req.headers['content-type'] || ''),
            });
            res.writeHead(200, { ETag: '"mocketag"' });
            res.end();
            return;
          }
          if (req.method === 'DELETE') {
            deleteRequestsSeen.push(req.url || '');
            if (forceR2DeleteFailure) {
              res.writeHead(500, { 'Content-Type': 'application/xml' });
              res.end('<Error><Code>InternalError</Code></Error>');
              return;
            }
            r2StoredObjects.delete(req.url || '');
            res.writeHead(204);
            res.end();
            return;
          }
          if (req.method === 'GET') {
            const hit = r2StoredObjects.get(req.url || '');
            if (!hit) {
              res.writeHead(404);
              res.end();
              return;
            }
            res.writeHead(200, { 'Content-Type': hit.contentType });
            res.end(hit.body);
            return;
          }
          res.writeHead(405);
          res.end();
        });
      });

      await new Promise<void>((resolve) => mockR2Server.listen(0, '127.0.0.1', () => resolve()));
      const r2Addr = mockR2Server.address() as { port: number };

      try {
        process.env.R2_ENDPOINT = `http://127.0.0.1:${r2Addr.port}`;
        process.env.R2_ACCESS_KEY_ID = 'r2_test_access_key';
        process.env.R2_SECRET_ACCESS_KEY = 'r2_test_secret_key_for_hmac_signing';
        process.env.R2_BUCKET_NAME = 'echox-products';
        process.env.R2_PUBLIC_URL = 'https://cdn.echox-store.tn';

        // Upload Image A (for full R2 DELETE success) & Image B (for R2 DELETE 500 partial failure)
        const upA = (await (
          await fetch(`${baseUrl}/api/admin/media/upload`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'image/png', 'X-File-Name': 'r2-ok.png' },
            body: VALID_PNG_BUF,
          })
        ).json()) as any;
        const upB = (await (
          await fetch(`${baseUrl}/api/admin/media/upload`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'image/png', 'X-File-Name': 'r2-fail.png' },
            body: VALID_PNG_BUF,
          })
        ).json()) as any;

        assert.ok(r2StoredObjects.has(`/echox-products/products/${upA.fileName}`));
        assert.ok(r2StoredObjects.has(`/echox-products/products/${upB.fileName}`));

        const currState = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
        const prodR2Ok = {
          id: 'prod_r2_del_ok',
          name: { ar: 'منتج R2 حذف كامل', fr: 'R2 OK', en: 'R2 OK' },
          description: { ar: 'R2', fr: 'R2', en: 'R2' },
          category: 'power_tools',
          price: 100,
          stock: 2,
          rating: 5,
          reviewCount: 0,
          companyId: 'comp_echox',
          companyName: 'ECHOX',
          governorate: 'tunis',
          images: [upA.url],
          featured: false,
          active: true,
          deliveryTimeDays: 2,
        };
        const prodR2Fail = {
          ...prodR2Ok,
          id: 'prod_r2_del_fail',
          name: { ar: 'منتج R2 فشل جزئي', fr: 'R2 Fail', en: 'R2 Fail' },
          images: [upB.url],
        };

        await fetch(`${baseUrl}/api/admin/store/state`, {
          method: 'PUT',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ products: [prodR2Ok, prodR2Fail, ...currState.products] }),
        });

        // Case A: Full R2 DELETE succeeds
        forceR2DeleteFailure = false;
        const delOkRes = await fetch(`${baseUrl}/api/admin/store/products/${prodR2Ok.id}`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        assert.equal(delOkRes.status, 200);
        const delOkJson = (await delOkRes.json()) as any;
        assert.equal(delOkJson.success, true);
        assert.ok(deleteRequestsSeen.includes(`/echox-products/products/${upA.fileName}`));
        assert.equal(r2StoredObjects.has(`/echox-products/products/${upA.fileName}`), false);

        // Case B: R2 DELETE fails -> MUST return HTTP 207 partialFailure without hiding error
        forceR2DeleteFailure = true;
        const delPartialRes = await fetch(`${baseUrl}/api/admin/store/products/${prodR2Fail.id}`, {
          method: 'DELETE',
          headers: authHeaders,
        });
        assert.equal(delPartialRes.status, 207, 'Failed cloud media deletion must return 207 partialFailure');
        const delPartialJson = (await delPartialRes.json()) as any;
        assert.equal(delPartialJson.success, false);
        assert.equal(delPartialJson.partialFailure, true);
        assert.equal(delPartialJson.dbDeleted, true);
        assert.equal(delPartialJson.failedMediaFiles.length, 1);
        assert.ok(
          getSecurityAuditLogs().entries.some((e) => e.event === 'HARD_DELETE_PARTIAL_FAILURE'),
          'Audit log must record HARD_DELETE_PARTIAL_FAILURE'
        );

        console.log('✓ 4. Cloudflare R2 S3v4 DELETE & HTTP 207 partial failure reporting passed');
      } finally {
        delete process.env.R2_ENDPOINT;
        delete process.env.R2_ACCESS_KEY_ID;
        delete process.env.R2_SECRET_ACCESS_KEY;
        delete process.env.R2_BUCKET_NAME;
        delete process.env.R2_PUBLIC_URL;
        mockR2Server.close();
      }
    }

    // 5. Legal Retention for Paid Orders (409 Conflict) vs Hard Delete for Unpaid Orders (200)
    {
      const paidOrderRes = await fetch(`${baseUrl}/api/admin/orders`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'حريف طلب مدفوع',
          customerPhone: '+216 22 111 222',
          city: 'تونس',
          totalAmount: 250,
          paymentMethod: 'bank_transfer',
          paymentStatus: 'Paid',
        }),
      });
      assert.equal(paidOrderRes.status, 200);
      const paidOrder = ((await paidOrderRes.json()) as any).order;

      const unpaidOrderRes = await fetch(`${baseUrl}/api/admin/orders`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'حريف طلب غير مدفوع',
          customerPhone: '+216 22 333 444',
          city: 'أريانة',
          totalAmount: 90,
          paymentMethod: 'cod',
          paymentStatus: 'Awaiting Payment',
        }),
      });
      assert.equal(unpaidOrderRes.status, 200);
      const unpaidOrder = ((await unpaidOrderRes.json()) as any).order;

      // Attempt hard delete on Paid order -> must return 409 Conflict
      const delPaid = await fetch(`${baseUrl}/api/admin/orders/${paidOrder.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.equal(delPaid.status, 409, 'Paid financial order must NOT be hard-deleted (409 Conflict)');

      // Hard delete Unpaid COD order -> must succeed (200) & remove from overview
      const delUnpaid = await fetch(`${baseUrl}/api/admin/orders/${unpaidOrder.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.equal(delUnpaid.status, 200);

      const overview = (await (
        await fetch(`${baseUrl}/api/admin/payments/overview`, { headers: authHeaders })
      ).json()) as any;
      assert.equal(overview.orders.some((o: any) => o.id === paidOrder.id), true);
      assert.equal(overview.orders.some((o: any) => o.id === unpaidOrder.id), false);

      console.log('✓ 5. Legal retention on Paid orders (409) & hard delete on Unpaid orders passed');
    }

    // 6. Category, Company (with uploaded logo deletion), Banner, & Chat Thread Hard Deletes
    {
      // Upload logo for company
      const logoUpload = (await (
        await fetch(`${baseUrl}/api/admin/media/upload`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'image/png', 'X-File-Name': 'partner-logo.png' },
          body: VALID_PNG_BUF,
        })
      ).json()) as any;

      const stateNow = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
      const customCat = { id: 'cat_del_test', label: 'قسم اختبار', icon: '🧪', desc: 'اختبار' };
      const customComp = {
        id: 'comp_del_test',
        name: 'شركة اختبار الحذف',
        sector: 'صناعة',
        governorate: 'تونس',
        phone: '+216 70 000 000',
        email: 'test@comp.tn',
        verified: true,
        logo: logoUpload.url,
      };
      const customBanner = {
        id: 'banner_del_test',
        tag: 'اختبار',
        title: 'بانر للحذف',
        subtitle: 'اختبار الحذف النهائي',
        active: true,
      };

      const prevProdCount = stateNow.products.length;
      await fetch(`${baseUrl}/api/admin/store/state`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories: [...stateNow.categories, customCat],
          companies: [...stateNow.companies, customComp],
          banners: [customBanner, ...stateNow.banners],
        }),
      });

      // Deleting 'all' category must return 400
      const delAllCat = await fetch(`${baseUrl}/api/admin/store/categories/all`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.equal(delAllCat.status, 400);

      // Delete custom category -> products must remain intact
      const delCat = await fetch(`${baseUrl}/api/admin/store/categories/${customCat.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.equal(delCat.status, 200);
      const afterCat = (await (await fetch(`${baseUrl}/api/store/state`)).json()) as any;
      assert.equal(afterCat.categories.some((c: any) => c.id === customCat.id), false);
      assert.equal(afterCat.products.length, prevProdCount, 'Deleting category must never delete products');

      // Delete company -> company & its uploaded logo removed
      const delComp = await fetch(`${baseUrl}/api/admin/store/companies/${customComp.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.equal(delComp.status, 200);
      const delCompJson = (await delComp.json()) as any;
      assert.ok(delCompJson.deletedMediaFiles.includes(logoUpload.url));
      assert.equal((await fetch(`${baseUrl}${logoUpload.url}`)).status, 404);

      // Delete banner
      const delBanner = await fetch(`${baseUrl}/api/admin/store/banners/${customBanner.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.equal(delBanner.status, 200);

      // Chat thread hard delete
      const sessionId = 'chat_del_verify_1';
      const postMsg = await fetch(`${baseUrl}/api/chat/session/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'ar',
          customerLabel: 'زائر اختبار',
          customerText: 'مرحباً، استفسار سريع',
          autoReplyText: 'أهلاً بك',
        }),
      });
      assert.equal(postMsg.status, 200);
      const postMsgJson = (await postMsg.json()) as { chatToken?: string };
      assert.ok(postMsgJson.chatToken && postMsgJson.chatToken.startsWith('chat1.'));

      const noTokenChat = await fetch(`${baseUrl}/api/chat/session/${sessionId}`);
      assert.equal(noTokenChat.status, 403, 'Reading existing chat thread without X-Chat-Token must return 403');

      const delChat = await fetch(`${baseUrl}/api/admin/chat/threads/${sessionId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      assert.equal(delChat.status, 200);
      const chatAfter = (await (await fetch(`${baseUrl}/api/chat/session/${sessionId}`)).json()) as any;
      assert.equal(chatAfter.thread, null);

      console.log('✓ 6. Category, Company (logo media), Banner, and Chat Thread hard deletes passed');
    }

    console.log('✅ All Permanent Hard Delete Verification Tests Passed!');
  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('❌ Hard Delete Verification Tests Failed:', err);
  process.exit(1);
});
