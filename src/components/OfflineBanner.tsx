import React from 'react';
import { WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useStore } from '../context/StoreContext';

export const OfflineBanner: React.FC = () => {
  const {
    isOnline,
    isReconnecting,
    justReconnected,
    lastSyncedAt,
    retryConnection,
    products,
    language,
    t,
  } = useStore();

  if (isOnline && !justReconnected) {
    return null;
  }

  if (isOnline && justReconnected) {
    return (
      <div className="max-w-7xl mx-auto w-full px-2.5 sm:px-4 pt-3" role="status" aria-live="polite">
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 flex items-center justify-between gap-3 text-emerald-900 dark:text-emerald-200 text-xs font-bold">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="truncate">{t.offline.restoredNotice}</span>
          </div>
        </div>
      </div>
    );
  }

  const locale = language === 'fr' ? 'fr-TN' : language === 'en' ? 'en-GB' : 'ar-TN';
  const formattedSync = lastSyncedAt
    ? (() => {
        try {
          return new Date(lastSyncedAt).toLocaleString(locale, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        } catch {
          return null;
        }
      })()
    : null;

  return (
    <div className="max-w-7xl mx-auto w-full px-2.5 sm:px-4 pt-3" role="status" aria-live="polite">
      <div className="rounded-2xl border border-[#FF6B00]/30 bg-[#FFF7F2] dark:bg-[#111827] px-3.5 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#FF6B00]/15 text-[#FF6B00] flex items-center justify-center shrink-0">
            <WifiOff className="w-4 h-4" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs sm:text-sm font-black text-[#0F172A] dark:text-white leading-snug">
              {t.offline.title}
            </p>
            <p className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {products.length > 0 ? t.offline.cachedNotice : t.offline.noCachedNotice}
              {formattedSync && (
                <>
                  {' '}
                  <span aria-hidden="true">·</span>{' '}
                  <span className="text-slate-500 dark:text-slate-400 font-semibold">
                    {t.offline.lastSyncedPrefix} {formattedSync}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={isReconnecting}
          onClick={() => {
            void retryConnection();
          }}
          className="px-4 py-2 min-h-[38px] rounded-xl bg-[#FF6B00] hover:bg-[#E05E00] disabled:opacity-60 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
          <span>{isReconnecting ? t.offline.retryingBtn : t.offline.retryBtn}</span>
        </button>
      </div>
    </div>
  );
};
