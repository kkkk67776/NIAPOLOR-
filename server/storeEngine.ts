import fs from 'fs';
import {
  atomicWriteJsonSync,
  getDataFilePath,
  isCloudPersistenceEnabled,
  loadCloudJson,
  saveCloudJson,
  savePersistentJson,
} from './cloudPersistence';
import {
  isMediaSafeUrl,
  quarantineSuspiciousItem,
} from './securityEngine';
import { normalizeProductImageUrl } from '../src/lib/imageUrl';
import {
  INITIAL_COMPANIES,
  INITIAL_OWNER_SETTINGS,
  INITIAL_PRODUCTS,
  INITIAL_SITE_SETTINGS,
} from '../src/data/initialData';
import type {
  CategoryItem,
  Company,
  ContactInquiry,
  OwnerSettings,
  Product,
  PromoBanner,
  SiteSettings,
} from '../src/types/index';

const STORE_DATA_FILE = getDataFilePath('store_state.json');
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

function mergeStoreState(raw: Partial<StorefrontDatabase>): StorefrontDatabase {
  const def = createInitialStoreState();
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

function loadStoreState(): StorefrontDatabase {
  try {
    if (fs.existsSync(STORE_DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_DATA_FILE, 'utf-8'));
      return mergeStoreState(raw);
    }
  } catch (err) {
    console.warn('[StoreEngine] Notice loading store state, using initial data:', err);
  }
  const initial = createInitialStoreState();
  try {
    atomicWriteJsonSync(STORE_DATA_FILE, initial);
  } catch (err) {
    console.warn('[StoreEngine] Notice bootstrapping store state file:', err);
  }
  return initial;
}

async function persistStoreState(state: StorefrontDatabase) {
  return savePersistentJson(CLOUD_STORE_KEY, STORE_DATA_FILE, state);
}

let storeDb: StorefrontDatabase = loadStoreState();
let lastStoreCloudSyncAt = 0;

export async function hydrateStoreStateFromCloud(): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  const remote = await loadCloudJson<Partial<StorefrontDatabase>>(CLOUD_STORE_KEY);
  lastStoreCloudSyncAt = Date.now();
  if (remote && typeof remote === 'object') {
    storeDb = mergeStoreState(remote);
    try {
      atomicWriteJsonSync(STORE_DATA_FILE, storeDb);
    } catch (err) {
      console.warn('[StoreEngine] Notice syncing cloud store snapshot to disk:', err);
    }
  } else {
    const seedRes = await saveCloudJson(CLOUD_STORE_KEY, storeDb);
    if (!seedRes.ok) {
      console.warn('[StoreEngine] Initial cloud seed notice:', seedRes.error);
    }
  }
}

export async function syncStoreStateIfStale(force = false, maxAgeMs = 2500): Promise<void> {
  if (!isCloudPersistenceEnabled()) return;
  if (!force && Date.now() - lastStoreCloudSyncAt < maxAgeMs) return;
  const remote = await loadCloudJson<Partial<StorefrontDatabase>>(CLOUD_STORE_KEY);
  lastStoreCloudSyncAt = Date.now();
  if (remote && typeof remote === 'object') {
    storeDb = mergeStoreState(remote);
    try {
      atomicWriteJsonSync(STORE_DATA_FILE, storeDb);
    } catch {}
  }
}

export function getPublicStoreState() {
  return {
    products: storeDb.products,
    companies: storeDb.companies,
    categories: storeDb.categories,
    banners: storeDb.banners,
    siteSettings: storeDb.siteSettings,
    updatedAt: storeDb.updatedAt,
  };
}

export function getAdminStoreState() {
  return {
    ...getPublicStoreState(),
    ownerSettings: storeDb.ownerSettings,
    inquiries: storeDb.inquiries,
  };
}

