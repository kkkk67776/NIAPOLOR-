import type {
  FinancialActivityLog,
  Order,
  OrderStatus,
  PaymentMethodType,
  PaymentStatus,
  PaymentSystemPublicConfig,
  PaymentTransaction,
  PosteCcpTransferDetails,
  RefundRequest,
  SupportTransaction,
  TransferProof,
  VendorLedgerEntry,
  VendorSubOrder,
} from '../types';
import { getAdminAuthHeaders, notifySessionExpired } from './security';

export interface AdminPaymentOverviewResponse {
  config: PaymentSystemPublicConfig;
  orders: Order[];
  transactions: PaymentTransaction[];
  vendorLedgers: VendorLedgerEntry[];
  vendorSummaries: Array<{
    vendorId: string;
    vendorName: string;
    grossTotal: number;
    commissionTotal: number;
    netPending: number;
    netEligible: number;
    netSettled: number;
    entriesCount: number;
  }>;
  refundRequests: RefundRequest[];
  supportTransactions: SupportTransaction[];
  supportTotalPaid: number;
  activityLogs: FinancialActivityLog[];
}

export interface ScopedVendorFinancialsResponse {
  vendorId: string;
  currency: string;
  grossTotal: number;
  commissionTotal: number;
  netPending: number;
  netEligible: number;
  netSettled: number;
  subOrders: Array<
    VendorSubOrder & {
      orderPaymentStatus: PaymentStatus;
      orderTrackingStatus: OrderStatus;
      paymentMethod: PaymentMethodType;
    }
  >;
  ledgerEntries: VendorLedgerEntry[];
}

export const DEFAULT_PUBLIC_PAYMENT_CONFIG: PaymentSystemPublicConfig = {
  currency: 'TND',
  commissionRatePercent: 10,
  taxRatePercent: 0,
  standardShippingFee: 7,
  freeShippingThreshold: 150,
  methods: {
    cod: { enabled: true },
    bank_transfer: {
      enabled: false,
      accountHolder: '',
      bankName: '',
      ibanOrRib: '',
      swiftCode: '',
      instructions: {
        ar: '',
        fr: '',
        en: '',
      },
    },
    poste_ccp: {
      enabled: true,
      instructions: {
        ar: '',
        fr: '',
        en: '',
      },
    },
    online_payment: {
      enabled: false,
      provider: 'konnect',
      mode: 'sandbox',
      hasApiKey: false,
      hasWalletId: false,
      hasWebhookSecret: false,
      readyForLive: false,
    },
  },
  updatedAt: new Date().toISOString(),
};

export function canOrderShipClient(order: Pick<Order, 'paymentMethod' | 'paymentStatus'>): boolean {
  if (order.paymentMethod === 'cod') return true;
  return order.paymentStatus === 'Paid' || order.paymentStatus === 'paid';
}

export async function readReceiptFileAsDataUrl(file: File): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    return {
      ok: false,
      error: 'يرجى اختيار صورة وصل بصيغة JPEG أو PNG أو WebP فقط.',
    };
  }
  if (file.size > 3.5 * 1024 * 1024) {
    return {
      ok: false,
      error: 'حجم صورة الوصل كبير جداً (الحد الأقصى 3.5 ميغابايت).',
    };
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        resolve({ ok: true, dataUrl: reader.result });
      } else {
        resolve({ ok: false, error: 'تعذر قراءة ملف الصورة المحدد.' });
      }
    };
    reader.onerror = () => resolve({ ok: false, error: 'فشلت قراءة صورة الوصل.' });
    reader.readAsDataURL(file);
  });
}

export function getPaymentStatusTone(status: PaymentStatus): string {
  switch (status) {
    case 'Paid':
    case 'paid':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
    case 'Cash on Delivery':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30';
    case 'Awaiting Bank Transfer':
    case 'Pending Payment':
    case 'pending':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30';
    case 'Payment Verification':
      return 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30';
    case 'Refunded':
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30';
    case 'Cancelled':
      return 'bg-[#EBE7DF] dark:bg-[#23232A] text-[#5A5854] dark:text-[#B5B0A8] border-[#D6D0C4] dark:border-[#32323C]';
    case 'Payment Failed':
    case 'failed':
      return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30';
    default:
      return 'bg-[#F3F1EC] dark:bg-[#18181D] text-[#5A5854] dark:text-[#B5B0A8] border-[#E6E2D8] dark:border-[#23232A]';
  }
}

