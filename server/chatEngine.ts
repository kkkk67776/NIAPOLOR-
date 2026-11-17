import fs from 'fs';
import {
  atomicWriteJsonSync,
  getDataFilePath,
  isCloudPersistenceEnabled,
  loadCloudJson,
  saveCloudJson,
  savePersistentJson,
} from './cloudPersistence.js';
import type {
  ChatMessage,
  ChatSuggestedProduct,
  CustomChatRule,
  Language,
  SupportChatConfig,
  SupportChatThread,
} from '../src/types/index.js';

const CHAT_DATA_FILE = getDataFilePath('support_chat_data.json');
const CLOUD_CHAT_KEY = 'echox_support_chat_data';
const MAX_THREADS = 250;
const MAX_MESSAGES_PER_THREAD = 120;

interface ChatDatabase {
  config: SupportChatConfig;
  threads: Record<string, SupportChatThread>;
}

const DEFAULT_CHAT_CONFIG: SupportChatConfig = {
  autoReplyEnabled: true,
  welcomeMessage: {
    ar: 'مرحباً بك في ECHOX Store! اسألني عن أي منتج أو سعر، مصاريف التوصيل لولايتك، طرق الدفع، أو أرسل رقم تتبع طلبيتك (مثل ECH-TN-...).',
    fr: 'Bienvenue chez ECHOX Store ! Posez-moi vos questions sur nos produits, prix, livraison (24 gouvernorats), paiement ou suivi de commande (ECH-TN-...).',
    en: 'Welcome to ECHOX Store! Ask me about any product or price, shipping across Tunisia’s 24 governorates, payment methods, or send your tracking code (e.g. ECH-TN-...).',
  },
  fallbackMessage: {
    ar: 'تم استلام رسالتك وإشعار فريق ECHOX للرد عليك هنا مباشرة. يمكنك أيضاً ذكر اسم القطعة أو كتابة رقم الطلب (ECH-TN-...) أو التواصل الفوري على الرقم +216 21 511 162.',
    fr: 'Votre message a bien été transmis à l’équipe ECHOX qui vous répondra ici. Vous pouvez aussi préciser le nom d’un article, votre numéro de suivi (ECH-TN-...) ou appeler le +216 21 511 162.',
    en: 'Your message has been sent to the ECHOX team to reply directly here. You can also mention a product name, share an order tracking code (ECH-TN-...), or call +216 21 511 162.',
  },
  customRules: [],
  updatedAt: new Date().toISOString(),
};

function sanitizeText(input: unknown, maxLen = 1500): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