function validateStorePatchSecurity(
  patch: Partial<StorefrontDatabase>,
  actorIp: string
): { ok: boolean; error?: string; quarantined?: boolean } {
  if (Array.isArray(patch.products)) {
    for (let i = 0; i < patch.products.length; i++) {
      const p = patch.products[i];
      if (!p || typeof p.id !== 'string' || !p.id.trim()) {
        return { ok: false, error: `معرف المنتج رقم ${i + 1} غير صالح.` };
      }
      if (typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price < 0) {
        return { ok: false, error: `سعر المنتج (${p.id}) غير صالح.` };
      }
      if (p.stock !== undefined && (typeof p.stock !== 'number' || !Number.isFinite(p.stock) || p.stock < 0)) {
        return { ok: false, error: `كمية المخزون للمنتج (${p.id}) غير صالحة.` };
      }
      const normalizedImages: string[] = [];
      for (const rawImg of p.images || []) {
        const trimmed = typeof rawImg === 'string' ? rawImg.trim() : rawImg;
        const norm = typeof trimmed === 'string' ? normalizeProductImageUrl(trimmed) : null;
        const candidate =
          norm && norm.url && (!norm.issue || norm.issue === 'http_insecure')
            ? norm.url
            : trimmed;
        if (!isMediaSafeUrl(candidate)) {
          quarantineSuspiciousItem({
            source: 'admin_store_product_media',
            reason: `Blocked unsafe media URI in product ${p.id}`,
            severity: 'critical',
            actorIp,
            mimeDeclared: String(rawImg).slice(0, 40),
            payloadPreview: String(rawImg).slice(0, 100),
          });
          return {
            ok: false,
            quarantined: true,
            error: `تم رفض وعزل رابط صورة غير آمن في المنتج (${p.id}) حفاظاً على سلامة المتجر.`,
          };
        }
        if (typeof candidate === 'string' && candidate) {
          normalizedImages.push(candidate);
        }
      }
      p.images = normalizedImages;
    }
  }

  if (Array.isArray(patch.companies)) {
    for (let i = 0; i < patch.companies.length; i++) {
      const c = patch.companies[i];
      if (!c || typeof c.id !== 'string' || !c.id.trim() || typeof c.name !== 'string') {
        return { ok: false, error: `بيانات الشركة رقم ${i + 1} غير صالحة.` };
      }
      if (c.logo && !isMediaSafeUrl(c.logo)) {
        quarantineSuspiciousItem({
          source: 'admin_store_company_logo',
          reason: `Blocked unsafe logo URI in company ${c.id}`,
          severity: 'critical',
          actorIp,
          mimeDeclared: String(c.logo).slice(0, 40),
          payloadPreview: String(c.logo).slice(0, 100),
        });
        return {
          ok: false,
          quarantined: true,
          error: `تم رفض وعزل شعار غير آمن للشركة (${c.id}) حفاظاً على سلامة المتجر.`,
        };
      }
    }
  }

  if (Array.isArray(patch.banners)) {
    for (let i = 0; i < patch.banners.length; i++) {
      const b = patch.banners[i];
      if (!b || typeof b.id !== 'string' || !b.id.trim() || typeof b.title !== 'string') {
        return { ok: false, error: `بيانات البانر رقم ${i + 1} غير صالحة.` };
      }
    }
  }

  return { ok: true };
}

export async function updateAdminStoreState(
  patch: Partial<StorefrontDatabase>,
  actorIp = '127.0.0.1'
): Promise<{
  ok: boolean;
  statusCode?: number;
  error?: string;
  quarantined?: boolean;
  state: ReturnType<typeof getAdminStoreState>;
}> {
  await syncStoreStateIfStale(true);
  if (!patch || typeof patch !== 'object') {
    return { ok: false, statusCode: 400, error: 'بيانات غير صالحة.', state: getAdminStoreState() };
  }

  const secCheck = validateStorePatchSecurity(patch, actorIp);
  if (!secCheck.ok) {
    return {
      ok: false,
      statusCode: 400,
      error: secCheck.error,
      quarantined: secCheck.quarantined,
      state: getAdminStoreState(),
    };
  }

  const prev = storeDb;
  const next: StorefrontDatabase = {
    ...storeDb,
    updatedAt: new Date().toISOString(),
  };

  if (Array.isArray(patch.products)) {
    next.products = patch.products;
  }
  if (Array.isArray(patch.companies)) {
    next.companies = patch.companies;
  }
  if (Array.isArray(patch.categories) && patch.categories.length > 0) {
    next.categories = patch.categories;
  }
  if (Array.isArray(patch.banners)) {
    next.banners = patch.banners;
  }
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
  if (Array.isArray(patch.inquiries)) {
    next.inquiries = patch.inquiries;
  }

  const persisted = await persistStoreState(next);
  if (!persisted.ok) {
    storeDb = prev;
    return {
      ok: false,
      statusCode: 503,
      error: persisted.error || 'تعذر تأكيد الحفظ الدائم في قاعدة البيانات.',
      state: getAdminStoreState(),
    };
  }

  storeDb = next;
  lastStoreCloudSyncAt = Date.now();
  return { ok: true, state: getAdminStoreState() };
}

