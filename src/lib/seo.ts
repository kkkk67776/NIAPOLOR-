import { Language, Product } from '../types';

const FALLBACK_SITE_URL =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SITE_URL) ||
  'https://echoxstore.pages.dev';

export function getSiteOrigin(): string {
  if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    !window.location.origin.includes('localhost') &&
    !window.location.origin.includes('127.0.0.1')
  ) {
    return window.location.origin;
  }
  return FALLBACK_SITE_URL;
}

export const SITE_URL = getSiteOrigin();

interface PageMeta {
  path: string;
  index: boolean;
  meta: Record<Language, { title: string; description: string }>;
}

const PAGES: Record<string, PageMeta> = {
  store: {
    path: '/',
    index: true,
    meta: {
      ar: {
        title: 'NIAPOLOR — المتجر التونسي الفاخر للمنتجات والمعدات الأصلية',
        description:
          'متجر NIAPOLOR التونسي للأجهزة والمعدات والسلع الفاخرة وقطع الغيار الأصلية، مع الدفع عند الاستلام أو التحويل البنكي والتوصيل لكافة ولايات تونس الـ24.',
      },
      fr: {
        title: 'NIAPOLOR — Boutique de Luxe, Équipements & Pièces d’Origine en Tunisie',
        description:
          'Boutique tunisienne NIAPOLOR : outillage, articles premium et pièces détachées certifiées avec paiement à la livraison ou virement dans les 24 gouvernorats.',
      },
      en: {
        title: 'NIAPOLOR — Luxury Storefront, Genuine Tools & Hardware in Tunisia',
        description:
          'NIAPOLOR Tunisia offers luxury curated goods, certified tools, and precision electronics with Cash on Delivery or online payment across all 24 governorates.',
      },
    },
  },
  promise: {
    path: '/promise',
    index: true,
    meta: {
      ar: {
        title: 'وعدنا وضمان الجودة | NIAPOLOR تونس',
        description:
          'تعرّف على ميثاق ضمان NIAPOLOR: منتجات أصلية 100%، دفع آمن عند المعاينة أو بالتحويل، وتوصيل سريع لكافة ولايات تونس.',
      },
      fr: {
        title: 'Notre Engagement Qualité & Garantie | NIAPOLOR Tunisie',
        description:
          'Découvrez la garantie NIAPOLOR : pièces et articles certifiés 100% d’origine, contrôle avant paiement et livraison express sur toute la Tunisie.',
      },
      en: {
        title: 'Our Quality Promise & Warranty | NIAPOLOR Tunisia',
        description:
          'Learn about the NIAPOLOR guarantee: 100% genuine certified products, secure payment options, and fast delivery across Tunisia.',
      },
    },
  },
  companies: {
    path: '/companies',
    index: true,
    meta: {
      ar: {
        title: 'الشركات والعلامات الشريكة | NIAPOLOR تونس',
        description:
          'استعرض الشركات والموزعين المعتمدين لدى متجر NIAPOLOR في تونس للأجهزة والمعدات والقطع الأصلية.',
      },
      fr: {
        title: 'Partenaires & Distributeurs Agréés | NIAPOLOR Tunisie',
        description:
          'Découvrez les marques et distributeurs officiels partenaires de NIAPOLOR en Tunisie.',
      },
      en: {
        title: 'Authorized Partners & Brands | NIAPOLOR Tunisia',
        description:
          'Explore verified partner distributors and luxury brands on NIAPOLOR Tunisia.',
      },
    },
  },
  contact: {
    path: '/contact',
    index: true,
    meta: {
      ar: {
        title: 'اتصل بنا والدعم الفني | NIAPOLOR تونس',
        description:
          'تواصل مع فريق NIAPOLOR تونس عبر الهاتف أو واتساب أو البريد الإلكتروني. دعم سريع واستشارات من الإثنين إلى السبت.',
      },
      fr: {
        title: 'Contact & Assistance Technique | NIAPOLOR Tunisie',
        description:
          'Contactez l’équipe NIAPOLOR Tunisie par téléphone, WhatsApp ou e-mail pour toute demande.',
      },
      en: {
        title: 'Contact & Customer Concierge | NIAPOLOR Tunisia',
        description:
          'Reach NIAPOLOR Tunisia via phone, WhatsApp, or email for genuine product advice and dedicated support.',
      },
    },
  },
  my_orders: {
    path: '/my_orders',
    index: false,
    meta: {
      ar: {
        title: 'تتبع طلبك | NIAPOLOR',
        description: 'متابعة حالة الطلب والدفع في NIAPOLOR.',
      },
      fr: {
        title: 'Suivi de Commande | NIAPOLOR',
        description: 'Suivez l’état de votre commande et paiement sur NIAPOLOR.',
      },
      en: {
        title: 'Track Your Order | NIAPOLOR',
        description: 'Track your order delivery and payment status on NIAPOLOR.',
      },
    },
  },
  account: {
    path: '/account',
    index: false,
    meta: {
      ar: {
        title: 'حسابي | NIAPOLOR',
        description: 'بوابة الحساب والعناوين والمفضلة في NIAPOLOR.',
      },
      fr: {
        title: 'Mon Compte | NIAPOLOR',
        description: 'Gérez vos adresses et commandes sur NIAPOLOR.',
      },
      en: {
        title: 'My Account | NIAPOLOR',
        description: 'Manage your addresses and orders on NIAPOLOR.',
      },
    },
  },
};

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setHreflangLink(hreflang: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(
    `link[rel="alternate"][hreflang="${hreflang}"]`
  );
  if (!el) {
    el = document.createElement('link');
    el.rel = 'alternate';
    el.setAttribute('hreflang', hreflang);
    document.head.appendChild(el);
  }
  el.href = href;
}

