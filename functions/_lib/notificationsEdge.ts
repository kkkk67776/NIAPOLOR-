import {
  checkEdgeSlidingWindowLimit,
  EdgeEnv,
  getEdgeClientIp,
  jsonResponse,
  loadEdgeDocWithMeta,
  mutateEdgeDocWithRetry,
  randomHex,
  requireEdgeAdminAuth,
  sha256Hex,
} from './firestoreEdge';

export type NotificationCategory = 'order' | 'payment' | 'security' | 'activity' | 'support';
export type NotificationSeverity = 'critical' | 'warning' | 'info' | 'success';

interface StoredPushSubscription {
  id: string;
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
  deviceLabel?: string;
  createdAt: string;
  lastSuccessAt?: string;
}

interface AdminNotificationEvent {
  id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  url: string;
  read: boolean;
  createdAt: string;
  meta?: Record<string, string | number | boolean>;
}

interface PublicStoreAnnouncement {
  id: string;
  tag: string;
  title: string;
  body: string;
  url?: string;
  createdAt: string;
}

interface NotificationSettings {
  notifyOrders: boolean;
  notifySecurity: boolean;
  notifyActivity: boolean;
  notifySupport: boolean;
  notifyStorefrontVisitors: boolean;
}

interface NotificationsDb {
  vapidKeys: { publicKey: string; privateKey: string };
  settings: NotificationSettings;
  adminSubscriptions: StoredPushSubscription[];
  publicSubscriptions: StoredPushSubscription[];
  events: AdminNotificationEvent[];
  publicAnnouncements: PublicStoreAnnouncement[];
  updatedAt: string;
}

const CLOUD_NOTIF_KEY = 'echox:notifications_db';

const DEFAULT_SETTINGS: NotificationSettings = {
  notifyOrders: true,
  notifySecurity: true,
  notifyActivity: true,
  notifySupport: true,
  notifyStorefrontVisitors: true,
};

function normalizeNotificationsDb(raw: Partial<NotificationsDb> | null): NotificationsDb {
  return {
    vapidKeys: {
      publicKey: raw?.vapidKeys?.publicKey || '',
      privateKey: raw?.vapidKeys?.privateKey || '',
    },
    settings: {
      ...DEFAULT_SETTINGS,
      ...(raw?.settings || {}),
    },
    adminSubscriptions: Array.isArray(raw?.adminSubscriptions) ? raw!.adminSubscriptions.slice(0, 50) : [],
    publicSubscriptions: Array.isArray(raw?.publicSubscriptions) ? raw!.publicSubscriptions.slice(0, 500) : [],
    events: Array.isArray(raw?.events) ? raw!.events.slice(0, 250) : [],
    publicAnnouncements: Array.isArray(raw?.publicAnnouncements) ? raw!.publicAnnouncements.slice(0, 30) : [],
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  };
}

function categoryEnabled(settings: NotificationSettings, category: NotificationCategory): boolean {
  if (category === 'order' || category === 'payment') return settings.notifyOrders;
  if (category === 'security') return settings.notifySecurity;
  if (category === 'support') return settings.notifySupport;
  return settings.notifyActivity;
}

function isValidPushSubscription(sub: any): sub is {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
} {
  return Boolean(
    sub &&
      typeof sub.endpoint === 'string' &&
      sub.endpoint.startsWith('https://') &&
      sub.keys &&
      typeof sub.keys.p256dh === 'string' &&
      sub.keys.p256dh.length >= 16 &&
      typeof sub.keys.auth === 'string' &&
      sub.keys.auth.length >= 8
  );
}

