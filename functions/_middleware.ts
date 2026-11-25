interface EdgeEnv {
  ENVIRONMENT?: string;
  SITE_URL?: string;
  VITE_SITE_URL?: string;
  CORS_ORIGIN?: string;
  [key: string]: string | undefined;
}

interface MiddlewareContext {
  request: Request;
  env: EdgeEnv;
  next: () => Promise<Response>;
}

const PRIVATE_ROUTE_PREFIXES = [
  '/owner',
  '/owner_dashboard',
  '/my_orders',
  '/orders',
  '/account',
  '/wishlist',
  '/api',
];

const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com https://www.gstatic.com https://www.googletagmanager.com https://www.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://www.googleapis.com https://apis.google.com https://www.google.com https://www.gstatic.com https://api.emailjs.com https://api.konnect.network https://api.sandbox.konnect.network https://developers.flouci.com https://niapolor.pages.dev https://echox-store.onrender.com",
  "frame-src https://www.googletagmanager.com https://www.google.com https://www.gstatic.com https://gen-lang-client-0499444627.firebaseapp.com https://konnect.network https://developers.flouci.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://konnect.network https://api.konnect.network https://developers.flouci.com",
  "frame-ancestors 'self'",
].join('; ');

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  const url = new URL(context.request.url);
  if (url.protocol === 'http:' && !url.hostname.includes('localhost') && url.hostname !== '127.0.0.1') {
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }

  const response = await context.next();
  const newResponse = new Response(response.body, response);

  newResponse.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  newResponse.headers.set('X-Content-Type-Options', 'nosniff');
  newResponse.headers.set('X-Frame-Options', 'SAMEORIGIN');
  newResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  newResponse.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  newResponse.headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  const p = url.pathname.toLowerCase();
  newResponse.headers.set(
    'Cross-Origin-Resource-Policy',
    p.startsWith('/assets/') || p.startsWith('/api/media/') ? 'cross-origin' : 'same-site'
  );
  newResponse.headers.set('Content-Security-Policy', STRICT_CSP);

  if (!newResponse.headers.has('Access-Control-Allow-Origin')) {
    newResponse.headers.set('Access-Control-Allow-Origin', 'https://niapolor.pages.dev');
  }

  if (p === '/.well-known/security.txt') {
    newResponse.headers.set('Content-Type', 'text/plain; charset=utf-8');
    newResponse.headers.set('Cache-Control', 'public, max-age=3600');
  }

  const isPrivate = PRIVATE_ROUTE_PREFIXES.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
  );

  if (isPrivate) {
    newResponse.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  // Authentication responses, including Set-Cookie, must never be cached by an edge or browser.
  if (url.pathname.startsWith('/api/')) {
    newResponse.headers.set('Cache-Control', 'no-store');
  }

  return newResponse;
}
