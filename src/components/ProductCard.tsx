import React from 'react';
import { Product } from '../types';
import { useStore } from '../context/StoreContext';
import { Heart, ShoppingBag, Star, Check } from 'lucide-react';
import { getGovernorateName } from '../data/governorates';
import { handleStoreImageError, handleStoreImageLoad } from '../lib/imageFallback';

interface ProductCardProps {
  product: Product;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const {
    language,
    t,
    setSelectedProductId,
    addToCart,
    wishlist,
    toggleWishlist,
  } = useStore();

  const [isAddedRecently, setIsAddedRecently] = React.useState(false);
  const isWishlisted = wishlist.includes(product.id);
  const discountPercent = product.originalPrice
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    addToCart(product, 1);
    setIsAddedRecently(true);
    setTimeout(() => setIsAddedRecently(false), 1200);
  };

  const prodName =
    product.name?.[language] ||
    (typeof (product as any).name === 'string' ? (product as any).name : product.name?.ar);

  const seasonHeaderLabel =
    discountPercent > 0
      ? `-${discountPercent}% ${t.storefront?.discountBadge || 'تخفيض'}`
      : product.featured
      ? language === 'ar'
        ? 'حصري'
        : 'EXCLUSIVE'
      : language === 'ar'
      ? 'تشكيلة جديدة'
      : 'NEW SEASON';

  return (
    <div className="group bg-white dark:bg-[#141418] rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] hover:border-[#FF6B00]/60 flex flex-col justify-between transition-all duration-200 hover:shadow-xl relative overflow-hidden">
      <div>
        {/* Subtle Luxury Season / Exclusivity Header Bar */}
        <div className="py-1.5 px-2.5 text-center border-b border-[#F0EDE6] dark:border-[#1E1E24] bg-[#FAF9F7] dark:bg-[#18181D]">
          <span
            className={`text-[9px] sm:text-[10px] font-extrabold uppercase tracking-[0.18em] ${
              discountPercent > 0 ? 'text-[#FF6B00]' : 'text-[#6B665F] dark:text-[#9A958E]'
            }`}
          >
            {seasonHeaderLabel}
          </span>
        </div>

        <div className="p-2.5 sm:p-3 pb-1">
          {/* Square Studio Product Frame */}
          <div
            onClick={() => setSelectedProductId(product.id)}
            className="relative w-full aspect-square bg-[#FAF9F7] dark:bg-[#0B0B0D] rounded-xl overflow-hidden cursor-pointer p-2.5 flex items-center justify-center border border-[#F0EDE6] dark:border-[#1E1E24]"
          >
            <img
              src={product.images[0] || '/assets/images/niapolor-badge.webp'}
              alt={prodName}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={handleStoreImageError}
              onLoad={handleStoreImageLoad}
              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            />

            {/* Wishlist Toggle */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleWishlist(product.id);
              }}
              aria-label="Toggle Wishlist"
              className={`absolute top-2 ${language === 'ar' ? 'left-2' : 'right-2'} w-7 h-7 rounded-full bg-white/95 dark:bg-[#141418]/90 border border-[#E6E2D8] dark:border-[#27272E] flex items-center justify-center transition-all shadow-xs cursor-pointer ${
                isWishlisted ? 'text-red-500' : 'text-[#8A857C] hover:text-red-500'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${isWishlisted ? 'fill-red-500' : ''}`} />
            </button>
          </div>

          {/* Product Meta & Pricing */}
          <div className="pt-2.5 px-0.5">
            <div className="flex items-center justify-between text-[10px] text-[#6B665F] dark:text-[#A19E97] font-semibold mb-1 gap-1">
              <span className="text-[#FF6B00] truncate">{product.companyName}</span>
              <span className="truncate text-[#8A857C] dark:text-[#6E6A63]">
                {getGovernorateName(product.governorate, language)}
              </span>
            </div>

            <h3
              onClick={() => setSelectedProductId(product.id)}
              className="text-xs sm:text-sm font-bold text-[#111113] dark:text-[#F7F6F3] group-hover:text-[#FF6B00] transition-colors line-clamp-2 min-h-[2rem] sm:min-h-[2.5rem] leading-snug cursor-pointer mb-1.5"
              title={prodName}
            >
              {prodName}
            </h3>

            <div className="flex items-center gap-1 text-[11px] text-[#6B665F] dark:text-[#A19E97] mb-2">
              <Star className="w-3 h-3 fill-[#FF6B00] text-[#FF6B00] shrink-0" />
              <span className="font-bold text-[#111113] dark:text-[#F7F6F3]">{product.rating || '4.9'}</span>
              <span className="text-[10px] text-[#8A857C]">({product.reviewCount || 12})</span>
            </div>

            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-sm sm:text-base font-black text-[#FF6B00] tabular-nums">
                {product.price.toFixed(3)}
              </span>
              <span className="text-[10px] sm:text-xs font-bold text-[#5A5854] dark:text-[#A9A49B]">
                {t.cart.currency}
              </span>
              {product.originalPrice && product.originalPrice > product.price && (
                <span className="text-[10px] sm:text-xs text-[#8A857C] line-through tabular-nums">
                  {product.originalPrice.toFixed(3)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full-width Fiery-Orange CTA */}
      <div className="p-2.5 sm:p-3 pt-2 mt-auto">
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={product.stock <= 0}
          className={`w-full py-2 sm:py-2.5 rounded-lg text-xs font-black uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
            isAddedRecently
              ? 'bg-emerald-600 text-white'
              : 'bg-[#FF6B00] hover:bg-[#E05E00] text-white'
          }`}
        >
          {isAddedRecently ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>{t.product.addedToCart || 'تمت الإضافة ✓'}</span>
            </>
          ) : (
            <>
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>{t.product.addToCart}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