export async function appendEdgeAdminNotification(
  env: EdgeEnv,
  input: {
    category: NotificationCategory;
    severity: NotificationSeverity;
    title: string;
    body: string;
    url?: string;
    meta?: Record<string, string | number | boolean>;
  }
): Promise<void> {
  try {
    await mutateEdgeDocWithRetry<NotificationsDb, AdminNotificationEvent | null>(
      env,
      CLOUD_NOTIF_KEY,
      async (raw) => {
        const db = normalizeNotificationsDb(raw);
        if (!categoryEnabled(db.settings, input.category)) {
          return { skipWrite: true, result: null };
        }
        const event: AdminNotificationEvent = {
          id: `notif_${Date.now()}_${randomHex(3)}`,
          category: input.category,
          severity: input.severity,
          title: input.title.slice(0, 120),
          body: input.body.slice(0, 280),
          url: input.url || '/owner/dashboard',
          read: false,
          createdAt: new Date().toISOString(),
          meta: input.meta,
        };
        const nextDoc: NotificationsDb = {
          ...db,
          events: [event, ...db.events].slice(0, 250),
          updatedAt: new Date().toISOString(),
        };
        return { nextDoc, result: event };
      },
      2
    );
  } catch {
    // Non-blocking notification telemetry
  }
}

export async function appendEdgePublicAnnouncement(
  env: EdgeEnv,
  input: { tag: string; title: string; body: string; url?: string }
): Promise<void> {
  try {
    await mutateEdgeDocWithRetry<NotificationsDb, void>(
      env,
      CLOUD_NOTIF_KEY,
      async (raw) => {
        const db = normalizeNotificationsDb(raw);
        const item: PublicStoreAnnouncement = {
          id: `pub_${Date.now()}_${randomHex(2)}`,
          tag: input.tag.slice(0, 60),
          title: input.title.slice(0, 120),
          body: input.body.slice(0, 240),
          url: input.url || '/',
          createdAt: new Date().toISOString(),
        };
        const nextDoc: NotificationsDb = {
          ...db,
          publicAnnouncements: [item, ...db.publicAnnouncements].slice(0, 30),
          updatedAt: new Date().toISOString(),
        };
        return { nextDoc, result: undefined };
      },
      2
    );
  } catch {
    // Non-blocking announcement append
  }
}

