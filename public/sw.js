/* ECHOX STORE Service Worker v3 — Offline PWA App Shell, Versioned Asset Caching & Web Push Alerts */
const SW_FALLBACK_VERSION = 'echox-v3-fallback';
const STATIC_PREFIX = 'echox-static-';
const META_CACHE = 'echox-meta-v3';
const API_CACHE = 'echox-api-v3';
const IMAGE_CACHE = 'echox-images-v3';
const FONT_CACHE = 'echox-fonts-v3';
const META_KEY = '/__echox_sw_meta__';
const MAX_IMAGE_ENTRIES = 80;

const PUBLIC_CACHEABLE_API_PATHS = new Set([
  '/api/store/state',
  '/api/payments/config',
  '/api/chat/config',
  '/api/notifications/public',
]);

const PRIVATE_OR_MUTATING_API_PREFIXES = [
  '/api/admin/',
  '/api/security/',
  '/api/owner/',
  '/api/payments/checkout',
  '/api/payments/bank-transfer/',
  '/api/payments/request-refund',
  '/api/payments/track/',
  '/api/payments/verify-return',
  '/api/support/',
  '/api/chat/thread',
  '/api/vendor/',
];

const FALLBACK_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/images/echox-logo.webp',
  '/assets/aistudio/file_000000003d20821088780f690ee97fed_f8e408f8.png',
  '/assets/images/hero_echox_tunisia_store.webp',
  '/assets/images/product_drill_cordless_pro.webp',
  '/assets/images/product_automotive_headlight.webp',
  '/assets/images/product_digital_multimeter.webp',
  '/pwa-any-192-v2.png',
  '/pwa-any-512-v2.png',
  '/apple-touch-icon-v2.png',
];

const GOOGLE_FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';

let activeStaticCacheNameMemory = null;

async function readActiveStaticCacheName() {
  if (activeStaticCacheNameMemory) return activeStaticCacheNameMemory;
  try {
    const metaCache = await self.caches.open(META_CACHE);
    const metaRes = await metaCache.match(META_KEY);
    if (metaRes) {
      const data = await metaRes.json();
      if (data && typeof data.staticCacheName === 'string' && data.staticCacheName.startsWith(STATIC_PREFIX)) {
        activeStaticCacheNameMemory = data.staticCacheName;
        return data.staticCacheName;
      }
    }
  } catch {
    // ignore
  }
  try {
    const keys = await self.caches.keys();
    const staticKeys = keys.filter((k) => k.startsWith(STATIC_PREFIX));
    if (staticKeys.length > 0) {
      activeStaticCacheNameMemory = staticKeys[staticKeys.length - 1];
      return activeStaticCacheNameMemory;
    }
  } catch {
    // ignore
  }
  return `${STATIC_PREFIX}${SW_FALLBACK_VERSION}`;
}

