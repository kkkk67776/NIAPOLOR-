import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import crypto from 'crypto';
import dns from 'dns';
import dotenv from 'dotenv';
import net from 'net';
import path from 'path';
import fs from 'fs';
import argon2 from 'argon2';
import {
  getPublicPaymentConfig,
  getAdminPaymentConfig,
  getPosteCcpTransferDetails,
  syncCatalogSnapshot,
  updateAdminPaymentConfig,
  testOnlineGatewayConnection,
  processServerCheckout,
  calculateServerOrderQuote,
  validateCouponServer,
  recoverCheckoutByRequestId,
  submitBankTransferProof,
  adminVerifyPayment,
  adminProcessRefundOrCancel,
  createCustomerRefundOrCancelRequest,
  adminUpdateOrderStatus,
  adminSettleVendorPayout,
  getScopedVendorFinancials,
  getAdminPaymentOverview,
  getAdminOrdersFiltered,
  adminCreateManualOrder,
  adminDeleteOrder,
  trackPublicOrder,
  handlePaymentWebhook,
  verifyGatewayReturn,
  createSupportContribution,
  adminVerifySupportTransaction,
  hydratePaymentDbFromCloud,
  ensureInitialBankSealAfterHydrate,
  getActiveCatalogProductIds,
  hasVerifiedCustomerPurchase,
  getCustomerScopedOrders,
  isBankIdentityChange,
  isEnvLockedBank,
  syncPaymentDbIfStale,
  getPaymentRecoverySnapshot,
  restorePaymentRecoverySnapshot,
} from './server/paymentEngine';
import {
  hydrateCustomerAccountsFromCloud,
  syncCustomerAccountsIfStale,
  registerCustomerAccount,
  authenticateCustomerAccount,
  getCustomerById,
  updateCustomerProfileServer,
  syncCustomerWishlistServer,
  addCustomerAddressServer,
  setDefaultCustomerAddressServer,
  deleteCustomerAddressServer,
  signCustomerSessionToken,
  verifyCustomerSessionToken,
  revokeCustomerSession,
} from './server/customerEngine';
import {
  resolveCustomerLang,
  getCustomerAuthMessage,
  type AuthLang,
} from './src/lib/customerAuthMessages';
import { getGovernorateName } from './src/data/governorates';
import {
  getPublicStoreState,
  getAdminStoreState,
  updateAdminStoreState,
  hardDeleteProduct,
  hardDeleteCategory,
  hardDeleteCompany,
  hardDeleteBanner,
  type HardDeleteEntityResult,
  addPublicProductReview,
  addPublicInquiry,
  adminReplyToInquiry,
  hydrateStoreStateFromCloud,
  syncStoreStateIfStale,
  getStoreRecoverySnapshot,
  restoreStoreRecoverySnapshot,
  initStorePaymentBridge,
} from './server/storeEngine';
import {
  atomicWriteJsonSync,
  deletePersistentJson,
  flushCloudWrites,
  getDataFilePath,
  getPersistenceStatus,
  isCloudPersistenceEnabled,
  loadCloudJson,
  probeCloudPersistenceConnection,
  pushCloudJson,
  saveCloudJson,
  savePersistentJson,
} from './server/cloudPersistence';
import {
  adminSendChatReply,
  deleteChatThread,
  getChatThread,
  getPublicChatConfig,
  hydrateChatDbFromCloud,
  listAdminChatThreads,
  markThreadReadByOwner,
  recordCustomerChatExchange,
  syncChatDbIfStale,
  updateChatConfig,
  restoreChatConfigSnapshot,
} from './server/chatEngine';
import {
  clearAdminNotifications,
  emitAdminNotification,
  emitPublicStoreNotification,
  emitSecurityAlertRateLimited,
  getAdminNotificationsOverview,
  getPublicAnnouncements,
  getVapidPublicKey,
  hydrateNotificationsFromCloud,
  markAdminNotificationsRead,
  sendTestAdminPush,
  subscribeAdminPush,
  subscribePublicPush,
  syncNotificationsIfStale,
  unsubscribeAdminPush,
  unsubscribePublicPush,
  updateNotificationSettings,
  getNotificationSettingsSnapshot,
  restoreNotificationSettingsSnapshot,
} from './server/notificationEngine';
import {
  actOnQuarantineItem,
  appendSecurityAuditEvent,
  createSignedRecoverySnapshot,
  dryRunRecoveryBundle,
  getQuarantineVault,
  getRecoverySnapshotById,
  getSecurityAuditLogs,
  hydrateSecurityEngineFromCloud,
  isSessionRevoked,
  listRecoverySnapshots,
  revokeSessionId,
  runSystemIntegrityAudit,
  type RecoveryPayloadBundle,
} from './server/securityEngine';
import { inspectImageUrlOnServer } from './server/mediaInspector';
import {
  getMediaStorageStatus,
  MAX_PRODUCT_IMAGE_UPLOAD_BYTES,
  readStoredProductImage,
  uploadVerifiedProductImage,
} from './server/mediaStorage';
import {
  getServerHmacStatus,
  getValidatedHmacSecret,
  HmacSecretNotConfiguredError,
  requireServerHmacSecret,
} from './server/hmacKey';

dotenv.config();

// Prefer IPv4 DNS resolution so Render/Docker external API calls (Konnect, Flouci, Upstash) never hang on broken IPv6 routes
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

