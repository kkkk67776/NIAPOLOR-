import { Language, Product } from '../types';
import { getTranslation } from '../data/translations';

const FALLBACK_SITE_URL =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SITE_URL) ||
  'https://niapolor.pages.dev';

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
        title: 'NIAPOLOR — عالمك، متجر واحد. | متجر إلكتروني شامل',
        description:
          'NIAPOLOR وجهتك الرقمية الشاملة لتسوق أحدث التقنيات، المعدات المتطورة، والمستلزمات العصرية من علامات وموردين موثوقين في مكان واحد. تجربة تسوق احترافية تجمع بين تنوع الاختيارات، جودة مضمونة، وخدمة توصيل موثوقة إلى كافة أنحاء تونس.',
      },
      fr: {
        title: 'NIAPOLOR — Votre monde. Une seule boutique.',
        description:
          'NIAPOLOR est votre destination e-commerce tout-en-un réunissant technologies de pointe, équipements performants et essentiels modernes auprès de marques et partenaires de confiance. Profitez d’une expérience d’achat fluide alliant diversité de choix, qualité garantie et livraison fiable partout en Tunisie.',
      },
      en: {
        title: 'NIAPOLOR — YOUR WORLD. ONE STORE. | Online Store',
        description:
          'NIAPOLOR is your all-in-one e-commerce destination bringing together cutting-edge technology, high-performance equipment, and modern essentials from trusted brands and partners. Experience seamless shopping with curated variety, guaranteed quality, and reliable delivery across Tunisia.',
      },
    },
  },
  about: {
    path: '/about',
    index: true,
    meta: {
      ar: {
        title: 'من نحن | NIAPOLOR تونس',
        description:
          'تعرّف على NIAPOLOR، متجرك الإلكتروني الشامل في تونس الذي يجمع أحدث التقنيات والمعدات والمستلزمات العصرية عبر مختلف الفئات بتجربة تسوق موثوقة.',
      },
      fr: {
        title: 'À propos de nous | NIAPOLOR Tunisie',
        description:
          'Découvrez NIAPOLOR, votre boutique en ligne complète en Tunisie réunissant technologies, équipements et essentiels modernes avec une expérience d’achat fiable.',
      },
      en: {
        title: 'About Us | NIAPOLOR Tunisia',
        description:
          'Learn about NIAPOLOR, an all-in-one online store in Tunisia bringing together modern technology, quality equipment, and curated lifestyle products.',
      },
    },
  },
  shipping: {
    path: '/shipping',
    index: true,
    meta: {
      ar: {
        title: 'سياسة الشحن والتوصيل (24 ولاية) | NIAPOLOR',
        description:
          'تفاصيل رسوم الشحن، عتبة التوصيل المجاني، وآجال التسليم المقدرة لجميع ولايات تونس الـ24 مع NIAPOLOR.',
      },
      fr: {
        title: 'Politique de Livraison (24 Gouvernorats) | NIAPOLOR',
        description:
          'Détails des frais de livraison, seuil de livraison gratuite et délais estimés dans les 24 gouvernorats de Tunisie avec NIAPOLOR.',
      },
      en: {
        title: 'Shipping & Delivery Policy | NIAPOLOR',
        description:
          'Shipping fees, free delivery threshold, and estimated delivery timelines across all 24 Tunisian governorates on NIAPOLOR.',
      },
    },
  },
  returns: {
    path: '/returns',
    index: true,
    meta: {
      ar: {
        title: 'سياسة الاسترجاع والاستبدال | NIAPOLOR',
        description:
          'شروط وإجراءات إرجاع أو استبدال المنتجات، وحالات العيوب المصنعية أو عدم المطابقة، وطرق رد المبالغ في NIAPOLOR.',
      },
      fr: {
        title: 'Politique de Retour et Échange | NIAPOLOR',
        description:
          'Conditions de retour et d’échange, produits défectueux ou non conformes, et délais de remboursement sur NIAPOLOR.',
      },
      en: {
        title: 'Returns & Refunds Policy | NIAPOLOR',
        description:
          'Return and exchange conditions, defective or wrong-item claims, and refund timelines at NIAPOLOR.',
      },
    },
  },
  faq: {
    path: '/faq',
    index: true,
    meta: {
      ar: {
        title: 'الأسئلة الشائعة (FAQ) | NIAPOLOR',
        description:
          'إجابات واضحة حول الطلب في تونس، الدفع عند الاستلام، البريد التونسي CCP، الشحن للولايات الـ24، والاسترجاع.',
      },
      fr: {
        title: 'Foire Aux Questions (FAQ) | NIAPOLOR',
        description:
          'Réponses claires sur les commandes en Tunisie, paiement à la livraison, virement CCP, livraison 24 gouvernorats et retours.',
      },
      en: {
        title: 'Frequently Asked Questions (FAQ) | NIAPOLOR',
        description:
          'Clear answers on ordering in Tunisia, Cash on Delivery, Poste CCP transfers, 24-governorate shipping, and returns.',
      },
    },
  },
  privacy: {
    path: '/privacy',
    index: true,
    meta: {
      ar: {
        title: 'سياسة الخصوصية وحماية المعطيات | NIAPOLOR',
        description:
          'كيف تجمع NIAPOLOR بيانات الطلب والتوصيل وتؤمن جلسات الحرفاء وتحمي خصوصيتك دون بيع بياناتك لأطراف تسويقية.',
      },
      fr: {
        title: 'Politique de Confidentialité | NIAPOLOR',
        description:
          'Comment NIAPOLOR collecte et sécurise vos données de commande, sessions et adresses sans revente à des tiers.',
      },
      en: {
        title: 'Privacy Policy & Data Protection | NIAPOLOR',
        description:
          'How NIAPOLOR collects, secures, and protects your order, session, and address data without selling to third-party brokers.',
      },
    },
  },
  terms: {
    path: '/terms',
    index: true,
    meta: {
      ar: {
        title: 'الشروط والأحكام العامة للبيع | NIAPOLOR',
        description:
          'الشروط المنظمة للطلب والأسعار بالدينار التونسي والدفع والتسليم وحقوق المستهلك في منصة NIAPOLOR.',
      },
      fr: {
        title: 'Conditions Générales d’Utilisation et de Vente | NIAPOLOR',
        description:
          'Conditions régissant les commandes, prix en dinar tunisien, paiement, livraison et droits des consommateurs sur NIAPOLOR.',
      },
      en: {
        title: 'Terms of Service & Conditions of Sale | NIAPOLOR',
        description:
          'Terms governing orders, TND pricing transparency, payment options, delivery, and consumer rights on NIAPOLOR.',
      },
    },
  },
  legal: {
    path: '/legal',
    index: true,
    meta: {
      ar: {
        title: 'البيانات القانونية والتجارية (Mentions Légales) | NIAPOLOR',
        description:
          'الهوية القانونية والتجارية ومعرّف السجل الوطني للمؤسسات (RNE) والمعرّف الجبائي وبيانات الاستضافة الرسمية لمنصة NIAPOLOR.',
      },
      fr: {
        title: 'Mentions Légales & Transparence | NIAPOLOR Tunisie',
        description:
          'Informations légales, immatriculation RNE, matricule fiscal et coordonnées d’hébergement de la plateforme NIAPOLOR en Tunisie.',
      },
      en: {
        title: 'Legal Notice & Disclosures | NIAPOLOR Tunisia',
        description:
          'Corporate identity, RNE commercial registration, tax disclosure, and cloud hosting information for NIAPOLOR Tunisia.',
      },
    },
  },
  seller_terms: {
    path: '/seller-terms',
    index: true,
    meta: {
      ar: {
        title: 'شروط البائعين والشركاء | NIAPOLOR',
        description:
          'ميثاق والتزامات البائعين والشركاء التجاريين في سوق NIAPOLOR متعدد الفئات في تونس.',
      },
      fr: {
        title: 'Conditions Vendeurs & Partenaires | NIAPOLOR',
        description:
          'Accord commercial et obligations de conformité des vendeurs et partenaires sur la marketplace NIAPOLOR Tunisie.',
      },
      en: {
        title: 'Seller & Partner Terms | NIAPOLOR',
        description:
          'Marketplace compliance agreement, commission terms, and fulfillment obligations for NIAPOLOR Tunisia sellers and partners.',
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

const SOCIAL_BANNER_PATH = '/assets/aistudio/file_00000000be6881f49861ea9a4fa7fa90_4cf997af.png';
const SOCIAL_BANNER_WIDTH = '1679';
const SOCIAL_BANNER_HEIGHT = '937';

function removeMeta(attr: 'name' | 'property', key: string) {
  const el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (el) el.remove();
}

function toAbsoluteUrl(origin: string, urlOrPath?: string): string {
  if (!urlOrPath) return `${origin}${SOCIAL_BANNER_PATH}`;
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

function updatePageSchemaJsonLd(origin: string, view: string, lang: Language) {
  const existing = document.getElementById('niapolor-page-schema');
  const page = PAGES[view];
  const legalViews = ['about', 'shipping', 'returns', 'faq', 'privacy', 'terms', 'legal', 'seller_terms'];
  if (!page || !legalViews.includes(view)) {
    if (existing) existing.remove();
    return;
  }

  const t = getTranslation(lang) as any;
  const pageUrl = `${origin}${page.path}`;
  const metaForLang = page.meta[lang] || page.meta.ar;

  let schema: Record<string, any>;
  if (view === 'faq' && Array.isArray(t?.legalPages?.faq?.items)) {
    schema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      name: metaForLang.title,
      url: pageUrl,
      mainEntity: t.legalPages.faq.items.map((item: { q: string; a: string }) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.a,
        },
      })),
    };
  } else {
    schema = {
      '@context': 'https://schema.org',
      '@type': view === 'about' ? 'AboutPage' : 'WebPage',
      name: metaForLang.title,
      description: metaForLang.description,
      url: pageUrl,
      inLanguage: lang === 'ar' ? 'ar-TN' : lang === 'fr' ? 'fr-TN' : 'en',
    };
  }

  const scriptEl =
    (existing as HTMLScriptElement | null) ||
    (() => {
      const s = document.createElement('script');
      s.id = 'niapolor-page-schema';
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
    setMeta('property', 'og:image:secure_url', productImg);
    removeMeta('property', 'og:image:type');
    removeMeta('property', 'og:image:width');
    removeMeta('property', 'og:image:height');
    setMeta('property', 'og:image:alt', productTitle);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', productTitle);
    setMeta('name', 'twitter:description', productDesc);
    setMeta('name', 'twitter:image', productImg);
    setMeta('name', 'twitter:image:alt', productTitle);

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
    updatePageSchemaJsonLd(origin, 'product', lang);
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
  const defaultHeroImage = `${origin}${SOCIAL_BANNER_PATH}`;

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
  setMeta('property', 'og:image:secure_url', defaultHeroImage);
  setMeta('property', 'og:image:type', 'image/png');
  setMeta('property', 'og:image:width', SOCIAL_BANNER_WIDTH);
  setMeta('property', 'og:image:height', SOCIAL_BANNER_HEIGHT);
  setMeta('property', 'og:image:alt', metaForLang.title);
  setMeta('name', 'twitter:card', 'summary_large_image');
  setMeta('name', 'twitter:title', metaForLang.title);
  setMeta('name', 'twitter:description', metaForLang.description);
  setMeta('name', 'twitter:image', defaultHeroImage);
  setMeta('name', 'twitter:image:alt', metaForLang.title);

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

  updatePageSchemaJsonLd(origin, normalizedView, lang);
}