async function writeActiveStaticCacheMeta(staticCacheName, version) {
  activeStaticCacheNameMemory = staticCacheName;
  try {
    const metaCache = await self.caches.open(META_CACHE);
    await metaCache.put(
      META_KEY,
      new Response(JSON.stringify({ staticCacheName, version, updatedAt: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {
    // ignore
  }
}

async function fetchPrecacheManifest() {
  try {
    const res = await fetch('/sw-precache.json', { cache: 'no-store' });
    if (res && res.ok) {
      const data = await res.json();
      if (data && typeof data.version === 'string' && Array.isArray(data.core)) {
        return data;
      }
    }
  } catch {
    // ignore and fallback
  }
  return {
    version: SW_FALLBACK_VERSION,
    shell: ['/', '/index.html'],
    core: FALLBACK_SHELL_URLS,
    optional: [],
  };
}

async function precacheFontAssets() {
  try {
    const fontCache = await self.caches.open(FONT_CACHE);
    const cssRes = await fetch(GOOGLE_FONT_CSS_URL);
    if (!cssRes || (!cssRes.ok && cssRes.type !== 'opaque')) return;
    await fontCache.put(GOOGLE_FONT_CSS_URL, cssRes.clone());
    if (cssRes.ok) {
      const cssText = await cssRes.text();
      const matches = cssText.match(/https:\/\/fonts\.gstatic\.com\/[^)"'\s]+/g) || [];
      const uniqueFontUrls = Array.from(new Set(matches)).slice(0, 24);
      await Promise.allSettled(
        uniqueFontUrls.map(async (fontUrl) => {
          const existing = await fontCache.match(fontUrl);
          if (existing) return;
          const fontRes = await fetch(fontUrl);
          if (fontRes && (fontRes.ok || fontRes.type === 'opaque')) {
            await fontCache.put(fontUrl, fontRes);
          }
        })
      );
    }
  } catch {
    // Optional font warming never blocks install
  }
}

async function prewarmPublicApis() {
  try {
    const apiCache = await self.caches.open(API_CACHE);
    await Promise.allSettled(
      ['/api/store/state', '/api/payments/config'].map(async (apiPath) => {
        const res = await fetch(apiPath, { cache: 'no-store' });
        if (res && res.ok) {
          await apiCache.put(apiPath, res.clone());
        }
      })
    );
  } catch {
    // Optional API warming never blocks install
  }
}

async function trimCacheEntries(cacheName, maxEntries) {
  try {
    const cache = await self.caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const excess = keys.length - maxEntries;
    await Promise.all(keys.slice(0, excess).map((req) => cache.delete(req)));
  } catch {
    // ignore
  }
}

function isHtmlContentType(res) {
  const ct = (res && res.headers && res.headers.get && res.headers.get('content-type')) || '';
  return ct.toLowerCase().includes('text/html');
}

function isImagePath(url) {
  return (
    url.pathname.startsWith('/assets/images/') ||
    url.pathname.startsWith('/assets/aistudio/') ||
    /^\/(pwa-|apple-touch-icon).*\.(png|webp|jpg|jpeg|ico)$/i.test(url.pathname) ||
    /\.(webp|png|jpg|jpeg|gif|svg|ico)$/i.test(url.pathname)
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const manifest = await fetchPrecacheManifest();
      const staticCacheName = `${STATIC_PREFIX}${manifest.version}`;
      const staticCache = await self.caches.open(staticCacheName);

      const coreUrls = Array.from(new Set([...(manifest.shell || ['/', '/index.html']), ...(manifest.core || [])]));
      const optionalUrls = Array.from(new Set(manifest.optional || []));

      // Core HTML + CSS + JS bundles MUST cache cleanly during install
      const coreResults = await Promise.all(
        coreUrls.map(async (url) => {
          const isShellOrManifest = url === '/' || url === '/index.html' || url.startsWith('/manifest');
          const res = await fetch(url, { cache: isShellOrManifest ? 'reload' : 'default' });
          if (!res || !res.ok) {
            throw new Error(`Failed precache core asset: ${url} (${res ? res.status : 'network'})`);
          }
          if (/\.(js|css)$/i.test(url) && isHtmlContentType(res)) {
            throw new Error(`Invalid HTML response for core asset: ${url}`);
          }
          await staticCache.put(url, res);
          return url;
        })
      );

      // Ensure '/' is always mirrored if only '/index.html' was listed or vice versa
      const rootMatch = await staticCache.match('/');
      const indexMatch = await staticCache.match('/index.html');
      if (!rootMatch && indexMatch) {
        await staticCache.put('/', indexMatch.clone());
      } else if (!indexMatch && rootMatch) {
        await staticCache.put('/index.html', rootMatch.clone());
      }

      if (optionalUrls.length > 0) {
        await Promise.allSettled(
          optionalUrls.map(async (url) => {
            const res = await fetch(url);
            if (res && res.ok) {
              await staticCache.put(url, res);
            }
          })
        );
      }

      // Opportunistically warm Google Fonts & initial public store catalog
      await Promise.allSettled([precacheFontAssets(), prewarmPublicApis()]);

      await writeActiveStaticCacheMeta(staticCacheName, manifest.version);
      if (coreResults.length > 0) {
        await self.skipWaiting();
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const activeStaticCacheName = await readActiveStaticCacheName();
      const allowedCaches = new Set([
        activeStaticCacheName,
        META_CACHE,
        API_CACHE,
        IMAGE_CACHE,
        FONT_CACHE,
      ]);

      if (self.caches && typeof self.caches.keys === 'function') {
        const keys = await self.caches.keys();
        await Promise.all(
          keys.filter((key) => !allowedCaches.has(key)).map((key) => self.caches.delete(key))
        );
      }

      await self.clients.claim();

      try {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
          client.postMessage({
            type: 'ECHOX_SW_UPDATED',
            cacheName: activeStaticCacheName,
          });
        }
      } catch {
        // ignore client broadcast failures
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function handleNavigationRequest(request) {
  const staticCacheName = await readActiveStaticCacheName();
  const staticCache = await self.caches.open(staticCacheName);

  try {
    const networkRes = await fetch(request);
    if (networkRes && networkRes.ok && isHtmlContentType(networkRes)) {
      await staticCache.put('/', networkRes.clone());
      return networkRes;
    }
    if (networkRes && networkRes.status < 500) {
      return networkRes;
    }
  } catch {
    // Offline fallback below
  }

  const cachedShell =
    (await staticCache.match('/')) ||
    (await staticCache.match('/index.html')) ||
    (await self.caches.match('/')) ||
    (await self.caches.match('/index.html'));

  if (cachedShell) {
    return cachedShell;
  }

  return new Response(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ECHOX STORE — وضع عدم الاتصال</title><style>body{margin:0;font-family:system-ui,sans-serif;background:#0B0F17;color:#F8FAFC;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}.card{max-width:420px;background:#111827;border:1px solid #1E293B;border-radius:20px;padding:28px}h1{font-size:20px;margin:0 0 10px;color:#FF6B00}p{font-size:14px;line-height:1.6;color:#CBD5E1;margin:0 0 18px}button{background:#FF6B00;color:#fff;border:0;border-radius:12px;padding:12px 22px;font-weight:700;cursor:pointer}</style></head><body><div class="card"><h1>ECHOX STORE</h1><p>أنت غير متصل بالإنترنت حالياً ولم يتم العثور على نسخة محفوظة من الواجهة. أعد الاتصال ثم أعد المحاولة.</p><button onclick="location.reload()">إعادة المحاولة</button></div></body></html>`,
    {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

async function handleHashedStaticAsset(request) {
  const staticCacheName = await readActiveStaticCacheName();
  const staticCache = await self.caches.open(staticCacheName);

  const cached = (await staticCache.match(request)) || (await self.caches.match(request));
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(request);
    if (res && res.ok && !isHtmlContentType(res)) {
      await staticCache.put(request, res.clone());
    }
    return res;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline Asset Unavailable' });
  }
}

async function handleNetworkFirstStatic(request) {
  const staticCacheName = await readActiveStaticCacheName();
  const staticCache = await self.caches.open(staticCacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      await staticCache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = (await staticCache.match(request)) || (await self.caches.match(request));
    return cached || new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function handleFontRequest(request, url) {
  const fontCache = await self.caches.open(FONT_CACHE);
  const cached = await fontCache.match(request);

  if (url.hostname === 'fonts.gstatic.com') {
    if (cached) return cached;
    try {
      const res = await fetch(request);
      if (res && (res.ok || res.type === 'opaque')) {
        await fontCache.put(request, res.clone());
      }
      return res;
    } catch {
      return new Response('', { status: 503, statusText: 'Offline Font Unavailable' });
    }
  }

  // fonts.googleapis.com CSS: Stale-While-Revalidate
  const networkPromise = fetch(request)
    .then(async (res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        await fontCache.put(request, res.clone());
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }
  const fresh = await networkPromise;
  return fresh || new Response('', { status: 503, statusText: 'Offline Font CSS Unavailable' });
}

async function handleImageRequest(request, isSameOrigin) {
  const staticCacheName = await readActiveStaticCacheName();
  const staticCache = await self.caches.open(staticCacheName);
  const staticMatch = await staticCache.match(request);
  if (staticMatch) {
    return staticMatch;
  }

  const imageCache = await self.caches.open(IMAGE_CACHE);
  const cached = await imageCache.match(request);

  const networkPromise = fetch(request)
    .then(async (res) => {
      if (res && isSameOrigin && isHtmlContentType(res)) {
        return new Response('', { status: 503, statusText: 'Invalid HTML Response For Image' });
      }
      if (res && ((res.ok && !isHtmlContentType(res)) || (res.type === 'opaque' && !isSameOrigin))) {
        await imageCache.put(request, res.clone());
        await trimCacheEntries(IMAGE_CACHE, MAX_IMAGE_ENTRIES);
      }
      return res;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const networkRes = await networkPromise;
  if (networkRes) {
    return networkRes;
  }

  // Fallback to precached store logo for local missing images only if requested from assets/images
  return new Response('', { status: 503, statusText: 'Offline Image Unavailable' });
}

async function handlePublicApiRequest(request, url) {
  const apiCache = await self.caches.open(API_CACHE);
  const cacheKey = url.pathname;

  try {
    const res = await fetch(request);
    if (res && res.ok) {
      await apiCache.put(cacheKey, res.clone());
      return res;
    }
    if (res && res.status < 500) {
      return res;
    }
  } catch {
    // Offline fallback below
  }

  const cached = await apiCache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-ECHOX-Cache', 'OFFLINE');
    const body = await cached.text();
    return new Response(body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }

  return new Response(
    JSON.stringify({
      success: false,
      offline: true,
      error: 'أنت غير متصل بالإنترنت ولا توجد بيانات محفوظة لهذا الطلب بعد.',
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-ECHOX-Cache': 'OFFLINE-MISS',
      },
    }
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!request || request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const isSameOrigin = url.origin === self.location.origin;

  // Never cache SW itself or its precache manifest
  if (isSameOrigin && (url.pathname === '/sw.js' || url.pathname === '/sw-precache.json')) {
    return;
  }

  // Never intercept or cache private, security, owner, or mutating API endpoints
  if (isSameOrigin && url.pathname.startsWith('/api/')) {
    if (PRIVATE_OR_MUTATING_API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
      return;
    }
    if (PUBLIC_CACHEABLE_API_PATHS.has(url.pathname)) {
      event.respondWith(handlePublicApiRequest(request, url));
      return;
    }
    return;
  }

  // Navigation requests (SPA App Shell)
  if (isSameOrigin && request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // Google Fonts
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(handleFontRequest(request, url));
    return;
  }

  // Ignore unrelated third-party scripts (e.g., GTM/gtag)
  if (!isSameOrigin) {
    if (request.destination === 'image') {
      event.respondWith(handleImageRequest(request, false));
    }
    return;
  }

  // Same-origin hashed JS/CSS chunks
  if (url.pathname.startsWith('/assets/') && /\.(js|css|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith(handleHashedStaticAsset(request));
    return;
  }

  // Same-origin manifest & icons & local images
  if (isImagePath(url) || request.destination === 'image') {
    event.respondWith(handleImageRequest(request, true));
    return;
  }

  if (
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/manifest.json' ||
    request.destination === 'style' ||
    request.destination === 'script'
  ) {
    event.respondWith(handleNetworkFirstStatic(request));
  }
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'ECHOX Store',
    body: 'لديك إشعار جديد في المتجر.',
    icon: '/pwa-any-192-v2.png',
    badge: '/pwa-any-192-v2.png',
    tag: 'echox-general',
    url: '/',
    severity: 'info',
    requireInteraction: false,
    renotify: true,
    timestamp: Date.now(),
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch {
      try {
        payload.body = event.data.text();
      } catch {
        // ignore
      }
    }
  }

  const isCritical = payload.severity === 'critical' || payload.severity === 'warning';
  const vibrate = isCritical ? [300, 120, 300, 120, 300] : [200, 100, 200];

  event.waitUntil(
    self.registration.showNotification(payload.title || 'ECHOX Store', {
      body: payload.body || '',
      icon: payload.icon || '/pwa-any-192-v2.png',
      badge: payload.badge || '/pwa-any-192-v2.png',
      tag: payload.tag || `echox-${Date.now()}`,
      renotify: payload.renotify !== false,
      requireInteraction: Boolean(payload.requireInteraction || isCritical),
      vibrate,
      dir: 'rtl',
      lang: 'ar',
      data: {
        url: payload.url || '/',
        severity: payload.severity || 'info',
      },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          try {
            client.postMessage({ type: 'ECHOX_NOTIFICATION_CLICK', url: targetUrl });
          } catch {
            // ignore
          }
          if ('navigate' in client && targetUrl && targetUrl !== '/') {
            return client.navigate(targetUrl).catch(() => client);
          }
          return client;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
