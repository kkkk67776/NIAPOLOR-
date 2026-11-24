export type AuthLang = 'ar' | 'fr' | 'en';

export function resolveCustomerLang(langHint?: unknown, acceptLanguage?: unknown): AuthLang {
  const candidates = [langHint, acceptLanguage]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.toLowerCase());

  for (const raw of candidates) {
    if (raw.startsWith('fr') || raw.includes('fr-') || raw.includes('fr,')) return 'fr';
    if (raw.startsWith('en') || raw.includes('en-') || raw.includes('en,')) return 'en';
    if (raw.startsWith('ar') || raw.includes('ar-') || raw.includes('ar,')) return 'ar';
  }
  return 'ar';
}

export type CustomerAuthMsgKey =
  | 'invalidFullName'
  | 'invalidEmail'
  | 'invalidPhone'
  | 'passwordRequired'
  | 'passwordTooShort'
  | 'passwordTooLong'
  | 'passwordWhitespaceOnly'
  | 'passwordTrivial'
  | 'passwordNeedsVariety'
  | 'passwordMismatch'
  | 'duplicateEmail'
  | 'duplicatePhone'
  | 'loginRequiredFields'
  | 'invalidCredentials'
  | 'accountNotFound'
  | 'loginRequiredGeneric'
  | 'loginRequiredAddresses'
  | 'loginRequiredOrders'
  | 'loginRequiredProfile'
  | 'loginRequiredWishlist'
  | 'addressNotFound'
  | 'invalidRecipientName'
  | 'invalidGovernorate'
  | 'invalidDelegation'
  | 'invalidStreet'
  | 'dbSaveFailed'
  | 'dbReadFailed'
  | 'rateLimitRegister'
  | 'rateLimitLogin'
  | 'rateLimitProfile'
  | 'forbiddenIdor'
  | 'csrfOriginDenied'
  | 'csrfHeaderMissing'
  | 'sessionSignFailed'
  | 'invalidWishlistPayload'
  | 'serviceWakingRetry'
  | 'networkTimeoutRetry';

const TRIVIAL_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '00000000',
  '11111111',
  '22222222',
  '87654321',
  'password',
  'password1',
  'password123',
  'qwertyui',
  'qwerty123',
  'azertyui',
  'azerty123',
  'abcdef12',
  'abc12345',
  'niapolor',
  'niapolor1',
  'tunisia1',
  'tunisie1',
]);

export function containsDangerousHtml(value: string): boolean {
  return /<[^>]*>|<script|<iframe|javascript:|onerror=|onload=/i.test(value);
}

export function isValidCustomerEmail(email: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email) && email.length <= 140;
}

export type PasswordValidationReason =
  | 'required'
  | 'tooShort'
  | 'tooLong'
  | 'whitespaceOnly'
  | 'trivial'
  | 'needsVariety'
  | 'mismatch';

export function validateCustomerPasswordStrength(
  password: string,
  confirmPassword?: unknown
): { valid: boolean; reason?: PasswordValidationReason } {
  const pwd = typeof password === 'string' ? password : '';
  if (!pwd) return { valid: false, reason: 'required' };
  if (pwd.trim().length === 0) return { valid: false, reason: 'whitespaceOnly' };
  if (pwd.length < 8) return { valid: false, reason: 'tooShort' };
  if (pwd.length > 128) return { valid: false, reason: 'tooLong' };

  const normalizedLower = pwd.trim().toLowerCase();
  if (TRIVIAL_PASSWORDS.has(normalizedLower) || /^(.)\1{7,}$/.test(pwd)) {
    return { valid: false, reason: 'trivial' };
  }

  const hasLetter = /[a-zA-Z\u0600-\u06FF]/.test(pwd);
  const hasDigit = /\d/.test(pwd);
  const hasSymbol = /[^a-zA-Z0-9\u0600-\u06FF\s]/.test(pwd);
  const classCount = Number(hasLetter) + Number(hasDigit) + Number(hasSymbol);
  if (classCount < 2) {
    return { valid: false, reason: 'needsVariety' };
  }

  if (confirmPassword !== undefined && typeof confirmPassword === 'string' && confirmPassword !== pwd) {
    return { valid: false, reason: 'mismatch' };
  }

  return { valid: true };
}

export function mapPasswordReasonToMsgKey(reason?: PasswordValidationReason): CustomerAuthMsgKey {
  switch (reason) {
    case 'required':
      return 'passwordRequired';
    case 'tooLong':
      return 'passwordTooLong';
    case 'whitespaceOnly':
      return 'passwordWhitespaceOnly';
    case 'trivial':
      return 'passwordTrivial';
    case 'needsVariety':
      return 'passwordNeedsVariety';
    case 'mismatch':
      return 'passwordMismatch';
    case 'tooShort':
    default:
      return 'passwordTooShort';
  }
}

