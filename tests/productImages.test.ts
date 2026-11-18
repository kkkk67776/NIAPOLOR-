import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { handleStoreImageError, handleStoreImageLoad, FALLBACK_STORE_IMAGE } from '../src/lib/imageFallback';
import { normalizeProductImageUrl, splitImageUrlsInput } from '../src/lib/imageUrl';
import { inspectImageUrlOnServer } from '../server/mediaInspector';
import { getPublicStoreState, updateAdminStoreState, getStoreRecoverySnapshot, restoreStoreRecoverySnapshot } from '../server/storeEngine';

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

async function runTests() {
  console.log('Running Product Images Diagnosis & Verification Tests...');

  // 1. URL Normalization, Wrapper Unwrapping, Webpage & Protocol Detection
  {
    const directWebp = normalizeProductImageUrl('  "https://cdn.example.com/tools/drill.webp"  ');
    assert.equal(directWebp.url, 'https://cdn.example.com/tools/drill.webp');
    assert.equal(directWebp.issue, undefined);

    const protoRel = normalizeProductImageUrl('//cdn.example.com/parts/headlight.jpg');
    assert.equal(protoRel.url, 'https://cdn.example.com/parts/headlight.jpg');
    assert.equal(protoRel.issue, undefined);

    const gDrive = normalizeProductImageUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing');
    assert.equal(gDrive.url, 'https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz');
    assert.equal(gDrive.issue, undefined);

    const gImages = normalizeProductImageUrl(
      'https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fdrill.png&imgrefurl=https%3A%2F%2Fexample.com'
    );
    assert.equal(gImages.url, 'https://cdn.example.com/drill.png');
    assert.equal(gImages.issue, undefined);

    const dropbox = normalizeProductImageUrl('https://www.dropbox.com/s/abc123/product.jpg?dl=0');
    assert.equal(dropbox.url, 'https://www.dropbox.com/s/abc123/product.jpg?raw=1');
    assert.equal(dropbox.issue, undefined);

    const httpInsecure = normalizeProductImageUrl('http://cdn.example.com/photo.jpg');
    assert.equal(httpInsecure.issue, 'http_insecure');

    const webpage = normalizeProductImageUrl('https://unsplash.com/photos/electric-drill-xyz');
    assert.equal(webpage.issue, 'suspected_webpage');

    const htmlPage = normalizeProductImageUrl('https://shop.example.com/product/123.html');
    assert.equal(htmlPage.issue, 'suspected_webpage');

    const jsScheme = normalizeProductImageUrl('javascript:alert(1)');
    assert.equal(jsScheme.issue, 'unsupported_scheme');

    const multi = splitImageUrlsInput(' https://cdn.example.com/a.jpg \n //cdn.example.com/b.webp \n');
    assert.deepEqual(multi, ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.webp']);
    console.log('✓ 1. URL normalization, unwrapping & webpage/protocol detection passed');
  }

  // 2. Server Media Inspector: Local Assets, Data URIs (JPEG/PNG/WebP) & SSRF Defense
  {
    const localRes = await inspectImageUrlOnServer('/assets/images/product_drill_cordless_pro.webp');
    assert.equal(localRes.ok, true);
    assert.equal(localRes.kind, 'image');
    assert.equal(localRes.format, 'WebP');

    const missingLocalRes = await inspectImageUrlOnServer('/assets/images/does-not-exist-999.webp');
    assert.equal(missingLocalRes.ok, false);
    assert.equal(missingLocalRes.statusCode, 404);

    for (const [mime, buf, expectedFormat] of [
      ['image/jpeg', VALID_JPEG_BUF, 'JPEG'],
      ['image/png', VALID_PNG_BUF, 'PNG'],
      ['image/webp', VALID_WEBP_BUF, 'WebP'],
    ] as const) {
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      const res = await inspectImageUrlOnServer(dataUrl);
      assert.equal(res.ok, true, `Data URL ${mime} must pass`);
      assert.equal(res.kind, 'image');
      assert.equal(res.format, expectedFormat);
    }

    // SSRF Protection: private/loopback IPs must be rejected when allowLoopbackForTest is false
    const ssrfLoopback = await inspectImageUrlOnServer('https://127.0.0.1/secret.png', { allowLoopbackForTest: false });
    assert.equal(ssrfLoopback.ok, false);
    const ssrfMeta = await inspectImageUrlOnServer('https://169.254.169.254/latest/meta-data', { allowLoopbackForTest: false });
    assert.equal(ssrfMeta.ok, false);
    const ssrfLan = await inspectImageUrlOnServer('https://192.168.1.10/cam.jpg', { allowLoopbackForTest: false });
    assert.equal(ssrfLan.ok, false);
    console.log('✓ 2. Server Media Inspector local assets, JPEG/PNG/WebP Data URIs & SSRF protection passed');
  }

  // 3. Server Media Inspector against HTTPS JPEG/PNG/WebP, HTML Webpage (og:image), 403/404, and HTTP->HTTPS Upgrade
  {
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr === 'https://93.184.216.34/pic.jpg') {
          return new Response(VALID_JPEG_BUF, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
        }
        if (urlStr === 'https://93.184.216.34/pic.png') {
          return new Response(VALID_PNG_BUF, { status: 200, headers: { 'Content-Type': 'image/png' } });
        }
        if (urlStr === 'https://93.184.216.34/pic.webp') {
          return new Response(VALID_WEBP_BUF, { status: 200, headers: { 'Content-Type': 'image/webp' } });
        }
        if (urlStr === 'https://93.184.216.34/cdn-no-ext') {
          return new Response(VALID_WEBP_BUF, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
        }
        if (urlStr === 'https://93.184.216.34/product-page') {
          return new Response(
            `<!doctype html><html><head><meta property="og:image" content="https://93.184.216.34/pic.webp" /></head><body>Product HTML</body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
        if (urlStr === 'https://93.184.216.34/forbidden.jpg') {
          return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/html' } });
        }
        if (urlStr === 'https://93.184.216.34/missing.jpg') {
          return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
        }
        return new Response('Unexpected', { status: 500 });
      }) as typeof fetch;

      const jpgRes = await inspectImageUrlOnServer('https://93.184.216.34/pic.jpg');
      assert.equal(jpgRes.ok, true);
      assert.equal(jpgRes.format, 'JPEG');

      const pngRes = await inspectImageUrlOnServer('https://93.184.216.34/pic.png');
      assert.equal(pngRes.ok, true);
      assert.equal(pngRes.format, 'PNG');

      const webpRes = await inspectImageUrlOnServer('https://93.184.216.34/pic.webp');
      assert.equal(webpRes.ok, true);
      assert.equal(webpRes.format, 'WebP');

      const octetRes = await inspectImageUrlOnServer('https://93.184.216.34/cdn-no-ext');
      assert.equal(octetRes.ok, true);
      assert.equal(octetRes.format, 'WebP');

      const htmlRes = await inspectImageUrlOnServer('https://93.184.216.34/product-page');
      assert.equal(htmlRes.ok, false);
      assert.equal(htmlRes.kind, 'webpage');
      assert.equal(htmlRes.suggestedImageUrl, 'https://93.184.216.34/pic.webp');

      const httpUpgradeRes = await inspectImageUrlOnServer('http://93.184.216.34/pic.jpg');
      assert.equal(httpUpgradeRes.ok, false);
      assert.equal(httpUpgradeRes.kind, 'http_insecure');
      assert.equal(httpUpgradeRes.httpsUpgradeUrl, 'https://93.184.216.34/pic.jpg');

      const err403 = await inspectImageUrlOnServer('https://93.184.216.34/forbidden.jpg');
      assert.equal(err403.ok, false);
      assert.equal(err403.statusCode, 403);

      const err404 = await inspectImageUrlOnServer('https://93.184.216.34/missing.jpg');
      assert.equal(err404.ok, false);
      assert.equal(err404.statusCode, 404);
      console.log('✓ 3. Remote JPEG/PNG/WebP inspection, webpage og:image extraction & HTTP->HTTPS upgrade passed');
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // 4. End-to-End Store Product Add & Retrieval (Preserving existing products & image URLs)
  {
    const backupSnapshot = getStoreRecoverySnapshot();
    const initialCount = backupSnapshot.products.length;
    const initialFirstImg = backupSnapshot.products[0]?.images?.[0];

    try {
      const testProduct = {
        id: 'prod_test_img_verify',
        name: { ar: 'منتج اختبار الصور', fr: 'Produit Test Image', en: 'Image Test Product' },
        description: { ar: 'وصف تجريبي', fr: 'Desc', en: 'Desc' },
        category: 'power_tools',
        price: 120.5,
        stock: 5,
        companyId: backupSnapshot.companies[0]?.id || 'comp_echox',
        companyName: backupSnapshot.companies[0]?.name || 'ECHOX',
        governorate: 'tunis',
        images: [
          '  https://cdn.example.com/new-tool.webp  ',
          '//cdn.example.com/new-tool-2.jpg',
          `data:image/png;base64,${VALID_PNG_BUF.toString('base64')}`,
        ],
        rating: 5,
        reviewCount: 0,
        reviews: [],
        deliveryTimeDays: 2,
        active: true,
      };

      const saveRes = await updateAdminStoreState({
        products: [testProduct, ...backupSnapshot.products],
      });
      assert.equal(saveRes.ok, true, `updateAdminStoreState failed: ${saveRes.error}`);

      const pub = getPublicStoreState();
      assert.equal(pub.products.length, initialCount + 1, 'Existing products must be preserved alongside new product');
      const savedTest = pub.products.find((p) => p.id === 'prod_test_img_verify');
      assert.ok(savedTest, 'Newly added product must appear in public store state');
      assert.equal(savedTest!.images[0], 'https://cdn.example.com/new-tool.webp');
      assert.equal(savedTest!.images[1], 'https://cdn.example.com/new-tool-2.jpg');
      assert.ok(savedTest!.images[2].startsWith('data:image/png;base64,'));
      assert.equal(
        pub.products.find((p) => p.id === backupSnapshot.products[0].id)?.images?.[0],
        initialFirstImg,
        'Existing product image URL must remain unchanged'
      );
      console.log('✓ 4. End-to-End store product save & retrieval with JPEG/PNG/WebP URLs passed');
    } finally {
      await restoreStoreRecoverySnapshot(backupSnapshot);
    }
  }

  // 5. Service Worker must NEVER cache SPA text/html fallback into echox-images-v3
  {
    const swCode = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf-8');
    const stores = new Map<string, Map<string, Response>>();
    const listeners = new Map<string, ((event: any) => void)[]>();

    const cachesMock = {
      async open(name: string) {
        if (!stores.has(name)) stores.set(name, new Map());
        const map = stores.get(name)!;
        return {
          async match(req: any) {
            const key = typeof req === 'string' ? req : new URL(req.url).pathname;
            const hit = map.get(key);
            return hit ? hit.clone() : undefined;
          },
          async put(req: any, res: Response) {
            const key = typeof req === 'string' ? req : new URL(req.url).pathname;
            map.set(key, res.clone());
          },
          async delete(req: any) {
            const key = typeof req === 'string' ? req : new URL(req.url).pathname;
            return map.delete(key);
          },
          async keys() {
            return Array.from(map.keys()).map((k) => ({ url: `https://echox.local${k}` }));
          },
        };
      },
      async keys() {
        return Array.from(stores.keys());
      },
      async delete(name: string) {
        return stores.delete(name);
      },
      async match() {
        return undefined;
      },
    };

    const sandbox: any = {
      self: {
        location: new URL('https://echox.local/sw.js'),
        caches: cachesMock,
        addEventListener: (t: string, fn: any) => {
          const list = listeners.get(t) || [];
          list.push(fn);
          listeners.set(t, list);
        },
      },
      fetch: async () => new Response('<html>SPA fallback</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      Response,
      Request,
      Headers,
      URL,
      Promise,
      Set,
      Map,
      Array,
      JSON,
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(swCode, sandbox);

    let resPromise: Promise<Response> | null = null;
    for (const fn of listeners.get('fetch') || []) {
      fn({
        request: {
          method: 'GET',
          mode: 'no-cors',
          destination: 'image',
          url: 'https://echox.local/wrong-relative-image.jpg',
        },
        respondWith: (p: Promise<Response>) => {
          resPromise = Promise.resolve(p);
        },
      });
    }
    const imgRes = await resPromise!;
    assert.equal(imgRes.status, 503, 'SW must reject HTML fallback served for broken local image path');
    const cachedImgs = stores.get('echox-images-v3');
    assert.equal(cachedImgs?.size || 0, 0, 'HTML response must NOT be stored inside echox-images-v3');
    console.log('✓ 5. Service Worker HTML-in-image protection passed');
  }

  // 6. DOM Fallback Reset & Sequential Error Resilience (handleStoreImageError + handleStoreImageLoad)
  {
    const classes = new Set(['w-full', 'h-full', 'object-cover']);
    const attrs: Record<string, string> = { src: 'https://broken-one.example.com/a.jpg' };
    const fakeImg: any = {
      dataset: {} as Record<string, string>,
      classList: {
        contains: (c: string) => classes.has(c),
        add: (...cs: string[]) => cs.forEach((c) => classes.add(c)),
        remove: (...cs: string[]) => cs.forEach((c) => classes.delete(c)),
      },
      getAttribute: (name: string) => attrs[name] || '',
      get src() {
        return attrs.src;
      },
      set src(v: string) {
        attrs.src = v;
      },
    };

    handleStoreImageError({ currentTarget: fakeImg } as any);
    assert.equal(attrs.src, FALLBACK_STORE_IMAGE);
    assert.equal(classes.has('object-contain'), true);
    assert.equal(classes.has('object-cover'), false);

    // Simulate user switching thumbnail to a SECOND broken image URL
    attrs.src = 'https://broken-two.example.com/b.jpg';
    handleStoreImageError({ currentTarget: fakeImg } as any);
    assert.equal(attrs.src, FALLBACK_STORE_IMAGE, 'Fallback must still trigger on a second distinct broken URL');

    // Simulate user switching to a WORKING image URL
    attrs.src = 'https://cdn.example.com/working.webp';
    handleStoreImageLoad({ currentTarget: fakeImg } as any);
    assert.equal(classes.has('object-cover'), true, 'Original object-cover layout must be restored on valid image load');
    assert.equal(fakeImg.dataset.failedSrc, undefined);
    console.log('✓ 6. Sequential fallback & load recovery handler passed');
  }

  console.log('✅ ALL PRODUCT IMAGES VERIFICATION TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Product Images verification failed:', err);
  process.exit(1);
});
