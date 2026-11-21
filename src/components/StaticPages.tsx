import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  ShieldCheck, 
  Award, 
  RefreshCw, 
  Headphones, 
  Building2, 
  Phone, 
  Mail, 
  MapPin, 
  Send, 
  CheckCircle2,
  BarChart3,
  X,
  Loader2
} from 'lucide-react';
import { getGovernorateName } from '../data/governorates';
import {
  fetchScopedVendorFinancials,
  getPaymentStatusTone,
  ScopedVendorFinancialsResponse
} from '../lib/payments';
import { isOwnerUnlocked } from '../lib/security';
import { handleStoreImageError } from '../lib/imageFallback';

// 1. The Promise Page (الوعد)
export const PromiseView: React.FC = () => {
  const { language, t, siteSettings, setCurrentView } = useStore();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-12 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      <div className="text-center space-y-4">
        <span className="text-xs font-black uppercase tracking-widest text-[#FF6B00] bg-[#FF6B00]/10 px-3.5 py-1.5 rounded-full">
          {t.staticExtras.promiseBadge}
        </span>
        <h1 className="text-3xl sm:text-4xl font-black text-[#111113] dark:text-[#F7F6F3]">
          {t.promisePage.title}
        </h1>
        <p className="text-base text-[#5A5854] dark:text-[#B5B0A8] max-w-2xl mx-auto leading-relaxed">
          {t.promisePage.subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#141418] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-xs space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <Award className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-[#111113] dark:text-[#F7F6F3]">{t.promisePage.point1Title}</h3>
          <p className="text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{t.promisePage.point1Desc}</p>
        </div>

        <div className="bg-white dark:bg-[#141418] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-xs space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-[#111113] dark:text-[#F7F6F3]">{t.promisePage.point2Title}</h3>
          <p className="text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{t.promisePage.point2Desc}</p>
        </div>

        <div className="bg-white dark:bg-[#141418] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-xs space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <RefreshCw className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-[#111113] dark:text-[#F7F6F3]">{t.promisePage.point3Title}</h3>
          <p className="text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{t.promisePage.point3Desc}</p>
        </div>

        <div className="bg-white dark:bg-[#141418] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-xs space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <Headphones className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-[#111113] dark:text-[#F7F6F3]">{t.promisePage.point4Title}</h3>
          <p className="text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">{t.promisePage.point4Desc}</p>
        </div>
      </div>

      <div className="bg-[#0B0B0D] dark:bg-[#141418] border border-[#23232A] rounded-3xl p-8 text-center text-white space-y-4">
        <h2 className="text-xl sm:text-2xl font-black">{t.staticExtras.promiseCtaTitle}</h2>
        <p className="text-xs sm:text-sm text-[#B5B0A8] max-w-lg mx-auto">
          {t.staticExtras.promiseCtaDesc}
        </p>
        <button
          onClick={() => {
            setCurrentView('store');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="px-6 py-3 bg-[#FF6B00] hover:bg-[#e05e00] text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer"
        >
          {t.staticExtras.promiseCtaBtn}
        </button>
      </div>
    </div>
  );
};

// 2. Partner Companies Page (الشركات)
export const CompaniesView: React.FC = () => {
  const { companies, products, language, t, setSelectedProductId, isOnline } = useStore();
  const [selectedVendorName, setSelectedVendorName] = useState<string>('');
  const [vendorFinancials, setVendorFinancials] = useState<ScopedVendorFinancialsResponse | null>(null);
  const [loadingVendor, setLoadingVendor] = useState(false);
  const [vendorError, setVendorError] = useState<string | null>(null);

  const openVendorLedger = async (vendorId: string, vendorName: string) => {
    setSelectedVendorName(vendorName);
    setVendorFinancials(null);
    setVendorError(null);
    if (!isOnline) {
      setVendorError(t.offline.serverActionDisabled);
      return;
    }
    setLoadingVendor(true);
    try {
      const data = await fetchScopedVendorFinancials(vendorId);
      setVendorFinancials(data);
    } catch (err: any) {
      setVendorError(err?.message || 'تعذر تحميل السجل المالي للبائع.');
    } finally {
      setLoadingVendor(false);
    }
  };

  const closeVendorLedger = () => {
    setVendorFinancials(null);
    setSelectedVendorName('');
    setVendorError(null);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 space-y-10 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      <div className="text-center space-y-3">
        <h1 className="text-2xl sm:text-3xl font-black text-[#111113] dark:text-[#F7F6F3]">
          {t.companiesPage.title}
        </h1>
        <p className="text-sm text-[#5A5854] dark:text-[#B5B0A8] max-w-2xl mx-auto">
          {t.companiesPage.subtitle}
        </p>
      </div>

      <div className="space-y-8">
        {companies.map(comp => {
          const compProducts = products.filter(p => p.companyId === comp.id);
          return (
            <div key={comp.id} className="bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] p-6 sm:p-8 space-y-6 shadow-xs">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#E6E2D8] dark:border-[#23232A] pb-5">
                <div className="flex items-center gap-4">
                  <img 
                    src={comp.logo || '/assets/images/niapolor-badge.webp'} 
                    alt={comp.name}
                    referrerPolicy="no-referrer"
                    onError={handleStoreImageError}
                    className="w-16 h-16 rounded-2xl object-contain bg-[#FAF9F7] dark:bg-[#18181D] p-1.5 border border-[#E6E2D8] dark:border-[#23232A]" 
                  />
                  <div>
                    <h2 className="text-lg font-black text-[#111113] dark:text-[#F7F6F3]">{comp.name}</h2>
                    <p className="text-xs text-[#7A756D] dark:text-[#8E8980] flex items-center gap-2 mt-0.5">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-[#FF6B00]" />
                        <span>{comp.address} ({getGovernorateName(comp.governorate, language)})</span>
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {isOwnerUnlocked() && (
                    <button
                      type="button"
                      onClick={() => openVendorLedger(comp.id, comp.name)}
                      className="px-3.5 py-2 rounded-xl bg-[#FF6B00]/10 hover:bg-[#FF6B00]/20 text-[#FF6B00] font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      <span>
                        {language === 'ar'
                          ? 'السجل المالي للبائع'
                          : language === 'fr'
                          ? 'Relevé financier vendeur'
                          : 'Vendor Financials'}
                      </span>
                    </button>
                  )}
                  <a 
                    href={`tel:${comp.phone}`} 
                    className="px-3.5 py-2 rounded-xl bg-[#F3F1EC] dark:bg-[#18181D] hover:bg-[#EBE7DF] dark:hover:bg-[#1C1C22] border border-[#E6E2D8] dark:border-[#23232A] text-[#111113] dark:text-[#F7F6F3] font-bold flex items-center gap-1.5"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span dir="ltr">{comp.phone}</span>
                  </a>
                </div>
              </div>

              <p className="text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
                {comp.description[language]}
              </p>

              {/* Company Products */}
              {compProducts.length > 0 && (
                <div className="space-y-3 pt-2">
                  <h3 className="text-xs font-bold text-[#7A756D] dark:text-[#8E8980] uppercase tracking-wider">
                    {t.staticExtras.companyProductsPrefix} {comp.name}:
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {compProducts.map(p => (
                      <div 
                        key={p.id}
                        onClick={() => setSelectedProductId(p.id)}
                        className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] hover:border-[#FF6B00] cursor-pointer flex items-center gap-3 transition-all"
                      >
                        <img 
                          src={p.images[0] || '/assets/images/niapolor-badge.webp'} 
                          alt={p.name[language] || 'product'} 
                          referrerPolicy="no-referrer"
                          onError={handleStoreImageError}
                          className="w-12 h-12 rounded-xl object-cover bg-white shrink-0" 
                        />
                        <div className="overflow-hidden">
                          <p className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] truncate">{p.name[language]}</p>
                          <p className="text-xs font-black text-[#FF6B00] tabular-nums">{p.price.toFixed(3)} {t.cart.currency}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Scoped Vendor Financial Ledger Modal (Strictly Isolated per vendorId) */}
      {(loadingVendor || vendorFinancials || vendorError) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fadeIn"
          onClick={closeVendorLedger}
        >
          <div
            className="w-full max-w-2xl bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-2xl overflow-hidden max-h-[88vh] flex flex-col text-[#111113] dark:text-[#F7F6F3]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-5 bg-[#0B0B0D] text-white flex items-center justify-between border-b border-[#23232A]">
              <div className="flex items-center gap-2.5">
                <BarChart3 className="w-5 h-5 text-[#FF6B00]" />
                <div>
                  <h3 className="text-sm font-black">{selectedVendorName}</h3>
                  <p className="text-[11px] text-[#B5B0A8]">
                    {language === 'ar'
                      ? 'سجل مالي معزول الخاص بمنتجات هذا البائع فقط'
                      : language === 'fr'
                      ? 'Journal financier strictement isolé pour ce vendeur'
                      : 'Strictly isolated financial ledger for this vendor only'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeVendorLedger}
                className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
              {loadingVendor ? (
                <div className="py-10 flex flex-col items-center gap-2 text-xs text-[#7A756D] dark:text-[#8E8980]">
                  <Loader2 className="w-6 h-6 animate-spin text-[#FF6B00]" />
                  <span>جارٍ جلب البيانات المالية الخاصة بالبائع...</span>
                </div>
              ) : vendorError ? (
                <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs text-red-600 font-bold">
                  {vendorError}
                </div>
              ) : vendorFinancials ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A]">
                      <span className="text-[10px] text-[#7A756D] dark:text-[#8E8980] block">إجمالي المبيعات</span>
                      <strong className="text-sm font-black font-mono tabular-nums">
                        {vendorFinancials.grossTotal.toFixed(3)} {vendorFinancials.currency}
                      </strong>
                    </div>
                    <div className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A]">
                      <span className="text-[10px] text-[#7A756D] dark:text-[#8E8980] block">عمولة المنصة المقتطعة</span>
                      <strong className="text-sm font-black text-[#FF6B00] font-mono tabular-nums">
                        {vendorFinancials.commissionTotal.toFixed(3)} {vendorFinancials.currency}
                      </strong>
                    </div>
                    <div className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A]">
                      <span className="text-[10px] text-[#7A756D] dark:text-[#8E8980] block">رصيد معلق (قبل تأكيد الدفع)</span>
                      <strong className="text-sm font-black text-amber-600 font-mono tabular-nums">
                        {vendorFinancials.netPending.toFixed(3)} {vendorFinancials.currency}
                      </strong>
                    </div>
                    <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                      <span className="text-[10px] text-emerald-700 dark:text-emerald-300 block">صافي مؤهل للصرف</span>
                      <strong className="text-sm font-black text-emerald-700 dark:text-emerald-300 font-mono tabular-nums">
                        {vendorFinancials.netEligible.toFixed(3)} {vendorFinancials.currency}
                      </strong>
                    </div>
                    <div className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] sm:col-span-2">
                      <span className="text-[10px] text-[#7A756D] dark:text-[#8E8980] block">تمت تسويته وصرفه</span>
                      <strong className="text-sm font-black text-blue-600 dark:text-blue-400 font-mono tabular-nums">
                        {vendorFinancials.netSettled.toFixed(3)} {vendorFinancials.currency}
                      </strong>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-black text-[#5A5854] dark:text-[#B5B0A8]">
                      الطلبات الفرعية الخاصة بهذا البائع ({vendorFinancials.subOrders.length})
                    </h4>
                    {vendorFinancials.subOrders.length === 0 ? (
                      <div className="p-6 text-center rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] text-xs text-[#7A756D] dark:text-[#8E8980]">
                        لا توجد طلبات فرعية مسجلة لهذا البائع حتى الآن.
                      </div>
                    ) : (
                      vendorFinancials.subOrders.map((sub) => (
                        <div
                          key={sub.subOrderId}
                          className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-[#FF6B00]">{sub.trackingNumber}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getPaymentStatusTone(sub.orderPaymentStatus)}`}>
                                {(t.payments.statuses as Record<string, string>)[sub.orderPaymentStatus] || sub.orderPaymentStatus}
                              </span>
                            </div>
                            <span className="text-[11px] text-[#7A756D] dark:text-[#8E8980]">
                              {sub.items.length} منتجات • الوسيلة: {sub.paymentMethod}
                            </span>
                          </div>
                          <div className="text-end font-mono tabular-nums">
                            <div className="font-black">{sub.netVendorAmount.toFixed(3)} {vendorFinancials.currency} صافي</div>
                            <div className="text-[10px] text-[#7A756D] dark:text-[#8E8980]">
                              الإجمالي {sub.grossAmount.toFixed(3)} • العمولة {sub.commissionAmount.toFixed(3)}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 3. Contact Us Page (اتصل بنا)
export const ContactView: React.FC = () => {
  const { siteSettings, sendInquiry, language, t, isOnline } = useStore();
  const [senderName, setSenderName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sentSuccess, setSentSuccess] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendError('');
    if (!isOnline) {
      setSendError(t.offline.serverActionDisabled);
      return;
    }
    if (!senderName || !phone || !message) return;

    setSending(true);
    const res = await sendInquiry({
      senderName,
      phone,
      email: email || 'contact@client.tn',
      subject: subject || 'استفسار عام',
      message
    });
    setSending(false);

    if (!res.ok) {
      setSendError(res.error || 'تعذر إرسال الرسالة حالياً.');
      return;
    }

    setSentSuccess(true);
    setSenderName('');
    setPhone('');
    setEmail('');
    setSubject('');
    setMessage('');
    setTimeout(() => setSentSuccess(false), 5000);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-8 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      <div className="text-center space-y-3">
        <h1 className="text-2xl sm:text-3xl font-black text-[#111113] dark:text-[#F7F6F3]">
          {t.contactModal.title}
        </h1>
        <p className="text-sm text-[#5A5854] dark:text-[#B5B0A8] max-w-lg mx-auto">
          {t.contactModal.subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Quick Contacts Box */}
        <div className="md:col-span-1 bg-white dark:bg-[#141418] p-6 rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-xs space-y-6">
          <div>
            <h3 className="text-sm font-bold text-[#111113] dark:text-[#F7F6F3] mb-3">{t.staticExtras.contactChannelsTitle}</h3>
            <div className="space-y-4 text-xs">
              <a
                href={`tel:${siteSettings.supportPhone}`}
                className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] hover:bg-[#FF6B00]/10 flex items-center gap-3 transition-colors border border-[#E6E2D8] dark:border-[#23232A]"
              >
                <div className="w-8 h-8 rounded-full bg-[#FF6B00] text-white flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] text-[#7A756D] dark:text-[#8E8980] block">{t.staticExtras.phoneShortLabel}</span>
                  <span className="font-bold text-[#111113] dark:text-[#F7F6F3] font-mono" dir="ltr">{siteSettings.supportPhone}</span>
                </div>
              </a>

              <a
                href={`https://wa.me/${siteSettings.whatsappPhone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
                aria-label="WhatsApp"
                className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 flex items-center gap-3 transition-colors border border-emerald-200 dark:border-emerald-800/50"
              >
                <div className="w-8 h-8 rounded-full bg-[#25D366] text-white flex items-center justify-center shrink-0">
                  <svg
                    viewBox="0 0 32 32"
                    className="w-4 h-4 fill-current"
                    aria-hidden="true"
                  >
                    <path d="M16.004 2.667C8.64 2.667 2.667 8.64 2.667 16c0 2.352.616 4.648 1.787 6.672L2.667 29.333l6.832-1.792A13.28 13.28 0 0 0 16.004 29.333C23.368 29.333 29.333 23.36 29.333 16S23.368 2.667 16.004 2.667zm7.768 18.88c-.325.917-1.912 1.749-2.648 1.856-.672.101-1.525.144-2.464-.155-.568-.181-1.296-.421-2.224-.821-3.912-1.688-6.464-5.637-6.659-5.899-.195-.261-1.589-2.115-1.589-4.035 0-1.92 1.005-2.864 1.363-3.253.357-.389.779-.485 1.037-.485.261 0 .52.003.747.013.24.011.563-.091.88.672.325.784 1.107 2.704 1.203 2.901.096.197.16.427.032.688-.128.261-.192.427-.389.656-.197.229-.413.512-.589.688-.197.197-.403.411-.173.805.229.395 1.021 1.685 2.192 2.731 1.507 1.344 2.779 1.76 3.173 1.957.395.197.624.165.853-.099.229-.261.989-1.155 1.253-1.552.261-.395.523-.328.88-.197.357.131 2.277 1.075 2.667 1.269.389.197.651.293.747.456.096.165.096.949-.229 1.867z" />
                  </svg>
                </div>
                <div>
                  <span className="text-[11px] text-emerald-800 dark:text-emerald-400 block">{t.staticExtras.directContactShortLabel}</span>
                  <span className="font-bold text-emerald-950 dark:text-emerald-300 font-mono" dir="ltr">+{siteSettings.whatsappPhone.replace(/\D/g, '')}</span>
                </div>
              </a>

              <div className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] flex items-center gap-3 border border-[#E6E2D8] dark:border-[#23232A]">
                <div className="w-8 h-8 rounded-full bg-[#111113] dark:bg-[#23232A] text-white flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-[11px] text-[#7A756D] dark:text-[#8E8980] block">{t.staticExtras.officialEmailLabel}</span>
                  <span className="font-bold text-[#111113] dark:text-[#F7F6F3] text-[11px] truncate block" dir="ltr">{siteSettings.officialEmail}</span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] flex items-center gap-3 border border-[#E6E2D8] dark:border-[#23232A]">
                <div className="w-8 h-8 rounded-full bg-[#111113] dark:bg-[#23232A] text-white flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] text-[#7A756D] dark:text-[#8E8980] block">{t.staticExtras.hqLabel}</span>
                  <span className="font-bold text-[#111113] dark:text-[#F7F6F3] text-[11px]">
                    {(siteSettings.addressMultilingual && siteSettings.addressMultilingual[language]) || siteSettings.address}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Message Form */}
        <div className="md:col-span-2 bg-white dark:bg-[#141418] p-6 sm:p-8 rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-xs space-y-4">
          <h2 className="text-base font-bold text-[#111113] dark:text-[#F7F6F3]">{t.contactModal.formTitle}</h2>

          {sentSuccess && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 rounded-2xl text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{t.contactModal.sentSuccess}</span>
            </div>
          )}

          {sendError && (
            <div className="p-3.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 rounded-2xl text-xs font-bold">
              {sendError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">{t.checkout.fullName} *</label>
                <input
                  type="text"
                  required
                  value={senderName}
                  onChange={e => setSenderName(e.target.value)}
                  placeholder={t.staticExtras.namePlaceholder}
                  className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">{t.checkout.phone} *</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+216 21 000 000"
                  className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]"
                  dir="ltr"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">{t.contactModal.subject}</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={t.staticExtras.subjectPlaceholder}
                className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">{t.contactModal.message} *</label>
              <textarea
                required
                rows={4}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder={t.staticExtras.messagePlaceholder}
                className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]"
              />
            </div>

            {!isOnline && (
              <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
                {t.offline.serverActionDisabled}
              </p>
            )}

            <button
              type="submit"
              disabled={sending || !isOnline}
              className="px-6 py-3 bg-[#FF6B00] hover:bg-[#e05e00] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{t.contactModal.sendBtn}</span>
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};
