import React, { useState, useRef, useEffect } from 'react';
import { Home, LayoutGrid, Search, ShoppingBag, X, ChevronLeft, ArrowRight, Sparkles, TrendingUp, Star } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { Product } from '../types';
import { verifyAccessCodeServer } from '../lib/security';
import { handleStoreImageError } from '../lib/imageFallback';

interface BottomNavigationProps {
  onOpenVault?: () => void;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({ onOpenVault }) => {
  const { 
    currentView, 
    setCurrentView, 
    cart, 
    setIsCartOpen, 
    selectedCategory, 
    setSelectedCategory,
    setSelectedProductId,
    t,
    language,
    products,
    searchQuery,
    setSearchQuery,
    categories: storeCategories
  } = useStore();

  const [isCategoriesSheetOpen, setIsCategoriesSheetOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [localSearchInput, setLocalSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isNavVisible, setIsNavVisible] = useState(true);
  const accessCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightCodeRef = useRef<string | null>(null);
  const lastScrollYRef = useRef<number>(0);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    const handleOpenSearch = () => {
      setIsCategoriesSheetOpen(false);
      setIsSearchModalOpen(true);
    };
    window.addEventListener('open_echox_search', handleOpenSearch);
    return () => {
      window.removeEventListener('open_echox_search', handleOpenSearch);
      if (accessCheckTimerRef.current) clearTimeout(accessCheckTimerRef.current);
    };
  }, []);

