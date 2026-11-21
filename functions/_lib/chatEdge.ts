import type {
  ChatMessage,
  ChatSuggestedProduct,
  CustomChatRule,
  Language,
  SupportChatConfig,
  SupportChatThread,
} from '../../src/types/index';
import {
  checkEdgeSlidingWindowLimit,
  EdgeEnv,
  getEdgeClientIp,
  hmacSha256Hex,
  jsonResponse,
  loadEdgeDocWithMeta,
  mutateEdgeDocWithRetry,
  requireEdgeAdminAuth,
  resolveSharedHmacSecret,
  timingSafeEqualHex,
  verifyEdgeOwnerSession,
} from './firestoreEdge';
import { appendEdgeAdminNotification } from './notificationsEdge';

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
    ar: 'مرحباً بك في NIAPOLOR! اسألني عن أي منتج أو سعر، مصاريف التوصيل لولايتك، طرق الدفع، أو أرسل رقم تتبع طلبيتك (مثل ECH-TN-...).',
    fr: 'Bienvenue chez NIAPOLOR ! Posez-moi vos questions sur nos produits, prix, livraison (24 gouvernorats), paiement ou suivi de commande (ECH-TN-...).',
    en: 'Welcome to NIAPOLOR! Ask me about any product or price, shipping across Tunisia’s 24 governorates, payment methods, or send your tracking code (e.g. ECH-TN-...).',
  },
  fallbackMessage: {
    ar: 'تم استلام رسالتك وإشعار فريق NIAPOLOR للرد عليك هنا مباشرة. يمكنك أيضاً ذكر اسم القطعة أو كتابة رقم الطلب (ECH-TN-...) أو التواصل الفوري على الرقم +216 21 511 162.',
    fr: 'Votre message a bien été transmis à l’équipe NIAPOLOR qui vous répondra ici. Vous pouvez aussi préciser le nom d’un article, votre numéro de suivi (ECH-TN-...) ou appeler le +216 21 511 162.',
    en: 'Your message has been sent to the NIAPOLOR team to reply directly here. You can also mention a product name, share an order tracking code (ECH-TN-...), or call +216 21 511 162.',
  },
  customRules: [],
  updatedAt: new Date(0).toISOString(),
};

function sanitizeText(input: unknown, maxLen = 1500): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

const ALLOWED_CHAT_ACTION_VIEWS = new Set(['my_orders', 'promise', 'companies', 'contact']);

function isSafeChatMediaUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 1000) return false;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.includes('<svg')) {
    return false;
  }
  if (lower.startsWith('data:')) {
    return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed);
  }
  return trimmed.startsWith('/') || /^https:\/\//i.test(trimmed);
}

function sanitizeSuggestedProducts(rawList: unknown): ChatSuggestedProduct[] | undefined {
  if (!Array.isArray(rawList)) return undefined;
  const out: ChatSuggestedProduct[] = [];
  for (const item of rawList.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<ChatSuggestedProduct>;
    const id = sanitizeText(candidate.id, 80);
    const name = sanitizeText(candidate.name, 140);
    const price = Number(candidate.price);
    const image = isSafeChatMediaUrl(candidate.image) ? String(candidate.image).trim() : '';
    if (!id || !name || !Number.isFinite(price) || price <= 0) continue;
    out.push({ id, name, price, image });
  }
  return out.length > 0 ? out : undefined;
}

async function issueEdgeChatToken(env: EdgeEnv, sessionId: string): Promise<string | null> {
  const secret = await resolveSharedHmacSecret(env);
  if (!secret || !sessionId) return null;
  const sig = await hmacSha256Hex(secret, `chat1:${sessionId}`);
  return `chat1.${sessionId}.${sig}`;
}

async function verifyEdgeChatToken(env: EdgeEnv, token: string, sessionId: string): Promise<boolean> {
  if (!token || !sessionId) return false;
  const expected = await issueEdgeChatToken(env, sessionId);
  if (!expected) return false;
  return timingSafeEqualHex(token.trim(), expected);
}

function normalizeChatSessionId(rawId: unknown): string {
  const cleaned = typeof rawId === 'string' ? rawId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) : '';
  return cleaned.length >= 6 ? cleaned : '';
}