// Fix any mismatched container env vars
if (process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID === 'G-LLXC1GEL75') {
  process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID = 'ai-studio-echoxstore-9e1d54e8-7960-44b2-951a-524166c61a13';
}
if (process.env.VITE_FIREBASE_MEASUREMENT_ID === 'VITE_FIREBASE_API_KEY') {
  process.env.VITE_FIREBASE_MEASUREMENT_ID = 'G-LLXC1GEL75';
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(
  express.json({
    limit: '6mb',
    verify: (req, _res, buf) => {
      (req as any).rawBodyText = buf.toString('utf8');
    },
  })
);

function isHttpsRequest(req: Request): boolean {
  const proto = (req.headers['x-forwarded-proto'] as string) || '';
  return req.secure || proto.split(',')[0].trim().toLowerCase() === 'https';
}

function extractHostname(rawHostOrUrl: string): string {
  const cleaned = (rawHostOrUrl || '').split(',')[0].trim().toLowerCase();
  if (!cleaned) return '';
  try {
    if (cleaned.includes('://')) {
      return new URL(cleaned).hostname.toLowerCase();
    }
    return new URL(`http://${cleaned}`).hostname.toLowerCase();
  } catch {
    return cleaned.replace(/:\d+$/, '').trim();
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1';
}

function isTrustedRunAppHostname(hostname: string): boolean {
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/i.test(hostname);
}

function isTrustedStorefrontHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (
    hostname === 'echoxstore.pages.dev' ||
    hostname === 'echox-store.onrender.com' ||
    hostname === 'niapolor.pages.dev' ||
    hostname === 'niapolor.com' ||
    hostname === 'www.niapolor.com' ||
    hostname === 'niapolor.tn' ||
    hostname === 'www.niapolor.tn' ||
    isLoopbackHostname(hostname) ||
    isTrustedRunAppHostname(hostname) ||
    /^([a-z0-9-]+\.)*echox[a-z0-9-]*\.pages\.dev$/i.test(hostname) ||
    /^([a-z0-9-]+\.)*niapolor[a-z0-9-]*\.pages\.dev$/i.test(hostname)
  ) {
    return true;
  }
  const configuredHost = extractHostname(process.env.SITE_URL || process.env.VITE_SITE_URL || '');
  return Boolean(configuredHost && hostname === configuredHost);
}

function resolveAuthoritativeHost(req: Request): string {
  const rawHost = extractHostname(req.get('host') || '');
  // If the concrete Host header is already a non-loopback host (e.g. echox-store.onrender.com),
  // NEVER let client-supplied X-Forwarded-Host override it.
  if (rawHost && !isLoopbackHostname(rawHost)) {
    return rawHost;
  }
  const fwdHost = extractHostname(String(req.headers['x-forwarded-host'] || ''));
  return fwdHost || rawHost;
}

function isAiStudioPreviewRequest(req: Request): boolean {
  const rawHost = extractHostname(req.get('host') || '');
  // Concrete non-loopback host (e.g. production echox-store.onrender.com) is authoritative.
  if (rawHost && !isLoopbackHostname(rawHost)) {
    return isTrustedRunAppHostname(rawHost);
  }

  const fwdHost = extractHostname(String(req.headers['x-forwarded-host'] || ''));
  if (fwdHost) {
    return isTrustedRunAppHostname(fwdHost);
  }

  // Only allow strict Referer/Origin hostname fallback on non-production loopback requests
  if (process.env.NODE_ENV !== 'production' && isLoopbackHostname(rawHost)) {
    const refererHost = extractHostname(String(req.headers['referer'] || ''));
    const originHost = extractHostname(String(req.headers['origin'] || ''));
    const matchesStrictStudioHost = (h: string) =>
      h === 'aistudio.google.com' || /^[a-z0-9-]+\.scf\.usercontent\.goog$/i.test(h);
    return matchesStrictStudioHost(refererHost) || matchesStrictStudioHost(originHost);
  }

  return false;
}

function buildSessionCookie(req: Request, value: string, maxAgeSeconds: number): string {
  const https = isHttpsRequest(req);
  const sameSite = https && isAiStudioPreviewRequest(req) ? 'None' : 'Lax';
  const secureFlag = https || sameSite === 'None' ? '; Secure' : '';
  return `__session=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=${sameSite}; HttpOnly${secureFlag}`;
}

function buildCustomerSessionCookie(req: Request, value: string, maxAgeSeconds: number): string {
  const https = isHttpsRequest(req);
  const sameSite = https && isAiStudioPreviewRequest(req) ? 'None' : 'Lax';
  const secureFlag = https || sameSite === 'None' ? '; Secure' : '';
  return `__customer_session=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=${sameSite}; HttpOnly${secureFlag}`;
}

function resolveCustomerSession(req: Request): { customerId: string; sessionId: string } | null {
  const secret = getValidatedHmacSecret();
  if (!secret) return null;
  const cookies = parseCookies(req);
  const raw = cookies['__customer_session'];
  if (!raw) return null;
  const parsed = verifyCustomerSessionToken(raw, secret);
  if (!parsed) return null;
  return { customerId: parsed.customerId, sessionId: parsed.sessionId };
}

function extractCustomerLang(req: Request): AuthLang {
  return resolveCustomerLang(req.body?.lang ?? req.query?.lang, req.headers['accept-language']);
}

function assertNoCustomerIdorTampering(
  req: Request,
  res: Response,
  sessionCustomerId: string,
  lang: AuthLang
): boolean {
  const paramId = typeof req.params?.customerId === 'string' ? req.params.customerId.trim() : '';
  const queryId = typeof req.query?.customerId === 'string' ? req.query.customerId.trim() : '';
  const bodyId =
    req.body && typeof req.body === 'object' && typeof req.body.customerId === 'string'
      ? req.body.customerId.trim()
      : '';

  const suppliedId = paramId || queryId || bodyId;
  if (suppliedId && suppliedId !== sessionCustomerId) {
    res.status(403).json({
      success: false,
      error: getCustomerAuthMessage(lang, 'forbiddenIdor'),
    });
    return false;
  }
  return true;
}

function verifyCustomerMutationSecurity(req: Request, res: Response): boolean {
  const lang = extractCustomerLang(req);
  const reqOrigin = String(req.headers.origin || '').trim();
  if (reqOrigin && !isAllowedOrigin(reqOrigin)) {
    res.status(403).json({ success: false, error: getCustomerAuthMessage(lang, 'csrfOriginDenied') });
    return false;
  }
  if (!reqOrigin) {
    const reqReferer = String(req.headers.referer || '').trim();
    if (reqReferer && !isAllowedOrigin(reqReferer)) {
      res.status(403).json({ success: false, error: getCustomerAuthMessage(lang, 'csrfOriginDenied') });
      return false;
    }
  }
  const xrw = String(req.headers['x-requested-with'] || '').trim();
  if (xrw !== 'NIAPOLOR-Customer') {
    res.status(403).json({ success: false, error: getCustomerAuthMessage(lang, 'csrfHeaderMissing') });
    return false;
  }
  return true;
}

function normalizeIpString(raw: string): string {
  let ip = (raw || '').trim();
  if (!ip) return '127.0.0.1';
  if (ip === '::1') return '127.0.0.1';
  if (ip.toLowerCase().startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  return ip || '127.0.0.1';
}

function getClientIp(req: Request): string {
  const proxySecret = (process.env.CF_PROXY_SECRET || '').trim();
  const hasTrustedEdgeHeader =
    process.env.TRUST_CF_HEADERS === '1' ||
    (proxySecret.length >= 16 && String(req.headers['x-edge-proxy-secret'] || '') === proxySecret) ||
    process.env.NODE_ENV !== 'production';

  if (hasTrustedEdgeHeader) {
    const rawCf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (rawCf) {
      const cfIp = normalizeIpString(rawCf);
      if (net.isIP(cfIp)) return cfIp;
    }
    const fwd = ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim();
    if (fwd) {
      const fwdIp = normalizeIpString(fwd);
      if (net.isIP(fwdIp)) return fwdIp;
    }
  }

  return normalizeIpString(req.ip || req.socket.remoteAddress || '127.0.0.1');
}

function getRequestOrigin(req: Request): string {
  const rawHost = (req.get('host') || '').trim();
  const fwdHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const candidate = rawHost && !isLoopbackHostname(extractHostname(rawHost)) ? rawHost : fwdHost || rawHost;
  const candidateHostname = extractHostname(candidate);
  const protoHeader = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const proto = protoHeader.split(',')[0].trim().toLowerCase() === 'http' ? 'http' : 'https';

  if (candidate && isTrustedStorefrontHostname(candidateHostname) && !isLoopbackHostname(candidateHostname)) {
    return `${proto}://${candidate}`.replace(/\/$/, '');
  }

  const configured = (process.env.SITE_URL || process.env.VITE_SITE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;

  if (candidate && isLoopbackHostname(candidateHostname)) {
    return `${proto}://${candidate}`.replace(/\/$/, '');
  }
  return 'https://echox-store.onrender.com';
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getDynamicCatalogProductIds(): string[] {
  return getActiveCatalogProductIds();
}

// Security, CORS (Cloudflare Pages <-> Render) & SEO indexing headers middleware
function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (
    origin === 'https://echoxstore.pages.dev' ||
    origin === 'https://echox-store.onrender.com' ||
    origin === 'https://niapolor.pages.dev' ||
    origin === 'https://niapolor.com' ||
    origin === 'https://www.niapolor.com' ||
    origin === 'https://niapolor.tn' ||
    origin === 'https://www.niapolor.tn' ||
    origin === process.env.SITE_URL ||
    origin === process.env.VITE_SITE_URL ||
    origin === process.env.CORS_ORIGIN
  ) {
    return true;
  }
  try {
    const u = new URL(origin);
    if (
      u.protocol === 'https:' &&
      (/^([a-z0-9-]+\.)*echox[a-z0-9-]*\.pages\.dev$/i.test(u.hostname) ||
        /^([a-z0-9-]+\.)*niapolor[a-z0-9-]*\.pages\.dev$/i.test(u.hostname))
    ) {
      return true;
    }
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

app.use((req: Request, res: Response, next) => {
  const reqOrigin = (req.headers.origin as string) || '';
  if (isAllowedOrigin(reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-CSRF-Token, X-File-Name, X-Chat-Token, X-Tracking-Phone, X-Requested-With'
    );
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
  } else if (req.method === 'OPTIONS' && reqOrigin) {
    return res.status(403).json({ success: false, error: 'Origin not allowed' });
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const p = req.path.toLowerCase();
  res.setHeader(
    'Cross-Origin-Resource-Policy',
    p.startsWith('/api/media/') || p.startsWith('/assets/') ? 'cross-origin' : 'same-site'
  );
  if (isHttpsRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  const effectiveHost = resolveAuthoritativeHost(req);
  const isLocalHost = isLoopbackHostname(effectiveHost);
  const isPreviewOrLocalHost = isAiStudioPreviewRequest(req) || isLocalHost;
  if (!isPreviewOrLocalHost) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  const isProdRuntime = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      isProdRuntime
        ? "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com https://www.googletagmanager.com"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' https: data:",
      "connect-src 'self' https: wss:",
      "object-src 'none'",
      "base-uri 'self'",
      isPreviewOrLocalHost
        ? "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com https://*.usercontent.goog"
        : "frame-ancestors 'self'",
    ].join('; ')
  );
  if (
    p.startsWith('/owner') ||
    p === '/my_orders' ||
    p === '/orders' ||
    p === '/account' ||
    p === '/wishlist' ||
    p.startsWith('/api/')
  ) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

app.use('/api', async (_req, _res, next) => {
  try {
    await ensureServerInitialized();
  } catch (err) {
    console.warn('[Init] Middleware initialization notice:', err);
  }
  next();
});

function isSensitiveHmacRoute(reqPath: string): boolean {
  if (reqPath === '/api/health') return false;
  if (reqPath === '/api/security/status' || reqPath === '/api/security/systemStatus') return false;
  if (reqPath === '/api/store/state' || reqPath === '/api/store/inquiries') return false;
  if (/^\/api\/store\/products\/[^/]+\/reviews$/.test(reqPath)) return false;
  if (reqPath === '/api/payments/config' || reqPath.startsWith('/api/payments/track/')) return false;
  if (reqPath === '/api/chat/config' || reqPath === '/api/notifications/public') return false;
  if (reqPath.startsWith('/api/media/products/')) return false;
  return (
    reqPath === '/api/createOwnerSession' ||
    reqPath.startsWith('/api/owner/') ||
    reqPath.startsWith('/api/security/') ||
    reqPath.startsWith('/api/admin/') ||
    reqPath.startsWith('/api/customer/') ||
    reqPath.startsWith('/api/payments/') ||
    reqPath.startsWith('/api/support/') ||
    reqPath.startsWith('/api/vendor/') ||
    reqPath.startsWith('/api/chat/session/') ||
    reqPath.startsWith('/api/notifications/public/')
  );
}

app.use('/api', (req: Request, res: Response, next) => {
  const reqPath = `${req.baseUrl || ''}${req.path || ''}`;
  if (!isSensitiveHmacRoute(reqPath)) {
    return next();
  }
  const hmacStatus = getServerHmacStatus();
  if (!hmacStatus.valid) {
    return res.status(503).json({
      success: false,
      code: 'HMAC_SECRET_NOT_CONFIGURED',
      error:
        'تعذر تشغيل الوظائف الأمنية الحساسة: متغير البيئة ECHOX_SECURITY_HMAC_SECRET غير مضبوط أو أقصر من 32 بايت.',
    });
  }
  return next();
});

app.use('/api/admin', async (_req, _res, next) => {
  await syncCentralSecurityIfStale(true).catch(() => null);
  next();
});

// Infrastructure health check endpoint (minimized for anonymous callers, full details for owner)
app.get('/api/health', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  await syncCentralSecurityIfStale().catch(() => null);
  const hmacStatus = getServerHmacStatus();
  const session = resolveSessionRecord(req);
  const isAdmin = Boolean(session && session.email === OWNER_EMAIL && session.owner && session.codeVerified);
  if (!isAdmin) {
    return res.json({
      status: hmacStatus.valid ? 'ok' : 'degraded',
      securityReady: hmacStatus.valid,
      service: 'echox-store-api',
      timestamp: new Date().toISOString(),
    });
  }
  const persistence = getPersistenceStatus();
  return res.json({
    status: hmacStatus.valid ? 'ok' : 'degraded',
    securityReady: hmacStatus.valid,
    hmacConfigured: hmacStatus.valid,
    service: 'echox-store-api',
    uptimeSeconds: Math.floor(process.uptime()),
    storageMode: persistence.storageMode,
    durablePersistence: persistence.durable,
    persistence,
    securityEngine: 'Argon2id + HMAC-SHA256',
    timestamp: new Date().toISOString(),
  });
});

// Google Search Console HTML file verification handler (hex ID allowlist prevents reflected XSS)
app.get('/google:id.html', (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  if (!/^[a-f0-9]{16,64}$/i.test(id)) {
    return res.status(404).type('text/plain; charset=utf-8').send('Not Found');
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send(`google-site-verification: google${id}.html`);
});

// Search Engine Optimization: dynamic domain-aware robots.txt and sitemap.xml
app.get('/robots.txt', (req: Request, res: Response) => {
  const origin = getRequestOrigin(req);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(`User-agent: *
Allow: /
Allow: /about
Allow: /privacy
Allow: /terms
Allow: /returns
Allow: /shipping
Allow: /faq
Allow: /promise
Allow: /companies
Allow: /contact
Allow: /assets/
Disallow: /owner
Disallow: /owner/
Disallow: /owner_dashboard
Disallow: /my_orders
Disallow: /account
Disallow: /wishlist
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`);
});

app.get('/sitemap.xml', (req: Request, res: Response) => {
  const origin = getRequestOrigin(req);
  const lastmod = new Date().toISOString().slice(0, 10);
  const productIds = getDynamicCatalogProductIds();

  const staticRoutes = [
    { loc: '/', changefreq: 'daily', priority: '1.0', multilingual: true },
    { loc: '/about', changefreq: 'monthly', priority: '0.8', multilingual: true },
    { loc: '/shipping', changefreq: 'monthly', priority: '0.8', multilingual: true },
    { loc: '/returns', changefreq: 'monthly', priority: '0.8', multilingual: true },
    { loc: '/faq', changefreq: 'monthly', priority: '0.8', multilingual: true },
    { loc: '/privacy', changefreq: 'yearly', priority: '0.6', multilingual: true },
    { loc: '/terms', changefreq: 'yearly', priority: '0.6', multilingual: true },
    { loc: '/promise', changefreq: 'monthly', priority: '0.8', multilingual: true },
    { loc: '/companies', changefreq: 'weekly', priority: '0.8', multilingual: true },
    { loc: '/contact', changefreq: 'monthly', priority: '0.7', multilingual: true },
    { loc: '/?category=power_tools', changefreq: 'weekly', priority: '0.8', multilingual: false },
    { loc: '/?category=auto_parts', changefreq: 'weekly', priority: '0.8', multilingual: false },
    { loc: '/?category=electronics', changefreq: 'weekly', priority: '0.8', multilingual: false },
  ];

  const productRoutes = productIds.map((id) => ({
    loc: `/?product=${encodeURIComponent(id)}`,
    changefreq: 'weekly',
    priority: '0.9',
    multilingual: true,
  }));

  const entries = [...staticRoutes, ...productRoutes]
    .map((entry) => {
      const fullUrl = `${origin}${entry.loc}`;
      const sep = entry.loc.includes('?') ? '&' : '?';
      const alternates = entry.multilingual
        ? `
    <xhtml:link rel="alternate" hreflang="ar-TN" href="${escapeXml(`${fullUrl}${sep}lang=ar`)}" />
    <xhtml:link rel="alternate" hreflang="fr-TN" href="${escapeXml(`${fullUrl}${sep}lang=fr`)}" />
    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(`${fullUrl}${sep}lang=en`)}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(fullUrl)}" />`
        : '';

      return `  <url>
    <loc>${escapeXml(fullUrl)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>${alternates}
  </url>`;
    })
    .join('\n');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>
`);
});

// Sovereign Security Config (zero plaintext secrets or ephemeral fallback keys in source)
const OWNER_EMAIL = (process.env.ECHOX_OWNER_EMAIL || 'abdelkaderbahri570@gmail.com').trim().toLowerCase();

function getHmacSecret(): string {
  return requireServerHmacSecret();
}

// Pre-computed one-way Argon2id bootstrap hashes (zero plaintext credentials stored in code)
const DEFAULT_ACCESS_ARGON2 =
  (process.env.ECHOX_BOOTSTRAP_ACCESS_HASH || '').trim() ||
  '$argon2id$v=19$m=65536,t=3,p=4$L32cy6EOiWdqY6LxBDoknA$+xdvKFVg++rImusfx2U+XZKWvVIxHoIUEoyZL/vlpRw';
const DEFAULT_PIN_ARGON2 =
  (process.env.ECHOX_BOOTSTRAP_PIN_HASH || '').trim() ||
  '$argon2id$v=19$m=65536,t=3,p=4$QRoTtDau0g/bydokawO6JA$nMAQe1UMgspWQ5Q4LRIzmoSwqLqENN34vKGiok8KGg0';

// Per-IP Rate Limiter Store (Progressive exponential lockout)
interface RateLimitBucket {
  attempts: number;
  lockoutUntil: number;
  violationCount?: number;
  windowStart: number;
  lastSeen: number;
}

const ipRateBuckets = new Map<string, RateLimitBucket>();
const CLOUD_RATE_LIMITS_KEY = 'echox:security_rate_limits';

function syncRateLimitsToCloudAsync(): void {
  if (!isCloudPersistenceEnabled()) return;
  const now = Date.now();
  const active: Record<string, RateLimitBucket> = {};
  ipRateBuckets.forEach((b, k) => {
    if (b.lockoutUntil > now || (b.attempts > 0 && now - b.lastSeen < 15 * 60 * 1000)) {
      active[k] = b;
    }
  });
  pushCloudJson(CLOUD_RATE_LIMITS_KEY, { buckets: active, updatedAt: new Date().toISOString() });
}

async function hydrateRateLimitsFromCloud(): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  try {
    const remote = await loadCloudJson<{ buckets?: Record<string, RateLimitBucket> }>(CLOUD_RATE_LIMITS_KEY);
    if (remote?.buckets && typeof remote.buckets === 'object') {
      const now = Date.now();
      Object.entries(remote.buckets).forEach(([k, b]) => {
        if (b && (b.lockoutUntil > now || (b.attempts > 0 && now - b.lastSeen < 15 * 60 * 1000))) {
          const cur = ipRateBuckets.get(k);
          if (!cur || b.lastSeen > cur.lastSeen) {
            ipRateBuckets.set(k, b);
          }
        }
      });
    }
  } catch {}
}

async function syncRateLimitsNow(): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  const now = Date.now();
  const active: Record<string, RateLimitBucket> = {};
  ipRateBuckets.forEach((b, k) => {
    if (b.lockoutUntil > now || (b.attempts > 0 && now - b.lastSeen < 15 * 60 * 1000)) {
      active[k] = b;
    }
  });
  await saveCloudJson(CLOUD_RATE_LIMITS_KEY, { buckets: active, updatedAt: new Date().toISOString() }).catch(() => {});
}

function getBucket(namespace: string, ip: string): RateLimitBucket {
  const key = `${namespace}:${ip}`;
  let bucket = ipRateBuckets.get(key);
  if (!bucket) {
    bucket = { attempts: 0, lockoutUntil: 0, violationCount: 0, windowStart: Date.now(), lastSeen: Date.now() };
    ipRateBuckets.set(key, bucket);
  }
  bucket.lastSeen = Date.now();
  return bucket;
}

function checkLockout(namespace: string, ip: string): { locked: boolean; remainingSeconds: number; attempts: number } {
  const bucket = getBucket(namespace, ip);
  const now = Date.now();
  if (now < bucket.lockoutUntil) {
    return {
      locked: true,
      remainingSeconds: Math.ceil((bucket.lockoutUntil - now) / 1000),
      attempts: bucket.attempts,
    };
  }
  if (bucket.lockoutUntil > 0 && now >= bucket.lockoutUntil) {
    bucket.attempts = 0;
    bucket.lockoutUntil = 0;
  }
  return { locked: false, remainingSeconds: 0, attempts: bucket.attempts };
}

function checkGlobalAuthLockout(namespace: string): { locked: boolean; remainingSeconds: number } {
  const globalCheck = checkLockout(`__global_${namespace}`, 'all');
  return { locked: globalCheck.locked, remainingSeconds: globalCheck.remainingSeconds };
}

function recordGlobalFailedAuth(namespace: string, maxGlobalAttempts = 25, windowMs = 15 * 60 * 1000, lockoutMs = 15 * 60 * 1000): { locked: boolean; remainingSeconds: number } {
  const key = `__global_${namespace}`;
  const bucket = getBucket(key, 'all');
  const now = Date.now();
  if (now - bucket.windowStart > windowMs) {
    bucket.windowStart = now;
    bucket.attempts = 0;
  }
  bucket.attempts += 1;
  if (bucket.attempts >= maxGlobalAttempts) {
    bucket.lockoutUntil = now + lockoutMs;
    syncRateLimitsToCloudAsync();
    return { locked: true, remainingSeconds: Math.ceil(lockoutMs / 1000) };
  }
  return { locked: false, remainingSeconds: 0 };
}

function recordFailedAttempt(namespace: string, ip: string, maxAttempts: number, lockoutMs: number): { locked: boolean; remainingSeconds: number; attemptsLeft: number } {
  const bucket = getBucket(namespace, ip);
  bucket.attempts += 1;
  if (bucket.attempts >= maxAttempts) {
    const nextViolations = (bucket.violationCount || 0) + 1;
    bucket.violationCount = nextViolations;
    const multiplier = [1, 4, 10, 30][Math.min(3, nextViolations - 1)];
    const effectiveLockoutMs = Math.min(30 * 60 * 1000, lockoutMs * multiplier);
    bucket.lockoutUntil = Date.now() + effectiveLockoutMs;
    syncRateLimitsToCloudAsync();
    return {
      locked: true,
      remainingSeconds: Math.ceil(effectiveLockoutMs / 1000),
      attemptsLeft: 0,
    };
  }
  syncRateLimitsToCloudAsync();
  return {
    locked: false,
    remainingSeconds: 0,
    attemptsLeft: Math.max(0, maxAttempts - bucket.attempts),
  };
}

function resetBucket(namespace: string, ip: string): void {
  if (ipRateBuckets.delete(`${namespace}:${ip}`)) {
    syncRateLimitsToCloudAsync();
  }
}

function checkSlidingWindowLimit(namespace: string, ip: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const bucket = getBucket(namespace, ip);
  const now = Date.now();
  if (now - bucket.windowStart > windowMs) {
    bucket.windowStart = now;
    bucket.attempts = 0;
  }
  bucket.attempts += 1;
  if (bucket.attempts > maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

// Signed session helpers (supports both legacy sid.hmac and stateless v2 tokens across cold restarts)
function signSessionId(sessionId: string, issuedAt?: number, expiresAt?: number, codeVerified?: boolean): string {
  if (issuedAt && expiresAt) {
    const payload = `v2.${sessionId}.${issuedAt}.${expiresAt}.${codeVerified ? '1' : '0'}`;
    const hmac = crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');
    return `${payload}.${hmac}`;
  }
  const hmac = crypto.createHmac('sha256', getHmacSecret()).update(sessionId).digest('hex');
  return `${sessionId}.${hmac}`;
}

function verifySignedSessionDetailed(cookieVal: string): {
  sessionId: string;
  issuedAt?: number;
  expiresAt?: number;
  codeVerified?: boolean;
} | null {
  const secret = getValidatedHmacSecret();
  if (!secret || !cookieVal || !cookieVal.includes('.')) return null;
  const parts = cookieVal.split('.');
  if (parts.length === 6 && parts[0] === 'v2') {
    const [ver, sessionId, iatStr, expStr, cvStr, hmac] = parts;
    const payload = `${ver}.${sessionId}.${iatStr}.${expStr}.${cvStr}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (hmac.length === expected.length && crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
      const issuedAt = Number(iatStr);
      const expiresAt = Number(expStr);
      if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
        return null;
      }
      const minValidAfter = centralSecurityConfig?.min_session_valid_after || 0;
      if (issuedAt < minValidAfter) {
        return null;
      }
      return {
        sessionId,
        issuedAt,
        expiresAt,
        codeVerified: cvStr === '1',
      };
    }
    return null;
  }
  if (parts.length !== 2) return null;
  const [sessionId, hmac] = parts;
  const expected = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  if (hmac.length === expected.length && crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
    return { sessionId };
  }
  return null;
}

function verifySignedSession(cookieVal: string): string | null {
  return verifySignedSessionDetailed(cookieVal)?.sessionId || null;
}

function computeSessionHint(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId || 'anon').digest('hex').slice(0, 12);
}

function issueCsrfToken(sessionId: string): string {
  const nonce = crypto.randomBytes(12).toString('hex');
  const exp = Date.now() + 5 * 24 * 60 * 60 * 1000;
  const sidHint = computeSessionHint(sessionId);
  const payload = `csrf1.${nonce}.${exp}.${sidHint}`;
  const sig = crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyCsrfToken(token: string, expectedSessionId: string): boolean {
  const secret = getValidatedHmacSecret();
  if (!secret || !token || typeof token !== 'string') return false;
  const parts = token.trim().split('.');
  if (parts.length !== 5 || parts[0] !== 'csrf1') return false;
  const [ver, nonce, expStr, sidHint, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (sidHint !== computeSessionHint(expectedSessionId)) return false;
  const payload = `${ver}.${nonce}.${expStr}.${sidHint}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function buildCsrfCookie(req: Request, value: string, maxAgeSeconds: number): string {
  const https = isHttpsRequest(req);
  const sameSite = https && isAiStudioPreviewRequest(req) ? 'None' : 'Lax';
  const secureFlag = https || sameSite === 'None' ? '; Secure' : '';
  return `echox_csrf=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=${sameSite}${secureFlag}`;
}

function extractSessionTokenFromReq(req: Request): string {
  const cookies = parseCookies(req);
  if (cookies['__session']) return cookies['__session'];
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function resolveSessionRecord(req: Request): {
  rawSessionId: string;
  email: string;
  owner: boolean;
  codeVerified: boolean;
  expiresAt: number;
} | null {
  const cookieVal = extractSessionTokenFromReq(req);
  if (!cookieVal) return null;
  const parsed = verifySignedSessionDetailed(cookieVal);
  if (!parsed) return null;

  if (isSessionRevoked(parsed.sessionId)) {
    activeSessions.delete(parsed.sessionId);
    return null;
  }

  const existing = activeSessions.get(parsed.sessionId);
  if (existing) {
    if (existing.expiresAt < Date.now()) {
      activeSessions.delete(parsed.sessionId);
      return null;
    }
    return {
      rawSessionId: parsed.sessionId,
      email: existing.email,
      owner: existing.owner,
      codeVerified: existing.codeVerified,
      expiresAt: existing.expiresAt,
    };
  }

  // Rehydrate valid stateless v2 token after serverless/free-tier process restart (not revoked)
  if (parsed.expiresAt && parsed.codeVerified) {
    const restored = {
      email: OWNER_EMAIL,
      owner: true,
      codeVerified: true,
      expiresAt: parsed.expiresAt,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || 'Browser',
      createdAt: new Date(parsed.issuedAt || Date.now()).toISOString(),
    };
    activeSessions.set(parsed.sessionId, restored);
    return {
      rawSessionId: parsed.sessionId,
      email: restored.email,
      owner: restored.owner,
      codeVerified: restored.codeVerified,
      expiresAt: restored.expiresAt,
    };
  }

  return null;
}

const activeSessions = new Map<string, { email: string; owner: boolean; codeVerified: boolean; expiresAt: number; ip?: string; userAgent?: string; createdAt?: string }>();

// Periodic garbage collection for expired sessions and stale rate limit buckets
setInterval(() => {
  const now = Date.now();
  activeSessions.forEach((sess, key) => {
    if (sess.expiresAt < now) activeSessions.delete(key);
  });
  ipRateBuckets.forEach((bucket, key) => {
    if (now - bucket.lastSeen > 30 * 60 * 1000 && now > bucket.lockoutUntil) {
      ipRateBuckets.delete(key);
    }
  });
}, 10 * 60 * 1000).unref();

// ==========================================
// 🛡️ ARGON2ID CENTRALIZED SECURITY SYSTEM
// ==========================================
const CENTRAL_SECURITY_FILE = getDataFilePath('central_security_config.json');
const CLOUD_SECURITY_KEY = 'echox:central_security_config';

interface CentralSecurityConfig {
  access_code_argon2: string;
  pin_argon2: string;
  updated_at: string;
  min_session_valid_after?: number;
  history: Array<{ type: string; timestamp: string }>;
}

let centralSecurityConfig: CentralSecurityConfig | null = null;
let lastSecurityCloudSyncAt = 0;

async function persistCentralSecurityConfig(
  cfg: CentralSecurityConfig,
  allowEphemeral = false
) {
  const res = await savePersistentJson(CLOUD_SECURITY_KEY, CENTRAL_SECURITY_FILE, cfg, { allowEphemeral });
  if (res.ok) lastSecurityCloudSyncAt = Date.now();
  return res;
}

async function initCentralSecurityConfig(): Promise<CentralSecurityConfig> {
  if (isCloudPersistenceEnabled()) {
    const cloudCfg = await loadCloudJson<CentralSecurityConfig>(CLOUD_SECURITY_KEY);
    lastSecurityCloudSyncAt = Date.now();
    if (cloudCfg && cloudCfg.access_code_argon2 && cloudCfg.pin_argon2) {
      centralSecurityConfig = cloudCfg;
      try {
        atomicWriteJsonSync(CENTRAL_SECURITY_FILE, cloudCfg);
      } catch {}
      return cloudCfg;
    }
  }

  try {
    if (fs.existsSync(CENTRAL_SECURITY_FILE)) {
      const data = JSON.parse(fs.readFileSync(CENTRAL_SECURITY_FILE, 'utf-8'));
      if (data && data.access_code_argon2 && data.pin_argon2) {
        centralSecurityConfig = data;
        if (isCloudPersistenceEnabled()) {
          await saveCloudJson(CLOUD_SECURITY_KEY, data);
        }
        return data;
      }
    }
  } catch (err) {
    console.warn('[Security] Notice reading central security config, initializing from Argon2id hashes:', err);
  }

  const config: CentralSecurityConfig = {
    access_code_argon2: DEFAULT_ACCESS_ARGON2,
    pin_argon2: DEFAULT_PIN_ARGON2,
    updated_at: new Date().toISOString(),
    history: [{ type: 'INITIALIZED', timestamp: new Date().toISOString() }]
  };

  await persistCentralSecurityConfig(config, true);
  centralSecurityConfig = config;
  return config;
}

async function syncCentralSecurityIfStale(force = false, maxAgeMs = 3000): Promise<void> {
  if (!centralSecurityConfig) {
    await initCentralSecurityConfig();
    return;
  }
  if (!isCloudPersistenceEnabled()) return;
  if (!force && Date.now() - lastSecurityCloudSyncAt < maxAgeMs) return;
  const cloudCfg = await loadCloudJson<CentralSecurityConfig>(CLOUD_SECURITY_KEY);
  lastSecurityCloudSyncAt = Date.now();
  if (cloudCfg && cloudCfg.access_code_argon2 && cloudCfg.pin_argon2) {
    centralSecurityConfig = cloudCfg;
    try {
      atomicWriteJsonSync(CENTRAL_SECURITY_FILE, cloudCfg);
    } catch {}
  }
}

function parseCookies(req: Request): Record<string, string> {
  const list: Record<string, string> = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const name = parts[0]?.trim();
      const val = parts.slice(1).join('=').trim();
      if (name) list[name] = decodeURIComponent(val);
    });
  }
  return list;
}

// 3. Legacy unauthenticated createOwnerSession disabled permanently (Zero-Trust Vault Enforcement)
app.post('/api/createOwnerSession', (req: Request, res: Response) => {
  appendSecurityAuditEvent({
    event: 'LEGACY_SESSION_MINT_BLOCKED',
    severity: 'warning',
    actor: 'anonymous',
    ip: getClientIp(req),
    summary: 'تم صد محاولة استدعاء مسار /api/createOwnerSession المعطّل أمنياً.',
  });
  return res.status(403).json({
    success: false,
    error: 'تم إغلاق هذا المسار نهائياً: يلزم اجتياز المصادقة الثنائية عبر رمز الوصول وPIN.',
  });
});

// 3.1 CSRF Token Mint for active authenticated Vault session
app.get('/api/security/csrf', (req: Request, res: Response) => {
  const session = resolveSessionRecord(req);
  if (!session || session.email !== OWNER_EMAIL || !session.owner || !session.codeVerified) {
    return res.status(401).json({ success: false, error: 'جلسة غير نشطة.' });
  }
  const csrfToken = issueCsrfToken(session.rawSessionId);
  const maxAge = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
  res.setHeader('Set-Cookie', [buildCsrfCookie(req, csrfToken, maxAge)]);
  return res.json({ success: true, csrfToken });
});

// 4. owner/me (Route Guard Server Verification)
app.get('/api/owner/me', async (req: Request, res: Response) => {
  await syncCentralSecurityIfStale(true).catch(() => {});
  const session = resolveSessionRecord(req);
  if (!session || session.email !== OWNER_EMAIL || !session.owner) {
    return res.status(401).json({ authenticated: false, error: 'جلسة منتهية أو غير مصرح بها.' });
  }

  return res.json({
    authenticated: true,
    email: session.email,
    owner: true,
    codeVerified: !!session.codeVerified,
    expiresAt: session.expiresAt
  });
});

// 5. verifySecurityCode (Verified directly against Argon2id PIN hash)
app.post('/api/security/verifyCode', async (req: Request, res: Response) => {
  try {
    const session = resolveSessionRecord(req);
    if (!session) {
      return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية.' });
    }

    const ip = getClientIp(req);
    const lockState = checkLockout('verifyCode', ip);
    if (lockState.locked) {
      return res.status(429).json({
        error: `تم قفل شيفرة الحماية مؤقتاً لحماية الحساب. يرجى الانتظار ${lockState.remainingSeconds} ثانية.`,
        locked: true,
        remainingSeconds: lockState.remainingSeconds
      });
    }

    if (!centralSecurityConfig) {
      await initCentralSecurityConfig();
    }

    const { code } = req.body || {};
    if (!code || String(code).trim().length === 0) {
      return res.status(400).json({ error: 'يرجى إدخال شيفرة الأمان السيادية.' });
    }

    let isMatch = false;
    try {
      isMatch = await argon2.verify(centralSecurityConfig!.pin_argon2, String(code).trim());
    } catch {}

    if (!isMatch) {
      const fail = recordFailedAttempt('verifyCode', ip, 3, 5 * 60 * 1000);
      if (fail.locked) {
        return res.status(429).json({
          error: 'تم تجاوز الحد الأقصى للمحاولات (3 محاولات خاطئة). تم تفعيل القفل الأمني لمدة 5 دقائق.',
          locked: true,
          remainingSeconds: fail.remainingSeconds
        });
      }

      return res.status(403).json({
        error: `شيفرة الأمان غير صحيحة! يتبقى لديك ${fail.attemptsLeft} ${fail.attemptsLeft === 1 ? 'محاولة واحدة' : 'محاولات'}.`,
        attemptsLeft: fail.attemptsLeft
      });
    }

    resetBucket('verifyCode', ip);
    const activeSess = activeSessions.get(session.rawSessionId);
    if (activeSess) {
      activeSess.codeVerified = true;
    } else {
      activeSessions.set(session.rawSessionId, {
        email: session.email,
        owner: true,
        codeVerified: true,
        expiresAt: session.expiresAt,
        ip,
        userAgent: req.headers['user-agent'] || 'Browser',
        createdAt: new Date().toISOString(),
      });
    }

    const issuedAt = Date.now();
    const signedCookie = signSessionId(session.rawSessionId, issuedAt, session.expiresAt, true);
    const csrfToken = issueCsrfToken(session.rawSessionId);
    const maxAgeSec = Math.max(60, Math.floor((session.expiresAt - issuedAt) / 1000));
    res.setHeader('Set-Cookie', [
      buildSessionCookie(req, signedCookie, maxAgeSec),
      buildCsrfCookie(req, csrfToken, maxAgeSec),
    ]);

    return res.json({
      success: true,
      sessionToken: signedCookie,
      csrfToken,
      message: 'تم التحقق من شيفرة الحماية السيادية بنجاح وتم فك قفل لوحة المالك.',
      codeVerified: true
    });

  } catch (err: any) {
    console.error('Error in /api/security/verifyCode:', err);
    return res.status(500).json({ error: 'فشل التحقق من شيفرة الحماية.' });
  }
});

// 6. updateSecurityCode (Owner can change their PIN through Argon2id)
app.post('/api/security/updateCode', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    if (!centralSecurityConfig) {
      await initCentralSecurityConfig();
    }

    const { currentCode, newCode } = req.body || {};
    if (!currentCode || !newCode || String(newCode).trim().length < 4) {
      return res.status(400).json({ error: 'الشيفرة الجديدة يجب أن تحتوي على 4 خانات على الأقل.' });
    }

    const isCurrentValid = await argon2.verify(centralSecurityConfig!.pin_argon2, String(currentCode).trim());
    if (!isCurrentValid) {
      return res.status(403).json({ error: 'شيفرة الأمان الحالية غير صحيحة.' });
    }

    const snapshot: CentralSecurityConfig = {
      ...centralSecurityConfig!,
      history: [...(centralSecurityConfig!.history || [])],
    };

    const newHash = await argon2.hash(String(newCode).trim(), { type: argon2.argon2id });
    centralSecurityConfig!.pin_argon2 = newHash;
    centralSecurityConfig!.updated_at = new Date().toISOString();
    centralSecurityConfig!.history = [
      { type: 'PIN_CHANGED', timestamp: new Date().toISOString() },
      ...(centralSecurityConfig!.history || [])
    ].slice(0, 10);

    const persistRes = await persistCentralSecurityConfig(centralSecurityConfig!);
    if (!persistRes.ok) {
      centralSecurityConfig = snapshot;
      return res.status(503).json({ success: false, error: persistRes.error || 'تعذر حفظ شيفرة الأمان بشكل دائم على الخادم.' });
    }

    return res.json({
      success: true,
      message: 'تم تحديث شيفرة الحماية السيادية وتشفيرها وحفظها بنجاح.'
    });

  } catch (err: any) {
    console.error('Error in /api/security/updateCode:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء تحديث شيفرة الأمان.' });
  }
});

// 7. emergencyLockdown (Panic button: instantly revokes all active sessions)
app.post('/api/security/emergencyLockdown', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    if (centralSecurityConfig) {
      const snapshot: CentralSecurityConfig = {
        ...centralSecurityConfig,
        history: [...(centralSecurityConfig.history || [])],
      };
      centralSecurityConfig.min_session_valid_after = Date.now() + 1;
      const persistRes = await persistCentralSecurityConfig(centralSecurityConfig);
      if (!persistRes.ok) {
        centralSecurityConfig = snapshot;
        return res.status(503).json({ success: false, error: persistRes.error || 'تعذر حفظ حالة الإغلاق الأمني على الخادم.' });
      }
    }

    const sessionCount = activeSessions.size;
    activeSessions.clear();

    res.setHeader('Set-Cookie', [
      buildSessionCookie(req, '', 0),
      buildCsrfCookie(req, '', 0),
    ]);

    appendSecurityAuditEvent({
      event: 'EMERGENCY_LOCKDOWN_EXECUTED',
      severity: 'critical',
      actor: 'owner',
      ip: getClientIp(req),
      summary: `تفعيل الإغلاق الأمني الفوري وإبطال ${sessionCount} جلسة.`,
      meta: { sessionCount },
    });

    console.warn(`[ECHOX_SECURITY_LOCKDOWN] Emergency Lockdown triggered! Revoked ${sessionCount} active sessions.`);
    emitAdminNotification({
      category: 'security',
      severity: 'critical',
      title: '🚨 تفعيل القفل الأمني الفوري',
      body: `تم إنهاء كافة الجلسات النشطة (${sessionCount} جلسة) من غرفة الأمان.`,
      url: '/owner/dashboard',
    });

    return res.json({
      success: true,
      message: `تم تنفيذ القفل الأمني الفوري وإلغاء جميع الجلسات النشطة (${sessionCount} جلسة).`
    });

  } catch (err: any) {
    console.error('Error in emergencyLockdown:', err);
    return res.status(500).json({ error: 'تعذر تنفيذ القفل الأمني.' });
  }
});

// 8. securityStatus (Minimized public response; omits default code flags)
app.get('/api/security/status', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const ip = getClientIp(req);
  const lockState = checkLockout('verifyCode', ip);

  return res.json({
    activeLayers: 4,
    locked: lockState.locked,
    remainingSeconds: lockState.remainingSeconds,
    attemptsLeft: Math.max(0, 3 - lockState.attempts),
    encryptionAlgorithm: 'Argon2id + HMAC-SHA256'
  });
});

// 9. owner/logout (Persists session revocation across both Node RAM and stateless v2 tokens)
app.post('/api/owner/logout', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const token = extractSessionTokenFromReq(req);
  const parsed = token ? verifySignedSessionDetailed(token) : null;

  if (parsed) {
    const reqOrigin = (req.headers.origin as string) || '';
    const hostHeader = req.get('host') || '';
    if (reqOrigin && !isAllowedOrigin(reqOrigin)) {
      try {
        if (new URL(reqOrigin).host !== hostHeader) {
          return res.status(403).json({ success: false, error: 'مصدر طلب غير مصرح به.' });
        }
      } catch {
        return res.status(403).json({ success: false, error: 'مصدر طلب غير مصرح به.' });
      }
    }
    const csrfHeader = String(req.headers['x-csrf-token'] || '');
    if (!verifyCsrfToken(csrfHeader, parsed.sessionId)) {
      appendSecurityAuditEvent({
        event: 'LOGOUT_CSRF_REJECTED',
        severity: 'warning',
        actor: 'anonymous',
        ip,
        summary: 'رفض طلب تسجيل خروج لغياب رمز CSRF الصالح.',
      });
      return res.status(403).json({ success: false, error: 'رمز الحماية CSRF مطلوب لتسجيل الخروج.' });
    }
    activeSessions.delete(parsed.sessionId);
    await revokeSessionId(parsed.sessionId, parsed.expiresAt);
    appendSecurityAuditEvent({
      event: 'OWNER_SESSION_REVOKED_LOGOUT',
      severity: 'info',
      actor: 'owner',
      ip,
      summary: 'تسجيل خروج صريح وإبطال الجلسة دائماً.',
      meta: { sessionPrefix: parsed.sessionId.slice(0, 10) },
    });
  }

  res.setHeader('Set-Cookie', [
    buildSessionCookie(req, '', 0),
    buildCsrfCookie(req, '', 0),
  ]);
  return res.json({ success: true, message: 'تم إنهاء جلسة المالك وإبطالها دائماً بنجاح.' });
});

// ==========================================
// 📱 OS-LEVEL PHONE LOCK (LEGACY COMPAT APIS)
// ==========================================
const OWNER_LOCK_FILE = getDataFilePath('owner_lock_config.json');
const CLOUD_OWNER_LOCK_KEY = 'echox:owner_lock_config';

interface OwnerLockConfigData {
  lock_type: 'pattern' | 'pin';
  lock_hash: string;
  code_hash?: string;
  updated_at: string;
  failed_attempts: Array<{ timestamp: string; type: string }>;
}

function loadOwnerLockConfig(): OwnerLockConfigData | null {
  try {
    if (fs.existsSync(OWNER_LOCK_FILE)) {
      const content = fs.readFileSync(OWNER_LOCK_FILE, 'utf-8');
      const data = JSON.parse(content);
      if (data && (data.lock_hash || data.code_hash)) {
        return data;
      }
    }
  } catch (err) {
    console.warn('[LockConfig] Error reading lock config file:', err);
  }
  return null;
}

let ownerLockConfig = loadOwnerLockConfig();

async function hydrateOwnerLockConfigFromCloud(): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  try {
    const cloudData = await loadCloudJson<OwnerLockConfigData>(CLOUD_OWNER_LOCK_KEY);
    if (cloudData && (cloudData.lock_hash || cloudData.code_hash)) {
      ownerLockConfig = cloudData;
      try {
        atomicWriteJsonSync(OWNER_LOCK_FILE, cloudData);
      } catch {}
    } else if (ownerLockConfig && (ownerLockConfig.lock_hash || ownerLockConfig.code_hash)) {
      await saveCloudJson(CLOUD_OWNER_LOCK_KEY, ownerLockConfig);
    }
  } catch (err) {
    console.warn('[LockConfig] Cloud hydration notice:', err);
  }
}

// 1. GET /api/security/ownerLockConfig
app.get('/api/security/ownerLockConfig', (req: Request, res: Response) => {
  if (!ownerLockConfig) {
    ownerLockConfig = loadOwnerLockConfig();
  }
  const ip = getClientIp(req);
  const lockState = checkLockout('osLock', ip);

  if (!ownerLockConfig || (!ownerLockConfig.lock_hash && !ownerLockConfig.code_hash)) {
    return res.json({
      configured: false,
      lock_type: 'pin',
      lock_hash: '',
      code_hash: '',
      failed_attempts: [],
      lockedOut: lockState.locked,
      remainingSeconds: lockState.remainingSeconds,
      consecutiveFailures: lockState.attempts
    });
  }

  return res.json({
    configured: true,
    lock_type: ownerLockConfig.lock_type || 'pin',
    lock_hash: '',
    code_hash: '',
    failed_attempts: ownerLockConfig.failed_attempts || [],
    lockedOut: lockState.locked,
    remainingSeconds: lockState.remainingSeconds,
    consecutiveFailures: lockState.attempts
  });
});

// 2. POST /api/security/saveLockConfig (Admin authenticated)
app.post('/api/security/saveLockConfig', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const { lock_type = 'pattern', lock_hash, code_hash } = req.body || {};
    const finalHash = lock_hash || code_hash;

    if (!finalHash || typeof finalHash !== 'string' || finalHash.trim().length === 0) {
      return res.status(400).json({ error: 'الرمز المشفر (Hash) مطلوب.' });
    }

    const previous = ownerLockConfig;
    const currentAttempts = ownerLockConfig?.failed_attempts || [];
    const newConfig: OwnerLockConfigData = {
      lock_type: lock_type === 'pin' ? 'pin' : 'pattern',
      lock_hash: finalHash.trim(),
      code_hash: finalHash.trim(),
      updated_at: new Date().toISOString(),
      failed_attempts: currentAttempts.slice(0, 5)
    };

    const persistRes = await savePersistentJson(CLOUD_OWNER_LOCK_KEY, OWNER_LOCK_FILE, newConfig);
    if (!persistRes.ok) {
      ownerLockConfig = previous;
      return res.status(503).json({
        success: false,
        error: persistRes.error || 'تعذر حفظ إعدادات القفل بشكل دائم على الخادم.',
      });
    }
    ownerLockConfig = newConfig;

    return res.json({
      success: true,
      message: 'تم حفظ إعدادات قفل الهاتف المشفرة بشكل دائم بنجاح.',
      config: { ...newConfig, lock_hash: '', code_hash: '' }
    });
  } catch (err: any) {
    console.error('Error saving lock config:', err);
    return res.status(500).json({ error: 'فشل حفظ إعدادات القفل.' });
  }
});

// 3. POST /api/security/verifyLockHash — permanently disabled in favor of Vault Argon2id gate
app.post('/api/security/verifyLockHash', (req: Request, res: Response) => {
  appendSecurityAuditEvent({
    event: 'LEGACY_LOCK_ENDPOINT_BLOCKED',
    severity: 'warning',
    actor: 'anonymous',
    ip: getClientIp(req),
    summary: 'تم حظر محاولة استخدام نقطة verifyLockHash المحلية القديمة.',
  });
  return res.status(403).json({
    success: false,
    error: 'تم تعطيل مسار القفل المحلي القديم؛ المصادقة تمر حصرياً عبر بوابة Vault.',
  });
});

// 4. POST /api/security/logFailedAttempt — permanently disabled to prevent unauthenticated state pollution
app.post('/api/security/logFailedAttempt', (req: Request, res: Response) => {
  appendSecurityAuditEvent({
    event: 'LEGACY_LOCK_ENDPOINT_BLOCKED',
    severity: 'warning',
    actor: 'anonymous',
    ip: getClientIp(req),
    summary: 'تم حظر محاولة استخدام نقطة logFailedAttempt غير المصرح بها.',
  });
  return res.status(403).json({
    success: false,
    error: 'تم تعطيل هذا المسار؛ تُسجل محاولات الفشل حصرياً داخل الخادم.',
  });
});

// 5. POST /api/security/resetLockConfig (Admin authenticated)
app.post('/api/security/resetLockConfig', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const delRes = await deletePersistentJson(CLOUD_OWNER_LOCK_KEY, OWNER_LOCK_FILE);
    if (!delRes.ok) {
      return res.status(503).json({ success: false, error: delRes.error || 'تعذر حذف إعدادات القفل من الخادم.' });
    }
    ownerLockConfig = null;
    resetBucket('osLock', getClientIp(req));

    return res.json({
      success: true,
      message: 'تم مسح رمز القفل وإعادة تعيين النظام.'
    });
  } catch {
    return res.status(500).json({ error: 'فشل إعادة التعيين.' });
  }
});

// 6. POST /api/security/logoutAllDevices (Admin authenticated)
app.post('/api/security/logoutAllDevices', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  if (centralSecurityConfig) {
    const snapshot: CentralSecurityConfig = {
      ...centralSecurityConfig,
      history: [...(centralSecurityConfig.history || [])],
    };
    centralSecurityConfig.min_session_valid_after = Date.now() + 1;
    const persistRes = await persistCentralSecurityConfig(centralSecurityConfig);
    if (!persistRes.ok) {
      centralSecurityConfig = snapshot;
      return res.status(503).json({ success: false, error: persistRes.error || 'تعذر حفظ إنهاء الجلسات على الخادم.' });
    }
  }
  const count = activeSessions.size;
  activeSessions.clear();
  appendSecurityAuditEvent({
    event: 'ALL_SESSIONS_REVOKED',
    severity: 'warning',
    actor: 'owner',
    ip: getClientIp(req),
    summary: `إبطال جميع الجلسات النشطة على كل الأجهزة (${count} جلسة).`,
    meta: { revokedCount: count },
  });
  res.setHeader('Set-Cookie', [
    buildSessionCookie(req, '', 0),
    buildCsrfCookie(req, '', 0),
  ]);
  return res.json({
    success: true,
    message: `تم تسجيل الخروج بنجاح من جميع الأجهزة النشطة (${count} جلسة).`
  });
});

// ==========================================
// 🛡️ ARGON2ID ACCESS CODE & PIN ENDPOINTS
// ==========================================

const USED_GATE_NONCES_FILE = getDataFilePath('used_gate_nonces.json');
const CLOUD_USED_GATE_NONCES_KEY = 'echox:security_used_gate_nonces';
const usedGateNonces = new Map<string, number>();

function pruneUsedGateNonces(): void {
  const now = Date.now();
  usedGateNonces.forEach((exp, nonce) => {
    if (!Number.isFinite(exp) || exp <= now) {
      usedGateNonces.delete(nonce);
    }
  });
}

function loadUsedGateNoncesSync(): void {
  try {
    if (fs.existsSync(USED_GATE_NONCES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USED_GATE_NONCES_FILE, 'utf-8')) as Record<string, number>;
      if (parsed && typeof parsed === 'object') {
        const now = Date.now();
        Object.entries(parsed).forEach(([nonce, exp]) => {
          if (typeof exp === 'number' && exp > now) {
            usedGateNonces.set(nonce, exp);
          }
        });
      }
    }
  } catch {}
}

loadUsedGateNoncesSync();

async function persistUsedGateNonce(nonce: string, expiresAt: number): Promise<void> {
  pruneUsedGateNonces();
  usedGateNonces.set(nonce, expiresAt);
  const obj: Record<string, number> = {};
  usedGateNonces.forEach((exp, n) => {
    obj[n] = exp;
  });
  try {
    atomicWriteJsonSync(USED_GATE_NONCES_FILE, obj);
  } catch {}
  if (isCloudPersistenceEnabled()) {
    await saveCloudJson(CLOUD_USED_GATE_NONCES_KEY, obj).catch(() => {});
  }
}

async function hydrateUsedGateNoncesFromCloud(): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  try {
    const remote = await loadCloudJson<Record<string, number>>(CLOUD_USED_GATE_NONCES_KEY);
    if (remote && typeof remote === 'object') {
      const now = Date.now();
      Object.entries(remote).forEach(([nonce, exp]) => {
        if (typeof exp === 'number' && exp > now) {
          usedGateNonces.set(nonce, exp);
        }
      });
    }
  } catch {}
}

function createVaultGateToken(): string {
  const exp = Date.now() + 3 * 60 * 1000;
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `gate1.${exp}.${nonce}`;
  const sig = crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyVaultGateToken(token: unknown): { valid: boolean; nonce?: string; exp?: number } {
  const secret = getValidatedHmacSecret();
  if (!secret || !token || typeof token !== 'string') return { valid: false };
  const parts = token.trim().split('.');
  if (parts.length !== 4 || parts[0] !== 'gate1') return { valid: false };
  const [ver, expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now() || !/^[a-f0-9]{16,64}$/i.test(nonce)) {
    return { valid: false };
  }
  const payload = `${ver}.${expStr}.${nonce}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { valid: false };
  }
  pruneUsedGateNonces();
  if (usedGateNonces.has(nonce)) {
    return { valid: false };
  }
  return { valid: true, nonce, exp };
}

function verifyReauthSessionToken(token: unknown): { valid: boolean; sessionId?: string; expiresAt?: number } {
  const secret = getValidatedHmacSecret();
  if (!secret || !token || typeof token !== 'string') return { valid: false };
  const parts = token.trim().split('.');
  if (parts.length !== 6 || parts[0] !== 'v2') return { valid: false };
  const [ver, sessionId, iatStr, expStr, cvStr, hmac] = parts;
  if (cvStr !== '1') return { valid: false };
  const payload = `${ver}.${sessionId}.${iatStr}.${expStr}.${cvStr}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (hmac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) {
    return { valid: false };
  }
  const issuedAt = Number(iatStr);
  const expiresAt = Number(expStr);
  // Allow re-unlock for recently expired sessions (up to 2 hours past expiry) if not revoked
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || Date.now() > expiresAt + 2 * 60 * 60 * 1000) {
    return { valid: false };
  }
  const minValidAfter = centralSecurityConfig?.min_session_valid_after || 0;
  if (issuedAt < minValidAfter || isSessionRevoked(sessionId)) {
    return { valid: false };
  }
  return { valid: true, sessionId, expiresAt };
}

// 1. Verify Secret Access Code (invoked silently from search bar; NEVER grants admin permissions)
app.post('/api/security/verifyAccessCode', async (req: Request, res: Response) => {
  try {
    const ip = getClientIp(req);
    const globalLock = checkGlobalAuthLockout('accessCode');
    if (globalLock.locked) {
      return res.status(429).json({
        success: false,
        lockedOut: true,
        remainingSeconds: globalLock.remainingSeconds,
        error: `تم تجميد بوابة رمز الوصول مؤقتاً لحماية النظام، يرجى الانتظار ${globalLock.remainingSeconds} ثانية.`,
      });
    }
    const lockState = checkLockout('accessCode', ip);
    if (lockState.locked) {
      return res.status(429).json({
        success: false,
        lockedOut: true,
        remainingSeconds: lockState.remainingSeconds,
        error: `تم تجميد محاولات رمز الوصول، يرجى الانتظار ${lockState.remainingSeconds} ثانية.`
      });
    }

    await syncCentralSecurityIfStale(true);

    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, error: 'رمز الوصول مطلوب.' });
    }

    const trimmed = code.trim();
    if (trimmed.length < 3) {
      return res.status(400).json({ success: false, error: 'رمز الوصول قصير جداً.' });
    }

    let isMatch = false;
    try {
      isMatch = await argon2.verify(centralSecurityConfig!.access_code_argon2, trimmed);
    } catch (e) {
      console.warn('Argon2 verify access code error:', e);
    }

    if (isMatch) {
      resetBucket('accessCode', ip);
      appendSecurityAuditEvent({
        event: 'ACCESS_CODE_VERIFIED',
        severity: 'info',
        actor: 'vault_gate',
        ip,
        summary: 'تحقق ناجح من رمز الوصول السري عبر Argon2id.',
      });
      return res.json({
        success: true,
        gateToken: createVaultGateToken(),
        message: 'تم التحقق من رمز الوصول بنجاح.'
      });
    }

    const fail = recordFailedAttempt('accessCode', ip, 5, 30000);
    const gFail = recordGlobalFailedAuth('accessCode', 25, 15 * 60 * 1000, 15 * 60 * 1000);
    await syncRateLimitsNow();

    if (fail.locked || gFail.locked) {
      const waitSec = Math.max(fail.remainingSeconds, gFail.remainingSeconds);
      appendSecurityAuditEvent({
        event: 'ACCESS_CODE_LOCKOUT',
        severity: 'critical',
        actor: 'vault_gate',
        ip,
        summary: `تجميد بوابة رمز الوصول لمدة ${waitSec} ثانية بعد محاولات فاشلة متكررة.`,
        meta: { remainingSeconds: waitSec, globalLock: gFail.locked },
      });
      emitSecurityAlertRateLimited(`lock_access_${ip}`, {
        severity: 'critical',
        title: '🚨 محاولة اختراق: تجميد بوابة رمز الوصول',
        body: `تم حظر المحاولات مؤقتاً من ${ip} بعد تجاوز حد المحاولات (${waitSec} ثانية).`,
        url: '/owner/dashboard',
        meta: { ip, type: 'access_code_lockout' },
      });
      return res.status(429).json({
        success: false,
        lockedOut: true,
        remainingSeconds: waitSec,
        error: `تجاوزت عدد المحاولات المسموح به. تم تجميد البوابة لمدة ${waitSec} ثانية.`
      });
    }

    if (trimmed.startsWith('#') || fail.attemptsLeft <= 2) {
      appendSecurityAuditEvent({
        event: 'ACCESS_CODE_FAILED',
        severity: 'warning',
        actor: 'vault_gate',
        ip,
        summary: `محاولة فاشلة لإدخال رمز الوصول (المتبقي ${fail.attemptsLeft}).`,
        meta: { attemptsLeft: fail.attemptsLeft },
      });
      emitSecurityAlertRateLimited(
        `warn_access_${ip}`,
        {
          severity: 'warning',
          title: '⚠️ محاولة فاشلة للدخول عبر رمز الوصول',
          body: `محاولة إدخال رمز وصول غير صحيح من IP: ${ip} (المتبقي ${fail.attemptsLeft}).`,
          url: '/owner/dashboard',
          meta: { ip, attemptsLeft: fail.attemptsLeft },
        },
        15000
      );
    }

    return res.status(401).json({
      success: false,
      lockedOut: false,
      remainingSeconds: 0,
      attemptsLeft: fail.attemptsLeft,
      error: 'رمز الوصول غير صحيح.'
    });

  } catch (err: any) {
    console.error('Error in /api/security/verifyAccessCode:', err);
    return res.status(500).json({ error: 'خطأ في معالجة فحص رمز الوصول.' });
  }
});

// 2. Verify PIN with Argon2id (Requires cryptographic single-use gateToken from verifyAccessCode or valid reauthToken)
app.post('/api/security/verifyPin', async (req: Request, res: Response) => {
  try {
    const ip = getClientIp(req);
    const globalLock = checkGlobalAuthLockout('pin');
    if (globalLock.locked) {
      return res.status(429).json({
        success: false,
        lockedOut: true,
        remainingSeconds: globalLock.remainingSeconds,
        error: `تم تجميد بوابة PIN مؤقتاً لحماية النظام، يرجى الانتظار ${globalLock.remainingSeconds} ثانية.`,
      });
    }
    const lockState = checkLockout('pin', ip);
    if (lockState.locked) {
      return res.status(429).json({
        success: false,
        lockedOut: true,
        remainingSeconds: lockState.remainingSeconds,
        error: `تم تجميد محاولات PIN، يرجى الانتظار ${lockState.remainingSeconds} ثانية.`
      });
    }

    await syncCentralSecurityIfStale(true);

    const { pin, gateToken, reauthToken } = req.body || {};
    const gateCheck = verifyVaultGateToken(gateToken);
    const reauthCheck = !gateCheck.valid ? verifyReauthSessionToken(reauthToken) : { valid: false };

    if (!gateCheck.valid && !reauthCheck.valid) {
      const gateRate = checkSlidingWindowLimit('pinGateViolation', ip, 15, 5 * 60 * 1000);
      appendSecurityAuditEvent({
        event: 'PIN_VERIFY_MISSING_OR_INVALID_GATE_TOKEN',
        severity: 'warning',
        actor: 'vault_gate',
        ip,
        summary: 'رفض محاولة التحقق من PIN لغياب أو انتهاء أو إعادة استخدام رمز العبور (gateToken).',
      });
      if (!gateRate.allowed) {
        return res.status(429).json({
          success: false,
          lockedOut: true,
          remainingSeconds: gateRate.retryAfterSeconds,
          error: `محاولات غير مصرح بها متكررة، يرجى الانتظار ${gateRate.retryAfterSeconds} ثانية.`,
        });
      }
      return res.status(403).json({
        success: false,
        error: 'رمز عبور البوابة السرية مفقود أو منتهي الصلاحية أو مُستخدم مسبقاً. يرجى فتح المدخل عبر الشيفرة السرية أولاً.',
      });
    }

    if (!pin || typeof pin !== 'string') {
      return res.status(400).json({ success: false, error: 'رمز PIN مطلوب.' });
    }

    const trimmed = pin.trim();
    let isMatch = false;
    try {
      isMatch = await argon2.verify(centralSecurityConfig!.pin_argon2, trimmed);
    } catch (e) {
      console.warn('Argon2 verify pin notice:', e);
    }

    if (isMatch) {
      resetBucket('pin', ip);

      // Single-use enforcement: consume gate nonce or revoke old reauth session immediately upon unlock
      if (gateCheck.valid && gateCheck.nonce && gateCheck.exp) {
        await persistUsedGateNonce(gateCheck.nonce, gateCheck.exp);
      } else if (reauthCheck.valid && reauthCheck.sessionId) {
        activeSessions.delete(reauthCheck.sessionId);
        await revokeSessionId(reauthCheck.sessionId, reauthCheck.expiresAt || Date.now() + 3600_000).catch(() => {});
      }

      const rawSessionId = `admin_${crypto.randomBytes(32).toString('hex')}`;
      const issuedAt = Date.now();
      const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
      const expiresAt = issuedAt + fiveDaysMs;

      activeSessions.set(rawSessionId, {
        email: OWNER_EMAIL,
        owner: true,
        codeVerified: true,
        expiresAt,
        ip,
        userAgent: req.headers['user-agent'] || 'Browser',
        createdAt: new Date(issuedAt).toISOString()
      });

      const signedCookie = signSessionId(rawSessionId, issuedAt, expiresAt, true);
      const csrfToken = issueCsrfToken(rawSessionId);
      const maxAgeSec = 5 * 24 * 3600;
      res.setHeader('Set-Cookie', [
        buildSessionCookie(req, signedCookie, maxAgeSec),
        buildCsrfCookie(req, csrfToken, maxAgeSec),
      ]);

      appendSecurityAuditEvent({
        event: 'OWNER_PIN_LOGIN_SUCCESS',
        severity: 'info',
        actor: OWNER_EMAIL,
        ip,
        summary: 'دخول موثق إلى مركز التحكم عبر رمز PIN (Argon2id) بعد بوابة GateToken أحادية الاستخدام.',
        meta: { sessionPrefix: rawSessionId.slice(0, 10) },
      });

      return res.json({
        success: true,
        sessionId: rawSessionId,
        sessionToken: signedCookie,
        csrfToken,
        message: 'تم التحقق بنجاح والدخول إلى مركز التحكم.'
      });
    }

    const fail = recordFailedAttempt('pin', ip, 5, 30000);
    const gFail = recordGlobalFailedAuth('pin', 25, 15 * 60 * 1000, 15 * 60 * 1000);
    await syncRateLimitsNow();

    if (fail.locked || gFail.locked) {
      const waitSec = Math.max(fail.remainingSeconds, gFail.remainingSeconds);
      appendSecurityAuditEvent({
        event: 'OWNER_PIN_LOCKOUT',
        severity: 'critical',
        actor: 'vault_gate',
        ip,
        summary: `قفل بوابة PIN لمدة ${waitSec} ثانية بعد محاولات فاشلة.`,
        meta: { remainingSeconds: waitSec, globalLock: gFail.locked },
      });
      emitSecurityAlertRateLimited(`lock_pin_${ip}`, {
        severity: 'critical',
        title: '🚨 تنبيه اختراق: قفل بوابة الـ PIN',
        body: `تم تجميد بوابة الدخول للعنوان ${ip} لمدة ${waitSec} ثانية بعد تجاوز محاولات PIN الخاطئة!`,
        url: '/owner/dashboard',
        meta: { ip, type: 'pin_lockout' },
      });
      return res.status(429).json({
        success: false,
        lockedOut: true,
        remainingSeconds: waitSec,
        error: `تجاوزت عدد محاولات PIN المسموحة. تم قفل البوابة مؤقتاً لمدة ${waitSec} ثانية.`
      });
    }

    appendSecurityAuditEvent({
      event: 'OWNER_PIN_FAILED',
      severity: 'warning',
      actor: 'vault_gate',
      ip,
      summary: `إدخال رمز PIN خاطئ (المتبقي: ${fail.attemptsLeft}).`,
      meta: { attemptsLeft: fail.attemptsLeft },
    });

    emitSecurityAlertRateLimited(
      `warn_pin_${ip}`,
      {
        severity: 'critical',
        title: '⚠️ محاولة PIN خاطئة على غرفة التحكم',
        body: `تم إدخال رمز PIN خاطئ من ${ip} (المحاولات المتبقية: ${fail.attemptsLeft}).`,
        url: '/owner/dashboard',
        meta: { ip, attemptsLeft: fail.attemptsLeft },
      },
      10000
    );

    return res.status(401).json({
      success: false,
      lockedOut: false,
      remainingSeconds: 0,
      attemptsLeft: fail.attemptsLeft,
      error: `رمز PIN غير صحيح! المحاولات المتبقية: ${fail.attemptsLeft}`
    });

  } catch (err: any) {
    console.error('Error in /api/security/verifyPin:', err);
    return res.status(500).json({ error: 'خطأ أثناء التحقق من PIN.' });
  }
});

// 3. Update Access Code (Admin session + current PIN verification + rate limited)
app.post('/api/security/updateAccessCode', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const ip = getClientIp(req);
    const rate = checkSlidingWindowLimit('updateAccessCode', ip, 10, 5 * 60 * 1000);
    if (!rate.allowed) {
      return res.status(429).json({ error: `محاولات كثيرة، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
    }

    if (!centralSecurityConfig) {
      await initCentralSecurityConfig();
    }

    const { currentPinOrCode, newCode } = req.body || {};
    if (!currentPinOrCode || !newCode) {
      return res.status(400).json({ error: 'الرمز الحالي والرمز الجديد كلاهما مطلوبان.' });
    }

    let isAuthorized = false;
    try {
      if (await argon2.verify(centralSecurityConfig!.pin_argon2, String(currentPinOrCode).trim())) {
        isAuthorized = true;
      }
    } catch {}

    if (!isAuthorized) {
      try {
        if (await argon2.verify(centralSecurityConfig!.access_code_argon2, String(currentPinOrCode).trim())) {
          isAuthorized = true;
        }
      } catch {}
    }

    if (!isAuthorized) {
      return res.status(401).json({ error: 'رمز التحقق الحالي غير صحيح.' });
    }

    const cleanNew = String(newCode).trim();
    if (cleanNew.length < 4) {
      return res.status(400).json({ error: 'يجب أن يتكون رمز الوصول الجديد من 4 خانات على الأقل.' });
    }

    const snapshot: CentralSecurityConfig = {
      ...centralSecurityConfig!,
      history: [...(centralSecurityConfig!.history || [])],
    };

    const newHash = await argon2.hash(cleanNew, { type: argon2.argon2id });
    centralSecurityConfig!.access_code_argon2 = newHash;
    centralSecurityConfig!.updated_at = new Date().toISOString();
    centralSecurityConfig!.history = [
      { type: 'ACCESS_CODE_CHANGED', timestamp: new Date().toISOString() },
      ...(centralSecurityConfig!.history || [])
    ].slice(0, 10);

    const persistRes = await persistCentralSecurityConfig(centralSecurityConfig!);
    if (!persistRes.ok) {
      centralSecurityConfig = snapshot;
      return res.status(503).json({
        success: false,
        error: persistRes.error || 'تعذر حفظ رمز الوصول الجديد بشكل دائم على الخادم.',
      });
    }

    resetBucket('accessCode', ip);
    appendSecurityAuditEvent({
      event: 'ACCESS_CODE_CHANGED',
      severity: 'warning',
      actor: OWNER_EMAIL,
      ip,
      summary: 'تغيير رمز الوصول السري وإعادة تشفيره عبر Argon2id.',
    });
    emitAdminNotification({
      category: 'security',
      severity: 'warning',
      title: '🔐 تم تغيير رمز الوصول السري',
      body: `تم تحديث رمز الوصول بنجاح من العنوان ${ip}.`,
      url: '/owner/dashboard',
    });

    return res.json({
      success: true,
      message: 'تم تحديث رمز الوصول السري وحفظه بشكل دائم وتشفيره ببصمة Argon2id فورياً.'
    });

  } catch (err: any) {
    console.error('Error updating access code:', err);
    return res.status(500).json({ error: 'فشل حفظ رمز الوصول الجديد.' });
  }
});

// 4. Update PIN (Admin session + current PIN verification + rate limited)
app.post('/api/security/updatePin', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const ip = getClientIp(req);
    const rate = checkSlidingWindowLimit('updatePin', ip, 10, 5 * 60 * 1000);
    if (!rate.allowed) {
      return res.status(429).json({ error: `محاولات كثيرة، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
    }

    if (!centralSecurityConfig) {
      await initCentralSecurityConfig();
    }

    const { currentPin, newPin } = req.body || {};
    if (!currentPin || !newPin) {
      return res.status(400).json({ error: 'رمز PIN الحالي والجديد مطلوبان.' });
    }

    const pinMatch = await argon2.verify(centralSecurityConfig!.pin_argon2, String(currentPin).trim());
    if (!pinMatch) {
      return res.status(401).json({ error: 'رمز PIN الحالي غير صحيح.' });
    }

    const cleanNew = String(newPin).trim();
    if (cleanNew.length !== 6 || !/^\d{6}$/.test(cleanNew)) {
      return res.status(400).json({ error: 'يجب أن يتكون رمز الـ PIN الجديد من 6 أرقام بالضبط.' });
    }

    const snapshot: CentralSecurityConfig = {
      ...centralSecurityConfig!,
      history: [...(centralSecurityConfig!.history || [])],
    };

    const newHash = await argon2.hash(cleanNew, { type: argon2.argon2id });
    centralSecurityConfig!.pin_argon2 = newHash;
    centralSecurityConfig!.updated_at = new Date().toISOString();
    centralSecurityConfig!.history = [
      { type: 'PIN_CHANGED', timestamp: new Date().toISOString() },
      ...(centralSecurityConfig!.history || [])
    ].slice(0, 10);

    const persistRes = await persistCentralSecurityConfig(centralSecurityConfig!);
    if (!persistRes.ok) {
      centralSecurityConfig = snapshot;
      return res.status(503).json({
        success: false,
        error: persistRes.error || 'تعذر حفظ رمز الـ PIN الجديد بشكل دائم على الخادم.',
      });
    }

    const legacyLock: OwnerLockConfigData = {
      lock_type: 'pin',
      lock_hash: newHash,
      code_hash: newHash,
      updated_at: new Date().toISOString(),
      failed_attempts: []
    };
    await savePersistentJson(CLOUD_OWNER_LOCK_KEY, OWNER_LOCK_FILE, legacyLock, { allowEphemeral: true });
    ownerLockConfig = legacyLock;

    resetBucket('pin', ip);
    appendSecurityAuditEvent({
      event: 'OWNER_PIN_CHANGED',
      severity: 'warning',
      actor: OWNER_EMAIL,
      ip,
      summary: 'تغيير رمز الـ PIN الإداري وإعادة تشفيره عبر Argon2id.',
    });
    emitAdminNotification({
      category: 'security',
      severity: 'warning',
      title: '🔑 تم تغيير رمز الـ PIN لغرفة التحكم',
      body: `تم تحديث رمز الـ PIN المشفر بنجاح من العنوان ${ip}.`,
      url: '/owner/dashboard',
    });

    return res.json({
      success: true,
      message: 'تم تحديث رمز PIN وحفظه بشكل دائم وتشفيره ببصمة Argon2id فورياً.'
    });

  } catch (err: any) {
    console.error('Error updating PIN:', err);
    return res.status(500).json({ error: 'فشل حفظ رمز الـ PIN الجديد.' });
  }
});

// 5. Active Sessions List (Admin authenticated)
app.get('/api/security/sessions', (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const currentCookie = extractSessionTokenFromReq(req);
  const currentSessionId = currentCookie ? verifySignedSession(currentCookie) : null;

  const list: Array<{
    id: string;
    ip: string;
    userAgent: string;
    createdAt: string;
    isCurrent: boolean;
  }> = [];

  activeSessions.forEach((val, id) => {
    list.push({
      id: `${id.substring(0, 8)}...${id.substring(id.length - 4)}`,
      ip: val.ip || '127.0.0.1',
      userAgent: val.userAgent || 'Browser',
      createdAt: val.createdAt || new Date().toISOString(),
      isCurrent: id === currentSessionId
    });
  });

  return res.json({
    sessions: list,
    securityEngine: 'Argon2id + HMAC-SHA256'
  });
});

// 6. Security System Status (Minimized for public callers; full telemetry reserved for authenticated owner)
app.get('/api/security/systemStatus', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const hmacStatus = getServerHmacStatus();
  const session = resolveSessionRecord(req);
  const isAdmin = Boolean(session && session.email === OWNER_EMAIL && session.owner && session.codeVerified);
  if (!isAdmin) {
    return res.json({
      argon2idEnabled: true,
      hashingAlgorithm: 'Argon2id (m=65536, t=3, p=4)',
      serverSideEnforced: true,
      hmacConfigured: hmacStatus.valid,
      securityReady: hmacStatus.valid,
      accessCodeConfigured: true,
      pinConfigured: true,
    });
  }
  const persistence = getPersistenceStatus();
  return res.json({
    argon2idEnabled: true,
    hashingAlgorithm: 'Argon2id (m=65536, t=3, p=4)',
    serverSideEnforced: true,
    hmacConfigured: hmacStatus.valid,
    securityReady: hmacStatus.valid,
    storageMode: persistence.storageMode,
    durablePersistence: persistence.durable,
    persistence,
    activeSessionsCount: activeSessions.size,
    accessCodeConfigured: true,
    pinConfigured: true,
    updatedAt: centralSecurityConfig?.updated_at || new Date().toISOString()
  });
});

// ==========================================
// 💳 ECHOX PROFESSIONAL PAYMENT SYSTEM APIS
// ==========================================

function requireAdminAuth(req: Request, res: Response): { email: string; rawSessionId: string } | null {
  const session = resolveSessionRecord(req);
  if (!session) {
    res.status(401).json({ error: 'وصول مرفوض: جلسة مركز التحكم مطلوبة أو منتهية.' });
    return null;
  }
  if (session.email !== OWNER_EMAIL || !session.owner || !session.codeVerified) {
    res.status(403).json({ error: 'وصول غير مصرح به: صلاحيات مركز التحكم مطلوبة.' });
    return null;
  }

  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
  if (isMutating) {
    const reqOrigin = (req.headers.origin as string) || '';
    const hostHeader = req.get('host') || '';
    if (reqOrigin && !isAllowedOrigin(reqOrigin)) {
      let sameHost = false;
      try {
        sameHost = new URL(reqOrigin).host === hostHeader;
      } catch {
        sameHost = false;
      }
      if (!sameHost) {
        appendSecurityAuditEvent({
          event: 'CSRF_ORIGIN_BLOCKED',
          severity: 'critical',
          actor: session.email,
          ip: getClientIp(req),
          summary: `حظر طلب تعديل إداري من مصدر غير موثوق (${req.path}).`,
        });
        res.status(403).json({ error: 'حماية CSRF: مصدر الطلب غير مسموح به.' });
        return null;
      }
    }

    const csrfHeader = String(req.headers['x-csrf-token'] || '');
    const cookies = parseCookies(req);
    const csrfCookie = cookies['echox_csrf'];
    const cookieMismatch = Boolean(csrfCookie && csrfCookie !== csrfHeader);
    if (!verifyCsrfToken(csrfHeader, session.rawSessionId) || cookieMismatch) {
      appendSecurityAuditEvent({
        event: 'CSRF_TOKEN_REJECTED',
        severity: 'critical',
        actor: session.email,
        ip: getClientIp(req),
        summary: `حظر طلب تعديل إداري لغياب أو عدم تطابق رمز CSRF (${req.path}).`,
      });
      res.status(403).json({ error: 'رمز الحماية CSRF مفقود أو غير صالح — يرجى تجديد الجلسة.' });
      return null;
    }
  }

  return { email: session.email, rawSessionId: session.rawSessionId };
}

// 1. Public Payment Config (never exposes server secrets or RIB/IBAN)
app.get('/api/payments/config', async (_req: Request, res: Response) => {
  await syncPaymentDbIfStale(false).catch(() => {});
  return res.json(getPublicPaymentConfig());
});

// 1.1 On-demand Poste Tunisienne / CCP Transfer Details (served ONLY when customer selects this method and bank seal is valid)
app.get('/api/payments/poste-ccp/details', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('posteCcpDetails', ip, 30, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  res.setHeader('Cache-Control', 'no-store');
  await syncPaymentDbIfStale(false).catch(() => {});
  const detailsRes = getPosteCcpTransferDetails();
  if (!detailsRes.ok || !detailsRes.details) {
    return res.status(detailsRes.statusCode || 403).json({ success: false, error: detailsRes.error });
  }
  return res.json({ success: true, details: detailsRes.details });
});

// 2. Catalog Price Sync (Admin only can overwrite catalog prices)
app.post('/api/admin/payments/catalog-sync', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const { products } = req.body || {};
  const result = await syncCatalogSnapshot(products);
  if (!result.ok) {
    return res.status(result.statusCode || 503).json({ success: false, error: result.error });
  }
  return res.json({ success: true });
});

// 2.1 Server Authoritative Quote & Price Check
app.post('/api/payments/quote', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('paymentQuote', ip, 45, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  res.setHeader('Cache-Control', 'no-store');
  await syncPaymentDbIfStale(false).catch(() => {});
  const quote = calculateServerOrderQuote(req.body || {});
  if (!quote.ok && quote.code !== 'PRICE_CHANGED') {
    return res.status(quote.statusCode || 400).json({
      success: false,
      code: quote.code,
      error: quote.error,
    });
  }
  return res.json({
    success: true,
    priceChanged: quote.code === 'PRICE_CHANGED',
    code: quote.code,
    message: quote.code === 'PRICE_CHANGED' ? quote.error : undefined,
    updatedPrices: quote.updatedPrices,
    verifiedItems: quote.verifiedItems,
    subtotal: quote.subtotal,
    discount: quote.discount,
    coupon: quote.coupon,
    taxAmount: quote.taxAmount,
    shippingFee: quote.shippingFee,
    estimatedDelivery: quote.estimatedDelivery,
    freeShippingApplied: quote.freeShippingApplied,
    totalAmount: quote.totalAmount,
    currency: quote.currency,
  });
});

// 2.2 Server Coupon Validation
app.post('/api/payments/apply-coupon', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('applyCoupon', ip, 30, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  res.setHeader('Cache-Control', 'no-store');
  await syncPaymentDbIfStale(false).catch(() => {});
  const couponCode = typeof req.body?.couponCode === 'string' ? req.body.couponCode.trim() : '';
  if (!couponCode) {
    return res.status(400).json({ success: false, code: 'INVALID_COUPON', error: 'يرجى إدخال كود الخصم.' });
  }
  let subtotal = Number(req.body?.subtotal || 0);
  if (Array.isArray(req.body?.items) && req.body.items.length > 0) {
    const q = calculateServerOrderQuote({ items: req.body.items });
    if (typeof q.subtotal === 'number') {
      subtotal = q.subtotal;
    } else if (!q.ok) {
      return res.status(q.statusCode || 400).json({ success: false, code: q.code, error: q.error });
    }
  }
  const check = validateCouponServer({ couponCode, subtotal });
  if (!check.ok) {
    return res.status(check.statusCode || 400).json({
      success: false,
      code: check.code,
      error: check.error,
    });
  }
  return res.json({
    success: true,
    discount: check.discount,
    coupon: check.coupon,
    subtotal,
  });
});

// 2.3 Timeout / Idempotent Checkout Recovery Status
app.post('/api/payments/checkout/status', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('checkoutRecovery', ip, 30, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  res.setHeader('Cache-Control', 'no-store');
  const clientRequestId = typeof req.body?.clientRequestId === 'string' ? req.body.clientRequestId : '';
  const recovered = await recoverCheckoutByRequestId(clientRequestId);
  if (!recovered.ok) {
    return res.status(400).json({ success: false, found: false, error: 'معرف الطلب المؤقت غير صالح.' });
  }
  return res.json(recovered);
});

app.get('/api/payments/checkout/status/:requestId', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('checkoutRecovery', ip, 30, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  res.setHeader('Cache-Control', 'no-store');
  const recovered = await recoverCheckoutByRequestId(String(req.params.requestId || ''));
  if (!recovered.ok) {
    return res.status(400).json({ success: false, found: false, error: 'معرف الطلب المؤقت غير صالح.' });
  }
  return res.json(recovered);
});

// 3. Server-Verified Multi-Vendor Checkout (Rate limited per IP)
app.post('/api/payments/checkout', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('checkout', ip, 20, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز حد الطلبات، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  try {
    const custSess = resolveCustomerSession(req);
    const result = await processServerCheckout({
      ...(req.body || {}),
      customerId: custSess?.customerId || undefined,
      origin: getRequestOrigin(req),
      actorIp: ip,
    });
    if (!result.ok) {
      if ((result.statusCode || 400) >= 400 && /تلاعب|ملف|SVG|صورة/i.test(result.error || '')) {
        emitSecurityAlertRateLimited(`checkout_sec_${ip}`, {
          severity: 'critical',
          title: '🚨 صد محاولة تلاعب في الدفع أو الأسعار',
          body: `${result.error} (IP: ${ip})`,
          url: '/owner/dashboard',
        });
      }
      return res.status(result.statusCode || 400).json({
        success: false,
        code: result.code,
        error: result.error,
        ...(result.updatedPrices ? { updatedPrices: result.updatedPrices } : {}),
        ...(result.updatedQuote ? { updatedQuote: result.updatedQuote } : {}),
      });
    }
    if (result.order) {
      const ord = result.order;
      const govLabel = getGovernorateName(ord.shippingAddress?.governorate || '', 'ar');
      const delLabel = ord.shippingAddress?.delegation || ord.shippingAddress?.city || '';
      emitAdminNotification({
        category: 'order',
        severity: 'success',
        title: `🛒 طلب جديد #${ord.trackingNumber}`,
        body: `${ord.customerName} — ${ord.totalAmount} د.ت (${govLabel}${delLabel ? ` · ${delLabel}` : ''})`,
        url: '/owner/dashboard',
        meta: { trackingNumber: ord.trackingNumber, total: ord.totalAmount },
      });
    }
    return res.json({
      success: true,
      order: result.order,
      transaction: result.transaction,
      paymentUrl: result.paymentUrl,
      ...(result.trackingToken ? { trackingToken: result.trackingToken } : {}),
      ...(result.transferDetails ? { transferDetails: result.transferDetails } : {}),
    });
  } catch (err: any) {
    console.error('[Payments] Checkout error:', err);
    return res.status(500).json({ success: false, error: 'تعذر إتمام عملية الدفع على الخادم.' });
  }
});

// 4. Customer Submit Poste Tunisienne / CCP or Bank Transfer Proof (Rate limited per IP)
const handleTransferProofSubmit = async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('bankProof', ip, 20, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز حد الإرسال، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  const sess = resolveSessionRecord(req);
  const isAdmin = Boolean(sess && sess.codeVerified);
  const custSess = resolveCustomerSession(req);
  const trackingToken = String(
    req.body?.trackingToken || req.headers['x-tracking-token'] || req.query?.token || ''
  ).trim();

  const result = await submitBankTransferProof({
    ...(req.body || {}),
    trackingToken: trackingToken || undefined,
    customerId: custSess?.customerId || undefined,
    isAdmin,
    actorIp: ip,
  });
  if (!result.ok) {
    if (/SVG|ملف|صورة/i.test(result.error || '')) {
      emitSecurityAlertRateLimited(`proof_sec_${ip}`, {
        severity: 'critical',
        title: '🚨 صد ملف مشبوه في إثبات التحويل',
        body: `${result.error} (IP: ${ip})`,
        url: '/owner/dashboard',
      });
    }
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  const isCcp = result.order?.paymentMethod === 'poste_ccp';
  emitAdminNotification({
    category: 'payment',
    severity: 'info',
    title: isCcp
      ? `📮 وصل تحويل البريد التونسي / CCP #${result.order?.trackingNumber || ''}`
      : `🏦 إثبات تحويل بنكي جديد #${result.order?.trackingNumber || ''}`,
    body: `المرسل: ${result.order?.customerName || 'زبون'} — بانتظار المراجعة اليدوية والتحقق من وصول الأموال.`,
    url: '/owner/dashboard',
  });
  return res.json({ success: true, order: result.order });
};

app.post('/api/payments/poste-ccp/proof', handleTransferProofSubmit);
app.post('/api/payments/bank-transfer/proof', handleTransferProofSubmit);

// 5. Customer Request Cancellation / Refund
app.post('/api/payments/request-refund', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('refundReq', ip, 15, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  const custSess = resolveCustomerSession(req);
  const trackingToken = String(
    req.body?.trackingToken || req.headers['x-tracking-token'] || req.query?.token || ''
  ).trim();
  const result = await createCustomerRefundOrCancelRequest({
    ...(req.body || {}),
    trackingToken: trackingToken || undefined,
    customerId: custSess?.customerId || undefined,
  });
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  emitAdminNotification({
    category: 'payment',
    severity: 'warning',
    title: '↩️ طلب إلغاء أو استرجاع من زبون',
    body: `رقم الطلب: ${result.refundRequest?.trackingNumber || ''} — ${result.refundRequest?.reason || ''}`,
    url: '/owner/dashboard',
  });
  return res.json({ success: true, refundRequest: result.refundRequest });
});

// 6. Server-Side Payment Webhook (Supports both GET silentWebhook & POST signed Webhook with per-order token)
const handleWebhookRoute = async (req: Request, res: Response) => {
  const provider = req.params.provider || 'konnect';
  const webhookToken = req.params.webhookToken || undefined;
  const sigHeader =
    (req.headers['x-konnect-signature'] as string) ||
    (req.headers['x-signature'] as string) ||
    (req.headers['x-webhook-signature'] as string);

  const result = await handlePaymentWebhook({
    provider,
    webhookToken,
    method: req.method === 'GET' ? 'GET' : 'POST',
    signatureHeader: sigHeader,
    rawBody: req.body,
    rawBodyText: (req as any).rawBodyText,
    query: req.query as Record<string, any>,
  });
  if (result.statusCode === 403) {
    emitSecurityAlertRateLimited(`webhook_sig_${provider}`, {
      severity: 'critical',
      title: `🚨 محاولة تزوير توقيع Webhook (${provider})`,
      body: `تم رفض إشعار دفع بتوقيع أو رمز غير صالح من ${getClientIp(req)}.`,
      url: '/owner/dashboard',
    });
  } else if (result.ok && !result.idempotentDuplicate && /Paid/i.test(result.message || '')) {
    emitAdminNotification({
      category: 'payment',
      severity: 'success',
      title: `💳 تأكيد دفع إلكتروني (${provider})`,
      body: `تم التحقق من دفع ناجح عبر البوابة: ${result.message || ''}`,
      url: '/owner/dashboard',
    });
  }
  return res.status(result.statusCode).json(result);
};

app.get('/api/payments/webhook/:provider/:webhookToken?', handleWebhookRoute);
app.post('/api/payments/webhook/:provider/:webhookToken?', handleWebhookRoute);

// 6.1 Authoritative Return Verification after Gateway Redirect (Konnect / Flouci)
app.get('/api/payments/verify-return', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('verifyReturn', ip, 30, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  res.setHeader('Cache-Control', 'no-store');
  const result = await verifyGatewayReturn({
    tracking: String(req.query.tracking || ''),
    paymentRef: String(req.query.payment_ref || req.query.payment_id || ''),
    provider: String(req.query.provider || ''),
  });
  if (!result.ok) {
    return res.status(result.statusCode || 404).json({ success: false, error: result.error });
  }
  if (result.paymentStatus === 'Paid') {
    emitAdminNotification({
      category: 'payment',
      severity: 'success',
      title: '💳 اكتمال دفع إلكتروني من الزبون',
      body: `الطلب/المساهمة #${result.order?.trackingNumber || result.supportTransaction?.id || ''} مدفوع ومؤكد.`,
      url: '/owner/dashboard',
    });
  }
  return res.json({ success: true, ...result });
});

// 7. Scoped Vendor Financial Ledger View (Strict Admin Auth + Vendor Data Isolation)
app.get('/api/vendor/:vendorId/financials', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const vendorId = String(req.params.vendorId || '').trim();
  if (!vendorId) {
    return res.status(400).json({ error: 'معرف البائع مطلوب.' });
  }
  await syncPaymentDbIfStale(false).catch(() => {});
  return res.json(getScopedVendorFinancials(vendorId));
});

// 8. Independent Support ECHOX Endpoints (Rate limited per IP)
app.post('/api/support/contribute', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('supportContribute', ip, 15, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز حد الطلبات، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  try {
    const result = await createSupportContribution({
      ...(req.body || {}),
      origin: getRequestOrigin(req),
      actorIp: ip,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 400).json({ success: false, error: result.error });
    }
    if (result.supportTransaction) {
      emitAdminNotification({
        category: 'payment',
        severity: 'success',
        title: '🤝 مساهمة دعم جديدة لمنصة NIAPOLOR',
        body: `${result.supportTransaction.supporterName || 'داعم'} — ${result.supportTransaction.amount} د.ت`,
        url: '/owner/dashboard',
      });
    }
    return res.json({
      success: true,
      supportTransaction: result.supportTransaction,
      paymentUrl: result.paymentUrl,
    });
  } catch (err: any) {
    console.error('[Support] Contribution error:', err);
    return res.status(500).json({ success: false, error: 'تعذر معالجة مساهمة الدعم حالياً.' });
  }
});

// 9. Admin Panel Payment Management Routes (Protected by requireAdminAuth)
app.get('/api/admin/payments/config', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  await syncPaymentDbIfStale(true).catch(() => {});
  return res.json(getAdminPaymentConfig());
});