  // Smart Scroll Hide/Show: smoothly hide on scroll down, reappear on scroll up or near bottom
  useEffect(() => {
    if (typeof window === 'undefined') return;
    lastScrollYRef.current = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);

    const onScroll = () => {
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const currentY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
        const delta = currentY - lastScrollYRef.current;

        if (Math.abs(delta) < 8) {
          return;
        }

        const docHeight = document.documentElement.scrollHeight;
        const nearBottom = window.innerHeight + currentY >= docHeight - 80;

        if (currentY <= 48 || nearBottom || delta < 0) {
          setIsNavVisible(true);
        } else if (currentY > 72 && delta > 0) {
          setIsNavVisible(false);
        }

        lastScrollYRef.current = currentY;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const totalCartItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  const hasMatchingProductsForTerm = (rawTerm: string): boolean => {
    const term = rawTerm.toLowerCase().trim();
    if (!term) return false;
    return products.some((item) => {
      const hay = [
        item.name?.ar,
        item.name?.fr,
        item.name?.en,
        item.description?.ar,
        item.description?.fr,
        item.description?.en,
        typeof (item as any).name === 'string' ? (item as any).name : '',
        typeof (item as any).description === 'string' ? (item as any).description : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
  };

  const runAccessCodeVerification = async (candidate: string, explicitSubmit: boolean = false) => {
    const clean = candidate.trim();
    if (clean.length < 4) return;
    if (!explicitSubmit && !(clean.startsWith('#') && clean.length >= 5)) return;
    if (hasMatchingProductsForTerm(clean)) return;
    if (inFlightCodeRef.current === clean) return;

    inFlightCodeRef.current = clean;
    try {
      const check = await verifyAccessCodeServer(clean);
      if (check.success) {
        setLocalSearchInput('');
        setSearchQuery('');
        setSearchResults([]);
        setIsSearchModalOpen(false);
        if (onOpenVault) onOpenVault();
        window.dispatchEvent(new CustomEvent('open_echox_vault'));
      }
      // Wrong codes, rate limits, or network errors are silently ignored
      // so the search bar behaves identically to a normal store search.
    } catch {
      // Silent fallback to normal search behavior
    } finally {
      if (inFlightCodeRef.current === clean) {
        inFlightCodeRef.current = null;
      }
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalSearchInput(val);
    setSearchQuery(val);

    if (accessCheckTimerRef.current) clearTimeout(accessCheckTimerRef.current);

    if (val.trim().length > 0) {
      const trimmed = val.trim();
      if (trimmed.startsWith('#') && trimmed.length >= 5) {
        accessCheckTimerRef.current = setTimeout(() => {
          void runAccessCodeVerification(trimmed, false);
        }, 1000);
      }

      // البحث عن المنتجات
      const term = val.toLowerCase().trim();
      const filtered = products.filter(item => {
        const nameAr = item.name?.ar?.toLowerCase() || '';
        const nameFr = item.name?.fr?.toLowerCase() || '';
        const nameEn = item.name?.en?.toLowerCase() || '';
        const descAr = item.description?.ar?.toLowerCase() || '';
        const descFr = item.description?.fr?.toLowerCase() || '';
        const descEn = item.description?.en?.toLowerCase() || '';
        const flatName = typeof (item as any).name === 'string' ? (item as any).name.toLowerCase() : '';
        const flatDesc = typeof (item as any).description === 'string' ? (item as any).description.toLowerCase() : '';

        return (
          nameAr.includes(term) ||
          nameFr.includes(term) ||
          nameEn.includes(term) ||
          descAr.includes(term) ||
          descFr.includes(term) ||
          descEn.includes(term) ||
          flatName.includes(term) ||
          flatDesc.includes(term)
        );
      });
      setSearchResults(filtered);
    } else {
      setSearchResults([]);
    }
  };

  const handleQuickTagClick = (tag: string) => {
    setLocalSearchInput(tag);
    setSearchQuery(tag);
    const term = tag.toLowerCase().trim();
    const filtered = products.filter(item => {
      const nameAr = item.name?.ar?.toLowerCase() || '';
      const nameFr = item.name?.fr?.toLowerCase() || '';
      const descAr = item.description?.ar?.toLowerCase() || '';
      return nameAr.includes(term) || nameFr.includes(term) || descAr.includes(term);
    });
    setSearchResults(filtered);
  };

  const handleSelectProduct = (product: Product) => {
    setSelectedProductId(product.id);
    setIsSearchModalOpen(false);
  };

  const categories = storeCategories && storeCategories.length > 0 ? storeCategories : [
    { id: 'all', label: t.categories.all, icon: '⚡', desc: 'كافة المعروضات المعتمدة' },
    { id: 'power_tools', label: t.categories.power_tools, icon: '🔧', desc: 'مثاقب، مناشير، ومعدات ورشات' },
    { id: 'auto_parts', label: t.categories.auto_parts, icon: '🚗', desc: 'قطع ميكانيكية وكهربائية للسيارات' },
    { id: 'electronics', label: t.categories.electronics, icon: '🔌', desc: 'أجهزة قياس، لوحات وقطع إلكترونية' },
    { id: 'industrial', label: t.categories.industrial, icon: '🏭', desc: 'معدات المصانع والورشات الثقيلة' },
    { id: 'smart_home', label: t.categories.smart_home, icon: '🏠', desc: 'أتمتة وحماية المنازل الذكية' },
  ];

  const handleTabClick = (tab: 'home' | 'categories' | 'search' | 'cart') => {
    if (tab === 'home') {
      setSelectedCategory('all');
      setSearchQuery('');
      if (currentView !== 'store' && currentView !== '/') {
        setCurrentView('store');
      }
      setIsCategoriesSheetOpen(false);
      setIsSearchModalOpen(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (tab === 'categories') {
      setIsSearchModalOpen(false);
      setIsCategoriesSheetOpen(true);
    } else if (tab === 'search') {
      setIsCategoriesSheetOpen(false);
      setIsSearchModalOpen(true);
    } else if (tab === 'cart') {
      setIsCategoriesSheetOpen(false);
      setIsSearchModalOpen(false);
      setIsCartOpen(true);
    }
  };

  const handleSelectCategory = (catId: string) => {
    setSelectedCategory(catId);
    if (currentView !== 'store' && currentView !== '/') {
      setCurrentView('store');
    }
    setIsCategoriesSheetOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isHomeActive = (currentView === 'store' || currentView === '/') && !isCategoriesSheetOpen && !isSearchModalOpen;
  const isCategoriesActive = isCategoriesSheetOpen;
  const isSearchActive = isSearchModalOpen;

  const popularTags = [
    'مثقاب كهربائي',
    'مفتاح عزم',
    'مضخة هواء',
    'فلتر زيت',
    'بطارية 20V',
    'قاطع ليزري'
  ];

  return (
    <>
      {/* 1. نافذة البحث الموحدة (تفتح من شريط الرأس أو تبويب البحث السفلي وتحتفظ بآلية البحث الآمنة) */}
      {isSearchModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#FAF9F7] dark:bg-[#0B0B0D] flex flex-col animate-fadeIn select-none text-[#111113] dark:text-[#F7F6F3]">
          {/* Top Bar for Search */}
          <div className="p-3 sm:p-4 border-b border-[#E6E2D8] dark:border-[#27272E] bg-white dark:bg-[#121216] flex items-center gap-2.5 max-w-5xl w-full mx-auto">
            <button
              type="button"
              onClick={() => {
                setIsSearchModalOpen(false);
                setLocalSearchInput('');
                setSearchResults([]);
              }}
              className="p-2.5 rounded-xl hover:bg-[#F3F1EC] dark:hover:bg-[#1C1C22] text-[#111113] dark:text-[#F7F6F3] transition-colors cursor-pointer shrink-0"
              title="رجوع"
            >
              <ArrowRight className={`w-5 h-5 ${language !== 'ar' ? 'rotate-180' : ''}`} />
            </button>

            {/* حقل البحث */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (accessCheckTimerRef.current) clearTimeout(accessCheckTimerRef.current);
                void runAccessCodeVerification(localSearchInput, true);
              }}
              className="flex-1 relative flex items-center bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#2C2C35] focus-within:border-[#FF6B00] dark:focus-within:border-[#FF6B00] focus-within:bg-white dark:focus-within:bg-[#121216] rounded-xl py-2.5 px-4 transition-all"
            >
              <Search className="w-4 h-4 text-[#FF6B00] mx-2 shrink-0" />
              <input
                type="search"
                enterKeyHint="search"
                value={localSearchInput}
                onChange={handleSearchChange}
                autoFocus
                placeholder={t.bottomNav?.searchPlaceholder || 'ابحث في المعدات والأجهزة وقطع الغيار...'}
                className="w-full bg-transparent text-xs sm:text-sm text-[#111113] dark:text-[#F7F6F3] placeholder-[#8A857C] dark:placeholder-[#6E6A63] outline-none"
              />
              {localSearchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setLocalSearchInput('');
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  className="p-1 text-[#7A756D] hover:text-[#111113] dark:hover:text-white rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </form>
          </div>

          {/* Search Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-5xl w-full mx-auto">

            {/* عندما لا يوجد نص بحث: اعرض الاقتراحات الشائعة */}
            {!localSearchInput.trim() && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 text-xs font-black tracking-wide text-[#111113] dark:text-[#F7F6F3] mb-3">
                    <TrendingUp className="w-4 h-4 text-[#FF6B00]" />
                    <span>عمليات البحث الشائعة في تونس</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {popularTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleQuickTagClick(tag)}
                        className="px-3.5 py-2 rounded-xl bg-white dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#27272E] hover:border-[#FF6B00] text-xs font-bold text-[#3D3A35] dark:text-[#D5D1C8] hover:text-[#FF6B00] transition-colors cursor-pointer"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-[#E6E2D8] dark:border-[#27272E]">
                  <div className="flex items-center gap-2 text-xs font-black tracking-wide text-[#111113] dark:text-[#F7F6F3] mb-3">
                    <Sparkles className="w-4 h-4 text-[#FF6B00]" />
                    <span>{t.bottomNav?.browseByCat || 'تصفح حسب القسم'}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {categories.slice(1).map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          handleSelectCategory(cat.id);
                          setIsSearchModalOpen(false);
                        }}
                        className="p-3 rounded-xl bg-white dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#27272E] hover:border-[#FF6B00] flex items-center gap-3 text-start cursor-pointer transition-colors"
                      >
                        <span className="text-lg w-8 h-8 rounded-lg bg-[#FAF9F7] dark:bg-[#1C1C22] flex items-center justify-center">{cat.icon}</span>
                        <span className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] truncate">
                          {(t.categories as Record<string, string>)[cat.id] || cat.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* نتائج البحث المباشرة */}
            {localSearchInput.trim() && searchResults.length > 0 && (
              <div className="space-y-2.5">
                <span className="text-xs font-bold text-[#6B665F] dark:text-[#A19E97] block mb-2">
                  {t.bottomNav?.foundMatches || 'عثرنا على'} ({searchResults.length}) {t.bottomNav?.matchingProductsSuffix || 'منتج مطابق:'}
                </span>
                {searchResults.map((product) => {
                  const prodName = product.name[language] || product.name.ar;
                  return (
                    <div
                      key={product.id}
                      onClick={() => handleSelectProduct(product)}
                      className="p-3 rounded-xl bg-white dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#27272E] hover:border-[#FF6B00] flex items-center justify-between gap-3 cursor-pointer group transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-lg bg-[#FAF9F7] dark:bg-[#1C1C22] border border-[#E6E2D8] dark:border-[#27272E] p-1 shrink-0 flex items-center justify-center overflow-hidden">
                          <img
                            src={product.images[0] || '/assets/images/niapolor-badge.webp'}
                            alt={prodName}
                            referrerPolicy="no-referrer"
                            onError={handleStoreImageError}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs sm:text-sm font-bold text-[#111113] dark:text-[#F7F6F3] truncate group-hover:text-[#FF6B00] transition-colors">
                            {prodName}
                          </h4>
                          <span className="text-[10px] text-[#6B665F] dark:text-[#A19E97] block truncate">{product.companyName}</span>
                          <div className="flex items-center gap-1 text-[10px] text-[#C8A25A] mt-0.5">
                            <Star className="w-3 h-3 fill-[#FF6B00] text-[#FF6B00]" />
                            <span className="font-bold text-[#111113] dark:text-[#F7F6F3]">{product.rating || '4.9'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-end shrink-0">
                        <span className="text-xs sm:text-sm font-black text-[#FF6B00] tabular-nums font-mono block">
                          {product.price.toFixed(3)}
                        </span>
                        <span className="text-[9px] text-[#6B665F] dark:text-[#A19E97] font-bold">{t.cart.currency}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {localSearchInput.trim() && searchResults.length === 0 && (
              <div className="py-12 text-center text-[#6B665F] dark:text-[#A19E97] space-y-2">
                <Search className="w-10 h-10 text-[#C8C3B9] dark:text-[#3A3A44] mx-auto" />
                <h4 className="text-sm font-bold text-[#111113] dark:text-[#F7F6F3]">{t.bottomNav?.noMatches || 'لا توجد نتائج مطابقة لبحثك'}</h4>
                <p className="text-xs">{t.bottomNav?.noMatchesTip || 'جرب كلمات بحث مختلفة أو تصفح الأقسام'}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. نافذة الأقسام المنبثقة من الأسفل */}
      {isCategoriesSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full sm:max-w-md bg-white dark:bg-[#121216] rounded-t-3xl sm:rounded-2xl border border-[#E6E2D8] dark:border-[#27272E] shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto animate-slideUp text-[#111113] dark:text-[#F7F6F3]">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[#E6E2D8] dark:border-[#27272E]">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-[#FF6B00]/12 flex items-center justify-center text-[#FF6B00]">
                  <LayoutGrid className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-[#111113] dark:text-[#F7F6F3] leading-tight">
                    {t.bottomNav?.categoriesSheetTitle || 'تصفح أقسام NIAPOLOR'}
                  </h3>
                  <p className="text-[10px] text-[#6B665F] dark:text-[#A19E97]">
                    {t.bottomNav?.categoriesSheetSubtitle || 'اختر القسم لفلترة المنتجات فوراً'}
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setIsCategoriesSheetOpen(false)}
                className="p-2 rounded-xl bg-[#FAF9F7] dark:bg-[#1C1C22] text-[#6B665F] dark:text-[#A19E97] hover:text-[#111113] dark:hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Categories List */}
            <div className="space-y-2">
              {categories.map((cat) => {
                const count = cat.id === 'all' 
                  ? products.length 
                  : products.filter(p => p.category === cat.id).length;
                const isSelected = selectedCategory === cat.id;

                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleSelectCategory(cat.id)}
                    className={`w-full p-3 rounded-xl border transition-all flex items-center justify-between text-start cursor-pointer active:scale-98 ${
                      isSelected
                        ? 'bg-[#FF6B00]/10 border-[#FF6B00] text-[#111113] dark:text-white'
                        : 'bg-[#FAF9F7] dark:bg-[#18181D] border-[#E6E2D8] dark:border-[#27272E] hover:border-[#FF6B00]/50 text-[#111113] dark:text-[#F7F6F3]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg w-8 h-8 rounded-lg bg-white dark:bg-[#121216] flex items-center justify-center border border-[#E6E2D8] dark:border-[#27272E]">
                        {cat.icon}
                      </span>
                      <div>
                        <span className="text-xs font-black block leading-tight">
                          {(t.categories as Record<string, string>)[cat.id] || cat.label}
                        </span>
                        <span className="text-[10px] text-[#6B665F] dark:text-[#A19E97] block leading-tight">{cat.desc}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white dark:bg-[#121216] border border-[#E6E2D8] dark:border-[#27272E] text-[#5A5854] dark:text-[#A19E97]">
                        {count} {t.bottomNav?.itemsCountSuffix || (language === 'ar' ? 'منتج' : language === 'fr' ? 'articles' : 'products')}
                      </span>
                      <ChevronLeft className={`w-4 h-4 text-[#8A857C] ${language !== 'ar' ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                );
              })}
            </div>

          </div>
          <div className="fixed inset-0 -z-10 cursor-pointer" onClick={() => setIsCategoriesSheetOpen(false)}></div>
        </div>
      )}

      {/* 3. شريط التنقل السفلي الذكي (إخفاء تلقائي سلس عند التمرير للأسفل وإظهار عند الصعود، مع الحفاظ التام على العناصر والأيقونات والترتيب والوظائف) */}
      <nav 
        className={`fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#0B0B0D]/95 backdrop-blur-md border-t border-[#E6E2D8] dark:border-[#222228] shadow-[0_-8px_28px_rgba(0,0,0,0.08)] dark:shadow-[0_-8px_28px_rgba(0,0,0,0.45)] px-2 py-1.5 transition-transform duration-300 ease-out will-change-transform select-none ${
          isNavVisible || isSearchModalOpen || isCategoriesSheetOpen
            ? 'translate-y-0'
            : 'translate-y-[115%] pointer-events-none'
        }`}
        aria-label="التنقل السفلي"
      >
        <div className="max-w-md mx-auto grid grid-cols-4 gap-1">
          
          {/* Tab 1: الرئيسية (Home) */}
          <button
            type="button"
            onClick={() => handleTabClick('home')}
            className="flex flex-col items-center justify-center py-1 min-h-[44px] group cursor-pointer active:scale-95"
          >
            <div 
              className={`px-4 py-1 rounded-xl transition-all flex items-center justify-center ${
                isHomeActive 
                  ? 'bg-[#FF6B00]/14 text-[#FF6B00]' 
                  : 'text-[#6B665F] dark:text-[#9A958E] group-hover:text-[#111113] dark:group-hover:text-white'
              }`}
            >
              <Home className={`w-5 h-5 ${isHomeActive ? 'stroke-[2.4]' : 'stroke-[1.75]'}`} />
            </div>
            <span className={`text-[10px] mt-0.5 font-bold ${isHomeActive ? 'text-[#FF6B00]' : 'text-[#6B665F] dark:text-[#9A958E]'}`}>
              {t.bottomNav?.home || t.nav.store}
            </span>
          </button>

          {/* Tab 2: الأقسام (Categories) */}
          <button
            type="button"
            onClick={() => handleTabClick('categories')}
            className="flex flex-col items-center justify-center py-1 min-h-[44px] group cursor-pointer active:scale-95"
          >
            <div 
              className={`px-4 py-1 rounded-xl transition-all flex items-center justify-center ${
                isCategoriesActive 
                  ? 'bg-[#FF6B00]/14 text-[#FF6B00]' 
                  : 'text-[#6B665F] dark:text-[#9A958E] group-hover:text-[#111113] dark:group-hover:text-white'
              }`}
            >
              <LayoutGrid className={`w-5 h-5 ${isCategoriesActive ? 'stroke-[2.4]' : 'stroke-[1.75]'}`} />
            </div>
            <span className={`text-[10px] mt-0.5 font-bold ${isCategoriesActive ? 'text-[#FF6B00]' : 'text-[#6B665F] dark:text-[#9A958E]'}`}>
              {t.bottomNav?.categories || t.nav.categories}
            </span>
          </button>

          {/* Tab 3: البحث (Search) - يفتح البحث المخصص */}
          <button
            type="button"
            onClick={() => handleTabClick('search')}
            className="flex flex-col items-center justify-center py-1 min-h-[44px] group cursor-pointer active:scale-95"
          >
            <div 
              className={`px-4 py-1 rounded-xl transition-all flex items-center justify-center ${
                isSearchActive 
                  ? 'bg-[#FF6B00]/14 text-[#FF6B00]' 
                  : 'text-[#6B665F] dark:text-[#9A958E] group-hover:text-[#111113] dark:group-hover:text-white'
              }`}
            >
              <Search className={`w-5 h-5 ${isSearchActive ? 'stroke-[2.4]' : 'stroke-[1.75]'}`} />
            </div>
            <span className={`text-[10px] mt-0.5 font-bold ${isSearchActive ? 'text-[#FF6B00]' : 'text-[#6B665F] dark:text-[#9A958E]'}`}>
              {t.bottomNav?.search || t.nav.search}
            </span>
          </button>

          {/* Tab 4: السلة (Cart) */}
          <button
            type="button"
            onClick={() => handleTabClick('cart')}
            className="flex flex-col items-center justify-center py-1 min-h-[44px] group cursor-pointer active:scale-95 relative"
          >
            <div className="px-4 py-1 rounded-xl text-[#6B665F] dark:text-[#9A958E] group-hover:text-[#111113] dark:group-hover:text-white transition-all flex items-center justify-center relative">
              <ShoppingBag className="w-5 h-5 stroke-[1.75]" />
              {totalCartItems > 0 && (
                <span className="absolute -top-0.5 right-2.5 bg-[#FF6B00] text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-xs">
                  {totalCartItems}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-0.5 font-bold text-[#6B665F] dark:text-[#9A958E]">
              {t.bottomNav?.cart || t.nav.cart}
            </span>
          </button>

        </div>
      </nav>
    </>
  );
};
