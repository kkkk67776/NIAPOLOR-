import { handleEdgeChatRoute } from '../_lib/chatEdge';
import {
  EdgeContext,
  EdgeEnv,
  extractEdgeSessionToken,
  getEdgeClientIp,
  getEdgePersistenceStatus,
  isAllowedEdgeOrigin,
  isEdgePersistenceConfigured,
  jsonResponse,
  loadEdgeDocWithMeta,
  mutateEdgeDocWithRetry,
  probeEdgeFirestoreConnection,
  requireEdgeAdminAuth,
  saveEdgeDoc,
  verifyEdgeOwnerSession,
} from '../_lib/firestoreEdge';
import { appendEdgeAdminNotification, handleEdgeNotificationsRoute } from '../_lib/notificationsEdge';
import { handleEdgePaymentsRoute } from '../_lib/paymentsEdge';
import { handleEdgeStoreRoute } from '../_lib/storeEdge';
import { handleEdgeCustomerRoute } from '../_lib/customerEdge';

const DEFAULT_RENDER_BACKEND = 'https://echox-store.onrender.com';
const CLOUD_SECURITY_KEY = 'echox:central_security_config';
const CLOUD_OWNER_LOCK_KEY = 'echox:owner_lock_config';
const CLOUD_RATE_LIMITS_KEY = 'echox:security_rate_limits';

interface CentralSecurityDoc {
  access_code_argon2: string;
  pin_argon2: string;
  updated_at: string;
  min_session_valid_after?: number;
  history: Array<{ type: string; timestamp: string }>;
}

interface OwnerLockConfigData {
  lock_type: 'pattern' | 'pin';
  lock_hash: string;
  code_hash?: string;
  updated_at: string;
  failed_attempts: Array<{ timestamp: string; type: string }>;
}

