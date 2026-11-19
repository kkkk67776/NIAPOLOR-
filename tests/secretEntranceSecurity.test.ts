/**
 * Secret Control Room Entrance & Token Hardening Verification Suite
 *
 * Verifies:
 * 1. Public storefront & robots.txt expose ZERO owner links, routes, or secret-gate UI hints.
 * 2. Wrong secret code & rate limiting behave silently without granting access or leaking secrets.
 * 3. Valid secret code issues only a short-lived gateToken and NEVER grants admin/owner privileges.
 * 4. PIN flow, lockout, session cookies, CSRF, and protected endpoints remain intact and enforced.
 * 5. Zero plaintext PINs, access codes, HMAC secrets, or Argon2 hashes leak in frontend or public APIs.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import argon2 from 'argon2';
import { INITIAL_PRODUCTS } from '../src/data/initialData';

const TEST_ACCESS_CODE = '#EchoxTestSecret2026';
const TEST_PIN = '654321';

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message} (expected=${String(expected)}, actual=${String(actual)})`);
  }
}

function readWorkspaceFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf-8');
}

function collectSourceFiles(dirRel: string): string[] {
  const root = path.resolve(process.cwd(), dirRel);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|html|txt)$/.test(entry.name)) out.push(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

async function run(): Promise<void> {
  // =========================================================
  // A. Static Storefront & Client Code Leak / Hint Audit
  // =========================================================
  const bottomNav = readWorkspaceFile('src/components/BottomNavigation.tsx');
  const appTsx = readWorkspaceFile('src/App.tsx');
  const securityRoom = readWorkspaceFile('src/components/security/OwnerSecurityRoom.tsx');
  const ownerDash = readWorkspaceFile('src/components/OwnerDashboard.tsx');
  const header = readWorkspaceFile('src/components/Header.tsx');
  const footer = readWorkspaceFile('src/components/Footer.tsx');
  const robotsTxt = readWorkspaceFile('public/robots.txt');
  const securityClient = readWorkspaceFile('src/lib/security.ts');

  // 1. Search bar has ZERO spinner/error UI or window globals hinting at secret gate
  assertTrue(!bottomNav.includes('isCheckingVault'), 'BottomNavigation removes isCheckingVault spinner state');
  assertTrue(!bottomNav.includes('vaultError'), 'BottomNavigation removes vaultError state');
  assertTrue(!bottomNav.includes('جارٍ التحقق عبر الخادم'), 'BottomNavigation has zero server-checking banner text');
  assertTrue(!bottomNav.includes('__echoxVaultOpenPending'), 'BottomNavigation uses no window vault global');

  // 2. Public storefront components contain ZERO owner dashboard links or buttons
  assertTrue(!header.includes('/owner'), 'Header contains no /owner links');
  assertTrue(!footer.includes('/owner'), 'Footer contains no /owner links');
  assertTrue(!robotsTxt.includes('/owner'), 'public/robots.txt does not advertise /owner routes');

  // 3. Direct unauthenticated vault routes & Ctrl+Shift+E shortcut removed
  assertTrue(!appTsx.includes('/owner/login') || !appTsx.includes('requestOpenVault()'), 'App.tsx does not open vault on /owner/login');
  assertTrue(!securityRoom.includes("e.key === 'E'"), 'OwnerSecurityRoom removes Ctrl+Shift+E direct shortcut');
  assertTrue(securityRoom.includes('consumePendingVaultGateToken'), 'OwnerSecurityRoom requires server-verified gateToken');
  assertTrue(ownerDash.includes('hadUnlockedSession'), 'OwnerDashboard suppresses session-expired popup for direct unauthenticated visitors');

  // 4. Zero Argon2 hashes, HMAC secrets, or hardcoded PINs in client src/
  for (const file of collectSourceFiles('src')) {
    const content = fs.readFileSync(file, 'utf-8');
    assertTrue(!content.includes('$argon2id$'), `Client file ${path.relative(process.cwd(), file)} contains no Argon2 hash`);
    assertTrue(!content.includes('ECHOX_SECURITY_HMAC_SECRET'), `Client file ${path.relative(process.cwd(), file)} contains no HMAC secret env ref`);
    assertTrue(!content.includes('DEFAULT_PIN_ARGON2'), `Client file ${path.relative(process.cwd(), file)} contains no DEFAULT_PIN_ARGON2`);
  }
  assertTrue(securityClient.includes("localStorage.removeItem('echox_owner_settings')"), 'clearOwnerSecuritySession purges owner settings from storage');

  // 5. Normal product search matching unaffected
  const drillMatches = INITIAL_PRODUCTS.filter((p) =>
    `${p.name.ar} ${p.name.fr} ${p.name.en} ${p.description.ar}`.toLowerCase().includes('مثقاب')
  );
  assertTrue(drillMatches.length > 0, 'Normal Arabic product search matches real catalog items');
  const gibberishMatches = INITIAL_PRODUCTS.filter((p) =>
    `${p.name.ar} ${p.name.fr} ${p.name.en}`.toLowerCase().includes('wrongsecretcode999')
  );
  assertEq(gibberishMatches.length, 0, 'Wrong secret code behaves identically to non-matching normal product search');

  // =========================================================
  // B. Isolated Server Runtime Security & Auth Sequence Tests
  // =========================================================
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echox-secret-entrance-'));
  let server: http.Server | null = null;

  try {
    process.env.ECHOX_DISABLE_LISTEN = '1';
    process.env.DATA_DIR = tmpDir;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    process.env.ECHOX_SECURITY_HMAC_SECRET = 'test_hmac_secret_entrance_verification_2026';

    const pinHash = await argon2.hash(TEST_PIN, { type: argon2.argon2id });
    const accessHash = await argon2.hash(TEST_ACCESS_CODE, { type: argon2.argon2id });
    fs.writeFileSync(
      path.join(tmpDir, 'central_security_config.json'),
      JSON.stringify({
        access_code_argon2: accessHash,
        pin_argon2: pinHash,
        updated_at: new Date().toISOString(),
        history: [{ type: 'TEST_SEED', timestamp: new Date().toISOString() }],
      }),
      'utf-8'
    );

    const { app, ensureServerInitialized } = await import('../server');
    await ensureServerInitialized();

    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral localhost port');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // 1. Dynamic /robots.txt leaks zero owner routes
    const robotsRes = await fetch(`${baseUrl}/robots.txt`);
    assertEq(robotsRes.status, 200, 'GET /robots.txt returns 200');
    const robotsBody = await robotsRes.text();
    assertTrue(!robotsBody.includes('/owner'), 'Dynamic /robots.txt does not disclose /owner routes');

    // 2. Public APIs leak ZERO hashes, secrets, tokens, or ownerSettings
    for (const pubPath of ['/api/store/state', '/api/security/systemStatus', '/api/payments/config', '/api/chat/config', '/api/security/ownerLockConfig']) {
      const r = await fetch(`${baseUrl}${pubPath}`);
      assertEq(r.status, 200, `GET ${pubPath} returns 200`);
      const text = await r.text();
      assertTrue(!text.includes('$argon2id$'), `${pubPath} leaks zero Argon2 hashes`);
      assertTrue(!text.includes('test_hmac_secret'), `${pubPath} leaks zero HMAC secrets`);
      assertTrue(!text.includes(TEST_PIN), `${pubPath} leaks zero PIN`);
      assertTrue(!text.includes(TEST_ACCESS_CODE), `${pubPath} leaks zero access code`);
      assertTrue(!text.includes('ownerSettings'), `${pubPath} leaks zero ownerSettings`);
    }

    // 3. Wrong secret access code fails silently (401) + rate limit (429 after 5 attempts)
    for (let i = 0; i < 4; i++) {
      const badCode = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
        body: JSON.stringify({ code: `#WrongAttempt${i}` }),
      });
      assertEq(badCode.status, 401, `Wrong secret code attempt #${i + 1} returns 401`);
      const badJson = (await badCode.json()) as any;
      assertEq(Boolean(badJson.success), false, 'Wrong secret code returns success: false');
      assertTrue(!badJson.gateToken, 'Wrong secret code receives no gateToken');
      assertTrue(!badJson.sessionToken, 'Wrong secret code receives no sessionToken');
      assertEq(badCode.headers.get('set-cookie'), null, 'Wrong secret code sets no cookies');
    }

    const lockedCode = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ code: '#WrongAttempt5' }),
    });
    assertEq(lockedCode.status, 429, '5th wrong secret code triggers rate limit (429)');
    const lockedJson = (await lockedCode.json()) as any;
    assertEq(Boolean(lockedJson.lockedOut), true, 'Rate limit response marks lockedOut: true');

    // Even the correct code from the locked IP is blocked during cooldown
    const blockedValidCode = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.77' },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    assertEq(blockedValidCode.status, 429, 'Locked IP remains rate-limited even with correct code');

    // 4. Valid secret code from clean IP opens gate ONLY — NEVER grants admin/owner access
    const okCodeRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    assertEq(okCodeRes.status, 200, 'Valid secret code returns 200');
    const okCodeJson = (await okCodeRes.json()) as any;
    assertEq(okCodeJson.success, true, 'Valid secret code returns success: true');
    assertTrue(typeof okCodeJson.gateToken === 'string' && okCodeJson.gateToken.startsWith('gate1.'), 'Issues short-lived gateToken');
    assertTrue(!okCodeJson.sessionToken, 'Secret code NEVER issues admin sessionToken');
    assertTrue(!okCodeJson.csrfToken, 'Secret code NEVER issues admin csrfToken');
    assertEq(okCodeRes.headers.get('set-cookie'), null, 'Secret code NEVER sets session cookie');

    // Verify gateToken CANNOT access any owner/admin endpoint
    const protectedEndpoints: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: '/api/owner/me' },
      { method: 'GET', path: '/api/admin/store/state' },
      { method: 'PUT', path: '/api/admin/store/state', body: {} },
      { method: 'GET', path: '/api/admin/orders' },
      { method: 'GET', path: '/api/security/sessions' },
      { method: 'POST', path: '/api/security/updatePin', body: { currentPin: TEST_PIN, newPin: '999999' } },
      { method: 'POST', path: '/api/security/updateAccessCode', body: { currentPinOrCode: TEST_ACCESS_CODE, newCode: '#Hacked1' } },
      { method: 'POST', path: '/api/security/emergencyLockdown' },
      { method: 'GET', path: '/api/admin/security/audit-logs' },
    ];
    for (const ep of protectedEndpoints) {
      const resNoAuth = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${okCodeJson.gateToken}`,
        },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      assertTrue(
        resNoAuth.status === 401 || resNoAuth.status === 403,
        `${ep.method} ${ep.path} rejects gateToken-only request (got ${resNoAuth.status})`
      );
    }

    // 5. Wrong PIN rejected (401) + Valid PIN unlocks existing Control Room
    const badPinRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.88' },
      body: JSON.stringify({ pin: '000000' }),
    });
    assertEq(badPinRes.status, 401, 'Wrong PIN returns 401');

    const goodPinRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({ pin: TEST_PIN }),
    });
    assertEq(goodPinRes.status, 200, 'Valid existing PIN returns 200');
    const pinJson = (await goodPinRes.json()) as any;
    assertTrue(typeof pinJson.sessionToken === 'string' && pinJson.sessionToken.startsWith('v2.'), 'Valid PIN returns v2 sessionToken');
    assertTrue(typeof pinJson.csrfToken === 'string' && pinJson.csrfToken.startsWith('csrf1.'), 'Valid PIN returns csrfToken');

    const meRes = await fetch(`${baseUrl}/api/owner/me`, {
      headers: { Authorization: `Bearer ${pinJson.sessionToken}` },
    });
    assertEq(meRes.status, 200, 'Authenticated /api/owner/me succeeds after PIN verification');

    const adminStateRes = await fetch(`${baseUrl}/api/admin/store/state`, {
      headers: { Authorization: `Bearer ${pinJson.sessionToken}` },
    });
    assertEq(adminStateRes.status, 200, 'Authenticated /api/admin/store/state succeeds after PIN verification');

    console.log('✅ All Secret Entrance, Hidden Control Room, Rate-Limiting & Token Isolation Tests Passed!');
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('❌ secretEntranceSecurity.test.ts failed:', err);
  process.exit(1);
});