export async function addPublicProductReview(
  productId: string,
  reviewInput: { authorName: string; rating: number; comment: string; verifiedPurchase?: boolean }
): Promise<{ ok: boolean; statusCode?: number; error?: string; product?: Product }> {
  await syncStoreStateIfStale(true);
  const prod = storeDb.products.find((p) => p.id === productId);
  if (!prod) {
    return { ok: false, statusCode: 404, error: 'المنتج غير موجود.' };
  }
  const rating = Math.min(5, Math.max(1, Math.round(Number(reviewInput.rating) || 5)));
  const comment = (reviewInput.comment || '').trim().slice(0, 1000);
  const authorName = (reviewInput.authorName || '').trim().slice(0, 80) || 'حريف ECHOX';
  if (!comment) {
    return { ok: false, statusCode: 400, error: 'يرجى كتابة نص التقييم.' };
  }
  const newRev = {
    id: `rev_${Date.now()}`,
    authorName,
    rating,
    comment,
    date: new Date().toISOString().split('T')[0],
    verifiedPurchase: Boolean(reviewInput.verifiedPurchase),
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
  const next: StorefrontDatabase = {
    ...storeDb,
    products: storeDb.products.map((p) => (p.id === productId ? updatedProduct : p)),
    updatedAt: new Date().toISOString(),
  };
  const persisted = await persistStoreState(next);
  if (!persisted.ok) {
    return { ok: false, statusCode: 503, error: persisted.error || 'تعذر حفظ التقييم على الخادم.' };
  }
  storeDb = next;
  lastStoreCloudSyncAt = Date.now();
  return { ok: true, product: updatedProduct };
}

export async function addPublicInquiry(input: {
  senderName: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}): Promise<{ ok: boolean; statusCode?: number; error?: string; inquiry?: ContactInquiry }> {
  await syncStoreStateIfStale(true);
  const senderName = (input.senderName || '').trim().slice(0, 120);
  const phone = (input.phone || '').trim().slice(0, 30);
  const email = (input.email || '').trim().slice(0, 120);
  const subject = (input.subject || '').trim().slice(0, 200);
  const message = (input.message || '').trim().slice(0, 2000);

  if (!senderName || !phone || !message) {
    return { ok: false, statusCode: 400, error: 'يرجى إكمال الاسم ورقم الهاتف ونص الرسالة.' };
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

  const next: StorefrontDatabase = {
    ...storeDb,
    inquiries: [inquiry, ...storeDb.inquiries].slice(0, 200),
    updatedAt: new Date().toISOString(),
  };
  const persisted = await persistStoreState(next);
  if (!persisted.ok) {
    return { ok: false, statusCode: 503, error: persisted.error || 'تعذر حفظ الاستفسار على الخادم.' };
  }
  storeDb = next;
  lastStoreCloudSyncAt = Date.now();
  return { ok: true, inquiry };
}

export async function adminReplyToInquiry(inquiryId: string, reply: string): Promise<{
  ok: boolean;
  statusCode?: number;
  error?: string;
  inquiry?: ContactInquiry;
}> {
  await syncStoreStateIfStale(true);
  const cleanReply = (reply || '').trim().slice(0, 2000);
  if (!cleanReply) {
    return { ok: false, statusCode: 400, error: 'يرجى كتابة نص الرد.' };
  }
  const existing = storeDb.inquiries.find((i) => i.id === inquiryId);
  if (!existing) {
    return { ok: false, statusCode: 404, error: 'الرسالة غير موجودة.' };
  }
  const updated: ContactInquiry = {
    ...existing,
    read: true,
    reply: cleanReply,
    repliedAt: new Date().toISOString(),
  };
  const next: StorefrontDatabase = {
    ...storeDb,
    inquiries: storeDb.inquiries.map((i) => (i.id === inquiryId ? updated : i)),
    updatedAt: new Date().toISOString(),
  };
  const persisted = await persistStoreState(next);
  if (!persisted.ok) {
    return { ok: false, statusCode: 503, error: persisted.error || 'تعذر حفظ الرد في قاعدة البيانات.' };
  }
  storeDb = next;
  lastStoreCloudSyncAt = Date.now();
  return { ok: true, inquiry: updated };
}

export function getStoreRecoverySnapshot(): StorefrontDatabase {
  return JSON.parse(JSON.stringify(storeDb));
}

export async function restoreStoreRecoverySnapshot(
  incoming: Partial<StorefrontDatabase>
): Promise<{ ok: boolean; statusCode?: number; error?: string; state: ReturnType<typeof getAdminStoreState> }> {
  await syncStoreStateIfStale(true);
  if (!incoming || typeof incoming !== 'object') {
    return { ok: false, statusCode: 400, error: 'بيانات المتجر المستعادة غير صالحة.', state: getAdminStoreState() };
  }
  const prev = storeDb;
  const next = mergeStoreState({
    ...storeDb,
    ...incoming,
    products: Array.isArray(incoming.products) ? incoming.products : storeDb.products,
    companies: Array.isArray(incoming.companies) ? incoming.companies : storeDb.companies,
    categories:
      Array.isArray(incoming.categories) && incoming.categories.length > 0
        ? incoming.categories
        : storeDb.categories,
    banners: Array.isArray(incoming.banners) ? incoming.banners : storeDb.banners,
    siteSettings:
      incoming.siteSettings && Object.keys(incoming.siteSettings).length > 0
        ? incoming.siteSettings
        : storeDb.siteSettings,
    ownerSettings:
      incoming.ownerSettings && Object.keys(incoming.ownerSettings).length > 0
        ? incoming.ownerSettings
        : storeDb.ownerSettings,
    inquiries: Array.isArray(incoming.inquiries) ? incoming.inquiries : storeDb.inquiries,
    updatedAt: new Date().toISOString(),
  });

  const persisted = await persistStoreState(next);
  if (!persisted.ok) {
    storeDb = prev;
    return {
      ok: false,
      statusCode: 503,
      error: persisted.error || 'تعذر حفظ بيانات المتجر المستعادة.',
      state: getAdminStoreState(),
    };
  }
  storeDb = next;
  lastStoreCloudSyncAt = Date.now();
  return { ok: true, state: getAdminStoreState() };
}