function toAbsoluteUrl(origin: string, urlOrPath?: string): string {
  if (!urlOrPath) return `${origin}/assets/images/niapolor-logo-full.webp`;
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) return urlOrPath;
  return `${origin}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;
}

function updateProductJsonLd(origin: string, product: Product | null, lang: Language) {
  const existing = document.getElementById('echox-product-schema');
  if (!product) {
    if (existing) existing.remove();
    return;
  }

  const productUrl = `${origin}/?product=${encodeURIComponent(product.id)}`;
  const productImage = toAbsoluteUrl(origin, product.images?.[0]);
  const productName = product.name?.[lang] || product.name?.ar || 'NIAPOLOR Product';
  const productDesc = product.description?.[lang] || product.description?.ar || '';

  const schema: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: productName,
    description: productDesc,
    image: (product.images || []).map((img) => toAbsoluteUrl(origin, img)),
    sku: product.id,
    brand: {
      '@type': 'Brand',
      name: product.companyName || 'NIAPOLOR',
    },
    offers: {
      '@type': 'Offer',
      url: productUrl,
      priceCurrency: 'TND',
      price: product.price.toFixed(3),
      availability:
        product.stock > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  };

  if (product.rating && product.reviewCount) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: String(product.rating),
      reviewCount: String(product.reviewCount),
    };
  }

  const scriptEl =
    (existing as HTMLScriptElement | null) ||
    (() => {
      const s = document.createElement('script');
      s.id = 'echox-product-schema';
      s.type = 'application/ld+json';
      document.head.appendChild(s);
      return s;
    })();

  scriptEl.textContent = JSON.stringify(schema);
}

export function applySeo(
  view: string,
  lang: Language = 'ar',
  activeProduct: Product | null = null
) {
  const origin = getSiteOrigin();
  const isOwner = view.startsWith('/owner') || view === 'owner_dashboard';

  // Ensure <html lang/dir> matches current active language cleanly
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr' : 'en';
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }

  if (activeProduct && !isOwner) {
    const productTitle = `${activeProduct.name?.[lang] || activeProduct.name?.ar} | NIAPOLOR`;
    const productDesc = (
      activeProduct.description?.[lang] ||
      activeProduct.description?.ar ||
      PAGES.store.meta[lang].description
    ).slice(0, 160);
    const productUrl = `${origin}/?product=${encodeURIComponent(activeProduct.id)}`;
    const productImg = toAbsoluteUrl(origin, activeProduct.images?.[0]);

    document.title = productTitle;
    setMeta('name', 'description', productDesc);
    setMeta('name', 'robots', 'index, follow, max-snippet:-1, max-image-preview:large');
    setMeta('property', 'og:type', 'product');
    setMeta('property', 'og:title', productTitle);
    setMeta('property', 'og:description', productDesc);
    setMeta('property', 'og:url', productUrl);
    setMeta('property', 'og:image', productImg);
    setMeta('name', 'twitter:title', productTitle);
    setMeta('name', 'twitter:description', productDesc);
    setMeta('name', 'twitter:image', productImg);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = productUrl;

    setHreflangLink('ar-TN', `${origin}/?product=${encodeURIComponent(activeProduct.id)}&lang=ar`);
    setHreflangLink('fr-TN', `${origin}/?product=${encodeURIComponent(activeProduct.id)}&lang=fr`);
    setHreflangLink('en', `${origin}/?product=${encodeURIComponent(activeProduct.id)}&lang=en`);
    setHreflangLink('x-default', productUrl);

    updateProductJsonLd(origin, activeProduct, lang);
    return;
  }

  updateProductJsonLd(origin, null, lang);

  const normalizedView = view === '/' ? 'store' : view === 'wishlist' ? 'account' : view;
  const page =
    PAGES[normalizedView] ||
    (isOwner
      ? {
          path: '/owner/dashboard',
          index: false,
          meta: {
            ar: { title: 'مركز التحكم | NIAPOLOR', description: 'إدارة المتجر والمدفوعات.' },
            fr: { title: "Panneau d'administration | NIAPOLOR", description: 'Gestion NIAPOLOR.' },
            en: { title: 'Admin Panel | NIAPOLOR', description: 'NIAPOLOR Admin Panel.' },
          },
        }
      : PAGES.store);

  const metaForLang = page.meta[lang] || page.meta.ar;
  const url = `${origin}${page.path}`;
  const defaultHeroImage = `${origin}/assets/images/niapolor-logo-full.webp`;

  document.title = metaForLang.title;
  setMeta('name', 'description', metaForLang.description);
  setMeta(
    'name',
    'robots',
    page.index ? 'index, follow, max-snippet:-1, max-image-preview:large' : 'noindex, nofollow'
  );
  setMeta('property', 'og:type', 'website');
  setMeta('property', 'og:title', metaForLang.title);
  setMeta('property', 'og:description', metaForLang.description);
  setMeta('property', 'og:url', url);
  setMeta('property', 'og:image', defaultHeroImage);
  setMeta('name', 'twitter:title', metaForLang.title);
  setMeta('name', 'twitter:description', metaForLang.description);
  setMeta('name', 'twitter:image', defaultHeroImage);

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = url;

  if (page.index) {
    setHreflangLink('ar-TN', `${origin}${page.path}?lang=ar`);
    setHreflangLink('fr-TN', `${origin}${page.path}?lang=fr`);
    setHreflangLink('en', `${origin}${page.path}?lang=en`);
    setHreflangLink('x-default', url);
  }
}
