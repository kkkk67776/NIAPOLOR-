import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  User, 
  MapPin, 
  Package, 
  Heart, 
  Plus, 
  Check, 
  LogOut, 
  ShoppingBag, 
  Trash2, 
  Phone,
  Mail,
  Shield
} from 'lucide-react';
import { TUNISIAN_GOVERNORATES, getDelegationsForGovernorate, getGovernorateName } from '../data/governorates';
import { getPaymentStatusTone } from '../lib/payments';
import { handleStoreImageError, handleStoreImageLoad } from '../lib/imageFallback';

export const CustomerPortal: React.FC = () => {
  const { 
    currentUser, 
    loginCustomer, 
    logoutCustomer, 
    addCustomerAddress, 
    setDefaultAddress,
    orders, 
    products, 
    wishlist, 
    toggleWishlist, 
    addToCart, 
    setSelectedProductId, 
    setCurrentView,
    language, 
    t 
  } = useStore();

  const [authEmail, setAuthEmail] = useState('');
  const [authName, setAuthName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [activeTab, setActiveTab] = useState<'orders' | 'addresses' | 'wishlist'>('orders');

  // New Address Form state
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newGovernorate, setNewGovernorate] = useState('');
  const [newDelegation, setNewDelegation] = useState('');
  const [newStreet, setNewStreet] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim()) return;
    loginCustomer(authEmail.trim(), authName.trim() || 'حريف تونسي', authPhone.trim() || '+216 21 000 000');
  };

  const handleAddAddressSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullName.trim() || !newPhone.trim() || !newGovernorate || !newDelegation || !newStreet.trim()) return;

    addCustomerAddress({
      fullName: newFullName.trim(),
      phone: newPhone.trim(),
      governorate: newGovernorate,
      delegation: newDelegation,
      city: newDelegation,
      street: newStreet.trim(),
      notes: newNotes.trim() || undefined,
      isDefault: false
    });

    setShowAddAddress(false);
    setNewFullName('');
    setNewPhone('');
    setNewGovernorate('');
    setNewDelegation('');
    setNewStreet('');
    setNewNotes('');
  };

  // If customer is not logged in, show quick sign-in / registration
  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 animate-fadeIn">
        <div className="bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-lg p-6 sm:p-8 space-y-6 text-[#111113] dark:text-[#F7F6F3]">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-full bg-[#FF6B00]/10 text-[#FF6B00] flex items-center justify-center mx-auto">
              <User className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-black text-[#111113] dark:text-[#F7F6F3]">تسجيل الدخول / فتح حساب زبون</h1>
            <p className="text-xs text-[#7A756D] dark:text-[#8E8980]">
              تابع طلبياتك واحفظ عناوين التوصيل في الـ 24 ولاية تونسية وقائمة المفضلة
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">البريد الإلكتروني</label>
              <input
                type="email"
                required
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                placeholder="votre.email@gmail.com"
                className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">الاسم الكامل</label>
              <input
                type="text"
                required
                value={authName}
                onChange={e => setAuthName(e.target.value)}
                placeholder="الاسم واللقب"
                className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#5A5854] dark:text-[#B5B0A8] mb-1">رقم الهاتف التونسي</label>
              <input
                type="tel"
                required
                value={authPhone}
                onChange={e => setAuthPhone(e.target.value)}
                placeholder="+216 21 000 000"
                className="w-full text-xs py-2.5 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] focus:outline-hidden focus:border-[#FF6B00]"
                dir="ltr"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] dark:hover:bg-[#e05e00] text-white font-bold text-xs transition-colors shadow-sm cursor-pointer"
            >
              متابعة الدخول للمتجر
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Logged-in Customer Dashboard
  const customerOrders = orders.filter(o => o.customerPhone === currentUser.phone || o.customerName === currentUser.fullName || o.customerId === currentUser.id);
  const wishlistedProducts = products.filter(p => wishlist.includes(p.id));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 animate-fadeIn text-[#111113] dark:text-[#F7F6F3]">
      
      {/* Profile Banner */}
      <div className="bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] shadow-sm p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#111113] dark:bg-[#FF6B00] text-white flex items-center justify-center font-black text-xl shadow-xs">
            {currentUser.fullName.charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-black text-[#111113] dark:text-[#F7F6F3]">{currentUser.fullName}</h1>
            <div className="flex items-center flex-wrap gap-3 text-xs text-[#7A756D] dark:text-[#8E8980] mt-0.5">
              <span className="flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" />
                <span dir="ltr">{currentUser.email}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" />
                <span dir="ltr">{currentUser.phone}</span>
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={logoutCustomer}
          className="px-4 py-2 rounded-xl border border-[#E6E2D8] dark:border-[#32323C] hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 text-[#5A5854] dark:text-[#B5B0A8] text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>تسجيل الخروج</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E6E2D8] dark:border-[#23232A] pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'orders' ? 'bg-[#111113] dark:bg-[#FF6B00] text-white shadow-xs' : 'text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#18181D]'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>سجل الطلبات ({customerOrders.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('addresses')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'addresses' ? 'bg-[#111113] dark:bg-[#FF6B00] text-white shadow-xs' : 'text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#18181D]'
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span>العناوين التونسية ({currentUser.addresses.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('wishlist')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'wishlist' ? 'bg-[#111113] dark:bg-[#FF6B00] text-white shadow-xs' : 'text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#18181D]'
          }`}
        >
          <Heart className="w-4 h-4" />
          <span>المفضلة ({wishlistedProducts.length})</span>
        </button>
      </div>

      {/* Tab 1: Orders */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {customerOrders.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] text-[#7A756D] dark:text-[#8E8980]">
              لا توجد طلبات مسجلة بعد. تصفح المتجر واطلب الآن مع الدفع عند الاستلام!
            </div>
          ) : (
            customerOrders.map(order => (
              <div key={order.id} className="bg-white dark:bg-[#141418] rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] p-5 space-y-4 shadow-xs">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-[#E6E2D8] dark:border-[#23232A] pb-3">
                  <div>
                    <span className="text-xs text-[#7A756D] dark:text-[#8E8980] block">رقم التتبع:</span>
                    <span className="font-mono font-bold text-sm text-[#FF6B00]">{order.trackingNumber}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[11px] px-2.5 py-1 rounded-full font-bold border ${getPaymentStatusTone(order.paymentStatus)}`}>
                      {(t.payments.statuses as Record<string, string>)[order.paymentStatus] || order.paymentStatus}
                    </span>
                    <span className="text-xs bg-[#F3F1EC] dark:bg-[#18181D] px-3 py-1 rounded-full font-bold text-[#111113] dark:text-[#F7F6F3]">
                      {t.orderStatus[order.status] || order.status}
                    </span>
                    <button
                      onClick={() => setCurrentView('my_orders')}
                      className="text-xs text-[#FF6B00] hover:underline font-bold cursor-pointer"
                    >
                      تتبع مباشر
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-[#5A5854] dark:text-[#B5B0A8]">
                  <span>
                    {order.items.length} منتجات · {getGovernorateName(order.shippingAddress.governorate, language)}
                    {(order.shippingAddress.delegation || order.shippingAddress.city) &&
                      ` (${order.shippingAddress.delegation || order.shippingAddress.city})`}
                  </span>
                  <span className="text-sm font-black text-[#111113] dark:text-[#F7F6F3] tabular-nums">
                    {order.totalAmount.toFixed(3)} {t.cart.currency}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 2: Addresses */}
      {activeTab === 'addresses' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-bold text-[#111113] dark:text-[#F7F6F3]">عناوين التوصيل في ولايات تونس</h2>
            <button
              onClick={() => setShowAddAddress(!showAddAddress)}
              className="px-3.5 py-1.5 rounded-xl bg-[#FF6B00] text-white text-xs font-bold flex items-center gap-1 shadow-xs hover:bg-[#e05e00] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة عنوان جديد</span>
            </button>
          </div>

          {/* Add Address Form */}
          {showAddAddress && (
            <form onSubmit={handleAddAddressSubmit} className="bg-white dark:bg-[#141418] p-5 rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] space-y-3">
              <h3 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3]">بيانات العنوان الجديد</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="الاسم الكامل للمستلم"
                  value={newFullName}
                  onChange={e => setNewFullName(e.target.value)}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3]"
                />
                <input
                  type="tel"
                  required
                  placeholder="رقم الهاتف"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3]"
                  dir="ltr"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  required
                  value={newGovernorate}
                  onChange={e => {
                    setNewGovernorate(e.target.value);
                    setNewDelegation('');
                  }}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3]"
                >
                  <option value="">اختر الولاية...</option>
                  {TUNISIAN_GOVERNORATES.map(gov => (
                    <option key={gov.id} value={gov.id}>
                      {gov.nameAr}
                    </option>
                  ))}
                </select>
                <select
                  required
                  disabled={!newGovernorate}
                  value={newDelegation}
                  onChange={e => setNewDelegation(e.target.value)}
                  className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3] disabled:opacity-55"
                >
                  <option value="">{newGovernorate ? 'اختر المعتمدية...' : 'اختر الولاية أولاً'}</option>
                  {getDelegationsForGovernorate(newGovernorate).map(del => (
                    <option key={del} value={del}>
                      {del}
                    </option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                required
                placeholder="العنوان التفصيلي: الحي، الشارع، رقم المنزل أو أقرب علامة مميزة"
                value={newStreet}
                onChange={e => setNewStreet(e.target.value)}
                className="w-full text-xs py-2 px-3 rounded-xl border border-[#D6D0C4] dark:border-[#32323C] bg-white dark:bg-[#18181D] text-[#111113] dark:text-[#F7F6F3]"
              />

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddAddress(false)}
                  className="px-3 py-1.5 text-xs text-[#5A5854] dark:text-[#B5B0A8] hover:bg-[#F3F1EC] dark:hover:bg-[#18181D] rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] text-white text-xs font-bold rounded-xl cursor-pointer"
                >
                  حفظ العنوان
                </button>
              </div>
            </form>
          )}

          {/* Addresses Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {currentUser.addresses.map(addr => (
              <div 
                key={addr.id} 
                className={`p-4 rounded-2xl border-2 bg-white dark:bg-[#141418] space-y-2 transition-all ${
                  addr.isDefault ? 'border-[#FF6B00] shadow-xs' : 'border-[#E6E2D8] dark:border-[#23232A]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#111113] dark:text-[#F7F6F3]">{addr.fullName}</span>
                  {addr.isDefault ? (
                    <span className="text-[10px] bg-[#FF6B00]/10 text-[#FF6B00] font-black px-2 py-0.5 rounded-full">
                      العنوان الافتراضي ✓
                    </span>
                  ) : (
                    <button
                      onClick={() => setDefaultAddress(addr.id)}
                      className="text-[11px] text-[#7A756D] dark:text-[#8E8980] hover:text-[#FF6B00] cursor-pointer"
                    >
                      تعيين كافتراضي
                    </button>
                  )}
                </div>
                <p className="text-xs text-[#5A5854] dark:text-[#B5B0A8]">
                  {getGovernorateName(addr.governorate, language)} · {addr.delegation || addr.city || ''}
                  {addr.postalCode ? ` (${addr.postalCode})` : ''}
                </p>
                <p className="text-xs text-[#7A756D] dark:text-[#8E8980]">{addr.street}</p>
                <p className="text-xs font-mono text-[#5A5854] dark:text-[#B5B0A8]">{addr.phone}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Wishlist */}
      {activeTab === 'wishlist' && (
        <div className="space-y-4">
          {wishlistedProducts.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-[#141418] rounded-3xl border border-[#E6E2D8] dark:border-[#23232A] text-[#7A756D] dark:text-[#8E8980]">
              قائمة المفضلة فارغة حالياً. يمكنك النقر على أيقونة القلب لأي منتج لحفظه هنا!
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {wishlistedProducts.map(prod => (
                <div key={prod.id} className="bg-white dark:bg-[#141418] p-4 rounded-2xl border border-[#E6E2D8] dark:border-[#23232A] space-y-3 flex flex-col justify-between">
                  <div className="flex gap-3 cursor-pointer" onClick={() => setSelectedProductId(prod.id)}>
                    <img 
                      src={prod.images[0] || '/assets/images/niapolor-badge.webp'} 
                      alt={prod.name[language]} 
                      referrerPolicy="no-referrer"
                      onError={handleStoreImageError}
                      onLoad={handleStoreImageLoad}
                      className="w-16 h-16 rounded-xl object-cover bg-[#F3F1EC] dark:bg-[#18181D] shrink-0" 
                    />
                    <div className="overflow-hidden">
                      <h4 className="text-xs font-bold text-[#111113] dark:text-[#F7F6F3] truncate">{prod.name[language]}</h4>
                      <p className="text-xs font-black text-[#FF6B00] tabular-nums mt-1">{prod.price.toFixed(3)} {t.cart.currency}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-[#E6E2D8] dark:border-[#23232A]">
                    <button
                      onClick={() => addToCart(prod, 1)}
                      className="flex-1 py-2 bg-[#111113] dark:bg-[#FF6B00] hover:bg-[#FF6B00] dark:hover:bg-[#e05e00] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      <span>{t.product.addToCart}</span>
                    </button>
                    <button
                      onClick={() => toggleWishlist(prod.id)}
                      className="p-2 border border-[#E6E2D8] dark:border-[#32323C] hover:text-red-600 rounded-xl cursor-pointer"
                      title="إزالة من المفضلة"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
};
