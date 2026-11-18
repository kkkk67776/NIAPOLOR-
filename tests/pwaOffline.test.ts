import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(process.cwd());
const DIST_DIR = path.join(ROOT, 'dist');
const PUBLIC_DIR = path.join(ROOT, 'public');

interface PrecacheManifest {
  version: string;
  generatedAt: string;
  shell: string[];
  core: string[];
  optional: string[];
}

function normalizeCacheKey(input: string | { url?: string }): string {
  const raw = typeof input === 'string' ? input : input?.url || '';
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const u = new URL(raw);
    if (u.origin === 'https://echox.local') {
      return `${u.pathname}${u.search}`;
    }
    return u.toString();
  }
  return raw;
}

function createMemoryCacheStorage() {
  const stores = new Map<string, Map<string, Response>>();

  const makeCache = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name)!;
    return {
      async match(req: string | { url?: string }) {
        const key = normalizeCacheKey(req);
        const hit = map.get(key);
        return hit ? hit.clone() : undefined;
      },
      async put(req: string | { url?: string }, res: Response) {
        const key = normalizeCacheKey(req);
        map.set(key, res.clone());
      },
      async delete(req: string | { url?: string }) {
        const key = normalizeCacheKey(req);
        return map.delete(key);
      },
      async keys() {
        return Array.from(map.keys()).map((k) => ({
          url: k.startsWith('/') ? `https://echox.local${k}` : k,
        }));
      },
    };
  };

  return {
    stores,
    caches: {
      async open(name: string) {
        return makeCache(name);
      },
      async keys() {
        return Array.from(stores.keys());
      },
      async delete(name: string) {
        return stores.delete(name);
      },
      async match(req: string | { url?: string }) {
        const key = normalizeCacheKey(req);
        for (const map of stores.values()) {
          const hit = map.get(key);
          if (hit) return hit.clone();
        }
        return undefined;
      },
    },
  };
}

