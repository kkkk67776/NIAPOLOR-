import React, { useEffect, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  Phone, 
  Mail, 
  MapPin, 
  Truck,
  Download
} from 'lucide-react';
import {
  getDeferredInstallPrompt,
  isIosDevice,
  isStandalonePWA,
  triggerPwaInstallPrompt,
} from '../lib/notifications';

export const Footer: React.FC = () => {
  const { siteSettings, language, t, setCurrentView, setIsSupportModalOpen } = useStore();
  const [canInstallPwa, setCanInstallPwa] = useState(false);
  const [showIosTip, setShowIosTip] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setCanInstallPwa(!isStandalonePWA() && (Boolean(getDeferredInstallPrompt()) || isIosDevice()));
    };
    refresh();
    window.addEventListener('echox_pwa_install_ready', refresh);
    window.addEventListener('echox_pwa_installed', refresh);
    return () => {
      window.removeEventListener('echox_pwa_install_ready', refresh);
      window.removeEventListener('echox_pwa_installed', refresh);
    };
  }, []);

  const handleInstallClick = async () => {
    if (getDeferredInstallPrompt()) {
      const outcome = await triggerPwaInstallPrompt();
      if (outcome === 'accepted') setCanInstallPwa(false);
    } else if (isIosDevice()) {
      setShowIosTip((prev) => !prev);
    }
  };

  const handleLinkClick = (view: string) => {
    setCurrentView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-[#F3F1EC] dark:bg-[#0B0B0D] text-[#111113] dark:text-[#F7F6F3] border-t border-[#E6E2D8] dark:border-[#1E1E26] transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-10 sm:py-14">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10">
          
          {/* 1. معلومات المتجر والعلامة */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img 
                src="/assets/images/niapolor-emblem.webp" 
                alt="NIAPOLOR Logo" 
                width={34}
                height={34}
                data-echox-logo="footer"
                className="w-8.5 h-8.5 object-contain shrink-0"
              />
              <div dir="ltr">
                <span className="text-lg font-black tracking-[0.12em] text-[#111113] dark:text-[#F7F6F3] block leading-none">
                  NIAPOL<span className="text-[#FF6B00]">O</span>R
                </span>
                <span className="text-[10px] text-[#C8A25A] font-bold tracking-[0.14em] uppercase mt-1 block">
                  {t.footer.verifiedBadge}
                </span>
              </div>
            </div>

            <p className="text-xs text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
              {(typeof siteSettings.description === 'object' && siteSettings.description
                ? siteSettings.description[language] || siteSettings.description.ar || siteSettings.description.fr || siteSettings.description.en
                : (siteSettings.description as any)) || t.footer.desc}
            </p>

            <div className="p-2.5 bg-white dark:bg-[#131317] rounded-xl border border-[#E6E2D8] dark:border-[#23232C] text-xs flex items-center gap-2 text-[#111113] dark:text-[#F7F6F3]">
              <Truck className="w-4 h-4 text-[#FF6B00] shrink-0" />
              <span className="font-semibold text-[11px]">{t.footer.deliveryAllTunisia}</span>
            </div>

            {canInstallPwa && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="w-full p-2.5 bg-[#0B0B0D] dark:bg-[#131317] hover:border-[#FF6B00] text-white rounded-xl border border-[#23232C] text-xs font-bold flex items-center justify-between gap-2.5 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2.5">
                    <img
                      src="/pwa-any-192-v3.png"
                      alt="NIAPOLOR App"
                      width={24}
                      height={24}
                      className="w-6 h-6 rounded-lg object-cover shrink-0 border border-[#FF6B00]/35"
                    />
                    <span className="text-[11px]">
                      {language === 'ar'
                        ? 'تثبيت تطبيق NIAPOLOR على هاتفك'
                        : language === 'fr'
                        ? 'Installer l’application NIAPOLOR'
                        : 'Install NIAPOLOR App'}
                    </span>
                  </span>
                  <Download className="w-4 h-4 text-[#FF6B00] shrink-0" />
                </button>
                {showIosTip && (
                  <p className="p-2.5 rounded-xl bg-white dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#23232A] text-[10px] text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
                    على Safari: اضغط زر <strong>المشاركة (Share)</strong> ثم اختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 2. روابط التصفح السريعة */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-black text-[#FF6B00] uppercase tracking-wider">
              {t.footer.quickLinks}
            </h4>
            <ul className="space-y-0.5 text-xs text-[#5A5854] dark:text-[#B5B0A8] font-medium">
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('store')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.nav.store}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('about')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.footer.aboutUs}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('companies')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.nav.companies}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('promise')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.nav.promise}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('my_orders')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.nav.myOrders}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('account')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.nav.account}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setIsSupportModalOpen(true)}
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center text-[#FF6B00] hover:underline font-bold transition-colors cursor-pointer text-start"
                >
                  {t.supportEchox.navLabel}
                </button>
              </li>
            </ul>
          </div>

          {/* 3. خدمة العملاء والضمان */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-black text-[#FF6B00] uppercase tracking-wider">
              {t.footer.customerService}
            </h4>
            <ul className="space-y-0.5 text-xs text-[#5A5854] dark:text-[#B5B0A8] font-medium">
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('contact')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.contactModal.title}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('shipping')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.footer.shippingPolicy}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('returns')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.footer.returnPolicy}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('faq')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.footer.faq}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('privacy')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.footer.privacyPolicy}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('terms')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {t.footer.termsOfService}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('legal')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {(t.footer as any).legalInfo}
                </button>
              </li>
              <li>
                <button 
                  type="button"
                  onClick={() => handleLinkClick('seller_terms')} 
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {(t.footer as any).sellerTerms}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('niapolor_open_cookie_prefs'))}
                  className="min-h-[40px] sm:min-h-[32px] py-1.5 sm:py-1 inline-flex items-center hover:text-[#FF6B00] transition-colors cursor-pointer text-start"
                >
                  {(t.footer as any).cookiePrefs}
                </button>
              </li>
            </ul>
          </div>

          {/* 4. معلومات التواصل الرسمية */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-black text-[#FF6B00] uppercase tracking-wider">
              {t.footer.directContact}
            </h4>
            <ul className="space-y-2 text-xs text-[#5A5854] dark:text-[#B5B0A8] font-medium">
              {siteSettings?.supportPhone && (
                <li className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-[#FF6B00]" />
                  <a href={`tel:${siteSettings.supportPhone}`} dir="ltr" className="font-mono font-bold hover:text-[#FF6B00] transition-colors">
                    {siteSettings.supportPhone}
                  </a>
                </li>
              )}
              {siteSettings?.whatsappPhone && (
                <li className="flex items-center gap-2">
                  <a 
                    href={`https://wa.me/${siteSettings.whatsappPhone.replace(/\D/g, '')}?text=مرحباً%20NIAPOLOR%20تونس`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="WhatsApp"
                    title="WhatsApp"
                    className="text-[#25D366] hover:underline flex items-center gap-2 font-mono font-bold transition-opacity hover:opacity-90"
                  >
                    <svg
                      viewBox="0 0 32 32"
                      className="w-4 h-4 shrink-0 fill-[#25D366]"
                      aria-hidden="true"
                    >
                      <path d="M16.004 2.667C8.64 2.667 2.667 8.64 2.667 16c0 2.352.616 4.648 1.787 6.672L2.667 29.333l6.832-1.792A13.28 13.28 0 0 0 16.004 29.333C23.368 29.333 29.333 23.36 29.333 16S23.368 2.667 16.004 2.667zm7.768 18.88c-.325.917-1.912 1.749-2.648 1.856-.672.101-1.525.144-2.464-.155-.568-.181-1.296-.421-2.224-.821-3.912-1.688-6.464-5.637-6.659-5.899-.195-.261-1.589-2.115-1.589-4.035 0-1.92 1.005-2.864 1.363-3.253.357-.389.779-.485 1.037-.485.261 0 .52.003.747.013.24.011.563-.091.88.672.325.784 1.107 2.704 1.203 2.901.096.197.16.427.032.688-.128.261-.192.427-.389.656-.197.229-.413.512-.589.688-.197.197-.403.411-.173.805.229.395 1.021 1.685 2.192 2.731 1.507 1.344 2.779 1.76 3.173 1.957.395.197.624.165.853-.099.229-.261.989-1.155 1.253-1.552.261-.395.523-.328.88-.197.357.131 2.277 1.075 2.667 1.269.389.197.651.293.747.456.096.165.096.949-.229 1.867z" />
                    </svg>
                    <span dir="ltr">+{siteSettings.whatsappPhone.replace(/\D/g, '')}</span>
                  </a>
                </li>
              )}
              {siteSettings?.officialEmail && (
                <li className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-[#FF6B00]" />
                  <a href={`mailto:${siteSettings.officialEmail}`} dir="ltr" className="text-[#5A5854] dark:text-[#B5B0A8] text-[11px] truncate hover:text-[#FF6B00] transition-colors">
                    {siteSettings.officialEmail}
                  </a>
                </li>
              )}
              {(siteSettings?.address || siteSettings?.addressMultilingual) && (
                <li className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-[#FF6B00] shrink-0 mt-0.5" />
                  <span className="text-[#5A5854] dark:text-[#B5B0A8] text-[11px]">
                    {(siteSettings.addressMultilingual && siteSettings.addressMultilingual[language]) || 
                     siteSettings.address || 
                     (siteSettings.addressMultilingual && (siteSettings.addressMultilingual.ar || siteSettings.addressMultilingual.fr || siteSettings.addressMultilingual.en))}
                  </span>
                </li>
              )}
            </ul>
          </div>

        </div>

        {/* حقوق المتجر بدون أي روابط إدارية */}
        <div className="pt-6 mt-6 border-t border-[#E6E2D8] dark:border-[#23232A] text-center text-xs text-[#7A756D] dark:text-[#8E8980] space-y-1.5">
          {(siteSettings?.legalEntityName?.trim() ||
            siteSettings?.commercialRegisterId?.trim() ||
            siteSettings?.legalProfile?.rneNumber?.trim() ||
            siteSettings?.legalProfile?.taxId?.trim()) && (
            <p className="text-[11px] font-medium">
              {t.footer.commercialNotice}{' '}
              {[
                siteSettings.legalEntityName?.trim(),
                siteSettings.legalProfile?.rneNumber?.trim() || siteSettings.commercialRegisterId?.trim(),
                siteSettings.legalProfile?.taxId?.trim(),
              ]
                .filter(Boolean)
                .join(' — ')}
            </p>
          )}
          <p>© 2026 NIAPOLOR — {t.footer.rights || 'كافة الحقوق محفوظة. الجمهورية التونسية.'}</p>
        </div>
      </div>
    </footer>
  );
};
