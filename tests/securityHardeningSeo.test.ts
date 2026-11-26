import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import argon2 from 'argon2';

function readText(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf-8');
}

function assertIncludes(haystack: string, needle: string, message: string): void {
  assert.ok(haystack.includes(needle), `${message} (missing: ${needle})`);
}

function assertNotIncludes(haystack: string, needle: string, message: string): void {
  assert.ok(!haystack.includes(needle), `${message} (unexpected: ${needle})`);
}

async function run(): Promise<void> {
  // 1. Verify static public files & built dist artifacts
  const distDir = path.resolve(process.cwd(), 'dist');
  assert.ok(fs.existsSync(distDir), 'dist directory must exist after build');

  const robotsDist = fs.readFileSync(path.join(distDir, 'robots.txt'), 'utf-8').trim();
  assert.equal(
    robotsDist,
    'User-agent: *\nAllow: /\n\nSitemap: https://niapolor.pages.dev/sitemap.xml',
    'dist/robots.txt matches exact requested directives'
  );

  const securityTxtDist = fs.readFileSync(path.join(distDir, '.well-known/security.txt'), 'utf-8').trim();
  assert.equal(
    securityTxtDist,
    [
      'Contact: mailto:security@niapolor.tn',
      'Expires: 2027-12-31T23:59:59.000Z',
      'Preferred-Languages: ar, fr, en',
      'Canonical: https://niapolor.pages.dev/.well-known/security.txt',
    ].join('\n'),
    'dist/.well-known/security.txt matches exact requested RFC 9116 fields'
  );

  const sitemapDist = fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf-8');
  assertNotIncludes(sitemapDist, 'echoxstore', 'dist/sitemap.xml contains zero echoxstore references');
  assertNotIncludes(sitemapDist, '/owner', 'dist/sitemap.xml excludes /owner');
  assertNotIncludes(sitemapDist, '/account', 'dist/sitemap.xml excludes /account');
  assertNotIncludes(sitemapDist, '/api/', 'dist/sitemap.xml excludes /api/');

  const locMatches = Array.from(sitemapDist.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
  assert.equal(locMatches.length, 18, 'dist/sitemap.xml contains 18 public URLs');
  assert.equal(new Set(locMatches).size, locMatches.length, 'dist/sitemap.xml contains zero duplicate <loc> entries');
  for (const loc of locMatches) {
    assert.ok(loc.startsWith('https://niapolor.pages.dev/'), `Every sitemap <loc> uses canonical domain: ${loc}`);
  }

  // 2. Verify inline executable script removal in source index.html & built dist/index.html
  for (const htmlFile of ['index.html', 'dist/index.html']) {
    const html = readText(htmlFile);
    assertNotIncludes(html, 'echoxstore.pages.dev', `${htmlFile} has zero echoxstore.pages.dev URLs`);
    assertIncludes(html, '<link rel="canonical" href="https://niapolor.pages.dev/" />', `${htmlFile} canonical URL updated`);
    assertIncludes(html, 'src="/assets/js/theme-init.js"', `${htmlFile} loads external theme-init.js`);
    assertIncludes(html, 'src="/assets/js/analytics-init.js"', `${htmlFile} loads external analytics-init.js`);

    const scriptTags = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
    for (const [, attrs, body] of scriptTags) {
      const isJsonLd = /type=["']application\/ld\+json["']/i.test(attrs);
      const hasSrc = /\bsrc=["'][^"']+["']/i.test(attrs);
      if (!isJsonLd) {
        assert.ok(hasSrc, `${htmlFile} script tag without ld+json must have external src attribute: ${attrs}`);
        assert.equal(body.trim(), '', `${htmlFile} external script tag must have empty inline body`);
      }
    }
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${htmlFile} contains zero inline event handlers`);
  }

  assert.ok(fs.existsSync(path.join(distDir, 'assets/js/theme-init.js')), 'dist/assets/js/theme-init.js exists');
  assert.ok(fs.existsSync(path.join(distDir, 'assets/js/analytics-init.js')), 'dist/assets/js/analytics-init.js exists');

  // 3. Verify _headers in dist/
  const headersDist = fs.readFileSync(path.join(distDir, '_headers'), 'utf-8');
  assertIncludes(headersDist, 'Strict-Transport-Security: max-age=31536000; includeSubDomains', 'dist/_headers sets HSTS');
  assertIncludes(headersDist, 'X-Content-Type-Options: nosniff', 'dist/_headers sets nosniff');
  assertIncludes(headersDist, 'X-Frame-Options: SAMEORIGIN', 'dist/_headers sets SAMEORIGIN');
  assertIncludes(headersDist, 'Referrer-Policy: strict-origin-when-cross-origin', 'dist/_headers sets Referrer-Policy');
  assertIncludes(headersDist, 'Permissions-Policy: geolocation=(), microphone=(), camera=()', 'dist/_headers sets Permissions-Policy');
  assertIncludes(headersDist, 'Cross-Origin-Opener-Policy: same-origin', 'dist/_headers sets COOP');
  assertIncludes(headersDist, 'Access-Control-Allow-Origin: https://niapolor.pages.dev', 'dist/_headers scopes ACAO to niapolor.pages.dev');
  assertNotIncludes(headersDist, 'echoxstore', 'dist/_headers has zero echoxstore references');
  assertNotIncludes(headersDist, "'unsafe-eval'", 'dist/_headers CSP forbids unsafe-eval');
  const cspLine = headersDist.split('\n').find((l) => l.includes('Content-Security-Policy:')) || '';
  const scriptSrcMatch = cspLine.match(/script-src\s+([^;]+)/);
  assert.ok(scriptSrcMatch, 'CSP includes script-src directive');
  assertNotIncludes(scriptSrcMatch[1], "'unsafe-inline'", 'script-src forbids unsafe-inline');

  // 4. Verify Cloudflare Pages Edge functions behavior directly
  const { onRequest: edgeMiddleware } = await import('../functions/_middleware');
  const { onRequestGet: edgeRobots } = await import('../functions/robots.txt');
  const { onRequestGet: edgeSitemap } = await import('../functions/sitemap.xml');
  const { onRequest: edgeApi } = await import('../functions/api/[[path]]');

  const cfRobotsRes = await edgeRobots({
    request: new Request('https://niapolor.pages.dev/robots.txt'),
    env: { VITE_SITE_URL: 'https://niapolor.pages.dev' },
  });
  assert.equal(await cfRobotsRes.text(), 'User-agent: *\nAllow: /\n\nSitemap: https://niapolor.pages.dev/sitemap.xml\n');

  const cfSitemapRes = await edgeSitemap({
    request: new Request('https://niapolor.pages.dev/sitemap.xml'),
    env: { VITE_SITE_URL: 'https://niapolor.pages.dev' },
  });
  const cfSitemapBody = await cfSitemapRes.text();
  assertIncludes(cfSitemapBody, 'https://niapolor.pages.dev/legal', 'Edge sitemap includes /legal');
  assertIncludes(cfSitemapBody, 'https://niapolor.pages.dev/seller-terms', 'Edge sitemap includes /seller-terms');
  assertNotIncludes(cfSitemapBody, 'echoxstore.pages.dev', 'Edge sitemap omits echoxstore.pages.dev');

  // CORS Edge tests
  const goodPreflight = await edgeApi({
    request: new Request('https://niapolor.pages.dev/api/store/state', {
      method: 'OPTIONS',
      headers: { Origin: 'https://niapolor.pages.dev' },
    }),
    env: { ENVIRONMENT: 'production', VITE_SITE_URL: 'https://niapolor.pages.dev' },
  });
  assert.equal(goodPreflight.status, 204, 'Edge OPTIONS allows https://niapolor.pages.dev');
  assert.equal(goodPreflight.headers.get('Access-Control-Allow-Origin'), 'https://niapolor.pages.dev');
  assert.equal(goodPreflight.headers.get('Access-Control-Allow-Credentials'), 'true');

  const badPreflight = await edgeApi({
    request: new Request('https://niapolor.pages.dev/api/store/state', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil-attacker.example' },
    }),
    env: { ENVIRONMENT: 'production', VITE_SITE_URL: 'https://niapolor.pages.dev' },
  });
  assert.equal(badPreflight.status, 403, 'Edge OPTIONS blocks untrusted Origin');
  assert.equal(badPreflight.headers.get('Access-Control-Allow-Origin'), null, 'Untrusted origin never echoed');

  const legacyPreflight = await edgeApi({
    request: new Request('https://niapolor.pages.dev/api/store/state', {
      method: 'OPTIONS',
      headers: { Origin: 'https://echoxstore.pages.dev' },
    }),
    env: { ENVIRONMENT: 'production', VITE_SITE_URL: 'https://niapolor.pages.dev' },
  });
  assert.equal(legacyPreflight.status, 403, 'Edge OPTIONS rejects stale echoxstore.pages.dev');

  const mwRes = await edgeMiddleware({
    request: new Request('https://niapolor.pages.dev/.well-known/security.txt'),
    env: { ENVIRONMENT: 'production' },
    next: async () => new Response(securityTxtDist, { status: 200 }),
  });
  assert.equal(mwRes.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(mwRes.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(mwRes.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.ok(!mwRes.headers.get('content-security-policy')?.includes("'unsafe-eval'"));

  // 5. Verify Node Express Production Server headers & routes (serving real dist/)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niapolor-sec-seo-'));
  let server: http.Server | null = null;
  const prevNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    process.env.ECHOX_DISABLE_LISTEN = '1';
    process.env.DATA_DIR = tmpDir;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    process.env.ECHOX_SECURITY_HMAC_SECRET = 'test_hmac_secret_production_verify_2026_123456';

    fs.writeFileSync(
      path.join(tmpDir, 'central_security_config.json'),
      JSON.stringify({
        access_code_argon2: await argon2.hash('#TestCode99', { type: argon2.argon2id }),
        pin_argon2: await argon2.hash('654321', { type: argon2.argon2id }),
        updated_at: new Date().toISOString(),
        history: [],
      }),
      'utf-8'
    );

    const { app, ensureServerInitialized } = await import('../server');
    await ensureServerInitialized();
    const express = (await import('express')).default;
    // Mount static dist for runtime static verification matching startServer() production mode
    app.use(express.static(distDir));

    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Bind failed');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const rootRes = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: addr.port, path: '/', method: 'GET', headers: { Host: 'niapolor.pages.dev' } },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(rootRes.status, 200, 'GET / serves built storefront');
    const rootCsp = String(rootRes.headers['content-security-policy'] || '');
    const rootScriptSrc = rootCsp.match(/script-src\s+([^;]+)/)?.[1] || '';
    assertNotIncludes(rootScriptSrc, "'unsafe-inline'", 'Production Express script-src omits unsafe-inline');
    assertNotIncludes(rootScriptSrc, "'unsafe-eval'", 'Production Express script-src omits unsafe-eval');
    assert.equal(rootRes.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(rootRes.headers['x-content-type-options'], 'nosniff');
    assert.equal(rootRes.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(rootRes.headers['cross-origin-opener-policy'], 'same-origin');

    const secTxtRes = await fetch(`${baseUrl}/.well-known/security.txt`);
    assert.equal(secTxtRes.status, 200, 'GET /.well-known/security.txt returns 200');
    assertIncludes(await secTxtRes.text(), 'Contact: mailto:security@niapolor.tn', 'security.txt content served');

    // Verify new social preview banner in built HTML and unauthenticated public retrieval (WhatsApp/FB/Telegram/X)
    const distHtml = readText('dist/index.html');
    const expectedBannerUrl = 'https://niapolor.pages.dev/assets/aistudio/file_00000000be6881f49861ea9a4fa7fa90_4cf997af.png';
    assertIncludes(distHtml, `<meta property="og:image" content="${expectedBannerUrl}" />`, 'dist/index.html sets og:image');
    assertIncludes(distHtml, '<meta property="og:image:type" content="image/png" />', 'dist/index.html sets og:image:type');
    assertIncludes(distHtml, '<meta property="og:image:width" content="1679" />', 'dist/index.html sets og:image:width');
    assertIncludes(distHtml, '<meta property="og:image:height" content="937" />', 'dist/index.html sets og:image:height');
    assertIncludes(distHtml, '<meta property="og:image:alt"', 'dist/index.html sets og:image:alt');
    assertIncludes(distHtml, `<meta name="twitter:image" content="${expectedBannerUrl}" />`, 'dist/index.html sets twitter:image');
    assertIncludes(distHtml, '<meta name="twitter:card" content="summary_large_image" />', 'dist/index.html sets twitter:card');
    assertNotIncludes(distHtml, 'niapolor-logo-full', 'dist/index.html has zero old preview image references');

    for (const ua of ['WhatsApp/2.23.20.0', 'facebookexternalhit/1.1', 'TelegramBot (like TwitterBot)', 'Twitterbot/1.0']) {
      const imgRes = await fetch(`${baseUrl}/assets/aistudio/file_00000000be6881f49861ea9a4fa7fa90_4cf997af.png`, {
        headers: { 'User-Agent': ua },
      });
      assert.equal(imgRes.status, 200, `Banner image returns 200 for ${ua}`);
      assertIncludes(imgRes.headers.get('content-type') || '', 'image/png', `Banner MIME is image/png for ${ua}`);
      assert.equal(imgRes.headers.get('cross-origin-resource-policy'), 'cross-origin', `Banner allows cross-origin retrieval for ${ua}`);
      const buf = await imgRes.arrayBuffer();
      assert.ok(buf.byteLength > 1000000, `Banner image payload intact for ${ua}`);
    }

    const prodCorsAllow = await fetch(`${baseUrl}/api/store/state`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://niapolor.pages.dev' },
    });
    assert.equal(prodCorsAllow.status, 204);
    assert.equal(prodCorsAllow.headers.get('access-control-allow-origin'), 'https://niapolor.pages.dev');

    const prodCorsDeny = await fetch(`${baseUrl}/api/store/state`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil-attacker.invalid' },
    });
    assert.equal(prodCorsDeny.status, 403);
    assert.equal(prodCorsDeny.headers.get('access-control-allow-origin'), null);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('✅ Security Hardening, SEO Infrastructure & Edge CORS verification passed!');
}

run().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