app.put('/api/admin/payments/config', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const body = req.body || {};

  // Step-Up Security Shield: Any change to bank account identity requires re-verifying PIN via Argon2id
  if (isBankIdentityChange(body.bankTransfer)) {
    if (isEnvLockedBank()) {
      return res.status(403).json({
        success: false,
        error: 'الحساب البنكي مقفول من متغيرات البيئة (LOCKED_BANK_IBAN) ولا يمكن تعديله من الموقع.',
      });
    }

    const ip = getClientIp(req);
    const lockState = checkLockout('bankPinConfirm', ip);
    if (lockState.locked) {
      return res.status(429).json({
        success: false,
        error: `تم قفل تعديل الحساب البنكي مؤقتاً، يرجى الانتظار ${lockState.remainingSeconds} ثانية.`,
      });
    }

    if (!centralSecurityConfig) {
      await initCentralSecurityConfig();
    }

    const confirmPin = typeof body.confirmPin === 'string' ? body.confirmPin.trim() : '';
    if (!confirmPin) {
      return res.status(403).json({
        success: false,
        requiresPinConfirmation: true,
        error: 'لتعديل بيانات الحساب البنكي أو فك تعليقه، يجب إدخال رمز الـ PIN الأمني للتأكيد.',
      });
    }

    let pinValid = false;
    try {
      pinValid = await argon2.verify(centralSecurityConfig!.pin_argon2, confirmPin);
    } catch {}

    if (!pinValid) {
      const fail = recordFailedAttempt('bankPinConfirm', ip, 3, 5 * 60 * 1000);
      emitSecurityAlertRateLimited(`bank_pin_${ip}`, {
        severity: 'critical',
        title: '🚨 محاولة فاشلة لتعديل الحساب البنكي (IBAN)',
        body: `إدخال PIN خاطئ عند محاولة تغيير الحساب البنكي من IP: ${ip}.`,
        url: '/owner/dashboard',
      });
      return res.status(403).json({
        success: false,
        requiresPinConfirmation: true,
        error: fail.locked
          ? 'محاولات PIN خاطئة متعددة! تم تجميد تعديل الحساب البنكي لمدة 5 دقائق.'
          : `رمز الـ PIN التأكيدي غير صحيح! المحاولات المتبقية: ${fail.attemptsLeft}`,
      });
    }

    resetBucket('bankPinConfirm', ip);
  }

  const bankChanged = isBankIdentityChange(body.bankTransfer);
  const result = await updateAdminPaymentConfig(body);
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  appendSecurityAuditEvent({
    event: bankChanged ? 'BANK_IDENTITY_MODIFIED' : 'PAYMENT_CONFIG_UPDATED',
    severity: bankChanged ? 'warning' : 'info',
    actor: OWNER_EMAIL,
    ip: getClientIp(req),
    summary: bankChanged
      ? 'تحديث بيانات الحساب البنكي وإعادة ختم RIB Integrity Seal بعد تأكيد PIN.'
      : 'تحديث إعدادات بوابات الدفع والعمولات.',
  });
  emitAdminNotification({
    category: 'activity',
    severity: 'info',
    title: '💳 تحديث إعدادات الدفع في غرفة التحكم',
    body: 'تم حفظ إعدادات بوابات الدفع والتسوية والعمولات.',
    url: '/owner/dashboard',
  });
  return res.json({ success: true, config: result.config });
});