interface RateLimitBucket {
  attempts: number;
  lockoutUntil: number;
  windowStart: number;
  lastSeen: number;
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function buildEdgeSessionCookie(request: Request, value: string, maxAgeSeconds: number): string {
  const proto = request.headers.get('x-forwarded-proto') || (request.url.startsWith('https://') ? 'https' : '');
  const secureFlag = proto.split(',')[0].trim().toLowerCase() === 'https' ? '; Secure' : '';
  return `__session=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; HttpOnly${secureFlag}`;
}

async function handleEdgeSecurityRoute(
  request: Request,
  env: EdgeEnv,
  pathname: string,
  waitUntil?: (p: Promise<unknown>) => void,
  rawBodyText?: string
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  const parseJson = async (): Promise<any> => {
    if (typeof rawBodyText === 'string' && rawBodyText.length > 0) {
      try {
        return JSON.parse(rawBodyText);
      } catch {
        return {};
      }
    }
    return request.json().catch(() => ({}));
  };

  if (method === 'GET' && pathname === '/api/owner/me') {
    const token = extractEdgeSessionToken(request);
    if (!token) {
      return jsonResponse({ authenticated: false, error: 'جلسة منتهية أو غير مصرح بها.' }, 401);
    }
    if (!token.startsWith('v2.')) {
      // Legacy pre-code 2-part session cookie lives in Node RAM
      return null;
    }
    const session = await verifyEdgeOwnerSession(request, env);
    if (!session) {
      return jsonResponse({ authenticated: false, error: 'جلسة منتهية أو غير مصرح بها.' }, 401);
    }
    return jsonResponse({
      authenticated: true,
      email: session.email,
      owner: true,
      codeVerified: Boolean(session.codeVerified),
      expiresAt: session.expiresAt,
    });
  }

  if (method === 'GET' && pathname === '/api/security/status') {
    const ip = getEdgeClientIp(request);
    const rateLoaded = await loadEdgeDocWithMeta<{ buckets?: Record<string, RateLimitBucket> }>(
      env,
      CLOUD_RATE_LIMITS_KEY
    );
    const bucket = rateLoaded.data?.buckets?.[`verifyCode:${ip}`];
    const now = Date.now();
    const locked = Boolean(bucket && now < bucket.lockoutUntil);
    const remainingSeconds = locked && bucket ? Math.ceil((bucket.lockoutUntil - now) / 1000) : 0;
    const attempts = bucket && (!bucket.lockoutUntil || now < bucket.lockoutUntil) ? bucket.attempts : 0;

    return jsonResponse({
      activeLayers: 4,
      locked,
      remainingSeconds,
      attemptsLeft: Math.max(0, 3 - attempts),
      encryptionAlgorithm: 'Argon2id + HMAC-SHA256',
    });
  }

  if (method === 'GET' && pathname === '/api/security/systemStatus') {
    const adminSess = await verifyEdgeOwnerSession(request, env);
    const isAdmin = Boolean(adminSess && adminSess.codeVerified);
    if (!isAdmin) {
      return jsonResponse({
        argon2idEnabled: true,
        hashingAlgorithm: 'Argon2id (m=65536, t=3, p=4)',
        serverSideEnforced: true,
        accessCodeConfigured: true,
        pinConfigured: true,
        edgeMode: true,
      });
    }
    const probe = await probeEdgeFirestoreConnection(env);
    const secLoaded = await loadEdgeDocWithMeta<Partial<CentralSecurityDoc>>(env, CLOUD_SECURITY_KEY);
    const persistence = getEdgePersistenceStatus(env, probe.error);
    return jsonResponse({
      argon2idEnabled: true,
      hashingAlgorithm: 'Argon2id (m=65536, t=3, p=4)',
      serverSideEnforced: true,
      storageMode: persistence.storageMode,
      durablePersistence: persistence.durable,
      persistence,
      activeSessionsCount: 1,
      accessCodeConfigured: true,
      pinConfigured: true,
      edgeMode: true,
      updatedAt: secLoaded.data?.updated_at || new Date().toISOString(),
    });
  }

  if (
    method === 'POST' &&
    (pathname === '/api/security/emergencyLockdown' || pathname === '/api/security/logoutAllDevices')
  ) {
    const auth = await requireEdgeAdminAuth(request, env);
    if (!auth.ok) return auth.response;

    const mut = await mutateEdgeDocWithRetry<CentralSecurityDoc, { missingSeed?: boolean }>(
      env,
      CLOUD_SECURITY_KEY,
      async (raw) => {
        if (!raw || !raw.access_code_argon2 || !raw.pin_argon2) {
          return { skipWrite: true, result: { missingSeed: true } };
        }
        return {
          nextDoc: {
            access_code_argon2: raw.access_code_argon2,
            pin_argon2: raw.pin_argon2,
            updated_at: new Date().toISOString(),
            min_session_valid_after: Date.now() + 1,
            history: Array.isArray(raw.history) ? raw.history : [],
          },
          result: {},
        };
      }
    );

    if (mut.result?.missingSeed) {
      return null;
    }
    if (!mut.ok) {
      return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    }

    if (pathname === '/api/security/emergencyLockdown') {
      const notifTask = appendEdgeAdminNotification(env, {
        category: 'security',
        severity: 'critical',
        title: '🚨 تفعيل القفل الأمني الفوري',
        body: 'تم إنهاء كافة الجلسات النشطة فوراً من غرفة الأمان.',
        url: '/owner/dashboard',
      });
      if (waitUntil) waitUntil(notifTask);
      else await notifTask;
    }

    return jsonResponse(
      {
        success: true,
        message:
          pathname === '/api/security/emergencyLockdown'
            ? 'تم تنفيذ القفل الأمني الفوري وإلغاء جميع الجلسات النشطة.'
            : 'تم تسجيل الخروج بنجاح من جميع الأجهزة النشطة.',
      },
      200,
      { 'Set-Cookie': buildEdgeSessionCookie(request, '', 0) }
    );
  }

  if (method === 'GET' && pathname === '/api/security/ownerLockConfig') {
    const loaded = await loadEdgeDocWithMeta<Partial<OwnerLockConfigData>>(env, CLOUD_OWNER_LOCK_KEY);
    if (!loaded.ok) return jsonResponse({ error: loaded.error }, 503);
    const ip = getEdgeClientIp(request);
    const rateLoaded = await loadEdgeDocWithMeta<{ buckets?: Record<string, RateLimitBucket> }>(
      env,
      CLOUD_RATE_LIMITS_KEY
    );
    const bucket = rateLoaded.data?.buckets?.[`osLock:${ip}`];
    const now = Date.now();
    const lockedOut = Boolean(bucket && now < bucket.lockoutUntil);
    const remainingSeconds = lockedOut && bucket ? Math.ceil((bucket.lockoutUntil - now) / 1000) : 0;
    const attempts = bucket && (!bucket.lockoutUntil || now < bucket.lockoutUntil) ? bucket.attempts : 0;

    const cfg = loaded.data;
    if (!cfg || (!cfg.lock_hash && !cfg.code_hash)) {
      return jsonResponse({
        configured: false,
        lock_type: 'pin',
        lock_hash: '',
        code_hash: '',
        failed_attempts: [],
        lockedOut,
        remainingSeconds,
        consecutiveFailures: attempts,
      });
    }

    return jsonResponse({
      configured: true,
      lock_type: cfg.lock_type || 'pin',
      lock_hash: '',
      code_hash: '',
      failed_attempts: Array.isArray(cfg.failed_attempts) ? cfg.failed_attempts : [],
      lockedOut,
      remainingSeconds,
      consecutiveFailures: attempts,
    });
  }

  if (method === 'POST' && pathname === '/api/security/saveLockConfig') {
    const auth = await requireEdgeAdminAuth(request, env);
    if (!auth.ok) return auth.response;
    const body = await parseJson();
    const finalHash = body?.lock_hash || body?.code_hash;
    if (!finalHash || typeof finalHash !== 'string' || !finalHash.trim()) {
      return jsonResponse({ error: 'الرمز المشفر (Hash) مطلوب.' }, 400);
    }

    const mut = await mutateEdgeDocWithRetry<OwnerLockConfigData, OwnerLockConfigData>(
      env,
      CLOUD_OWNER_LOCK_KEY,
      async (raw) => {
        const nextConfig: OwnerLockConfigData = {
          lock_type: body?.lock_type === 'pin' ? 'pin' : 'pattern',
          lock_hash: finalHash.trim(),
          code_hash: finalHash.trim(),
          updated_at: new Date().toISOString(),
          failed_attempts: Array.isArray(raw?.failed_attempts) ? raw!.failed_attempts.slice(0, 5) : [],
        };
        return { nextDoc: nextConfig, result: nextConfig };
      }
    );

    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    return jsonResponse({
      success: true,
      message: 'تم حفظ إعدادات قفل الهاتف المشفرة بشكل دائم بنجاح.',
      config: { ...mut.result, lock_hash: '', code_hash: '' },
    });
  }

  if (method === 'POST' && pathname === '/api/security/verifyLockHash') {
    return jsonResponse(
      {
        success: false,
        error: 'تم تعطيل مسار القفل المحلي القديم؛ المصادقة تمر حصرياً عبر بوابة Vault.',
      },
      403
    );
  }

  if (method === 'POST' && pathname === '/api/security/logFailedAttempt') {
    return jsonResponse(
      {
        success: false,
        error: 'تم تعطيل هذا المسار؛ تُسجل محاولات الفشل حصرياً داخل الخادم.',
      },
      403
    );
  }

  if (method === 'POST' && pathname === '/api/security/resetLockConfig') {
    const auth = await requireEdgeAdminAuth(request, env);
    if (!auth.ok) return auth.response;

    const saved = await saveEdgeDoc(env, CLOUD_OWNER_LOCK_KEY, {
      lock_type: 'pin',
      lock_hash: '',
      code_hash: '',
      updated_at: new Date().toISOString(),
      failed_attempts: [],
    });
    if (!saved.ok) {
      return jsonResponse({ success: false, error: saved.error || 'تعذر حذف إعدادات القفل من الخادم.' }, 503);
    }
    return jsonResponse({
      success: true,
      message: 'تم مسح رمز القفل وإعادة تعيين النظام.',
    });
  }

  return null;
}

async function proxyToUpstreamBackend(
  request: Request,
  env: EdgeEnv,
  incomingUrl: URL,
  bodyBuffer?: ArrayBuffer
): Promise<Response> {
  const rawBackend = (env.BACKEND_ORIGIN || DEFAULT_RENDER_BACKEND).trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(rawBackend)) {
    return jsonResponse({ success: false, error: 'BACKEND_ORIGIN is invalid on Cloudflare Pages.' }, 503);
  }

