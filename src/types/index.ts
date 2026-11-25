export type Language = 'ar' | 'fr' | 'en';

export type OrderStatus = 
  | 'new' 
  | 'under_confirmation' 
  | 'preparing' 
  | 'out_for_delivery' 
  | 'delivered' 
  | 'cancelled';

export interface MultilingualText {
  ar: string;
  fr: string;
  en: string;
}

export interface Review {
  id: string;
  authorName: string;
  rating: number; // 1-5
  comment: string;
  date: string;
  verifiedPurchase: boolean;
  customerId?: string;
}

export interface Product {
  id: string;
  sku?: string;
  name: MultilingualText;
  description: MultilingualText;
  category: string;
  price: number; // in TND (Tunisian Dinar)
  originalPrice?: number;
  stock: number;
  companyId: string;
  companyName: string;
  governorate: string; // Tunisian governorate of origin or dispatch
  images: string[];
  featured?: boolean;
  active: boolean;
  videoUrl?: string;
  deliveryTimeDays: number;
  freeDeliveryThreshold?: number;
  reviews: Review[];
  rating: number;
  reviewCount: number;
  specs?: { key: MultilingualText; value: MultilingualText }[];
}

export interface CompanyLegalMetadata {
  legalForm?: string;
  rneNumber?: string;
  taxId?: string;
  agreementAccepted?: boolean;
  agreementVersion?: string;
  agreementAcceptedAt?: string;
}

export interface Company {
  id: string;
  name: string;
  logo: string;
  phone: string;
  email: string;
  address: string;
  governorate: string;
  description: MultilingualText;
  website?: string;
  legalMetadata?: CompanyLegalMetadata;
}