app.post('/api/admin/payments/test-gateway', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const check = await testOnlineGatewayConnection();
  return res.json(check);
});

app.get('/api/admin/payments/overview', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  await syncPaymentDbIfStale(true).catch(() => {});
  return res.json(getAdminPaymentOverview());
});

app.post('/api/admin/payments/verify', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const result = await adminVerifyPayment({
    ...(req.body || {}),
    adminEmail: admin.email,
  });
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  appendSecurityAuditEvent({
    event: 'PAYMENT_VERIFICATION_DECISION',
    severity: 'info',
    actor: admin.email,
    ip: getClientIp(req),
    summary: `اعتماد/مراجعة دفع الطلب ${result.order?.trackingNumber || req.body?.orderId || ''}.`,
    meta: { action: String(req.body?.action || 'verify') },
  });
  return res.json({ success: true, order: result.order, transaction: result.transaction });
});

app.post('/api/admin/payments/refund', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const result = await adminProcessRefundOrCancel(req.body || {});
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  appendSecurityAuditEvent({
    event: 'PAYMENT_REFUND_OR_CANCEL',
    severity: 'warning',
    actor: admin.email,
    ip: getClientIp(req),
    summary: `معالجة طلب استرجاع/إلغاء (${result.order?.trackingNumber || req.body?.orderId || ''}).`,
  });
  return res.json({ success: true, order: result.order });
});

