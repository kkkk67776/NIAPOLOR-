import {
  INITIAL_COMPANIES,
  INITIAL_OWNER_SETTINGS,
  INITIAL_PRODUCTS,
  INITIAL_SITE_SETTINGS,
} from '../../src/data/initialData';
import type {
  CategoryItem,
  Company,
  ContactInquiry,
  OwnerSettings,
  Product,
  PromoBanner,
  SiteSettings,
} from '../../src/types/index';
import {
  checkEdgeSlidingWindowLimit,
  EdgeEnv,
  getEdgeClientIp,
  getEdgePersistenceStatus,
  jsonResponse,
  loadEdgeDocWithMeta,
  mutateEdgeDocWithRetry,
  requireEdgeAdminAuth,
} from './firestoreEdge';
import { appendEdgeAdminNotification, appendEdgePublicAnnouncement } from './notificationsEdge';
import { syncEdgeCatalogSnapshot } from './paymentsEdge';

const CLOUD_STORE_KEY = 'echox:storefront_state';

const DEFAULT_CATEGORIES: CategoryItem[] = [
  { id: 'all', label: 'الكل', icon: '⚡', desc: 'كافة المعروضات المعتمدة' },
  { id: 'power_tools', label: 'أدوات ومعدات ورشات', icon: '🔧', desc: 'مثاقب، مناشير، ومعدات ورشات' },
  { id: 'auto_parts', label: 'قطع غيار سيارات', icon: '🚗', desc: 'قطع ميكانيكية وكهربائية للسيارات' },
  { id: 'electronics', label: 'أجهزة قياس وإلكترونيات', icon: '🔌', desc: 'أجهزة قياس، لوحات وقطع إلكترونية' },
  { id: 'industrial', label: 'معدات صناعية ثقيلة', icon: '🏭', desc: 'معدات المصانع والورشات الثقيلة' },
  { id: 'smart_home', label: 'أنظمة وحماية ذكية', icon: '🏠', desc: 'أتمتة وحماية المنازل الذكية' },
];

const DEFAULT_BANNERS: PromoBanner[] = [
  {
    id: 'banner_1',
    tag: 'عروض حصرية',
    title: 'عروض وتخفيضات اليوم على كافة المعدات وقطع الغيار',
    subtitle: 'توصيل سريع لكافة الـ24 ولاية والدفع عند المعاينة والاستلام',
    active: true,
    bgGradient: 'from-[#FF6B00] via-[#F97316] to-[#EA580C]',
  },
];

const DEFAULT_INQUIRIES: ContactInquiry[] = [
  {
    id: 'inq_1',
    senderName: 'كمال التريكي',
    email: 'kamel.triki@gmail.com',
    phone: '+216 55 120 900',
    subject: 'استفسار حول توافق مصباح Matrix LED مع موديل W205',
    message:
      'السلام عليكم، هل مصباح الكريستال يركب مباشرة على موديل 2018 دون الحاجة إلى تعديل أسلاك أو برمجة كمبيوتر؟ شكراً.',
    createdAt: '2026-11-05T10:15:00Z',
    read: true,
    reply: 'وعليكم السلام سي كمال. نعم يتوافق مباشرة Plug & Play مع ضمان التشغيل الكامل.',
    repliedAt: '2026-11-05T11:00:00Z',
  },
];

export interface StorefrontDatabase {
  products: Product[];
  companies: Company[];
  categories: CategoryItem[];
  banners: PromoBanner[];
  siteSettings: SiteSettings;
  ownerSettings: OwnerSettings;
  inquiries: ContactInquiry[];
  updatedAt: string;
}

function createInitialStoreState(): StorefrontDatabase {
  return {
    products: INITIAL_PRODUCTS,
    companies: INITIAL_COMPANIES,
    categories: DEFAULT_CATEGORIES,
    banners: DEFAULT_BANNERS,
    siteSettings: INITIAL_SITE_SETTINGS,
    ownerSettings: INITIAL_OWNER_SETTINGS,
    inquiries: DEFAULT_INQUIRIES,
    updatedAt: new Date(0).toISOString(),
  };
}

