/* ECHOX STORE Service Worker v2 — Push Notifications, Mobile Control Room Alerts & PWA Icon Cache Refresh */
const SW_VERSION = 'echox-sw-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (self.caches && typeof self.caches.keys === 'function') {
        const keys = await self.caches.keys();
        await Promise.all(
          keys.filter((key) => key !== SW_VERSION).map((key) => self.caches.delete(key))
        );
      }
      await self.clients.claim();
    })()
  );
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