app.post('/api/admin/payments/vendor-payout', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const { vendorId, settlementNote } = req.body || {};
  if (!vendorId) {
    return res.status(400).json({ success: false, error: 'معرف البائع مطلوب.' });
  }
  const result = await adminSettleVendorPayout(vendorId, settlementNote);
  if (!result.ok) {
    return res.status(result.statusCode || 503).json({ success: false, error: result.error });
  }
  return res.json({ success: true, ...result });
});

app.post('/api/admin/support/verify', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const { id, action } = req.body || {};
  const result = await adminVerifySupportTransaction(id, action);
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, supportTransaction: result.supportTransaction });
});

const handleTrackOrderRequest = async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('trackOrder', ip, 15, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  res.setHeader('Cache-Control', 'no-store');
  await syncPaymentDbIfStale(true).catch(() => {});
  const sess = resolveSessionRecord(req);
  const isAdmin = Boolean(sess && sess.codeVerified);
  const custSess = resolveCustomerSession(req);
  const code = String(req.params.code || req.body?.trackingNumber || req.body?.code || '').trim();
  const trackingToken = String(
    req.headers['x-tracking-token'] || req.body?.trackingToken || req.query?.token || ''
  ).trim();
  const result = trackPublicOrder(code, {
    isAdmin,
    customerId: custSess?.customerId || undefined,
    trackingToken: trackingToken || undefined,
  });
  if (!result.ok) {
    return res.status(result.statusCode || 404).json({ success: false, error: result.error });
  }
  return res.json({ success: true, order: result.order });
};