function loadInitialChatDb(): ChatDatabase {
  try {
    if (fs.existsSync(CHAT_DATA_FILE)) {
      const raw = fs.readFileSync(CHAT_DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<ChatDatabase>;
      return {
        config: {
          ...DEFAULT_CHAT_CONFIG,
          ...(parsed.config || {}),
          welcomeMessage: {
            ...DEFAULT_CHAT_CONFIG.welcomeMessage,
            ...(parsed.config?.welcomeMessage || {}),
          },
          fallbackMessage: {
            ...DEFAULT_CHAT_CONFIG.fallbackMessage,
            ...(parsed.config?.fallbackMessage || {}),
          },
          customRules: Array.isArray(parsed.config?.customRules) ? parsed.config!.customRules : [],
        },
        threads: parsed.threads && typeof parsed.threads === 'object' ? parsed.threads : {},
      };
    }
  } catch (err) {
    console.warn('[ChatEngine] Notice reading local chat db:', (err as Error)?.message || err);
  }
  return {
    config: { ...DEFAULT_CHAT_CONFIG, updatedAt: new Date().toISOString() },
    threads: {},
  };
}

let chatDb: ChatDatabase = loadInitialChatDb();
let lastChatCloudSyncAt = 0;

function normalizeRemoteChatDb(remote: Partial<ChatDatabase>): ChatDatabase {
  return {
    config: remote.config
      ? {
          ...DEFAULT_CHAT_CONFIG,
          ...remote.config,
          welcomeMessage: {
            ...DEFAULT_CHAT_CONFIG.welcomeMessage,
            ...(remote.config.welcomeMessage || {}),
          },
          fallbackMessage: {
            ...DEFAULT_CHAT_CONFIG.fallbackMessage,
            ...(remote.config.fallbackMessage || {}),
          },
          customRules: Array.isArray(remote.config.customRules) ? remote.config.customRules : [],
        }
      : { ...chatDb.config },
    threads: remote.threads && typeof remote.threads === 'object' ? remote.threads : {},
  };
}

async function persistChatDb(candidate: ChatDatabase): Promise<{ ok: boolean; error?: string }> {
  const pruned: ChatDatabase = {
    config: { ...candidate.config },
    threads: { ...candidate.threads },
  };
  const threadIds = Object.keys(pruned.threads);
  if (threadIds.length > MAX_THREADS) {
    threadIds
      .sort(
        (a, b) =>
          new Date(pruned.threads[a].lastMessageAt).getTime() -
          new Date(pruned.threads[b].lastMessageAt).getTime()
      )
      .slice(0, threadIds.length - MAX_THREADS)
      .forEach((oldId) => {
        delete pruned.threads[oldId];
      });
  }
  const res = await savePersistentJson(CLOUD_CHAT_KEY, CHAT_DATA_FILE, pruned);
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  chatDb = pruned;
  lastChatCloudSyncAt = Date.now();
  return { ok: true };
}

export async function hydrateChatDbFromCloud(): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  const remote = await loadCloudJson<Partial<ChatDatabase>>(CLOUD_CHAT_KEY);
  lastChatCloudSyncAt = Date.now();
  if (!remote) {
    await saveCloudJson(CLOUD_CHAT_KEY, chatDb).catch(() => {});
    return;
  }
  const normalized = normalizeRemoteChatDb(remote);
  chatDb = normalized;
  try {
    atomicWriteJsonSync(CHAT_DATA_FILE, chatDb);
  } catch {}
}

export async function syncChatDbIfStale(force = false, maxAgeMs = 2500): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  if (!force && Date.now() - lastChatCloudSyncAt < maxAgeMs) return;
  const remote = await loadCloudJson<Partial<ChatDatabase>>(CLOUD_CHAT_KEY);
  lastChatCloudSyncAt = Date.now();
  if (remote && typeof remote === 'object') {
    chatDb = normalizeRemoteChatDb(remote);
    try {
      atomicWriteJsonSync(CHAT_DATA_FILE, chatDb);
    } catch {}
  }
}

export function getPublicChatConfig(): SupportChatConfig {
  return chatDb.config;
}

export async function updateChatConfig(payload: {
  autoReplyEnabled?: boolean;
  welcomeMessage?: Partial<{ ar: string; fr: string; en: string }>;
  fallbackMessage?: Partial<{ ar: string; fr: string; en: string }>;
  customRules?: CustomChatRule[];
}): Promise<{ ok: boolean; statusCode?: number; config?: SupportChatConfig; error?: string }> {
  await syncChatDbIfStale(true);
  const nextConfig: SupportChatConfig = {
    ...chatDb.config,
    welcomeMessage: { ...chatDb.config.welcomeMessage },
    fallbackMessage: { ...chatDb.config.fallbackMessage },
    customRules: [...chatDb.config.customRules],
  };

  if (typeof payload.autoReplyEnabled === 'boolean') {
    nextConfig.autoReplyEnabled = payload.autoReplyEnabled;
  }
  if (payload.welcomeMessage) {
    nextConfig.welcomeMessage = {
      ar: sanitizeText(payload.welcomeMessage.ar, 600) || nextConfig.welcomeMessage.ar,
      fr: sanitizeText(payload.welcomeMessage.fr, 600) || nextConfig.welcomeMessage.fr,
      en: sanitizeText(payload.welcomeMessage.en, 600) || nextConfig.welcomeMessage.en,
    };
  }
  if (payload.fallbackMessage) {
    nextConfig.fallbackMessage = {
      ar: sanitizeText(payload.fallbackMessage.ar, 600) || nextConfig.fallbackMessage.ar,
      fr: sanitizeText(payload.fallbackMessage.fr, 600) || nextConfig.fallbackMessage.fr,
      en: sanitizeText(payload.fallbackMessage.en, 600) || nextConfig.fallbackMessage.en,
    };
  }
  if (Array.isArray(payload.customRules)) {
    nextConfig.customRules = payload.customRules
      .slice(0, 40)
      .map((r, idx) => ({
        id: sanitizeText(r.id, 60) || `rule_${Date.now()}_${idx}`,
        keyword: sanitizeText(r.keyword, 120),
        replyAr: sanitizeText(r.replyAr, 800),
        replyFr: sanitizeText(r.replyFr, 800),
        replyEn: sanitizeText(r.replyEn, 800),
      }))
      .filter((r) => r.keyword && (r.replyAr || r.replyFr || r.replyEn));
  }
  nextConfig.updatedAt = new Date().toISOString();

  const saved = await persistChatDb({ config: nextConfig, threads: chatDb.threads });
  if (!saved.ok) {
    return {
      ok: false,
      statusCode: 503,
      error: saved.error || 'تعذر حفظ إعدادات المحادثة في قاعدة البيانات.',
    };
  }
  return { ok: true, config: chatDb.config };
}

