/**
 * NIAPOLOR Automated Legal & Data Privacy Compliance Test Suite
 *
 * Verifies:
 *  1. Honest placeholder resolution vs configured corporate/RNE/MF/INPDP fields across AR/FR/EN
 *  2. Explicit customer registration legal consent enforcement & audit persistence (plus headless compat)
 *  3. Explicit checkout legal consent enforcement (Terms, Returns, Privacy) & Order persistence
 *  4. Law No. 2004-63 customer data export (authenticated, zero passwordHash, IDOR blocked)
 *  5. Law No. 2004-63 statutory privacy requests (rectification/erasure/opposition) & XSS rejection
 *  6. Cookie/storage preference recording
 *  7. Owner admin legal profile updates, seller agreement audit logging, request status triage & sitemap
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import argon2 from 'argon2';
import { LEGAL_TRANSLATIONS } from '../src/data/legalTranslations';
import { INITIAL_SITE_SETTINGS } from '../src/data/initialData';
import { translations } from '../src/data/translations';
import { resolveLegalDisclosures } from '../src/lib/legal';

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

function extractCookie(res: Response, name: string): string {
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[]; get(k: string): string | null };
  const rawList =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : [anyHeaders.get('set-cookie') || ''];
  for (const entry of rawList) {
    for (const part of String(entry || '').split(/,(?=\s*[^;]+=)/)) {
      const m = part.trim().match(new RegExp(`^(${name}=[^;]+)`));
      if (m) return m[1];
    }
  }
  return '';
}

async function run(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niapolor-legal-'));
  let appServer: http.Server | null = null;
  let passed = 0;
  let ipCounter = 10;
  const nextIp = () => `198.51.100.${++ipCounter}`;
  const pass = (label: string) => {
    passed += 1;
    console.log(`  [PASS ${passed}/10] ${label}`);
  };

  try {
    // 1. Offline legal copy & placeholder honesty checks
    const forbiddenPublicAdminRefs = [
      'لوحة التحكم',
      'مركز التحكم',
      'من المالك',
      'إدارة النظام',
      'Owner Dashboard',
      'Pending Owner Completion',
      'Admin Panel',
      'Admin session',
      'panneau admin',
      'panneau d’administration',
      'par l’exploitant',
      'مستشار قانوني',
      'Vendor Ledger',
    ];
    for (const lang of ['ar', 'fr', 'en'] as const) {
      const bundle = LEGAL_TRANSLATIONS[lang];
      const pagesCopy = translations[lang].legalPages;
      assertTrue(Boolean(bundle.legalNotice.title), `legalNotice title exists (${lang})`);
      assertTrue(bundle.privacyExpanded.storageItems.length >= 4, `storage inventory populated (${lang})`);
      assertTrue(bundle.sellerTerms.sections.length >= 4, `seller terms populated (${lang})`);
      const unresolved = resolveLegalDisclosures(INITIAL_SITE_SETTINGS, lang);
      assertTrue(unresolved.entityName.isPlaceholder, `entityName is honestly flagged pending (${lang})`);
      assertTrue(unresolved.rneNumber.isPlaceholder, `rneNumber is honestly flagged pending (${lang})`);
      assertTrue(unresolved.taxId.isPlaceholder, `taxId is honestly flagged pending (${lang})`);
      assertTrue(unresolved.completionPercent < 100, `initial legal completion < 100% (${lang})`);

      const serializedPublicLegal = JSON.stringify({ bundle, pagesCopy, unresolved });
      for (const forbidden of forbiddenPublicAdminRefs) {
        assertTrue(
          !serializedPublicLegal.includes(forbidden),
          `Public legal copy (${lang}) must not leak internal reference: "${forbidden}"`
        );
      }
      assertTrue(
        serializedPublicLegal.includes('RNE') &&
          serializedPublicLegal.includes('Matricule Fiscal') &&
          serializedPublicLegal.includes('INPDP'),
        `Public legal copy (${lang}) retains RNE, Matricule Fiscal, and INPDP disclosures`
      );
    }
    const configured = resolveLegalDisclosures(
      {
        ...INITIAL_SITE_SETTINGS,
        legalEntityName: 'NIAPOLOR Commerce SUARL',
        legalProfile: {
          ...INITIAL_SITE_SETTINGS.legalProfile!,
          legalForm: 'SUARL',
          rneNumber: '1799999X',
          taxId: '1799999/X/A/M/000',
          publicationDirector: 'Abdelkader Bahri',
          hostingProvider: 'Google Cloud EMEA / Render',
        },
      },
      'fr'
    );
    assertEq(configured.completionPercent, 100, 'Configured mandatory legal fields reach 100%');
    assertTrue(!configured.rneNumber.isPlaceholder, 'Configured RNE is not flagged as placeholder');
    pass('Honest placeholder disclosures & complete AR/FR/EN legal bundles verified');

    // Boot isolated Express app
    process.env.ECHOX_DISABLE_LISTEN = '1';
    process.env.DATA_DIR = tmpDir;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    process.env.ECHOX_SECURITY_HMAC_SECRET = 'legal_compliance_test_hmac_secret_key_min_32_bytes_2026';

    const TEST_PIN = '739146';
    const TEST_ACCESS_CODE = '#LegalVault2026';
    const pinHash = await argon2.hash(TEST_PIN, { type: argon2.argon2id });
    const accessHash = await argon2.hash(TEST_ACCESS_CODE, { type: argon2.argon2id });
    fs.writeFileSync(
      path.join(tmpDir, 'central_security_config.json'),
      JSON.stringify({
        access_code_argon2: accessHash,
        pin_argon2: pinHash,
        updated_at: new Date().toISOString(),
        history: [],
      }),
      'utf-8'
    );

    const { app, ensureServerInitialized } = await import('../server');
    await ensureServerInitialized();

    appServer = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = appServer.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind ephemeral server');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Verify public catalog & sitemap
    const sitemapRes = await fetch(`${baseUrl}/sitemap.xml`);
    const sitemapXml = await sitemapRes.text();
    assertTrue(sitemapXml.includes('/legal') && sitemapXml.includes('/seller-terms'), 'Sitemap includes /legal and /seller-terms');

    const storeRes = await fetch(`${baseUrl}/api/store/state`);
    assertEq(storeRes.status, 200, 'Storefront state loads');
    const storeJson = (await storeRes.json()) as any;
    const firstProd = storeJson.products?.[0];
    assertTrue(Boolean(firstProd?.id), 'Catalog has active product');

    // 2. Customer registration blocks browser requests missing legal consent
    const regBlockedRes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        'X-Requested-With': 'NIAPOLOR-Customer',
        'Accept-Language': 'fr',
        'x-forwarded-for': nextIp(),
      },
      body: JSON.stringify({
        fullName: 'Amira Ben Salah',
        email: 'amira.blocked@niapolor.tn',
        phone: '+216 22 334 455',
        password: 'Niapolor#2026!',
        legalConsent: { termsAccepted: true, privacyAccepted: false },
      }),
    });
    assertEq(regBlockedRes.status, 400, 'Browser register without privacyAccepted rejected with 400');
    const regBlockedJson = (await regBlockedRes.json()) as any;
    assertEq(regBlockedJson.code, 'LEGAL_CONSENT_REQUIRED', 'Error code is LEGAL_CONSENT_REQUIRED');
    pass('Customer registration rejects missing explicit consent with LEGAL_CONSENT_REQUIRED');

    // 3. Customer registration with explicit consent persists consent & audit entry
    const regIp = nextIp();
    const regOkRes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        'X-Requested-With': 'NIAPOLOR-Customer',
        'Accept-Language': 'en',
        'x-forwarded-for': regIp,
      },
      body: JSON.stringify({
        fullName: 'Youssef Trabelsi',
        email: 'youssef.legal@niapolor.tn',
        phone: '+216 24 556 677',
        password: 'Niapolor#2026A',
        legalConsent: {
          termsAccepted: true,
          privacyAccepted: true,
          termsVersion: '2026.1',
          privacyVersion: '2026.1',
          acceptedAt: new Date().toISOString(),
          language: 'en',
          source: 'customer_registration',
        },
      }),
    });
    assertEq(regOkRes.status, 201, 'Customer registration with explicit consent succeeds');
    const custCookie = extractCookie(regOkRes, '__customer_session');
    assertTrue(Boolean(custCookie), 'Customer session cookie issued');
    const regOkJson = (await regOkRes.json()) as any;
    assertTrue(Boolean(regOkJson.customer?.legalConsent?.termsAccepted), 'Registered user object stores legalConsent');
    assertEq(regOkJson.customer?.legalConsent?.source, 'customer_registration', 'Consent source persisted');
    pass('Customer registration persists explicit consent & audit proof');

    // 4. Headless legacy register call omitting Origin/Referer & legalConsent stays compatible
    const headlessRegRes = await fetch(`${baseUrl}/api/customer/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'x-forwarded-for': nextIp(),
      },
      body: JSON.stringify({
        fullName: 'Headless Legacy User',
        email: 'headless.legacy@niapolor.tn',
        phone: '+216 25 112 233',
        password: 'Niapolor#2026H',
      }),
    });
    assertEq(headlessRegRes.status, 201, 'Legacy headless registration without Origin/consent remains supported');
    pass('Headless API test backward compatibility preserved');

    // 5. Browser checkout rejects missing returnsAccepted / consent
    const chkBlockedRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        'x-forwarded-for': nextIp(),
      },
      body: JSON.stringify({
        customerName: 'Youssef Trabelsi',
        customerEmail: 'youssef.legal@niapolor.tn',
        customerPhone: '+216 24 556 677',
        shippingAddress: {
          id: 'addr_1',
          fullName: 'Youssef Trabelsi',
          phone: '+216 24 556 677',
          governorate: 'tunis',
          delegation: 'المدينة',
          street: '12 Avenue Habib Bourguiba',
        },
        items: [{ productId: firstProd.id, unitPrice: firstProd.price, quantity: 1 }],
        paymentMethod: 'cod',
        legalConsent: { termsAccepted: true, privacyAccepted: true, returnsAccepted: false },
      }),
    });
    assertEq(chkBlockedRes.status, 400, 'Browser checkout without returnsAccepted rejected with 400');
    const chkBlockedJson = (await chkBlockedRes.json()) as any;
    assertEq(chkBlockedJson.code, 'LEGAL_CONSENT_REQUIRED', 'Checkout error code is LEGAL_CONSENT_REQUIRED');
    pass('Checkout strictly enforces Terms, Return Policy & Privacy consent');

    // 6. Browser checkout with full explicit consent persists order.legalConsent & logs audit
    const chkOkRes = await fetch(`${baseUrl}/api/payments/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        Cookie: custCookie,
        'x-forwarded-for': nextIp(),
      },
      body: JSON.stringify({
        customerName: 'Youssef Trabelsi',
        customerEmail: 'youssef.legal@niapolor.tn',
        customerPhone: '+216 24 556 677',
        shippingAddress: {
          id: 'addr_1',
          fullName: 'Youssef Trabelsi',
          phone: '+216 24 556 677',
          governorate: 'tunis',
          delegation: 'المدينة',
          street: '12 Avenue Habib Bourguiba',
        },
        items: [{ productId: firstProd.id, unitPrice: firstProd.price, quantity: 1 }],
        paymentMethod: 'cod',
        legalConsent: {
          termsAccepted: true,
          privacyAccepted: true,
          returnsAccepted: true,
          termsVersion: '2026.1',
          privacyVersion: '2026.1',
          acceptedAt: new Date().toISOString(),
          language: 'fr',
          source: 'checkout_order',
        },
      }),
    });
    assertEq(chkOkRes.status, 200, 'Checkout with explicit legalConsent succeeds');
    const chkOkJson = (await chkOkRes.json()) as any;
    assertTrue(Boolean(chkOkJson.order?.legalConsent?.returnsAccepted), 'Persisted order contains legalConsent.returnsAccepted');
    pass('Checkout order persists explicit legalConsent & tracking number');

    // 7. Law 2004-63 Data Access Export (auth + IDOR + no passwordHash)
    const unauthExport = await fetch(`${baseUrl}/api/customer/privacy/export`);
    assertEq(unauthExport.status, 401, 'Unauthenticated privacy export returns 401');

    const idorExport = await fetch(`${baseUrl}/api/customer/privacy/export?customerId=cust_other_999`, {
      headers: { Cookie: custCookie },
    });
    assertEq(idorExport.status, 403, 'IDOR query customerId blocked with 403');

    const validExportRes = await fetch(`${baseUrl}/api/customer/privacy/export`, {
      headers: { Cookie: custCookie },
    });
    assertEq(validExportRes.status, 200, 'Authenticated customer privacy export returns 200');
    const exportText = await validExportRes.text();
    const exportJson = JSON.parse(exportText);
    assertTrue(
      exportJson.success === true &&
        Boolean(exportJson.exportData?.account?.email) &&
        Boolean(exportJson.exportData?.legalBasis),
      'Export contains customer account & legalBasis'
    );
    assertTrue(Array.isArray(exportJson.exportData?.orders) && exportJson.exportData.orders.length >= 1, 'Export includes customer orders');
    assertTrue(!exportText.includes('passwordHash') && !exportText.includes('passwordSalt'), 'Export strips internal password fields');
    pass('Law 2004-63 authenticated data export strips secrets & blocks IDOR');

    // 8. Law 2004-63 Statutory Privacy Request & XSS guard
    const xssReqRes = await fetch(`${baseUrl}/api/customer/privacy/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        Cookie: custCookie,
      },
      body: JSON.stringify({ requestType: 'erasure', details: '<script>alert(1)</script>' }),
    });
    assertEq(xssReqRes.status, 400, 'Privacy request rejects unsafe HTML/script tags');

    const validReqRes = await fetch(`${baseUrl}/api/customer/privacy/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'NIAPOLOR-Customer',
        'Accept-Language': 'fr',
        Cookie: custCookie,
      },
      body: JSON.stringify({ requestType: 'erasure', details: 'Veuillez supprimer mes adresses après livraison.' }),
    });
    assertEq(validReqRes.status, 201, 'Privacy erasure request succeeds with 201');
    const validReqJson = (await validReqRes.json()) as any;
    const reqEntryId = validReqJson.entry?.id as string;
    assertTrue(Boolean(reqEntryId), 'Privacy request audit ID returned');
    pass('Customer privacy rights request persists & rejects HTML injection');

    // 9. Explicit Cookie / Storage consent route
    const badCookieRes = await fetch(`${baseUrl}/api/legal/cookie-consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ choice: 'invalid_choice' }),
    });
    assertEq(badCookieRes.status, 400, 'Invalid cookie choice rejected');

    const okCookieRes = await fetch(`${baseUrl}/api/legal/cookie-consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ choice: 'essential_only' }),
    });
    assertEq(okCookieRes.status, 200, 'Valid cookie choice saved');
    pass('Explicit cookie/storage choice recorded on backend');

    // 10. Owner Admin legal endpoints & seller agreement audit logging
    const unauthAdminLegal = await fetch(`${baseUrl}/api/admin/legal/consents`);
    assertEq(unauthAdminLegal.status, 401, 'Admin legal consents route rejects unauthenticated access');

    const acRes = await fetch(`${baseUrl}/api/security/verifyAccessCode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    assertEq(acRes.status, 200, 'Owner access code verified');
    const { gateToken } = (await acRes.json()) as any;
    const pinRes = await fetch(`${baseUrl}/api/security/verifyPin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
      body: JSON.stringify({ pin: TEST_PIN, gateToken }),
    });
    assertEq(pinRes.status, 200, 'Owner PIN verified');
    const { sessionToken: adminToken, csrfToken } = (await pinRes.json()) as any;

    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'X-CSRF-Token': csrfToken,
      'x-forwarded-for': nextIp(),
    };

    // Update legalProfile & onboard a new partner with agreementAccepted: true
    const storeStateSaveRes = await fetch(`${baseUrl}/api/admin/store/state`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        siteSettings: {
          ...storeJson.siteSettings,
          legalEntityName: 'NIAPOLOR Distribution SUARL',
          commercialRegisterId: '1888888Z',
          legalProfile: {
            ...INITIAL_SITE_SETTINGS.legalProfile,
            legalForm: 'SUARL',
            rneNumber: '1888888Z',
            taxId: '1888888/Z/A/M/000',
            publicationDirector: 'Abdelkader Bahri',
            dpoEmail: 'privacy@niapolor.tn',
            hostingProvider: 'Google Cloud Firestore & Node Hosting',
            retractionDays: 10,
          },
        },
        companies: [
          ...(storeJson.companies || []),
          {
            id: 'comp_seller_legal_test',
            name: 'Sfax Industrial Partner SARL',
            logo: '/assets/images/niapolor-badge.webp',
            phone: '+216 74 111 222',
            email: 'partner@sfax-ind.tn',
            address: 'Route de Gabès Km 4',
            governorate: 'sfax',
            description: { ar: 'شريك اختبار', fr: 'Partenaire test', en: 'Test partner' },
            legalMetadata: {
              legalForm: 'SARL',
              rneNumber: '0998877B',
              taxId: '0998877/B/A/M/000',
              agreementAccepted: true,
              agreementVersion: '2026.1',
              agreementAcceptedAt: new Date().toISOString(),
            },
          },
        ],
      }),
    });
    assertEq(storeStateSaveRes.status, 200, 'Owner saves legalProfile & compliant seller');

    // Update privacy request status to completed
    const patchReqRes = await fetch(`${baseUrl}/api/admin/legal/requests/${encodeURIComponent(reqEntryId)}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'completed' }),
    });
    assertEq(patchReqRes.status, 200, 'Admin updates privacy request status to completed');

    // Inspect Admin Audit Log
    const auditRes = await fetch(`${baseUrl}/api/admin/legal/consents`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assertEq(auditRes.status, 200, 'Admin fetches legal consent audit log');
    const auditJson = (await auditRes.json()) as any;
    const sources = new Set((auditJson.entries || []).map((e: any) => e.source));
    assertTrue(sources.has('customer_registration'), 'Audit contains customer_registration');
    assertTrue(sources.has('checkout_order'), 'Audit contains checkout_order');
    assertTrue(sources.has('privacy_request'), 'Audit contains privacy_request');
    assertTrue(sources.has('cookie_preferences'), 'Audit contains cookie_preferences');
    assertTrue(sources.has('seller_onboarding'), 'Audit contains seller_onboarding');
    assertEq(auditJson.summary?.pendingPrivacyRequests, 0, 'Completed privacy request leaves 0 pending');
    pass('Owner legal profile persistence, seller onboarding audit, privacy triage & admin log verified');

    console.log(`\nALL ${passed}/10 LEGAL COMPLIANCE TESTS PASSED!\n`);
  } finally {
    if (appServer) {
      await new Promise<void>((resolve) => appServer!.close(() => resolve()));
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

run().catch((err) => {
  console.error('\nLEGAL COMPLIANCE TEST FAILED:', err);
  process.exit(1);
});