function mergeMultilingual(
  base: { ar: string; fr: string; en: string } | undefined,
  patch?: Partial<{ ar: string; fr: string; en: string }>
): { ar: string; fr: string; en: string } {
  return {
    ar: patch?.ar ?? base?.ar ?? '',
    fr: patch?.fr ?? base?.fr ?? '',
    en: patch?.en ?? base?.en ?? '',
  };
}

export function mergeStoreState(raw: Partial<StorefrontDatabase> | null): StorefrontDatabase {
  const def = createInitialStoreState();
  if (!raw || typeof raw !== 'object') return def;
  return {
    products: Array.isArray(raw.products) ? raw.products : def.products,
    companies: Array.isArray(raw.companies) ? raw.companies : def.companies,
    categories: Array.isArray(raw.categories) && raw.categories.length > 0 ? raw.categories : def.categories,
    banners: Array.isArray(raw.banners) ? raw.banners : def.banners,
    siteSettings: {
      ...def.siteSettings,
      ...(raw.siteSettings || {}),
      slogan: mergeMultilingual(def.siteSettings.slogan, raw.siteSettings?.slogan),
      description: mergeMultilingual(def.siteSettings.description, raw.siteSettings?.description),
      addressMultilingual: mergeMultilingual(
        def.siteSettings.addressMultilingual,
        raw.siteSettings?.addressMultilingual
      ),
      workingHours: mergeMultilingual(def.siteSettings.workingHours, raw.siteSettings?.workingHours),
      announcementText: mergeMultilingual(
        def.siteSettings.announcementText,
        raw.siteSettings?.announcementText
      ),
    },
    ownerSettings: {
      ...def.ownerSettings,
      ...(raw.ownerSettings || {}),
      bio: mergeMultilingual(def.ownerSettings.bio, raw.ownerSettings?.bio),
    },
    inquiries: Array.isArray(raw.inquiries) ? raw.inquiries : def.inquiries,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString(),
  };
}

export async function getEdgeActiveProductIds(env: EdgeEnv): Promise<string[] | null> {
  const loaded = await loadEdgeDocWithMeta<Partial<StorefrontDatabase>>(env, CLOUD_STORE_KEY);
  if (!loaded.ok) return null;
  const db = mergeStoreState(loaded.data);
  const ids = db.products
    .filter((p) => p && p.active !== false && typeof p.id === 'string' && p.id.trim())
    .map((p) => String(p.id).trim());
  return ids.length > 0 ? ids : null;
}