  const targetUrl = `${rawBackend}${incomingUrl.pathname}${incomingUrl.search}`;
  const headers = new Headers(request.headers);
  const clientIp = getEdgeClientIp(request);
  if (clientIp) {
    headers.set('cf-connecting-ip', clientIp);
    headers.set('x-forwarded-for', clientIp);
  }
  if (env.CF_PROXY_SECRET && env.CF_PROXY_SECRET.trim().length >= 16) {
    headers.set('x-edge-proxy-secret', env.CF_PROXY_SECRET.trim());
  }
  headers.set('x-forwarded-host', incomingUrl.host);
  headers.set('x-forwarded-proto', 'https');
  headers.delete('host');

  const isIdempotentRead = request.method === 'GET' || request.method === 'HEAD';
  const isRetryableAuthPost =
    request.method === 'POST' &&
    (incomingUrl.pathname === '/api/createOwnerSession' ||
      incomingUrl.pathname === '/api/security/verifyAccessCode' ||
      incomingUrl.pathname === '/api/security/verifyPin' ||
      incomingUrl.pathname === '/api/security/verifyCode' ||
      incomingUrl.pathname === '/api/payments/verify-return' ||
      incomingUrl.pathname === '/api/orders/track');
  const canRetryUpstream = isIdempotentRead || isRetryableAuthPost;

