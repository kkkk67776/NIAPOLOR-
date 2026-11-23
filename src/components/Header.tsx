import React, { useEffect, useState } from 'react';
import {
  Menu,
  X,
  Search,
  ShoppingBag,
  Bell,
  BellRing,
  BellOff,
  CheckCircle2,
  Sparkles,
  Sun,
  Moon,
  Heart,
  HeartHandshake,
  Download,
  Smartphone,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Product } from '../types';
import {
  fetchPublicNotifications,
  getDeferredInstallPrompt,
  getExistingPushSubscription,
  getSavedPublicEndpoint,
  isIosDevice,
  isStandalonePWA,
  PublicStoreAnnouncement,
  subscribePublicPushClient,
  triggerPwaInstallPrompt,
  unsubscribePublicPushClient,
} from '../lib/notifications';

interface HeaderProps {
  onOpenVault?: () => void;
  productsList?: Product[];
  onSelectProduct?: (product: Product) => void;
}

export default function Header(_props: HeaderProps) {
  const {
    language,
    setLanguage,
    t,
    currentView,
    setCurrentView,
    setSelectedProductId,
    cart,
    setIsCartOpen,
    wishlist,
    setSelectedCategory,
    isDarkMode,
    toggleDarkMode,
    setIsSupportModalOpen,
    isOnline,
  } = useStore();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<PublicStoreAnnouncement[]>([]);
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);
  const [canInstallPwa, setCanInstallPwa] = useState(false);
  const [showIosInstallTip, setShowIosInstallTip] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchPublicNotifications().then((res) => {
      if (active) setAnnouncements(res.announcements || []);
    });
    void getExistingPushSubscription().then((sub) => {
      if (active && sub && getSavedPublicEndpoint() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        setIsPushEnabled(true);
      }
    });

    const refreshInstallState = () => {
      if (!active) return;
      setCanInstallPwa(!isStandalonePWA() && (Boolean(getDeferredInstallPrompt()) || isIosDevice()));
    };
    refreshInstallState();
    window.addEventListener('echox_pwa_install_ready', refreshInstallState);
    window.addEventListener('echox_pwa_installed', refreshInstallState);
    return () => {
      active = false;
      window.removeEventListener('echox_pwa_install_ready', refreshInstallState);
      window.removeEventListener('echox_pwa_installed', refreshInstallState);
    };
  }, []);

  useEffect(() => {
    if (!isNotificationsOpen) return;
    let active = true;
    void fetchPublicNotifications().then((res) => {
      if (active) setAnnouncements(res.announcements || []);
    });
    return () => {
      active = false;
    };
  }, [isNotificationsOpen]);

  const handleToggleStorePush = async () => {
    if (!isOnline) {
      setPushFeedback(t.offline.serverActionDisabled);
      return;
    }
    setPushBusy(true);
    setPushFeedback(null);
    if (isPushEnabled) {
      await unsubscribePublicPushClient();
      setIsPushEnabled(false);
      setPushFeedback('تم إيقاف إشعارات المتجر على هذا الجهاز.');
    } else {
      const res = await subscribePublicPushClient();
      if (res.ok) {
        setIsPushEnabled(true);
        setPushFeedback('تم تفعيل إشعارات المتجر على هاتفك بنجاح ✓');
      } else {
        setPushFeedback(res.error || 'تعذر تفعيل الإشعارات.');
      }
    }
    setPushBusy(false);
  };

  const handleInstallPwa = async () => {
    if (getDeferredInstallPrompt()) {
      const outcome = await triggerPwaInstallPrompt();
      if (outcome === 'accepted') {
        setCanInstallPwa(false);
        setIsMenuOpen(false);
      }
    } else if (isIosDevice()) {
      setShowIosInstallTip((prev) => !prev);
    }
  };

  const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const wishlistCount = wishlist ? wishlist.length : 0;

  const handleNavClick = (view: string) => {
    if (view === 'store') {
      setSelectedCategory('all');
    }
    setCurrentView(view);
    setIsMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openUnifiedSearch = () => {
    setIsNotificationsOpen(false);
    setIsMenuOpen(false);
    window.dispatchEvent(new CustomEvent('open_echox_search'));
  };

  const cycleLanguage = () => {
    if (language === 'ar') setLanguage('en');
    else if (language === 'en') setLanguage('fr');
    else setLanguage('ar');
  };

  const desktopNavItems = [
    { id: 'store', label: t.nav.store },
    { id: 'companies', label: t.nav.companies },
    { id: 'my_orders', label: t.nav.myOrders },
    { id: 'promise', label: t.nav.promise },
    { id: 'contact', label: language === 'ar' ? 'اتصل بنا' : language === 'fr' ? 'Contact' : 'Contact' },
  ];

  return (
    <>
    <header className="w-full bg-white/90 dark:bg-[#0B0B0D]/90 backdrop-blur-xl border-b border-[#E6E2D8] dark:border-[#1E1E26] text-[#111113] dark:text-[#F7F6F3] sticky top-0 z-40 transition-colors select-none">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
        {/* Start: Drawer trigger + Official NIAPOLOR Emblem & Lockup */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            className="p-2 rounded-xl hover:bg-[#F3F1EC] dark:hover:bg-[#18181E] text-[#111113] dark:text-[#F7F6F3] transition-colors cursor-pointer shrink-0"
            title={language === 'ar' ? 'القائمة' : 'Menu'}
            aria-label={language === 'ar' ? 'القائمة' : 'Menu'}
          >
            <Menu className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => handleNavClick('store')}
            className="flex items-center gap-2.5 cursor-pointer group shrink-0 text-start"
            aria-label="NIAPOLOR Home"
          >
            <img
              src="/assets/images/niapolor-emblem.webp"
              alt="NIAPOLOR"
              width={36}
              height={36}
              data-echox-logo="header"
              className="w-8 h-8 sm:w-9 sm:h-9 object-contain group-hover:scale-105 transition-transform shrink-0"
            />
            <div className="flex flex-col leading-none" dir="ltr">
              <span className="font-black tracking-[0.14em] text-sm sm:text-base text-[#111113] dark:text-[#F7F6F3] whitespace-nowrap">
                NIAPOL<span className="text-[#FF6B00]">O</span>R
              </span>
              <span className="text-[7px] font-bold tracking-[0.16em] text-[#7A756D] dark:text-[#8E8980] uppercase mt-0.5 hidden sm:block whitespace-nowrap">
                YOUR WORLD. ONE STORE.
              </span>
            </div>
          </button>
        </div>

        {/* Center: Clean Editorial Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-6" aria-label="Primary Navigation">
          {desktopNavItems.map((item) => {
            const isActive =
              currentView === item.id || (item.id === 'store' && (currentView === 'store' || currentView === '/'));
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`relative py-2 text-xs font-bold uppercase tracking-[0.08em] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#111113] dark:text-[#F7F6F3]'
                    : 'text-[#6B665F] dark:text-[#9A958E] hover:text-[#FF6B00] dark:hover:text-[#FF6B00]'
                }`}
              >
                {item.label}
                {isActive && (
                  <span className="absolute bottom-0 inset-x-0 h-[2px] bg-[#FF6B00] rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* End: Compact Luxury Utility Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 relative shrink-0">
          {/* Quick Search Trigger (synced with Search Modal + # vault access) */}
          <button
            type="button"
            onClick={openUnifiedSearch}
            className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#E6E2D8] dark:border-[#23232C] bg-[#FAF9F7] dark:bg-[#131317] hover:border-[#FF6B00]/60 text-xs text-[#6B665F] dark:text-[#9A958E] hover:text-[#111113] dark:hover:text-[#F7F6F3] transition-colors cursor-pointer"
            title={t.nav.search}
            aria-label={t.nav.search}
          >
            <Search className="w-3.5 h-3.5 text-[#FF6B00] shrink-0" />
            <span className="hidden xl:inline font-semibold text-[11px]">{t.nav.search}</span>
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleDarkMode}
            className="p-2 rounded-xl hover:bg-[#F3F1EC] dark:hover:bg-[#18181E] text-[#111113] dark:text-[#C8A25A] transition-colors cursor-pointer"
            title={isDarkMode ? t.header.lightMode : t.header.darkMode}
            aria-label="Toggle Theme"
          >
            {isDarkMode ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
          </button>

          {/* Language Switcher */}
          <button
            type="button"
            onClick={cycleLanguage}
            className="px-2.5 py-1 rounded-xl border border-[#E6E2D8] dark:border-[#23232C] bg-[#FAF9F7] dark:bg-[#131317] text-[11px] font-extrabold text-[#111113] dark:text-[#F7F6F3] hover:border-[#FF6B00] transition-colors cursor-pointer uppercase"
            title={t.header.language}
          >
            {language}
          </button>

          {/* Notifications Bell */}
          <button
            type="button"
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className="relative p-2 rounded-xl hover:bg-[#F3F1EC] dark:hover:bg-[#18181E] text-[#111113] dark:text-[#F7F6F3] transition-colors cursor-pointer"
            title={t.header.notifications}
            aria-label={t.header.notifications}
          >
            <Bell className="w-[18px] h-[18px]" />
            <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[#FF6B00]" />
          </button>

          {/* Wishlist Heart with fiery-orange badge */}
          <button
            type="button"
            onClick={() => handleNavClick('wishlist')}
            className="relative p-2 rounded-xl hover:bg-[#F3F1EC] dark:hover:bg-[#18181E] text-[#111113] dark:text-[#F7F6F3] transition-colors cursor-pointer hidden xs:inline-flex"
            title={t.nav.wishlist}
            aria-label={t.nav.wishlist}
          >
            <Heart className={`w-[18px] h-[18px] ${wishlistCount > 0 ? 'text-[#FF6B00]' : ''}`} />
            {wishlistCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-[#FF6B00] text-white text-[9px] font-black min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center tabular-nums">
                {wishlistCount}
              </span>
            )}
          </button>

          {/* Shopping Bag with fiery-orange badge */}
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="relative p-2 rounded-xl hover:bg-[#F3F1EC] dark:hover:bg-[#18181E] text-[#111113] dark:text-[#F7F6F3] transition-colors cursor-pointer"
            title={t.nav.cart}
            aria-label={t.nav.cart}
          >
            <ShoppingBag className="w-[18px] h-[18px]" />
            {totalCartItems > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-[#FF6B00] text-white text-[9px] font-black min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center tabular-nums">
                {totalCartItems}
              </span>
            )}
          </button>

          {/* Notifications Dropdown */}
          {isNotificationsOpen && (
            <div className="absolute top-full left-0 mt-2 w-80 max-w-[90vw] bg-white dark:bg-[#131317] rounded-2xl border border-[#E6E2D8] dark:border-[#23232C] shadow-2xl p-3.5 z-50 animate-scaleUp">
              <div className="flex items-center justify-between pb-2.5 border-b border-[#E6E2D8] dark:border-[#23232C] mb-2.5">
                <span className="text-xs font-black text-[#111113] dark:text-[#F7F6F3] flex items-center gap-1.5">
                  <BellRing className="w-3.5 h-3.5 text-[#FF6B00]" />
                  <span>{t.header?.notifications || 'إشعارات NIAPOLOR'}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsNotificationsOpen(false)}
                  className="text-[#7A756D] hover:text-[#111113] dark:hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="mb-2.5 p-2.5 rounded-xl bg-[#FF6B00]/10 border border-[#FF6B00]/25 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#111113] dark:text-[#F7F6F3]">
                  <Smartphone className="w-3.5 h-3.5 text-[#FF6B00] shrink-0" />
                  <span>{language === 'ar' ? 'تنبيهات العروض والمنتجات الجديدة' : language === 'fr' ? 'Alertes offres & nouveautés' : 'Deals & New Arrivals Alerts'}</span>
                </div>
                <button
                  type="button"
                  disabled={pushBusy}
                  onClick={handleToggleStorePush}
                  className={`w-full py-1.5 px-3 rounded-lg text-[11px] font-black flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 ${
                    isPushEnabled
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-[#FF6B00] hover:bg-[#E05E00] text-white'
                  }`}
                >
                  {isPushEnabled ? (
                    <>
                      <BellOff className="w-3.5 h-3.5" />
                      <span>إشعارات المتجر مفعّلة ✓ (إيقاف)</span>
                    </>
                  ) : (
                    <>
                      <BellRing className="w-3.5 h-3.5" />
                      <span>{pushBusy ? 'جاري التفعيل...' : 'تفعيل إشعارات الموقع على الهاتف'}</span>
                    </>
                  )}
                </button>
                {pushFeedback && (
                  <p className="text-[10px] font-bold text-[#5A5854] dark:text-[#A9A49B] leading-relaxed">
                    {pushFeedback}
                  </p>
                )}
              </div>

              <div className="space-y-2 text-xs max-h-60 overflow-y-auto">
                {announcements.length > 0 &&
                  announcements.map((ann) => (
                    <button
                      key={ann.id}
                      type="button"
                      onClick={() => {
                        if (ann.url && ann.url.includes('product=')) {
                          try {
                            const u = new URL(ann.url, window.location.origin);
                            const pid = u.searchParams.get('product');
                            if (pid) setSelectedProductId(pid);
                          } catch {}
                        }
                        setIsNotificationsOpen(false);
                      }}
                      className="w-full text-start p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C] hover:border-[#FF6B00]/50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-1 text-[#FF6B00] font-bold text-[11px] mb-0.5">
                        <span className="flex items-center gap-1">
                          <Sparkles className="w-3 h-3 shrink-0" />
                          <span>{ann.tag || 'تحديث المتجر'}</span>
                        </span>
                        <span className="text-[9px] text-[#7A756D] font-mono">
                          {new Date(ann.createdAt).toLocaleDateString('ar-TN')}
                        </span>
                      </div>
                      <p className="text-[11px] font-bold text-[#111113] dark:text-[#F7F6F3] leading-snug">{ann.title}</p>
                      <p className="text-[10px] text-[#5A5854] dark:text-[#A9A49B] mt-0.5 leading-snug">{ann.body}</p>
                    </button>
                  ))}

                <div className="p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C]">
                  <div className="flex items-center gap-1.5 text-[#FF6B00] font-bold text-[11px] mb-0.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{t.storefront?.defaultBannerTag || 'عروض حصرية'}</span>
                  </div>
                  <p className="text-[11px] text-[#5A5854] dark:text-[#A9A49B]">
                    {t.header?.notificationPromo}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C]">
                  <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold text-[11px] mb-0.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{t.storefront?.trustGenuine}</span>
                  </div>
                  <p className="text-[11px] text-[#5A5854] dark:text-[#A9A49B]">
                    {t.header?.notificationCod}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>

    {/* Solid Opaque Side Drawer rendered outside sticky backdrop-blur header so fixed inset-0 covers full viewport */}
    {isMenuOpen && (
      <div
        className="fixed inset-0 z-50 flex justify-start bg-[rgba(0,0,0,0.55)] animate-fadeIn select-none"
        role="dialog"
        aria-modal="true"
        aria-label={language === 'ar' ? 'القائمة الجانبية' : 'Navigation Menu'}
      >
        <div
          className="relative z-10 w-4/5 max-w-xs h-full overflow-y-auto bg-[#FFFFFF] dark:bg-[#121212] border-e border-[#E5E0D5] dark:border-[#2A2A32] p-5 flex flex-col justify-between text-[#111113] dark:text-[#F7F6F3] shadow-[0_20px_50px_rgba(0,0,0,0.28)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.75)] animate-slideIn"
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <div className="flex items-center justify-between mb-5 pb-4 border-b border-[#E5E0D5] dark:border-[#2A2A32]">
              <div className="flex items-center gap-2.5">
                <img
                  src="/assets/images/niapolor-emblem.webp"
                  alt="NIAPOLOR"
                  width={30}
                  height={30}
                  data-echox-logo="drawer"
                  className="w-7.5 h-7.5 object-contain shrink-0"
                />
                <div className="flex flex-col leading-none" dir="ltr">
                  <span className="font-black text-sm tracking-[0.14em] text-[#111113] dark:text-[#F7F6F3]">
                    NIAPOL<span className="text-[#FF6B00]">O</span>R
                  </span>
                  <span className="text-[6.5px] font-bold tracking-[0.14em] text-[#7A756D] dark:text-[#9A958E] uppercase mt-0.5 whitespace-nowrap">
                    YOUR WORLD. ONE STORE.
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                aria-label={language === 'ar' ? 'إغلاق القائمة' : 'Close menu'}
                className="text-[#4B4741] hover:text-[#111113] dark:text-[#B5B0A8] dark:hover:text-white p-2 rounded-lg bg-[#F5F3EE] dark:bg-[#1E1E22] border border-[#E5E0D5] dark:border-[#2E2E36] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="space-y-1.5 text-xs font-bold text-[#272521] dark:text-[#E5E2DC]">
              <button
                type="button"
                onClick={() => handleNavClick('store')}
                className="w-full text-start block px-3 py-2.5 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
              >
                {t.nav.store}
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('companies')}
                className="w-full text-start block px-3 py-2.5 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
              >
                {t.nav.companies}
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('promise')}
                className="w-full text-start block px-3 py-2.5 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
              >
                {t.nav.promise}
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('my_orders')}
                className="w-full text-start block px-3 py-2.5 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
              >
                {t.nav.myOrders}
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('wishlist')}
                className="w-full text-start block px-3 py-2.5 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
              >
                {t.nav.wishlist} ({wishlistCount})
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('contact')}
                className="w-full text-start block px-3 py-2.5 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
              >
                {language === 'ar' ? 'اتصل بنا' : language === 'fr' ? 'Contactez-nous' : 'Contact Us'}
              </button>

              <div className="pt-2 mt-2 border-t border-[#E5E0D5] dark:border-[#2A2A32] space-y-1">
                <button
                  type="button"
                  onClick={() => handleNavClick('about')}
                  className="w-full text-start block px-3 py-2 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
                >
                  {t.nav.about}
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('shipping')}
                  className="w-full text-start block px-3 py-2 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
                >
                  {t.nav.shipping}
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('returns')}
                  className="w-full text-start block px-3 py-2 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
                >
                  {t.nav.returns}
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('faq')}
                  className="w-full text-start block px-3 py-2 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
                >
                  {t.nav.faq}
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('privacy')}
                  className="w-full text-start block px-3 py-2 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
                >
                  {t.footer.privacyPolicy}
                </button>
                <button
                  type="button"
                  onClick={() => handleNavClick('terms')}
                  className="w-full text-start block px-3 py-2 rounded-xl bg-transparent hover:bg-[#F5F3EE] dark:hover:bg-[#1E1E22] hover:text-[#FF6B00] transition-colors cursor-pointer"
                >
                  {t.footer.termsOfService}
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  setIsSupportModalOpen(true);
                }}
                className="w-full text-start flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#FFF3EA] dark:bg-[#241912] border border-[#FF6B00]/25 text-[#FF6B00] hover:bg-[#FFE6D3] dark:hover:bg-[#2F1F15] transition-colors cursor-pointer mt-3"
              >
                <HeartHandshake className="w-4 h-4 shrink-0" />
                <span>{t.supportEchox.navLabel}</span>
              </button>

              {canInstallPwa && (
                <div className="pt-2 space-y-2">
                  <button
                    type="button"
                    onClick={handleInstallPwa}
                    className="w-full text-start flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#111113] dark:bg-[#1E1E22] text-white border border-[#27272E] hover:border-[#FF6B00] transition-colors cursor-pointer"
                  >
                    <img
                      src="/pwa-any-192-v3.png"
                      alt=""
                      width={24}
                      height={24}
                      className="w-6 h-6 rounded-lg object-cover shrink-0 border border-[#FF6B00]/30"
                    />
                    <span className="flex-1">تثبيت تطبيق NIAPOLOR</span>
                    <Download className="w-4 h-4 text-[#FF6B00] shrink-0" />
                  </button>
                  {showIosInstallTip && (
                    <div className="p-2.5 rounded-xl bg-[#FFFBEB] dark:bg-[#261D0B] border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                      على متصفح Safari: اضغط على أيقونة <strong>المشاركة (Share)</strong> بالأسفل ثم اختر{' '}
                      <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong> لتثبيت التطبيق وتفعيل إشعارات الهاتف.
                    </div>
                  )}
                </div>
              )}
            </nav>
          </div>

          <div className="pt-4 mt-6 border-t border-[#E5E0D5] dark:border-[#2A2A32] text-[11px] text-[#7A756D] dark:text-[#9A958E] text-center font-medium">
            NIAPOLOR © 2026 — {language === 'ar' ? 'تونس' : language === 'fr' ? 'Tunisie' : 'Tunisia'}
          </div>
        </div>
        <div
          className="flex-1 h-full cursor-pointer"
          onClick={() => setIsMenuOpen(false)}
          aria-hidden="true"
        />
      </div>
    )}
    </>
  );
}

export { Header };
