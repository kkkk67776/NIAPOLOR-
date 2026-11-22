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
  const discountPercent = product.originalPrice && product.originalPrice > product.price
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

  return (
    <article className="group bg-white dark:bg-[#131317] rounded-2xl border border-[#E6E2D8] dark:border-[#23232C] hover:border-[#FF6B00]/65 flex flex-col justify-between transition-all duration-200 hover:shadow-[0_14px_34px_-12px_rgba(0,0,0,0.35)] dark:hover:shadow-[0_18px_40px_-14px_rgba(255,107,0,0.16)] overflow-hidden">
      <div>
        {/* Image-First Studio Presentation */}
        <div
          onClick={() => setSelectedProductId(product.id)}
          className="relative w-full aspect-[4/3] bg-[#F5F3EE] dark:bg-[#0D0D10] overflow-hidden cursor-pointer flex items-center justify-center p-4 sm:p-5 border-b border-[#ECE8DF] dark:border-[#1E1E26]"
        >
          <img
            src={product.images[0] || '/assets/images/niapolor-badge.webp'}
            alt={prodName}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={handleStoreImageError}
            onLoad={handleStoreImageLoad}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300 ease-out"
          />

          {/* Single Clean Corner Highlight (Discount OR Featured, never stacked) */}
          {discountPercent > 0 ? (
            <span
              className={`absolute top-2.5 ${language === 'ar' ? 'right-2.5' : 'left-2.5'} bg-[#FF6B00] text-white text-[10px] font-black tracking-wide px-2 py-0.5 rounded-md tabular-nums`}
            >
              -{discountPercent}%
            </span>
          ) : product.featured ? (
            <span
              className={`absolute top-2.5 ${language === 'ar' ? 'right-2.5' : 'left-2.5'} bg-[#111113]/85 dark:bg-white/10 backdrop-blur-xs text-white text-[9px] font-extrabold uppercase tracking-[0.14em] px-2 py-0.5 rounded-md`}
            >
              {language === 'ar' ? 'حصري' : language === 'fr' ? 'Exclusif' : 'Featured'}
            </span>
          ) : null}

          {/* Wishlist Heart Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleWishlist(product.id);
            }}
            aria-label="Toggle Wishlist"
            className={`absolute top-2.5 ${language === 'ar' ? 'left-2.5' : 'right-2.5'} w-8 h-8 rounded-full bg-white/95 dark:bg-[#18181E]/90 border border-[#E6E2D8] dark:border-[#2C2C36] flex items-center justify-center transition-all cursor-pointer ${
              isWishlisted ? 'text-red-500 border-red-500/40' : 'text-[#7A756D] dark:text-[#9A958E] hover:text-red-500'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${isWishlisted ? 'fill-red-500' : ''}`} />
          </button>
        </div>

        {/* Clean Unboxed Product Info */}
        <div className="p-3 sm:p-4 pb-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-[#7A756D] dark:text-[#8E8980] font-semibold truncate">
            <span className="text-[#FF6B00] truncate">{product.companyName}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{getGovernorateName(product.governorate, language)}</span>
          </div>

          <h3
            onClick={() => setSelectedProductId(product.id)}
            className="text-xs sm:text-sm font-bold text-[#111113] dark:text-[#F7F6F3] group-hover:text-[#FF6B00] transition-colors line-clamp-2 min-h-[2.2rem] sm:min-h-[2.5rem] leading-snug cursor-pointer"
            title={prodName}
          >
            {prodName}
          </h3>

          <div className="flex items-center justify-between pt-0.5 gap-2">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-sm sm:text-base font-black text-[#111113] dark:text-[#F7F6F3] tabular-nums">
                {product.price.toFixed(3)}
              </span>
              <span className="text-[10px] font-bold text-[#FF6B00]">
                {t.cart.currency}
              </span>
              {product.originalPrice && product.originalPrice > product.price && (
                <span className="text-[10px] sm:text-xs text-[#8A857C] dark:text-[#6E6A63] line-through tabular-nums">
                  {product.originalPrice.toFixed(3)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 text-[11px] shrink-0">
              <Star className="w-3 h-3 fill-[#FF6B00] text-[#FF6B00]" />
              <span className="font-bold text-[#111113] dark:text-[#F7F6F3] tabular-nums">{product.rating || '4.9'}</span>
              <span className="text-[10px] text-[#8A857C] dark:text-[#6E6A63] tabular-nums">
                ({product.reviewCount || 12})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Crisp Action Footer */}
      <div className="p-3 sm:p-4 pt-2 mt-auto">
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={product.stock <= 0}
          className={`w-full py-2.5 rounded-xl text-xs font-extrabold tracking-wide flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
            isAddedRecently
              ? 'bg-emerald-600 text-white'
              : 'bg-[#FF6B00] hover:bg-[#E05E00] text-white'
          }`}
        >
          {isAddedRecently ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>{t.product.addedToCart}</span>
            </>
          ) : (
            <>
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>{product.stock > 0 ? t.product.addToCart : t.product.outOfStock}</span>
            </>
          )}
        </button>
      </div>
    </article>
  );
};