  const buildInit = (): RequestInit => {
    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (bodyBuffer) {
      init.body = bodyBuffer.slice(0);
    }
    return init;
  };

  const isColdStartStatus = (status: number) => status === 502 || status === 503 || status === 504;

  try {
    let upstream = await fetch(targetUrl, buildInit());

    if (canRetryUpstream && isColdStartStatus(upstream.status)) {
      for (const waitMs of [2500, 4000, 6000, 8000]) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        upstream = await fetch(targetUrl, buildInit());
        if (!isColdStartStatus(upstream.status)) break;
      }
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (isColdStartStatus(upstream.status) && !contentType.includes('application/json')) {
      return jsonResponse(
        {
          success: false,
          error: 'الخادم الخلفي يستيقظ الآن من وضع السكون، يرجى الانتظار بضع ثوانٍ ثم المحاولة مجدداً.',
        },
        503
      );
    }

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('X-Robots-Tag', 'noindex, nofollow');
    responseHeaders.set('Cache-Control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    if (canRetryUpstream) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const retryUpstream = await fetch(targetUrl, buildInit());
        const retryType = retryUpstream.headers.get('content-type') || '';
        if (!isColdStartStatus(retryUpstream.status) || retryType.includes('application/json')) {
          const responseHeaders = new Headers(retryUpstream.headers);
          responseHeaders.set('X-Robots-Tag', 'noindex, nofollow');
          responseHeaders.set('Cache-Control', 'no-store');
          return new Response(retryUpstream.body, {
            status: retryUpstream.status,
            statusText: retryUpstream.statusText,
            headers: responseHeaders,
          });
        }
      } catch {
        // fall through to 502
      }
    }

    return jsonResponse(
      {
        success: false,
        error: 'الخادم الخلفي يستيقظ الآن من وضع السكون، يرجى الانتظار بضع ثوانٍ ثم المحاولة مجدداً.',
        detail: (err as Error)?.message || 'Upstream unavailable',
      },
      502
    );
  }
}

