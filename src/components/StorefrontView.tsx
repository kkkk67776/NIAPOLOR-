import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { ProductCard } from './ProductCard';
import {
  ArrowLeft,
  Star,
  MapPin,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  Truck,
  Banknote,
  Headphones,
  Check,
  Plus,
} from 'lucide-react';
import { TUNISIAN_GOVERNORATES } from '../data/governorates';
import { Product } from '../types';
import { handleStoreImageError, handleStoreImageLoad } from '../lib/imageFallback';

export const StorefrontView: React.FC = () => {
  const {
    products,
    categories,
    language,
    t,
    searchQuery,
    selectedCategory,
    setSelectedCategory,
    setSelectedProductId,
    addToCart,
    banners,
  } = useStore();

  const [selectedGovFilter, setSelectedGovFilter] = useState<string>('all');
  const [addedItemIds, setAddedItemIds] = useState<Record<string, boolean>>({});

  const handleQuickAdd = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    addToCart(product, 1);
    setAddedItemIds((prev) => ({ ...prev, [product.id]: true }));
    setTimeout(() => {
      setAddedItemIds((prev) => ({ ...prev, [product.id]: false }));
    }, 1200);
  };

  // Filter products by category, search query, active status, and governorate
  const filteredProducts = products.filter((product) => {
    if (!product.active) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName =
        product.name[language]?.toLowerCase().includes(q) ||
        product.name.ar.toLowerCase().includes(q) ||
        product.name.fr.toLowerCase().includes(q);
      const matchComp = product.companyName?.toLowerCase().includes(q);
      const matchDesc = product.description[language]?.toLowerCase().includes(q);
      if (!matchName && !matchComp && !matchDesc) return false;
    }

    if (selectedCategory !== 'all' && product.category !== selectedCategory) {
      return false;
    }

    if (selectedGovFilter !== 'all' && product.governorate !== selectedGovFilter) {
      return false;
    }

    return true;
  });

  const activeProducts = products.filter((p) => p.active);
  const featuredShowcase = activeProducts.slice(0, 6);
  const topTrending = activeProducts
    .slice()
    .sort((a, b) => (b.rating || 5) - (a.rating || 5))
    .slice(0, 6);
  const powerToolsOnly = activeProducts.filter((p) => p.category === 'power_tools');

  const isBrowsingAll =
    selectedCategory === 'all' && !searchQuery.trim() && selectedGovFilter === 'all';

  const categoryChips = (
    categories && categories.length > 0
      ? categories
      : [
          { id: 'all', label: t.categories.all },
          { id: 'power_tools', label: t.categories.power_tools },
          { id: 'auto_parts', label: t.categories.auto_parts },
          { id: 'electronics', label: t.categories.electronics },
          { id: 'industrial', label: t.categories.industrial },
          { id: 'smart_home', label: t.categories.smart_home },
        ]
  ).map((c) => ({
    ...c,
    label: (t.categories as Record<string, string>)[c.id] || c.label,
  }));

  const scrollToCatalog = () => {
    const el = document.getElementById('niapolor-catalog');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="space-y-7 sm:space-y-10 pb-24 bg-[#FAF9F7] dark:bg-[#0B0B0D] transition-colors">
      {/* 1. NIAPOLOR DUAL-THEME STUDIO HERO BANNER (Smartphone, Headphones, Watch, Leather Accessories & Bag) */}
      <section
        dir="ltr"
        className="relative overflow-hidden border-b border-[#E6E2D8] dark:border-[#1E1E24] bg-[#ECEDEB] dark:bg-[#101012]"
      >
        <div className="relative max-w-[1440px] mx-auto min-h-[245px] sm:min-h-[340px] lg:min-h-[420px] flex items-center">
          {/* Light Theme Studio Product Photography */}
          <img
            src="/assets/images/hero-niapolor-light.webp"
            alt={t.hero.title}
            referrerPolicy="no-referrer"
            className="block dark:hidden absolute inset-0 w-full h-full object-cover object-right select-none pointer-events-none"
          />

          {/* Dark Theme Studio Product Photography */}
          <img
            src="/assets/images/hero-niapolor-dark.webp"
            alt={t.hero.title}
            referrerPolicy="no-referrer"
            className="hidden dark:block absolute inset-0 w-full h-full object-cover object-right select-none pointer-events-none"
          />

          {/* Protective Directional Scrim Keeping Headline & CTA Ultra-Crisp Without Obscuring Right-Side Products */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#ECEDEB] via-[#ECEDEB]/80 sm:via-[#ECEDEB]/55 to-transparent dark:from-[#101012] dark:via-[#101012]/80 sm:dark:via-[#101012]/55 dark:to-transparent"
          />

          {/* Foreground Editorial Copy + Fiery Orange CTA (Anchored in Open Left Studio Zone) */}
          <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12 lg:py-16">
            <div
              dir={language === 'ar' ? 'rtl' : 'ltr'}
              className="max-w-[55%] sm:max-w-md lg:max-w-lg space-y-3.5 sm:space-y-5"
            >
              <h1 className="font-editorial text-[1.35rem] sm:text-4xl lg:text-[2.85rem] font-black leading-[1.1] tracking-tight text-[#111113] dark:text-[#FFFFFF] text-balance">
                {t.hero.title}
              </h1>

              <p className="hidden sm:block text-sm text-[#4F4D49] dark:text-[#B5B0A8] leading-relaxed max-w-md font-medium">
                {t.hero.subtitle}
              </p>

              <div className="pt-0.5 sm:pt-1">
                <button
                  type="button"
                  onClick={scrollToCatalog}
                  className="inline-flex items-center justify-center px-5 sm:px-7 py-2.5 sm:py-3 rounded-lg bg-[#FF6B00] hover:bg-[#E05E00] text-white text-xs sm:text-sm font-black uppercase tracking-wider shadow-[0_10px_24px_-6px_rgba(255,107,0,0.48)] transition-all cursor-pointer active:scale-95"
                >
                  {t.hero.shopNow}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. CATEGORY CHIPS BAR (Directly beneath Hero with 'NEW' kicker on All — Matches Mobile Reference) */}
      <section className="max-w-7xl mx-auto px-3 sm:px-6 w-full max-w-full overflow-hidden -mt-3 sm:-mt-4">
        <div className="flex items-end gap-2 overflow-x-auto pt-3 pb-1 scrollbar-none snap-x">
          {categoryChips.map((chip) => {
            const isSelected = selectedCategory === chip.id;
            return (
              <div key={chip.id} className="relative flex flex-col items-center shrink-0">
                {chip.id === 'all' && (
                  <span className="text-[8px] font-black tracking-[0.18em] uppercase text-[#FF6B00] mb-0.5">
                    NEW
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedCategory(chip.id)}
                  className={`px-4 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition-all cursor-pointer active:scale-95 ${
                    isSelected
                      ? 'bg-[#FF6B00] text-white shadow-[0_4px_12px_rgba(255,107,0,0.35)]'
                      : 'bg-white dark:bg-[#141418] text-[#3D3A35] dark:text-[#D5D1C8] hover:text-[#111113] dark:hover:text-white border border-[#E6E2D8] dark:border-[#27272E] hover:border-[#FF6B00]/50'
                  }`}
                >
                  {chip.label}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Optional Admin Promotional Banners */}
      {banners && banners.filter((b) => b.active).length > 0 && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6">
          <div className="space-y-2">
            {banners
              .filter((b) => b.active)
              .map((b) => {
                const displayTag =
                  b.id === 'banner_1' || b.tag === 'عروض حصرية'
                    ? t.storefront?.defaultBannerTag || b.tag
                    : b.tag || t.storefront?.defaultBannerTag;
                const displayTitle =
                  b.id === 'banner_1' || b.title === 'عروض وتخفيضات اليوم على كافة المعدات وقطع الغيار'
                    ? t.storefront?.defaultBannerTitle || b.title
                    : b.title;
                const displaySubtitle =
                  b.id === 'banner_1' || b.subtitle === 'توصيل سريع لكافة الـ24 ولاية والدفع عند المعاينة والاستلام'
                    ? t.storefront?.defaultBannerSubtitle || b.subtitle
                    : b.subtitle;
                return (
                  <div
                    key={b.id}
                    className={`rounded-2xl bg-gradient-to-r ${b.bgGradient || 'from-[#18181D] via-[#121216] to-[#FF6B00]'} text-white px-4 py-3 shadow-xs flex items-center justify-between gap-3 overflow-hidden relative border border-[#27272E]`}
                  >
                    <div className="flex items-center gap-2.5 z-10">
                      <span className="w-7 h-7 rounded-lg bg-[#FF6B00] flex items-center justify-center shrink-0">
                        <Sparkles className="w-4 h-4 text-white" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-black uppercase tracking-wider bg-white text-[#111113] px-2 py-0.5 rounded-md">
                            {displayTag}
                          </span>
                          <span className="text-xs sm:text-sm font-black text-white">{displayTitle}</span>
                        </div>
                        {displaySubtitle && (
                          <p className="text-[11px] text-white/85 hidden xs:block mt-0.5">{displaySubtitle}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 3. FEATURED PRODUCTS + TOP TRENDING WHEN BROWSING ALL */}
      {isBrowsingAll && (
        <>
          {/* FEATURED PRODUCTS SHOWCASE */}
          <section className="max-w-7xl mx-auto px-3 sm:px-6 space-y-3.5 w-full max-w-full overflow-hidden">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm sm:text-lg font-black uppercase tracking-[0.06em] text-[#111113] dark:text-[#F7F6F3] leading-tight">
                  {language === 'ar'
                    ? 'المنتجات المميزة'
                    : language === 'fr'
                    ? 'PRODUITS VEDETTES'
                    : 'FEATURED PRODUCTS'}
                </h2>
                <p className="text-[11px] text-[#6B665F] dark:text-[#A19E97] font-medium">
                  {t.storefront?.suggestedDesc || 'اختيارات فاخرة من تشكيلة الموسم الجديد'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCategory('power_tools')}
                className="flex items-center gap-1 text-xs font-extrabold text-[#FF6B00] hover:text-[#E05E00] p-1 rounded-lg hover:bg-[#FF6B00]/10 transition-colors cursor-pointer"
                title={t.storefront?.more || 'المزيد'}
              >
                <span className="hidden sm:inline">{t.storefront?.more || 'المزيد'}</span>
                <ArrowLeft className={`w-4 h-4 ${language !== 'ar' ? 'rotate-180' : ''}`} />
              </button>
            </div>

            <div className="w-full max-w-full overflow-hidden">
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x w-full max-w-full">
                {featuredShowcase.map((product) => {
                  const prodName = product.name[language] || product.name.ar;
                  const isAdded = addedItemIds[product.id];
                  const hasDiscount = Boolean(product.originalPrice && product.originalPrice > product.price);
                  const topBadgeLabel = hasDiscount
                    ? t.storefront?.discountBadge || 'تخفيض'
                    : product.featured
                    ? language === 'ar'
                      ? 'حصري'
                      : 'EXCLUSIVE'
                    : language === 'ar'
                    ? 'تشكيلة جديدة'
                    : 'NEW SEASON';

                  return (
                    <div
                      key={product.id}
                      onClick={() => setSelectedProductId(product.id)}
                      className="w-40 sm:w-48 shrink-0 snap-start bg-white dark:bg-[#141418] rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] hover:border-[#FF6B00]/60 overflow-hidden flex flex-col justify-between cursor-pointer group transition-all hover:shadow-lg"
                    >
                      <div>
                        <div className="py-1 px-2 text-center border-b border-[#F0EDE6] dark:border-[#1E1E24] bg-[#FAF9F7] dark:bg-[#18181D]">
                          <span
                            className={`text-[9px] font-extrabold uppercase tracking-[0.16em] ${
                              hasDiscount ? 'text-[#FF6B00]' : 'text-[#6B665F] dark:text-[#9A958E]'
                            }`}
                          >
                            {topBadgeLabel}
                          </span>
                        </div>

                        <div className="p-2.5 pb-1">
                          <div className="aspect-square w-full bg-[#FAF9F7] dark:bg-[#0B0B0D] rounded-xl overflow-hidden p-2 flex items-center justify-center relative">
                            <img
                              src={product.images[0] || '/assets/images/niapolor-badge.webp'}
                              alt={prodName}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={handleStoreImageError}
                              onLoad={handleStoreImageLoad}
                              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                            />
                          </div>

                          <div className="pt-2 text-center">
                            <h3 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] line-clamp-2 leading-tight group-hover:text-[#FF6B00] transition-colors min-h-[2rem]">
                              {prodName}
                            </h3>
                            <p className="text-xs sm:text-sm font-black text-[#FF6B00] tabular-nums mt-1">
                              {product.price.toFixed(3)} {t.cart.currency}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="p-2.5 pt-1.5">
                        <button
                          type="button"
                          onClick={(e) => handleQuickAdd(e, product)}
                          className={`w-full py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 ${
                            isAdded ? 'bg-emerald-600 text-white' : 'bg-[#FF6B00] hover:bg-[#E05E00] text-white'
                          }`}
                        >
                          {isAdded ? (
                            <>
                              <Check className="w-3 h-3" />
                              <span>{t.storefront?.quickAdded || 'تم ✓'}</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3 h-3" />
                              <span>{t.product?.addToCart || 'أضف للسلة'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Top Trending Compact List */}
          <section className="max-w-7xl mx-auto px-3 sm:px-6 space-y-3 w-full max-w-full">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-[#FF6B00]/12 flex items-center justify-center text-[#FF6B00]">
                  <TrendingUp className="w-4 h-4" />
                </span>
                <div>
                  <h2 className="text-sm sm:text-lg font-black text-[#111113] dark:text-[#F7F6F3] leading-tight">
                    {t.storefront?.topTrending || 'أفضل الترتيبات • الأكثر طلباً'}
                  </h2>
                  <p className="text-[11px] text-[#6B665F] dark:text-[#A19E97] font-medium">
                    {t.storefront?.topTrendingDesc}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={scrollToCatalog}
                className="flex items-center gap-1 text-xs font-extrabold text-[#FF6B00] hover:text-[#E05E00] p-1 rounded-lg hover:bg-[#FF6B00]/10 transition-colors cursor-pointer"
              >
                <span className="hidden sm:inline">{t.storefront?.all || 'الكل'}</span>
                <ArrowLeft className={`w-4 h-4 ${language !== 'ar' ? 'rotate-180' : ''}`} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {topTrending.map((product, index) => {
                const prodName = product.name[language] || product.name.ar;
                const isAdded = addedItemIds[product.id];
                return (
                  <div
                    key={product.id}
                    onClick={() => setSelectedProductId(product.id)}
                    className="p-2.5 rounded-2xl bg-white dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#23232A] hover:border-[#FF6B00]/50 flex items-center justify-between gap-3 cursor-pointer group transition-all hover:shadow-sm"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 text-xs font-black text-[#C8A25A] tabular-nums text-center shrink-0">
                        {index + 1}
                      </span>

                      <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-xl bg-[#FAF9F7] dark:bg-[#0B0B0D] border border-[#E6E2D8] dark:border-[#23232A] p-1 shrink-0 flex items-center justify-center overflow-hidden">
                        <img
                          src={product.images[0] || '/assets/images/niapolor-badge.webp'}
                          alt={prodName}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={handleStoreImageError}
                          onLoad={handleStoreImageLoad}
                          className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                        />
                      </div>

                      <div className="min-w-0 truncate">
                        <h4 className="text-xs sm:text-sm font-bold text-[#111113] dark:text-[#F7F6F3] truncate group-hover:text-[#FF6B00] transition-colors">
                          {prodName}
                        </h4>
                        <div className="flex items-center gap-1.5 text-[10px] text-[#6B665F] dark:text-[#A19E97] font-semibold truncate mt-0.5">
                          <span className="text-[#FF6B00]">{product.companyName}</span>
                          <span>•</span>
                          <span className="flex items-center gap-0.5">
                            <Star className="w-3 h-3 fill-[#FF6B00] text-[#FF6B00] shrink-0" />
                            <span className="text-[#111113] dark:text-[#F7F6F3]">{product.rating || '4.9'}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs sm:text-sm font-black text-[#FF6B00] tabular-nums">
                        {product.price.toFixed(3)} {t.cart.currency}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleQuickAdd(e, product)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-all cursor-pointer active:scale-95 ${
                          isAdded
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#FF6B00] hover:bg-[#E05E00] text-white'
                        }`}
                      >
                        {isAdded ? (t.storefront?.quickAdded || 'تم ✓') : (t.storefront?.quickAdd || 'أضف')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Power Tools Highlight Carousel */}
          {powerToolsOnly.length > 0 && (
            <section className="max-w-7xl mx-auto px-3 sm:px-6 space-y-3 w-full max-w-full overflow-hidden">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm sm:text-lg font-black text-[#111113] dark:text-[#F7F6F3] leading-tight">
                    {t.storefront?.powerToolsTitle || 'أدوات ومعدات ميكانيكية وكهربائية'}
                  </h2>
                  <p className="text-[11px] text-[#6B665F] dark:text-[#A19E97] font-medium">
                    {t.storefront?.powerToolsDesc}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedCategory('power_tools')}
                  className="flex items-center gap-1 text-xs font-extrabold text-[#FF6B00] hover:text-[#E05E00] p-1 rounded-lg hover:bg-[#FF6B00]/10 transition-colors cursor-pointer"
                >
                  <span className="hidden sm:inline">{t.storefront?.more || 'المزيد'}</span>
                  <ArrowLeft className={`w-4 h-4 ${language !== 'ar' ? 'rotate-180' : ''}`} />
                </button>
              </div>

              <div className="w-full max-w-full overflow-hidden">
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x w-full max-w-full">
                  {powerToolsOnly.map((product) => {
                    const prodName = product.name[language] || product.name.ar;
                    const isAdded = addedItemIds[product.id];
                    return (
                      <div
                        key={product.id}
                        onClick={() => setSelectedProductId(product.id)}
                        className="w-40 sm:w-48 shrink-0 snap-start bg-white dark:bg-[#141418] rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] hover:border-[#FF6B00]/60 p-2.5 flex flex-col justify-between cursor-pointer group transition-all hover:shadow-md"
                      >
                        <div>
                          <div className="aspect-square w-full bg-[#FAF9F7] dark:bg-[#0B0B0D] rounded-xl overflow-hidden p-2 flex items-center justify-center">
                            <img
                              src={product.images[0] || '/assets/images/niapolor-badge.webp'}
                              alt={prodName}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={handleStoreImageError}
                              onLoad={handleStoreImageLoad}
                              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                            />
                          </div>

                          <div className="pt-2">
                            <span className="text-[10px] text-[#7A756D] dark:text-[#9A958E] font-semibold block truncate">
                              {product.companyName}
                            </span>
                            <h3 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] line-clamp-2 leading-tight group-hover:text-[#FF6B00] transition-colors min-h-[1.9rem] my-0.5">
                              {prodName}
                            </h3>
                          </div>
                        </div>

                        <div className="pt-1.5 border-t border-[#F0EDE6] dark:border-[#1E1E24] flex items-center justify-between gap-1">
                          <div>
                            <span className="text-xs sm:text-sm font-black text-[#FF6B00] tabular-nums block leading-none">
                              {product.price.toFixed(3)}
                            </span>
                            <span className="text-[9px] text-[#7A756D] dark:text-[#9A958E] font-bold">
                              {t.cart.currency}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => handleQuickAdd(e, product)}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                              isAdded ? 'bg-emerald-600 text-white' : 'bg-[#FF6B00] hover:bg-[#E05E00] text-white'
                            }`}
                          >
                            {isAdded ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* 4. CATALOG FILTER BAR & FULL PRODUCT GRID */}
      <section id="niapolor-catalog" className="max-w-7xl mx-auto px-3 sm:px-6 w-full max-w-full scroll-mt-20">
        <div className="flex items-center justify-between gap-2 bg-white dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#23232A] p-2.5 sm:p-3 rounded-2xl">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#FF6B00]" />
            <span className="text-xs sm:text-sm font-black text-[#111113] dark:text-[#F7F6F3]">
              {t.storefront?.allProducts || 'كافة المعروضات'} ({filteredProducts.length})
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-[#FF6B00] shrink-0" />
            <select
              value={selectedGovFilter}
              onChange={(e) => setSelectedGovFilter(e.target.value)}
              className="text-xs py-1.5 px-3 rounded-lg border border-[#E6E2D8] dark:border-[#27272E] bg-[#FAF9F7] dark:bg-[#0B0B0D] font-bold text-[#111113] dark:text-[#F7F6F3] focus:outline-none focus:border-[#FF6B00] cursor-pointer"
            >
              <option value="all">{t.storefront?.allGovernorates || 'كافة ولايات تونس (الكل)'}</option>
              {TUNISIAN_GOVERNORATES.map((gov) => (
                <option key={gov.id} value={gov.id}>
                  {language === 'fr'
                    ? gov.nameFr
                    : language === 'en'
                    ? gov.nameEn
                    : `${t.storefront?.governoratePrefix || 'ولاية'} ${gov.nameAr}`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 w-full max-w-full">
        {filteredProducts.length === 0 ? (
          <div className="py-12 text-center bg-white dark:bg-[#141418] rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] p-6 space-y-3">
            <h3 className="text-sm font-bold text-[#111113] dark:text-[#F7F6F3]">
              {t.storefront?.noProductsFound || 'لا توجد منتجات مطابقة لبحثك أو الفلتر'}
            </h3>
            <p className="text-xs text-[#6B665F] dark:text-[#A19E97]">
              {t.storefront?.noProductsDesc || 'جرب اختيار تصنيف آخر أو تفريغ شريط البحث'}
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                setSelectedGovFilter('all');
              }}
              className="text-xs font-extrabold text-[#FF6B00] hover:underline cursor-pointer"
            >
              {t.storefront?.resetFilters || 'إعادة ضبط الفلاتر وعرض كافة المنتجات'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
            {filteredProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </main>

      {/* 5. LUXURY TRUST STRIP */}
      <section className="max-w-7xl mx-auto px-3 sm:px-6 pt-2 w-full max-w-full">
        <div className="rounded-2xl bg-white dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#23232A] p-3.5 sm:p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <div className="flex items-center gap-2.5 p-2.5 bg-[#FAF9F7] dark:bg-[#0B0B0D] rounded-xl border border-[#E6E2D8]/80 dark:border-[#23232A]">
              <div className="w-8 h-8 rounded-lg bg-[#FF6B00]/12 text-[#FF6B00] flex items-center justify-center shrink-0">
                <Truck className="w-4 h-4" />
              </div>
              <div className="truncate">
                <h4 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] leading-tight">
                  {t.storefront?.trustFastDelivery || 'توصيل سريع'}
                </h4>
                <p className="text-[10px] text-[#6B665F] dark:text-[#A19E97] leading-tight">
                  {t.storefront?.trustFastDeliveryDesc}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 p-2.5 bg-[#FAF9F7] dark:bg-[#0B0B0D] rounded-xl border border-[#E6E2D8]/80 dark:border-[#23232A]">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Banknote className="w-4 h-4" />
              </div>
              <div className="truncate">
                <h4 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] leading-tight">
                  {t.storefront?.trustCod || 'دفع عند الاستلام'}
                </h4>
                <p className="text-[10px] text-[#6B665F] dark:text-[#A19E97] leading-tight">
                  {t.storefront?.trustCodDesc}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 p-2.5 bg-[#FAF9F7] dark:bg-[#0B0B0D] rounded-xl border border-[#E6E2D8]/80 dark:border-[#23232A]">
              <div className="w-8 h-8 rounded-lg bg-[#FF6B00]/12 text-[#FF6B00] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="truncate">
                <h4 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] leading-tight">
                  {t.storefront?.trustGenuine || 'قطع ومعدات أصلية'}
                </h4>
                <p className="text-[10px] text-[#6B665F] dark:text-[#A19E97] leading-tight">
                  {t.storefront?.trustGenuineDesc}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 p-2.5 bg-[#FAF9F7] dark:bg-[#0B0B0D] rounded-xl border border-[#E6E2D8]/80 dark:border-[#23232A]">
              <div className="w-8 h-8 rounded-lg bg-[#C8A25A]/15 text-[#C8A25A] flex items-center justify-center shrink-0">
                <Headphones className="w-4 h-4" />
              </div>
              <div className="truncate">
                <h4 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] leading-tight">
                  {t.storefront?.trustDirectSupport || 'دعم وتتبع مباشر'}
                </h4>
                <p className="text-[10px] text-[#6B665F] dark:text-[#A19E97] leading-tight">
                  {t.storefront?.trustDirectSupportDesc}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
