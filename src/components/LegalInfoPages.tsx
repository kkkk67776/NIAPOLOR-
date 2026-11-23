import React, { useState } from 'react';
import {
  Building2,
  Truck,
  RefreshCw,
  ShieldCheck,
  FileText,
  HelpCircle,
  Phone,
  Mail,
  MapPin,
  Clock,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Lock,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';

const PageBackAction: React.FC<{ onBack: () => void; label: string; isRtl: boolean }> = ({
  onBack,
  label,
  isRtl,
}) => (
  <button
    type="button"
    onClick={onBack}
    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#7A756D] dark:text-[#9A958E] hover:text-[#FF6B00] transition-colors cursor-pointer"
  >
    {isRtl ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
    <span>{label}</span>
  </button>
);

export const AboutView: React.FC = () => {
  const { language, t, siteSettings, setCurrentView } = useStore();
  const isRtl = language === 'ar';
  const copy = (t as any).legalPages;
  const about = copy.about;

  const addressText =
    (siteSettings.addressMultilingual && siteSettings.addressMultilingual[language]) ||
    siteSettings.address;
  const hoursText =
    (siteSettings.workingHours && siteSettings.workingHours[language]) ||
    siteSettings.workingHours?.ar ||
    '';

  const hasEntity = Boolean(siteSettings.legalEntityName?.trim());
  const hasRegister = Boolean(siteSettings.commercialRegisterId?.trim());

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      <PageBackAction onBack={() => setCurrentView('store')} label={copy.backToStore} isRtl={isRtl} />

      <div className="text-center space-y-3">
        <span className="inline-block text-xs font-black uppercase tracking-widest text-[#FF6B00] bg-[#FF6B00]/10 px-3 py-1 rounded-md">
          {about.badge}
        </span>
        <h1 className="text-2xl sm:text-4xl font-black">{about.title}</h1>
        <p className="text-sm sm:text-base text-[#5A5854] dark:text-[#B5B0A8] max-w-2xl mx-auto leading-relaxed">
          {about.subtitle}
        </p>
      </div>

      <div className="bg-white dark:bg-[#131317] p-6 sm:p-8 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#FF6B00]/10 text-[#FF6B00] flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <h2 className="text-lg sm:text-xl font-black">{about.storyTitle}</h2>
        </div>
        <p className="text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{about.storyBody}</p>
      </div>

      <div className="bg-white dark:bg-[#131317] p-6 sm:p-8 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] shadow-xs space-y-4">
        <h2 className="text-base sm:text-lg font-black">{about.modelTitle}</h2>
        <ul className="space-y-3">
          {about.modelPoints.map((pt: string, idx: number) => (
            <li key={idx} className="flex items-start gap-2.5 text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
              <CheckCircle2 className="w-4 h-4 text-[#FF6B00] shrink-0 mt-0.5" />
              <span>{pt}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#131317] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-3.5 text-xs">
          <h3 className="text-sm font-black">{about.contactCardTitle}</h3>
          {siteSettings.supportPhone && (
            <a
              href={`tel:${siteSettings.supportPhone}`}
              className="flex items-center gap-2.5 text-[#5A5854] dark:text-[#B5B0A8] hover:text-[#FF6B00]"
            >
              <Phone className="w-4 h-4 text-[#FF6B00] shrink-0" />
              <span dir="ltr" className="font-mono font-bold">
                {siteSettings.supportPhone}
              </span>
            </a>
          )}
          {siteSettings.officialEmail && (
            <a
              href={`mailto:${siteSettings.officialEmail}`}
              className="flex items-center gap-2.5 text-[#5A5854] dark:text-[#B5B0A8] hover:text-[#FF6B00]"
            >
              <Mail className="w-4 h-4 text-[#FF6B00] shrink-0" />
              <span dir="ltr" className="font-mono">
                {siteSettings.officialEmail}
              </span>
            </a>
          )}
          {addressText && (
            <div className="flex items-start gap-2.5 text-[#5A5854] dark:text-[#B5B0A8]">
              <MapPin className="w-4 h-4 text-[#FF6B00] shrink-0 mt-0.5" />
              <span>{addressText}</span>
            </div>
          )}
          {hoursText && (
            <div className="flex items-start gap-2.5 text-[#5A5854] dark:text-[#B5B0A8]">
              <Clock className="w-4 h-4 text-[#FF6B00] shrink-0 mt-0.5" />
              <span>{hoursText}</span>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-[#131317] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-3.5 text-xs">
          <h3 className="text-sm font-black">{about.legalCardTitle}</h3>
          {hasEntity || hasRegister ? (
            <div className="p-3.5 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C] space-y-1.5">
              {hasEntity && (
                <p className="font-bold text-[#111113] dark:text-[#F7F6F3]">
                  {siteSettings.legalEntityName}
                </p>
              )}
              {hasRegister && (
                <p className="font-mono text-[#5A5854] dark:text-[#B5B0A8]" dir="ltr">
                  {siteSettings.commercialRegisterId}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{about.legalPendingNotice}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => setCurrentView('contact')}
              className="px-4 py-2 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white font-bold text-xs cursor-pointer transition-colors"
            >
              {copy.contactSupportBtn}
            </button>
            <button
              type="button"
              onClick={() => setCurrentView('faq')}
              className="px-4 py-2 rounded-xl bg-[#F3F1EC] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C] font-bold text-xs cursor-pointer hover:border-[#FF6B00]"
            >
              {t.nav.faq}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ShippingView: React.FC = () => {
  const { language, t, siteSettings, paymentConfig, setCurrentView } = useStore();
  const isRtl = language === 'ar';
  const copy = (t as any).legalPages;
  const sh = copy.shipping;

  const standardFee = paymentConfig?.standardShippingFee ?? siteSettings.standardShippingFee ?? 7;
  const freeThreshold =
    paymentConfig?.freeShippingThreshold ?? siteSettings.freeShippingThreshold ?? 150;
  const customEstimate =
    (siteSettings.deliveryTimeEstimate && siteSettings.deliveryTimeEstimate[language]) || '';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      <PageBackAction onBack={() => setCurrentView('store')} label={copy.backToStore} isRtl={isRtl} />

      <div className="text-center space-y-3">
        <span className="inline-block text-xs font-black uppercase tracking-widest text-[#FF6B00] bg-[#FF6B00]/10 px-3 py-1 rounded-md">
          {sh.badge}
        </span>
        <h1 className="text-2xl sm:text-4xl font-black">{sh.title}</h1>
        <p className="text-sm sm:text-base text-[#5A5854] dark:text-[#B5B0A8] max-w-2xl mx-auto">
          {sh.subtitle}
        </p>
      </div>

      {/* Live dynamic fee cards */}
      <div className="bg-white dark:bg-[#131317] p-6 sm:p-8 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#FF6B00]/10 text-[#FF6B00] flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-black">{sh.feeTitle}</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C]">
            <span className="text-xs text-[#7A756D] dark:text-[#8E8980] block">{sh.standardFeeLabel}</span>
            <strong className="text-lg font-black text-[#FF6B00] font-mono tabular-nums mt-1 block">
              {standardFee.toFixed(3)} {t.cart.currency}
            </strong>
          </div>
          <div className="p-4 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C]">
            <span className="text-xs text-[#7A756D] dark:text-[#8E8980] block">{sh.freeThresholdLabel}</span>
            <strong className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono tabular-nums mt-1 block">
              {freeThreshold.toFixed(3)} {t.cart.currency}
            </strong>
          </div>
          <div className="p-4 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C]">
            <span className="text-xs text-[#7A756D] dark:text-[#8E8980] block">{sh.carrierLabel}</span>
            <strong className="text-sm font-black mt-1 block">NIAPOLOR Delivery Tunisie</strong>
          </div>
        </div>

        {customEstimate && (
          <p className="text-xs font-bold text-[#FF6B00] bg-[#FF6B00]/10 border border-[#FF6B00]/25 rounded-xl px-4 py-2.5">
            {customEstimate}
          </p>
        )}

        <p className="text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
          {sh.carrierNotice}
        </p>
      </div>

      {/* Zones breakdown */}
      <div className="space-y-4">
        <h2 className="text-lg font-black">{sh.zonesTitle}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-[#131317] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-2">
            <h3 className="text-sm font-black text-[#FF6B00]">{sh.zoneFastTitle}</h3>
            <p className="text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{sh.zoneFastDesc}</p>
          </div>
          <div className="bg-white dark:bg-[#131317] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-2">
            <h3 className="text-sm font-black text-[#FF6B00]">{sh.zoneInteriorTitle}</h3>
            <p className="text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{sh.zoneInteriorDesc}</p>
          </div>
        </div>
      </div>

      {/* Process */}
      <div className="bg-white dark:bg-[#131317] p-6 sm:p-8 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-4">
        <h2 className="text-base sm:text-lg font-black">{sh.processTitle}</h2>
        <ol className="space-y-2.5">
          {sh.processSteps.map((step: string, idx: number) => (
            <li key={idx} className="flex items-start gap-2.5 text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8]">
              <span className="w-5 h-5 rounded-full bg-[#FF6B00] text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                {idx + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="pt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCurrentView('my_orders')}
            className="px-4 py-2 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white font-bold text-xs cursor-pointer"
          >
            {copy.trackOrderBtn}
          </button>
          <button
            type="button"
            onClick={() => setCurrentView('returns')}
            className="px-4 py-2 rounded-xl bg-[#F3F1EC] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C] font-bold text-xs cursor-pointer hover:border-[#FF6B00]"
          >
            {t.nav.returns}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ReturnsView: React.FC = () => {
  const { language, t, siteSettings, setCurrentView } = useStore();
  const isRtl = language === 'ar';
  const copy = (t as any).legalPages;
  const ret = copy.returns;
  const days = siteSettings.returnWindowDays ?? 7;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      <PageBackAction onBack={() => setCurrentView('store')} label={copy.backToStore} isRtl={isRtl} />

      <div className="text-center space-y-3">
        <span className="inline-block text-xs font-black uppercase tracking-widest text-[#FF6B00] bg-[#FF6B00]/10 px-3 py-1 rounded-md">
          {ret.badge}
        </span>
        <h1 className="text-2xl sm:text-4xl font-black">{ret.title}</h1>
        <p className="text-sm sm:text-base text-[#5A5854] dark:text-[#B5B0A8] max-w-2xl mx-auto">
          {ret.subtitle}
        </p>
      </div>

      <div className="bg-white dark:bg-[#131317] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#FF6B00]/10 text-[#FF6B00] flex items-center justify-center shrink-0">
            <RefreshCw className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-[#7A756D] dark:text-[#8E8980]">{ret.windowTitle}</p>
            <p className="text-lg font-black">
              <span className="text-[#FF6B00] font-mono">{days}</span> {ret.windowUnit}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCurrentView('contact')}
          className="px-4 py-2.5 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-bold cursor-pointer"
        >
          {copy.contactSupportBtn}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#131317] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-3">
          <h2 className="text-base font-black text-emerald-700 dark:text-emerald-400">{ret.eligibleTitle}</h2>
          <ul className="space-y-2.5">
            {ret.eligibleList.map((item: string, idx: number) => (
              <li key={idx} className="flex items-start gap-2 text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8]">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white dark:bg-[#131317] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-3">
          <h2 className="text-base font-black text-amber-700 dark:text-amber-400">{ret.nonEligibleTitle}</h2>
          <ul className="space-y-2.5">
            {ret.nonEligibleList.map((item: string, idx: number) => (
              <li key={idx} className="flex items-start gap-2 text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8]">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="bg-white dark:bg-[#131317] p-6 sm:p-8 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-3">
        <h2 className="text-base font-black">{ret.refundTitle}</h2>
        <p className="text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{ret.refundDesc}</p>
        <p className="text-[11px] text-[#7A756D] dark:text-[#8E8980] pt-1">{copy.lastUpdated}</p>
      </div>
    </div>
  );
};

export const PrivacyView: React.FC = () => {
  const { language, t, siteSettings, setCurrentView } = useStore();
  const isRtl = language === 'ar';
  const copy = (t as any).legalPages;
  const priv = copy.privacy;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      <PageBackAction onBack={() => setCurrentView('store')} label={copy.backToStore} isRtl={isRtl} />

      <div className="text-center space-y-3">
        <span className="inline-block text-xs font-black uppercase tracking-widest text-[#FF6B00] bg-[#FF6B00]/10 px-3 py-1 rounded-md">
          {priv.badge}
        </span>
        <h1 className="text-2xl sm:text-4xl font-black">{priv.title}</h1>
        <p className="text-sm sm:text-base text-[#5A5854] dark:text-[#B5B0A8] max-w-2xl mx-auto">
          {priv.subtitle}
        </p>
      </div>

      <div className="bg-white dark:bg-[#131317] p-6 sm:p-8 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#FF6B00]/10 text-[#FF6B00] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h2 className="text-base sm:text-lg font-black">{priv.dataCollectedTitle}</h2>
        </div>
        <ul className="space-y-2.5">
          {priv.dataCollectedList.map((item: string, idx: number) => (
            <li key={idx} className="flex items-start gap-2.5 text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
              <CheckCircle2 className="w-4 h-4 text-[#FF6B00] shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white dark:bg-[#131317] p-6 sm:p-8 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-3">
        <div className="flex items-center gap-2.5">
          <Lock className="w-4 h-4 text-[#FF6B00]" />
          <h2 className="text-base sm:text-lg font-black">{priv.cookiesTitle}</h2>
        </div>
        <p className="text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{priv.cookiesDesc}</p>
      </div>

      <div className="bg-white dark:bg-[#131317] p-6 sm:p-8 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-3">
        <h2 className="text-base sm:text-lg font-black">{priv.sharingTitle}</h2>
        <p className="text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{priv.sharingDesc}</p>
        {(siteSettings.legalEntityName || siteSettings.commercialRegisterId) && (
          <div className="p-3 rounded-xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C] text-xs space-y-1">
            {siteSettings.legalEntityName && <p className="font-bold">{siteSettings.legalEntityName}</p>}
            {siteSettings.commercialRegisterId && <p className="font-mono">{siteSettings.commercialRegisterId}</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#E6E2D8] dark:border-[#23232C]">
          <span className="text-[11px] text-[#7A756D] dark:text-[#8E8980]">{copy.lastUpdated}</span>
          <a
            href={`mailto:${siteSettings.officialEmail}`}
            className="text-xs font-bold text-[#FF6B00] hover:underline"
            dir="ltr"
          >
            {siteSettings.officialEmail}
          </a>
        </div>
      </div>
    </div>
  );
};

export const TermsView: React.FC = () => {
  const { language, t, siteSettings, setCurrentView } = useStore();
  const isRtl = language === 'ar';
  const copy = (t as any).legalPages;
  const terms = copy.terms;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      <PageBackAction onBack={() => setCurrentView('store')} label={copy.backToStore} isRtl={isRtl} />

      <div className="text-center space-y-3">
        <span className="inline-block text-xs font-black uppercase tracking-widest text-[#FF6B00] bg-[#FF6B00]/10 px-3 py-1 rounded-md">
          {terms.badge}
        </span>
        <h1 className="text-2xl sm:text-4xl font-black">{terms.title}</h1>
        <p className="text-sm sm:text-base text-[#5A5854] dark:text-[#B5B0A8] max-w-2xl mx-auto">
          {terms.subtitle}
        </p>
      </div>

      <div className="space-y-4">
        {terms.sections.map((sec: { title: string; body: string }, idx: number) => (
          <div
            key={idx}
            className="bg-white dark:bg-[#131317] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] space-y-2"
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#FF6B00] shrink-0" />
              <h2 className="text-base font-black">{sec.title}</h2>
            </div>
            <p className="text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{sec.body}</p>
          </div>
        ))}
      </div>

      {(siteSettings.legalEntityName || siteSettings.commercialRegisterId) && (
        <div className="bg-white dark:bg-[#131317] p-5 rounded-2xl border border-[#E6E2D8] dark:border-[#23232C] text-xs space-y-1">
          <span className="text-[#7A756D] dark:text-[#8E8980] block">{t.footer.commercialNotice}</span>
          {siteSettings.legalEntityName && <strong className="block">{siteSettings.legalEntityName}</strong>}
          {siteSettings.commercialRegisterId && <span className="font-mono block">{siteSettings.commercialRegisterId}</span>}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 text-xs text-[#7A756D] dark:text-[#8E8980]">
        <span>{copy.lastUpdated}</span>
        <button
          type="button"
          onClick={() => setCurrentView('contact')}
          className="px-4 py-2 rounded-xl bg-[#FF6B00] text-white font-bold cursor-pointer hover:bg-[#e05e00]"
        >
          {copy.contactSupportBtn}
        </button>
      </div>
    </div>
  );
};

export const FaqView: React.FC = () => {
  const { language, t, setCurrentView } = useStore();
  const isRtl = language === 'ar';
  const copy = (t as any).legalPages;
  const faq = copy.faq;
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      <PageBackAction onBack={() => setCurrentView('store')} label={copy.backToStore} isRtl={isRtl} />

      <div className="text-center space-y-3">
        <span className="inline-block text-xs font-black uppercase tracking-widest text-[#FF6B00] bg-[#FF6B00]/10 px-3 py-1 rounded-md">
          {faq.badge}
        </span>
        <h1 className="text-2xl sm:text-4xl font-black">{faq.title}</h1>
        <p className="text-sm sm:text-base text-[#5A5854] dark:text-[#B5B0A8] max-w-2xl mx-auto">
          {faq.subtitle}
        </p>
      </div>

      <div className="space-y-3">
        {faq.items.map((item: { q: string; a: string }, idx: number) => {
          const isOpen = openIdx === idx;
          return (
            <div
              key={idx}
              className="bg-white dark:bg-[#131317] rounded-2xl border border-[#E6E2D8] dark:border-[#23232C] overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenIdx(isOpen ? null : idx)}
                className="w-full p-5 text-start flex items-center justify-between gap-4 cursor-pointer hover:bg-[#FAF9F7] dark:hover:bg-[#18181E] transition-colors"
                aria-expanded={isOpen}
              >
                <span className="flex items-center gap-2.5 text-sm font-black">
                  <HelpCircle className="w-4 h-4 text-[#FF6B00] shrink-0" />
                  <span>{item.q}</span>
                </span>
                {isOpen ? (
                  <ChevronUp className="w-4 h-4 text-[#FF6B00] shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#7A756D] shrink-0" />
                )}
              </button>
              {isOpen && (
                <div className="px-5 pb-5 pt-1 text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed border-t border-[#E6E2D8]/60 dark:border-[#23232C]/60">
                  {item.a}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-[#0B0B0D] dark:bg-[#131317] border border-[#23232C] rounded-3xl p-6 sm:p-8 text-center text-white space-y-3">
        <p className="text-sm font-black">{copy.contactSupportBtn}</p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setCurrentView('contact')}
            className="px-5 py-2.5 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-bold cursor-pointer"
          >
            {copy.contactSupportBtn}
          </button>
          <button
            type="button"
            onClick={() => setCurrentView('shipping')}
            className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer"
          >
            {t.nav.shipping}
          </button>
        </div>
      </div>
    </div>
  );
};
