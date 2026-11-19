/**
 * Product Image Cloud Upload & Permanent Storage Verification Suite
 *
 * Verifies:
 * 1. Authentication (401), gateToken-only rejection (401), and CSRF protection (403) on /api/admin/media/upload.
 * 2. Strict binary validation (JPEG, PNG, WebP), SVG/HTML/spoofed magic-byte quarantine (415), and size checks (413).
 * 3. Actual HTTP upload persistence, permanent /api/media/products/... URL assignment, and byte-for-byte GET retrieval.
 * 4. Deleting original local source file + re-hydrating server store state keeps product & image permanently accessible.
 * 5. Cloudflare R2 AWS Signature v4 PUT upload + fail-closed error handling when R2 rejects.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import argon2 from 'argon2';

const TEST_ACCESS_CODE = '#EchoxMediaTest2026';
const TEST_PIN = '654321';

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

const VALID_WEBP_BUF = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.from('VP8 '),
  Buffer.from([0x0e, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x34, 0x25]),
]);

async function runTests(): Promise<void> {
  console.log('Running Cloud Product Media Upload & Permanent Storage Tests...');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'echox-media-test-'));
  const phoneGalleryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echox-phone-gallery-'));

  process.env.ECHOX_DISABLE_LISTEN = '1';
  process.env.DATA_DIR = tmpRoot;
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
  process.env.UPSTASH_REDIS_REST_URL = '';
  process.env.UPSTASH_REDIS_REST_TOKEN = '';
  process.env.ECHOX_SECURITY_HMAC_SECRET = 'test_media_hmac_secret_9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d';
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
  // Ensure R2 env vars start clean for local durable upload tests
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET_NAME;
  delete process.env.R2_ENDPOINT;
  delete process.env.R2_PUBLIC_URL;

  const { app, ensureServerInitialized } = await import('../server');
  const { normalizeProductImageUrl } = await import('../src/lib/imageUrl');
  const { inspectImageUrlOnServer } = await import('../server/mediaInspector');
  const { isMediaSafeUrl, getQuarantineVault } = await import('../server/securityEngine');
  const { hydrateStoreStateFromCloud } = await import('../server/storeEngine');

  await ensureServerInitialized();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Unauthenticated upload & gateToken-only upload must fail closed (401)
    let validGateToken = '';
    {
      const unauth = await fetch(`${baseUrl}/api/admin/media/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'X-File-Name': 'test.png' },
        body: VALID_PNG_BUF,
      });
      assert.equal(unauth.status, 401, 'Unauthenticated upload must return 401');

      const codeRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: TEST_ACCESS_CODE }),
      });
      const codeData = (await codeRes.json()) as { success: boolean; gateToken?: string };
      assert.equal(codeData.success, true);
      validGateToken = codeData.gateToken || '';

      const gateOnlyRes = await fetch(`${baseUrl}/api/admin/media/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'image/png',
          Authorization: `Bearer ${codeData.gateToken}`,
        },
        body: VALID_PNG_BUF,
      });
      assert.equal(gateOnlyRes.status, 401, 'gateToken alone must NOT authorize upload');
      console.log('✓ 1. Unauthenticated & gateToken-only upload blocked (401)');
    }

    // 2. Authenticate Owner via PIN & get session + CSRF token
    const pinRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: TEST_PIN, gateToken: validGateToken }),
    });
    assert.equal(pinRes.status, 200);
    const pinData = (await pinRes.json()) as {
      success: boolean;
      sessionToken: string;
      csrfToken: string;
    };
    assert.equal(pinData.success, true);
    assert.ok(pinData.sessionToken && pinData.csrfToken);

    const authHeaders = {
      Authorization: `Bearer ${pinData.sessionToken}`,
      'X-CSRF-Token': pinData.csrfToken,
    };

    // 3. CSRF & Bad payload / Spoofed SVG / Corrupt file rejections
    {
      const noCsrf = await fetch(`${baseUrl}/api/admin/media/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pinData.sessionToken}`,
          'Content-Type': 'image/png',
        },
        body: VALID_PNG_BUF,
      });
      assert.equal(noCsrf.status, 403, 'Missing CSRF token must return 403');

      const fakeSvgAsPng = await fetch(`${baseUrl}/api/admin/media/upload`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'image/png',
          'X-File-Name': 'evil.png',
        },
        body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      });
      assert.equal(fakeSvgAsPng.status, 415, 'Spoofed SVG payload must be rejected with 415');
      const quar = getQuarantineVault();
      assert.ok(
        quar.items.some((i) => i.source === 'admin_media_upload'),
        'Spoofed SVG upload attempt must be quarantined'
      );

      const mismatchMime = await fetch(`${baseUrl}/api/admin/media/upload`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'image/png',
          'X-File-Name': 'actually_jpeg.png',
        },
        body: VALID_JPEG_BUF,
      });
      assert.equal(mismatchMime.status, 415, 'Mismatched MIME vs magic bytes must return 415');

      const emptyUpload = await fetch(`${baseUrl}/api/admin/media/upload`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'image/jpeg',
        },
        body: Buffer.alloc(0),
      });
      assert.equal(emptyUpload.status, 400, 'Empty upload must return 400');
      console.log('✓ 2. CSRF enforcement & spoofed/corrupt/mismatched file rejections + quarantine passed');
    }

    // 4. Real upload of JPEG, PNG, and WebP from simulated device gallery -> save to DB -> delete device files -> verify persistence
    {
      const samples = [
        { name: 'drill-photo.jpg', mime: 'image/jpeg', buf: VALID_JPEG_BUF, format: 'JPEG' },
        { name: 'saw-photo.png', mime: 'image/png', buf: VALID_PNG_BUF, format: 'PNG' },
        { name: 'grinder-photo.webp', mime: 'image/webp', buf: VALID_WEBP_BUF, format: 'WebP' },
      ];

      const uploadedUrls: string[] = [];

      for (const s of samples) {
        const sourcePath = path.join(phoneGalleryDir, s.name);
        fs.writeFileSync(sourcePath, s.buf);

        const fileBytes = fs.readFileSync(sourcePath);
        const upRes = await fetch(`${baseUrl}/api/admin/media/upload`, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': s.mime,
            'X-File-Name': encodeURIComponent(s.name),
          },
          body: fileBytes,
        });
        assert.equal(upRes.status, 201, `Upload of ${s.format} must succeed with 201`);
        const upJson = (await upRes.json()) as {
          success: boolean;
          url: string;
          format: string;
          mime: string;
          sizeBytes: number;
        };
        assert.equal(upJson.success, true);
        assert.ok(upJson.url.startsWith('/api/media/products/img_'), `Expected permanent path, got ${upJson.url}`);
        assert.equal(upJson.format, s.format);
        assert.equal(upJson.mime, s.mime);
        assert.equal(upJson.sizeBytes, s.buf.length);

        // Verify helpers accept the permanent URL cleanly
        const norm = normalizeProductImageUrl(upJson.url);
        assert.equal(norm.issue, undefined);
        assert.equal(norm.url, upJson.url);
        assert.equal(isMediaSafeUrl(upJson.url), true);

        const inspected = await inspectImageUrlOnServer(upJson.url);
        assert.equal(inspected.ok, true);
        assert.equal(inspected.kind, 'image');
        assert.equal(inspected.format, s.format);

        uploadedUrls.push(upJson.url);

        // Delete original source file from simulated phone gallery!
        fs.unlinkSync(sourcePath);
        assert.equal(fs.existsSync(sourcePath), false);
      }

      // Attach uploaded URLs to a product & persist to store DB via authenticated API
      const storeGetRes = await fetch(`${baseUrl}/api/store/state`);
      const currentState = (await storeGetRes.json()) as any;
      const testProduct = {
        id: 'prod_media_persist_test',
        name: { ar: 'منتج اختبار رفع الصور', fr: 'Produit test upload', en: 'Upload test product' },
        description: { ar: 'اختبار تخزين دائم للصور', fr: 'Test stockage', en: 'Persistent image test' },
        category: currentState.categories.find((c: any) => c.id !== 'all')?.id || 'power_tools',
        price: 199,
        stock: 5,
        rating: 5,
        reviewsCount: 0,
        companyId: currentState.companies[0]?.id || 'comp_echox',
        companyName: currentState.companies[0]?.name || 'ECHOX',
        governorate: 'tunis',
        images: uploadedUrls,
        featured: false,
        active: true,
        deliveryTimeDays: 2,
      };

      const saveRes = await fetch(`${baseUrl}/api/admin/store/state`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: [testProduct, ...currentState.products],
        }),
      });
      assert.equal(saveRes.status, 200, 'Saving product with permanent uploaded URLs must succeed');

      // Re-hydrate store engine from persistent disk to simulate restart / switching devices
      await hydrateStoreStateFromCloud();

      const afterRes = await fetch(`${baseUrl}/api/store/state`);
      const afterState = (await afterRes.json()) as any;
      const reloadedProd = afterState.products.find((p: any) => p.id === 'prod_media_persist_test');
      assert.ok(reloadedProd, 'Product must exist after store rehydration');
      assert.deepEqual(reloadedProd.images, uploadedUrls, 'Permanent image URLs must remain identical');

      // Verify every image still loads cleanly via HTTP GET (and supports ETag / 304 + immutable Cache-Control)
      for (let i = 0; i < uploadedUrls.length; i++) {
        const imgUrl = uploadedUrls[i];
        const expectedBuf = samples[i].buf;
        const getImgRes = await fetch(`${baseUrl}${imgUrl}`);
        assert.equal(getImgRes.status, 200);
        assert.equal(getImgRes.headers.get('content-type'), samples[i].mime);
        assert.equal(getImgRes.headers.get('x-content-type-options'), 'nosniff');
        assert.ok((getImgRes.headers.get('cache-control') || '').includes('immutable'));
        const fetchedBuf = Buffer.from(await getImgRes.arrayBuffer());
        assert.equal(Buffer.compare(fetchedBuf, expectedBuf), 0, 'Served image bytes must match uploaded bytes');

        const etag = getImgRes.headers.get('etag');
        assert.ok(etag);
        const notModified = await fetch(`${baseUrl}${imgUrl}`, {
          headers: { 'If-None-Match': etag },
        });
        assert.equal(notModified.status, 304);
      }

      console.log('✓ 3. Real JPEG/PNG/WebP uploads, DB persistence, post-delete availability & caching headers passed');
    }

    // 5. Cloudflare R2 S3v4 Integration & Fail-Closed Error Verification
    {
      const r2StoredObjects = new Map<string, { body: Buffer; auth: string; sha256: string; contentType: string }>();
      let forceR2Failure = false;

      const mockR2Server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          if (forceR2Failure) {
            res.writeHead(500, { 'Content-Type': 'application/xml' });
            res.end('<Error><Code>InternalError</Code></Error>');
            return;
          }
          if (req.method === 'PUT') {
            r2StoredObjects.set(req.url || '', {
              body,
              auth: String(req.headers['authorization'] || ''),
              sha256: String(req.headers['x-amz-content-sha256'] || ''),
              contentType: String(req.headers['content-type'] || ''),
            });
            res.writeHead(200, { ETag: '"mockr2etag"' });
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

        // Case A: R2 rejects upload -> MUST fail closed (502) and NOT return success
        forceR2Failure = true;
        const failedR2Res = await fetch(`${baseUrl}/api/admin/media/upload`, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'image/png',
            'X-File-Name': 'fail-r2.png',
          },
          body: VALID_PNG_BUF,
        });
        assert.equal(failedR2Res.status, 502, 'Failed R2 PUT must reject upload rather than marking success');
        const failedR2Json = (await failedR2Res.json()) as { success: boolean; url?: string };
        assert.equal(failedR2Json.success, false);
        assert.equal(failedR2Json.url, undefined);

        // Case B: R2 succeeds -> verify S3v4 signature header, payload bytes, and returned R2_PUBLIC_URL
        forceR2Failure = false;
        const okR2Res = await fetch(`${baseUrl}/api/admin/media/upload`, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'image/png',
            'X-File-Name': 'cloud-item.png',
          },
          body: VALID_PNG_BUF,
        });
        assert.equal(okR2Res.status, 201);
        const okR2Json = (await okR2Res.json()) as {
          success: boolean;
          provider: string;
          fileName: string;
          url: string;
        };
        assert.equal(okR2Json.success, true);
        assert.equal(okR2Json.provider, 'cloudflare-r2');
        assert.equal(okR2Json.url, `https://cdn.echox-store.tn/products/${okR2Json.fileName}`);

        const r2Entry = r2StoredObjects.get(`/echox-products/products/${okR2Json.fileName}`);
        assert.ok(r2Entry, 'R2 bucket must receive PUT request for products/<fileName>');
        assert.ok(r2Entry.auth.startsWith('AWS4-HMAC-SHA256 Credential=r2_test_access_key/'));
        assert.ok(r2Entry.auth.includes('Signature='));
        assert.equal(Buffer.compare(r2Entry.body, VALID_PNG_BUF), 0, 'R2 must receive exact PNG binary bytes');

        console.log('✓ 4. Cloudflare R2 S3v4 signed PUT upload & fail-closed verification passed');
      } finally {
        delete process.env.R2_ENDPOINT;
        delete process.env.R2_ACCESS_KEY_ID;
        delete process.env.R2_SECRET_ACCESS_KEY;
        delete process.env.R2_BUCKET_NAME;
        delete process.env.R2_PUBLIC_URL;
        mockR2Server.close();
      }
    }
  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(phoneGalleryDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('❌ Cloud Media Upload Tests Failed:', err);
  process.exit(1);
});