export async function fetchPublicPaymentConfig(): Promise<PaymentSystemPublicConfig> {
  const res = await fetch('/api/payments/config', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load payment config');
  return res.json();
}

export async function fetchPosteCcpTransferDetails(): Promise<{
  ok: boolean;
  details?: PosteCcpTransferDetails;
  error?: string;
}> {
  const res = await fetch('/api/payments/poste-ccp/details', { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'تعذر تحميل بيانات التحويل البريدي.' };
  }
  return {
    ok: true,
    details: {
      enabled: Boolean(data.enabled),
      accountHolder: data.accountHolder || '',
      bankName: data.bankName || '',
      ibanOrRib: data.ibanOrRib || '',
      swiftCode: data.swiftCode,
      instructions: data.instructions || { ar: '', fr: '', en: '' },
      manualVerificationNotice: data.manualVerificationNotice || '',
    },
  };
}

export async function trackOrderServer(code: string, phone?: string): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const qs = phone && phone.trim() ? `?phone=${encodeURIComponent(phone.trim())}` : '';
  const res = await fetch(`/api/payments/track/${encodeURIComponent(code)}${qs}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Order not found' };
  }
  return { ok: true, order: data.order };
}

export async function submitServerCheckout(payload: {
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  shippingAddress: Order['shippingAddress'];
  items: Array<{
    productId: string;
    productName: { ar: string; fr: string; en: string };
    productImage?: string;
    unitPrice: number;
    quantity: number;
    companyId?: string;
    companyName?: string;
  }>;
  couponCode?: string;
  paymentMethod: PaymentMethodType;
  clientExpectedTotal?: number;
  carrierName?: string;
  notes?: string;
  transferProof?: Partial<TransferProof>;
  clientRequestId?: string;
}): Promise<{
  ok: boolean;
  order?: Order;
  transaction?: PaymentTransaction;
  paymentUrl?: string;
  transferDetails?: PosteCcpTransferDetails;
  error?: string;
}> {
  const res = await fetch('/api/payments/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Checkout validation failed' };
  }
  return {
    ok: true,
    order: data.order,
    transaction: data.transaction,
    paymentUrl: data.paymentUrl,
    transferDetails: data.transferDetails,
  };
}

export async function verifyGatewayReturnClient(params: {
  tracking?: string;
  paymentRef?: string;
  provider?: string;
}): Promise<{
  ok: boolean;
  kind?: 'order' | 'support';
  paymentStatus?: PaymentStatus;
  order?: Order;
  supportTransaction?: SupportTransaction;
  error?: string;
}> {
  const qs = new URLSearchParams();
  if (params.tracking) qs.set('tracking', params.tracking);
  if (params.paymentRef) qs.set('payment_ref', params.paymentRef);
  if (params.provider) qs.set('provider', params.provider);
  const res = await fetch(`/api/payments/verify-return?${qs.toString()}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Return verification failed' };
  }
  return {
    ok: true,
    kind: data.kind,
    paymentStatus: data.paymentStatus,
    order: data.order,
    supportTransaction: data.supportTransaction,
  };
}

export async function submitBankTransferProofClient(payload: {
  trackingNumber: string;
  customerPhone?: string;
  referenceNumber: string;
  senderName: string;
  transferDate?: string;
  receiptImageDataUrl?: string;
  notes?: string;
}): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const res = await fetch('/api/payments/bank-transfer/proof', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Failed submitting transfer proof' };
  }
  return { ok: true, order: data.order };
}

export async function submitPosteCcpProofClient(payload: {
  trackingNumber: string;
  customerPhone?: string;
  referenceNumber: string;
  senderName: string;
  transferDate?: string;
  receiptImageDataUrl?: string;
  notes?: string;
}): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const res = await fetch('/api/payments/poste-ccp/proof', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Failed submitting Poste / CCP transfer proof' };
  }
  return { ok: true, order: data.order };
}

export async function submitRefundOrCancelRequest(payload: {
  trackingNumber: string;
  customerPhone?: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/payments/request-refund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Request failed' };
  }
  return { ok: true };
}

export async function contributeToEchox(payload: {
  amount: number;
  method: PaymentMethodType;
  supporterName?: string;
  supporterPhone?: string;
  supporterEmail?: string;
  note?: string;
  transferProof?: Partial<TransferProof>;
}): Promise<{ ok: boolean; supportTransaction?: SupportTransaction; paymentUrl?: string; error?: string }> {
  const res = await fetch('/api/support/contribute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Support contribution failed' };
  }
  return { ok: true, supportTransaction: data.supportTransaction, paymentUrl: data.paymentUrl };
}