function normalizeChatDb(raw: Partial<ChatDatabase> | null): ChatDatabase {
  const cfg = raw?.config;
  return {
    config: cfg
      ? {
          ...DEFAULT_CHAT_CONFIG,
          ...cfg,
          welcomeMessage: {
            ...DEFAULT_CHAT_CONFIG.welcomeMessage,
            ...(cfg.welcomeMessage || {}),
          },
          fallbackMessage: {
            ...DEFAULT_CHAT_CONFIG.fallbackMessage,
            ...(cfg.fallbackMessage || {}),
          },
          customRules: Array.isArray(cfg.customRules) ? cfg.customRules : [],
        }
      : { ...DEFAULT_CHAT_CONFIG },
    threads: raw?.threads && typeof raw.threads === 'object' ? { ...raw.threads } : {},
  };
}

function pruneThreads(threads: Record<string, SupportChatThread>): Record<string, SupportChatThread> {
  const copy = { ...threads };
  const ids = Object.keys(copy);
  if (ids.length > MAX_THREADS) {
    ids
      .sort(
        (a, b) =>
          new Date(copy[a].lastMessageAt).getTime() - new Date(copy[b].lastMessageAt).getTime()
      )
      .slice(0, ids.length - MAX_THREADS)
      .forEach((oldId) => {
        delete copy[oldId];
      });
  }
  return copy;
}

