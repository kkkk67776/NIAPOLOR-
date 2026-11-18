import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import {
  X,
  CheckCircle2,
  CreditCard,
  Banknote,
  Landmark,
  MapPin,
  Copy,
  Check,
  Upload,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Phone,
  User,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { handleStoreImageError } from '../lib/imageFallback';
import {
  TUNISIAN_GOVERNORATES,
  getDelegationsForGovernorate,
  getGovernorateName,
  isValidDelegationForGovernorate,
  isValidGovernorate,
  normalizeTunisianPhone,
} from '../data/governorates';
import { Order, PaymentMethodType } from '../types';
import { getPaymentStatusTone, submitBankTransferProofClient } from '../lib/payments';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type FieldErrorMap = Partial<
  Record<'fullName' | 'phone' | 'governorate' | 'delegation' | 'street' | 'email', string>
>;

export const CheckoutModal: React.FC<CheckoutModalProps> = ({ isOpen, onClose }) => {
  const {
    cart,
    language,
    t,
    cartSubtotal,
    cartShippingFee,
    cartDiscountAmount,
    cartTaxAmount,
    cartTotal,
    paymentConfig,
    refreshPaymentConfig,
    createServerOrder,
    updateOrderInState,
    currentUser,
    setCurrentView,
    isOnline,
    isReconnecting,
    retryConnection,
  } = useStore();

  const [fullName, setFullName] = useState(currentUser?.fullName || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [governorate, setGovernorate] = useState('');
  const [delegation, setDelegation] = useState('');
  const [street, setStreet] = useState('');
  const [notes, setNotes] = useState('');

  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});

  const codEnabled = paymentConfig?.methods?.cod?.enabled ?? true;
  const bankEnabled = paymentConfig?.methods?.bank_transfer?.enabled ?? true;
  const onlineEnabled = Boolean(
    paymentConfig?.methods?.online_payment?.enabled && paymentConfig?.methods?.online_payment?.readyForLive
  );

  const getFirstAvailableMethod = (): PaymentMethodType => {
    if (codEnabled) return 'cod';
    if (bankEnabled) return 'bank_transfer';
    if (onlineEnabled) return 'online_payment';
    return 'cod';
  };

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>(getFirstAvailableMethod);
  const [clientRequestId, setClientRequestId] = useState<string>(
    () => `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [gatewayPayUrl, setGatewayPayUrl] = useState<string | undefined>(undefined);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Proof of transfer fields (used on Bank Transfer confirmation)
  const [proofRef, setProofRef] = useState('');
  const [proofSender, setProofSender] = useState('');
  const [proofDate, setProofDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [proofNotes, setProofNotes] = useState('');
  const [proofImageData, setProofImageData] = useState<string | undefined>(undefined);
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofSuccessMsg, setProofSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      refreshPaymentConfig();
      setErrorMsg('');
      setFieldErrors({});
      if (!completedOrder) {
        setClientRequestId(`chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      }
      if (currentUser) {
        if (!fullName && currentUser.fullName) setFullName(currentUser.fullName);
        if (!phone && currentUser.phone) setPhone(currentUser.phone);
        if (!email && currentUser.email) setEmail(currentUser.email);
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (!completedOrder) {
      setClientRequestId(`chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    }
  }, [cart.length, paymentMethod]);

  useEffect(() => {
    if (paymentMethod === 'cod' && !codEnabled) setPaymentMethod(getFirstAvailableMethod());
    if (paymentMethod === 'bank_transfer' && !bankEnabled) setPaymentMethod(getFirstAvailableMethod());
    if (paymentMethod === 'online_payment' && !onlineEnabled) setPaymentMethod(getFirstAvailableMethod());
  }, [codEnabled, bankEnabled, onlineEnabled]);

  const availableDelegations = useMemo(
    () => (governorate ? getDelegationsForGovernorate(governorate) : []),
    [governorate]
  );

  const selectedGovObj = useMemo(
    () => TUNISIAN_GOVERNORATES.find((g) => g.id === governorate),
    [governorate]
  );

  if (!isOpen) return null;

  const currencyLabel = paymentConfig?.currency || t.cart.currency || 'TND';
  const bankInfo = paymentConfig.methods.bank_transfer;
  const hasAnyMethod = codEnabled || bankEnabled || onlineEnabled;
  const totalItemCount = cart.reduce((s, i) => s + i.quantity, 0);

  const handleGovernorateChange = (nextGovId: string) => {
    setGovernorate(nextGovId);
    // Automatically reset previously selected delegation whenever governorate changes
    setDelegation('');
    setFieldErrors((prev) => ({
      ...prev,
      governorate: undefined,
      delegation: undefined,
    }));
  };

  const handleDelegationChange = (nextDel: string) => {
    setDelegation(nextDel);
    setFieldErrors((prev) => ({ ...prev, delegation: undefined }));
  };

  const applySavedAddress = (addrId: string) => {
    const addr = currentUser?.addresses.find((a) => a.id === addrId);
    if (!addr) return;
    setFullName(addr.fullName || fullName);
    setPhone(addr.phone || phone);
    if (isValidGovernorate(addr.governorate)) {
      setGovernorate(addr.governorate);
      const savedDel = (addr.delegation || addr.city || '').trim();
      setDelegation(isValidDelegationForGovernorate(addr.governorate, savedDel) ? savedDel : '');
    }
    setStreet(addr.street || '');
    if (addr.notes) setNotes(addr.notes);
    setFieldErrors({});
    setErrorMsg('');
  };

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleProofFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.type.includes('svg')) {
      setErrorMsg(
        language === 'ar'
          ? 'يرجى رفع صورة وصل صالحة (PNG / JPG / WEBP فقط).'
          : 'Please upload a valid receipt image (PNG / JPG / WEBP only).'
      );
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setErrorMsg(
        language === 'ar'
          ? 'حجم صورة الإثبات يجب أن لا يتجاوز 3 ميغابايت.'
          : 'Receipt image size must be less than 3 MB.'
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProofImageData(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const validateFields = (): { valid: boolean; normalizedPhone: string } => {
    const nextErrors: FieldErrorMap = {};
    const cleanName = fullName.trim();
    const phoneCheck = normalizeTunisianPhone(phone);
    const cleanStreet = street.trim();
    const cleanEmail = email.trim();

    if (cleanName.length < 2) {
      nextErrors.fullName = t.checkout.invalidNameError;
    }
    if (!phoneCheck.valid) {
      nextErrors.phone = t.checkout.invalidPhoneError;
    }
    if (!isValidGovernorate(governorate)) {
      nextErrors.governorate = t.checkout.invalidGovernorateError;
    }
    if (!isValidDelegationForGovernorate(governorate, delegation)) {
      nextErrors.delegation = t.checkout.invalidDelegationError;
    }
    if (cleanStreet.length < 4) {
      nextErrors.street = t.checkout.invalidStreetError;
    }
    // Email is completely optional — only check syntax when user enters something
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      nextErrors.email = t.checkout.invalidEmailError;
    }

    setFieldErrors(nextErrors);
    return { valid: Object.keys(nextErrors).length === 0, normalizedPhone: phoneCheck.normalized };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!isOnline) {
      setErrorMsg(t.offline.checkoutBlockedDesc);
      return;
    }

    if (!hasAnyMethod) {
      setErrorMsg(t.payments.noMethodsEnabled);
      return;
    }

    const { valid, normalizedPhone } = validateFields();
    if (!valid) {
      setErrorMsg(t.checkout.requiredFieldsAlert);
      return;
    }

    const cleanName = fullName.trim();
    const cleanDelegation = delegation.trim();
    const cleanStreet = street.trim();
    const cleanEmail = email.trim();
    const cleanNotes = notes.trim();

    setIsSubmitting(true);
    const result = await createServerOrder({
      customerName: cleanName,
      customerEmail: cleanEmail || undefined,
      customerPhone: normalizedPhone,
      shippingAddress: {
        id: `addr_${Date.now()}`,
        isDefault: true,
        fullName: cleanName,
        phone: normalizedPhone,
        governorate,
        delegation: cleanDelegation,
        city: cleanDelegation,
        street: cleanStreet,
        notes: cleanNotes || undefined,
      },
      paymentMethod,
      carrierName: 'Aramex Tunisie Logistics',
      notes: cleanNotes || undefined,
      clientRequestId,
    });
    setIsSubmitting(false);

    if (!result.ok || !result.order) {
      setErrorMsg(result.error || 'تعذر تسجيل الطلب على الخادم.');
      return;
    }

    setCompletedOrder(result.order);
    setGatewayPayUrl(result.paymentUrl);
    setProofSender(cleanName);
  };

  const handlePostOrderProofSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completedOrder) return;
    if (!proofRef.trim() || !proofSender.trim()) {
      setErrorMsg(
        language === 'ar'
          ? 'يرجى إدخال رقم العملية البنكية واسم المحوّل.'
          : 'Please enter transaction reference and sender name.'
      );
      return;
    }

    setErrorMsg('');
    setProofSubmitting(true);
    const res = await submitBankTransferProofClient({
      trackingNumber: completedOrder.trackingNumber,
      customerPhone: completedOrder.customerPhone,
      referenceNumber: proofRef.trim(),
      senderName: proofSender.trim(),
      transferDate: proofDate,
      receiptImageDataUrl: proofImageData,
      notes: proofNotes.trim() || undefined,
    });
    setProofSubmitting(false);

    if (!res.ok || !res.order) {
      setErrorMsg(res.error || 'فشل إرسال إثبات التحويل.');
      return;
    }

    setCompletedOrder(res.order);
    updateOrderInState(res.order);
    setProofSuccessMsg(t.payments.proofSubmittedNotice);
  };

  const handleTrackOrderNow = () => {
    setCompletedOrder(null);
    onClose();
    setCurrentView('my_orders');
  };

  const handleCloseModal = () => {
    setCompletedOrder(null);
    setProofSuccessMsg('');
    setErrorMsg('');
    setFieldErrors({});
    onClose();
  };

  const inputBaseClass = (hasErr?: string) =>
    `w-full min-h-[42px] text-xs py-2.5 px-3.5 rounded-xl border transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-[#FF6B00]/30 ${
      hasErr
        ? 'border-red-500 bg-red-50/40 dark:bg-red-950/20 focus:border-red-500'
        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1E293B] focus:border-[#FF6B00]'
    }`;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-5 animate-fadeIn"
      onClick={handleCloseModal}
    >
      <div
        className="bg-white dark:bg-[#0F172A] w-full max-w-4xl rounded-t-3xl sm:rounded-3xl shadow-2xl border border-[#E2E8F0] dark:border-slate-800 overflow-hidden relative max-h-[94vh] flex flex-col text-slate-900 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-4 py-3.5 sm:px-6 sm:py-4 border-b border-[#E2E8F0] dark:border-slate-800 flex items-center justify-between bg-[#F8FAFC] dark:bg-[#1E293B] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#FF6B00]/10 text-[#FF6B00] flex items-center justify-center shrink-0">
              <ShoppingBag className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white truncate">
                {t.checkout.title}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {language === 'ar'
                  ? 'توصيل سريع إلى الـ 24 ولاية التونسية'
                  : language === 'fr'
                  ? 'Livraison rapide dans les 24 gouvernorats de Tunisie'
                  : 'Fast delivery across all 24 Tunisian governorates'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            className="w-10 h-10 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white rounded-full hover:bg-slate-200/60 dark:hover:bg-slate-700 transition-colors cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-4">
          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400 text-xs font-bold flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {completedOrder ? (
            /* Post-Checkout Confirmation View */
            <div className="py-2 space-y-5">
              <div className="text-center space-y-2.5">
                <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-black text-slate-900 dark:text-white">{t.checkout.successTitle}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                  {t.checkout.successMsg}
                </p>
              </div>

              {/* Order Reference, Address & Payment Status Summary */}
              <div className="max-w-xl mx-auto p-4 sm:p-5 rounded-2xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                      {t.checkout.orderNumberIs}
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-lg font-black text-[#FF6B00] font-mono tracking-wider">
                        {completedOrder.trackingNumber}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy('tracking', completedOrder.trackingNumber)}
                        className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs cursor-pointer"
                        title={t.payments.copy}
                      >
                        {copiedKey === 'tracking' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="sm:text-end">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                      {t.tracking.paymentStatus}
                    </span>
                    <span
                      className={`inline-block mt-1 px-2.5 py-1 rounded-lg border text-xs font-bold ${getPaymentStatusTone(
                        completedOrder.paymentStatus
                      )}`}
                    >
                      {(t.payments.statuses as Record<string, string>)[completedOrder.paymentStatus] ||
                        completedOrder.paymentStatus}
                    </span>
                  </div>
                </div>

                {/* Confirmed Shipping Address Summary */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-700 text-xs space-y-1 text-slate-700 dark:text-slate-300">
                  <div className="font-bold text-slate-900 dark:text-white flex items-center justify-between gap-2">
                    <span>{completedOrder.customerName}</span>
                    <span className="font-mono text-[#FF6B00]" dir="ltr">
                      {completedOrder.customerPhone}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400">
                    {getGovernorateName(completedOrder.shippingAddress.governorate, language)}
                    {(completedOrder.shippingAddress.delegation || completedOrder.shippingAddress.city) &&
                      ` · ${completedOrder.shippingAddress.delegation || completedOrder.shippingAddress.city}`}
                    {completedOrder.shippingAddress.street && ` — ${completedOrder.shippingAddress.street}`}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{t.payments.totalAmount}:</span>
                  <strong className="text-base font-black text-slate-900 dark:text-white tabular-nums font-mono">
                    {completedOrder.totalAmount.toFixed(3)} {completedOrder.currency || currencyLabel}
                  </strong>
                </div>

                {completedOrder.paymentReference && (
                  <div className="flex items-center justify-between gap-2 text-xs bg-white dark:bg-[#0F172A] p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-500 dark:text-slate-400">{t.payments.referenceNumber}:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-900 dark:text-white">
                        {completedOrder.paymentReference}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy('ref', completedOrder.paymentReference!)}
                        className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold hover:border-[#FF6B00] cursor-pointer"
                      >
                        {copiedKey === 'ref' ? t.payments.copied : t.payments.copy}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Online Gateway Redirect Box */}
              {completedOrder.paymentMethod === 'online_payment' && gatewayPayUrl && gatewayPayUrl.startsWith('https://') && (
                <div className="max-w-xl mx-auto p-4 rounded-2xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 space-y-3 text-center">
                  <p className="text-xs font-bold text-blue-900 dark:text-blue-200">
                    {language === 'ar'
                      ? 'تم تجهيز جلسة الدفع المؤمّنة. اضغط للمتابعة لإتمام السداد وسيتم إرجاعك تلقائياً لتأكيد الطلب.'
                      : language === 'fr'
                      ? 'Session de paiement sécurisée prête. Cliquez pour finaliser le paiement puis revenir automatiquement.'
                      : 'Secure online payment session created. Proceed to complete payment and return automatically.'}
                  </p>
                  <a
                    href={gatewayPayUrl}
                    target={typeof window !== 'undefined' && window.self !== window.top ? '_blank' : '_self'}
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-bold"
                  >
                    <span>
                      {language === 'ar'
                        ? 'الانتقال لبوابة الدفع المؤمّنة'
                        : language === 'fr'
                        ? 'Payer en ligne maintenant'
                        : 'Continue to Payment Gateway'}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {/* Bank Transfer Instructions & Proof Upload on Confirmation */}
              {completedOrder.paymentMethod === 'bank_transfer' && (
                <div className="max-w-xl mx-auto space-y-4">
                  <div className="p-5 rounded-2xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-black text-slate-900 dark:text-white">
                      <Landmark className="w-4 h-4 text-[#FF6B00]" />
                      <span>{t.payments.bankDetailsTitle}</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                      <div className="p-2.5 rounded-xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-700">
                        <span className="text-[10px] text-slate-400 block">{t.payments.beneficiary}</span>
                        <span className="font-bold text-slate-900 dark:text-white">{bankInfo.accountHolder}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-700">
                        <span className="text-[10px] text-slate-400 block">{t.payments.bankName}</span>
                        <span className="font-bold text-slate-900 dark:text-white">{bankInfo.bankName}</span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <span className="text-[10px] text-slate-400 block">{t.payments.accountOrIban}</span>
                        <span className="font-mono font-bold text-slate-900 dark:text-white break-all" dir="ltr">
                          {bankInfo.ibanOrRib}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy('iban', bankInfo.ibanOrRib)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold hover:border-[#FF6B00] shrink-0 cursor-pointer"
                      >
                        {copiedKey === 'iban' ? t.payments.copied : t.payments.copy}
                      </button>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 block">{t.payments.totalAmount}</span>
                        <span className="font-mono font-black text-[#FF6B00] tabular-nums">
                          {completedOrder.totalAmount.toFixed(3)} {currencyLabel}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy('amt', completedOrder.totalAmount.toFixed(3))}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold hover:border-[#FF6B00] shrink-0 cursor-pointer"
                      >
                        {copiedKey === 'amt' ? t.payments.copied : t.payments.copy}
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed bg-amber-500/5 border border-amber-500/20 rounded-xl p-2.5">
                      {bankInfo.instructions?.[language] || bankInfo.instructions?.ar}
                    </p>
                  </div>

                  {/* Submit Transfer Proof Form */}
                  {proofSuccessMsg ? (
                    <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{proofSuccessMsg}</span>
                    </div>
                  ) : (
                    <form
                      onSubmit={handlePostOrderProofSubmit}
                      className="p-5 rounded-2xl bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 space-y-3"
                    >
                      <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-2">
                        <Upload className="w-4 h-4 text-[#FF6B00]" />
                        <span>{t.payments.uploadProofTitle}</span>
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="text"
                          required
                          value={proofRef}
                          onChange={(e) => setProofRef(e.target.value)}
                          placeholder={t.payments.proofRefPlaceholder}
                          className="w-full text-xs py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent font-mono outline-hidden focus:border-[#FF6B00]"
                        />
                        <input
                          type="text"
                          required
                          value={proofSender}
                          onChange={(e) => setProofSender(e.target.value)}
                          placeholder={t.payments.proofSenderPlaceholder}
                          className="w-full text-xs py-2.5 px-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent outline-hidden focus:border-[#FF6B00]"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-1">{t.payments.proofDateLabel}</label>
                          <input
                            type="date"
                            value={proofDate}
                            onChange={(e) => setProofDate(e.target.value)}
                            className="w-full text-xs py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent outline-hidden focus:border-[#FF6B00]"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-1">{t.payments.proofImageLabel}</label>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleProofFileChange}
                            className="w-full text-[11px] text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-bold"
                          />
                        </div>
                      </div>
                      <input
                        type="text"
                        value={proofNotes}
                        onChange={(e) => setProofNotes(e.target.value)}
                        placeholder={t.checkout.notes}
                        className="w-full text-xs py-2 px-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent outline-hidden focus:border-[#FF6B00]"
                      />
                      {!isOnline && (
                        <p className="text-[11px] font-bold text-[#FF6B00]">{t.offline.serverActionDisabled}</p>
                      )}
                      <button
                        type="submit"
                        disabled={proofSubmitting || !isOnline}
                        className="w-full py-2.5 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {proofSubmitting ? t.checkout.submitting : t.payments.submitProofBtn}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Bottom Actions */}
              <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleTrackOrderNow}
                  className="px-6 py-3 rounded-xl bg-[#0B0F17] dark:bg-[#FF6B00] hover:bg-[#FF6B00] text-white font-bold text-sm transition-colors cursor-pointer"
                >
                  {t.checkout.trackOrderBtn}
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-sm transition-colors cursor-pointer"
                >
                  {t.checkout.continueShopping}
                </button>
              </div>
            </div>
          ) : (
            /* Simplified & Responsive Checkout Form + Order Summary */
            <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left / Main Column: Shipping Fields & Payment Method */}
              <div className="lg:col-span-7 space-y-5">
                {/* Saved Addresses Quick Picker for Logged-In Buyers */}
                {currentUser && currentUser.addresses.length > 0 && (
                  <div className="p-3 rounded-2xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 space-y-2">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block">
                      {language === 'ar'
                        ? 'اختر من عناوينك المحفوظة (اختياري):'
                        : language === 'fr'
                        ? 'Utiliser une adresse enregistrée (optionnel) :'
                        : 'Use a saved address (optional):'}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {currentUser.addresses.map((addr) => (
                        <button
                          key={addr.id}
                          type="button"
                          onClick={() => applySavedAddress(addr.id)}
                          className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#0F172A] hover:border-[#FF6B00] text-[11px] font-bold text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
                        >
                          {getGovernorateName(addr.governorate, language)} · {addr.delegation || addr.city}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 1: Recipient & Tunisian Address (Exact 5 Mandatory Fields + Optional Email) */}
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-[#FF6B00]" />
                      <span>{t.checkout.step1}</span>
                    </h3>
                    {selectedGovObj && (
                      <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <Truck className="w-3.5 h-3.5" />
                        <span>{selectedGovObj.deliveryEstimateDays}</span>
                      </span>
                    )}
                  </div>

                  {/* 1. Full Name & 2. Tunisian Phone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label htmlFor="chk-fullname" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        {t.checkout.fullName} <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <User className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                        <input
                          id="chk-fullname"
                          type="text"
                          autoComplete="name"
                          required
                          value={fullName}
                          onChange={(e) => {
                            setFullName(e.target.value);
                            if (fieldErrors.fullName) setFieldErrors((p) => ({ ...p, fullName: undefined }));
                          }}
                          placeholder={t.checkout.fullNamePlaceholder}
                          className={`${inputBaseClass(fieldErrors.fullName)} ps-9`}
                        />
                      </div>
                      {fieldErrors.fullName && (
                        <p className="text-[11px] text-red-600 dark:text-red-400 font-semibold mt-1">{fieldErrors.fullName}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="chk-phone" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        {t.checkout.phone} <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Phone className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                        <input
                          id="chk-phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          required
                          value={phone}
                          onChange={(e) => {
                            setPhone(e.target.value);
                            if (fieldErrors.phone) setFieldErrors((p) => ({ ...p, phone: undefined }));
                          }}
                          placeholder={t.checkout.phonePlaceholder}
                          dir="ltr"
                          className={`${inputBaseClass(fieldErrors.phone)} ps-9 font-mono`}
                        />
                      </div>
                      {fieldErrors.phone && (
                        <p className="text-[11px] text-red-600 dark:text-red-400 font-semibold mt-1">{fieldErrors.phone}</p>
                      )}
                    </div>
                  </div>

                  {/* 3. Governorate & 4. Dependent Delegation (No Postal Code Field) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label htmlFor="chk-governorate" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        {t.checkout.governorate} <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="chk-governorate"
                        required
                        value={governorate}
                        onChange={(e) => handleGovernorateChange(e.target.value)}
                        className={inputBaseClass(fieldErrors.governorate)}
                      >
                        <option value="">{t.checkout.selectGovernorate}</option>
                        {TUNISIAN_GOVERNORATES.map((gov) => (
                          <option key={gov.id} value={gov.id}>
                            {language === 'fr' ? gov.nameFr : language === 'en' ? gov.nameEn : gov.nameAr}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.governorate && (
                        <p className="text-[11px] text-red-600 dark:text-red-400 font-semibold mt-1">{fieldErrors.governorate}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="chk-delegation" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        {t.checkout.delegation} <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="chk-delegation"
                        required
                        disabled={!governorate}
                        value={delegation}
                        onChange={(e) => handleDelegationChange(e.target.value)}
                        className={`${inputBaseClass(fieldErrors.delegation)} disabled:opacity-55 disabled:cursor-not-allowed`}
                      >
                        <option value="">
                          {governorate ? t.checkout.selectDelegation : t.checkout.selectGovernorateFirst}
                        </option>
                        {availableDelegations.map((del) => (
                          <option key={del} value={del}>
                            {del}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.delegation && (
                        <p className="text-[11px] text-red-600 dark:text-red-400 font-semibold mt-1">{fieldErrors.delegation}</p>
                      )}
                    </div>
                  </div>

                  {/* 5. Detailed Address */}
                  <div>
                    <label htmlFor="chk-street" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {t.checkout.street} <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="chk-street"
                      type="text"
                      autoComplete="street-address"
                      required
                      value={street}
                      onChange={(e) => {
                        setStreet(e.target.value);
                        if (fieldErrors.street) setFieldErrors((p) => ({ ...p, street: undefined }));
                      }}
                      placeholder={t.checkout.streetPlaceholder}
                      className={inputBaseClass(fieldErrors.street)}
                    />
                    {fieldErrors.street && (
                      <p className="text-[11px] text-red-600 dark:text-red-400 font-semibold mt-1">{fieldErrors.street}</p>
                    )}
                  </div>

                  {/* Optional Email & Optional Delivery Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label htmlFor="chk-email" className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        <span>{t.checkout.email}</span>
                        <span className="text-[10px] font-semibold text-slate-400">
                          {t.checkout.emailOptionalTag}
                        </span>
                      </label>
                      <input
                        id="chk-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
                        }}
                        placeholder={t.checkout.emailPlaceholder}
                        dir="ltr"
                        className={`${inputBaseClass(fieldErrors.email)} font-mono`}
                      />
                      {fieldErrors.email && (
                        <p className="text-[11px] text-red-600 dark:text-red-400 font-semibold mt-1">{fieldErrors.email}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="chk-notes" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        {t.checkout.notes}
                      </label>
                      <input
                        id="chk-notes"
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={t.checkout.notesPlaceholder}
                        className={inputBaseClass()}
                      />
                    </div>
                  </div>
                </div>

                {/* Step 2: Payment Methods */}
                <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-[#FF6B00]" />
                    <span>{t.checkout.paymentMethod}</span>
                  </h3>

                  {!hasAnyMethod ? (
                    <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-xs font-bold text-red-700">
                      {t.payments.noMethodsEnabled}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {codEnabled && (
                        <label
                          className={`p-3.5 rounded-2xl border cursor-pointer flex flex-col justify-between transition-all ${
                            paymentMethod === 'cod'
                              ? 'border-[#FF6B00] bg-[#FF6B00]/5 ring-2 ring-[#FF6B00]/15'
                              : 'border-[#E2E8F0] dark:border-slate-700 hover:border-slate-400'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <Banknote className="w-5 h-5 text-emerald-600" />
                            <input
                              type="radio"
                              name="paymentMethod"
                              checked={paymentMethod === 'cod'}
                              onChange={() => setPaymentMethod('cod')}
                              className="accent-[#FF6B00]"
                            />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900 dark:text-white">{t.payments.codLabel}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                              {t.payments.codDesc}
                            </p>
                          </div>
                        </label>
                      )}

                      {bankEnabled && (
                        <label
                          className={`p-3.5 rounded-2xl border cursor-pointer flex flex-col justify-between transition-all ${
                            paymentMethod === 'bank_transfer'
                              ? 'border-[#FF6B00] bg-[#FF6B00]/5 ring-2 ring-[#FF6B00]/15'
                              : 'border-[#E2E8F0] dark:border-slate-700 hover:border-slate-400'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <Landmark className="w-5 h-5 text-amber-600" />
                            <input
                              type="radio"
                              name="paymentMethod"
                              checked={paymentMethod === 'bank_transfer'}
                              onChange={() => setPaymentMethod('bank_transfer')}
                              className="accent-[#FF6B00]"
                            />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900 dark:text-white">{t.payments.bankTransferLabel}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                              {t.payments.bankTransferDesc}
                            </p>
                          </div>
                        </label>
                      )}

                      {onlineEnabled && (
                        <label
                          className={`p-3.5 rounded-2xl border cursor-pointer flex flex-col justify-between transition-all ${
                            paymentMethod === 'online_payment'
                              ? 'border-[#FF6B00] bg-[#FF6B00]/5 ring-2 ring-[#FF6B00]/15'
                              : 'border-[#E2E8F0] dark:border-slate-700 hover:border-slate-400'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <CreditCard className="w-5 h-5 text-blue-600" />
                            <input
                              type="radio"
                              name="paymentMethod"
                              checked={paymentMethod === 'online_payment'}
                              onChange={() => setPaymentMethod('online_payment')}
                              className="accent-[#FF6B00]"
                            />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900 dark:text-white">{t.payments.onlinePaymentLabel}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                              {t.payments.onlinePaymentDesc} ({paymentConfig.methods.online_payment.provider.toUpperCase()})
                            </p>
                          </div>
                        </label>
                      )}
                    </div>
                  )}

                  {/* Bank Transfer Info Preview when Bank Transfer is Selected */}
                  {paymentMethod === 'bank_transfer' && bankEnabled && (
                    <div className="p-3.5 rounded-2xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 space-y-2 text-xs">
                      <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                        <Landmark className="w-4 h-4 text-[#FF6B00]" />
                        <span>{t.payments.bankDetailsTitle}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-400">{t.payments.beneficiary}: </span>
                          <strong className="text-slate-800 dark:text-slate-200">{bankInfo.accountHolder}</strong>
                        </div>
                        <div>
                          <span className="text-slate-400">{t.payments.bankName}: </span>
                          <strong className="text-slate-800 dark:text-slate-200">{bankInfo.bankName}</strong>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 bg-white dark:bg-[#0F172A] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700">
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px]" dir="ltr">
                          {bankInfo.ibanOrRib}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy('pre_iban', bankInfo.ibanOrRib)}
                          className="text-[11px] font-bold text-[#FF6B00] hover:underline cursor-pointer shrink-0"
                        >
                          {copiedKey === 'pre_iban' ? t.payments.copied : t.payments.copy}
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        {bankInfo.instructions?.[language] || bankInfo.instructions?.ar}
                      </p>
                    </div>
                  )}

                  <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 pt-0.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{t.checkout.securePaymentNote}</span>
                  </p>
                </div>
              </div>

              {/* Right Column (Sticky on Desktop): Complete Order Summary & Confirm Button */}
              <div className="lg:col-span-5 lg:sticky lg:top-0">
                <div className="p-4 sm:p-5 rounded-2xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2.5">
                    <h4 className="text-sm font-black text-slate-900 dark:text-white">
                      {t.payments.orderSummary}
                    </h4>
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                      ({totalItemCount})
                    </span>
                  </div>

                  {/* Selected Items, Quantities & Line Prices */}
                  <div className="max-h-52 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700 pr-1">
                    {cart.map((item) => (
                      <div key={item.product.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={item.product.images[0] || '/assets/images/echox-logo.webp'}
                            alt={item.product.name[language] || item.product.name.ar}
                            referrerPolicy="no-referrer"
                            onError={handleStoreImageError}
                            className="w-11 h-11 rounded-xl object-cover bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {item.product.name[language] || item.product.name.ar}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {item.quantity} × {item.product.price.toFixed(3)} {currencyLabel}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs font-black text-slate-900 dark:text-white font-mono tabular-nums shrink-0">
                          {(item.product.price * item.quantity).toFixed(3)} {currencyLabel}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Financial Breakdown */}
                  <div className="space-y-2 text-xs border-t border-b border-slate-200 dark:border-slate-700 py-3">
                    <div className="flex justify-between text-slate-600 dark:text-slate-300">
                      <span>{t.payments.subtotal}</span>
                      <span className="font-mono tabular-nums font-bold">
                        {cartSubtotal.toFixed(3)} {currencyLabel}
                      </span>
                    </div>
                    {cartDiscountAmount > 0 && (
                      <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                        <span>{t.payments.discount}</span>
                        <span className="font-mono tabular-nums font-bold">
                          -{cartDiscountAmount.toFixed(3)} {currencyLabel}
                        </span>
                      </div>
                    )}
                    {cartTaxAmount > 0 && (
                      <div className="flex justify-between text-slate-600 dark:text-slate-300">
                        <span>
                          {t.payments.tax} ({paymentConfig.taxRatePercent}%)
                        </span>
                        <span className="font-mono tabular-nums font-bold">
                          {cartTaxAmount.toFixed(3)} {currencyLabel}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-600 dark:text-slate-300">
                      <span>{t.payments.shipping}</span>
                      <span
                        className={`font-mono tabular-nums font-bold ${
                          cartShippingFee === 0 ? 'text-emerald-600 dark:text-emerald-400' : ''
                        }`}
                      >
                        {cartShippingFee === 0
                          ? t.cart.freeShipping
                          : `${cartShippingFee.toFixed(3)} ${currencyLabel}`}
                      </span>
                    </div>
                  </div>

                  {/* Final Total + Confirm Button */}
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                        {t.payments.totalAmount}
                      </span>
                      <span className="text-2xl font-black text-[#FF6B00] tabular-nums font-mono">
                        {cartTotal.toFixed(3)} {currencyLabel}
                      </span>
                    </div>

                    {!isOnline && (
                      <div className="p-3 rounded-xl bg-[#FF6B00]/10 border border-[#FF6B00]/25 text-xs space-y-2">
                        <p className="font-black text-[#FF6B00] flex items-center gap-1.5">
                          <WifiOff className="w-3.5 h-3.5 shrink-0" />
                          <span>{t.offline.checkoutBlockedTitle}</span>
                        </p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                          {t.offline.checkoutBlockedDesc}
                        </p>
                        <button
                          type="button"
                          disabled={isReconnecting}
                          onClick={() => {
                            void retryConnection();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#FF6B00] hover:bg-[#E05E00] text-white text-[11px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                        >
                          <RefreshCw className={`w-3 h-3 ${isReconnecting ? 'animate-spin' : ''}`} />
                          <span>{isReconnecting ? t.offline.retryingBtn : t.offline.retryBtn}</span>
                        </button>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting || cart.length === 0 || !hasAnyMethod || !isOnline}
                      className="w-full min-h-[46px] py-3 px-6 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white font-black text-sm shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-[0.99]"
                    >
                      <span>{isSubmitting ? t.checkout.submitting : t.checkout.confirmOrder}</span>
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
