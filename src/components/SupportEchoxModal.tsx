import React, { useEffect, useState } from 'react';
import {
  X,
  HeartHandshake,
  Banknote,
  CreditCard,
  Building2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  Upload,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import {
  contributeToEchox,
  fetchPosteCcpTransferDetails,
  getPaymentStatusTone,
  readReceiptFileAsDataUrl,
} from '../lib/payments';
import { PaymentMethodType, PosteCcpTransferDetails, SupportTransaction } from '../types';

const QUICK_AMOUNTS = [10, 25, 50, 100];

export const SupportEchoxModal: React.FC = () => {
  const {
    isSupportModalOpen,
    setIsSupportModalOpen,
    setCurrentView,
    paymentConfig,
    isOnline,
    language,
    t,
  } = useStore();

  const [amountInput, setAmountInput] = useState<string>('25');
  const [supporterName, setSupporterName] = useState('');
  const [supporterPhone, setSupporterPhone] = useState('');
  const [note, setNote] = useState('');

  const codEnabled = paymentConfig?.methods?.cod?.enabled !== false;
  const posteCcpEnabled = Boolean(paymentConfig?.methods?.poste_ccp?.enabled);
  const onlineReady =
    paymentConfig?.methods?.online_payment?.enabled === true &&
    paymentConfig?.methods?.online_payment?.readyForLive === true;

  const initialMethod: PaymentMethodType = onlineReady
    ? 'online_payment'
    : posteCcpEnabled
    ? 'poste_ccp'
    : 'cod';

  const [method, setMethod] = useState<PaymentMethodType>(initialMethod);
  const [ccpDetails, setCcpDetails] = useState<PosteCcpTransferDetails | null>(null);
  const [ccpLoading, setCcpLoading] = useState(false);
  const [ccpError, setCcpError] = useState('');
  const [proofRef, setProofRef] = useState('');
  const [proofImage, setProofImage] = useState('');
  const [copiedRib, setCopiedRib] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [receipt, setReceipt] = useState<SupportTransaction | null>(null);
  const [gatewayPayUrl, setGatewayPayUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isSupportModalOpen || receipt || method !== 'poste_ccp') {
      if (method !== 'poste_ccp') {
        setCcpDetails(null);
        setCcpError('');
      }
      return;
    }
    let cancelled = false;
    setCcpLoading(true);
    setCcpError('');
    fetchPosteCcpTransferDetails().then((res) => {
      if (cancelled) return;
      setCcpLoading(false);
      if (res.ok && res.details) {
        setCcpDetails(res.details);
      } else {
        setCcpError(res.error || 'تعذر تحميل بيانات التحويل البريدي.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isSupportModalOpen, method, receipt]);

  if (!isSupportModalOpen) return null;

  const currency = paymentConfig.currency || t.cart.currency;

  const resetAndClose = () => {
    setReceipt(null);
    setGatewayPayUrl(undefined);
    setErrorMsg('');
    setNote('');
    setProofRef('');
    setProofImage('');
    setIsSupportModalOpen(false);
  };

  const handleReceiptFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await readReceiptFileAsDataUrl(file);
    if (!res.ok) {
      setErrorMsg(res.error || 'صيغة الصورة غير صالحة.');
      return;
    }
    setErrorMsg('');
    setProofImage(res.dataUrl || '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!isOnline) {
      setErrorMsg(t.offline.serverActionDisabled);
      return;
    }

    const parsedAmount = parseFloat(amountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg(
        language === 'ar'
          ? 'يرجى إدخال مبلغ دعم صالح أكبر من الصفر.'
          : language === 'fr'
          ? 'Veuillez saisir un montant valide supérieur à 0.'
          : 'Please enter a valid positive support amount.'
      );
      return;
    }

    if (method === 'online_payment' && !onlineReady) {
      setErrorMsg(t.payments.onlineNotConfigured);
      return;
    }

    setSubmitting(true);
    const res = await contributeToEchox({
      amount: parsedAmount,
      method,
      supporterName: supporterName.trim() || undefined,
      supporterPhone: supporterPhone.trim() || undefined,
      note: note.trim() || undefined,
      ...(method === 'poste_ccp' && (proofRef.trim() || proofImage)
        ? {
            transferProof: {
              referenceNumber: proofRef.trim() || 'CCP-SUPPORT',
              senderName: supporterName.trim() || 'داعم NIAPOLOR',
              receiptImageDataUrl: proofImage || undefined,
            },
          }
        : {}),
    });
    setSubmitting(false);

    if (!res.ok || !res.supportTransaction) {
      setErrorMsg(
        res.error ||
          (language === 'ar'
            ? 'تعذر تسجيل مساهمة الدعم حالياً.'
            : language === 'fr'
            ? 'Impossible d’enregistrer la contribution.'
            : 'Unable to record contribution.')
      );
      return;
    }

    setReceipt(res.supportTransaction);
    setGatewayPayUrl(res.paymentUrl);
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn overflow-y-auto"
      onClick={resetAndClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-[#0B0B0D] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col text-[#111113] dark:text-[#F7F6F3]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 bg-[#0B0B0D] text-white flex items-center justify-between border-b border-[#23232A]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#FF6B00] text-white flex items-center justify-center shrink-0">
              <HeartHandshake className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black">{t.supportEchox.title}</h2>
              <p className="text-[11px] text-[#B5B0A8] leading-snug">
                {language === 'ar'
                  ? 'مساهمة مستقلة لتطوير منصة NIAPOLOR'
                  : language === 'fr'
                  ? 'Contribution indépendante pour NIAPOLOR'
                  : 'Independent platform support contribution'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            aria-label="Close support modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {receipt ? (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h3 className="text-base font-black text-emerald-800 dark:text-emerald-300">
                  {t.supportEchox.successTitle}
                </h3>
                <p className="text-xs text-[#5A5854] dark:text-[#B5B0A8]">
                  {t.supportEchox.receiptRef}{' '}
                  <strong className="font-mono text-[#FF6B00]">{receipt.supportReference}</strong>
                </p>
                <div className="flex items-center justify-center gap-2 pt-1">
                  <span className="text-sm font-black tabular-nums">
                    {receipt.amount.toFixed(3)} {receipt.currency}
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${getPaymentStatusTone(
                      receipt.status
                    )}`}
                  >
                    {(t.payments.statuses as Record<string, string>)[receipt.status] || receipt.status}
                  </span>
                </div>
              </div>

              {receipt.method === 'poste_ccp' && ccpDetails && (
                <div className="p-3.5 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] text-xs space-y-1.5">
                  <p className="font-black text-[#111113] dark:text-[#F7F6F3]">{t.payments.posteCcpDetailsTitle}</p>
                  <p className="text-[11px]">
                    {t.payments.beneficiary}: <strong>{ccpDetails.accountHolder}</strong>
                  </p>
                  <p className="text-[11px]">
                    {t.payments.bankName}: <strong>{ccpDetails.bankName}</strong>
                  </p>
                  <p className="text-[11px] font-mono break-all" dir="ltr">
                    RIB/CCP: <strong>{ccpDetails.ibanOrRib}</strong>
                  </p>
                  <p className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold pt-1">
                    {t.payments.ccpManualVerifyNotice}
                  </p>
                </div>
              )}

              {receipt.method === 'online_payment' && gatewayPayUrl && gatewayPayUrl.startsWith('https://') && (
                <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 text-center space-y-2.5">
                  <p className="text-xs font-bold text-blue-900 dark:text-blue-200">
                    {language === 'ar'
                      ? 'تم تجهيز جلسة الدفع المؤمّنة لمساهمتك. اضغط لإتمام السداد عبر البوابة.'
                      : language === 'fr'
                      ? 'Session de paiement prête. Cliquez pour finaliser votre contribution.'
                      : 'Secure payment session ready. Click below to complete your contribution.'}
                  </p>
                  <a
                    href={gatewayPayUrl}
                    target={typeof window !== 'undefined' && window.self !== window.top ? '_blank' : '_self'}
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-bold"
                  >
                    <span>{language === 'ar' ? 'إتمام الدفع الإلكتروني الآمن الآن' : language === 'fr' ? 'Finaliser le paiement' : 'Complete Online Payment'}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              <div className="p-3 rounded-2xl bg-[#F3F1EC] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] text-[11px] text-[#5A5854] dark:text-[#B5B0A8] flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#FF6B00] shrink-0 mt-0.5" />
                <span>{t.supportEchox.independentNotice}</span>
              </div>

              <button
                type="button"
                onClick={resetAndClose}
                className="w-full py-2.5 rounded-xl bg-[#111113] dark:bg-[#18181D] hover:bg-[#FF6B00] dark:hover:bg-[#FF6B00] border border-transparent dark:border-[#32323C] text-white text-xs font-bold transition-colors cursor-pointer"
              >
                {language === 'ar' ? 'إغلاق' : language === 'fr' ? 'Fermer' : 'Close'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-xs text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
                {t.supportEchox.subtitle}
              </p>

              {/* Amount selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold block">{t.supportEchox.amountLabel}</label>
                <div className="grid grid-cols-4 gap-2">
                  {QUICK_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setAmountInput(amt.toString())}
                      className={`py-2 rounded-xl text-xs font-black tabular-nums border transition-all cursor-pointer ${
                        parseFloat(amountInput) === amt
                          ? 'bg-[#FF6B00] text-white border-[#FF6B00] shadow-xs'
                          : 'bg-[#FAF9F7] dark:bg-[#18181D] border-[#E6E2D8] dark:border-[#23232A] hover:border-[#FF6B00]'
                      }`}
                    >
                      {amt} {currency}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  required
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder={t.supportEchox.customAmountPlaceholder}
                  className="w-full text-sm font-black tabular-nums py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] focus:outline-hidden focus:border-[#FF6B00]"
                  dir="ltr"
                />
              </div>

              {/* Supporter Optional Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] font-bold text-[#5A5854] dark:text-[#B5B0A8] block mb-1">
                    {t.supportEchox.supporterName}
                  </label>
                  <input
                    type="text"
                    value={supporterName}
                    onChange={(e) => setSupporterName(e.target.value)}
                    placeholder="NIAPOLOR Supporter"
                    className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-transparent focus:outline-hidden focus:border-[#FF6B00]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-[#5A5854] dark:text-[#B5B0A8] block mb-1">
                    {t.supportEchox.supporterPhone}
                  </label>
                  <input
                    type="tel"
                    value={supporterPhone}
                    onChange={(e) => setSupporterPhone(e.target.value)}
                    placeholder="+216 ..."
                    dir="ltr"
                    className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-transparent focus:outline-hidden focus:border-[#FF6B00]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-[#5A5854] dark:text-[#B5B0A8] block mb-1">
                  {t.supportEchox.supporterNote}
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="..."
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-transparent focus:outline-hidden focus:border-[#FF6B00]"
                />
              </div>

              {/* Payment method choice */}
              <div className="space-y-2">
                <label className="text-xs font-bold block">{t.supportEchox.chooseMethod}</label>
                <div className="space-y-2">

                  {codEnabled && (
                    <label
                      className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                        method === 'cod'
                          ? 'border-[#FF6B00] bg-[#FF6B00]/5'
                          : 'border-[#E6E2D8] dark:border-[#23232A]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="supportMethod"
                        checked={method === 'cod'}
                        onChange={() => setMethod('cod')}
                        className="accent-[#FF6B00]"
                      />
                      <Banknote className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div className="text-xs">
                        <span className="font-bold block">{t.payments.codLabel}</span>
                      </div>
                    </label>
                  )}

                  {posteCcpEnabled && (
                    <label
                      className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                        method === 'poste_ccp'
                          ? 'border-[#FF6B00] bg-[#FF6B00]/5'
                          : 'border-[#E6E2D8] dark:border-[#23232A]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="supportMethod"
                        checked={method === 'poste_ccp'}
                        onChange={() => setMethod('poste_ccp')}
                        className="accent-[#FF6B00]"
                      />
                      <Building2 className="w-4 h-4 text-[#FF6B00] shrink-0" />
                      <div className="text-xs">
                        <span className="font-bold block">{t.payments.posteCcpLabel}</span>
                      </div>
                    </label>
                  )}

                  {onlineReady ? (
                    <label
                      className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                        method === 'online_payment'
                          ? 'border-[#FF6B00] bg-[#FF6B00]/5'
                          : 'border-[#E6E2D8] dark:border-[#23232A]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="supportMethod"
                        checked={method === 'online_payment'}
                        onChange={() => setMethod('online_payment')}
                        className="accent-[#FF6B00]"
                      />
                      <CreditCard className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="text-xs font-bold">{t.payments.onlinePaymentLabel}</span>
                    </label>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-[#F3F1EC] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] text-[11px] text-[#7A756D] dark:text-[#8E8980] flex items-center gap-2">
                      <CreditCard className="w-4 h-4 shrink-0" />
                      <span>{t.payments.onlineNotConfigured}</span>
                    </div>
                  )}
                </div>

                {/* On-demand Poste / CCP transfer details rendered ONLY when selected */}
                {method === 'poste_ccp' && (
                  <div className="p-3.5 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#FF6B00]/30 space-y-2.5 text-xs">
                    {ccpLoading ? (
                      <div className="flex items-center gap-2 text-[#7A756D] dark:text-[#8E8980]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>جاري تحميل بيانات التحويل...</span>
                      </div>
                    ) : ccpError ? (
                      <p className="text-red-600 dark:text-red-400 font-bold">{ccpError}</p>
                    ) : ccpDetails ? (
                      <>
                        <p className="font-black text-[#111113] dark:text-[#F7F6F3]">
                          {t.payments.posteCcpDetailsTitle}
                        </p>
                        <div className="space-y-1 text-[11px]">
                          <p>
                            {t.payments.beneficiary}: <strong>{ccpDetails.accountHolder}</strong>
                          </p>
                          <p>
                            {t.payments.bankName}: <strong>{ccpDetails.bankName}</strong>
                          </p>
                          <div className="flex items-center justify-between gap-2 bg-white dark:bg-[#141418] p-2 rounded-xl border border-[#E6E2D8] dark:border-[#23232A]">
                            <span className="font-mono font-bold break-all" dir="ltr">
                              {ccpDetails.ibanOrRib}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(ccpDetails.ibanOrRib).catch(() => {});
                                setCopiedRib(true);
                                setTimeout(() => setCopiedRib(false), 1800);
                              }}
                              className="px-2 py-1 rounded-lg border border-[#D6D0C4] dark:border-[#32323C] text-[10px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                            >
                              {copiedRib ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedRib ? t.payments.copied : t.payments.copy}</span>
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          <input
                            type="text"
                            value={proofRef}
                            onChange={(e) => setProofRef(e.target.value)}
                            placeholder="رقم وصل التحويل (اختياري)"
                            className="w-full text-[11px] py-1.5 px-2.5 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#141418]"
                          />
                          <label className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl border border-dashed border-[#D6D0C4] dark:border-[#32323C] hover:border-[#FF6B00] text-[11px] font-bold cursor-pointer">
                            <Upload className="w-3.5 h-3.5 text-[#FF6B00]" />
                            <span>{proofImage ? 'تم إرفاق صورة الوصل ✓' : 'إرفاق صورة الوصل (اختياري)'}</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={handleReceiptFileChange}
                              className="hidden"
                            />
                          </label>
                        </div>
                        <p className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold">
                          {t.payments.ccpManualVerifyNotice}
                        </p>
                      </>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="block">{t.supportEchox.independentNotice}</span>
                  <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => {
                        setIsSupportModalOpen(false);
                        setCurrentView('terms');
                      }}
                      className="underline hover:text-[#FF6B00] cursor-pointer"
                    >
                      {t.footer.termsOfService}
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => {
                        setIsSupportModalOpen(false);
                        setCurrentView('privacy');
                      }}
                      className="underline hover:text-[#FF6B00] cursor-pointer"
                    >
                      {t.footer.privacyPolicy}
                    </button>
                  </div>
                </div>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-600 dark:text-red-400 font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {!isOnline && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{t.offline.serverActionDisabled}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !isOnline || (!codEnabled && !posteCcpEnabled && !onlineReady)}
                className="w-full py-3 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <HeartHandshake className="w-4 h-4" />}
                <span>{t.supportEchox.submitBtn}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