app.get('/api/payments/track/:code', handleTrackOrderRequest);
app.post('/api/payments/track', handleTrackOrderRequest);

app.get('/api/admin/orders', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  await syncPaymentDbIfStale(true).catch(() => {});
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const paymentStatus = typeof req.query.paymentStatus === 'string' ? req.query.paymentStatus : undefined;
  const orders = getAdminOrdersFiltered({ q, status, paymentStatus });
  return res.json({ success: true, orders });
});

app.post('/api/admin/orders', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const result = await adminCreateManualOrder(req.body || {});
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  if (result.order) {
    emitAdminNotification({
      category: 'order',
      severity: 'info',
      title: `📝 إضافة طلب يدوي #${result.order.trackingNumber}`,
      body: `${result.order.customerName} — ${result.order.totalAmount} د.ت`,
      url: '/owner/dashboard',
    });
  }
  return res.json({ success: true, order: result.order });
});

app.patch('/api/admin/orders/:orderId/status', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const { status, note, reason } = req.body || {};
  const result = await adminUpdateOrderStatus(req.params.orderId, status, note, reason);
  if (!result.ok) {
    return res.status(result.statusCode || 409).json({ success: false, error: result.error });
  }
  return res.json({ success: true, order: result.order });
});

app.delete('/api/admin/orders/:orderId', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('adminHardDelete', ip, 40, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      error: `تم تجاوز حد عمليات الحذف، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
    });
  }
  const result = await adminDeleteOrder(req.params.orderId);
  if (!result.ok) {
    appendSecurityAuditEvent({
      event: result.statusCode === 409 ? 'ORDER_DELETE_BLOCKED_LEGAL_RETENTION' : 'ORDER_DELETE_FAILED',
      severity: 'warning',
      actor: admin.email,
      ip,
      summary: `رفض أو تعذر حذف الطلب (${req.params.orderId}): ${result.error || 'خطأ غير محدد'}`,
    });
    return res.status(result.statusCode || 404).json({ success: false, error: result.error });
  }
  appendSecurityAuditEvent({
    event: 'HARD_DELETE_ORDER_CONFIRMED',
    severity: 'info',
    actor: admin.email,
    ip,
    summary: `حذف نهائي مؤكد للطلب غير المدفوع (${req.params.orderId}) وتنظيف سجلاته المرتبطة.`,
  });
  return res.json({
    success: true,
    verified: true,
    deletedId: req.params.orderId,
    backupRetentionNote:
      'النسخ الاحتياطية المُنشأة مسبقاً والملفات المصدّرة قبل الحذف تبقى محفوظة وفق سياسة الاحتفاظ ولا تُعدّل بأثر رجعي.',
  });
});

// 10. Live Customer Support Chat Routes
function issueChatSessionToken(sessionId: string): string {
  const sig = crypto
    .createHmac('sha256', getHmacSecret())
    .update(`chat1:${sessionId}`)
    .digest('hex');
  return `chat1.${sessionId}.${sig}`;
}

function verifyChatSessionToken(token: string, expectedSessionId: string): boolean {
  const secret = getValidatedHmacSecret();
  if (!secret || !token || !expectedSessionId) return false;
  const expected = `chat1.${expectedSessionId}.${crypto
    .createHmac('sha256', secret)
    .update(`chat1:${expectedSessionId}`)
    .digest('hex')}`;
  const a = Buffer.from(token.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get('/api/chat/config', async (_req: Request, res: Response) => {
  await syncChatDbIfStale(false).catch(() => {});
  return res.json({ success: true, config: getPublicChatConfig() });
});

app.get('/api/chat/session/:sessionId', async (req: Request, res: Response) => {
  await syncChatDbIfStale(false).catch(() => {});
  const thread = getChatThread(req.params.sessionId);
  if (!thread) {
    return res.json({ success: true, thread: null });
  }
  const sess = resolveSessionRecord(req);
  const isAdmin = Boolean(sess && sess.email === OWNER_EMAIL && sess.owner && sess.codeVerified);
  const chatToken = String(req.headers['x-chat-token'] || '');
  if (!isAdmin && !verifyChatSessionToken(chatToken, thread.sessionId)) {
    return res.status(403).json({
      success: false,
      error: 'رمز ملكية جلسة المحادثة مطلوب أو غير صالح.',
    });
  }
  return res.json({ success: true, thread });
});

app.post('/api/chat/session/:sessionId/message', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('supportChat', ip, 30, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      error: `تم تجاوز حد الرسائل، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
    });
  }
  await syncChatDbIfStale(false).catch(() => {});
  const existingThread = getChatThread(req.params.sessionId);
  if (existingThread) {
    const sess = resolveSessionRecord(req);
    const isAdmin = Boolean(sess && sess.email === OWNER_EMAIL && sess.owner && sess.codeVerified);
    const chatToken = String(req.headers['x-chat-token'] || '');
    if (!isAdmin && !verifyChatSessionToken(chatToken, existingThread.sessionId)) {
      return res.status(403).json({
        success: false,
        error: 'رمز ملكية جلسة المحادثة مطلوب لإضافة رسائل لهذه المحادثة.',
      });
    }
  }
  const { language, customerLabel, customerText, autoReplyText, suggestedProducts, actionView } = req.body || {};
  const result = await recordCustomerChatExchange({
    sessionId: req.params.sessionId,
    language,
    customerLabel,
    customerText,
    autoReplyText,
    suggestedProducts,
    actionView,
  });
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  emitAdminNotification({
    category: 'support',
    severity: 'info',
    title: '💬 رسالة جديدة في دعم الزبائن',
    body: `${customerLabel || 'زبون'}: ${String(customerText || '').slice(0, 120)}`,
    url: '/owner/dashboard',
  });
  return res.json({
    success: true,
    thread: result.thread,
    chatToken: result.thread ? issueChatSessionToken(result.thread.sessionId) : undefined,
  });
});

app.get('/api/admin/chat/threads', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  await syncChatDbIfStale(true).catch(() => {});
  return res.json({ success: true, ...listAdminChatThreads() });
});

app.post('/api/admin/chat/threads/:sessionId/reply', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const { replyText } = req.body || {};
  const result = await adminSendChatReply({
    sessionId: req.params.sessionId,
    replyText,
  });
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, thread: result.thread, message: result.message });
});

app.post('/api/admin/chat/threads/:sessionId/read', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const result = await markThreadReadByOwner(req.params.sessionId);
  if (!result.ok) {
    return res.status(result.statusCode || 503).json({ success: false, error: result.error });
  }
  return res.json({ success: true });
});

app.delete('/api/admin/chat/threads/:sessionId', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('adminHardDelete', ip, 40, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      error: `تم تجاوز حد عمليات الحذف، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
    });
  }
  const result = await deleteChatThread(req.params.sessionId);
  if (!result.ok) {
    return res.status(result.statusCode || 503).json({ success: false, error: result.error });
  }
  appendSecurityAuditEvent({
    event: 'HARD_DELETE_CHAT_THREAD_CONFIRMED',
    severity: 'info',
    actor: admin.email,
    ip,
    summary: `حذف نهائي مؤكد لمحادثة الدعم (${req.params.sessionId}).`,
  });
  return res.json({ success: true, verified: true, deletedId: req.params.sessionId });
});

app.put('/api/admin/chat/config', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const result = await updateChatConfig(req.body || {});
  if (!result.ok) {
    return res.status(result.statusCode || 503).json({ success: false, error: result.error });
  }
  return res.json({ success: true, config: result.config });
});

// ==========================================
// 🏪 SERVER-SYNCHRONIZED STOREFRONT STATE APIS
// ==========================================
app.get('/api/store/state', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  await syncStoreStateIfStale(false).catch(() => {});
  return res.json({
    success: true,
    ...getPublicStoreState(),
  });
});

app.get('/api/admin/store/state', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  await syncStoreStateIfStale(true).catch(() => {});
  return res.json({
    success: true,
    ...getAdminStoreState(),
    persistenceStatus: getPersistenceStatus(),
  });
});

app.put('/api/admin/store/state', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const ip = getClientIp(req);
  const prevState = getPublicStoreState();
  const result = await updateAdminStoreState(req.body || {}, ip);
  if (!result.ok) {
    if (result.quarantined) {
      emitSecurityAlertRateLimited(`store_media_sec_${ip}`, {
        severity: 'critical',
        title: '🚨 صد وعزل وسائط غير آمنة عند تعديل المتجر',
        body: `${result.error || 'رابط صورة غير آمن'} (IP: ${ip})`,
        url: '/owner/dashboard',
      });
    }
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  // Keep server-side payment catalog prices in exact sync with edited products
  const catalogSync = await syncCatalogSnapshot(result.state.products, { replaceAll: true });
  if (!catalogSync.ok) {
    return res.status(catalogSync.statusCode || 503).json({
      success: false,
      error: catalogSync.error || 'تعذر مزامنة أسعار الكاتالوج في محرك الدفع.',
    });
  }

  const changedSections: string[] = [];
  if (Array.isArray(req.body?.products)) changedSections.push('المنتجات');
  if (Array.isArray(req.body?.categories)) changedSections.push('التصنيفات');
  if (Array.isArray(req.body?.companies)) changedSections.push('الشركات');
  if (Array.isArray(req.body?.banners)) changedSections.push('البانرات');
  if (req.body?.siteSettings) changedSections.push('إعدادات المتجر');
  if (req.body?.ownerSettings) changedSections.push('إعدادات المالك');

  appendSecurityAuditEvent({
    event: 'STORE_STATE_UPDATED',
    severity: 'info',
    actor: admin.email,
    ip,
    summary: changedSections.length > 0 ? `تحديث بيانات المتجر (${changedSections.join('، ')}).` : 'تحديث بيانات المتجر.',
  });

  emitAdminNotification({
    category: 'activity',
    severity: 'info',
    title: '⚙️ تحديث في غرفة التحكم',
    body: changedSections.length > 0 ? `تم تحديث وحفظ: ${changedSections.join('، ')}` : 'تم حفظ تعديلات المتجر بشكل دائم.',
    url: '/owner/dashboard',
  });

  if (Array.isArray(req.body?.products) && result.state.products.length > prevState.products.length) {
    const newest = result.state.products.find((p) => !prevState.products.some((old) => old.id === p.id));
    if (newest) {
      emitPublicStoreNotification({
        tag: 'منتج جديد',
        title: `🆕 منتج جديد في NIAPOLOR: ${newest.name?.ar || newest.name?.en || newest.name?.fr || 'منتج جديد'}`,
        body: `متوفر الآن بسعر ${newest.price} د.ت — اطلبه الآن مع التوصيل لكافة الولايات.`,
        url: `/?product=${encodeURIComponent(newest.id)}`,
      });
    }
  } else if (Array.isArray(req.body?.banners) && result.state.banners.length > prevState.banners.length) {
    const newestBanner = result.state.banners.find((b) => !prevState.banners.some((old) => old.id === b.id));
    if (newestBanner && newestBanner.active) {
      emitPublicStoreNotification({
        tag: newestBanner.tag || 'عرض جديد',
        title: `🔥 ${newestBanner.title}`,
        body: newestBanner.subtitle || 'اكتشف العروض الجديدة في NIAPOLOR الآن.',
        url: '/',
      });
    }
  }

  return res.json({
    success: true,
    ...result.state,
    persistenceStatus: getPersistenceStatus(),
  });
});

async function respondAdminHardDelete(
  req: Request,
  res: Response,
  admin: { email: string },
  label: string,
  result: HardDeleteEntityResult
) {
  const ip = getClientIp(req);
  if (result.partialFailure) {
    appendSecurityAuditEvent({
      event: 'HARD_DELETE_PARTIAL_FAILURE',
      severity: 'warning',
      actor: admin.email,
      ip,
      summary: `حذف جزئي (${label}: ${result.deletedId}): تم المسح من قاعدة البيانات مع تعذر حذف بعض الملفات السحابية (${result.failedMediaFiles.length}).`,
      meta: {
        entityType: result.entityType,
        deletedId: result.deletedId,
        deletedMediaCount: result.deletedMediaFiles.length,
        failedMediaCount: result.failedMediaFiles.length,
      },
    });
    return res.status(207).json({
      success: false,
      partialFailure: true,
      error: result.error,
      entityType: result.entityType,
      deletedId: result.deletedId,
      dbDeleted: result.dbDeleted,
      verifiedRemovedFromDb: result.verifiedRemovedFromDb,
      deletedMediaFiles: result.deletedMediaFiles,
      skippedSharedMediaFiles: result.skippedSharedMediaFiles,
      failedMediaFiles: result.failedMediaFiles,
      cleanedDependencies: result.cleanedDependencies,
      retainedLegalRecordsNote: result.retainedLegalRecordsNote,
      backupRetentionNote: result.backupRetentionNote,
      ...result.state,
      persistenceStatus: getPersistenceStatus(),
    });
  }

  if (!result.ok) {
    return res.status(result.statusCode || 400).json({
      success: false,
      error: result.error || `تعذر حذف ${label} نهائياً.`,
      entityType: result.entityType,
      deletedId: result.deletedId,
      dbDeleted: result.dbDeleted,
      verifiedRemovedFromDb: result.verifiedRemovedFromDb,
    });
  }

  appendSecurityAuditEvent({
    event: 'HARD_DELETE_CONFIRMED',
    severity: 'info',
    actor: admin.email,
    ip,
    summary: `حذف نهائي مؤكد (${label}: ${result.deletedId}) — تم المسح من قاعدة البيانات وتنظيف ${result.deletedMediaFiles.length} ملف وسائط.`,
    meta: {
      entityType: result.entityType,
      deletedId: result.deletedId,
      deletedMediaCount: result.deletedMediaFiles.length,
      skippedSharedMediaCount: result.skippedSharedMediaFiles.length,
      cleanedDependencies: result.cleanedDependencies.join(' | '),
    },
  });

  emitAdminNotification({
    category: 'activity',
    severity: 'warning',
    title: `🗑️ حذف نهائي مؤكد (${label})`,
    body: `تم حذف ${label} (${result.deletedId}) من الخادم والتخزين السحابي نهائياً.`,
    url: '/owner/dashboard',
  });

  return res.status(200).json({
    success: true,
    verified: result.verifiedRemovedFromDb,
    partialFailure: false,
    entityType: result.entityType,
    deletedId: result.deletedId,
    dbDeleted: result.dbDeleted,
    verifiedRemovedFromDb: result.verifiedRemovedFromDb,
    deletedMediaFiles: result.deletedMediaFiles,
    skippedSharedMediaFiles: result.skippedSharedMediaFiles,
    failedMediaFiles: [],
    cleanedDependencies: result.cleanedDependencies,
    retainedLegalRecordsNote: result.retainedLegalRecordsNote,
    backupRetentionNote: result.backupRetentionNote,
    ...result.state,
    persistenceStatus: getPersistenceStatus(),
  });
}

app.delete('/api/admin/store/products/:productId', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('adminHardDelete', ip, 40, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      error: `تم تجاوز حد عمليات الحذف، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
    });
  }
  const result = await hardDeleteProduct(req.params.productId);
  return respondAdminHardDelete(req, res, admin, 'المنتج', result);
});

