import React from 'react';
import { X, FileText, ShieldCheck, RefreshCw, Scale, Store } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { LEGAL_TRANSLATIONS } from '../data/legalTranslations';
import { resolveLegalDisclosures } from '../lib/legal';

export type LegalPreviewTopic = 'terms' | 'privacy' | 'returns' | 'legal' | 'seller_terms';

interface LegalPreviewModalProps {
  topic: LegalPreviewTopic | null;
  onClose: () => void;
  onNavigateFullPage?: (view: LegalPreviewTopic) => void;
}

export const LegalPreviewModal: React.FC<LegalPreviewModalProps> = ({
  topic,
  onClose,
  onNavigateFullPage,
}) => {
  const { language, t, siteSettings, paymentConfig } = useStore();
  if (!topic) return null;

  const isRtl = language === 'ar';
  const lt = LEGAL_TRANSLATIONS[language] || LEGAL_TRANSLATIONS.ar;
  const copy = (t as any).legalPages;
  const disclosures = resolveLegalDisclosures(siteSettings, language);
  const commissionPct = paymentConfig?.commissionRatePercent ?? 10;

  const icon =
    topic === 'privacy' ? (
      <ShieldCheck className="w-4 h-4 text-[#FF6B00]" />
    ) : topic === 'returns' ? (
      <RefreshCw className="w-4 h-4 text-[#FF6B00]" />
    ) : topic === 'legal' ? (
      <Scale className="w-4 h-4 text-[#FF6B00]" />
    ) : topic === 'seller_terms' ? (
      <Store className="w-4 h-4 text-[#FF6B00]" />
    ) : (
      <FileText className="w-4 h-4 text-[#FF6B00]" />
    );

  const title =
    topic === 'privacy'
      ? copy.privacy.title
      : topic === 'returns'
      ? copy.returns.title
      : topic === 'legal'
      ? lt.legalNotice.title
      : topic === 'seller_terms'
      ? lt.sellerTerms.title
      : copy.terms.title;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-xs animate-fadeIn"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="w-full max-w-2xl bg-white dark:bg-[#131317] rounded-3xl border border-[#E6E2D8] dark:border-[#23232C] shadow-2xl max-h-[86vh] flex flex-col overflow-hidden text-[#111113] dark:text-[#F7F6F3]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-5 border-b border-[#E6E2D8] dark:border-[#23232C] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#FF6B00]/10 flex items-center justify-center shrink-0">
              {icon}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black truncate">{title}</h3>
              <p className="text-[11px] text-[#7A756D] dark:text-[#9A958E]">
                {lt.legalNotice.versionLabel} {disclosures.policyVersion} · {lt.legalNotice.effectiveDateLabel}{' '}
                {disclosures.effectiveDate}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl hover:bg-[#F3F1EC] dark:hover:bg-[#1E1E26] cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs leading-relaxed text-[#5A5854] dark:text-[#B5B0A8]">
          {topic === 'terms' && (
            <>
              <div className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C] space-y-1">
                <p className="font-bold text-[#111113] dark:text-[#F7F6F3]">{lt.termsExpanded.legalRefsTitle}</p>
                {lt.termsExpanded.legalRefsList.map((ref, idx) => (
                  <p key={idx} className="text-[11px]">
                    • {ref}
                  </p>
                ))}
              </div>
              {[...copy.terms.sections, ...lt.termsExpanded.extraSections].map(
                (sec: { title: string; body: string }, i: number) => (
                  <div key={i} className="space-y-1">
                    <h4 className="font-black text-[#111113] dark:text-[#F7F6F3]">{sec.title}</h4>
                    <p>{sec.body}</p>
                  </div>
                )
              )}
            </>
          )}

          {topic === 'privacy' && (
            <>
              <div className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C] space-y-1">
                <p className="font-bold text-[#FF6B00]">{lt.privacyExpanded.frameworkBadge}</p>
                <p>{lt.privacyExpanded.frameworkBody}</p>
              </div>
              <div>
                <h4 className="font-black text-[#111113] dark:text-[#F7F6F3] mb-1">{copy.privacy.dataCollectedTitle}</h4>
                <ul className="space-y-1">
                  {copy.privacy.dataCollectedList.map((line: string, i: number) => (
                    <li key={i}>• {line}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-black text-[#111113] dark:text-[#F7F6F3] mb-1">{lt.privacyExpanded.securityTitle}</h4>
                <p>{lt.privacyExpanded.securityBody}</p>
              </div>
              <div>
                <h4 className="font-black text-[#111113] dark:text-[#F7F6F3] mb-1">{lt.privacyExpanded.crossBorderTitle}</h4>
                <p>{lt.privacyExpanded.crossBorderBody}</p>
              </div>
              <div>
                <h4 className="font-black text-[#111113] dark:text-[#F7F6F3] mb-1">{lt.privacyExpanded.rightsTitle}</h4>
                <ul className="space-y-1">
                  {lt.privacyExpanded.rightsList.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {topic === 'returns' && (
            <>
              <div className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C] space-y-1">
                <p className="font-bold text-[#FF6B00]">{lt.returnsExpanded.retractionTitle}</p>
                <p>
                  {lt.returnsExpanded.retractionBody.replace(
                    '{DAYS}',
                    String(disclosures.returnWindowDays)
                  )}
                </p>
              </div>
              <div>
                <h4 className="font-black text-[#111113] dark:text-[#F7F6F3] mb-1">{copy.returns.eligibleTitle}</h4>
                <ul className="space-y-1">
                  {copy.returns.eligibleList.map((item: string, i: number) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="font-black text-[#111113] dark:text-[#F7F6F3] mb-1">{lt.returnsExpanded.refundChannelsTitle}</h4>
                <ul className="space-y-1">
                  {lt.returnsExpanded.refundChannelsList.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {topic === 'seller_terms' && (
            <>
              <div className="p-3 rounded-2xl bg-[#FF6B00]/10 border border-[#FF6B00]/25 text-[#111113] dark:text-[#F7F6F3] font-bold">
                {lt.sellerTerms.commissionNotePrefix} <span className="text-[#FF6B00]">{commissionPct}%</span> —{' '}
                {lt.sellerTerms.commissionNoteSuffix}
              </div>
              {lt.sellerTerms.sections.map((sec, i) => (
                <div key={i} className="space-y-1">
                  <h4 className="font-black text-[#111113] dark:text-[#F7F6F3]">{sec.title}</h4>
                  <p>{sec.body}</p>
                </div>
              ))}
            </>
          )}

          {topic === 'legal' && (
            <div className="space-y-2">
              <p>{lt.legalNotice.subtitle}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C]">
                  <span className="text-[10px] block">{lt.legalNotice.fields.legalEntityName}</span>
                  <strong className="text-[#111113] dark:text-[#F7F6F3]">{disclosures.entityName.value}</strong>
                </div>
                <div className="p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18181E] border border-[#E6E2D8] dark:border-[#23232C]">
                  <span className="text-[10px] block">{lt.legalNotice.fields.rneNumber}</span>
                  <strong className="text-[#111113] dark:text-[#F7F6F3] font-mono">{disclosures.rneNumber.value}</strong>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-3.5 sm:p-4 border-t border-[#E6E2D8] dark:border-[#23232C] flex items-center justify-between gap-3 bg-[#FAF9F7] dark:bg-[#18181E]">
          {onNavigateFullPage ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigateFullPage(topic);
              }}
              className="text-xs font-bold text-[#FF6B00] hover:underline cursor-pointer"
            >
              {language === 'ar'
                ? 'فتح الصفحة الكاملة'
                : language === 'fr'
                ? 'Ouvrir la page complète'
                : 'Open Full Page'}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-bold cursor-pointer"
          >
            {language === 'ar' ? 'إغلاق' : language === 'fr' ? 'Fermer' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