export const CUSTOMER_AUTH_MESSAGES: Record<AuthLang, Record<CustomerAuthMsgKey, string>> = {
  ar: {
    invalidFullName: 'يرجى إدخال الاسم الكامل بشكل صحيح (3 أحرف على الأقل).',
    invalidEmail: 'يرجى إدخال بريد إلكتروني صالح.',
    invalidPhone: 'يرجى إدخال رقم هاتف تونسي صحيح (8 أرقام، مثل 21 000 000).',
    passwordRequired: 'يرجى إدخال كلمة المرور.',
    passwordTooShort: 'كلمة المرور يجب أن تتكون من 8 أحرف على الأقل.',
    passwordTooLong: 'كلمة المرور طويلة جداً (الحد الأقصى 128 حرفاً).',
    passwordWhitespaceOnly: 'كلمة المرور لا يمكن أن تحتوي على مسافات فقط.',
    passwordTrivial: 'كلمة المرور ضعيفة جداً وسهلة التخمين. اختر كلمة مرور أقوى.',
    passwordNeedsVariety: 'يجب أن تحتوي كلمة المرور على مزيج من الأحرف والأرقام أو الرموز.',
    passwordMismatch: 'كلمتا المرور غير متطابقتين.',
    duplicateEmail: 'هذا البريد الإلكتروني مسجل مسبقاً. يرجى تسجيل الدخول.',
    duplicatePhone: 'رقم الهاتف هذا مرتبط بحساب آخر مسبقاً. يرجى تسجيل الدخول أو استخدام رقم آخر.',
    loginRequiredFields: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.',
    invalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    accountNotFound: 'الحساب غير موجود.',
    loginRequiredGeneric: 'يرجى تسجيل الدخول للمتابعة.',
    loginRequiredAddresses: 'يرجى تسجيل الدخول لإدارة العناوين.',
    loginRequiredOrders: 'يرجى تسجيل الدخول لعرض طلباتك.',
    loginRequiredProfile: 'يرجى تسجيل الدخول لتحديث الملف الشخصي.',
    loginRequiredWishlist: 'يرجى تسجيل الدخول لحفظ قائمة المفضلة.',
    addressNotFound: 'العنوان غير موجود.',
    invalidRecipientName: 'اسم المستلم غير صالح.',
    invalidGovernorate: 'يرجى اختيار ولاية تونسية صالحة.',
    invalidDelegation: 'يرجى اختيار معتمدية مطابقة للولاية المختارة.',
    invalidStreet: 'يرجى إدخال عنوان تفصيلي صالح.',
    dbSaveFailed: 'تعذر حفظ البيانات في قاعدة البيانات حالياً. يرجى المحاولة لاحقاً.',
    dbReadFailed: 'تعذر قراءة بيانات الحسابات حالياً. يرجى المحاولة لاحقاً.',
    rateLimitRegister: 'تم تجاوز حد التسجيل المؤقت، يرجى الانتظار قليلاً ثم إعادة المحاولة.',
    rateLimitLogin: 'محاولات دخول متكررة، يرجى الانتظار قليلاً ثم إعادة المحاولة.',
    rateLimitProfile: 'طلبات متكررة لتحديث الحساب، يرجى الانتظار قليلاً.',
    forbiddenIdor: 'غير مصرح لك بالوصول إلى بيانات حساب آخر.',
    csrfOriginDenied: 'مصدر الطلب غير مسموح به.',
    csrfHeaderMissing: 'ترويسة الأمان الخاصة بالطلب مفقودة.',
    sessionSignFailed: 'تعذر تأمين جلسة الحساب حالياً بسبب تهيئة الخادم.',
    invalidWishlistPayload: 'صيغة قائمة المفضلة غير صالحة.',
    serviceWakingRetry: 'الخادم قيد الاستيقاظ الآن، يمكنك المحاولة مجدداً خلال لحظات.',
    networkTimeoutRetry: 'انتهت مهلة الاتصال بالخادم. معطياتك ما زالت محفوظة، يرجى إعادة المحاولة.',
  },
  fr: {
    invalidFullName: 'Veuillez saisir un nom complet valide (au moins 3 caractères).',
    invalidEmail: 'Veuillez saisir une adresse email valide.',
    invalidPhone: 'Veuillez saisir un numéro tunisien valide à 8 chiffres (ex. 21 000 000).',
    passwordRequired: 'Veuillez saisir un mot de passe.',
    passwordTooShort: 'Le mot de passe doit contenir au moins 8 caractères.',
    passwordTooLong: 'Le mot de passe est trop long (128 caractères maximum).',
    passwordWhitespaceOnly: 'Le mot de passe ne peut pas contenir uniquement des espaces.',
    passwordTrivial: 'Ce mot de passe est trop faible ou courant. Choisissez un mot de passe plus sûr.',
    passwordNeedsVariety: 'Le mot de passe doit combiner des lettres et des chiffres ou symboles.',
    passwordMismatch: 'Les mots de passe ne correspondent pas.',
    duplicateEmail: 'Cette adresse email est déjà utilisée. Veuillez vous connecter.',
    duplicatePhone: 'Ce numéro de téléphone est déjà associé à un autre compte.',
    loginRequiredFields: 'Veuillez saisir votre adresse email et votre mot de passe.',
    invalidCredentials: 'Adresse email ou mot de passe incorrect.',
    accountNotFound: 'Compte introuvable.',
    loginRequiredGeneric: 'Veuillez vous connecter pour continuer.',
    loginRequiredAddresses: 'Veuillez vous connecter pour gérer vos adresses.',
    loginRequiredOrders: 'Veuillez vous connecter pour consulter vos commandes.',
    loginRequiredProfile: 'Veuillez vous connecter pour modifier votre profil.',
    loginRequiredWishlist: 'Veuillez vous connecter pour enregistrer vos favoris.',
    addressNotFound: 'Adresse introuvable.',
    invalidRecipientName: 'Nom du destinataire invalide.',
    invalidGovernorate: 'Veuillez sélectionner un gouvernorat tunisien valide.',
    invalidDelegation: 'Veuillez sélectionner une délégation correspondant au gouvernorat choisi.',
    invalidStreet: 'Veuillez saisir une adresse détaillée valide.',
    dbSaveFailed: 'Impossible d’enregistrer vos données pour le moment. Veuillez réessayer.',
    dbReadFailed: 'Impossible de charger les comptes pour le moment. Veuillez réessayer.',
    rateLimitRegister: 'Trop de tentatives d’inscription. Veuillez patienter quelques instants.',
    rateLimitLogin: 'Trop de tentatives de connexion. Veuillez patienter avant de réessayer.',
    rateLimitProfile: 'Trop de requêtes de mise à jour. Veuillez patienter.',
    forbiddenIdor: 'Accès refusé aux données d’un autre compte.',
    csrfOriginDenied: 'Origine de la requête non autorisée.',
    csrfHeaderMissing: 'En-tête de sécurité client manquant.',
    sessionSignFailed: 'Impossible de sécuriser la session actuellement.',
    invalidWishlistPayload: 'Format de liste de favoris invalide.',
    serviceWakingRetry: 'Le serveur démarre, veuillez réessayer dans un instant.',
    networkTimeoutRetry: 'Délai de connexion dépassé. Vos informations sont conservées, veuillez réessayer.',
  },
  en: {
    invalidFullName: 'Please enter a valid full name (at least 3 characters).',
    invalidEmail: 'Please enter a valid email address.',
    invalidPhone: 'Please enter a valid 8-digit Tunisian phone number (e.g. 21 000 000).',
    passwordRequired: 'Please enter a password.',
    passwordTooShort: 'Password must be at least 8 characters long.',
    passwordTooLong: 'Password is too long (maximum 128 characters).',
    passwordWhitespaceOnly: 'Password cannot consist solely of spaces.',
    passwordTrivial: 'This password is too weak or common. Please choose a stronger password.',
    passwordNeedsVariety: 'Password must combine letters with digits or special characters.',
    passwordMismatch: 'Passwords do not match.',
    duplicateEmail: 'This email address is already registered. Please sign in.',
    duplicatePhone: 'This phone number is already linked to another account.',
    loginRequiredFields: 'Please enter both email and password.',
    invalidCredentials: 'Invalid email address or password.',
    accountNotFound: 'Account not found.',
    loginRequiredGeneric: 'Please sign in to continue.',
    loginRequiredAddresses: 'Please sign in to manage your delivery addresses.',
    loginRequiredOrders: 'Please sign in to view your orders.',
    loginRequiredProfile: 'Please sign in to update your profile.',
    loginRequiredWishlist: 'Please sign in to save your wishlist.',
    addressNotFound: 'Address not found.',
    invalidRecipientName: 'Recipient name is invalid.',
    invalidGovernorate: 'Please select a valid Tunisian governorate.',
    invalidDelegation: 'Please select a delegation matching the chosen governorate.',
    invalidStreet: 'Please enter a valid street address.',
    dbSaveFailed: 'Unable to save your data right now. Please try again shortly.',
    dbReadFailed: 'Unable to access account storage right now. Please try again shortly.',
    rateLimitRegister: 'Too many registration attempts. Please wait a moment and try again.',
    rateLimitLogin: 'Too many login attempts. Please wait before trying again.',
    rateLimitProfile: 'Too many profile update requests. Please wait a moment.',
    forbiddenIdor: 'Access to another customer account is not permitted.',
    csrfOriginDenied: 'Request origin is not allowed.',
    csrfHeaderMissing: 'Missing required customer security header.',
    sessionSignFailed: 'Unable to create a secure session due to server configuration.',
    invalidWishlistPayload: 'Invalid wishlist payload format.',
    serviceWakingRetry: 'The server is waking up. Please try again in a moment.',
    networkTimeoutRetry: 'Connection timed out. Your entered details are preserved—please retry.',
  },
};

export function getCustomerAuthMessage(lang: AuthLang, key: CustomerAuthMsgKey): string {
  return CUSTOMER_AUTH_MESSAGES[lang]?.[key] || CUSTOMER_AUTH_MESSAGES.ar[key];
}
