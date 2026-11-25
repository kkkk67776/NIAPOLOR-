/**
 * NIAPOLOR Floating UI & Overlay Consistency Verification Suite
 *
 * Verifies:
 *  1. Strict mutual exclusion between Store Notifications, Live Support Center, Live Chat, Menu, Categories Sheet, and Search Modal
 *  2. Escape & external modal/drawer dismissal transitions
 *  3. Floating launcher visibility anti-overlap governance (hides during open overlays/modals & mobile cookie banner)
 *  4. Layered z-index hierarchy (launcher < chrome/cookie < backdrop < popover/drawer < detail/support < checkout < legal preview)
 *  5. Complete AR / FR / EN localization parity for Store Notifications & Live Support Center (zero leaked Arabic in EN/FR)
 *  6. Structural invariants in Header.tsx, FloatingActions.tsx, BottomNavigation.tsx, and CookieConsentBanner.tsx
 */

import fs from 'fs';
import path from 'path';
import {
  OVERLAY_Z_INDEX,
  resolveFloatingPanelTransition,
  shouldHideFloatingLauncher,
  type FloatingPanelId,
} from '../src/lib/floatingUiCoordinator';
import { translations } from '../src/data/translations';

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message} (expected=${String(expected)}, actual=${String(actual)})`
    );
  }
}

function run(): void {
  let passed = 0;
  const pass = (label: string) => {
    passed += 1;
    console.log(`  [PASS ${passed}/7] ${label}`);
  };

  // 1. Mutual exclusion between all floating panels
  let state: FloatingPanelId = 'none';
  state = resolveFloatingPanelTransition(state, { type: 'open', panel: 'notifications' });
  assertEq(state, 'notifications', 'Opening notifications activates notifications');

  state = resolveFloatingPanelTransition(state, { type: 'open', panel: 'support_hub' });
  assertEq(state, 'support_hub', 'Opening support_hub closes notifications automatically');

  state = resolveFloatingPanelTransition(state, { type: 'open', panel: 'live_chat' });
  assertEq(state, 'live_chat', 'Opening live_chat closes support_hub automatically');

  state = resolveFloatingPanelTransition(state, { type: 'open', panel: 'categories_sheet' });
  assertEq(state, 'categories_sheet', 'Opening categories_sheet closes live_chat automatically');

  state = resolveFloatingPanelTransition(state, { type: 'open', panel: 'search_modal' });
  assertEq(state, 'search_modal', 'Opening search_modal closes categories_sheet automatically');

  state = resolveFloatingPanelTransition(state, { type: 'toggle', panel: 'search_modal' });
  assertEq(state, 'none', 'Toggling active search_modal closes it cleanly');

  state = resolveFloatingPanelTransition(state, { type: 'toggle', panel: 'notifications' });
  assertEq(state, 'notifications', 'Toggling notifications from none opens notifications');

  state = resolveFloatingPanelTransition(state, { type: 'toggle', panel: 'support_hub' });
  assertEq(state, 'support_hub', 'Toggling support_hub while notifications open switches cleanly');
  pass('Strict mutual exclusion across all floating panels');

  // 2. Escape, scoped close, and external modal transitions
  assertEq(
    resolveFloatingPanelTransition('notifications', { type: 'close', panel: 'support_hub' }),
    'notifications',
    'Scoped close for another panel does not accidentally dismiss active panel'
  );
  assertEq(
    resolveFloatingPanelTransition('notifications', { type: 'close', panel: 'notifications' }),
    'none',
    'Scoped close dismisses matching active panel'
  );
  assertEq(
    resolveFloatingPanelTransition('support_hub', { type: 'escape' }),
    'none',
    'Escape key dismisses open floating panel'
  );
  assertEq(
    resolveFloatingPanelTransition('live_chat', { type: 'external_modal_opened' }),
    'none',
    'Opening Cart/Checkout/Product/Support modal closes floating panel'
  );
  pass('Escape, scoped close, and external modal dismissal');

  // 3. Floating launcher anti-overlap visibility rules
  assertEq(
    shouldHideFloatingLauncher({
      activeFloatingPanel: 'none',
      isCartOpen: false,
      isSupportModalOpen: false,
      hasSelectedProduct: false,
      isCheckoutOpen: false,
      isOwnerRoute: false,
      isCookieBannerVisible: false,
      isMobileViewport: true,
    }),
    false,
    'Launcher stays visible on clean storefront state'
  );
  assertEq(
    shouldHideFloatingLauncher({
      activeFloatingPanel: 'notifications',
      isCartOpen: false,
      isSupportModalOpen: false,
      hasSelectedProduct: false,
      isCheckoutOpen: false,
      isOwnerRoute: false,
      isCookieBannerVisible: false,
      isMobileViewport: true,
    }),
    true,
    'Launcher hides when notifications panel is open'
  );
  assertEq(
    shouldHideFloatingLauncher({
      activeFloatingPanel: 'none',
      isCartOpen: false,
      isSupportModalOpen: false,
      hasSelectedProduct: false,
      isCheckoutOpen: false,
      isOwnerRoute: false,
      isCookieBannerVisible: true,
      isMobileViewport: true,
    }),
    true,
    'Launcher hides on mobile when cookie banner is visible'
  );
  assertEq(
    shouldHideFloatingLauncher({
      activeFloatingPanel: 'none',
      isCartOpen: false,
      isSupportModalOpen: false,
      hasSelectedProduct: false,
      isCheckoutOpen: false,
      isOwnerRoute: false,
      isCookieBannerVisible: true,
      isMobileViewport: false,
    }),
    false,
    'Launcher stays visible on desktop while cookie banner sits at opposite corner'
  );
  assertEq(
    shouldHideFloatingLauncher({
      activeFloatingPanel: 'none',
      isCartOpen: true,
      isSupportModalOpen: false,
      hasSelectedProduct: false,
      isCheckoutOpen: false,
      isOwnerRoute: false,
      isCookieBannerVisible: false,
      isMobileViewport: false,
    }),
    true,
    'Launcher hides while Cart drawer is open'
  );
  pass('Floating launcher visibility anti-overlap governance');

  // 4. Overlay z-index strict ordering
  assertTrue(
    OVERLAY_Z_INDEX.floatingLauncher < OVERLAY_Z_INDEX.chromeAndCookie &&
      OVERLAY_Z_INDEX.chromeAndCookie < OVERLAY_Z_INDEX.popoverBackdrop &&
      OVERLAY_Z_INDEX.popoverBackdrop < OVERLAY_Z_INDEX.floatingPopoverAndDrawer &&
      OVERLAY_Z_INDEX.floatingPopoverAndDrawer < OVERLAY_Z_INDEX.detailAndSupportModal &&
      OVERLAY_Z_INDEX.detailAndSupportModal < OVERLAY_Z_INDEX.checkoutModal &&
      OVERLAY_Z_INDEX.checkoutModal < OVERLAY_Z_INDEX.legalPreviewModal,
    'Overlay z-index constants follow strict non-overlapping hierarchy'
  );
  pass('Overlay z-index hierarchy invariant');

  // 5. Complete AR / FR / EN localization checks
  const requiredHeaderKeys = [
    'notifications',
    'notificationPromo',
    'notificationCod',
    'close',
    'pushAlertsTitle',
    'pushEnableBtn',
    'pushEnablingBtn',
    'pushEnabledBtn',
    'pushEnabledFeedback',
    'pushDisabledFeedback',
    'pushErrorFeedback',
    'storeUpdateTag',
    'menuLabel',
    'closeMenuLabel',
    'backLabel',
    'clearSearchLabel',
    'pwaInstallLabel',
  ] as const;

  const requiredSupportHubKeys = [
    'buttonTitle',
    'helpLabel',
    'closeLabel',
    'title',
    'subtitle',
    'whatsappTitle',
    'whatsappSubtitle',
    'phoneTitle',
    'liveChatTitle',
    'liveChatSubtitle',
    'openBtn',
  ] as const;

  for (const lang of ['ar', 'fr', 'en'] as const) {
    const hdr = translations[lang].header as Record<string, string>;
    const hub = translations[lang].supportHub as Record<string, string>;
    for (const k of requiredHeaderKeys) {
      assertTrue(typeof hdr[k] === 'string' && hdr[k].trim().length > 0, `Missing ${lang}.header.${k}`);
      if (lang !== 'ar') {
        assertTrue(!/[\u0600-\u06FF]/.test(hdr[k]), `Unexpected Arabic char in ${lang}.header.${k}`);
      }
    }
    for (const k of requiredSupportHubKeys) {
      assertTrue(typeof hub[k] === 'string' && hub[k].trim().length > 0, `Missing ${lang}.supportHub.${k}`);
      if (lang !== 'ar') {
        assertTrue(!/[\u0600-\u06FF]/.test(hub[k]), `Unexpected Arabic char in ${lang}.supportHub.${k}`);
      }
    }
  }
  pass('AR / FR / EN localization parity without leaked Arabic strings');

  // 6. Header.tsx structural invariants
  const headerSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/Header.tsx'), 'utf8');
  assertTrue(!headerSrc.includes('تفعيل إشعارات الموقع على الهاتف'), 'Header.tsx no longer hardcodes Arabic push CTA');
  assertTrue(!headerSrc.includes('إشعارات المتجر مفعّلة'), 'Header.tsx no longer hardcodes Arabic enabled button');
  assertTrue(!headerSrc.includes("toLocaleDateString('ar-TN')"), 'Header.tsx uses locale-aware announcement dates');
  assertTrue(!headerSrc.includes('top-full left-0 mt-2 w-80'), 'Header.tsx removed RTL/LTR-breaking left-0 dropdown');
  assertTrue(headerSrc.includes("toggleFloatingPanel('notifications')"), 'Header bell uses centralized coordinator');
  assertTrue(headerSrc.indexOf('</header>') < headerSrc.indexOf('isNotificationsOpen &&'), 'Notifications popover renders outside backdrop-blur <header>');
  pass('Header.tsx structural, localization, and viewport-safe popover invariants');

  // 7. FloatingActions.tsx & BottomNavigation.tsx invariants
  const floatingSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/FloatingActions.tsx'), 'utf8');
  assertTrue(floatingSrc.includes("activeFloatingPanel === 'support_hub'"), 'Support Center bound to centralized coordinator');
  assertTrue(floatingSrc.includes("activeFloatingPanel === 'live_chat'"), 'Live Chat bound to centralized coordinator');
  assertTrue(floatingSrc.includes('<Phone className="w-[18px] h-[18px]'), 'Floating launcher uses Phone icon per user request');
  assertTrue(floatingSrc.includes('https://wa.me/'), 'WhatsApp support channel preserved');
  assertTrue(floatingSrc.includes('href={`tel:${siteSettings.supportPhone}`}'), 'Direct phone call support channel preserved');
  assertTrue(!floatingSrc.includes('bg-blue-500/10') && !floatingSrc.includes('bg-[#25D366]/10'), 'Support Center removed old garish pastel box styles');

  const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  assertTrue(!appSrc.includes('[setCurrentView, setLanguage, setSelectedCategory'), 'App.tsx route sync does not re-run on context re-renders');

  const storeCtxSrc = fs.readFileSync(path.join(process.cwd(), 'src/context/StoreContext.tsx'), 'utf8');
  assertTrue(storeCtxSrc.includes('const setCurrentView = useCallback('), 'StoreContext memoizes setCurrentView');
  assertTrue(storeCtxSrc.includes('const toggleFloatingPanel = useCallback('), 'StoreContext memoizes toggleFloatingPanel');

  const bottomNavSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/BottomNavigation.tsx'), 'utf8');
  assertTrue(bottomNavSrc.includes("openFloatingPanel('search_modal')"), 'BottomNavigation search uses centralized coordinator');
  assertTrue(bottomNavSrc.includes("openFloatingPanel('categories_sheet')"), 'BottomNavigation categories uses centralized coordinator');
  pass('FloatingActions.tsx, App.tsx, StoreContext.tsx & BottomNavigation.tsx stability invariants');

  console.log(`\nALL ${passed}/7 FLOATING UI & OVERLAY VERIFICATION CHECKS PASSED.`);
}

run();