function runSwInVm(opts: {
  swCode: string;
  fetchImpl: (input: string | Request, init?: RequestInit) => Promise<Response>;
  preseedStores?: Record<string, Map<string, Response>>;
}) {
  const listeners = new Map<string, ((event: any) => void)[]>();
  const { stores, caches } = createMemoryCacheStorage();
  if (opts.preseedStores) {
    for (const [k, v] of Object.entries(opts.preseedStores)) {
      stores.set(k, v);
    }
  }

  let skipWaitingCalled = false;
  let clientsClaimed = false;
  const postedMessages: any[] = [];

  const selfObj: any = {
    location: new URL('https://echox.local/sw.js'),
    caches,
    registration: {
      showNotification: async () => {},
    },
    skipWaiting: async () => {
      skipWaitingCalled = true;
    },
    clients: {
      claim: async () => {
        clientsClaimed = true;
      },
      matchAll: async () => [
        {
          postMessage: (msg: any) => {
            postedMessages.push(msg);
          },
          focus: () => {},
        },
      ],
      openWindow: async () => undefined,
    },
    addEventListener: (type: string, fn: (event: any) => void) => {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
  };

  const sandbox: any = {
    self: selfObj,
    fetch: opts.fetchImpl,
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
  vm.runInContext(opts.swCode, sandbox);

  const dispatchLifecycle = async (type: 'install' | 'activate') => {
    const fns = listeners.get(type) || [];
    for (const fn of fns) {
      let pending: Promise<any> = Promise.resolve();
      fn({
        waitUntil: (p: Promise<any>) => {
          pending = Promise.resolve(p);
        },
      });
      await pending;
    }
  };

  const dispatchFetch = async (request: {
    url: string;
    method?: string;
    mode?: string;
    destination?: string;
  }): Promise<{ intercepted: boolean; response?: Response }> => {
    const fns = listeners.get('fetch') || [];
    let responsePromise: Promise<Response> | null = null;
    for (const fn of fns) {
      fn({
        request: {
          method: request.method || 'GET',
          mode: request.mode || 'cors',
          destination: request.destination || '',
          url: request.url.startsWith('http') ? request.url : `https://echox.local${request.url}`,
        },
        respondWith: (p: Promise<Response> | Response) => {
          responsePromise = Promise.resolve(p);
        },
      });
    }
    if (!responsePromise) return { intercepted: false };
    return { intercepted: true, response: await responsePromise };
  };

  return {
    stores,
    caches,
    dispatchLifecycle,
    dispatchFetch,
    getFlags: () => ({ skipWaitingCalled, clientsClaimed, postedMessages }),
  };
}

function getContentTypeForFile(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json') || filePath.endsWith('.webmanifest')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function runTests() {
  console.log('Running PWA Offline & Service Worker Verification Tests...');

  // 1. Validate dist build & sw-precache.json completeness
  assert.ok(fs.existsSync(DIST_DIR), 'dist/ directory must exist (run npm run build first)');
  const distIndexPath = path.join(DIST_DIR, 'index.html');
  const precachePath = path.join(DIST_DIR, 'sw-precache.json');
  assert.ok(fs.existsSync(distIndexPath), 'dist/index.html must exist');
  assert.ok(fs.existsSync(precachePath), 'dist/sw-precache.json must exist');

  const distHtml = fs.readFileSync(distIndexPath, 'utf-8');
  const precacheManifest = JSON.parse(fs.readFileSync(precachePath, 'utf-8')) as PrecacheManifest;

  assert.ok(precacheManifest.version.startsWith('echox-'), 'Precache version must be echox-<hash>');
  assert.ok(precacheManifest.shell.includes('/'), 'Shell must include /');
  assert.ok(precacheManifest.shell.includes('/index.html'), 'Shell must include /index.html');

  // Every <script src="/assets/..."> and <link href="/assets/..."> in dist/index.html must exist on disk & be precached
  const htmlAssetMatches = Array.from(distHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)).map((m) => m[1]);
  assert.ok(htmlAssetMatches.length >= 2, 'dist/index.html must reference built JS & CSS bundles');
  for (const assetUrl of htmlAssetMatches) {
    assert.ok(precacheManifest.core.includes(assetUrl), `Core precache list missing HTML entry bundle: ${assetUrl}`);
    assert.ok(fs.existsSync(path.join(DIST_DIR, assetUrl.slice(1))), `Built asset missing on disk: ${assetUrl}`);
  }

  // Every lazy chunk in dist/assets/*.js must be included in core precache
  const allDistAssets = fs.readdirSync(path.join(DIST_DIR, 'assets'));
  const jsCssChunks = allDistAssets
    .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
    .map((f) => `/assets/${f}`);
  assert.ok(jsCssChunks.some((f) => f.endsWith('.css')), 'At least one compiled CSS bundle must exist');
  assert.ok(jsCssChunks.some((f) => f.endsWith('.js')), 'At least one compiled JS bundle must exist');
  for (const chunk of jsCssChunks) {
    assert.ok(precacheManifest.core.includes(chunk), `Lazy/core bundle missing from sw-precache.json: ${chunk}`);
  }

  // Verify logos & core offline icons
  const mandatoryBrandAssets = [
    '/assets/images/echox-logo.webp',
    '/assets/aistudio/file_000000003d20821088780f690ee97fed_f8e408f8.png',
    '/pwa-any-192-v2.png',
    '/pwa-any-512-v2.png',
    '/apple-touch-icon-v2.png',
    '/manifest.webmanifest',
  ];
  for (const asset of mandatoryBrandAssets) {
    assert.ok(precacheManifest.core.includes(asset), `Core precache missing mandatory asset: ${asset}`);
    assert.ok(fs.existsSync(path.join(DIST_DIR, asset.slice(1))), `Dist missing mandatory asset: ${asset}`);
  }

  // Verify Index.html critical offline failsafe CSS and viewport meta
  assert.ok(distHtml.includes('viewport-fit=cover'), 'index.html viewport must include viewport-fit=cover');
  assert.ok(distHtml.includes(':where(img[data-echox-logo])'), 'index.html must contain 0-specificity logo size guard');

  // 2. Verify manifest.webmanifest & _headers
  const webmanifest = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.webmanifest'), 'utf-8'));
  const fallbackManifest = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf-8'));
  for (const m of [webmanifest, fallbackManifest]) {
    assert.equal(m.id, '/');
    assert.equal(m.start_url, '/');
    assert.equal(m.scope, '/');
    assert.equal(m.display, 'standalone');
    for (const icon of m.icons || []) {
      assert.ok(fs.existsSync(path.join(PUBLIC_DIR, icon.src.replace(/^\//, ''))), `Manifest icon missing: ${icon.src}`);
    }
  }

  const headersFile = fs.readFileSync(path.join(PUBLIC_DIR, '_headers'), 'utf-8');
  assert.ok(headersFile.includes('/sw-precache.json'), '_headers must configure /sw-precache.json');
  assert.ok(headersFile.includes('/index.html'), '_headers must configure /index.html no-cache');
  assert.ok(headersFile.includes('immutable'), '_headers must mark hashed assets immutable');

  // 3. Simulate real public/sw.js lifecycle + Offline PWA fetch handling
  const swCode = fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf-8');
  let networkOnline = true;
  let currentManifest = precacheManifest;

  const onlineFetch = async (input: string | Request): Promise<Response> => {
    if (!networkOnline) {
      throw new TypeError('Failed to fetch (simulated offline)');
    }
    const raw = typeof input === 'string' ? input : input.url;
    const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://echox.local${raw}`);

    if (url.hostname === 'fonts.googleapis.com') {
      return new Response(
        `@font-face { font-family: 'Cairo'; src: url(https://fonts.gstatic.com/s/cairo/v28/SLXVc1nY6HkvangtZmpQdkhzfH5lkSscQyyS8J4.woff2) format('woff2'); }`,
        { status: 200, headers: { 'Content-Type': 'text/css' } }
      );
    }
    if (url.hostname === 'fonts.gstatic.com') {
      return new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), {
        status: 200,
        headers: { 'Content-Type': 'font/woff2' },
      });
    }
    if (url.pathname === '/sw-precache.json') {
      return new Response(JSON.stringify(currentManifest), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === '/api/store/state') {
      return new Response(
        JSON.stringify({
          products: [{ id: 'p1', name: { ar: 'مثقاب احترافي' }, price: 295 }],
          categories: [{ id: 'tools', label: 'Tools' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.pathname === '/api/payments/config') {
      return new Response(JSON.stringify({ currency: 'د.ت', methods: { cod: { enabled: true } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const relPath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const fullDiskPath = path.join(DIST_DIR, relPath);
    if (fs.existsSync(fullDiskPath) && fs.statSync(fullDiskPath).isFile()) {
      const buf = fs.readFileSync(fullDiskPath);
      return new Response(buf, {
        status: 200,
        headers: { 'Content-Type': getContentTypeForFile(fullDiskPath) },
      });
    }
    return new Response('Not found', { status: 404 });
  };

  // Pre-seed stale v2 caches to ensure activate deletes old caches
  const staleV2Map = new Map<string, Response>();
  staleV2Map.set('/old', new Response('stale', { status: 200 }));
  const staleStaticMap = new Map<string, Response>();
  staleStaticMap.set('/assets/old.js', new Response('stale()', { status: 200 }));

  const swEnv = runSwInVm({
    swCode,
    fetchImpl: onlineFetch,
    preseedStores: {
      'echox-sw-v2': staleV2Map,
      'echox-static-echox-old999': staleStaticMap,
    },
  });

  await swEnv.dispatchLifecycle('install');
  await swEnv.dispatchLifecycle('activate');

  const flags = swEnv.getFlags();
  assert.equal(flags.skipWaitingCalled, true, 'SW install should call skipWaiting()');
  assert.equal(flags.clientsClaimed, true, 'SW activate should call clients.claim()');
  assert.ok(flags.postedMessages.some((m) => m.type === 'ECHOX_SW_UPDATED'), 'SW should broadcast ECHOX_SW_UPDATED');

  const cacheNames = Array.from(swEnv.stores.keys());
  assert.ok(!cacheNames.includes('echox-sw-v2'), 'Stale echox-sw-v2 cache must be deleted on activate');
  assert.ok(!cacheNames.includes('echox-static-echox-old999'), 'Old release static cache must be deleted on activate');
  assert.ok(cacheNames.includes(`echox-static-${precacheManifest.version}`), 'Active versioned static cache must exist');
  assert.ok(cacheNames.includes('echox-fonts-v3'), 'Font cache must be warmed during install');
  assert.ok(cacheNames.includes('echox-api-v3'), 'Public store API cache must be warmed during install');

  // Switch network COMPLETELY OFFLINE
  networkOnline = false;

  // Navigation requests offline ('/' and nested route '/companies') must return HTML App Shell 200 OK
  const navHome = await swEnv.dispatchFetch({ url: '/', mode: 'navigate', destination: 'document' });
  assert.equal(navHome.intercepted, true);
  assert.equal(navHome.response?.status, 200);
  const homeText = await navHome.response!.text();
  assert.ok(homeText.includes('<div id="root">'), 'Offline / navigation must serve full React App Shell HTML');

  const navDeep = await swEnv.dispatchFetch({ url: '/companies', mode: 'navigate', destination: 'document' });
  assert.equal(navDeep.intercepted, true);
  assert.equal(navDeep.response?.status, 200);
  assert.ok((await navDeep.response!.text()).includes('<div id="root">'), 'Deep route navigation offline must fall back to App Shell HTML');

  // Hashed CSS + JS + Logos offline must all return 200 OK with valid non-HTML content
  for (const assetUrl of [...htmlAssetMatches, '/assets/images/echox-logo.webp', '/assets/aistudio/file_000000003d20821088780f690ee97fed_f8e408f8.png']) {
    const dest = assetUrl.endsWith('.css') ? 'style' : assetUrl.endsWith('.js') ? 'script' : 'image';
    const resWrap = await swEnv.dispatchFetch({ url: assetUrl, destination: dest });
    assert.equal(resWrap.intercepted, true, `SW must handle ${assetUrl}`);
    assert.equal(resWrap.response?.status, 200, `Offline cached asset failed: ${assetUrl}`);
    if (assetUrl.endsWith('.js') || assetUrl.endsWith('.css')) {
      const ct = resWrap.response?.headers.get('content-type') || '';
      assert.ok(!ct.includes('text/html'), `Asset ${assetUrl} must never serve HTML fallback`);
    }
  }

  // Fonts offline
  const offlineFontCss = await swEnv.dispatchFetch({
    url: 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
    destination: 'style',
  });
  assert.equal(offlineFontCss.intercepted, true);
  assert.equal(offlineFontCss.response?.status, 200);

  const offlineWoff2 = await swEnv.dispatchFetch({
    url: 'https://fonts.gstatic.com/s/cairo/v28/SLXVc1nY6HkvangtZmpQdkhzfH5lkSscQyyS8J4.woff2',
    destination: 'font',
  });
  assert.equal(offlineWoff2.intercepted, true);
  assert.equal(offlineWoff2.response?.status, 200);

  // Public API offline fallback MUST return cached JSON with X-ECHOX-Cache: OFFLINE
  const offlineStoreApi = await swEnv.dispatchFetch({ url: '/api/store/state' });
  assert.equal(offlineStoreApi.intercepted, true);
  assert.equal(offlineStoreApi.response?.status, 200);
  assert.equal(offlineStoreApi.response?.headers.get('X-ECHOX-Cache'), 'OFFLINE');
  const offlineJson = await offlineStoreApi.response!.json();
  assert.equal(offlineJson.products[0].id, 'p1');

  // Private / Mutating / Auth / Checkout endpoints MUST NEVER be cached or intercepted by SW
  for (const privateEndpoint of [
    { url: '/api/admin/store/state', method: 'GET' },
    { url: '/api/security/status', method: 'GET' },
    { url: '/api/owner/sessions', method: 'GET' },
    { url: '/api/payments/track/ECH-TN-981240', method: 'GET' },
    { url: '/api/payments/checkout', method: 'POST' },
    { url: '/api/support/contribute', method: 'POST' },
  ]) {
    const priv = await swEnv.dispatchFetch(privateEndpoint);
    assert.equal(priv.intercepted, false, `SW must NOT intercept sensitive endpoint: ${privateEndpoint.method} ${privateEndpoint.url}`);
  }

  // Uncached missing external product image returns clean 503 (never HTML or crash)
  const missingImg = await swEnv.dispatchFetch({
    url: 'https://cdn.example.com/uncached-part.webp',
    destination: 'image',
  });
  assert.equal(missingImg.intercepted, true);
  assert.equal(missingImg.response?.status, 503);

  // 4. Simulate New Release Rollout (Network reconnects + manifest version bumps)
  networkOnline = true;
  currentManifest = {
    ...precacheManifest,
    version: 'echox-nextrelease99',
  };
  await swEnv.dispatchLifecycle('install');
  await swEnv.dispatchLifecycle('activate');

  const postUpgradeCaches = Array.from(swEnv.stores.keys());
  assert.ok(
    postUpgradeCaches.includes('echox-static-echox-nextrelease99'),
    'New release versioned static cache must exist'
  );
  assert.ok(
    !postUpgradeCaches.includes(`echox-static-${precacheManifest.version}`),
    'Previous release versioned static cache must be purged after activation'
  );

  console.log('✓ All PWA Offline & Service Worker verification tests passed!');
}

runTests().catch((err) => {
  console.error('❌ PWA Offline test failed:', err);
  process.exit(1);
});