export interface CustomerAddress {
  id: string;
  isDefault: boolean;
  fullName: string;
  phone: string;
  governorate: string; // One of the 24 Tunisian governorates
  delegation?: string; // Official Tunisian delegation belonging to the chosen governorate
  city?: string; // Legacy compatibility field (mirrored from delegation for new orders)
  postalCode?: string; // Optional legacy field (removed from buyer checkout UI)
  street: string; // Detailed address (neighborhood, street, house number or landmark)
  notes?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export type PaymentMethodType = 'cod' | 'bank_transfer' | 'poste_ccp' | 'online_payment' | 'konnect' | 'flouci';

export type PaymentStatus =
  | 'Pending Payment'
  | 'Awaiting Bank Transfer'
  | 'Payment Verification'
  | 'Paid'
  | 'Payment Failed'
  | 'Cancelled'
  | 'Refunded'
  | 'Cash on Delivery'
  | 'pending'
  | 'paid'
  | 'failed';

export interface TransferProof {
  referenceNumber: string;
  senderName: string;
  transferDate: string;
  receiptImageDataUrl?: string; // base64/data URL or URL
  notes?: string;
  submittedAt: string;
}

export interface PosteCcpTransferDetails {
  enabled: boolean;
  accountHolder: string;
  bankName: string;
  ibanOrRib: string;
  swiftCode?: string;
  instructions: MultilingualText;
  manualVerificationNotice: string;
}

export interface OrderItem {
  productId: string;
  sku?: string;
  productName: MultilingualText;
  productImage: string;
  companyId?: string;
  companyName?: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  discountApplied?: number;
}

export interface CouponRule {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  active: boolean;
  expiresAt?: string;
  minSubtotal?: number;
  maxDiscount?: number;
  description?: string;
}

export interface DelegationShippingOverride {
  enabled?: boolean;
  fee?: number | null;
  estimatedDelivery?: string;
}

export interface GovernorateShippingRule {
  governorateId: string;
  enabled: boolean;
  fee: number | null;
  useStandardFee?: boolean;
  estimatedDelivery: string;
  freeShippingThreshold?: number | null;
  delegationOverrides?: Record<string, DelegationShippingOverride>;
}

export interface InventoryAuditEntry {
  id: string;
  productId: string;
  sku?: string;
  productName?: string;
  delta: number;
  previousStock: number;
  newStock: number;
  reason: 'checkout_deduct' | 'order_cancel_restore' | 'order_refund_restore' | 'admin_adjustment' | 'catalog_sync';
  orderId?: string;
  trackingNumber?: string;
  actor: string;
  timestamp: string;
}

export interface VendorSubOrder {
  subOrderId: string;
  masterOrderId: string;
  trackingNumber: string;
  vendorId: string;
  vendorName: string;
  items: OrderItem[];
  grossAmount: number;
  commissionRate: number;
  commissionAmount: number;
  netVendorAmount: number;
  payoutStatus: 'pending' | 'eligible' | 'settled' | 'reversed';
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  trackingNumber: string; // e.g. ECH-TN-783921
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  shippingAddress: CustomerAddress;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  taxAmount?: number;
  shippingFee: number;
  totalAmount: number;
  platformCommissionTotal?: number;
  currency?: string;
  status: OrderStatus;
  paymentMethod: PaymentMethodType;
  paymentStatus: PaymentStatus;
  paymentReference?: string; // Unique reference per order e.g. ECH-CCP-XXXXXX / ECH-REF-XXXXXX
  transferProof?: TransferProof;
  transferDetails?: PosteCcpTransferDetails;
  subOrders?: VendorSubOrder[];
  transactionId?: string;
  refundReason?: string;
  cancelReason?: string;
  couponCode?: string;
  estimatedDelivery?: string;
  trackingToken?: string;
  trackingTokenHash?: string;
  stockDeducted?: boolean;
  stockRestored?: boolean;
  carrierName: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  piiMasked?: boolean;
  legalConsent?: LegalConsentRecord;
  statusHistory: {
    status: OrderStatus;
    timestamp: string;
    note?: string;
  }[];
}

export interface BankTransferPublicConfig {
  enabled: boolean;
  accountHolder: string;
  bankName: string;
  ibanOrRib: string;
  swiftCode?: string;
  instructions: MultilingualText;
  integrityVerified?: boolean;
  lockedByEnv?: boolean;
  tamperDetected?: boolean;
  ibanFingerprint?: string;
}

export interface PosteCcpPublicConfig {
  enabled: boolean;
  instructions: MultilingualText;
  integrityVerified?: boolean;
  tamperDetected?: boolean;
}

export interface OnlineGatewayPublicConfig {
  enabled: boolean;
  provider: 'konnect' | 'flouci' | 'stripe_custom';
  mode: 'sandbox' | 'live';
  hasApiKey: boolean;
  hasWalletId: boolean;
  hasWebhookSecret: boolean;
  apiKeyMasked?: string;
  walletIdMasked?: string;
  readyForLive: boolean;
  lastConnectionCheck?: {
    checkedAt: string;
    ok: boolean;
    message: string;
  };
  webhookPath?: string;
}

export interface PaymentSystemPublicConfig {
  currency: 'TND' | 'EUR' | 'USD';
  commissionRatePercent: number;
  taxRatePercent: number;
  standardShippingFee?: number | null;
  freeShippingThreshold?: number | null;
  shippingRules?: Record<string, GovernorateShippingRule>;
  coupons?: CouponRule[];
  methods: {
    cod: { enabled: boolean };
    bank_transfer: BankTransferPublicConfig;
    poste_ccp: PosteCcpPublicConfig;
    online_payment: OnlineGatewayPublicConfig;
  };
  updatedAt: string;
}

export interface PaymentTransaction {
  id: string;
  orderId: string;
  trackingNumber: string;
  paymentReference: string;
  customerName: string;
  customerPhone: string;
  method: 'cod' | 'bank_transfer' | 'poste_ccp' | 'online_payment';
  provider?: string;
  externalPaymentId?: string;
  amount: number;
  currency: string;
  taxAmount: number;
  commissionTotal: number;
  status: PaymentStatus;
  transferProof?: TransferProof;
  failureReason?: string;
  refundAmount?: number;
  refundReason?: string;
  verifiedByAdmin?: string;
  verifiedAt?: string;
  fundsVerifiedNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VendorLedgerEntry {
  id: string;
  vendorId: string;
  vendorName: string;
  orderId: string;
  subOrderId: string;
  trackingNumber: string;
  grossAmount: number;
  commissionAmount: number;
  netAmount: number;
  paymentStatus: PaymentStatus;
  payoutStatus: 'pending' | 'eligible' | 'settled' | 'reversed';
  settledAt?: string;
  settlementNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefundRequest {
  id: string;
  orderId: string;
  trackingNumber: string;
  transactionId?: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  reason: string;
  status: 'requested' | 'approved' | 'rejected' | 'processed';
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTransaction {
  id: string;
  supportReference: string;
  supporterName: string;
  supporterEmail?: string;
  supporterPhone?: string;
  note?: string;
  amount: number;
  currency: string;
  method: 'cod' | 'bank_transfer' | 'poste_ccp' | 'online_payment';
  provider?: string;
  externalPaymentId?: string;
  status: PaymentStatus;
  transferProof?: TransferProof;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialActivityLog {
  id: string;
  action: string;
  actor: 'system' | 'admin' | 'customer' | 'webhook' | 'vendor';
  targetId?: string;
  details: string;
  amount?: number;
  timestamp: string;
}

export interface LegalConsentRecord {
  termsAccepted: boolean;
  privacyAccepted: boolean;
  returnsAccepted?: boolean;
  partnerAgreementAccepted?: boolean;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
  language: Language;
  source:
    | 'customer_registration'
    | 'checkout_order'
    | 'seller_onboarding'
    | 'cookie_preferences'
    | 'privacy_request';
}

export interface LegalConsentAuditEntry {
  id: string;
  source:
    | 'customer_registration'
    | 'checkout_order'
    | 'seller_onboarding'
    | 'cookie_preferences'
    | 'privacy_request';
  actorType: 'customer' | 'guest' | 'admin' | 'visitor';
  actorId?: string;
  actorLabel?: string;
  trackingNumber?: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  returnsAccepted?: boolean;
  partnerAgreementAccepted?: boolean;
  cookieConsentChoice?: 'essential_only' | 'all_preferences';
  requestType?: 'rectification' | 'erasure' | 'opposition' | 'access_export';
  requestDetails?: string;
  requestStatus?: 'recorded' | 'reviewed' | 'completed';
  termsVersion: string;
  privacyVersion: string;
  language: Language;
  ipMasked?: string;
  acceptedAt: string;
}

export interface LegalProfileSettings {
  legalForm: string;
  rneNumber: string;
  taxId: string;
  shareCapital: string;
  publicationDirector: string;
  dpoEmail: string;
  dpoPhone: string;
  hostingProvider: string;
  hostingAddress: string;
  policyVersion: string;
  effectiveDate: string;
  retractionDays: number;
  mediationContact: string;
  customLegalNotice?: MultilingualText;
}

export interface CustomerUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  addresses: CustomerAddress[];
  wishlist: string[]; // Product IDs
  legalConsent?: LegalConsentRecord;
}

export interface ContactInquiry {
  id: string;
  senderName: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  createdAt: string;
  read: boolean;
  reply?: string;
  repliedAt?: string;
}

export interface ChatSuggestedProduct {
  id: string;
  name: string;
  price: number;
  image?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'customer' | 'owner';
  text: string;
  timestamp: string;
  source?: 'auto' | 'owner' | 'customer';
  suggestedProducts?: ChatSuggestedProduct[];
  actionView?: string;
}

export interface CustomChatRule {
  id: string;
  keyword: string;
  replyAr: string;
  replyFr: string;
  replyEn: string;
}

export interface SupportChatConfig {
  autoReplyEnabled: boolean;
  welcomeMessage: MultilingualText;
  fallbackMessage: MultilingualText;
  customRules: CustomChatRule[];
  updatedAt: string;
}

export interface SupportChatThread {
  sessionId: string;
  customerLabel: string;
  language: Language;
  messages: ChatMessage[];
  unreadByOwner: number;
  lastMessageAt: string;
  createdAt: string;
}

export interface OwnerSettings {
  ownerName: string;
  primaryPhone: string; // Locked for display: +21621511162
  secondaryPhone: string; // Editable for contact
  contactEmail: string;
  loginEmail: string; // Locked: abdelkaderbahri570@gmail.com
  photoUrl: string;
  bio: MultilingualText;
}

export interface SiteSettings {
  storeName: string;
  slogan: MultilingualText;
  description: MultilingualText;
  officialEmail: string;
  address: string;
  addressMultilingual?: MultilingualText;
  governorate: string;
  supportPhone: string;
  whatsappPhone: string; // e.g. 21621511162
  facebookUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  workingHours: MultilingualText;
  standardShippingFee: number; // e.g. 7.000 TND
  freeShippingThreshold: number; // e.g. 150.000 TND
  enableCOD: boolean;
  enableBankTransfer?: boolean;
  enableKonnect: boolean;
  enableFlouci: boolean;
  announcementText: MultilingualText;
  showAnnouncement: boolean;
  legalEntityName?: string;
  commercialRegisterId?: string;
  returnWindowDays?: number;
  deliveryTimeEstimate?: MultilingualText;
  legalProfile?: LegalProfileSettings;
}

export interface CategoryItem {
  id: string;
  label: string;
  icon?: string;
  desc?: string;
}

export interface PromoBanner {
  id: string;
  tag: string;
  title: string;
  subtitle: string;
  active: boolean;
  link?: string;
  bgGradient?: string;
}