export async function handleEdgeStoreRoute(
  request: Request,
  env: EdgeEnv,
  pathname: string,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  if (method === 'GET' && pathname === '/api/store/state') {
    const loaded = await loadEdgeDocWithMeta<Partial<StorefrontDatabase>>(env, CLOUD_STORE_KEY);
    if (!loaded.ok) {
      return jsonResponse({ success: false, error: loaded.error }, 503);
    }
    const db = mergeStoreState(loaded.data);
    return jsonResponse({
      success: true,
      products: db.products,
      companies: db.companies,
      categories: db.categories,
      banners: db.banners,
      siteSettings: db.siteSettings,
      updatedAt: db.updatedAt,
    });
  }

  if (method === 'GET' && pathname === '/api/admin/store/state') {
    const auth = await requireEdgeAdminAuth(request, env);
    if (!auth.ok) return auth.response;

    const loaded = await loadEdgeDocWithMeta<Partial<StorefrontDatabase>>(env, CLOUD_STORE_KEY);
    if (!loaded.ok) {
      return jsonResponse({ success: false, error: loaded.error }, 503);
    }
    const db = mergeStoreState(loaded.data);
    return jsonResponse({
      success: true,
      products: db.products,
      companies: db.companies,
      categories: db.categories,
      banners: db.banners,
      siteSettings: db.siteSettings,
      updatedAt: db.updatedAt,
      ownerSettings: db.ownerSettings,
      inquiries: db.inquiries,
      persistenceStatus: getEdgePersistenceStatus(env),
    });
  }

  if (method === 'PUT' && pathname === '/api/admin/store/state') {
    const auth = await requireEdgeAdminAuth(request, env);
    if (!auth.ok) return auth.response;

    const patch = (await request.json().catch(() => null)) as Partial<StorefrontDatabase> | null;
    if (!patch || typeof patch !== 'object') {
      return jsonResponse({ success: false, error: 'بيانات غير صالحة.' }, 400);
    }

    let prevProductsSnapshot: Product[] = [];
    let prevBannersSnapshot: PromoBanner[] = [];

    const mut = await mutateEdgeDocWithRetry<StorefrontDatabase, StorefrontDatabase>(
      env,
      CLOUD_STORE_KEY,
      async (raw) => {
        const current = mergeStoreState(raw);
        prevProductsSnapshot = current.products;
        prevBannersSnapshot = current.banners;

        const next: StorefrontDatabase = {
          ...current,
          updatedAt: new Date().toISOString(),
        };
        if (Array.isArray(patch.products)) next.products = patch.products;
        if (Array.isArray(patch.companies)) next.companies = patch.companies;
        if (Array.isArray(patch.categories) && patch.categories.length > 0) next.categories = patch.categories;
        if (Array.isArray(patch.banners)) next.banners = patch.banners;
        if (patch.siteSettings && typeof patch.siteSettings === 'object') {
          next.siteSettings = {
            ...next.siteSettings,
            ...patch.siteSettings,
            slogan: mergeMultilingual(next.siteSettings.slogan, patch.siteSettings.slogan),
            description: mergeMultilingual(next.siteSettings.description, patch.siteSettings.description),
            addressMultilingual: mergeMultilingual(
              next.siteSettings.addressMultilingual,
              patch.siteSettings.addressMultilingual
            ),
            workingHours: mergeMultilingual(next.siteSettings.workingHours, patch.siteSettings.workingHours),
            announcementText: mergeMultilingual(
              next.siteSettings.announcementText,
              patch.siteSettings.announcementText
            ),
          };
        }
        if (patch.ownerSettings && typeof patch.ownerSettings === 'object') {
          next.ownerSettings = {
            ...next.ownerSettings,
            ...patch.ownerSettings,
            bio: mergeMultilingual(next.ownerSettings.bio, patch.ownerSettings.bio),
          };
        }
        if (Array.isArray(patch.inquiries)) next.inquiries = patch.inquiries;

        return { nextDoc: next, result: next };
      }
    );

    if (!mut.ok || !mut.result) {
      return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    }

    const savedState = mut.result;
    const catSync = await syncEdgeCatalogSnapshot(env, savedState.products, { replaceAll: true });
    if (!catSync.ok) {
      return jsonResponse(
        { success: false, error: catSync.error || 'تعذر مزامنة أسعار الكاتالوج في محرك الدفع.' },
        catSync.statusCode || 503
      );
    }

    const changedSections: string[] = [];
    if (Array.isArray(patch.products)) changedSections.push('المنتجات');
    if (Array.isArray(patch.categories)) changedSections.push('التصنيفات');
    if (Array.isArray(patch.companies)) changedSections.push('الشركات');
    if (Array.isArray(patch.banners)) changedSections.push('البانرات');
    if (patch.siteSettings) changedSections.push('إعدادات المتجر');
    if (patch.ownerSettings) changedSections.push('إعدادات المالك');

    const tasks: Array<Promise<void>> = [
      appendEdgeAdminNotification(env, {
        category: 'activity',
        severity: 'info',
        title: '⚙️ تحديث في غرفة التحكم',
        body:
          changedSections.length > 0
            ? `تم تحديث وحفظ: ${changedSections.join('، ')}`
            : 'تم حفظ تعديلات المتجر بشكل دائم.',
        url: '/owner/dashboard',
      }),
    ];

    if (Array.isArray(patch.products) && savedState.products.length > prevProductsSnapshot.length) {
      const newest = savedState.products.find((p) => !prevProductsSnapshot.some((old) => old.id === p.id));
      if (newest) {
        tasks.push(
          appendEdgePublicAnnouncement(env, {
            tag: 'منتج جديد',
            title: `🆕 منتج جديد في ECHOX Store: ${newest.name?.ar || newest.name?.en || newest.name?.fr || 'منتج جديد'}`,
            body: `متوفر الآن بسعر ${newest.price} د.ت — اطلبه الآن مع التوصيل لكافة الولايات.`,
            url: `/?product=${encodeURIComponent(newest.id)}`,
          })
        );
      }
    } else if (Array.isArray(patch.banners) && savedState.banners.length > prevBannersSnapshot.length) {
      const newestBanner = savedState.banners.find((b) => !prevBannersSnapshot.some((old) => old.id === b.id));
      if (newestBanner && newestBanner.active) {
        tasks.push(
          appendEdgePublicAnnouncement(env, {
            tag: newestBanner.tag || 'عرض جديد',
            title: `🔥 ${newestBanner.title}`,
            body: newestBanner.subtitle || 'اكتشف العروض الجديدة في ECHOX Store الآن.',
            url: '/',
          })
        );
      }
    }

    const joined = Promise.all(tasks);
    if (waitUntil) waitUntil(joined);
    else await joined;

    return jsonResponse({
      success: true,
      products: savedState.products,
      companies: savedState.companies,
      categories: savedState.categories,
      banners: savedState.banners,
      siteSettings: savedState.siteSettings,
      updatedAt: savedState.updatedAt,
      ownerSettings: savedState.ownerSettings,
      inquiries: savedState.inquiries,
      persistenceStatus: getEdgePersistenceStatus(env),
    });
  }

  const reviewMatch = pathname.match(/^\/api\/store\/products\/([^/]+)\/reviews$/);
  if (method === 'POST' && reviewMatch) {
    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('productReview', ip, 15, 60_000);
    if (!rate.allowed) {
      return jsonResponse(
        { success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` },
        429
      );
    }

    const productId = decodeURIComponent(reviewMatch[1]);
    const body = (await request.json().catch(() => ({}))) as {
      authorName?: string;
      customerName?: string;
      rating?: number;
      comment?: string;
      verifiedPurchase?: boolean;
    };
    const comment = (body.comment || '').trim().slice(0, 1000);
    if (!comment) {
      return jsonResponse({ success: false, error: 'يرجى كتابة نص التقييم.' }, 400);
    }
    const rating = Math.min(5, Math.max(1, Math.round(Number(body.rating) || 5)));
    const authorName = (body.authorName || body.customerName || '').trim().slice(0, 80) || 'حريف ECHOX';

    const mut = await mutateEdgeDocWithRetry<
      StorefrontDatabase,
      { notFound?: boolean; product?: Product }
    >(env, CLOUD_STORE_KEY, async (raw) => {
      const db = mergeStoreState(raw);
      const prod = db.products.find((p) => p.id === productId);
      if (!prod) return { skipWrite: true, result: { notFound: true } };

      const newRev = {
        id: `rev_${Date.now()}`,
        authorName,
        rating,
        comment,
        date: new Date().toISOString().split('T')[0],
        verifiedPurchase: Boolean(body.verifiedPurchase),
      };
      const updatedReviews = [newRev, ...(prod.reviews || [])].slice(0, 100);
      const newRating = +(
        updatedReviews.reduce((sum, r) => sum + r.rating, 0) / updatedReviews.length
      ).toFixed(1);
      const updatedProduct: Product = {
        ...prod,
        reviews: updatedReviews,
        rating: newRating,
        reviewCount: updatedReviews.length,
      };
      return {
        nextDoc: {
          ...db,
          products: db.products.map((p) => (p.id === productId ? updatedProduct : p)),
          updatedAt: new Date().toISOString(),
        },
        result: { product: updatedProduct },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    if (mut.result?.notFound) return jsonResponse({ success: false, error: 'المنتج غير موجود.' }, 404);

    const notifTask = appendEdgeAdminNotification(env, {
      category: 'activity',
      severity: 'info',
      title: `⭐ تقييم جديد (${rating}/5)`,
      body: `المنتج: ${mut.result?.product?.name?.ar || productId} — ${authorName}`,
      url: '/owner/dashboard',
    });
    if (waitUntil) waitUntil(notifTask);
    else await notifTask;

    return jsonResponse({ success: true, product: mut.result?.product });
  }

  if (method === 'POST' && pathname === '/api/store/inquiries') {
    const ip = getEdgeClientIp(request);
    const rate = checkEdgeSlidingWindowLimit('inquiries', ip, 10, 60_000);
    if (!rate.allowed) {
      return jsonResponse(
        { success: false, error: `تم تجاوز الحد المسموح، يرجى الانتظار ${rate.retryAfterSeconds} ثانية.` },
        429
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      senderName?: string;
      email?: string;
      phone?: string;
      subject?: string;
      message?: string;
    };
    const senderName = (body.senderName || '').trim().slice(0, 120);
    const phone = (body.phone || '').trim().slice(0, 30);
    const email = (body.email || '').trim().slice(0, 120);
    const subject = (body.subject || '').trim().slice(0, 200);
    const message = (body.message || '').trim().slice(0, 2000);

    if (!senderName || !phone || !message) {
      return jsonResponse({ success: false, error: 'يرجى إكمال الاسم ورقم الهاتف ونص الرسالة.' }, 400);
    }

    const inquiry: ContactInquiry = {
      id: `inq_${Date.now()}`,
      senderName,
      email,
      phone,
      subject: subject || 'استفسار عام',
      message,
      createdAt: new Date().toISOString(),
      read: false,
    };

    const mut = await mutateEdgeDocWithRetry<StorefrontDatabase, ContactInquiry>(
      env,
      CLOUD_STORE_KEY,
      async (raw) => {
        const db = mergeStoreState(raw);
        return {
          nextDoc: {
            ...db,
            inquiries: [inquiry, ...db.inquiries].slice(0, 200),
            updatedAt: new Date().toISOString(),
          },
          result: inquiry,
        };
      }
    );

    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);

    const notifTask = appendEdgeAdminNotification(env, {
      category: 'support',
      severity: 'info',
      title: '📩 استفسار جديد من صفحة اتصل بنا',
      body: `${inquiry.senderName}: ${inquiry.subject}`,
      url: '/owner/dashboard',
    });
    if (waitUntil) waitUntil(notifTask);
    else await notifTask;

    return jsonResponse({ success: true, inquiry: mut.result });
  }

  const inqReplyMatch = pathname.match(/^\/api\/admin\/store\/inquiries\/([^/]+)\/reply$/);
  if (method === 'POST' && inqReplyMatch) {
    const auth = await requireEdgeAdminAuth(request, env);
    if (!auth.ok) return auth.response;

    const inquiryId = decodeURIComponent(inqReplyMatch[1]);
    const body = (await request.json().catch(() => ({}))) as { reply?: string };
    const cleanReply = (body.reply || '').trim().slice(0, 2000);
    if (!cleanReply) {
      return jsonResponse({ success: false, error: 'يرجى كتابة نص الرد.' }, 400);
    }

    const mut = await mutateEdgeDocWithRetry<
      StorefrontDatabase,
      { notFound?: boolean; inquiry?: ContactInquiry }
    >(env, CLOUD_STORE_KEY, async (raw) => {
      const db = mergeStoreState(raw);
      const existing = db.inquiries.find((i) => i.id === inquiryId);
      if (!existing) return { skipWrite: true, result: { notFound: true } };
      const updated: ContactInquiry = {
        ...existing,
        read: true,
        reply: cleanReply,
        repliedAt: new Date().toISOString(),
      };
      return {
        nextDoc: {
          ...db,
          inquiries: db.inquiries.map((i) => (i.id === inquiryId ? updated : i)),
          updatedAt: new Date().toISOString(),
        },
        result: { inquiry: updated },
      };
    });

    if (!mut.ok) return jsonResponse({ success: false, error: mut.error }, mut.statusCode || 503);
    if (mut.result?.notFound) return jsonResponse({ success: false, error: 'الرسالة غير موجودة.' }, 404);
    return jsonResponse({ success: true, inquiry: mut.result?.inquiry });
  }

  return null;
}
