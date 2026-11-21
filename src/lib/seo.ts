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
        title: 'NIAPOLOR — عالمك، متجر واحد. | متجر إلكتروني متعدد الفئات',
        description:
          'NIAPOLOR هو متجر إلكتروني متعدد الفئات، يجمع عالمًا متنوعًا من المنتجات والاختيارات في مكان واحد. اكتشف الإلكترونيات والأجهزة والمعدات وقطع غيار السيارات والإكسسوارات والعديد من المنتجات الأخرى. تسوّق بسهولة واستمتع بتجربة شراء موثوقة تناسب احتياجاتك.',
      },
      fr: {
        title: 'NIAPOLOR — Votre monde. Une seule boutique.',
        description:
          "NIAPOLOR est votre destination de shopping en ligne, réunissant une grande variété de produits dans plusieurs catégories. Découvrez l'électronique, les équipements, les pièces automobiles, les accessoires et bien plus encore, dans une seule boutique.",
      },
      en: {
        title: 'NIAPOLOR — YOUR WORLD. ONE STORE. | Online Store',
        description:
          'NIAPOLOR is your online shopping destination, bringing together a wide variety of products across multiple categories. Discover electronics, equipment, automotive parts, accessories, and much more — all in one store.',
      },
    },
  },
  promise: {
    path: '/promise',
    index: true,
    meta: {
      ar: {
        title: 'ميثاق الجودة والخدمة | NIAPOLOR',
        description:
          'تعرّف على التزام NIAPOLOR بتوفير تجربة تسوق إلكتروني واضحة وموثوقة عبر فئات متعددة من المنتجات في مكان واحد.',
      },
      fr: {
        title: 'Notre Engagement Qualité | NIAPOLOR',
        description:
          "Découvrez l'engagement de NIAPOLOR pour une expérience d'achat en ligne claire et fiable dans plusieurs catégories.",
      },
      en: {
        title: 'Our Quality Commitment | NIAPOLOR',
        description:
          'Learn about NIAPOLOR’s commitment to a clear and reliable online shopping experience across multiple categories.',
      },
    },
  },
  companies: {
    path: '/companies',
    index: true,
    meta: {
      ar: {
        title: 'الشركات والعلامات التجارية | NIAPOLOR',
        description:
          'استعرض العلامات التجارية والشركاء المتوفرين في متجر NIAPOLOR متعدد الفئات في مكان واحد.',
      },
      fr: {
        title: 'Marques & Partenaires | NIAPOLOR',
        description:
          'Découvrez les marques et partenaires disponibles dans votre boutique en ligne multi-catégories NIAPOLOR.',
      },
      en: {
        title: 'Brands & Partners | NIAPOLOR',
        description:
          'Explore the brands and partners available on NIAPOLOR across multiple product categories.',
      },
    },
  },
  contact: {
    path: '/contact',
    index: true,
    meta: {
      ar: {
        title: 'اتصل بنا | NIAPOLOR',
        description:
          'تواصل مع فريق NIAPOLOR عبر الهاتف أو واتساب أو البريد الإلكتروني للاستفسارات والمساعدة.',
      },
      fr: {
        title: 'Contact & Assistance | NIAPOLOR',
        description:
          'Contactez l’équipe NIAPOLOR par téléphone, WhatsApp ou e-mail pour toute demande.',
      },
      en: {
        title: 'Contact & Support | NIAPOLOR',
        description:
          'Reach the NIAPOLOR team via phone, WhatsApp, or email for inquiries and assistance.',
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