export async function handleEdgeChatRoute(
  request: Request,
  env: EdgeEnv,
  pathname: string,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  if (method === 'GET' && pathname === '/api/chat/config') {
    const loaded = await loadEdgeDocWithMeta<Partial<ChatDatabase>>(env, CLOUD_CHAT_KEY);
    if (!loaded.ok) return jsonResponse({ success: false, error: loaded.error }, 503);
    const db = normalizeChatDb(loaded.data);
    return jsonResponse({ success: true, config: db.config });
  }

  const sessionMatch = pathname.match(/^\/api\/chat\/session\/([^/]+)$/);
  if (method === 'GET' && sessionMatch) {
    const safeId = normalizeChatSessionId(decodeURIComponent(sessionMatch[1]));
    if (!safeId) return jsonResponse({ success: true, thread: null });
    const loaded = await loadEdgeDocWithMeta<Partial<ChatDatabase>>(env, CLOUD_CHAT_KEY);
    if (!loaded.ok) return jsonResponse({ success: false, error: loaded.error }, 503);
    const db = normalizeChatDb(loaded.data);
    const thread = db.threads[safeId] || null;
    if (!thread) {
      return jsonResponse({ success: true, thread: null });
    }
    const adminSess = await verifyEdgeOwnerSession(request, env);
    const isAdmin = Boolean(adminSess && adminSess.codeVerified);
    const chatToken = request.headers.get('x-chat-token') || '';
    const tokenOk = isAdmin || (await verifyEdgeChatToken(env, chatToken, safeId));
    if (!tokenOk) {
      return jsonResponse({ success: false, error: 'رمز ملكية جلسة المحادثة مطلوب أو غير صالح.' }, 403);
    }
    return jsonResponse({ success: true, thread });
  }

  const msgMatch = pathname.match(/^\/api\/chat\/session\/([^/]+)\/message$/);
  if (method === 'POST' && msgMatch) {
    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('supportChat', ip, 30, 60_000);
    if (!rate.allowed) {
      return jsonResponse(
        { success: false, error: `تم تجاوز حد الرسائل، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` },
        429
      );
    }

    const safeId = normalizeChatSessionId(decodeURIComponent(msgMatch[1]));
    if (!safeId) {
      return jsonResponse({ success: false, error: 'معرف جلسة المحادثة غير صالح.' }, 400);
    }
    const existingCheck = await loadEdgeDocWithMeta<Partial<ChatDatabase>>(env, CLOUD_CHAT_KEY);
    if (!existingCheck.ok) return jsonResponse({ success: false, error: existingCheck.error }, 503);
    const existingDb = normalizeChatDb(existingCheck.data);
    if (existingDb.threads[safeId]) {
      const adminSess = await verifyEdgeOwnerSession(request, env);
      const isAdmin = Boolean(adminSess && adminSess.codeVerified);
      const chatToken = request.headers.get('x-chat-token') || '';
      const tokenOk = isAdmin || (await verifyEdgeChatToken(env, chatToken, safeId));
      if (!tokenOk) {
        return jsonResponse({ success: false, error: 'رمز ملكية جلسة المحادثة مطلوب لإضافة رسائل لهذه المحادثة.' }, 403);
      }
    }
    const body = (await request.json().catch(() => ({}))) as {
      language?: Language;
      customerLabel?: string;
      customerText?: string;
      autoReplyText?: string;
      suggestedProducts?: ChatSuggestedProduct[];
      actionView?: string;
    };
    const customerText = sanitizeText(body.customerText, 1200);
    if (!customerText) {
      return jsonResponse({ success: false, error: 'نص الرسالة فارغ.' }, 400);
    }

    const lang: Language = body.language === 'fr' || body.language === 'en' ? body.language : 'ar';

    const mut = await mutateEdgeDocWithRetry<ChatDatabase, SupportChatThread>(env, CLOUD_CHAT_KEY, async (raw) => {
      const db = normalizeChatDb(raw);
      const now = new Date().toISOString();
      const existingThread = db.threads[safeId];
      const thread: SupportChatThread = existingThread
        ? { ...existingThread, messages: [...existingThread.messages] }
        : {
            sessionId: safeId,
            customerLabel: sanitizeText(body.customerLabel, 60) || `حريف #${safeId.slice(-4).toUpperCase()}`,
            language: lang,
            messages: [
              {
                id: `msg_welcome_${Date.now()}`,
                sender: 'owner',
                source: 'auto',
                text: db.config.welcomeMessage[lang] || db.config.welcomeMessage.ar,
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

      const replyText = sanitizeText(body.autoReplyText, 1600);
      if (replyText && db.config.autoReplyEnabled) {
        const cleanAction = sanitizeText(body.actionView, 40);
        thread.messages.push({
          id: `chat_auto_${Date.now() + 1}_${Math.random().toString(36).slice(2, 6)}`,
          sender: 'owner',
          source: 'auto',
          text: replyText,
          timestamp: new Date(Date.now() + 50).toISOString(),
          suggestedProducts: sanitizeSuggestedProducts(body.suggestedProducts),
          actionView: ALLOWED_CHAT_ACTION_VIEWS.has(cleanAction) ? cleanAction : undefined,
        });
      }

      if (thread.messages.length > MAX_MESSAGES_PER_THREAD) {
        thread.messages = thread.messages.slice(-MAX_MESSAGES_PER_THREAD);
      }
      thread.lastMessageAt = now;

      return {
        nextDoc: {
          config: db.config,
          threads: pruneThreads({ ...db.threads, [safeId]: thread }),
        },
        result: thread,
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);

    const notifTask = appendEdgeAdminNotification(env, {
      category: 'support',
      severity: 'info',
      title: '💬 رسالة جديدة في دعم الزبائن',
      body: `${body.customerLabel || 'زبون'}: ${customerText.slice(0, 120)}`,
      url: '/owner/dashboard',
    });
    if (waitUntil) waitUntil(notifTask);
    else await notifTask;

    const chatToken = await issueEdgeChatToken(env, safeId);
    return jsonResponse({
      success: true,
      thread: mut.result,
      chatToken: chatToken || undefined,
    });
  }

  if (pathname.startsWith('/api/admin/chat/')) {
    const auth = await requireEdgeAdminAuth(request, env);
    if (!auth.ok) return auth.response;

    if (method === 'GET' && pathname === '/api/admin/chat/threads') {
      const loaded = await loadEdgeDocWithMeta<Partial<ChatDatabase>>(env, CLOUD_CHAT_KEY);
      if (!loaded.ok) return jsonResponse({ success: false, error: loaded.error }, 503);
      const db = normalizeChatDb(loaded.data);
      const threads = Object.values(db.threads).sort(
        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );
      const totalUnread = threads.reduce((acc, t) => acc + (t.unreadByOwner || 0), 0);
      return jsonResponse({ success: true, threads, totalUnread, config: db.config });
    }

    if (method === 'PUT' && pathname === '/api/admin/chat/config') {
      const payload = (await request.json().catch(() => ({}))) as {
        autoReplyEnabled?: boolean;
        welcomeMessage?: Partial<{ ar: string; fr: string; en: string }>;
        fallbackMessage?: Partial<{ ar: string; fr: string; en: string }>;
        customRules?: CustomChatRule[];
      };
      const mut = await mutateEdgeDocWithRetry<ChatDatabase, SupportChatConfig>(env, CLOUD_CHAT_KEY, async (raw) => {
        const db = normalizeChatDb(raw);
        const nextConfig: SupportChatConfig = {
          ...db.config,
          welcomeMessage: { ...db.config.welcomeMessage },
          fallbackMessage: { ...db.config.fallbackMessage },
          customRules: [...db.config.customRules],
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
        return {
          nextDoc: { config: nextConfig, threads: db.threads },
          result: nextConfig,
        };
      });
      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      return jsonResponse({ success: true, config: mut.result });
    }

    const replyMatch = pathname.match(/^\/api\/admin\/chat\/threads\/([^/]+)\/reply$/);
    if (method === 'POST' && replyMatch) {
      const safeId = normalizeChatSessionId(decodeURIComponent(replyMatch[1]));
      const body = (await request.json().catch(() => ({}))) as { replyText?: string };
      const replyText = sanitizeText(body.replyText, 1600);
      if (!replyText) {
        return jsonResponse({ success: false, error: 'نص الرد مطلوب.' }, 400);
      }

      const mut = await mutateEdgeDocWithRetry<
        ChatDatabase,
        { notFound?: boolean; thread?: SupportChatThread; message?: ChatMessage }
      >(env, CLOUD_CHAT_KEY, async (raw) => {
        const db = normalizeChatDb(raw);
        if (!safeId || !db.threads[safeId]) {
          return { skipWrite: true, result: { notFound: true } };
        }
        const now = new Date().toISOString();
        const ownerMsg: ChatMessage = {
          id: `chat_owner_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sender: 'owner',
          source: 'owner',
          text: replyText,
          timestamp: now,
        };
        const baseThread = db.threads[safeId];
        const nextThread: SupportChatThread = {
          ...baseThread,
          messages: [...baseThread.messages, ownerMsg].slice(-MAX_MESSAGES_PER_THREAD),
          unreadByOwner: 0,
          lastMessageAt: now,
        };
        return {
          nextDoc: { config: db.config, threads: { ...db.threads, [safeId]: nextThread } },
          result: { thread: nextThread, message: ownerMsg },
        };
      });
      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      if (mut.result?.notFound) return jsonResponse({ success: false, error: 'المحادثة غير موجودة.' }, 404);
      return jsonResponse({ success: true, thread: mut.result?.thread, message: mut.result?.message });
    }

    const readMatch = pathname.match(/^\/api\/admin\/chat\/threads\/([^/]+)\/read$/);
    if (method === 'POST' && readMatch) {
      const safeId = normalizeChatSessionId(decodeURIComponent(readMatch[1]));
      const mut = await mutateEdgeDocWithRetry<ChatDatabase, { notFound?: boolean }>(
        env,
        CLOUD_CHAT_KEY,
        async (raw) => {
          const db = normalizeChatDb(raw);
          if (!safeId || !db.threads[safeId]) return { skipWrite: true, result: { notFound: true } };
          const nextThread: SupportChatThread = { ...db.threads[safeId], unreadByOwner: 0 };
          return {
            nextDoc: { config: db.config, threads: { ...db.threads, [safeId]: nextThread } },
            result: {},
          };
        }
      );
      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      if (mut.result?.notFound) return jsonResponse({ success: false, error: 'المحادثة غير موجودة.' }, 404);
      return jsonResponse({ success: true });
    }

    const deleteMatch = pathname.match(/^\/api\/admin\/chat\/threads\/([^/]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const safeId = normalizeChatSessionId(decodeURIComponent(deleteMatch[1]));
      const mut = await mutateEdgeDocWithRetry<ChatDatabase, { notFound?: boolean }>(
        env,
        CLOUD_CHAT_KEY,
        async (raw) => {
          const db = normalizeChatDb(raw);
          if (!safeId || !db.threads[safeId]) return { skipWrite: true, result: { notFound: true } };
          const nextThreads = { ...db.threads };
          delete nextThreads[safeId];
          return { nextDoc: { config: db.config, threads: nextThreads }, result: {} };
        }
      );
      if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
      if (mut.result?.notFound) return jsonResponse({ success: false, error: 'المحادثة غير موجودة.' }, 404);
      return jsonResponse({ success: true });
    }
  }

  return null;
}