export async function onRequest(context: EdgeContext): Promise<Response> {
  const { request, env, waitUntil } = context;

  if (request.method === 'OPTIONS') {
    const reqOrigin = request.headers.get('origin') || '';
    if (reqOrigin && !isAllowedEdgeOrigin(reqOrigin, env)) {
      return jsonResponse({ success: false, error: 'Origin not allowed' }, 403);
    }
    const allowedOrigin = reqOrigin || 'https://echoxstore.pages.dev';
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        Vary: 'Origin',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, X-CSRF-Token, X-File-Name, X-Chat-Token, X-Tracking-Phone, X-Requested-With',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  const incomingUrl = new URL(request.url);
  const pathname = incomingUrl.pathname;
  const isReadMethod = request.method === 'GET' || request.method === 'HEAD';
  const bodyBuffer = !isReadMethod ? await request.arrayBuffer() : undefined;
  const rawBodyText = bodyBuffer ? textDecoder.decode(bodyBuffer) : undefined;

  if (isEdgePersistenceConfigured(env)) {
    const edgeReq = bodyBuffer
      ? new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bodyBuffer.slice(0),
        })
      : request;

    if (request.method === 'GET' && pathname === '/api/health') {
      const adminSess = await verifyEdgeOwnerSession(edgeReq, env);
      const isAdmin = Boolean(adminSess && adminSess.codeVerified);
      if (!isAdmin) {
        return jsonResponse({
          status: 'ok',
          service: 'echox-store-api',
          edgeMode: true,
          timestamp: new Date().toISOString(),
        });
      }
      const probe = await probeEdgeFirestoreConnection(env);
      const persistence = getEdgePersistenceStatus(env, probe.error);
      return jsonResponse({
        status: 'ok',
        service: 'echox-store-api',
        edgeMode: true,
        uptimeSeconds: 0,
        storageMode: persistence.storageMode,
        durablePersistence: persistence.durable,
        persistence,
        securityEngine: 'Argon2id + HMAC-SHA256',
        timestamp: new Date().toISOString(),
      });
    }

    const secResponse = await handleEdgeSecurityRoute(edgeReq, env, pathname, waitUntil, rawBodyText);
    if (secResponse) return secResponse;

    if (pathname.startsWith('/api/customer/')) {
      const custResponse = await handleEdgeCustomerRoute(edgeReq, env, pathname);
      if (custResponse) return custResponse;
    }

    if (pathname.startsWith('/api/store/') || pathname.startsWith('/api/admin/store/')) {
      const storeResponse = await handleEdgeStoreRoute(edgeReq, env, pathname, waitUntil);
      if (storeResponse) return storeResponse;
    }

    if (
      pathname.startsWith('/api/payments/') ||
      pathname.startsWith('/api/admin/payments/') ||
      pathname === '/api/admin/orders' ||
      pathname.startsWith('/api/admin/orders/') ||
      pathname.startsWith('/api/vendor/') ||
      pathname.startsWith('/api/support/') ||
      pathname.startsWith('/api/admin/support/')
    ) {
      const payResponse = await handleEdgePaymentsRoute(
        edgeReq,
        env,
        pathname,
        waitUntil,
        rawBodyText
      );
      if (payResponse) return payResponse;
    }

    if (pathname.startsWith('/api/chat/') || pathname.startsWith('/api/admin/chat/')) {
      const chatResponse = await handleEdgeChatRoute(edgeReq, env, pathname, waitUntil);
      if (chatResponse) return chatResponse;
    }

    if (pathname.startsWith('/api/notifications/') || pathname.startsWith('/api/admin/notifications')) {
      const notifResponse = await handleEdgeNotificationsRoute(edgeReq, env, pathname);
      if (notifResponse) return notifResponse;
    }
  }

  return proxyToUpstreamBackend(request, env, incomingUrl, bodyBuffer);
}
