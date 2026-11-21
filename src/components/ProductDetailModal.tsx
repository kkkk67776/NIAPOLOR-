import React, { useState, useEffect } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  X, 
  Star, 
  ShoppingBag, 
  Truck, 
  ShieldCheck, 
  Building2, 
  MapPin, 
  Heart, 
  Share2, 
  CheckCircle,
  Plus,
  Minus,
  MessageSquare
} from 'lucide-react';
import { getGovernorateName } from '../data/governorates';
import { handleStoreImageError, handleStoreImageLoad } from '../lib/imageFallback';

export const ProductDetailModal: React.FC = () => {
  const { 
    selectedProductId, 
    setSelectedProductId, 
    products, 
    language, 
    t, 
    addToCart, 
    wishlist, 
    toggleWishlist, 
    addProductReview,
    setIsCartOpen,
    isOnline
  } = useStore();

  const product = products.find(p => p.id === selectedProductId);

  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [reviewAuthor, setReviewAuthor] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [showReviewSuccess, setShowReviewSuccess] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    setActiveImageIndex(0);
    setQuantity(1);
    setShareCopied(false);
  }, [selectedProductId]);

  if (!product) return null;

  const isWishlisted = wishlist.includes(product.id);
  const discountPercent = product.originalPrice 
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const relatedProducts = products
    .filter(p => p.id !== product.id && p.category === product.category)
    .slice(0, 3);

  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) return;
    if (!reviewAuthor.trim() || !reviewComment.trim()) return;

    addProductReview(product.id, {
      authorName: reviewAuthor.trim(),
      rating: reviewRating,
      comment: reviewComment.trim(),
      verifiedPurchase: true
    });

    setReviewAuthor('');
    setReviewComment('');
    setShowReviewSuccess(true);
    setTimeout(() => setShowReviewSuccess(false), 3000);
  };

  const handleBuyNow = () => {
    addToCart(product, quantity);
    setSelectedProductId(null);
    setIsCartOpen(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-fadeIn"
      onClick={() => setSelectedProductId(null)}
    >
      <div 
        className="bg-white dark:bg-[#0B0B0D] w-full max-w-5xl rounded-3xl shadow-2xl border border-[#E6E2D8] dark:border-[#23232A] overflow-hidden relative my-auto max-h-[92vh] flex flex-col text-[#111113] dark:text-[#F7F6F3]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={() => setSelectedProductId(null)}
          aria-label="Close modal"
          className="absolute top-4 left-4 sm:top-5 sm:left-5 z-20 w-10 h-10 rounded-full bg-white/95 dark:bg-[#141418]/95 hover:bg-white dark:hover:bg-[#1C1C22] border border-[#E6E2D8] dark:border-[#23232A] text-[#5A5854] dark:text-[#B5B0A8] hover:text-[#111113] dark:hover:text-[#F7F6F3] flex items-center justify-center shadow-md transition-all cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Scrollable Body */}
        <div className="overflow-y-auto p-5 sm:p-8 space-y-8">
          
          {/* Main 2-Column Product Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Column 1: Multi-Image Gallery (7 cols on desktop) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="relative aspect-4/3 rounded-2xl bg-[#FAF9F7] dark:bg-[#141418] overflow-hidden border border-[#E6E2D8] dark:border-[#23232A]">
                <img 
                  src={product.images[activeImageIndex] || product.images[0] || '/assets/images/niapolor-badge.webp'} 
                  alt={product.name[language]}
                  referrerPolicy="no-referrer"
                  onError={handleStoreImageError}
                  onLoad={handleStoreImageLoad}
                  className="w-full h-full object-cover object-center transition-all duration-300"
                />

                {discountPercent > 0 && (
                  <span className={`absolute top-4 ${language === 'ar' ? 'right-4' : 'left-4'} bg-[#FF6B00] text-white text-xs font-black px-3 py-1.5 rounded-lg shadow-sm`}>
                    -{discountPercent}% {t.product.discountOff}
                  </span>
                )}
              </div>

              {/* Thumbnails row */}
              {product.images.length > 1 && (
                <div className="flex items-center gap-3 overflow-x-auto pb-2">
                  {product.images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setActiveImageIndex(idx)}
                      className={`relative w-20 h-20 rounded-xl overflow-hidden border-2 transition-all shrink-0 ${
                        activeImageIndex === idx ? 'border-[#FF6B00] ring-2 ring-[#FF6B00]/20' : 'border-[#E6E2D8] dark:border-[#32323C] opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img 
                        src={img} 
                        alt="Thumbnail" 
                        referrerPolicy="no-referrer" 
                        onError={handleStoreImageError}
                        onLoad={handleStoreImageLoad}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* Trust Badges Strip */}
              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[#E6E2D8] dark:border-[#23232A] text-center">
                <div className="p-3 bg-[#F3F1EC] dark:bg-[#18181D] rounded-xl text-xs space-y-1 border border-[#E6E2D8] dark:border-[#23232A]">
                  <ShieldCheck className="w-5 h-5 text-[#FF6B00] mx-auto" />
                  <p className="font-bold text-[#111113] dark:text-[#F7F6F3]">ضمان أصلي 100%</p>
                  <p className="text-[#7A756D] dark:text-[#8E8980] text-[11px]">مرفق بشهادة المصنع</p>
                </div>
                <div className="p-3 bg-[#F3F1EC] dark:bg-[#18181D] rounded-xl text-xs space-y-1 border border-[#E6E2D8] dark:border-[#23232A]">
                  <Truck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mx-auto" />
                  <p className="font-bold text-[#111113] dark:text-[#F7F6F3]">توصيل 24 ولاية</p>
                  <p className="text-[#7A756D] dark:text-[#8E8980] text-[11px]">خلال 24-48 ساعة</p>
                </div>
                <div className="p-3 bg-[#F3F1EC] dark:bg-[#18181D] rounded-xl text-xs space-y-1 border border-[#E6E2D8] dark:border-[#23232A]">
                  <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mx-auto" />
                  <p className="font-bold text-[#111113] dark:text-[#F7F6F3]">معاينة قبل الدفع</p>
                  <p className="text-[#7A756D] dark:text-[#8E8980] text-[11px]">دفع عند الاستلام</p>
                </div>
              </div>
            </div>

            {/* Column 2: Product Purchase Module (5 cols on desktop) */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* Company & Governorate meta */}
              <div className="flex items-center gap-2 text-xs text-[#7A756D] dark:text-[#8E8980]">
                <span className="flex items-center gap-1 font-semibold text-[#FF6B00]">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>{product.companyName}</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{getGovernorateName(product.governorate, language)}</span>
                </span>
              </div>

              {/* Title */}
              <h1 className="text-xl sm:text-2xl font-black text-[#111113] dark:text-[#F7F6F3] leading-snug">
                {product.name[language]}
              </h1>

              {/* Ratings and Reviews count */}
              <div className="flex items-center gap-2 text-sm">
                <div className="flex items-center text-amber-500">
                  {[...Array(5)].map((_, i) => (
                    <Star 
                      key={i} 
                      className={`w-4 h-4 ${i < Math.floor(product.rating) ? 'fill-amber-500' : 'text-[#D6D0C4] dark:text-[#32323C]'}`} 
                    />
                  ))}
                </div>
                <span className="font-bold text-[#111113] dark:text-[#F7F6F3]">{product.rating}</span>
                <span className="text-[#7A756D] dark:text-[#8E8980]">({product.reviewCount} {t.product.reviewSingular})</span>
              </div>

              {/* Price Block */}
              <div className="p-4 rounded-2xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-black text-[#111113] dark:text-[#F7F6F3] tabular-nums">
                    {product.price.toFixed(3)}
                  </span>
                  <span className="text-sm font-bold text-[#5A5854] dark:text-[#B5B0A8]">{t.cart.currency}</span>
                  
                  {product.originalPrice && product.originalPrice > product.price && (
                    <span className="text-sm text-[#7A756D] dark:text-[#8E8980] line-through tabular-nums mr-2">
                      {product.originalPrice.toFixed(3)} {t.cart.currency}
                    </span>
                  )}
                </div>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                  {product.stock > 0 
                    ? `✓ ${t.product.inStock} (${product.stock} ${t.product.inStockCount || 'قطع متاحة للتسليم الفوري'})` 
                    : `✕ ${t.product.outOfStock}`}
                </p>
              </div>

              {/* Quantity Stepper & Actions */}
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8]">{t.product.quantity}</span>
                  <div className="flex items-center border border-[#D6D0C4] dark:border-[#32323C] rounded-xl overflow-hidden bg-white dark:bg-[#141418]">
                    <button
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="p-2 text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#1C1C22] transition-colors cursor-pointer"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="px-4 text-sm font-bold tabular-nums text-[#111113] dark:text-[#F7F6F3]">{quantity}</span>
                    <button
                      onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
                      className="p-2 text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#1C1C22] transition-colors cursor-pointer"
                      aria-label="Increase quantity"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Wishlist Button */}
                  <button
                    onClick={() => toggleWishlist(product.id)}
                    className="p-2.5 rounded-xl border border-[#E6E2D8] dark:border-[#32323C] text-[#5A5854] dark:text-[#B5B0A8] hover:text-red-500 transition-colors cursor-pointer"
                    aria-label="Wishlist"
                  >
                    <Heart className={`w-5 h-5 ${isWishlisted ? 'fill-red-500 text-red-500' : ''}`} />
                  </button>

                  {/* Share Clean SEO Product URL Button */}
                  <button
                    onClick={async () => {
                      const shareUrl = `${window.location.origin}/?product=${encodeURIComponent(product.id)}`;
                      try {
                        if (navigator.share) {
                          await navigator.share({ title: product.name[language], url: shareUrl });
                        } else if (navigator.clipboard) {
                          await navigator.clipboard.writeText(shareUrl);
                        }
                      } catch {
                        // User canceled or clipboard fallback
                      }
                      setShareCopied(true);
                      setTimeout(() => setShareCopied(false), 2000);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-[#E6E2D8] dark:border-[#32323C] text-[#5A5854] dark:text-[#B5B0A8] hover:text-[#FF6B00] hover:border-[#FF6B00] transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                    aria-label="Share product link"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>{shareCopied ? (language === 'ar' ? 'تم النسخ' : language === 'fr' ? 'Copié' : 'Copied') : (language === 'ar' ? 'مشاركة' : language === 'fr' ? 'Partager' : 'Share')}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={() => addToCart(product, quantity)}
                    disabled={product.stock <= 0}
                    className="py-3 px-4 rounded-xl bg-[#111113] dark:bg-[#18181D] hover:bg-[#23232A] dark:hover:bg-[#23232A] border border-transparent dark:border-[#32323C] text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer disabled:opacity-45"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    <span>{t.product.addToCart}</span>
                  </button>
                  <button
                    onClick={handleBuyNow}
                    disabled={product.stock <= 0}
                    className="py-3 px-4 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer disabled:opacity-45"
                  >
                    <span>{t.product.buyNow}</span>
                  </button>
                </div>
              </div>

              {/* Specs Table */}
              {product.specs && product.specs.length > 0 && (
                <div className="border border-[#E6E2D8] dark:border-[#23232A] rounded-2xl overflow-hidden text-xs">
                  <div className="bg-[#F3F1EC] dark:bg-[#18181D] px-4 py-2 font-bold text-[#111113] dark:text-[#F7F6F3]">
                    {t.product.specs}
                  </div>
                  <div className="divide-y divide-[#E6E2D8] dark:divide-[#23232A] bg-white dark:bg-[#141418]">
                    {product.specs.map((spec, i) => (
                      <div key={i} className="grid grid-cols-2 px-4 py-2.5">
                        <span className="text-[#7A756D] dark:text-[#8E8980] font-medium">{spec.key[language]}</span>
                        <span className="font-semibold text-[#111113] dark:text-[#F7F6F3]">{spec.value[language]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Description Section */}
          <div className="pt-6 border-t border-[#E6E2D8] dark:border-[#23232A] space-y-3">
            <h2 className="text-lg font-bold text-[#111113] dark:text-[#F7F6F3]">{t.product.description}</h2>
            <p className="text-sm sm:text-base text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed max-w-3xl">
              {product.description[language]}
            </p>
          </div>

          {/* Customer Reviews & Add Review Section */}
          <div className="pt-6 border-t border-[#E6E2D8] dark:border-[#23232A] space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#111113] dark:text-[#F7F6F3] flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#FF6B00]" />
                <span>{t.product.reviews}</span>
              </h2>
              <span className="text-xs text-[#7A756D] dark:text-[#8E8980]">
                {product.reviews.length} {t.product.reviewSingular}
              </span>
            </div>

            {/* Existing Reviews List */}
            <div className="space-y-3">
              {product.reviews.length === 0 ? (
                <p className="text-sm text-[#7A756D] dark:text-[#8E8980] py-3">{t.product.noReviewsYet}</p>
              ) : (
                product.reviews.map(rev => (
                  <div key={rev.id} className="p-4 rounded-xl bg-[#FAF9F7] dark:bg-[#18181D] border border-[#E6E2D8] dark:border-[#23232A] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#111113] dark:text-[#F7F6F3]">{rev.authorName}</span>
                        {rev.verifiedPurchase && (
                          <span className="text-[11px] bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded-full font-medium">
                            {t.product.verifiedPurchase}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center text-amber-500">
                        {[...Array(5)].map((_, i) => (
                          <Star 
                            key={i} 
                            className={`w-3.5 h-3.5 ${i < rev.rating ? 'fill-amber-500' : 'text-[#D6D0C4] dark:text-[#32323C]'}`} 
                          />
                        ))}
                      </div>
                    </div>
                    <p className="text-xs sm:text-sm text-[#5A5854] dark:text-[#B5B0A8]">{rev.comment}</p>
                    <span className="text-[11px] text-[#7A756D] dark:text-[#8E8980] block">{rev.date}</span>
                  </div>
                ))
              )}
            </div>

            {/* Add Review Form */}
            <div className="p-5 rounded-2xl bg-[#FAF9F7] dark:bg-[#141418] border border-[#E6E2D8] dark:border-[#23232A] space-y-4">
              <h3 className="text-sm font-bold text-[#111113] dark:text-[#F7F6F3]">{t.product.addReviewTitle}</h3>
              {showReviewSuccess && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-bold">
                  {t.product.reviewSubmitted}
                </div>
              )}
              <form onSubmit={handleReviewSubmit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">{t.product.yourName}</label>
                    <input 
                      type="text" 
                      required 
                      value={reviewAuthor} 
                      onChange={e => setReviewAuthor(e.target.value)} 
                      placeholder={t.product.namePlaceholder} 
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">{t.product.yourRating}</label>
                    <select 
                      value={reviewRating} 
                      onChange={e => setReviewRating(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]"
                    >
                      <option value="5">{t.product.rating5}</option>
                      <option value="4">{t.product.rating4}</option>
                      <option value="3">{t.product.rating3}</option>
                      <option value="2">{t.product.rating2}</option>
                      <option value="1">{t.product.rating1}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">{t.product.yourComment}</label>
                  <textarea 
                    required 
                    rows={2} 
                    value={reviewComment} 
                    onChange={e => setReviewComment(e.target.value)} 
                    placeholder={t.product.commentPlaceholder} 
                    className="w-full px-3 py-2 text-xs rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]" 
                  />
                </div>
                {!isOnline && (
                  <p className="text-[11px] font-bold text-[#FF6B00]">
                    {t.offline.serverActionDisabled}
                  </p>
                )}
                <button 
                  type="submit" 
                  disabled={!isOnline}
                  className="px-4 py-2 rounded-xl bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] dark:hover:bg-[#E05E00] text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {t.product.submitReview}
                </button>
              </form>
            </div>
          </div>

          {/* Related Products */}
          {relatedProducts.length > 0 && (
            <div className="pt-6 border-t border-[#E6E2D8] dark:border-[#23232A] space-y-4">
              <h2 className="text-base font-bold text-[#111113] dark:text-[#F7F6F3]">{t.product.relatedProducts}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {relatedProducts.map(rel => (
                  <div 
                    key={rel.id} 
                    onClick={() => {
                      setSelectedProductId(rel.id);
                      setActiveImageIndex(0);
                    }}
                    className="p-3 rounded-xl border border-[#E6E2D8] dark:border-[#23232A] hover:border-[#FF6B00] bg-[#FAF9F7] dark:bg-[#18181D] cursor-pointer transition-all flex items-center gap-3"
                  >
                    <img 
                      src={rel.images[0] || '/assets/images/niapolor-badge.webp'} 
                      alt={rel.name[language]} 
                      referrerPolicy="no-referrer"
                      onError={handleStoreImageError}
                      className="w-14 h-14 rounded-lg object-cover bg-white dark:bg-[#141418] shrink-0" 
                    />
                    <div className="overflow-hidden">
                      <p className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] truncate">{rel.name[language]}</p>
                      <p className="text-xs font-black text-[#FF6B00] tabular-nums">{rel.price.toFixed(3)} {t.cart.currency}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
