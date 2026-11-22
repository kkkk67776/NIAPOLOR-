import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { ProductCard } from './ProductCard';
import {
  ArrowLeft,
  ArrowUpRight,
  Star,
  MapPin,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  Truck,
  CreditCard,
  Store,
  Check,
  Plus,
} from 'lucide-react';
import { TUNISIAN_GOVERNORATES } from '../data/governorates';
import { Product } from '../types';
import { handleStoreImageError, handleStoreImageLoad } from '../lib/imageFallback';
import catElectronicsImg from '../assets/images/cat_electronics_tech_1795344146522.jpg';
import catAutomotiveImg from '../assets/images/cat_automotive_mobility_1795344145510.jpg';
import catEquipmentImg from '../assets/images/cat_pro_equipment_1795344145754.jpg';
import catSmartLivingImg from '../assets/images/cat_smart_living_1795344145470.jpg';

const CATEGORY_SHOWCASE_IMAGES: Record<string, string> = {
  electronics: catElectronicsImg,
  auto_parts: catAutomotiveImg,
  power_tools: catEquipmentImg,
  smart_home: catSmartLivingImg,
  industrial: catEquipmentImg,
};

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
    setCurrentView,
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
        product.name.fr.toLowerCase().includes(q) ||
        product.name.en?.toLowerCase().includes(q);
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

  // Featured & Exclusive Offers (prioritize featured or discounted items)
  const featuredOffers = activeProducts
    .slice()
    .sort((a, b) => {
      const aScore = (a.featured ? 2 : 0) + (a.originalPrice && a.originalPrice > a.price ? 1 : 0);
      const bScore = (b.featured ? 2 : 0) + (b.originalPrice && b.originalPrice > b.price ? 1 : 0);
      return bScore - aScore;
    })
    .slice(0, 6);

  // Best-Selling & Trending Ranked
  const topTrending = activeProducts
    .slice()
    .sort((a, b) => (b.rating * 10 + (b.reviewCount || 0)) - (a.rating * 10 + (a.reviewCount || 0)))
    .slice(0, 6);

  // Cross-Category Recommended Showcase
  const recommendedProducts = activeProducts
    .slice()
    .sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0))
    .slice(0, 6);

  const isBrowsingAll =
    selectedCategory === 'all' && !searchQuery.trim() && selectedGovFilter === 'all';

  const categoryList = (
    categories && categories.length > 0
      ? categories
      : [
          { id: 'all', label: t.categories.all },
          { id: 'electronics', label: t.categories.electronics },
          { id: 'auto_parts', label: t.categories.auto_parts },
          { id: 'power_tools', label: t.categories.power_tools },
          { id: 'smart_home', label: t.categories.smart_home },
          { id: 'industrial', label: t.categories.industrial },
        ]
  ).map((c) => ({
    ...c,
    label: (t.categories as Record<string, string>)[c.id] || c.label,
  }));

  // Curated visual category cards (exclude 'all'; prioritize up to 4 main visual categories + any extra custom ones)
  const visualCategories = categoryList
    .filter((c) => c.id !== 'all')
    .slice(0, 4)
    .map((c, idx) => {
      const count = activeProducts.filter((p) => p.category === c.id).length;
      const fallbackPool = [catElectronicsImg, catAutomotiveImg, catEquipmentImg, catSmartLivingImg];
      return {
        ...c,
        count,
        image: CATEGORY_SHOWCASE_IMAGES[c.id] || fallbackPool[idx % fallbackPool.length],
      };
    });

  const scrollToCatalog = () => {
    const el = document.getElementById('niapolor-catalog');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSelectShowcaseCategory = (catId: string) => {
    setSelectedCategory(catId);
    setTimeout(scrollToCatalog, 60);
  };

  return (
    <div className="space-y-10 sm:space-y-14 pb-24 bg-[#FAF9F7] dark:bg-[#0B0B0D] transition-colors">
      {/* 1. SIGNATURE EDITORIAL HERO — NIAPOLOR: YOUR WORLD. ONE STORE. */}
      <section
        dir="ltr"
        className="relative overflow-hidden border-b border-[#E6E2D8] dark:border-[#1E1E26] bg-[#EAE8E2] dark:bg-[#0D0D11]"
      >
        <div className="relative max-w-[1440px] mx-auto min-h-[300px] sm:min-h-[390px] lg:min-h-[470px] flex items-center">
          {/* Light Theme Studio Photography */}
          <img
            src="/assets/images/hero-niapolor-light.webp"
            alt={t.hero.title}
            referrerPolicy="no-referrer"
            className="block dark:hidden absolute inset-0 w-full h-full object-cover object-right select-none pointer-events-none"
          />

          {/* Dark Theme Studio Photography */}
          <img
            src="/assets/images/hero-niapolor-dark.webp"
            alt={t.hero.title}
            referrerPolicy="no-referrer"
            className="hidden dark:block absolute inset-0 w-full h-full object-cover object-right select-none pointer-events-none"
          />

          {/* Subtle Fiery-Orange Ambient Rim Glow */}
          <div aria-hidden="true" className="niapolor-hero-glow pointer-events-none absolute inset-0" />

          {/* Protective Directional Scrim Keeping Headline & CTAs Crisp */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#EAE8E2] via-[#EAE8E2]/88 sm:via-[#EAE8E2]/68 to-transparent dark:from-[#0B0B0D] dark:via-[#0B0B0D]/88 sm:dark:via-[#0B0B0D]/70 dark:to-transparent"
          />

          {/* Foreground Editorial Copy & Dual Action Architecture */}
          <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14 lg:py-20">
            <div
              dir={language === 'ar' ? 'rtl' : 'ltr'}
              className="max-w-[78%] xs:max-w-[66%] sm:max-w-lg lg:max-w-xl space-y-4 sm:space-y-5"
            >
              {/* Brand Eyebrow Lockup */}
              <div className="inline-flex items-center gap-2.5 text-[10px] sm:text-xs font-black uppercase tracking-[0.2em] text-[#FF6B00]">
                <img
                  src="/assets/images/niapolor-emblem.webp"
                  alt=""
                  width={18}
                  height={18}
                  className="w-4.5 h-4.5 object-contain shrink-0"
                />
                <span>NIAPOLOR</span>
                <span aria-hidden="true" className="text-[#8E8980]">·</span>
                <span className="text-[#4F4D49] dark:text-[#C8A25A]">{t.hero.badge}</span>
              </div>

              <h1 className="font-editorial text-2xl sm:text-4xl lg:text-[3.1rem] font-black leading-[1.08] tracking-tight text-[#111113] dark:text-[#FFFFFF] text-balance">
                {t.hero.title}
              </h1>

              <p className="text-xs sm:text-sm lg:text-[15px] text-[#4F4D49] dark:text-[#B5B0A8] leading-relaxed max-w-lg font-medium line-clamp-3 sm:line-clamp-none">
                {t.hero.subtitle}
              </p>

              {/* Dual Primary + Seller/Marketplace Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={scrollToCatalog}
                  className="inline-flex items-center justify-center gap-2 px-6 sm:px-7 py-3 rounded-xl bg-[#FF6B00] hover:bg-[#E05E00] text-white text-xs sm:text-sm font-black uppercase tracking-wider shadow-[0_12px_28px_-8px_rgba(255,107,0,0.55)] transition-all cursor-pointer active:scale-95"
                >
                  <span>{t.hero.shopNow}</span>
                  <ArrowLeft className={`w-4 h-4 ${language !== 'ar' ? 'rotate-180' : ''}`} />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCurrentView('companies');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-4 sm:px-5 py-3 rounded-xl bg-white/80 dark:bg-[#18181E]/90 hover:bg-white dark:hover:bg-[#1D1D24] border border-[#D6D0C4] dark:border-[#2C2C36] hover:border-[#FF6B00]/60 text-[#111113] dark:text-[#F7F6F3] text-xs font-extrabold transition-all cursor-pointer active:scale-95"
                >
                  <Store className="w-3.5 h-3.5 text-[#FF6B00]" />
                  <span>{t.hero.exploreSellers || t.nav.companies}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Optional Admin Promotional Banners */}
      {banners && banners.filter((b) => b.active).length > 0 && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 -mt-4 sm:-mt-6">
          <div className="space-y-2.5">
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
                    className={`rounded-2xl bg-gradient-to-r ${b.bgGradient || 'from-[#131317] via-[#1A1412] to-[#FF6B00]/90'} text-white px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 overflow-hidden relative border border-[#2C2C36]`}
                  >
                    <div className="flex items-center gap-3 z-10">
                      <span className="w-8 h-8 rounded-xl bg-[#FF6B00] flex items-center justify-center shrink-0">
                        <Sparkles className="w-4 h-4 text-white" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-black uppercase tracking-wider text-[#FF8A33]">
                            {displayTag}
                          </span>
                          <span aria-hidden="true" className="text-white/40">·</span>
                          <span className="text-xs sm:text-sm font-black text-white">{displayTitle}</span>
                        </div>
                        {displaySubtitle && (
                          <p className="text-[11px] text-white/80 hidden sm:block mt-0.5">{displaySubtitle}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 2. ORGANIZED VISUAL MULTI-CATEGORY SHOWCASE */}
      {isBrowsingAll && (
        <section className="max-w-7xl mx-auto px-3 sm:px-6 space-y-5 w-full">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-base sm:text-xl font-black tracking-tight text-[#111113] dark:text-[#F7F6F3]">
                {t.storefront?.categoriesTitle}
              </h2>
              <p className="text-xs text-[#6B665F] dark:text-[#9A958E] font-medium mt-0.5">
                {t.storefront?.categoriesSubtitle}
              </p>
            </div>

            <button
              type="button"
              onClick={scrollToCatalog}
              className="flex items-center gap-1 text-xs font-extrabold text-[#FF6B00] hover:text-[#E05E00] transition-colors cursor-pointer shrink-0"
            >
              <span>{t.storefront?.more}</span>
              <ArrowLeft className={`w-3.5 h-3.5 ${language !== 'ar' ? 'rotate-180' : ''}`} />
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {visualCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleSelectShowcaseCategory(cat.id)}
                className="group relative aspect-[4/3] rounded-2xl overflow-hidden bg-[#131317] border border-[#E6E2D8] dark:border-[#23232C] hover:border-[#FF6B00]/75 text-start transition-all duration-200 hover:shadow-[0_16px_36px_-12px_rgba(255,107,0,0.22)] cursor-pointer"
              >
                <img
                  src={cat.image}
                  alt={cat.label}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-[#0B0B0D]/95 via-[#0B0B0D]/40 to-transparent"
                />

                <div className="relative z-10 h-full p-3.5 sm:p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-end">
                    <span className="w-7 h-7 rounded-lg bg-white/10 backdrop-blur-xs border border-white/15 text-white flex items-center justify-center group-hover:bg-[#FF6B00] group-hover:border-[#FF6B00] transition-colors">
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </span>
                  </div>

                  <div>
                    <h3 className="text-xs sm:text-sm font-black text-white leading-snug group-hover:text-[#FF8A33] transition-colors">
                      {cat.label}
                    </h3>
                    <span className="text-[10px] font-semibold text-[#B5B0A8] tabular-nums mt-0.5 block">
                      {cat.count} {t.bottomNav?.itemsCountSuffix}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 3. FEATURED & EXCLUSIVE OFFERS + BEST SELLING + RECOMMENDED (WHEN BROWSING ALL) */}
      {isBrowsingAll && (
        <>
          {/* FEATURED & EXCLUSIVE OFFERS */}
          <section className="max-w-7xl mx-auto px-3 sm:px-6 space-y-4 w-full overflow-hidden">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-base sm:text-xl font-black tracking-tight text-[#111113] dark:text-[#F7F6F3]">
                  {t.storefront?.featuredTitle}
                </h2>
                <p className="text-xs text-[#6B665F] dark:text-[#9A958E] font-medium mt-0.5">
                  {t.storefront?.featuredDesc}
                </p>
              </div>

              <button
                type="button"
                onClick={scrollToCatalog}
                className="flex items-center gap-1 text-xs font-extrabold text-[#FF6B00] hover:text-[#E05E00] transition-colors cursor-pointer shrink-0"
              >
                <span>{t.storefront?.more}</span>
                <ArrowLeft className={`w-3.5 h-3.5 ${language !== 'ar' ? 'rotate-180' : ''}`} />
              </button>
            </div>

            <div className="w-full overflow-hidden">
              <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 scrollbar-none snap-x w-full">
                {featuredOffers.map((product) => {
                  const prodName = product.name[language] || product.name.ar;
                  const isAdded = addedItemIds[product.id];
                  const discountPct =
                    product.originalPrice && product.originalPrice > product.price
                      ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
                      : 0;

                  return (
                    <div
                      key={product.id}
                      onClick={() => setSelectedProductId(product.id)}
                      className="w-44 sm:w-56 shrink-0 snap-start bg-white dark:bg-[#131317] rounded-2xl border border-[#E6E2D8] dark:border-[#23232C] hover:border-[#FF6B00]/65 overflow-hidden flex flex-col justify-between cursor-pointer group transition-all duration-200 hover:shadow-xl"
                    >
                      <div>
                        <div className="relative aspect-[4/3] w-full bg-[#F5F3EE] dark:bg-[#0D0D10] overflow-hidden p-3.5 flex items-center justify-center border-b border-[#ECE8DF] dark:border-[#1E1E26]">
                          <img
                            src={product.images[0] || '/assets/images/niapolor-badge.webp'}
                            alt={prodName}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={handleStoreImageError}
                            onLoad={handleStoreImageLoad}
                            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                          />
                          {discountPct > 0 && (
                            <span
                              className={`absolute top-2.5 ${language === 'ar' ? 'right-2.5' : 'left-2.5'} bg-[#FF6B00] text-white text-[10px] font-black px-2 py-0.5 rounded-md tabular-nums`}
                            >
                              -{discountPct}%
                            </span>
                          )}
                        </div>

                        <div className="p-3 pb-1 space-y-1">
                          <span className="text-[10px] font-semibold text-[#FF6B00] block truncate">
                            {product.companyName}
                          </span>
                          <h3 className="text-xs sm:text-sm font-bold text-[#111113] dark:text-[#F7F6F3] line-clamp-2 leading-snug group-hover:text-[#FF6B00] transition-colors min-h-[2.2rem]">
                            {prodName}
                          </h3>
                          <div className="flex items-baseline gap-1.5 pt-0.5 flex-wrap">
                            <span className="text-xs sm:text-sm font-black text-[#111113] dark:text-[#F7F6F3] tabular-nums">
                              {product.price.toFixed(3)} <span className="text-[#FF6B00]">{t.cart.currency}</span>
                            </span>
                            {product.originalPrice && product.originalPrice > product.price && (
                              <span className="text-[10px] text-[#8A857C] dark:text-[#6E6A63] line-through tabular-nums">
                                {product.originalPrice.toFixed(3)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="p-3 pt-2">
                        <button
                          type="button"
                          onClick={(e) => handleQuickAdd(e, product)}
                          className={`w-full py-2 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 ${
                            isAdded ? 'bg-emerald-600 text-white' : 'bg-[#FF6B00] hover:bg-[#E05E00] text-white'
                          }`}
                        >
                          {isAdded ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>{t.storefront?.quickAdded}</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              <span>{t.product?.addToCart}</span>
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

          {/* BEST SELLING & TRENDING */}
          <section className="max-w-7xl mx-auto px-3 sm:px-6 space-y-4 w-full">
            <div className="flex items-end justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-[#FF6B00]/12 flex items-center justify-center text-[#FF6B00] shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </span>
                <div>
                  <h2 className="text-base sm:text-xl font-black tracking-tight text-[#111113] dark:text-[#F7F6F3]">
                    {t.storefront?.topTrending}
                  </h2>
                  <p className="text-xs text-[#6B665F] dark:text-[#9A958E] font-medium mt-0.5">
                    {t.storefront?.topTrendingDesc}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={scrollToCatalog}
                className="flex items-center gap-1 text-xs font-extrabold text-[#FF6B00] hover:text-[#E05E00] transition-colors cursor-pointer shrink-0"
              >
                <span>{t.storefront?.all}</span>
                <ArrowLeft className={`w-3.5 h-3.5 ${language !== 'ar' ? 'rotate-180' : ''}`} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {topTrending.map((product, index) => {
                const prodName = product.name[language] || product.name.ar;
                const isAdded = addedItemIds[product.id];
                return (
                  <div
                    key={product.id}
                    onClick={() => setSelectedProductId(product.id)}
                    className="p-3 rounded-2xl bg-white dark:bg-[#131317] border border-[#E6E2D8] dark:border-[#23232C] hover:border-[#FF6B00]/55 flex items-center justify-between gap-3 cursor-pointer group transition-all hover:shadow-md"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 text-xs font-black text-[#C8A25A] tabular-nums text-center shrink-0">
                        0{index + 1}
                      </span>

                      <div className="w-14 h-14 rounded-xl bg-[#F5F3EE] dark:bg-[#0D0D10] border border-[#ECE8DF] dark:border-[#1E1E26] p-1.5 shrink-0 flex items-center justify-center overflow-hidden">
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

                      <div className="min-w-0">
                        <h4 className="text-xs sm:text-sm font-bold text-[#111113] dark:text-[#F7F6F3] truncate group-hover:text-[#FF6B00] transition-colors">
                          {prodName}
                        </h4>
                        <div className="flex items-center gap-1.5 text-[10px] text-[#7A756D] dark:text-[#8E8980] font-semibold truncate mt-0.5">
                          <span className="text-[#FF6B00] truncate">{product.companyName}</span>
                          <span aria-hidden="true">·</span>
                          <span className="flex items-center gap-0.5 shrink-0">
                            <Star className="w-3 h-3 fill-[#FF6B00] text-[#FF6B00]" />
                            <span className="text-[#111113] dark:text-[#F7F6F3] tabular-nums">{product.rating || '4.9'}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="text-end">
                        <span className="text-xs sm:text-sm font-black text-[#111113] dark:text-[#F7F6F3] tabular-nums block leading-none">
                          {product.price.toFixed(3)}
                        </span>
                        <span className="text-[9px] font-bold text-[#FF6B00]">{t.cart.currency}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleQuickAdd(e, product)}
                        className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all cursor-pointer active:scale-95 ${
                          isAdded
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#FF6B00] hover:bg-[#E05E00] text-white'
                        }`}
                      >
                        {isAdded ? t.storefront?.quickAdded : t.storefront?.quickAdd}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* RECOMMENDED FOR YOU (CURATED ACROSS ALL CATEGORIES) */}
          {recommendedProducts.length > 0 && (
            <section className="max-w-7xl mx-auto px-3 sm:px-6 space-y-4 w-full overflow-hidden">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-base sm:text-xl font-black tracking-tight text-[#111113] dark:text-[#F7F6F3]">
                    {t.storefront?.suggestedForYou}
                  </h2>
                  <p className="text-xs text-[#6B665F] dark:text-[#9A958E] font-medium mt-0.5">
                    {t.storefront?.suggestedDesc}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={scrollToCatalog}
                  className="flex items-center gap-1 text-xs font-extrabold text-[#FF6B00] hover:text-[#E05E00] transition-colors cursor-pointer shrink-0"
                >
                  <span>{t.storefront?.more}</span>
                  <ArrowLeft className={`w-3.5 h-3.5 ${language !== 'ar' ? 'rotate-180' : ''}`} />
                </button>
              </div>

              <div className="w-full overflow-hidden">
                <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 scrollbar-none snap-x w-full">
                  {recommendedProducts.map((product) => {
                    const prodName = product.name[language] || product.name.ar;
                    const isAdded = addedItemIds[product.id];
                    const catLabel = (t.categories as Record<string, string>)[product.category] || product.category;
                    return (
                      <div
                        key={`rec-${product.id}`}
                        onClick={() => setSelectedProductId(product.id)}
                        className="w-44 sm:w-52 shrink-0 snap-start bg-white dark:bg-[#131317] rounded-2xl border border-[#E6E2D8] dark:border-[#23232C] hover:border-[#FF6B00]/60 p-3 flex flex-col justify-between cursor-pointer group transition-all hover:shadow-lg"
                      >
                        <div>
                          <div className="aspect-[4/3] w-full bg-[#F5F3EE] dark:bg-[#0D0D10] rounded-xl overflow-hidden p-3 flex items-center justify-center border border-[#ECE8DF] dark:border-[#1E1E26]">
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

                          <div className="pt-2.5 space-y-1">
                            <span className="text-[10px] text-[#7A756D] dark:text-[#8E8980] font-semibold block truncate">
                              {catLabel}
                            </span>
                            <h3 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] line-clamp-2 leading-snug group-hover:text-[#FF6B00] transition-colors min-h-[2rem]">
                              {prodName}
                            </h3>
                          </div>
                        </div>

                        <div className="pt-2 mt-1.5 border-t border-[#ECE8DF] dark:border-[#1E1E26] flex items-center justify-between gap-2">
                          <div>
                            <span className="text-xs sm:text-sm font-black text-[#111113] dark:text-[#F7F6F3] tabular-nums block leading-none">
                              {product.price.toFixed(3)}
                            </span>
                            <span className="text-[9px] text-[#FF6B00] font-bold">{t.cart.currency}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => handleQuickAdd(e, product)}
                            aria-label={t.product.addToCart}
                            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                              isAdded ? 'bg-emerald-600 text-white' : 'bg-[#FF6B00] hover:bg-[#E05E00] text-white'
                            }`}
                          >
                            {isAdded ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
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

      {/* 4. INTERACTIVE FULL CATALOG WITH CLEAN SEGMENTED FILTER BAR */}
      <section id="niapolor-catalog" className="max-w-7xl mx-auto px-3 sm:px-6 w-full scroll-mt-20 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#E6E2D8] dark:border-[#23232C]">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1 md:pb-0">
            {categoryList.map((tab) => {
              const active = selectedCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedCategory(tab.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap transition-all cursor-pointer ${
                    active
                      ? 'bg-[#FF6B00] text-white shadow-[0_6px_16px_-4px_rgba(255,107,0,0.45)]'
                      : 'bg-white dark:bg-[#131317] text-[#5A5854] dark:text-[#B5B0A8] hover:text-[#111113] dark:hover:text-white border border-[#E6E2D8] dark:border-[#23232C]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between md:justify-end gap-3 shrink-0">
            <span className="text-xs font-bold text-[#6B665F] dark:text-[#9A958E] tabular-nums">
              {t.storefront?.allProducts} ({filteredProducts.length})
            </span>

            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#FF6B00] shrink-0" />
              <select
                value={selectedGovFilter}
                onChange={(e) => setSelectedGovFilter(e.target.value)}
                className="text-xs py-1.5 px-3 rounded-xl border border-[#E6E2D8] dark:border-[#23232C] bg-white dark:bg-[#131317] font-bold text-[#111113] dark:text-[#F7F6F3] focus:outline-none focus:border-[#FF6B00] cursor-pointer"
              >
                <option value="all">{t.storefront?.allGovernorates}</option>
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
        </div>

        {filteredProducts.length === 0 ? (
          <div className="py-12 text-center bg-white dark:bg-[#131317] rounded-2xl border border-[#E6E2D8] dark:border-[#23232C] p-6 space-y-3">
            <h3 className="text-sm font-bold text-[#111113] dark:text-[#F7F6F3]">
              {t.storefront?.noProductsFound}
            </h3>
            <p className="text-xs text-[#6B665F] dark:text-[#9A958E]">
              {t.storefront?.noProductsDesc}
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                setSelectedGovFilter('all');
              }}
              className="text-xs font-extrabold text-[#FF6B00] hover:underline cursor-pointer"
            >
              {t.storefront?.resetFilters}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
            {filteredProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      {/* 5. MARKETPLACE IDENTITY & TRUST STRIP (1-LEVEL ARCHITECTURAL HAIRLINE GRID) */}
      <section className="max-w-7xl mx-auto px-3 sm:px-6 w-full pt-2">
        <div className="rounded-3xl bg-white dark:bg-[#131317] border border-[#E6E2D8] dark:border-[#23232C] overflow-hidden">
          <div className="px-5 sm:px-8 py-5 sm:py-6 border-b border-[#E6E2D8] dark:border-[#23232C] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#FF6B00] block">
                NIAPOLOR MARKETPLACE
              </span>
              <h2 className="text-base sm:text-lg font-black text-[#111113] dark:text-[#F7F6F3]">
                {t.storefront?.marketplaceTitle}
              </h2>
              <p className="text-xs text-[#6B665F] dark:text-[#9A958E] max-w-2xl">
                {t.storefront?.marketplaceSubtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCurrentView('companies');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#111113] dark:bg-[#1D1D24] hover:bg-[#FF6B00] dark:hover:bg-[#FF6B00] border border-transparent dark:border-[#2C2C36] text-white text-xs font-bold transition-colors cursor-pointer shrink-0"
            >
              <Store className="w-4 h-4" />
              <span>{t.storefront?.marketplaceCta}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[#E6E2D8] dark:bg-[#23232C]">
            <div className="p-4 sm:p-5 bg-white dark:bg-[#131317] flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#FF6B00]/12 text-[#FF6B00] flex items-center justify-center shrink-0">
                <Truck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-extrabold text-[#111113] dark:text-[#F7F6F3]">
                  {t.storefront?.trustFastDelivery}
                </h3>
                <p className="text-[11px] text-[#6B665F] dark:text-[#9A958E] mt-0.5 leading-snug">
                  {t.storefront?.trustFastDeliveryDesc}
                </p>
              </div>
            </div>

            <div className="p-4 sm:p-5 bg-white dark:bg-[#131317] flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <CreditCard className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-extrabold text-[#111113] dark:text-[#F7F6F3]">
                  {t.storefront?.trustCod}
                </h3>
                <p className="text-[11px] text-[#6B665F] dark:text-[#9A958E] mt-0.5 leading-snug">
                  {t.storefront?.trustCodDesc}
                </p>
              </div>
            </div>

            <div className="p-4 sm:p-5 bg-white dark:bg-[#131317] flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#FF6B00]/12 text-[#FF6B00] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-extrabold text-[#111113] dark:text-[#F7F6F3]">
                  {t.storefront?.trustGenuine}
                </h3>
                <p className="text-[11px] text-[#6B665F] dark:text-[#9A958E] mt-0.5 leading-snug">
                  {t.storefront?.trustGenuineDesc}
                </p>
              </div>
            </div>

            <div className="p-4 sm:p-5 bg-white dark:bg-[#131317] flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#C8A25A]/15 text-[#C8A25A] flex items-center justify-center shrink-0">
                <Store className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-extrabold text-[#111113] dark:text-[#F7F6F3]">
                  {t.storefront?.trustDirectSupport}
                </h3>
                <p className="text-[11px] text-[#6B665F] dark:text-[#9A958E] mt-0.5 leading-snug">
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