app.delete('/api/admin/store/categories/:categoryId', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('adminHardDelete', ip, 40, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      error: `تم تجاوز حد عمليات الحذف، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
    });
  }
  const result = await hardDeleteCategory(req.params.categoryId);
  return respondAdminHardDelete(req, res, admin, 'القسم', result);
});

app.delete('/api/admin/store/companies/:companyId', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('adminHardDelete', ip, 40, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      error: `تم تجاوز حد عمليات الحذف، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
    });
  }
  const result = await hardDeleteCompany(req.params.companyId);
  return respondAdminHardDelete(req, res, admin, 'الشريك', result);
});

app.delete('/api/admin/store/banners/:bannerId', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('adminHardDelete', ip, 40, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      error: `تم تجاوز حد عمليات الحذف، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
    });
  }
  const result = await hardDeleteBanner(req.params.bannerId);
  return respondAdminHardDelete(req, res, admin, 'البانر', result);
});

app.post('/api/admin/media/inspect', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('adminMediaInspect', ip, 40, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      error: `تم تجاوز حد فحص الصور مؤقتاً، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
    });
  }
  const urlInput = typeof req.body?.url === 'string' ? req.body.url : '';
  const allowLoopback =
    process.env.NODE_ENV !== 'production' &&
    process.env.ECHOX_ALLOW_TEST_LOOPBACK_MEDIA === '1' &&
    isLoopbackHostname(getClientIp(req));
  const result = await inspectImageUrlOnServer(urlInput, { allowLoopbackForTest: allowLoopback });
  return res.json({
    success: true,
    result,
  });
});

app.get('/api/admin/media/status', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  return res.json({
    success: true,
    ...getMediaStorageStatus(),
  });
});

app.post(
  '/api/admin/media/upload',
  express.raw({
    type: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/octet-stream'],
    limit: MAX_PRODUCT_IMAGE_UPLOAD_BYTES + 1024 * 64,
  }),
  async (req: Request, res: Response) => {
    const admin = requireAdminAuth(req, res);
    if (!admin) return;

    const ip = getClientIp(req);
    const rate = checkSlidingWindowLimit('adminMediaUpload', ip, 30, 60 * 1000);
    if (!rate.allowed) {
      return res.status(429).json({
        success: false,
        error: `تم تجاوز حد رفع الصور مؤقتاً، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.`,
      });
    }

    if (!Buffer.isBuffer(req.body)) {
      return res.status(415).json({
        success: false,
        error: 'تنسيق الطلب غير مدعوم. يرجى إرسال ملف الصورة الفعلي (JPEG / PNG / WebP).',
      });
    }

    const rawFileNameHeader = String(req.headers['x-file-name'] || '');
    let decodedFileName = rawFileNameHeader;
    try {
      decodedFileName = decodeURIComponent(rawFileNameHeader);
    } catch {
      decodedFileName = rawFileNameHeader;
    }

    const result = await uploadVerifiedProductImage({
      buffer: req.body,
      declaredMime: String(req.headers['content-type'] || ''),
      originalName: decodedFileName,
      actorIp: ip,
      actorEmail: admin.email,
    });

    if (!result.ok || !result.url) {
      return res.status(result.statusCode || 400).json({
        success: false,
        error: result.error || 'تعذر حفظ الصورة في التخزين السحابي الدائم.',
      });
    }

    appendSecurityAuditEvent({
      event: 'PRODUCT_MEDIA_UPLOADED',
      severity: 'info',
      actor: admin.email,
      ip,
      summary: `رفع صورة منتج (${result.format || 'IMAGE'}) بحجم ${result.sizeBytes || 0} بايت عبر ${result.provider}.`,
      meta: {
        mediaId: result.mediaId || '',
        provider: result.provider || '',
        sizeBytes: result.sizeBytes || 0,
        url: result.url,
      },
    });

    return res.status(201).json({
      success: true,
      mediaId: result.mediaId,
      fileName: result.fileName,
      url: result.url,
      mime: result.mime,
      format: result.format,
      sizeBytes: result.sizeBytes,
      provider: result.provider,
    });
  }
);

app.use((err: any, req: Request, res: Response, next: any) => {
  if (req.path === '/api/admin/media/upload' && (err?.type === 'entity.too.large' || err?.status === 413)) {
    return res.status(413).json({
      success: false,
      error: 'حجم الصورة يتجاوز الحد الأقصى المسموح به (10 ميغابايت).',
    });
  }
  return next(err);
});

app.get('/api/media/products/:fileName', async (req: Request, res: Response) => {
  const asset = await readStoredProductImage(req.params.fileName || '');
  if (!asset) {
    return res.status(404).json({
      success: false,
      error: 'ملف الصورة غير موجود.',
    });
  }

  const ifNoneMatch = String(req.headers['if-none-match'] || '').trim();
  if (ifNoneMatch && ifNoneMatch === asset.etag) {
    return res.status(304).end();
  }

  res.setHeader('Content-Type', asset.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('ETag', asset.etag);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Length', String(asset.buffer.length));
  return res.status(200).send(asset.buffer);
});

// ==========================================
// 👤 CUSTOMER ACCOUNTS, SESSIONS & ORDERS
// ==========================================
app.post('/api/customer/register', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verifyCustomerMutationSecurity(req, res)) return;
  const lang = extractCustomerLang(req);
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('custRegister', ip, 10, 15 * 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({
      success: false,
      error: getCustomerAuthMessage(lang, 'rateLimitRegister'),
    });
  }
  const secret = getValidatedHmacSecret();
  if (!secret) {
    return res.status(503).json({
      success: false,
      error: getCustomerAuthMessage(lang, 'sessionSignFailed'),
    });
  }
  const result = await registerCustomerAccount({
    fullName: String(req.body?.fullName || ''),
    email: String(req.body?.email || ''),
    phone: String(req.body?.phone || ''),
    password: String(req.body?.password || ''),
    confirmPassword: req.body?.confirmPassword,
    lang,
  });
  if (!result.ok || !result.customer) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  const signed = signCustomerSessionToken(result.customer.id, secret);
  res.setHeader('Set-Cookie', [buildCustomerSessionCookie(req, signed.token, 14 * 24 * 3600)]);
  return res.status(201).json({ success: true, customer: result.customer });
});

app.post('/api/customer/login', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verifyCustomerMutationSecurity(req, res)) return;
  const lang = extractCustomerLang(req);
  const ip = getClientIp(req);
  const cleanEmailKey = String(req.body?.email || '').trim().toLowerCase();

  const ipLock = checkLockout('custLogin', ip);
  if (ipLock.locked) {
    return res.status(429).json({
      success: false,
      error: getCustomerAuthMessage(lang, 'rateLimitLogin'),
    });
  }
  if (cleanEmailKey) {
    const emailLock = checkLockout('custLoginEmail', cleanEmailKey);
    if (emailLock.locked) {
      return res.status(429).json({
        success: false,
        error: getCustomerAuthMessage(lang, 'rateLimitLogin'),
      });
    }
  }

  const secret = getValidatedHmacSecret();
  if (!secret) {
    return res.status(503).json({
      success: false,
      error: getCustomerAuthMessage(lang, 'sessionSignFailed'),
    });
  }

  const result = await authenticateCustomerAccount({
    email: String(req.body?.email || ''),
    password: String(req.body?.password || ''),
    lang,
  });
  if (!result.ok || !result.customer) {
    recordFailedAttempt('custLogin', ip, 10, 5 * 60 * 1000);
    if (cleanEmailKey) {
      recordFailedAttempt('custLoginEmail', cleanEmailKey, 8, 5 * 60 * 1000);
    }
    return res.status(result.statusCode || 401).json({ success: false, error: result.error });
  }
  resetBucket('custLogin', ip);
  if (cleanEmailKey) {
    resetBucket('custLoginEmail', cleanEmailKey);
  }
  const signed = signCustomerSessionToken(result.customer.id, secret);
  res.setHeader('Set-Cookie', [buildCustomerSessionCookie(req, signed.token, 14 * 24 * 3600)]);
  return res.json({ success: true, customer: result.customer });
});

app.post('/api/customer/logout', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verifyCustomerMutationSecurity(req, res)) return;
  const rawToken = parseCookies(req)['__customer_session'];
  const secret = getValidatedHmacSecret();
  if (rawToken && secret) {
    const parsed = verifyCustomerSessionToken(rawToken, secret);
    if (parsed) {
      await revokeCustomerSession(parsed.sessionId, parsed.expiresAt);
    }
  }
  res.setHeader('Set-Cookie', [buildCustomerSessionCookie(req, '', 0)]);
  return res.json({ success: true });
});

app.get('/api/customer/me', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const lang = extractCustomerLang(req);
  await syncCustomerAccountsIfStale(false).catch(() => {});
  const sess = resolveCustomerSession(req);
  if (!sess) {
    return res.status(401).json({ success: false, authenticated: false, customer: null });
  }
  if (!assertNoCustomerIdorTampering(req, res, sess.customerId, lang)) return;

  let customer = getCustomerById(sess.customerId);
  if (!customer) {
    await syncCustomerAccountsIfStale(true, 0).catch(() => {});
    customer = getCustomerById(sess.customerId);
  }
  if (!customer) {
    return res.status(401).json({ success: false, authenticated: false, customer: null });
  }
  return res.json({ success: true, authenticated: true, customer });
});

app.get('/api/customer/profile', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const lang = extractCustomerLang(req);
  await syncCustomerAccountsIfStale(false).catch(() => {});
  const sess = resolveCustomerSession(req);
  if (!sess) {
    return res.status(401).json({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredProfile') });
  }
  if (!assertNoCustomerIdorTampering(req, res, sess.customerId, lang)) return;
  const customer = getCustomerById(sess.customerId);
  if (!customer) {
    return res.status(401).json({ success: false, error: getCustomerAuthMessage(lang, 'accountNotFound') });
  }
  return res.json({ success: true, customer });
});

app.patch('/api/customer/profile', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verifyCustomerMutationSecurity(req, res)) return;
  const lang = extractCustomerLang(req);
  const sess = resolveCustomerSession(req);
  if (!sess) {
    return res.status(401).json({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredProfile') });
  }
  if (!assertNoCustomerIdorTampering(req, res, sess.customerId, lang)) return;

  const rate = checkSlidingWindowLimit('custProfile', sess.customerId, 15, 5 * 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: getCustomerAuthMessage(lang, 'rateLimitProfile') });
  }

  const result = await updateCustomerProfileServer(sess.customerId, {
    fullName: typeof req.body?.fullName === 'string' ? req.body.fullName : undefined,
    phone: typeof req.body?.phone === 'string' ? req.body.phone : undefined,
    lang,
  });
  if (!result.ok || !result.customer) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, customer: result.customer });
});

app.put('/api/customer/wishlist', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verifyCustomerMutationSecurity(req, res)) return;
  const lang = extractCustomerLang(req);
  const sess = resolveCustomerSession(req);
  if (!sess) {
    return res.status(401).json({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredWishlist') });
  }
  if (!assertNoCustomerIdorTampering(req, res, sess.customerId, lang)) return;

  const result = await syncCustomerWishlistServer(sess.customerId, req.body?.wishlist, lang);
  if (!result.ok || !result.customer) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, customer: result.customer });
});

app.post('/api/customer/addresses', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verifyCustomerMutationSecurity(req, res)) return;
  const lang = extractCustomerLang(req);
  const sess = resolveCustomerSession(req);
  if (!sess) {
    return res.status(401).json({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredAddresses') });
  }
  if (!assertNoCustomerIdorTampering(req, res, sess.customerId, lang)) return;

  const result = await addCustomerAddressServer(sess.customerId, req.body || {}, lang);
  if (!result.ok || !result.customer) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, customer: result.customer });
});

app.patch('/api/customer/addresses/default', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verifyCustomerMutationSecurity(req, res)) return;
  const lang = extractCustomerLang(req);
  const sess = resolveCustomerSession(req);
  if (!sess) {
    return res.status(401).json({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredAddresses') });
  }
  if (!assertNoCustomerIdorTampering(req, res, sess.customerId, lang)) return;

  const result = await setDefaultCustomerAddressServer(sess.customerId, String(req.body?.addressId || ''), lang);
  if (!result.ok || !result.customer) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, customer: result.customer });
});

app.delete('/api/customer/addresses/:addressId', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!verifyCustomerMutationSecurity(req, res)) return;
  const lang = extractCustomerLang(req);
  const sess = resolveCustomerSession(req);
  if (!sess) {
    return res.status(401).json({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredAddresses') });
  }
  if (!assertNoCustomerIdorTampering(req, res, sess.customerId, lang)) return;

  const result = await deleteCustomerAddressServer(sess.customerId, req.params.addressId || '', lang);
  if (!result.ok || !result.customer) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, customer: result.customer });
});

app.get('/api/customer/orders', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const lang = extractCustomerLang(req);
  await Promise.all([
    syncCustomerAccountsIfStale(false).catch(() => {}),
    syncPaymentDbIfStale(false).catch(() => {}),
  ]);
  const sess = resolveCustomerSession(req);
  if (!sess) {
    return res.status(401).json({ success: false, error: getCustomerAuthMessage(lang, 'loginRequiredOrders') });
  }
  if (!assertNoCustomerIdorTampering(req, res, sess.customerId, lang)) return;

  let customer = getCustomerById(sess.customerId);
  if (!customer) {
    await syncCustomerAccountsIfStale(true, 0).catch(() => {});
    customer = getCustomerById(sess.customerId);
  }
  if (!customer) {
    return res.status(401).json({ success: false, error: getCustomerAuthMessage(lang, 'accountNotFound') });
  }
  const orders = getCustomerScopedOrders(customer.id);
  return res.json({ success: true, orders });
});

app.post('/api/store/products/:productId/reviews', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('productReview', ip, 15, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  await Promise.all([
    syncCustomerAccountsIfStale(false).catch(() => {}),
    syncPaymentDbIfStale(false).catch(() => {}),
  ]);
  const sess = resolveCustomerSession(req);
  const customer = sess ? getCustomerById(sess.customerId) : null;

  const verifiedPurchase = hasVerifiedCustomerPurchase({
    productId: req.params.productId,
    customerId: customer?.id,
    customerPhone: customer?.phone,
    orderTrackingNumber:
      typeof req.body?.orderTrackingNumber === 'string' ? req.body.orderTrackingNumber : undefined,
    orderPhone: typeof req.body?.orderPhone === 'string' ? req.body.orderPhone : undefined,
  });

  const result = await addPublicProductReview(req.params.productId, {
    authorName: String(req.body?.authorName || req.body?.customerName || customer?.fullName || ''),
    rating: Number(req.body?.rating),
    comment: String(req.body?.comment || ''),
    verifiedPurchase,
    customerId: customer?.id,
  });
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  emitAdminNotification({
    category: 'activity',
    severity: 'info',
    title: `⭐ تقييم جديد (${req.body?.rating || 5}/5)${verifiedPurchase ? ' — مشتري موثق' : ''}`,
    body: `المنتج: ${result.product?.name?.ar || req.params.productId} — ${req.body?.customerName || req.body?.authorName || customer?.fullName || 'زائر NIAPOLOR'}`,
    url: '/owner/dashboard',
  });
  return res.json({ success: true, product: result.product, review: result.product?.reviews?.[0] });
});

