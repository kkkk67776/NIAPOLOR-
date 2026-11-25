import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../context/StoreContext';
import {
  Phone,
  X,
  Send,
  Headphones,
  ExternalLink,
  MessageSquare,
  RotateCcw,
  ArrowUpRight,
  Sparkles,
  WifiOff,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { handleStoreImageError } from '../lib/imageFallback';
import { shouldHideFloatingLauncher } from '../lib/floatingUiCoordinator';

export const FloatingActions: React.FC = () => {
  const {
    siteSettings,
    chatMessages,
    isChatReplying,
    sendCustomerSupportMessage,
    refreshChatThread,
    resetChatSession,
    setSelectedProductId,
    selectedProductId,
    setCurrentView,
    currentView,
    language,
    t,
    isOnline,
    activeFloatingPanel,
    openFloatingPanel,
    closeFloatingPanel,
    isCartOpen,
    isSupportModalOpen,
    isCheckoutOpen,
    isBottomNavVisible,
    isCookieBannerVisible,
  } = useStore();

  const [chatInput, setChatInput] = useState('');
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const hubOpen = activeFloatingPanel === 'support_hub';
  const chatOpen = activeFloatingPanel === 'live_chat';
  const isOwnerRoute =
    currentView === '/owner/dashboard' || currentView === 'owner_dashboard';

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 639px)');
    const sync = () => setIsMobileViewport(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!chatOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatReplying, chatOpen]);

  // Poll server for live Owner replies while the customer chat window is open and online
  useEffect(() => {
    if (!chatOpen || !isOnline) return;
    refreshChatThread();
    const timer = setInterval(() => {
      refreshChatThread();
    }, 4000);
    return () => clearInterval(timer);
  }, [chatOpen, isOnline]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatReplying) return;
    const msg = chatInput.trim();
    setChatInput('');
    await sendCustomerSupportMessage(msg);
  };

  const handleQuickChip = async (chipText: string) => {
    if (isChatReplying) return;
    await sendCustomerSupportMessage(chipText);
  };

  const hideLauncher = shouldHideFloatingLauncher({
    activeFloatingPanel,
    isCartOpen,
    isSupportModalOpen,
    hasSelectedProduct: Boolean(selectedProductId),
    isCheckoutOpen,
    isOwnerRoute,
    isCookieBannerVisible,
    isMobileViewport,
  });

  const whatsappDigits = (siteSettings?.whatsappPhone || '').replace(/\D/g, '');
  const timeLocale = language === 'fr' ? 'fr-TN' : language === 'en' ? 'en-GB' : 'ar-TN';
  const quickChips: string[] = Array.isArray((t.chat as any).quickChips)
    ? (t.chat as any).quickChips
    : [];
  const isRtl = language === 'ar';

  return (
    <>
      {/* 1. Compact, Non-Intrusive Support Trigger */}
      {!hideLauncher && (
        <div
          className={`fixed end-3.5 sm:end-6 z-30 select-none transition-all duration-200 ${
            isBottomNavVisible
              ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]'
              : 'bottom-4'
          } sm:bottom-6`}
        >
          <button
            type="button"
            onClick={() => openFloatingPanel('support_hub')}
            title={t.supportHub.buttonTitle}
            aria-label={t.supportHub.buttonTitle}
            aria-expanded={hubOpen}
            aria-haspopup="dialog"
            className="min-w-[44px] min-h-[44px] h-11 px-3 sm:px-4 rounded-full bg-[#111113]/92 dark:bg-[#18181F]/95 hover:bg-[#FF6B00] dark:hover:bg-[#FF6B00] text-white border border-black/10 dark:border-[#2C2C38] shadow-[0_8px_24px_rgba(17,17,19,0.22)] dark:shadow-[0_10px_28px_rgba(0,0,0,0.55)] backdrop-blur-md active:scale-95 transition-colors flex items-center justify-center gap-2 cursor-pointer group"
          >
            <Phone className="w-[18px] h-[18px] text-[#FF6B00] group-hover:text-white transition-colors shrink-0" />
            <span className="text-xs font-bold hidden sm:inline whitespace-nowrap">
              {t.supportHub.helpLabel}
            </span>
          </button>
        </div>
      )}

      {/* 2. Modern NIAPOLOR Live Support Center Panel (Mutually Exclusive Overlay) */}
      {hubOpen && (
        <>
          <div
            className="fixed inset-0 z-[45] bg-black/25 dark:bg-black/50 backdrop-blur-[1px] animate-fadeIn"
            onClick={() => closeFloatingPanel('support_hub')}
            aria-hidden="true"
          />
          <div
            className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] sm:bottom-6 z-50 pointer-events-none select-none"
            role="dialog"
            aria-modal="true"
            aria-label={t.supportHub.title}
          >
            <div className="max-w-7xl mx-auto px-3 sm:px-6 flex justify-center sm:justify-end">
              <div
                className="pointer-events-auto w-full max-w-[360px] sm:w-[348px] max-h-[calc(100dvh-148px)] bg-white dark:bg-[#131317] rounded-2xl border border-[#E6E2D8] dark:border-[#25252F] shadow-[0_20px_54px_rgba(17,17,19,0.18)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.72)] overflow-hidden flex flex-col animate-scaleUp text-[#111113] dark:text-[#F7F6F3]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="px-4 py-3 bg-[#FAF9F7] dark:bg-[#17171D] border-b border-[#EFECE6] dark:border-[#22222B] flex items-center justify-between gap-2.5 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-xl bg-[#FF6B00]/12 border border-[#FF6B00]/20 text-[#FF6B00] flex items-center justify-center shrink-0">
                      <Headphones className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-xs font-extrabold text-[#111113] dark:text-[#F7F6F3] leading-tight truncate">
                        {t.supportHub.title}
                      </h3>
                      <p className="text-[10px] text-[#7A756D] dark:text-[#8E8980] truncate mt-0.5">
                        {(t.supportHub as any).subtitle || 'NIAPOLOR'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => closeFloatingPanel('support_hub')}
                    aria-label={t.supportHub.closeLabel}
                    className="min-w-[44px] min-h-[44px] -me-1.5 flex items-center justify-center text-[#7A756D] hover:text-[#111113] dark:text-[#9A958E] dark:hover:text-white rounded-xl hover:bg-[#EFECE6] dark:hover:bg-[#23232C] transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Unified Channel Rows */}
                <div className="p-3 space-y-2 overflow-y-auto">
                  {/* WhatsApp Direct */}
                  <a
                    href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
                      language === 'fr'
                        ? 'Bonjour NIAPOLOR Tunisie, je souhaite avoir des informations'
                        : language === 'en'
                        ? 'Hello NIAPOLOR Tunisia, I would like to inquire about'
                        : 'مرحباً NIAPOLOR تونس، أود الاستفسار عن'
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => closeFloatingPanel('support_hub')}
                    className="min-h-[54px] flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18181F] hover:bg-white dark:hover:bg-[#1E1E27] border border-[#EAE5DC] dark:border-[#262630] hover:border-[#FF6B00]/50 transition-colors group cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                        <svg viewBox="0 0 32 32" className="w-4 h-4 fill-current" aria-hidden="true">
                          <path d="M16.004 2.667C8.64 2.667 2.667 8.64 2.667 16c0 2.352.616 4.648 1.787 6.672L2.667 29.333l6.832-1.792A13.28 13.28 0 0 0 16.004 29.333C23.368 29.333 29.333 23.36 29.333 16S23.368 2.667 16.004 2.667zm7.768 18.88c-.325.917-1.912 1.749-2.648 1.856-.672.101-1.525.144-2.464-.155-.568-.181-1.296-.421-2.224-.821-3.912-1.688-6.464-5.637-6.659-5.899-.195-.261-1.589-2.115-1.589-4.035 0-1.92 1.005-2.864 1.363-3.253.357-.389.779-.485 1.037-.485.261 0 .52.003.747.013.24.011.563-.091.88.672.325.784 1.107 2.704 1.203 2.901.096.197.16.427.032.688-.128.261-.192.427-.389.656-.197.229-.413.512-.589.688-.197.197-.403.411-.173.805.229.395 1.021 1.685 2.192 2.731 1.507 1.344 2.779 1.76 3.173 1.957.395.197.624.165.853-.099.229-.261.989-1.155 1.253-1.552.261-.395.523-.328.88-.197.357.131 2.277 1.075 2.667 1.269.389.197.651.293.747.456.096.165.096.949-.229 1.867z" />
                        </svg>
                      </span>
                      <div className="min-w-0">
                        <span className="text-xs font-bold block text-[#111113] dark:text-[#F7F6F3] truncate">
                          {t.supportHub.whatsappTitle}
                        </span>
                        <span className="text-[11px] text-[#7A756D] dark:text-[#8E8980] block truncate">
                          {t.supportHub.whatsappSubtitle}
                        </span>
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-[#8A857C] group-hover:text-[#FF6B00] transition-colors shrink-0" />
                  </a>

                  {/* Direct Phone Call */}
                  {siteSettings?.supportPhone && (
                    <a
                      href={`tel:${siteSettings.supportPhone}`}
                      onClick={() => closeFloatingPanel('support_hub')}
                      className="min-h-[54px] flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18181F] hover:bg-white dark:hover:bg-[#1E1E27] border border-[#EAE5DC] dark:border-[#262630] hover:border-[#FF6B00]/50 transition-colors group cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-9 h-9 rounded-xl bg-[#111113]/6 dark:bg-white/8 text-[#111113] dark:text-[#F7F6F3] border border-[#E6E2D8] dark:border-[#2D2D38] flex items-center justify-center shrink-0">
                          <Phone className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <span className="text-xs font-bold block text-[#111113] dark:text-[#F7F6F3] truncate">
                            {t.supportHub.phoneTitle}
                          </span>
                          <span
                            dir="ltr"
                            className="text-[11px] text-[#7A756D] dark:text-[#8E8980] font-mono font-bold block truncate"
                          >
                            {siteSettings.supportPhone}
                          </span>
                        </div>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-[#8A857C] group-hover:text-[#FF6B00] transition-colors shrink-0" />
                    </a>
                  )}

                  {/* Instant Live Store Chat (Primary Brand Channel) */}
                  <button
                    type="button"
                    onClick={() => openFloatingPanel('live_chat')}
                    className="w-full min-h-[54px] flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18181F] hover:bg-white dark:hover:bg-[#1E1E27] border border-[#FF6B00]/30 dark:border-[#FF6B00]/35 hover:border-[#FF6B00] transition-colors group cursor-pointer text-start"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-xl bg-[#FF6B00] text-white flex items-center justify-center shrink-0 shadow-xs">
                        <MessageSquare className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <span className="text-xs font-bold block text-[#111113] dark:text-[#F7F6F3] truncate">
                          {t.supportHub.liveChatTitle}
                        </span>
                        <span className="text-[11px] text-[#7A756D] dark:text-[#8E8980] block truncate">
                          {t.supportHub.liveChatSubtitle}
                        </span>
                      </div>
                    </div>
                    <span className="text-[11px] text-[#FF6B00] font-bold inline-flex items-center gap-0.5 shrink-0">
                      <span>{t.supportHub.openBtn}</span>
                      {isRtl ? (
                        <ChevronLeft className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 3. Smart + Owner Live Chat Window */}
      {chatOpen && (
        <>
          <div
            className="fixed inset-0 z-[45] bg-black/25 dark:bg-black/50 backdrop-blur-[1px] animate-fadeIn sm:bg-transparent sm:dark:bg-transparent sm:backdrop-blur-none"
            onClick={() => closeFloatingPanel('live_chat')}
            aria-hidden="true"
          />
          <div
            className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] sm:bottom-6 z-50 pointer-events-none select-none"
            role="dialog"
            aria-modal="true"
            aria-label={t.chat.widgetTitle}
          >
            <div className="max-w-7xl mx-auto px-3 sm:px-6 flex justify-center sm:justify-end">
              <div
                className="pointer-events-auto w-full max-w-[390px] sm:w-[380px] max-h-[calc(100dvh-140px)] sm:max-h-[560px] bg-white dark:bg-[#131317] rounded-2xl border border-[#E6E2D8] dark:border-[#25252F] shadow-[0_22px_58px_rgba(17,17,19,0.2)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.75)] overflow-hidden flex flex-col animate-slideUp text-[#111113] dark:text-[#F7F6F3]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Chat Header */}
                <div className="bg-[#111113] dark:bg-[#17171D] px-4 py-3 text-white flex items-center justify-between gap-2 border-b border-[#25252F] shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#18181F] border border-[#FF6B00]/45 flex items-center justify-center shrink-0 overflow-hidden p-0.5">
                      <img
                        src="/assets/images/niapolor-emblem.webp"
                        alt="NIAPOLOR"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold leading-tight truncate">{t.chat.widgetTitle}</h4>
                      <p className="text-[10px] text-emerald-400 font-medium flex items-center gap-1.5 truncate mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <span className="truncate">{t.chat.supportOnline}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={resetChatSession}
                      title={(t.chat as any).resetChat || 'New Chat'}
                      aria-label={(t.chat as any).resetChat || 'New Chat'}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#9A958E] hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => closeFloatingPanel('live_chat')}
                      aria-label={t.supportHub.closeLabel}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#9A958E] hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Messages List */}
                <div className="p-3.5 flex-1 min-h-[200px] max-h-[45dvh] sm:max-h-[320px] overflow-y-auto space-y-3 bg-[#FAF9F7] dark:bg-[#0B0B0D] text-xs">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.sender === 'customer' ? 'items-end' : 'items-start'}`}
                    >
                      {msg.sender === 'owner' && msg.source === 'owner' && (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mb-0.5 px-1 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          <span>{(t.chat as any).liveOwnerBadge || 'Direct Admin Reply'}</span>
                        </span>
                      )}
                      <div
                        className={`max-w-[88%] p-3 rounded-2xl shadow-2xs leading-relaxed whitespace-pre-line ${
                          msg.sender === 'customer'
                            ? 'bg-[#FF6B00] text-white rounded-ee-xs'
                            : 'bg-white dark:bg-[#18181F] text-[#111113] dark:text-[#F7F6F3] border border-[#EAE5DC] dark:border-[#262630] rounded-es-xs'
                        }`}
                      >
                        <p>{msg.text}</p>

                        {/* Suggested products clickable cards */}
                        {Array.isArray(msg.suggestedProducts) && msg.suggestedProducts.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-[#E6E2D8] dark:border-[#262630] space-y-1.5">
                            {msg.suggestedProducts.map((prod) => (
                              <button
                                key={prod.id}
                                type="button"
                                onClick={() => {
                                  setSelectedProductId(prod.id);
                                }}
                                className="w-full min-h-[44px] flex items-center justify-between gap-2 p-2 rounded-xl bg-[#FAF9F7] dark:bg-[#131317] hover:bg-[#FF6B00]/10 border border-[#E6E2D8] dark:border-[#262630] transition-colors text-start cursor-pointer"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {prod.image && (
                                    <img
                                      src={prod.image}
                                      alt={prod.name}
                                      referrerPolicy="no-referrer"
                                      onError={handleStoreImageError}
                                      className="w-8 h-8 rounded-lg object-contain bg-white p-0.5 shrink-0"
                                    />
                                  )}
                                  <div className="min-w-0">
                                    <span className="text-[11px] font-bold block truncate text-[#111113] dark:text-[#F7F6F3]">
                                      {prod.name}
                                    </span>
                                    <span className="text-[10px] font-black text-[#FF6B00] font-mono tabular-nums">
                                      {Number(prod.price).toFixed(3)} {t.cart.currency}
                                    </span>
                                  </div>
                                </div>
                                <span className="text-[10px] font-bold text-[#FF6B00] shrink-0 flex items-center gap-0.5 px-1.5">
                                  {(t.chat as any).viewProductBtn || 'View'}
                                  <ArrowUpRight className="w-3 h-3" />
                                </span>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Quick action view button */}
                        {msg.actionView && (
                          <button
                            type="button"
                            onClick={() => {
                              setCurrentView(msg.actionView!);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-[#FF6B00] hover:underline cursor-pointer"
                          >
                            <ArrowUpRight className="w-3 h-3" />
                            <span>
                              {msg.actionView === 'my_orders'
                                ? t.nav.myOrders
                                : msg.actionView === 'promise'
                                ? t.nav.promise
                                : msg.actionView === 'companies'
                                ? t.nav.companies
                                : t.contactModal.title}
                            </span>
                          </button>
                        )}
                      </div>
                      <span className="text-[10px] text-[#7A756D] dark:text-[#8E8980] mt-1 px-1 font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString(timeLocale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}

                  {isChatReplying && (
                    <div className="flex items-start">
                      <div className="px-3 py-2 rounded-2xl bg-white dark:bg-[#18181F] border border-[#EAE5DC] dark:border-[#262630] text-[11px] text-[#7A756D] dark:text-[#8E8980] animate-pulse">
                        {(t.chat as any).typingNotice || '...'}
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Quick Suggestion Chips */}
                {quickChips.length > 0 && (
                  <div className="px-3 py-2 bg-white dark:bg-[#131317] border-t border-[#EFECE6] dark:border-[#22222B] flex items-center gap-1.5 overflow-x-auto scrollbar-none shrink-0">
                    {quickChips.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        disabled={isChatReplying}
                        onClick={() => handleQuickChip(chip)}
                        className="min-h-[38px] px-3 py-1.5 rounded-full bg-[#FAF9F7] dark:bg-[#18181F] border border-[#E6E2D8] dark:border-[#262630] hover:border-[#FF6B00] hover:text-[#FF6B00] text-[11px] font-bold text-[#5A5854] dark:text-[#B5B0A8] shrink-0 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}

                {/* Offline Notice & Message Form */}
                {!isOnline && (
                  <div className="px-3 py-2 bg-[#FFF7F2] dark:bg-[#18181F] border-t border-[#FF6B00]/25 text-[11px] font-bold text-[#FF6B00] flex items-center gap-1.5 shrink-0">
                    <WifiOff className="w-3.5 h-3.5 shrink-0" />
                    <span>{t.offline.chatOfflineNotice}</span>
                  </div>
                )}
                <form
                  onSubmit={handleSendMessage}
                  className="p-3 bg-white dark:bg-[#131317] border-t border-[#EFECE6] dark:border-[#22222B] flex gap-2 shrink-0"
                >
                  <input
                    type="text"
                    disabled={!isOnline}
                    placeholder={isOnline ? t.chat.placeholder : t.offline.chatOfflineNotice}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1 min-h-[44px] text-xs py-2 px-3 rounded-xl border border-[#E6E2D8] dark:border-[#262630] bg-[#FAF9F7] dark:bg-[#0B0B0D] text-[#111113] dark:text-white focus:outline-none focus:border-[#FF6B00] disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim() || isChatReplying || !isOnline}
                    aria-label={t.chat.send}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-[#FF6B00] hover:bg-[#e05e00] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl shadow-xs cursor-pointer transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};
