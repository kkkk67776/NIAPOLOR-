import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  X, 
  Trash2, 
  Plus, 
  Minus, 
  ShoppingBag, 
  ArrowLeft, 
  ArrowRight, 
  Tag, 
  CheckCircle2, 
  Truck,
  WifiOff
} from 'lucide-react';
import { handleStoreImageError } from '../lib/imageFallback';

interface CartDrawerProps {
  onOpenCheckout: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({ onOpenCheckout }) => {
  const { 
    isCartOpen, 
    setIsCartOpen, 
    cart, 
    removeFromCart, 
    updateCartQuantity, 
    language, 
    t, 
    cartSubtotal, 
    cartShippingFee, 
    cartDiscountAmount, 
    cartTaxAmount,
    cartTotal,
    couponCode,
    applyCoupon,
    siteSettings,
    paymentConfig,
    isOnline
  } = useStore();

  const [inputCoupon, setInputCoupon] = useState('');
  const [couponError, setCouponError] = useState(false);
  const [couponSuccess, setCouponSuccess] = useState(false);

  if (!isCartOpen) return null;

  const handleApplyCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCoupon.trim()) return;
    const success = applyCoupon(inputCoupon);
    if (success) {
      setCouponSuccess(true);
      setCouponError(false);
      setInputCoupon('');
    } else {
      setCouponError(true);
      setCouponSuccess(false);
    }
  };

  const freeDeliveryThreshold = siteSettings.freeShippingThreshold;
  const progressToFreeDelivery = Math.min(100, (cartSubtotal / freeDeliveryThreshold) * 100);
  const amountLeftForFreeDelivery = Math.max(0, freeDeliveryThreshold - cartSubtotal);

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/55 backdrop-blur-xs flex justify-end animate-fadeIn"
      onClick={() => setIsCartOpen(false)}
    >
      <div 
        className="w-full max-w-md bg-white dark:bg-[#0B0B0D] h-full shadow-2xl flex flex-col justify-between border-s border-[#E6E2D8] dark:border-[#23232C] animate-slideLeft text-[#111113] dark:text-[#F7F6F3]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#E6E2D8] dark:border-[#23232C] flex items-center justify-between bg-[#FAF9F7] dark:bg-[#131317]">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-[#FF6B00]" />
            <h2 className="text-base font-bold text-[#111113] dark:text-[#F7F6F3]">{t.cart.title}</h2>
            <span className="text-xs bg-[#FF6B00] text-white px-2 py-0.5 rounded-md font-bold">
              {cart.reduce((s, i) => s + i.quantity, 0)}
            </span>
          </div>
          <button
            onClick={() => setIsCartOpen(false)}
            className="p-2 text-[#7A756D] hover:text-[#111113] dark:text-[#8E8980] dark:hover:text-[#F7F6F3] rounded-full hover:bg-[#EBE7DF] dark:hover:bg-[#1D1D24] transition-colors cursor-pointer"
            aria-label="Close cart"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Free Delivery Meter */}
        <div className="p-3.5 bg-white dark:bg-[#0B0B0D] border-b border-[#E6E2D8] dark:border-[#23232C] space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-[#5A5854] dark:text-[#B5B0A8]">
            <span className="flex items-center gap-1">
              <Truck className="w-4 h-4 text-[#FF6B00]" />
              {amountLeftForFreeDelivery === 0 ? (
                <span className="text-emerald-700 dark:text-emerald-400 font-bold">{t.cart.freeShippingEligible}</span>
              ) : (
                <span>{t.cart.addForFreeShipping || 'أضف'} <strong className="text-[#FF6B00] tabular-nums">{amountLeftForFreeDelivery.toFixed(3)} {t.cart.currency}</strong> {t.cart.toGetFreeShipping || 'لتحصل على توصيل مجاني!'}</span>
              )}
            </span>
            <span className="text-[11px] text-[#7A756D] dark:text-[#8E8980] tabular-nums">{Math.round(progressToFreeDelivery)}%</span>
          </div>
          <div className="w-full h-2 bg-[#EBE7DF] dark:bg-[#18181E] rounded-full overflow-hidden">
            <div 
              className="h-full bg-[#FF6B00] transition-all duration-500 rounded-full"
              style={{ width: `${progressToFreeDelivery}%` }}
            />
          </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-4 divide-y divide-[#E6E2D8] dark:divide-[#23232C]">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
              <div className="w-16 h-16 rounded-full bg-[#F3F1EC] dark:bg-[#18181E] flex items-center justify-center text-[#7A756D] dark:text-[#8E8980]">
                <ShoppingBag className="w-8 h-8" />
              </div>
              <p className="text-sm font-bold text-[#5A5854] dark:text-[#B5B0A8]">{t.cart.empty}</p>
              <button
                onClick={() => setIsCartOpen(false)}
                className="text-xs font-bold text-[#FF6B00] hover:underline cursor-pointer"
              >
                {t.cart.startShopping}
              </button>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.product.id} className="py-3.5 flex items-center gap-3">
                <img 
                  src={item.product.images[0] || '/assets/images/niapolor-badge.webp'} 
                  alt={item.product.name[language]}
                  referrerPolicy="no-referrer"
                  onError={handleStoreImageError}
                  className="w-16 h-16 rounded-xl object-cover bg-[#FAF9F7] dark:bg-[#131317] border border-[#E6E2D8] dark:border-[#23232C] shrink-0"
                />
                
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] truncate">
                    {item.product.name[language]}
                  </h4>
                  <div className="text-xs text-[#7A756D] dark:text-[#8E8980] flex items-center gap-2 mt-0.5">
                    <span className="font-black text-[#111113] dark:text-[#F7F6F3] tabular-nums">
                      {item.product.price.toFixed(3)} {t.cart.currency}
                    </span>
                    <span className="text-[11px] text-[#7A756D] dark:text-[#8E8980]">× {item.quantity}</span>
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center border border-[#D6D0C4] dark:border-[#32323C] rounded-lg overflow-hidden bg-white dark:bg-[#131317]">
                      <button
                        onClick={() => updateCartQuantity(item.product.id, item.quantity - 1)}
                        className="p-1 text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#1D1D24] cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-2.5 text-xs font-bold tabular-nums text-[#111113] dark:text-[#F7F6F3]">{item.quantity}</span>
                      <button
                        onClick={() => updateCartQuantity(item.product.id, item.quantity + 1)}
                        className="p-1 text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#1D1D24] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="text-[#7A756D] hover:text-red-600 p-1 transition-colors cursor-pointer"
                      aria-label="Remove item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer with Totals and Checkout CTA */}
        {cart.length > 0 && (
          <div className="p-5 border-t border-[#E6E2D8] dark:border-[#23232C] bg-[#FAF9F7] dark:bg-[#131317] space-y-4">
            
            {/* Promo code form */}
            <form onSubmit={handleApplyCoupon} className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder={t.cart.couponPlaceholder || 'كود الخصم (جرب NIAPOLOR2026)'}
                  value={inputCoupon}
                  onChange={e => setInputCoupon(e.target.value)}
                  className="w-full text-xs py-2 px-3 pl-8 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#0B0B0D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]"
                />
                <Tag className="w-3.5 h-3.5 text-[#7A756D] dark:text-[#8E8980] absolute left-2.5 top-2.5" />
              </div>
              <button
                type="submit"
                className="px-3 py-2 bg-[#111113] dark:bg-[#23232C] hover:bg-[#FF6B00] dark:hover:bg-[#FF6B00] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                {t.cart.applyCoupon}
              </button>
            </form>
            {couponSuccess && (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t.cart.couponApplied}
              </p>
            )}
            {couponError && (
              <p className="text-[11px] text-red-600 dark:text-red-400 font-bold">
                {t.cart.invalidCoupon}
              </p>
            )}

            {/* Price Calculations */}
            <div className="space-y-1.5 text-xs text-[#5A5854] dark:text-[#B5B0A8] pt-2 border-t border-[#E6E2D8] dark:border-[#23232C]">
              <div className="flex justify-between">
                <span>{t.cart.subtotal}</span>
                <span className="font-bold text-[#111113] dark:text-[#F7F6F3] tabular-nums">{cartSubtotal.toFixed(3)} {t.cart.currency}</span>
              </div>
              {cartDiscountAmount > 0 && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-bold">
                  <span>{t.cart.discount}</span>
                  <span className="tabular-nums">-{cartDiscountAmount.toFixed(3)} {t.cart.currency}</span>
                </div>
              )}
              {cartTaxAmount > 0 && (
                <div className="flex justify-between">
                  <span>{t.payments.tax} ({paymentConfig.taxRatePercent}%)</span>
                  <span className="font-bold text-[#111113] dark:text-[#F7F6F3] tabular-nums">{cartTaxAmount.toFixed(3)} {t.cart.currency}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>{t.cart.shipping}</span>
                <span className="font-bold tabular-nums">
                  {cartShippingFee === 0 ? (
                    <span className="text-emerald-700 dark:text-emerald-400">{t.cart.freeShipping}</span>
                  ) : (
                    `${cartShippingFee.toFixed(3)} ${t.cart.currency}`
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm font-black text-[#111113] dark:text-[#F7F6F3] pt-2 border-t border-[#E6E2D8] dark:border-[#23232C]">
                <span>{t.cart.total}</span>
                <span className="text-[#FF6B00] text-base tabular-nums">{cartTotal.toFixed(3)} {t.cart.currency}</span>
              </div>
            </div>

            {/* Offline checkout guard */}
            {!isOnline && (
              <div className="p-3 rounded-xl bg-[#FF6B00]/10 border border-[#FF6B00]/25 text-xs space-y-1">
                <p className="font-black text-[#FF6B00] flex items-center gap-1.5">
                  <WifiOff className="w-3.5 h-3.5 shrink-0" />
                  <span>{t.offline.checkoutBlockedTitle}</span>
                </p>
                <p className="text-[11px] text-[#5A5854] dark:text-[#B5B0A8] leading-relaxed">
                  {t.offline.checkoutBlockedDesc}
                </p>
              </div>
            )}

            {/* Checkout Action Button */}
            <button
              type="button"
              disabled={!isOnline}
              onClick={() => {
                if (!isOnline) return;
                setIsCartOpen(false);
                onOpenCheckout();
              }}
              className="w-full py-3.5 px-4 rounded-xl bg-[#FF6B00] hover:bg-[#e05e00] disabled:opacity-45 disabled:cursor-not-allowed text-white font-bold text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
            >
              <span>{t.cart.proceedToCheckout}</span>
              {language === 'ar' ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