export async function fetchScopedVendorFinancials(vendorId: string): Promise<ScopedVendorFinancialsResponse> {
  const res = await fetch(`/api/vendor/${encodeURIComponent(vendorId)}/financials`, {
    credentials: 'include',
    cache: 'no-store',
    headers: getAdminAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok) throw new Error(data.error || 'Failed loading vendor ledger');
  return data;
}

// ==========================================
// ADMIN PAYMENT MANAGEMENT API WRAPPERS
// ==========================================

export async function fetchAdminPaymentOverview(): Promise<AdminPaymentOverviewResponse> {
  const res = await fetch('/api/admin/payments/overview', {
    credentials: 'include',
    cache: 'no-store',
    headers: getAdminAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok) throw new Error(data.error || 'Unauthorized');
  return data;
}

export async function fetchAdminOrders(): Promise<Order[]> {
  const res = await fetch('/api/admin/orders', {
    credentials: 'include',
    cache: 'no-store',
    headers: getAdminAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok) throw new Error(data.error || 'Unauthorized');
  return Array.isArray(data.orders) ? data.orders : [];
}

export async function createAdminManualOrderServer(payload: Partial<Order>): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const res = await fetch('/api/admin/orders', {
    method: 'POST',
    headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Failed to save manual order' };
  }
  return { ok: true, order: data.order };
}

export async function deleteAdminOrderServer(
  orderId: string
): Promise<{ ok: boolean; error?: string; verified?: boolean; backupRetentionNote?: string }> {
  const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: getAdminAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Failed to delete order' };
  }
  return {
    ok: true,
    verified: Boolean(data.verified),
    backupRetentionNote: data.backupRetentionNote,
  };
}

export async function saveAdminPaymentConfig(payload: any): Promise<{ ok: boolean; config?: PaymentSystemPublicConfig; error?: string }> {
  const res = await fetch('/api/admin/payments/config', {
    method: 'PUT',
    headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Failed to save payment config' };
  }
  return { ok: true, config: data.config };
}

export async function testAdminOnlineGateway(): Promise<{ ok: boolean; message: string; checkedAt: string }> {
  const res = await fetch('/api/admin/payments/test-gateway', {
    method: 'POST',
    credentials: 'include',
    headers: getAdminAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok) {
    return {
      ok: false,
      message: data.error || data.message || 'تعذر فحص اتصال بوابة الدفع.',
      checkedAt: new Date().toISOString(),
    };
  }
  return {
    ok: Boolean(data.ok),
    message: data.message || '',
    checkedAt: data.checkedAt || new Date().toISOString(),
  };
}

export async function verifyAdminPaymentAction(payload: {
  orderId?: string;
  transactionId?: string;
  action: 'approve' | 'reject';
  reason?: string;
  confirmFundsReceived?: boolean;
  verificationNote?: string;
}): Promise<{ ok: boolean; order?: Order; transaction?: PaymentTransaction; error?: string }> {
  const res = await fetch('/api/admin/payments/verify', {
    method: 'POST',
    headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Verification failed' };
  }
  return { ok: true, order: data.order, transaction: data.transaction };
}

export async function processAdminRefundOrCancel(payload: {
  orderId: string;
  action: 'refund' | 'cancel' | 'reject_refund';
  reason?: string;
}): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const res = await fetch('/api/admin/payments/refund', {
    method: 'POST',
    headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Refund/cancellation failed' };
  }
  return { ok: true, order: data.order };
}

export async function settleAdminVendorPayout(vendorId: string, settlementNote?: string): Promise<{
  ok: boolean;
  settledCount?: number;
  settledTotal?: number;
  error?: string;
}> {
  const res = await fetch('/api/admin/payments/vendor-payout', {
    method: 'POST',
    headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify({ vendorId, settlementNote }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Payout settlement failed' };
  }
  return { ok: true, settledCount: data.settledCount, settledTotal: data.settledTotal };
}

export async function verifyAdminSupportTransaction(id: string, action: 'approve' | 'reject'): Promise<{
  ok: boolean;
  supportTransaction?: SupportTransaction;
  error?: string;
}> {
  const res = await fetch('/api/admin/support/verify', {
    method: 'POST',
    headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify({ id, action }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) notifySessionExpired();
  if (!res.ok || !data.success) {
    return { ok: false, error: data.error || 'Support verification failed' };
  }
  return { ok: true, supportTransaction: data.supportTransaction };
}

export async function syncAdminCatalogToPaymentEngine(
  products: Array<{ id: string; price: number; companyId?: string; companyName?: string; active?: boolean }>
): Promise<void> {
  try {
    await fetch('/api/admin/payments/catalog-sync', {
      method: 'POST',
      headers: getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({ products }),
    });
  } catch {
    // Silent sync attempt only when admin session active
  }
}