app.post('/api/store/inquiries', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rate = checkSlidingWindowLimit('inquiries', ip, 10, 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` });
  }
  const result = await addPublicInquiry(req.body || {});
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  emitAdminNotification({
    category: 'support',
    severity: 'info',
    title: '📩 استفسار جديد من صفحة اتصل بنا',
    body: `${result.inquiry?.senderName || 'زبون'}: ${result.inquiry?.subject || ''}`,
    url: '/owner/dashboard',
  });
  return res.json({ success: true, inquiry: result.inquiry });
});

app.post('/api/admin/store/inquiries/:inquiryId/reply', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const result = await adminReplyToInquiry(req.params.inquiryId, req.body?.reply || '');
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, inquiry: result.inquiry });
});

// ==========================================
// 🔔 MOBILE WEB PUSH & CONTROL ROOM NOTIFICATIONS
// ==========================================
app.get('/api/notifications/public', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  await syncNotificationsIfStale(false).catch(() => {});
  return res.json({
    success: true,
    vapidPublicKey: getVapidPublicKey(),
    announcements: getPublicAnnouncements(),
  });
});

app.post('/api/notifications/public/subscribe', async (req: Request, res: Response) => {
  const result = await subscribePublicPush(req.body?.subscription, getHmacSecret());
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, unsubscribeToken: result.unsubscribeToken });
});

app.post('/api/notifications/public/unsubscribe', async (req: Request, res: Response) => {
  const result = await unsubscribePublicPush(
    String(req.body?.endpoint || ''),
    String(req.body?.unsubscribeToken || ''),
    getHmacSecret()
  );
  if (!result.ok) {
    return res.status(result.statusCode || 503).json({ success: false, error: result.error });
  }
  return res.json({ success: true });
});

app.get('/api/admin/notifications', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  await syncNotificationsIfStale(true).catch(() => {});
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  return res.json({
    success: true,
    ...getAdminNotificationsOverview(since),
  });
});

app.post('/api/admin/notifications/subscribe', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const result = await subscribeAdminPush(req.body?.subscription, req.body?.deviceLabel);
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, subscriptionsCount: result.subscriptionsCount });
});

app.post('/api/admin/notifications/unsubscribe', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const result = await unsubscribeAdminPush(String(req.body?.endpoint || ''));
  if (!result.ok) {
    return res.status(result.statusCode || 503).json({ success: false, error: result.error });
  }
  return res.json({ success: true });
});

app.put('/api/admin/notifications/settings', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const result = await updateNotificationSettings(req.body || {});
  if (!result.ok) {
    return res.status(result.statusCode || 503).json({ success: false, error: result.error });
  }
  return res.json({ success: true, settings: result.settings });
});

app.post('/api/admin/notifications/read', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
  const result = await markAdminNotificationsRead(ids);
  if (!result.ok) {
    return res.status(result.statusCode || 503).json({ success: false, error: result.error });
  }
  return res.json({ success: true, unreadCount: result.unreadCount });
});

app.delete('/api/admin/notifications', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const result = await clearAdminNotifications();
  if (!result.ok) {
    return res.status(result.statusCode || 503).json({ success: false, error: result.error });
  }
  return res.json({ success: true });
});

app.post('/api/admin/notifications/test', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const result = await sendTestAdminPush(typeof req.body?.endpoint === 'string' ? req.body.endpoint : undefined);
  return res.json({ success: true, ...result });
});

// ==========================================
// 🏰 SECRET CONTROL ROOM — AUDIT, INTEGRITY, QUARANTINE & SAFE RECOVERY
// ==========================================

function collectCurrentRecoveryBundle(): RecoveryPayloadBundle {
  return {
    store: getStoreRecoverySnapshot(),
    payments: getPaymentRecoverySnapshot(),
    chatConfig: getPublicChatConfig(),
    notificationSettings: { ...getNotificationSettingsSnapshot() },
  };
}

async function verifyStepUpPin(req: Request, pinInput: unknown): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const ip = getClientIp(req);
  const lockState = checkLockout('recoveryStepUpPin', ip);
  if (lockState.locked) {
    return {
      ok: false,
      statusCode: 429,
      error: `تم تجميد تأكيد الـ PIN للعمليات الحساسة لمدة ${lockState.remainingSeconds} ثانية.`,
    };
  }
  if (!centralSecurityConfig) {
    await initCentralSecurityConfig();
  }
  const cleanPin = typeof pinInput === 'string' ? pinInput.trim() : '';
  if (!cleanPin) {
    return { ok: false, statusCode: 403, error: 'يلزم إدخال رمز الـ PIN الأمني لتنفيذ هذا الإجراء الحساس.' };
  }
  let valid = false;
  try {
    valid = await argon2.verify(centralSecurityConfig!.pin_argon2, cleanPin);
  } catch {}
  if (!valid) {
    const fail = recordFailedAttempt('recoveryStepUpPin', ip, 3, 60 * 1000);
    appendSecurityAuditEvent({
      event: 'RECOVERY_STEP_UP_PIN_FAILED',
      severity: 'critical',
      actor: OWNER_EMAIL,
      ip,
      summary: `فشل تأكيد رمز الـ PIN عند محاولة إجراء استعادة أو نسخ احتياطي موقع.`,
      meta: { attemptsLeft: fail.attemptsLeft, locked: fail.locked },
    });
    return {
      ok: false,
      statusCode: fail.locked ? 429 : 403,
      error: fail.locked
        ? `محاولات PIN خاطئة متعددة! تم التجميد لمدة ${fail.remainingSeconds} ثانية.`
        : `رمز الـ PIN التأكيدي غير صحيح (المتبقي: ${fail.attemptsLeft}).`,
    };
  }
  resetBucket('recoveryStepUpPin', ip);
  return { ok: true };
}

app.get('/api/admin/security/audit-logs', (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  const limit = Number(req.query.limit || 100);
  const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
  return res.json({
    success: true,
    ...getSecurityAuditLogs(limit, severity),
  });
});

app.get('/api/admin/security/integrity', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  await Promise.all([
    syncCentralSecurityIfStale(true).catch(() => {}),
    syncStoreStateIfStale(true).catch(() => {}),
    syncPaymentDbIfStale(true).catch(() => {}),
  ]);
  const paymentOverview = getAdminPaymentOverview();
  const hmacStatus = getServerHmacStatus();
  const report = runSystemIntegrityAudit({
    actorIp: getClientIp(req),
    centralSecurityConfig,
    hmacSecretLength: hmacStatus.charLength,
    hmacEffectiveBytes: hmacStatus.effectiveBytes,
    hmacFromEnv: hmacStatus.valid,
    storeState: getStoreRecoverySnapshot(),
    paymentPublicConfig: getAdminPaymentConfig(),
    paymentOrders: paymentOverview.orders,
  });
  return res.json({
    success: true,
    report,
    persistenceStatus: getPersistenceStatus(),
  });
});

app.get('/api/admin/security/quarantine', (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    success: true,
    ...getQuarantineVault(),
  });
});

app.post('/api/admin/security/quarantine/:id/action', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  const action = req.body?.action === 'purge' ? 'purge' : req.body?.action === 'inspect' ? 'inspect' : null;
  if (!action) {
    return res.status(400).json({ success: false, error: 'الإجراء المطلوب غير صالح (inspect أو purge).' });
  }
  const result = await actOnQuarantineItem(req.params.id, action, getClientIp(req));
  if (!result.ok) {
    return res.status(result.statusCode || 400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, item: result.item, vault: getQuarantineVault() });
});

app.get('/api/admin/security/backup/snapshots', (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    success: true,
    snapshots: listRecoverySnapshots(),
  });
});

app.post('/api/admin/security/backup/create', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const pinCheck = await verifyStepUpPin(req, req.body?.confirmPin);
  if (!pinCheck.ok) {
    return res.status(pinCheck.statusCode || 403).json({
      success: false,
      requiresPinConfirmation: true,
      error: pinCheck.error,
    });
  }
  await Promise.all([
    syncStoreStateIfStale(true).catch(() => {}),
    syncPaymentDbIfStale(true).catch(() => {}),
    syncChatDbIfStale(true).catch(() => {}),
    syncNotificationsIfStale(true).catch(() => {}),
  ]);
  const created = await createSignedRecoverySnapshot({
    label: typeof req.body?.label === 'string' ? req.body.label : undefined,
    kind: 'manual',
    createdBy: admin.email,
    actorIp: getClientIp(req),
    hmacSecret: getHmacSecret(),
    payload: collectCurrentRecoveryBundle(),
    redactSecrets: true,
  });
  if (!created.ok || !created.snapshot) {
    return res.status(503).json({ success: false, error: created.error || 'تعذر إنشاء اللقطة الموقعة.' });
  }
  return res.json({
    success: true,
    snapshot: created.snapshot,
    snapshots: listRecoverySnapshots(),
  });
});

app.post('/api/admin/security/backup/dry-run', async (req: Request, res: Response) => {
  if (!requireAdminAuth(req, res)) return;
  await Promise.all([
    syncStoreStateIfStale(true).catch(() => {}),
    syncPaymentDbIfStale(true).catch(() => {}),
  ]);
  let rawBundle: unknown = req.body?.bundle;
  if (!rawBundle && typeof req.body?.snapshotId === 'string') {
    const snap = getRecoverySnapshotById(req.body.snapshotId);
    if (!snap) {
      return res.status(404).json({ success: false, error: 'اللقطة المطلوبة غير موجودة.' });
    }
    rawBundle = snap;
  }
  const { dryRun } = dryRunRecoveryBundle({
    rawBundle,
    hmacSecret: getHmacSecret(),
    currentPayload: collectCurrentRecoveryBundle(),
    actorIp: getClientIp(req),
  });
  return res.json({ success: true, dryRun });
});

app.post('/api/admin/security/backup/restore', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const pinCheck = await verifyStepUpPin(req, req.body?.confirmPin);
  if (!pinCheck.ok) {
    return res.status(pinCheck.statusCode || 403).json({
      success: false,
      requiresPinConfirmation: true,
      error: pinCheck.error,
    });
  }

  let rawBundle: unknown = req.body?.bundle;
  if (!rawBundle && typeof req.body?.snapshotId === 'string') {
    const snap = getRecoverySnapshotById(req.body.snapshotId);
    if (!snap) {
      return res.status(404).json({ success: false, error: 'اللقطة المطلوبة غير موجودة.' });
    }
    rawBundle = snap;
  }

  const currentBundle = collectCurrentRecoveryBundle();
  const analysis = dryRunRecoveryBundle({
    rawBundle,
    hmacSecret: getHmacSecret(),
    currentPayload: currentBundle,
    actorIp: getClientIp(req),
  });

  if (!analysis.dryRun.validToApply || !analysis.extracted) {
    return res.status(400).json({
      success: false,
      error: analysis.dryRun.schemaErrors[0] || 'فشل التحقق المبدئي (Dry-Run) للنسخة الاحتياطية.',
      dryRun: analysis.dryRun,
    });
  }

  const requireSigned = req.body?.allowUnsigned !== true;
  if (requireSigned && !analysis.dryRun.signatureValid) {
    return res.status(400).json({
      success: false,
      error: 'النسخة غير موقعة خادمياً بختم HMAC؛ فعّل خيار السماح للاستعادة من نسخة محلية بعد مراجعة الفحص.',
      dryRun: analysis.dryRun,
    });
  }

  const ip = getClientIp(req);
  const preSnap = await createSignedRecoverySnapshot({
    label: `نقطة استرجاع تلقائية قبل استعادة (${new Date().toLocaleTimeString('ar-TN')})`,
    kind: 'pre_restore',
    createdBy: admin.email,
    actorIp: ip,
    hmacSecret: getHmacSecret(),
    payload: currentBundle,
    redactSecrets: false,
  });
  if (!preSnap.ok || !preSnap.snapshot) {
    return res.status(503).json({
      success: false,
      error: preSnap.error || 'تعذر إنشاء نقطة الاسترجاع التلقائية قبل تطبيق الاستعادة؛ تم الإلغاء حفاظاً على البيانات.',
    });
  }

  const extracted = analysis.extracted;
  const storeRes = await restoreStoreRecoverySnapshot(extracted.store);
  if (!storeRes.ok) {
    return res.status(storeRes.statusCode || 503).json({ success: false, error: storeRes.error });
  }

  const payRes = await restorePaymentRecoverySnapshot(extracted.payments, { preserveLiveSecrets: true });
  if (!payRes.ok) {
    await restoreStoreRecoverySnapshot(currentBundle.store).catch(() => {});
    return res.status(payRes.statusCode || 503).json({ success: false, error: payRes.error });
  }

  await syncCatalogSnapshot(storeRes.state.products, { replaceAll: true }).catch(() => {});
  await restoreChatConfigSnapshot(extracted.chatConfig).catch(() => {});
  await restoreNotificationSettingsSnapshot(extracted.notificationSettings).catch(() => {});

  appendSecurityAuditEvent({
    event: 'SYSTEM_RECOVERY_APPLIED',
    severity: 'warning',
    actor: admin.email,
    ip,
    summary: `تم تنفيذ استعادة آمنة للبيانات (نقطة التراجع التلقائية: ${preSnap.snapshot.snapshotId}).`,
    meta: {
      preRestoreSnapshotId: preSnap.snapshot.snapshotId,
      signatureValid: analysis.dryRun.signatureValid,
    },
  });

  return res.json({
    success: true,
    preRestoreSnapshotId: preSnap.snapshot.snapshotId,
    dryRun: analysis.dryRun,
    snapshots: listRecoverySnapshots(),
    message: 'تمت الاستعادة بنجاح مع حفظ نقطة تراجع تلقائية ومزامنة الكاتالوج.',
  });
});

app.post('/api/admin/security/backup/rollback', async (req: Request, res: Response) => {
  const admin = requireAdminAuth(req, res);
  if (!admin) return;
  const pinCheck = await verifyStepUpPin(req, req.body?.confirmPin);
  if (!pinCheck.ok) {
    return res.status(pinCheck.statusCode || 403).json({
      success: false,
      requiresPinConfirmation: true,
      error: pinCheck.error,
    });
  }

  const requestedId = typeof req.body?.snapshotId === 'string' ? req.body.snapshotId : '';
  const targetSnap = requestedId
    ? getRecoverySnapshotById(requestedId)
    : (() => {
        const list = listRecoverySnapshots();
        const latestPre = list.find((s) => s.kind === 'pre_restore');
        return latestPre ? getRecoverySnapshotById(latestPre.snapshotId) : null;
      })();

  if (!targetSnap) {
    return res.status(404).json({ success: false, error: 'لا توجد نقطة تراجع (Pre-Restore) متاحة حالياً.' });
  }

  const storeRes = await restoreStoreRecoverySnapshot(targetSnap.payload.store);
  if (!storeRes.ok) {
    return res.status(storeRes.statusCode || 503).json({ success: false, error: storeRes.error });
  }
  const payRes = await restorePaymentRecoverySnapshot(targetSnap.payload.payments, { preserveLiveSecrets: true });
  if (!payRes.ok) {
    return res.status(payRes.statusCode || 503).json({ success: false, error: payRes.error });
  }

  await syncCatalogSnapshot(storeRes.state.products, { replaceAll: true }).catch(() => {});
  await restoreChatConfigSnapshot(targetSnap.payload.chatConfig).catch(() => {});
  await restoreNotificationSettingsSnapshot(targetSnap.payload.notificationSettings).catch(() => {});

  appendSecurityAuditEvent({
    event: 'SYSTEM_RECOVERY_ROLLBACK',
    severity: 'warning',
    actor: admin.email,
    ip: getClientIp(req),
    summary: `تم تنفيذ تراجع فوري (Rollback) إلى اللقطة ${targetSnap.snapshotId}.`,
    meta: { snapshotId: targetSnap.snapshotId },
  });

  return res.json({
    success: true,
    restoredSnapshotId: targetSnap.snapshotId,
    snapshots: listRecoverySnapshots(),
    message: `تم التراجع بنجاح واستعادة الحالة السابقة (${targetSnap.snapshotId}).`,
  });
});

app.use((err: any, _req: Request, res: Response, next: any) => {
  if (err instanceof HmacSecretNotConfiguredError || err?.code === 'HMAC_SECRET_NOT_CONFIGURED') {
    return res.status(503).json({
      success: false,
      code: 'HMAC_SECRET_NOT_CONFIGURED',
      error:
        'تعذر تشغيل الوظائف الأمنية الحساسة: متغير البيئة ECHOX_SECURITY_HMAC_SECRET غير مضبوط أو أقصر من 32 بايت.',
    });
  }
  return next(err);
});

// --- SERVER INITIALIZATION & EXPORT (Supports both Render/Dev standalone & Serverless Node adapters) ---
let initPromise: Promise<void> | null = null;

async function ensureServerInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await Promise.all([
        initCentralSecurityConfig().catch((err) => console.error('[Security] Init notice:', err)),
        hydrateUsedGateNoncesFromCloud().catch((err) => console.error('[Security] Gate nonces hydrate notice:', err)),
        hydrateSecurityEngineFromCloud().catch((err) => console.error('[SecurityEngine] Cloud hydrate notice:', err)),
        hydrateRateLimitsFromCloud().catch((err) => console.error('[Security] Rate limit hydrate notice:', err)),
        hydrateOwnerLockConfigFromCloud().catch((err) => console.error('[LockConfig] Cloud hydrate notice:', err)),
        hydratePaymentDbFromCloud().catch((err) => console.error('[PaymentEngine] Cloud hydrate notice:', err)),
        hydrateChatDbFromCloud().catch((err) => console.error('[ChatEngine] Cloud hydrate notice:', err)),
        hydrateStoreStateFromCloud().catch((err) => console.error('[StoreEngine] Cloud hydrate notice:', err)),
        hydrateNotificationsFromCloud().catch((err) => console.error('[Notifications] Cloud hydrate notice:', err)),
        hydrateCustomerAccountsFromCloud().catch((err) => console.error('[CustomerEngine] Cloud hydrate notice:', err)),
      ]);

      initStorePaymentBridge();
      ensureInitialBankSealAfterHydrate();
      await syncCatalogSnapshot(getPublicStoreState().products, { replaceAll: true, allowEphemeral: true }).catch(() => {});
    })();
  }
  return initPromise;
}

async function startServer() {
  await ensureServerInitialized();

  const hmacStatus = getServerHmacStatus();
  if (!hmacStatus.valid) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[Security CRITICAL] ECHOX_SECURITY_HMAC_SECRET is missing or shorter than 32 bytes. Sensitive security, authentication, session signing, payment sealing, and recovery features are blocked.'
      );
    } else {
      console.error(
        '[Security ERROR] ECHOX_SECURITY_HMAC_SECRET is missing or shorter than 32 bytes. Sensitive security, auth, session, and payment endpoints will return 503 until configured.'
      );
    }
  }

  if (process.env.NODE_ENV === 'production') {
    if (
      !process.env.ECHOX_BOOTSTRAP_ACCESS_HASH &&
      centralSecurityConfig?.access_code_argon2 === DEFAULT_ACCESS_ARGON2
    ) {
      console.warn('[Security WARNING] Production server running with built-in bootstrap access hash — set ECHOX_BOOTSTRAP_ACCESS_HASH or rotate immediately.');
    }
    if (!process.env.ECHOX_BOOTSTRAP_PIN_HASH && centralSecurityConfig?.pin_argon2 === DEFAULT_PIN_ARGON2) {
      console.warn('[Security WARNING] Production server running with built-in bootstrap PIN hash — set ECHOX_BOOTSTRAP_PIN_HASH or rotate immediately.');
    }
  }

  // Synchronize authoritative payment catalog with persisted store products on startup
  await syncCatalogSnapshot(getPublicStoreState().products, { replaceAll: true, allowEphemeral: true });

  await probeCloudPersistenceConnection().catch(() => null);
  const persistence = getPersistenceStatus();
  console.log(
    `[Persistence] Provider=${persistence.provider} | Durable=${persistence.durable} | Cloud=${persistence.cloudEnabled} | DataDir=${persistence.dataDir}${persistence.lastCloudError ? ` | Notice=${persistence.lastCloudError}` : ''}`
  );

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (isProd && fs.existsSync(distDir)) {
    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), {
        maxAge: '365d',
        immutable: true,
      })
    );
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (base === 'sw.js') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Service-Worker-Allowed', '/');
          } else if (base === 'sw-precache.json' || base === 'index.html') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (base === 'manifest.webmanifest' || base === 'manifest.json') {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          } else if (base.startsWith('pwa-') || base.startsWith('apple-touch-icon')) {
            res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
          }
        },
      })
    );
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, error: 'Endpoint not found' });
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: ['.run.app', 'localhost', '127.0.0.1'] },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ECHOX STORE] Full-Stack Server (${isProd ? 'production' : 'development'}) listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[ECHOX STORE] Received ${signal}, flushing cloud writes and shutting down cleanly...`);
    await flushCloudWrites();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

const isServerlessRuntime = Boolean(
  process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.ECHOX_DISABLE_LISTEN === '1'
);

if (!isServerlessRuntime) {
  startServer();
}

export { app, ensureServerInitialized };
export default app;