export function normalizeChatSessionId(rawId: unknown): string {
  const cleaned = typeof rawId === 'string' ? rawId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) : '';
  return cleaned.length >= 6 ? cleaned : '';
}

export function getChatThread(sessionId: string): SupportChatThread | null {
  const safeId = normalizeChatSessionId(sessionId);
  if (!safeId) return null;
  return chatDb.threads[safeId] || null;
}

export async function recordCustomerChatExchange(params: {
  sessionId: string;
  language?: Language;
  customerLabel?: string;
  customerText: string;
  autoReplyText?: string;
  suggestedProducts?: ChatSuggestedProduct[];
  actionView?: string;
}): Promise<{ ok: boolean; statusCode?: number; thread?: SupportChatThread; error?: string }> {
  await syncChatDbIfStale(true);
  const safeId = normalizeChatSessionId(params.sessionId);
  if (!safeId) {
    return { ok: false, statusCode: 400, error: 'معرف جلسة المحادثة غير صالح.' };
  }
  const customerText = sanitizeText(params.customerText, 1200);
  if (!customerText) {
    return { ok: false, statusCode: 400, error: 'نص الرسالة فارغ.' };
  }

  const lang: Language = params.language === 'fr' || params.language === 'en' ? params.language : 'ar';
  const now = new Date().toISOString();

  const existingThread = chatDb.threads[safeId];
  const thread: SupportChatThread = existingThread
    ? { ...existingThread, messages: [...existingThread.messages] }
    : {
        sessionId: safeId,
        customerLabel: sanitizeText(params.customerLabel, 60) || `حريف #${safeId.slice(-4).toUpperCase()}`,
        language: lang,
        messages: [
          {
            id: `msg_welcome_${Date.now()}`,
            sender: 'owner',
            source: 'auto',
            text: chatDb.config.welcomeMessage[lang] || chatDb.config.welcomeMessage.ar,
            timestamp: now,
          },
        ],
        unreadByOwner: 0,
        lastMessageAt: now,
        createdAt: now,
      };

  thread.language = lang;

  const customerMsg: ChatMessage = {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sender: 'customer',
    source: 'customer',
    text: customerText,
    timestamp: now,
  };
  thread.messages.push(customerMsg);
  thread.unreadByOwner = (thread.unreadByOwner || 0) + 1;

  const replyText = sanitizeText(params.autoReplyText, 1600);
  if (replyText && chatDb.config.autoReplyEnabled) {
    const autoMsg: ChatMessage = {
      id: `chat_auto_${Date.now() + 1}_${Math.random().toString(36).slice(2, 6)}`,
      sender: 'owner',
      source: 'auto',
      text: replyText,
      timestamp: new Date(Date.now() + 50).toISOString(),
      suggestedProducts: Array.isArray(params.suggestedProducts) ? params.suggestedProducts.slice(0, 4) : undefined,
      actionView: sanitizeText(params.actionView, 40) || undefined,
    };
    thread.messages.push(autoMsg);
  }

  if (thread.messages.length > MAX_MESSAGES_PER_THREAD) {
    thread.messages = thread.messages.slice(-MAX_MESSAGES_PER_THREAD);
  }
  thread.lastMessageAt = now;

  const saved = await persistChatDb({
    config: chatDb.config,
    threads: { ...chatDb.threads, [safeId]: thread },
  });
  if (!saved.ok) {
    return { ok: false, statusCode: 503, error: saved.error || 'تعذر حفظ رسالة المحادثة.' };
  }
  return { ok: true, thread };
}

