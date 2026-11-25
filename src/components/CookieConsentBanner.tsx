import React, { useEffect, useState } from 'react';
import { Cookie, ShieldCheck, X } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { LEGAL_TRANSLATIONS } from '../data/legalTranslations';
import {
  CookieConsentChoice,
  CURRENT_LEGAL_POLICY_VERSION,
  readStoredCookieConsent,
  writeStoredCookieConsent,
} from '../lib/legal';

export const CookieConsentBanner: React.FC = () => {
  const { language, siteSettings, setCurrentView, setIsCookieBannerVisible } = useStore();
  const [isVisible, setIsVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const policyVersion =
    siteSettings.legalProfile?.policyVersion?.trim() || CURRENT_LEGAL_POLICY_VERSION;
  const lt = LEGAL_TRANSLATIONS[language] || LEGAL_TRANSLATIONS.ar;
  const banner = lt.cookieBanner;
  const isRtl = language === 'ar';

  useEffect(() => {
    const existing = readStoredCookieConsent();
    if (!existing) {
      setIsVisible(true);
    }

    const handleOpenPrefs = () => {
      setIsVisible(true);
    };
    window.addEventListener('niapolor_open_cookie_prefs', handleOpenPrefs);
    return () => window.removeEventListener('niapolor_open_cookie_prefs', handleOpenPrefs);
  }, []);

  useEffect(() => {
    setIsCookieBannerVisible(isVisible);
    return () => setIsCookieBannerVisible(false);
  }, [isVisible, setIsCookieBannerVisible]);

  if (!isVisible) return null;

  const handleChoice = async (choice: CookieConsentChoice) => {
    setSaving(true);
    writeStoredCookieConsent(choice, policyVersion);
    setIsVisible(false);
    try {
      await fetch('/api/legal/cookie-consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NIAPOLOR-Lang': language,
        },
        credentials: 'include',
        body: JSON.stringify({ choice }),
      });
    } catch {
      // Offline / transient network errors still preserve local browser choice safely
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      role="region"
      aria-label={banner.title}
      className="fixed bottom-[calc(4.35rem+env(safe-area-inset-bottom,0px))] lg:bottom-4 inset-x-3 sm:inset-x-auto sm:start-4 z-40 sm:max-w-md bg-white/95 dark:bg-[#131317]/95 backdrop-blur-xl border border-[#E6E2D8] dark:border-[#2A2A34] rounded-2xl shadow-2xl p-4 text-[#111113] dark:text-[#F7F6F3] animate-fadeIn"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#FF6B00]/10 text-[#FF6B00] flex items-center justify-center shrink-0">
            <Cookie className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-black leading-snug">{banner.title}</h3>
        </div>
        <button
          type="button"
          onClick={() => handleChoice('essential_only')}
          className="min-w-[44px] min-h-[44px] -m-1.5 flex items-center justify-center rounded-xl text-[#7A756D] hover:text-[#111113] dark:hover:text-white cursor-pointer"
          aria-label={banner.essentialOnlyBtn}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-[11px] text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed mt-2">
        {banner.description}
      </p>

      <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px] font-bold">
        <button
          type="button"
          onClick={() => {
            setCurrentView('privacy');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="text-[#FF6B00] hover:underline cursor-pointer"
        >
          {banner.privacyLink}
        </button>
        <span className="text-[#7A756D]">·</span>
        <button
          type="button"
          onClick={() => {
            setCurrentView('legal');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="text-[#5A5854] dark:text-[#B5B0A8] hover:text-[#FF6B00] hover:underline cursor-pointer"
        >
          {banner.legalNoticeLink}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => handleChoice('essential_only')}
          className="min-h-[38px] px-3 py-2 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-[#FAF9F7] dark:bg-[#18181E] hover:border-[#FF6B00] text-[11px] font-bold cursor-pointer transition-colors"
        >
          {banner.essentialOnlyBtn}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => handleChoice('all_preferences')}
          className="min-h-[38px] px-3 py-2 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
        >
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span>{banner.acceptAllBtn}</span>
        </button>
      </div>
    </div>
  );
};
