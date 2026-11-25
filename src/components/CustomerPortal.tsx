import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../context/StoreContext';
import {
  User,
  MapPin,
  Package,
  Heart,
  Plus,
  LogOut,
  ShoppingBag,
  Trash2,
  Phone,
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Download,
  Cookie,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import {
  TUNISIAN_GOVERNORATES,
  getDelegationsForGovernorate,
  getGovernorateName,
  normalizeTunisianPhone,
} from '../data/governorates';
import {
  isValidCustomerEmail,
  mapPasswordReasonToMsgKey,
  getCustomerAuthMessage,
  validateCustomerPasswordStrength,
  type AuthLang,
} from '../lib/customerAuthMessages';
import {
  exportCustomerPrivacyData,
  getPaymentStatusTone,
  submitCustomerPrivacyRequest,
} from '../lib/payments';
import { handleStoreImageError, handleStoreImageLoad } from '../lib/imageFallback';
import { LEGAL_TRANSLATIONS } from '../data/legalTranslations';
import { resolveLegalDisclosures } from '../lib/legal';
import { LegalPreviewModal, type LegalPreviewTopic } from './LegalPreviewModal';

export const CustomerPortal: React.FC = () => {
  const {
    currentUser,
    customerAuthLoading,
    loginCustomer,
    registerCustomer,
    logoutCustomer,
    addCustomerAddress,
    setDefaultAddress,
    deleteCustomerAddress,
    updateCustomerProfile,
    siteSettings,
    orders,
    products,
    wishlist,
    toggleWishlist,
    addToCart,
    setSelectedProductId,
    setCurrentView,
    currentView,
    language,
    t,
  } = useStore();

  const authT = (t as any).customerAuth;
  const lt = LEGAL_TRANSLATIONS[language] || LEGAL_TRANSLATIONS.ar;
  const disclosures = resolveLegalDisclosures(siteSettings, language);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [registerLegalAccepted, setRegisterLegalAccepted] = useState(false);
  const [previewTopic, setPreviewTopic] = useState<LegalPreviewTopic | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authRetryable, setAuthRetryable] = useState(false);
  const authSubmittingRef = useRef(false);

  const [activeTab, setActiveTab] = useState<'orders' | 'addresses' | 'wishlist' | 'privacy'>(
    currentView === 'wishlist' ? 'wishlist' : 'orders'
  );

  // Privacy & Data Rights Center states
  const [profileFullName, setProfileFullName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const [privacyReqType, setPrivacyReqType] = useState<'rectification' | 'erasure' | 'opposition'>('rectification');
  const [privacyReqDetails, setPrivacyReqDetails] = useState('');
  const [privacyReqBusy, setPrivacyReqBusy] = useState(false);
  const [privacyReqSuccess, setPrivacyReqSuccess] = useState('');
  const [privacyReqError, setPrivacyReqError] = useState('');

  useEffect(() => {
    if (currentView === 'wishlist') {
      setActiveTab('wishlist');
    }
  }, [currentView]);

  useEffect(() => {
    if (currentUser) {
      setProfileFullName(currentUser.fullName || '');
      setProfilePhone(currentUser.phone || '');
    }
  }, [currentUser]);

  // New Address Form state
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newGovernorate, setNewGovernorate] = useState('');
  const [newDelegation, setNewDelegation] = useState('');
  const [newStreet, setNewStreet] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressError, setAddressError] = useState('');

  const wishlistedProducts = products.filter((p) => wishlist.includes(p.id));

  const submitAuthRequest = async () => {
    if (authSubmittingRef.current) return;
    setAuthError('');
    setAuthRetryable(false);

    const cleanEmail = authEmail.trim().toLowerCase();
    if (!cleanEmail || !authPassword) {
      setAuthError(authT.authErrorRequired);
      return;
    }
    if (!isValidCustomerEmail(cleanEmail)) {
      setAuthError(authT.authErrorEmail || getCustomerAuthMessage(language as AuthLang, 'invalidEmail'));
      return;
    }

    if (authMode === 'register') {
      if (!authName.trim() || !authPhone.trim()) {
        setAuthError(authT.authErrorRequired);
        return;
      }
      if (authName.trim().length < 3) {
        setAuthError(getCustomerAuthMessage(language as AuthLang, 'invalidFullName'));
        return;
      }
      const phoneCheck = normalizeTunisianPhone(authPhone.trim());
      if (!phoneCheck.valid) {
        setAuthError(authT.authErrorPhone || getCustomerAuthMessage(language as AuthLang, 'invalidPhone'));
        return;
      }
      const pwdCheck = validateCustomerPasswordStrength(authPassword);
      if (!pwdCheck.valid) {
        setAuthError(getCustomerAuthMessage(language as AuthLang, mapPasswordReasonToMsgKey(pwdCheck.reason)));
        return;
      }
      if (!registerLegalAccepted) {
        setAuthError(lt.registerLegal.requiredError);
        return;
      }
    }

    authSubmittingRef.current = true;
    setAuthBusy(true);
    try {
      const res =
        authMode === 'login'
          ? await loginCustomer(cleanEmail, authPassword)
          : await registerCustomer({
              fullName: authName.trim(),
              email: cleanEmail,
              phone: authPhone.trim(),
              password: authPassword,
              legalConsent: {
                termsAccepted: true,
                privacyAccepted: true,
                termsVersion: disclosures.policyVersion,
                privacyVersion: disclosures.policyVersion,
                acceptedAt: new Date().toISOString(),
                language,
                source: 'customer_registration',
              },
            });

      if (!res.ok) {
        setAuthError(res.error || authT.authErrorRequired);
        setAuthRetryable(Boolean(res.retryable));
        return;
      }

      setAuthPassword('');
      setRegisterLegalAccepted(false);
      setAuthRetryable(false);
    } finally {
      authSubmittingRef.current = false;
      setAuthBusy(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitAuthRequest();
  };

  const handleAddAddressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddressError('');
    if (!newFullName.trim() || !newPhone.trim() || !newGovernorate || !newDelegation || !newStreet.trim()) {
      return;
    }

    setAddressBusy(true);
    const res = await addCustomerAddress({
      fullName: newFullName.trim(),
      phone: newPhone.trim(),
      governorate: newGovernorate,
      delegation: newDelegation,
      city: newDelegation,
      street: newStreet.trim(),
      notes: newNotes.trim() || undefined,
      isDefault: (currentUser?.addresses || []).length === 0,
    });
    setAddressBusy(false);

    if (!res.ok) {
      setAddressError(res.error || 'تعذر حفظ العنوان');
      return;
    }

    setShowAddAddress(false);
    setNewFullName('');
    setNewPhone('');
    setNewGovernorate('');
    setNewDelegation('');
    setNewStreet('');
    setNewNotes('');
  };

  if (customerAuthLoading) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 flex flex-col items-center justify-center gap-3 text-[#7A756D] dark:text-[#9A958E]">
        <Loader2 className="w-7 h-7 animate-spin text-[#FF6B00]" />
        <span className="text-xs font-bold">{authT.loggingIn}</span>
      </div>
    );
  }

  // Unauthenticated view: Real Sign-In / Registration + optional Guest Wishlist below
  if (!currentUser) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8 animate-fadeIn">
        <div className="max-w-md mx-auto bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-lg p-6 sm:p-8 space-y-5 text-[#111113] dark:text-[#F7F6F3]">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-full bg-[#FF6B00]/10 text-[#FF6B00] flex items-center justify-center mx-auto">
              <User className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-black text-[#111113] dark:text-[#F7F6F3]">
              {authMode === 'login' ? authT.signInTab : authT.registerTab}
            </h1>
            <p className="text-xs text-[#7A756D] dark:text-[#8E8980]">{authT.signedInWelcome}</p>
          </div>

          {/* Mode Toggle Tabs */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[#F3F1EC] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A]">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setAuthError('');
                setRegisterLegalAccepted(false);
              }}
              className={`py-2 rounded-xl text-xs font-black transition-colors cursor-pointer ${
                authMode === 'login'
                  ? 'bg-[#111113] dark:bg-[#FF6B00] text-white shadow-xs'
                  : 'text-[#5A5854] dark:text-[#B5B0A8]'
              }`}
            >
              {authT.signInTab}
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                setAuthError('');
                setRegisterLegalAccepted(false);
              }}
              className={`py-2 rounded-xl text-xs font-black transition-colors cursor-pointer ${
                authMode === 'register'
                  ? 'bg-[#111113] dark:bg-[#FF6B00] text-white shadow-xs'
                  : 'text-[#5A5854] dark:text-[#B5B0A8]'
              }`}
            >
              {authT.registerTab}
            </button>
          </div>

          {authError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-xs font-bold flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
              {authRetryable && (
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void submitAuthRequest()}
                  className="shrink-0 underline font-black hover:opacity-80 cursor-pointer disabled:opacity-50"
                >
                  {authT.retryBtn}
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-3.5">
            {authMode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">
                    {authT.fullNameLabel}
                  </label>
                  <input
                    type="text"
                    required
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    placeholder={t.checkout.fullNamePlaceholder}
                    className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">
                    {authT.phoneLabel}
                  </label>
                  <input
                    type="tel"
                    required
                    value={authPhone}
                    onChange={(e) => setAuthPhone(e.target.value)}
                    placeholder="+216 21 000 000"
                    className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00] font-mono"
                    dir="ltr"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">
                {authT.emailLabel}
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00] font-mono"
                dir="ltr"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8]">
                  {authT.passwordLabel}
                </label>
                {authMode === 'register' && (
                  <span className="text-[10px] text-[#7A756D] dark:text-[#8E8980]">{authT.passwordMinHint}</span>
                )}
              </div>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-[#7A756D] absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={authMode === 'register' ? 8 : 1}
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full text-xs py-2.5 ps-9 pe-9 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="p-1.5 text-[#7A756D] hover:text-[#111113] dark:hover:text-white absolute top-1/2 -translate-y-1/2 end-2 cursor-pointer"
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {authMode === 'register' && (
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] text-[11px] leading-relaxed text-[#5A5854] dark:text-[#B5B0A8] cursor-pointer">
                <input
                  type="checkbox"
                  checked={registerLegalAccepted}
                  onChange={(e) => {
                    setRegisterLegalAccepted(e.target.checked);
                    if (e.target.checked && authError === lt.registerLegal.requiredError) {
                      setAuthError('');
                    }
                  }}
                  className="mt-0.5 w-4 h-4 accent-[#FF6B00] shrink-0 cursor-pointer"
                />
                <span>
                  {lt.registerLegal.prefix}{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPreviewTopic('terms');
                    }}
                    className="font-bold text-[#FF6B00] underline hover:opacity-80 cursor-pointer"
                  >
                    {lt.registerLegal.termsLabel}
                  </button>{' '}
                  {lt.registerLegal.andWord}{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPreviewTopic('privacy');
                    }}
                    className="font-bold text-[#FF6B00] underline hover:opacity-80 cursor-pointer"
                  >
                    {lt.registerLegal.privacyLabel}
                  </button>
                  .
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={authBusy}
              className="w-full py-3 rounded-xl bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] dark:hover:bg-[#e05e00] text-white font-bold text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-60"
            >
              {authBusy
                ? authMode === 'login'
                  ? authT.loggingIn
                  : authT.registering
                : authMode === 'login'
                ? authT.signInBtn
                : authT.createAccountBtn}
            </button>
          </form>
        </div>

        <LegalPreviewModal
          topic={previewTopic}
          onClose={() => setPreviewTopic(null)}
          onNavigateFullPage={(view) => setCurrentView(view)}
        />

        {/* Allow viewing local wishlist when browsing /wishlist before signing in */}
        {currentView === 'wishlist' && wishlistedProducts.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-base font-black text-[#111113] dark:text-[#F7F6F3] flex items-center gap-2">
              <Heart className="w-4 h-4 text-[#FF6B00]" />
              <span>
                {authT.wishlistTab} ({wishlistedProducts.length})
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {wishlistedProducts.map((prod) => (
                <div
                  key={prod.id}
                  className="bg-white dark:bg-[#141418] p-4 rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] space-y-3 flex flex-col justify-between"
                >
                  <div className="flex gap-3 cursor-pointer" onClick={() => setSelectedProductId(prod.id)}>
                    <img
                      src={prod.images[0] || '/assets/images/niapolor-badge.webp'}
                      alt={prod.name[language]}
                      referrerPolicy="no-referrer"
                      onError={handleStoreImageError}
                      onLoad={handleStoreImageLoad}
                      className="w-16 h-16 rounded-xl object-cover bg-[#F3F1EC] dark:bg-[#18181D] shrink-0"
                    />
                    <div className="overflow-hidden">
                      <h4 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] truncate">
                        {prod.name[language]}
                      </h4>
                      <p className="text-xs font-black text-[#FF6B00] tabular-nums mt-1">
                        {prod.price.toFixed(3)} {t.cart.currency}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-[#E6E2D8] dark:border-[#23232A]">
                    <button
                      type="button"
                      onClick={() => addToCart(prod, 1)}
                      className="flex-1 py-2 bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      <span>{t.product.addToCart}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleWishlist(prod.id)}
                      className="p-2 border border-[#E6E2D8] dark:border-[#32323C] hover:text-red-600 rounded-xl cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Logged-in Customer Dashboard (strictly customer-scoped orders from server + addresses)
  const customerOrders = orders.filter((o) => o.customerId === currentUser.id);
  const addresses = currentUser.addresses || [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      {/* Profile Banner */}
      <div className="bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-sm p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#111113] dark:bg-[#FF6B00] text-white flex items-center justify-center font-black text-xl shadow-xs">
            {currentUser.fullName.charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-black text-[#111113] dark:text-[#F7F6F3]">{currentUser.fullName}</h1>
            <div className="flex items-center flex-wrap gap-3 text-xs text-[#7A756D] dark:text-[#8E8980] mt-0.5">
              <span className="flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" />
                <span dir="ltr">{currentUser.email}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" />
                <span dir="ltr">{currentUser.phone}</span>
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void logoutCustomer()}
          className="px-4 py-2 rounded-xl border border-[#E6E2D8] dark:border-[#32323C] hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 text-[#5A5854] dark:text-[#B5B0A8] text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>{authT.logoutBtn}</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E6E2D8] dark:border-[#23232A] pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'orders'
              ? 'bg-[#111113] dark:bg-[#FF6B00] text-white shadow-xs'
              : 'text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#18181D]'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>
            {authT.myOrdersTitle} ({customerOrders.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('addresses')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'addresses'
              ? 'bg-[#111113] dark:bg-[#FF6B00] text-white shadow-xs'
              : 'text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#18181D]'
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span>
            {authT.addressesTitle} ({addresses.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('wishlist')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'wishlist'
              ? 'bg-[#111113] dark:bg-[#FF6B00] text-white shadow-xs'
              : 'text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#18181D]'
          }`}
        >
          <Heart className="w-4 h-4" />
          <span>
            {authT.wishlistTab} ({wishlistedProducts.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('privacy')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'privacy'
              ? 'bg-[#111113] dark:bg-[#FF6B00] text-white shadow-xs'
              : 'text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#18181D]'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>{lt.customerPrivacyCenter.tabLabel}</span>
        </button>
      </div>

      {/* Tab 1: Orders */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {customerOrders.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] text-[#7A756D] dark:text-[#8E8980] text-xs font-bold">
              {authT.noOrdersYet}
            </div>
          ) : (
            customerOrders.map((order) => (
              <div
                key={order.id}
                className="bg-white dark:bg-[#141418] rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] p-5 space-y-4 shadow-xs"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-[#E6E2D8] dark:border-[#23232A] pb-3">
                  <div>
                    <span className="text-xs text-[#7A756D] dark:text-[#8E8980] block">
                      {language === 'ar' ? 'رقم التتبع:' : language === 'fr' ? 'N° de suivi :' : 'Tracking #:'}
                    </span>
                    <span className="font-mono font-bold text-sm text-[#FF6B00]">{order.trackingNumber}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-[11px] px-2.5 py-1 rounded-full font-bold border ${getPaymentStatusTone(
                        order.paymentStatus
                      )}`}
                    >
                      {(t.payments.statuses as Record<string, string>)[order.paymentStatus] || order.paymentStatus}
                    </span>
                    <span className="text-xs bg-[#F3F1EC] dark:bg-[#18181D] px-3 py-1 rounded-full font-bold text-[#111113] dark:text-[#F7F6F3]">
                      {t.orderStatus[order.status] || order.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentView('my_orders')}
                      className="text-xs text-[#FF6B00] hover:underline font-bold cursor-pointer"
                    >
                      {authT.trackOrderAction}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-[#5A5854] dark:text-[#B5B0A8]">
                  <span>
                    {order.items.length} · {getGovernorateName(order.shippingAddress.governorate, language)}
                    {(order.shippingAddress.delegation || order.shippingAddress.city) &&
                      ` (${order.shippingAddress.delegation || order.shippingAddress.city})`}
                  </span>
                  <span className="text-sm font-black text-[#111113] dark:text-[#F7F6F3] tabular-nums">
                    {order.totalAmount.toFixed(3)} {t.cart.currency}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 2: Addresses */}
      {activeTab === 'addresses' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-bold text-[#111113] dark:text-[#F7F6F3]">{authT.addressesTitle}</h2>
            <button
              type="button"
              onClick={() => setShowAddAddress(!showAddAddress)}
              className="px-3.5 py-1.5 rounded-xl bg-[#FF6B00] text-white text-xs font-bold flex items-center gap-1 shadow-xs hover:bg-[#e05e00] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{authT.addAddressBtn}</span>
            </button>
          </div>

          {addressError && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-xs font-bold">
              {addressError}
            </div>
          )}

          {/* Add Address Form */}
          {showAddAddress && (
            <form
              onSubmit={handleAddAddressSubmit}
              className="bg-white dark:bg-[#141418] p-5 rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] space-y-3"
            >
              <h3 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3]">{authT.addAddressTitle}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder={t.checkout.fullNamePlaceholder}
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3]"
                />
                <input
                  type="tel"
                  required
                  placeholder="+216 21 000 000"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] font-mono"
                  dir="ltr"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  required
                  value={newGovernorate}
                  onChange={(e) => {
                    setNewGovernorate(e.target.value);
                    setNewDelegation('');
                  }}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3]"
                >
                  <option value="">{t.checkout.selectGovernorate}</option>
                  {TUNISIAN_GOVERNORATES.map((gov) => (
                    <option key={gov.id} value={gov.id}>
                      {language === 'fr' ? gov.nameFr : language === 'en' ? gov.nameEn : gov.nameAr}
                    </option>
                  ))}
                </select>
                <select
                  required
                  disabled={!newGovernorate}
                  value={newDelegation}
                  onChange={(e) => setNewDelegation(e.target.value)}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] disabled:opacity-55"
                >
                  <option value="">
                    {newGovernorate ? t.checkout.selectDelegation : t.checkout.selectGovernorateFirst}
                  </option>
                  {getDelegationsForGovernorate(newGovernorate).map((del) => (
                    <option key={del} value={del}>
                      {del}
                    </option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                required
                placeholder={t.checkout.streetPlaceholder}
                value={newStreet}
                onChange={(e) => setNewStreet(e.target.value)}
                className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3]"
              />

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddAddress(false)}
                  className="px-3 py-1.5 text-xs text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#18181D] rounded-xl cursor-pointer"
                >
                  ✕
                </button>
                <button
                  type="submit"
                  disabled={addressBusy}
                  className="px-4 py-1.5 bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-60"
                >
                  {authT.addAddressBtn}
                </button>
              </div>
            </form>
          )}

          {/* Addresses Grid */}
          {addresses.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] text-[#7A756D] dark:text-[#8E8980] text-xs font-bold">
              {authT.noAddressesYet}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {addresses.map((addr) => (
                <div
                  key={addr.id}
                  className={`p-4 rounded-2xl border-2 bg-white dark:bg-[#141418] space-y-2 transition-all ${
                    addr.isDefault ? 'border-[#FF6B00] shadow-xs' : 'border-[#E6E2D8] dark:border-[#23232A]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-xs text-[#111113] dark:text-[#F7F6F3]">{addr.fullName}</span>
                    <div className="flex items-center gap-2">
                      {addr.isDefault ? (
                        <span className="text-[10px] bg-[#FF6B00]/10 text-[#FF6B00] font-black px-2 py-0.5 rounded-full">
                          {authT.defaultBadge}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void setDefaultAddress(addr.id)}
                          className="text-[11px] text-[#7A756D] dark:text-[#8E8980] hover:text-[#FF6B00] cursor-pointer"
                        >
                          {authT.setDefaultBtn}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void deleteCustomerAddress(addr.id)}
                        aria-label={authT.deleteAddressBtn}
                        className="p-1 text-[#7A756D] dark:text-[#8E8980] hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-[#5A5854] dark:text-[#B5B0A8]">
                    {getGovernorateName(addr.governorate, language)} · {addr.delegation || addr.city || ''}
                    {addr.postalCode ? ` (${addr.postalCode})` : ''}
                  </p>
                  <p className="text-xs text-[#7A756D] dark:text-[#8E8980]">{addr.street}</p>
                  <p className="text-xs font-mono text-[#5A5854] dark:text-[#B5B0A8]" dir="ltr">
                    {addr.phone}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Wishlist */}
      {activeTab === 'wishlist' && (
        <div className="space-y-4">
          {wishlistedProducts.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] text-[#7A756D] dark:text-[#8E8980] text-xs font-bold">
              {authT.emptyWishlist}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {wishlistedProducts.map((prod) => (
                <div
                  key={prod.id}
                  className="bg-white dark:bg-[#141418] p-4 rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] space-y-3 flex flex-col justify-between"
                >
                  <div className="flex gap-3 cursor-pointer" onClick={() => setSelectedProductId(prod.id)}>
                    <img
                      src={prod.images[0] || '/assets/images/niapolor-badge.webp'}
                      alt={prod.name[language]}
                      referrerPolicy="no-referrer"
                      onError={handleStoreImageError}
                      onLoad={handleStoreImageLoad}
                      className="w-16 h-16 rounded-xl object-cover bg-[#F3F1EC] dark:bg-[#18181D] shrink-0"
                    />
                    <div className="overflow-hidden">
                      <h4 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] truncate">
                        {prod.name[language]}
                      </h4>
                      <p className="text-xs font-black text-[#FF6B00] tabular-nums mt-1">
                        {prod.price.toFixed(3)} {t.cart.currency}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-[#E6E2D8] dark:border-[#23232A]">
                    <button
                      type="button"
                      onClick={() => addToCart(prod, 1)}
                      className="flex-1 py-2 bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] dark:hover:bg-[#e05e00] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      <span>{t.product.addToCart}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleWishlist(prod.id)}
                      className="p-2 border border-[#E6E2D8] dark:border-[#32323C] hover:text-red-600 rounded-xl cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Privacy & Data Rights (Law No. 2004-63) */}
      {activeTab === 'privacy' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-base font-black flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#FF6B00]" />
                <span>{lt.customerPrivacyCenter.title}</span>
              </h2>
              <p className="text-xs text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
                {lt.customerPrivacyCenter.subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCurrentView('privacy')}
              className="px-3.5 py-2 rounded-xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] text-xs font-bold text-[#FF6B00] hover:border-[#FF6B00] flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <span>{lt.customerPrivacyCenter.legalLinkText}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Consent Proof */}
            <div className="bg-white dark:bg-[#141418] rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] p-5 space-y-2.5">
              <h3 className="text-sm font-black">{lt.customerPrivacyCenter.consentCardTitle}</h3>
              {currentUser.legalConsent ? (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs space-y-1">
                  <p className="font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{lt.customerPrivacyCenter.consentRecordedLabel}</span>
                  </p>
                  <p className="text-[11px] text-[#5A5854] dark:text-[#B5B0A8]">
                    {lt.customerPrivacyCenter.versionLabel}{' '}
                    <span className="font-mono font-bold">{currentUser.legalConsent.termsVersion}</span>
                  </p>
                  <p className="text-[11px] text-[#5A5854] dark:text-[#B5B0A8]">
                    {lt.customerPrivacyCenter.dateLabel}{' '}
                    <span className="font-mono">
                      {new Date(currentUser.legalConsent.acceptedAt).toLocaleString(
                        language === 'ar' ? 'ar-TN' : language === 'fr' ? 'fr-TN' : 'en-GB'
                      )}
                    </span>
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[#7A756D] dark:text-[#8E8980] p-3 rounded-xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A]">
                  {lt.customerPrivacyCenter.consentNoneLabel}
                </p>
              )}
            </div>

            {/* Data Export + Cookie Preferences */}
            <div className="bg-white dark:bg-[#141418] rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] p-5 space-y-4">
              <div className="space-y-2">
                <h3 className="text-sm font-black">{lt.customerPrivacyCenter.exportCardTitle}</h3>
                <p className="text-xs text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
                  {lt.customerPrivacyCenter.exportCardDesc}
                </p>
                {exportError && (
                  <p className="text-xs font-bold text-red-600 dark:text-red-400">{exportError}</p>
                )}
                <button
                  type="button"
                  disabled={exportBusy}
                  onClick={async () => {
                    setExportBusy(true);
                    setExportError('');
                    const res = await exportCustomerPrivacyData();
                    setExportBusy(false);
                    if (!res.ok || !res.exportData) {
                      setExportError(res.error || 'Export failed.');
                      return;
                    }
                    const blob = new Blob([JSON.stringify(res.exportData, null, 2)], {
                      type: 'application/json',
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `niapolor-my-data-${currentUser.id}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  className="px-4 py-2 rounded-xl bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] text-white text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {exportBusy ? lt.customerPrivacyCenter.exportingBtn : lt.customerPrivacyCenter.exportBtn}
                  </span>
                </button>
              </div>

              <div className="pt-3 border-t border-[#E6E2D8] dark:border-[#23232A] space-y-2">
                <h4 className="text-xs font-black flex items-center gap-1.5">
                  <Cookie className="w-3.5 h-3.5 text-[#FF6B00]" />
                  <span>{lt.customerPrivacyCenter.cookieCardTitle}</span>
                </h4>
                <p className="text-[11px] text-[#5A5854] dark:text-[#B5B0A8]">
                  {lt.customerPrivacyCenter.cookieCardDesc}
                </p>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('niapolor_open_cookie_prefs'))}
                  className="px-3.5 py-2 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] text-xs font-bold hover:border-[#FF6B00] cursor-pointer"
                >
                  {lt.customerPrivacyCenter.cookieBtn}
                </button>
              </div>
            </div>
          </div>

          {/* Direct Profile Rectification + Formal Statutory Request */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setProfileMsg(null);
                if (!profileFullName.trim() || !profilePhone.trim()) return;
                setProfileSaving(true);
                const res = await updateCustomerProfile({
                  fullName: profileFullName.trim(),
                  phone: profilePhone.trim(),
                });
                setProfileSaving(false);
                if (!res.ok) {
                  setProfileMsg({ type: 'err', text: res.error || 'Update failed' });
                } else {
                  setProfileMsg({
                    type: 'ok',
                    text:
                      language === 'ar'
                        ? 'تم تحديث بياناتك الشخصية بنجاح.'
                        : language === 'fr'
                        ? 'Vos coordonnées ont été mises à jour.'
                        : 'Profile details updated.',
                  });
                }
              }}
              className="bg-white dark:bg-[#141418] rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] p-5 space-y-3"
            >
              <h3 className="text-sm font-black">{lt.customerPrivacyCenter.requestTypes.rectification}</h3>
              <div className="space-y-2">
                <input
                  type="text"
                  required
                  value={profileFullName}
                  onChange={(e) => setProfileFullName(e.target.value)}
                  placeholder={authT.fullNameLabel}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D]"
                />
                <input
                  type="tel"
                  required
                  dir="ltr"
                  value={profilePhone}
                  onChange={(e) => setProfilePhone(e.target.value)}
                  placeholder="+216 21 000 000"
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] font-mono"
                />
              </div>
              {profileMsg && (
                <p
                  className={`text-xs font-bold ${
                    profileMsg.type === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {profileMsg.text}
                </p>
              )}
              <button
                type="submit"
                disabled={profileSaving}
                className="px-4 py-2 rounded-xl bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {language === 'ar' ? 'تحديث بياناتي' : language === 'fr' ? 'Mettre à jour' : 'Save Changes'}
              </button>
            </form>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setPrivacyReqSuccess('');
                setPrivacyReqError('');
                setPrivacyReqBusy(true);
                const res = await submitCustomerPrivacyRequest({
                  requestType: privacyReqType,
                  details: privacyReqDetails,
                  language,
                });
                setPrivacyReqBusy(false);
                if (!res.ok) {
                  setPrivacyReqError(res.error || 'Request failed');
                  return;
                }
                setPrivacyReqDetails('');
                setPrivacyReqSuccess(lt.customerPrivacyCenter.requestSuccess);
              }}
              className="bg-white dark:bg-[#141418] rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] p-5 space-y-3"
            >
              <h3 className="text-sm font-black">{lt.customerPrivacyCenter.requestCardTitle}</h3>
              <p className="text-xs text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
                {lt.customerPrivacyCenter.requestCardDesc}
              </p>
              <select
                value={privacyReqType}
                onChange={(e) => setPrivacyReqType(e.target.value as 'rectification' | 'erasure' | 'opposition')}
                className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D]"
              >
                <option value="rectification">{lt.customerPrivacyCenter.requestTypes.rectification}</option>
                <option value="erasure">{lt.customerPrivacyCenter.requestTypes.erasure}</option>
                <option value="opposition">{lt.customerPrivacyCenter.requestTypes.opposition}</option>
              </select>
              <textarea
                rows={2}
                value={privacyReqDetails}
                onChange={(e) => setPrivacyReqDetails(e.target.value)}
                placeholder={lt.customerPrivacyCenter.detailsPlaceholder}
                className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] resize-none"
              />
              {privacyReqError && (
                <p className="text-xs font-bold text-red-600 dark:text-red-400">{privacyReqError}</p>
              )}
              {privacyReqSuccess && (
                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{privacyReqSuccess}</span>
                </p>
              )}
              <button
                type="submit"
                disabled={privacyReqBusy}
                className="px-4 py-2 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {privacyReqBusy ? lt.customerPrivacyCenter.submittingBtn : lt.customerPrivacyCenter.submitRequestBtn}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