export async function adminSendChatReply(params: {
  sessionId: string;
  replyText: string;
}): Promise<{ ok: boolean; statusCode?: number; thread?: SupportChatThread; message?: ChatMessage; error?: string }> {
  await syncChatDbIfStale(true);
  const safeId = normalizeChatSessionId(params.sessionId);
  if (!safeId || !chatDb.threads[safeId]) {
    return { ok: false, statusCode: 404, error: 'المحادثة غير موجودة.' };
  }
  const replyText = sanitizeText(params.replyText, 1600);
  if (!replyText) {
    return { ok: false, statusCode: 400, error: 'نص الرد مطلوب.' };
  }

  const baseThread = chatDb.threads[safeId];
  const now = new Date().toISOString();
  const ownerMsg: ChatMessage = {
    id: `chat_owner_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sender: 'owner',
    source: 'owner',
    text: replyText,
    timestamp: now,
  };
  const nextMessages = [...baseThread.messages, ownerMsg].slice(-MAX_MESSAGES_PER_THREAD);
  const nextThread: SupportChatThread = {
    ...baseThread,
    messages: nextMessages,
    unreadByOwner: 0,
    lastMessageAt: now,
  };

  const saved = await persistChatDb({
    config: chatDb.config,
    threads: { ...chatDb.threads, [safeId]: nextThread },
  });
  if (!saved.ok) {
    return { ok: false, statusCode: 503, error: saved.error || 'تعذر حفظ الرد في قاعدة البيانات.' };
  }
  return { ok: true, thread: nextThread, message: ownerMsg };
}

export async function markThreadReadByOwner(sessionId: string): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  await syncChatDbIfStale(true);
  const safeId = normalizeChatSessionId(sessionId);
  if (!safeId || !chatDb.threads[safeId]) return { ok: false, statusCode: 404, error: 'المحادثة غير موجودة.' };
  const nextThread: SupportChatThread = {
    ...chatDb.threads[safeId],
    unreadByOwner: 0,
  };
  const saved = await persistChatDb({
    config: chatDb.config,
    threads: { ...chatDb.threads, [safeId]: nextThread },
  });
  if (!saved.ok) return { ok: false, statusCode: 503, error: saved.error };
  return { ok: true };
}

export async function deleteChatThread(sessionId: string): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  await syncChatDbIfStale(true);
  const safeId = normalizeChatSessionId(sessionId);
  if (!safeId || !chatDb.threads[safeId]) return { ok: false, statusCode: 404, error: 'المحادثة غير موجودة.' };
  const nextThreads = { ...chatDb.threads };
  delete nextThreads[safeId];
  const saved = await persistChatDb({
    config: chatDb.config,
    threads: nextThreads,
  });
  if (!saved.ok) return { ok: false, statusCode: 503, error: saved.error };
  return { ok: true };
}

export function listAdminChatThreads(): {
  threads: SupportChatThread[];
  totalUnread: number;
  config: SupportChatConfig;
} {
  const threads = Object.values(chatDb.threads).sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  );
  const totalUnread = threads.reduce((acc, t) => acc + (t.unreadByOwner || 0), 0);
  return { threads, totalUnread, config: chatDb.config };
}

export async function restoreChatConfigSnapshot(
  incoming?: Partial<SupportChatConfig>
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  if (!incoming || typeof incoming !== 'object' || Object.keys(incoming).length === 0) {
    return { ok: true };
  }
  const res = await updateChatConfig(incoming);
  return { ok: res.ok, statusCode: res.statusCode, error: res.error };
}

