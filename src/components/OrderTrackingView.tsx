import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import {
  Search,
  Package,
  Clock,
  PhoneCall,
  XCircle,
  MapPin,
  MessageCircle,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  CreditCard,
  Building2,
  Upload,
  FileImage,
} from 'lucide-react';
import { getGovernorateName } from '../data/governorates';
import { Order, OrderStatus, PosteCcpTransferDetails } from '../types';
import {
  fetchPosteCcpTransferDetails,
  getGuestTrackingToken,
  getPaymentStatusTone,
  readReceiptFileAsDataUrl,
  submitBankTransferProofClient,
  submitPosteCcpProofClient,
  submitRefundOrCancelRequest,
  trackOrderServer,
} from '../lib/payments';
import { handleStoreImageError } from '../lib/imageFallback';

export const OrderTrackingView: React.FC = () => {
  const { orders, currentUser, language, t, siteSettings, paymentConfig, updateOrderInState, isOnline } = useStore();

  const [inputCode, setInputCode] = useState('');
  const [trackingTokenInput, setTrackingTokenInput] = useState('');
  const [searchError, setSearchError] = useState('');
  const [searchedOrder, setSearchedOrder] = useState<Order | null>(() => {
    return orders[0] || null;
  });
  const [hasSearched, setHasSearched] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState('');
  const [actionError, setActionError] = useState('');

  // Refund / Cancel request state
  const [showRefundBox, setShowRefundBox] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  // Poste Tunisienne / CCP transfer details + proof upload state
  const [ccpFallbackDetails, setCcpFallbackDetails] = useState<PosteCcpTransferDetails | null>(null);
  const [proofRefNumber, setProofRefNumber] = useState('');
  const [proofSenderName, setProofSenderName] = useState('');
  const [proofDate, setProofDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [proofNotes, setProofNotes] = useState('');
  const [proofImageDataUrl, setProofImageDataUrl] = useState('');
  const [proofSubmitting, setProofSubmitting] = useState(false);

  const activeOrder = searchedOrder
    ? orders.find((o) => o.id === searchedOrder.id || o.trackingNumber === searchedOrder.trackingNumber) || searchedOrder
    : null;

  const resolveTokenForOrder = (trackingNumber: string): string | undefined => {
    return trackingTokenInput.trim() || getGuestTrackingToken(trackingNumber);
  };

  React.useEffect(() => {
    if (
      !activeOrder ||
      activeOrder.paymentMethod !== 'poste_ccp' ||
      activeOrder.transferDetails ||
      activeOrder.paymentStatus === 'Paid' ||
      activeOrder.paymentStatus === 'Cancelled' ||
      activeOrder.paymentStatus === 'Refunded' ||
      !isOnline
    ) {
      if (!activeOrder || activeOrder.paymentMethod !== 'poste_ccp') {
        setCcpFallbackDetails(null);
      }
      return;
    }
    let cancelled = false;
    fetchPosteCcpTransferDetails().then((res) => {
      if (!cancelled && res.ok && res.details) {
        setCcpFallbackDetails(res.details);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeOrder?.id, activeOrder?.paymentMethod, activeOrder?.paymentStatus, activeOrder?.transferDetails, isOnline]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCode.trim()) return;
    const clean = inputCode.trim().toUpperCase();
    const localFound = orders.find(
      (o) =>
        o.trackingNumber.toUpperCase() === clean ||
        (o.paymentReference && o.paymentReference.toUpperCase() === clean)
    );
    setHasSearched(true);
    setSearchError('');
    setActionSuccess('');
    setActionError('');

    if (!isOnline) {
      setSearchedOrder(localFound || null);
      return;
    }

    const effectiveToken = resolveTokenForOrder(clean);
    const srv = await trackOrderServer(clean, { trackingToken: effectiveToken });
    if (srv.ok && srv.order) {
      setSearchedOrder(srv.order);
      updateOrderInState(srv.order);
    } else {
      setSearchedOrder(null);
      setSearchError(srv.error || t.tracking.orderNotFound);
    }
  };

  const handleCopy = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleRefundRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder || !refundReason.trim()) return;
    if (!isOnline) {
      setActionError(t.offline.serverActionDisabled);
      return;
    }
    setActionError('');
    setActionSuccess('');
    setRefundSubmitting(true);
    const res = await submitRefundOrCancelRequest({
      trackingNumber: activeOrder.trackingNumber,
      trackingToken: resolveTokenForOrder(activeOrder.trackingNumber),
      reason: refundReason.trim(),
    });
    setRefundSubmitting(false);
    if (!res.ok) {
      setActionError(res.error || 'تعذر إرسال طلب الإلغاء / الاسترجاع.');
      return;
    }
    setShowRefundBox(false);
    setRefundReason('');
    setActionSuccess(
      language === 'ar'
        ? 'تم تسجيل طلب الإلغاء / الاسترجاع وإشعار مركز التحكم للمراجعة.'
        : 'Cancellation / refund request logged for Admin Panel review.'
    );
  };

  const handleReceiptFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await readReceiptFileAsDataUrl(file);
    if (!res.ok) {
      setActionError(res.error || 'صيغة الصورة غير مدعومة.');
      return;
    }
    setActionError('');
    setProofImageDataUrl(res.dataUrl || '');
  };

  const handleSubmitTransferProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    if (!isOnline) {
      setActionError(t.offline.serverActionDisabled);
      return;
    }
    if (!proofRefNumber.trim() || !proofSenderName.trim()) {
      setActionError('يرجى إدخال رقم العملية بالوصل واسم المحوّل.');
      return;
    }
    setActionError('');
    setActionSuccess('');
    setProofSubmitting(true);

    const payload = {
      trackingNumber: activeOrder.trackingNumber,
      trackingToken: resolveTokenForOrder(activeOrder.trackingNumber),
      referenceNumber: proofRefNumber.trim(),
      senderName: proofSenderName.trim(),
      transferDate: proofDate,
      receiptImageDataUrl: proofImageDataUrl || undefined,
      notes: proofNotes.trim() || undefined,
    };

    const res =
      activeOrder.paymentMethod === 'poste_ccp'
        ? await submitPosteCcpProofClient(payload)
        : await submitBankTransferProofClient(payload);

    setProofSubmitting(false);
    if (!res.ok || !res.order) {
      setActionError(res.error || 'تعذر إرسال وصل التحويل.');
      return;
    }
    setSearchedOrder(res.order);
    updateOrderInState(res.order);
    setProofRefNumber('');
    setProofSenderName('');
    setProofNotes('');
    setProofImageDataUrl('');
    setActionSuccess(t.payments.proofSubmittedNotice);
  };

  const statusSteps: { key: OrderStatus; label: string }[] = [
    { key: 'new', label: t.orderStatus.new },
    { key: 'under_confirmation', label: t.orderStatus.under_confirmation },
    { key: 'preparing', label: t.orderStatus.preparing },
    { key: 'out_for_delivery', label: t.orderStatus.out_for_delivery },
    { key: 'delivered', label: t.orderStatus.delivered },
  ];

  const getStatusIndex = (status: OrderStatus) => {
    if (status === 'cancelled') return -1;
    return statusSteps.findIndex((s) => s.key === status);
  };

  const currentStepIndex = activeOrder ? getStatusIndex(activeOrder.status) : 0;
  const currencyLabel = activeOrder?.currency || paymentConfig.currency || t.cart.currency;

  const formatPaymentMethodLabel = (method: string) => {
    if (method === 'cod') return t.payments.codLabel;
    if (method === 'poste_ccp') return t.payments.posteCcpLabel;
    if (method === 'bank_transfer') return t.payments.bankTransferLabel;
    if (method === 'online_payment') return t.payments.onlinePaymentLabel;
    return method;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      {/* Title & Search Box */}
      <div className="text-center space-y-3">
        <h1 className="text-2xl sm:text-3xl font-black text-[#111113] dark:text-[#F7F6F3]">
          {t.tracking.title}
        </h1>
        <p className="text-sm text-[#5A5854] dark:text-[#8E8980] max-w-lg mx-auto">
          {t.tracking.subtitle}
        </p>

        <form onSubmit={handleSearch} className="max-w-xl mx-auto space-y-2 pt-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="ECH-TN-981240 / ECH-REF-..."
                value={inputCode}
                onChange={(e) => {
                  const val = e.target.value;
                  setInputCode(val);
                  const savedTok = getGuestTrackingToken(val);
                  if (savedTok && !trackingTokenInput) {
                    setTrackingTokenInput(savedTok);
                  }
                }}
                className="w-full min-h-[46px] text-sm py-3 px-4 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] placeholder:text-[#7A756D] dark:placeholder:text-[#8E8980] focus:outline-hidden focus:border-[#FF6B00] shadow-xs text-center font-mono font-bold uppercase"
                dir="ltr"
              />
            </div>
            {!currentUser && (
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder={t.tracking.trackingTokenPlaceholder}
                  value={trackingTokenInput}
                  onChange={(e) => setTrackingTokenInput(e.target.value)}
                  className="w-full min-h-[46px] text-sm py-3 px-4 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] placeholder:text-[#7A756D] dark:placeholder:text-[#8E8980] focus:outline-hidden focus:border-[#FF6B00] shadow-xs text-center font-mono"
                  dir="ltr"
                />
              </div>
            )}
            <button
              type="submit"
              className="min-h-[46px] px-6 py-3 bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] dark:hover:bg-[#E05E00] text-white font-bold text-sm rounded-xl transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
            >
              <Search className="w-4 h-4" />
              <span>{t.tracking.searchBtn}</span>
            </button>
          </div>
          {currentUser && (
            <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              {t.tracking.signedInAccessNotice}
            </p>
          )}
        </form>

        {/* Quick order samples */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-[#7A756D] dark:text-[#8E8980] pt-1">
          <span>{language === 'ar' ? 'طلبات مسجلة:' : 'Recent:'}</span>
          {orders.slice(0, 3).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                setInputCode(o.trackingNumber);
                const savedTok = getGuestTrackingToken(o.trackingNumber);
                if (savedTok) setTrackingTokenInput(savedTok);
                setSearchedOrder(o);
                setHasSearched(true);
                setSearchError('');
                setActionSuccess('');
                setActionError('');
              }}
              className="text-[#FF6B00] font-bold underline hover:opacity-80 font-mono cursor-pointer"
            >
              {o.trackingNumber}
            </button>
          ))}
        </div>

        {!isOnline && (
          <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2 max-w-md mx-auto">
            {t.offline.trackingCachedNotice}
          </p>
        )}
      </div>

      {/* Result Container */}
      {activeOrder ? (
        <div className="bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-md p-6 sm:p-8 space-y-8">
          {/* Order Header + Independent Payment Badge */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-[#E6E2D8] dark:border-[#23232A]">
            <div className="space-y-1">
              <span className="text-xs text-[#7A756D] dark:text-[#8E8980] block">رقم التتبع:</span>
              <div className="flex items-center flex-wrap gap-2">
                <span className="text-xl sm:text-2xl font-black text-[#FF6B00] font-mono tracking-wider">
                  {activeOrder.trackingNumber}
                </span>
                <span
                  className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${getPaymentStatusTone(
                    activeOrder.paymentStatus
                  )}`}
                >
                  {(t.payments.statuses as Record<string, string>)[activeOrder.paymentStatus] ||
                    activeOrder.paymentStatus}
                </span>
              </div>
              <p className="text-xs text-[#7A756D] dark:text-[#8E8980] mt-1">
                {new Date(activeOrder.createdAt).toLocaleDateString(language === 'ar' ? 'ar-TN' : 'en-GB')} ·{' '}
                {activeOrder.carrierName}
                {activeOrder.estimatedDelivery ? ` · ${t.tracking.estimatedDelivery}: ${activeOrder.estimatedDelivery}` : ''}
                {activeOrder.paymentReference ? ` · Ref: ${activeOrder.paymentReference}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`tel:${siteSettings.supportPhone}`}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#F3F1EC] dark:bg-[#18181D] hover:bg-[#EBE7DF] dark:hover:bg-[#1C1C22] text-[#111113] dark:text-[#F7F6F3] text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <PhoneCall className="w-3.5 h-3.5 text-[#FF6B00]" />
                <span>{language === 'ar' ? 'اتصال' : 'Call'}</span>
              </a>
              <a
                href={`https://wa.me/${(siteSettings.whatsappPhone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Order ${activeOrder.trackingNumber}`)}`}
                target="_blank"
                rel="noreferrer"
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>WhatsApp</span>
              </a>
              {activeOrder.status !== 'cancelled' && activeOrder.paymentStatus !== 'Refunded' && (
                <button
                  type="button"
                  onClick={() => setShowRefundBox(!showRefundBox)}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] hover:border-red-400 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#7A756D] dark:text-[#8E8980]" />
                  <span>{t.payments.requestRefund}</span>
                </button>
              )}
            </div>
          </div>

          {actionSuccess && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
          )}
          {actionError && (
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{actionError}</span>
            </div>
          )}

          {/* Optional Refund / Cancellation Form */}
          {showRefundBox && (
            <form
              onSubmit={handleRefundRequest}
              className="p-4 rounded-2xl bg-[#F3F1EC] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] space-y-3"
            >
              <h4 className="text-xs font-black">{t.payments.requestRefund}</h4>
              <input
                type="text"
                required
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder={t.payments.refundReasonPlaceholder}
                className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#141418] text-[#111113] dark:text-[#F7F6F3] outline-none focus:border-[#FF6B00]"
              />
              {!isOnline && (
                <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                  {t.offline.serverActionDisabled}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRefundBox(false)}
                  className="px-3 py-1.5 text-xs font-bold text-[#7A756D] dark:text-[#8E8980] cursor-pointer"
                >
                  {t.ownerDashboard.buttons.cancel}
                </button>
                <button
                  type="submit"
                  disabled={refundSubmitting || !isOnline}
                  className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold cursor-pointer"
                >
                  {t.ownerDashboard.buttons.confirm}
                </button>
              </div>
            </form>
          )}

          {/* Poste Tunisienne / CCP Transfer Card & Receipt Upload (for matching poste_ccp / bank_transfer orders) */}
          {(activeOrder.paymentMethod === 'poste_ccp' || activeOrder.paymentMethod === 'bank_transfer') &&
            activeOrder.paymentStatus !== 'Paid' &&
            activeOrder.paymentStatus !== 'Cancelled' &&
            activeOrder.paymentStatus !== 'Refunded' && (
              <div className="p-4 sm:p-5 rounded-2xl bg-[#FFF8F3] dark:bg-[#18181D] border border-[#FF6B00]/35 space-y-3.5 text-xs">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 font-black text-[#111113] dark:text-[#F7F6F3]">
                    <Building2 className="w-4 h-4 text-[#FF6B00]" />
                    <span>{t.payments.posteCcpDetailsTitle}</span>
                  </div>
                  {activeOrder.paymentReference && (
                    <button
                      type="button"
                      onClick={() => handleCopy('trk_ccp_ref', activeOrder.paymentReference!)}
                      className="text-[11px] font-mono font-bold text-[#FF6B00] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>{activeOrder.paymentReference}</span>
                      {copiedKey === 'trk_ccp_ref' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                </div>

                {(activeOrder.transferDetails || ccpFallbackDetails) && (
                      <div className="p-3 rounded-xl bg-white dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#32323C] space-y-1.5">
                        {(() => {
                          const det = (activeOrder.transferDetails || ccpFallbackDetails)!;
                          return (
                            <>
                              <p>
                                <span className="text-[#7A756D] dark:text-[#8E8980]">{t.payments.beneficiary}: </span>
                                <strong>{det.accountHolder}</strong>
                              </p>
                              <p>
                                <span className="text-[#7A756D] dark:text-[#8E8980]">{t.payments.bankName}: </span>
                                <strong>{det.bankName}</strong>
                              </p>
                              <div className="flex items-center justify-between gap-2 pt-1">
                                <span className="font-mono font-black text-[#111113] dark:text-[#F7F6F3] break-all" dir="ltr">
                                  {det.ibanOrRib}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy('trk_rib', det.ibanOrRib)}
                                  className="min-h-[44px] px-3 py-2 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] text-[11px] font-bold shrink-0 cursor-pointer"
                                >
                                  {copiedKey === 'trk_rib' ? t.payments.copied : t.payments.copy}
                                </button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-800 dark:text-amber-300 font-semibold">
                      {t.payments.ccpManualVerifyNotice}
                    </div>

                    {activeOrder.transferProof && activeOrder.paymentStatus !== 'Payment Failed' ? (
                      <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-0.5 text-indigo-800 dark:text-indigo-200">
                          <p className="font-black">{t.payments.proofSubmittedNotice}</p>
                          <p className="text-[11px]">
                            مرجع الوصل: <strong className="font-mono">{activeOrder.transferProof.referenceNumber}</strong> · المحوّل:{' '}
                            <strong>{activeOrder.transferProof.senderName}</strong>
                          </p>
                        </div>
                        {activeOrder.transferProof.receiptImageDataUrl && (
                          <img
                            src={activeOrder.transferProof.receiptImageDataUrl}
                            alt="Uploaded receipt"
                            className="w-16 h-16 object-cover rounded-xl border border-indigo-300 shrink-0"
                          />
                        )}
                      </div>
                    ) : (
                      <form onSubmit={handleSubmitTransferProof} className="space-y-2.5 pt-2 border-t border-[#E6E2D8] dark:border-[#32323C]">
                        <p className="font-black text-[#111113] dark:text-[#F7F6F3]">
                          {activeOrder.paymentStatus === 'Payment Failed'
                            ? 'تم رفض الوصل السابق — يمكنك إعادة رفع وصل التحويل الصحيح:'
                            : t.payments.uploadProofTitle}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <input
                            type="text"
                            required
                            value={proofRefNumber}
                            onChange={(e) => setProofRefNumber(e.target.value)}
                            placeholder={t.payments.proofRefPlaceholder}
                            className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#141418]"
                          />
                          <input
                            type="text"
                            required
                            value={proofSenderName}
                            onChange={(e) => setProofSenderName(e.target.value)}
                            placeholder={t.payments.proofSenderPlaceholder}
                            className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#141418]"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center">
                          <input
                            type="date"
                            value={proofDate}
                            onChange={(e) => setProofDate(e.target.value)}
                            className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#141418] font-mono"
                          />
                          <label className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-dashed border-[#FF6B00]/60 hover:bg-[#FF6B00]/5 text-xs font-bold cursor-pointer">
                            <Upload className="w-3.5 h-3.5 text-[#FF6B00]" />
                            <span>{proofImageDataUrl ? 'تم إرفاق صورة الوصل ✓' : 'رفع صورة الوصل (JPEG/PNG/WebP)'}</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={handleReceiptFileChange}
                              className="hidden"
                            />
                          </label>
                        </div>
                        <input
                          type="text"
                          value={proofNotes}
                          onChange={(e) => setProofNotes(e.target.value)}
                          placeholder="ملاحظات إضافية حول التحويل (اختياري)..."
                          className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#141418]"
                        />
                        {proofImageDataUrl && (
                          <div className="flex items-center gap-3 p-2 rounded-xl bg-white dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#32323C]">
                            <img src={proofImageDataUrl} alt="Receipt preview" className="w-14 h-14 object-cover rounded-lg" />
                            <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                              <FileImage className="w-3.5 h-3.5" /> معاينة صورة الوصل جاهزة
                            </span>
                          </div>
                        )}
                        <button
                          type="submit"
                          disabled={proofSubmitting || !isOnline}
                          className="w-full py-2.5 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white font-bold text-xs cursor-pointer disabled:opacity-50"
                        >
                          {proofSubmitting ? 'جاري الإرسال...' : t.payments.submitProofBtn}
                        </button>
                      </form>
                    )}
              </div>
            )}

          {/* Online Gateway Payment Status Guidance */}
          {activeOrder.paymentMethod === 'online_payment' &&
            activeOrder.paymentStatus !== 'Paid' &&
            activeOrder.paymentStatus !== 'Cancelled' &&
            activeOrder.paymentStatus !== 'Refunded' && (
              <div className="p-4 sm:p-5 rounded-2xl bg-blue-50/70 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-black text-blue-900 dark:text-blue-200">
                    <CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>
                      {language === 'ar'
                        ? 'حالة الدفع الإلكتروني عبر البوابة'
                        : language === 'fr'
                        ? 'Statut du paiement en ligne'
                        : 'Online Gateway Payment Status'}
                    </span>
                  </div>
                  {activeOrder.paymentReference && (
                    <button
                      type="button"
                      onClick={() => handleCopy('trk_ref', activeOrder.paymentReference!)}
                      className="text-[11px] font-mono font-bold text-[#FF6B00] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>{activeOrder.paymentReference}</span>
                      {copiedKey === 'trk_ref' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
                  {activeOrder.paymentStatus === 'Payment Failed'
                    ? language === 'ar'
                      ? 'لم يكتمل السداد الإلكتروني لهذا الطلب. يمكنك التواصل مع خدمة العملاء عبر الهاتف أو واتساب لإعادة إتمام الطلب أو تحويله للدفع عند الاستلام.'
                      : language === 'fr'
                      ? 'Le paiement en ligne n’a pas abouti. Contactez notre support pour finaliser ou passer en paiement à la livraison.'
                      : 'The online payment was not completed. Please contact support to retry or switch to Cash on Delivery.'
                    : language === 'ar'
                    ? 'جاري تأكيد عملية الدفع إلكترونياً من خادم البوابة. سيتم تحديث حالة الطلب إلى "مدفوع" تلقائياً فور تأكيد العملية.'
                    : language === 'fr'
                    ? 'Confirmation du paiement en cours auprès de la passerelle. Le statut sera mis à jour automatiquement.'
                    : 'Awaiting server-side confirmation from the payment gateway. Order status updates automatically once confirmed.'}
                </p>
              </div>
            )}

          {/* Stepper Timeline */}
          {activeOrder.status === 'cancelled' ? (
            <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 flex items-center gap-3 text-red-800 dark:text-red-300">
              <XCircle className="w-6 h-6 text-red-600 shrink-0" />
              <div>
                <p className="font-bold text-sm">{t.orderStatus.cancelled}</p>
                <p className="text-xs opacity-80">{activeOrder.refundReason || 'تم إلغاء الطلب.'}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-[#111113] dark:text-[#F7F6F3]">{t.tracking.orderTimeline}</h3>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {statusSteps.map((step, idx) => {
                  const isCompleted = idx <= currentStepIndex;
                  const isCurrent = idx === currentStepIndex;

                  return (
                    <div
                      key={step.key}
                      className={`p-3 rounded-2xl border transition-all text-center flex flex-col items-center justify-between gap-2 ${
                        isCurrent
                          ? 'bg-[#FF6B00]/10 border-[#FF6B00] ring-2 ring-[#FF6B00]/20'
                          : isCompleted
                          ? 'bg-emerald-50/60 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30'
                          : 'bg-[#F3F1EC] dark:bg-[#18181D] border-[#E6E2D8] dark:border-[#32323C] opacity-60'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          isCompleted ? 'bg-emerald-600 text-white' : 'bg-[#D6D0C4] dark:bg-[#23232A] text-[#5A5854] dark:text-[#B5B0A8]'
                        }`}
                      >
                        {isCompleted ? '✓' : idx + 1}
                      </div>
                      <span className="text-xs font-bold leading-tight">{step.label}</span>
                    </div>
                  );
                })}
              </div>

              {activeOrder.statusHistory && activeOrder.statusHistory.length > 0 && (
                <div className="bg-[#F3F1EC] dark:bg-[#18181D] p-4 rounded-2xl border border-[#E6E2D8] dark:border-[#32323C] space-y-2 text-xs">
                  <div className="space-y-1.5">
                    {activeOrder.statusHistory.map((sh, i) => (
                      <div key={i} className="flex items-center gap-2 text-[#5A5854] dark:text-[#B5B0A8]">
                        <Clock className="w-3.5 h-3.5 text-[#FF6B00] shrink-0" />
                        <span className="font-mono text-[11px] text-[#7A756D] dark:text-[#8E8980]">
                          {new Date(sh.timestamp).toLocaleTimeString('ar-TN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="font-semibold text-[#111113] dark:text-[#F7F6F3]">
                          {t.orderStatus[sh.status] || sh.status}:
                        </span>
                        <span>{sh.note || 'تم التحديث'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Delivery Info & Itemized Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-[#E6E2D8] dark:border-[#23232A]">
            <div className="space-y-3">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#FF6B00]" />
                <span>{t.tracking.deliveryAddress}</span>
              </h3>
              <div className="p-4 rounded-2xl bg-[#F3F1EC] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#32323C] text-xs space-y-1.5 text-[#5A5854] dark:text-[#B5B0A8]">
                <p><strong>{t.checkout.fullName}:</strong> {activeOrder.customerName}</p>
                <p><strong>{t.checkout.phone}:</strong> <span dir="ltr" className="font-mono">{activeOrder.customerPhone}</span></p>
                <p><strong>{t.checkout.governorate}:</strong> {getGovernorateName(activeOrder.shippingAddress.governorate, language)}</p>
                <p>
                  <strong>{t.checkout.delegation || t.checkout.city}:</strong>{' '}
                  {activeOrder.shippingAddress.delegation || activeOrder.shippingAddress.city || '—'}
                  {activeOrder.shippingAddress.postalCode ? ` (${activeOrder.shippingAddress.postalCode})` : ''}
                </p>
                <p><strong>{t.checkout.street}:</strong> {activeOrder.shippingAddress.street}</p>
                {activeOrder.estimatedDelivery && (
                  <p><strong>{t.tracking.estimatedDelivery}:</strong> {activeOrder.estimatedDelivery}</p>
                )}
                {activeOrder.piiMasked && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold pt-2 mt-2 border-t border-[#E6E2D8] dark:border-[#32323C]">
                    {t.tracking.privacyMaskedNotice}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Package className="w-4 h-4 text-[#FF6B00]" />
                <span>{t.tracking.orderDetails}</span>
              </h3>
              <div className="p-4 rounded-2xl bg-[#F3F1EC] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#32323C] text-xs divide-y divide-[#E6E2D8] dark:divide-[#32323C]">
                {activeOrder.items.map((it, i) => (
                  <div key={i} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <img
                        src={it.productImage || '/assets/images/niapolor-badge.webp'}
                        alt="item"
                        referrerPolicy="no-referrer"
                        onError={handleStoreImageError}
                        className="w-10 h-10 rounded-lg object-cover bg-white dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#32323C] shrink-0"
                      />
                      <div>
                        <p className="font-bold text-[#111113] dark:text-[#F7F6F3]">
                          {typeof it.productName === 'string'
                            ? it.productName
                            : it.productName?.[language] || it.productName?.ar || ''}
                        </p>
                        <p className="text-[#7A756D] dark:text-[#8E8980] text-[11px] font-mono">
                          {it.quantity} × {it.unitPrice.toFixed(3)} {currencyLabel}
                        </p>
                      </div>
                    </div>
                    <span className="font-black text-[#111113] dark:text-[#F7F6F3] tabular-nums font-mono">
                      {it.totalPrice.toFixed(3)} {currencyLabel}
                    </span>
                  </div>
                ))}

                <div className="pt-3 mt-2 space-y-1.5">
                  <div className="flex justify-between font-bold text-sm">
                    <span>{t.tracking.total}</span>
                    <span className="text-[#FF6B00] tabular-nums font-mono">
                      {activeOrder.totalAmount.toFixed(3)} {currencyLabel}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-[#7A756D] dark:text-[#8E8980]">
                    <span>{t.checkout.paymentMethod}:</span>
                    <span className="font-bold text-[#5A5854] dark:text-[#B5B0A8]">
                      {formatPaymentMethodLabel(activeOrder.paymentMethod)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-[#7A756D] dark:text-[#8E8980]">
                    <span>{t.tracking.paymentStatus}</span>
                    <span className="font-bold text-[#5A5854] dark:text-[#B5B0A8]">
                      {(t.payments.statuses as Record<string, string>)[activeOrder.paymentStatus] ||
                        activeOrder.paymentStatus}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : hasSearched ? (
        <div className="p-8 text-center bg-white dark:bg-[#141418] rounded-3xl border border-red-200 dark:border-red-500/30 text-[#5A5854] dark:text-[#B5B0A8] space-y-2">
          <p className="font-bold text-red-600">{searchError || t.tracking.orderNotFound}</p>
          <p className="text-xs text-[#7A756D] dark:text-[#8E8980]">ECH-TN-XXXXXX</p>
        </div>
      ) : null}
    </div>
  );
};