export async function handleEdgeNotificationsRoute(
  request: Request,
  env: EdgeEnv,
  pathname: string
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  if (method === 'GET' && pathname === '/api/notifications/public') {
    const loaded = await loadEdgeDocWithMeta<Partial<NotificationsDb>>(env, CLOUD_NOTIF_KEY);
    const db = normalizeNotificationsDb(loaded.data);
    return jsonResponse({
      success: true,
      vapidPublicKey: db.vapidKeys.publicKey,
      announcements: db.publicAnnouncements,
    });
  }

  if (method === 'POST' && pathname === '/api/notifications/public/subscribe') {
    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('pubPushSub', ip, 20, 60_000);
    if (!rate.allowed) {
      return jsonResponse({ success: false, error: 'تم تجاوز حد الطلبات.' }, 429);
    }
    const body = (await request.json().catch(() => ({}))) as { subscription?: any };
    const rawSub = body?.subscription;
    if (!isValidPushSubscription(rawSub)) {
      return jsonResponse({ success: false, error: 'بيانات اشتراك الإشعارات غير صالحة.' }, 400);
    }
    const subId = (await sha256Hex(rawSub.endpoint)).slice(0, 16);
    const mut = await mutateEdgeDocWithRetry<NotificationsDb, boolean>(env, CLOUD_NOTIF_KEY, async (raw) => {
      const db = normalizeNotificationsDb(raw);
      const existingIdx = db.publicSubscriptions.findIndex((s) => s.endpoint === rawSub.endpoint);
      const record: StoredPushSubscription = {
        id: subId,
        endpoint: rawSub.endpoint,
        expirationTime: rawSub.expirationTime ?? null,
        keys: { p256dh: rawSub.keys.p256dh, auth: rawSub.keys.auth },
        createdAt: existingIdx >= 0 ? db.publicSubscriptions[existingIdx].createdAt : new Date().toISOString(),
      };
      const nextSubs = [...db.publicSubscriptions];
      if (existingIdx >= 0) nextSubs[existingIdx] = record;
      else nextSubs.unshift(record);
      return {
        nextDoc: { ...db, publicSubscriptions: nextSubs.slice(0, 500), updatedAt: new Date().toISOString() },
        result: true,
      };
    });
    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    return jsonResponse({ success: true });
  }

  if (method === 'POST' && pathname === '/api/notifications/public/unsubscribe') {
    const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
    const endpoint = String(body?.endpoint || '');
    if (endpoint) {
      const mut = await mutateEdgeDocWithRetry<NotificationsDb, boolean>(env, CLOUD_NOTIF_KEY, async (raw) => {
        const db = normalizeNotificationsDb(raw);
        return {
          nextDoc: {
            ...db,
            publicSubscriptions: db.publicSubscriptions.filter((s) => s.endpoint !== endpoint),
            updatedAt: new Date().toISOString(),
          },
          result: true,
        };
      });
      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    }
    return jsonResponse({ success: true });
  }

  if (pathname === '/api/admin/notifications/test') {
    // Uses RFC 8291 web-push encryption on Node upstream
    return null;
  }

  if (pathname.startsWith('/api/admin/notifications')) {
    const auth = await requireEdgeAdminAuth(request, env);
    if (!auth.ok) return auth.response;

    if (method === 'GET' && pathname === '/api/admin/notifications') {
      const url = new URL(request.url);
      const sinceIso = url.searchParams.get('since') || undefined;
      const loaded = await loadEdgeDocWithMeta<Partial<NotificationsDb>>(env, CLOUD_NOTIF_KEY);
      if (!loaded.ok) return jsonResponse({ success: false, error: loaded.error }, 503);
      const db = normalizeNotificationsDb(loaded.data);
      const events = sinceIso ? db.events.filter((e) => e.createdAt > sinceIso) : db.events;
      const unreadCount = db.events.reduce((sum, e) => sum + (e.read ? 0 : 1), 0);
      return jsonResponse({
        success: true,
        vapidPublicKey: db.vapidKeys.publicKey,
        unreadCount,
        events,
        subscriptionsCount: db.adminSubscriptions.length,
        subscriptions: db.adminSubscriptions.map((s) => ({
          id: s.id,
          deviceLabel: s.deviceLabel || 'جهاز المالك',
          createdAt: s.createdAt,
          lastSuccessAt: s.lastSuccessAt,
        })),
        settings: db.settings,
      });
    }

    if (method === 'POST' && pathname === '/api/admin/notifications/subscribe') {
      const body = (await request.json().catch(() => ({}))) as { subscription?: any; deviceLabel?: string };
      const rawSub = body?.subscription;
      if (!isValidPushSubscription(rawSub)) {
        return jsonResponse({ success: false, error: 'بيانات الاشتراك بالإشعارات غير صالحة.' }, 400);
      }
      const subId = (await sha256Hex(rawSub.endpoint)).slice(0, 16);
      const cleanLabel = String(body?.deviceLabel || 'جهاز المالك').slice(0, 80);
      const mut = await mutateEdgeDocWithRetry<NotificationsDb, number>(env, CLOUD_NOTIF_KEY, async (raw) => {
        const db = normalizeNotificationsDb(raw);
        const existingIdx = db.adminSubscriptions.findIndex((s) => s.endpoint === rawSub.endpoint);
        const record: StoredPushSubscription = {
          id: subId,
          endpoint: rawSub.endpoint,
          expirationTime: rawSub.expirationTime ?? null,
          keys: { p256dh: rawSub.keys.p256dh, auth: rawSub.keys.auth },
          deviceLabel: cleanLabel,
          createdAt: existingIdx >= 0 ? db.adminSubscriptions[existingIdx].createdAt : new Date().toISOString(),
          lastSuccessAt: new Date().toISOString(),
        };
        const nextSubs = [...db.adminSubscriptions];
        if (existingIdx >= 0) nextSubs[existingIdx] = record;
        else nextSubs.unshift(record);
        const sliced = nextSubs.slice(0, 50);
        return {
          nextDoc: { ...db, adminSubscriptions: sliced, updatedAt: new Date().toISOString() },
          result: sliced.length,
        };
      });
      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      return jsonResponse({ success: true, subscriptionsCount: mut.result || 0 });
    }

    if (method === 'POST' && pathname === '/api/admin/notifications/unsubscribe') {
      const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
      const endpoint = String(body?.endpoint || '');
      if (endpoint) {
        const mut = await mutateEdgeDocWithRetry<NotificationsDb, number>(env, CLOUD_NOTIF_KEY, async (raw) => {
          const db = normalizeNotificationsDb(raw);
          const nextSubs = db.adminSubscriptions.filter((s) => s.endpoint !== endpoint);
          return {
            nextDoc: { ...db, adminSubscriptions: nextSubs, updatedAt: new Date().toISOString() },
            result: nextSubs.length,
          };
        });
        if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      }
      return jsonResponse({ success: true });
    }

    if (method === 'PUT' && pathname === '/api/admin/notifications/settings') {
      const patch = (await request.json().catch(() => ({}))) as Partial<NotificationSettings>;
      const mut = await mutateEdgeDocWithRetry<NotificationsDb, NotificationSettings>(
        env,
        CLOUD_NOTIF_KEY,
        async (raw) => {
          const db = normalizeNotificationsDb(raw);
          const nextSettings: NotificationSettings = {
            notifyOrders: typeof patch.notifyOrders === 'boolean' ? patch.notifyOrders : db.settings.notifyOrders,
            notifySecurity:
              typeof patch.notifySecurity === 'boolean' ? patch.notifySecurity : db.settings.notifySecurity,
            notifyActivity:
              typeof patch.notifyActivity === 'boolean' ? patch.notifyActivity : db.settings.notifyActivity,
            notifySupport:
              typeof patch.notifySupport === 'boolean' ? patch.notifySupport : db.settings.notifySupport,
            notifyStorefrontVisitors:
              typeof patch.notifyStorefrontVisitors === 'boolean'
                ? patch.notifyStorefrontVisitors
                : db.settings.notifyStorefrontVisitors,
          };
          return {
            nextDoc: { ...db, settings: nextSettings, updatedAt: new Date().toISOString() },
            result: nextSettings,
          };
        }
      );
      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      return jsonResponse({ success: true, settings: mut.result });
    }

    if (method === 'POST' && pathname === '/api/admin/notifications/read') {
      const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
      const ids = Array.isArray(body?.ids) ? body.ids : undefined;
      const mut = await mutateEdgeDocWithRetry<NotificationsDb, number>(env, CLOUD_NOTIF_KEY, async (raw) => {
        const db = normalizeNotificationsDb(raw);
        let changed = 0;
        const nextEvents = db.events.map((e) => {
          if (!e.read && (!ids || ids.length === 0 || ids.includes(e.id))) {
            changed += 1;
            return { ...e, read: true };
          }
          return e;
        });
        const unreadCount = nextEvents.reduce((sum, e) => sum + (e.read ? 0 : 1), 0);
        if (changed === 0) {
          return { skipWrite: true, result: unreadCount };
        }
        return {
          nextDoc: { ...db, events: nextEvents, updatedAt: new Date().toISOString() },
          result: unreadCount,
        };
      });
      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      return jsonResponse({ success: true, unreadCount: mut.result || 0 });
    }

    if (method === 'DELETE' && pathname === '/api/admin/notifications') {
      const mut = await mutateEdgeDocWithRetry<NotificationsDb, boolean>(env, CLOUD_NOTIF_KEY, async (raw) => {
        const db = normalizeNotificationsDb(raw);
        return {
          nextDoc: { ...db, events: [], updatedAt: new Date().toISOString() },
          result: true,
        };
      });
      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      return jsonResponse({ success: true });
    }
  }

  return null;
}
