import { Language, LegalProfileSettings, SiteSettings } from '../types';

export const CURRENT_LEGAL_POLICY_VERSION = '2026.1';
export const COOKIE_CONSENT_STORAGE_KEY = 'niapolor_cookie_consent_v1';

export type CookieConsentChoice = 'essential_only' | 'all_preferences';

export interface StoredCookieConsent {
  choice: CookieConsentChoice;
  policyVersion: string;
  updatedAt: string;
}

export const DEFAULT_LEGAL_PROFILE: LegalProfileSettings = {
  legalForm: '',
  rneNumber: '',
  taxId: '',
  shareCapital: '',
  publicationDirector: '',
  dpoEmail: '',
  dpoPhone: '',
  hostingProvider: '',
  hostingAddress: '',
  policyVersion: CURRENT_LEGAL_POLICY_VERSION,
  effectiveDate: '2026-01-01',
  retractionDays: 10,
  mediationContact: '',
  customLegalNotice: { ar: '', fr: '', en: '' },
};

export interface DisclosureFieldResult {
  value: string;
  isPlaceholder: boolean;
}

export interface ResolvedLegalDisclosures {
  entityName: DisclosureFieldResult;
  legalForm: DisclosureFieldResult;
  rneNumber: DisclosureFieldResult;
  taxId: DisclosureFieldResult;
  shareCapital: DisclosureFieldResult;
  publicationDirector: DisclosureFieldResult;
  dpoEmail: DisclosureFieldResult;
  hostingProvider: DisclosureFieldResult;
  hostingAddress: DisclosureFieldResult;
  mediationContact: DisclosureFieldResult;
  policyVersion: string;
  effectiveDate: string;
  retractionDays: number;
  returnWindowDays: number;
  missingMandatoryKeys: string[];
  completionPercent: number;
}

const PLACEHOLDERS: Record<Language, Record<string, string>> = {
  ar: {
    entityName: 'الاسم القانوني للشركة أو المؤسسة — قيد الاستكمال والتحقق الرسمي',
    legalForm: 'الشكل القانوني للمؤسسة — قيد الاستكمال والتحقق',
    rneNumber: 'معرّف السجل الوطني للمؤسسات (RNE) وفق القانون 2018-52 — قيد الاستكمال',
    taxId: 'المعرّف الجبائي (Matricule Fiscal / Patente) — قيد الاستكمال',
    shareCapital: 'رأس المال الاجتماعي — يُعرض عند الاقتضاء وبعد الاعتماد الرسمي',
    publicationDirector: 'الممثل القانوني / مدير النشر — قيد الاستكمال',
    dpoEmail: 'بريد حماية المعطيات الشخصية (INPDP) — قيد التخصيص (يمكن التواصل عبر البريد الرسمي للمتجر)',
    hostingProvider: 'بنية استضافة سحابية وقواعد بيانات (Google Cloud Firestore / خوادم الويب) — التفاصيل الرسمية قيد الاستكمال',
    hostingAddress: 'عنوان مقر الاستضافة السحابية — قيد الاستكمال',
    mediationContact: 'قناة الشكاوى والوساطة — عبر خدمة الحرفاء الرسمية للمنصة',
  },
  fr: {
    entityName: 'Dénomination sociale de l’entreprise — en cours de complétion et de vérification',
    legalForm: 'Forme juridique de l’entité — en cours de complétion',
    rneNumber: 'Identifiant unique RNE (Loi n° 2018-52) — en cours de complétion',
    taxId: 'Matricule Fiscal / Patente — en cours de complétion',
    shareCapital: 'Capital social — communiqué le cas échéant après validation',
    publicationDirector: 'Représentant légal / Directeur de publication — en cours de complétion',
    dpoEmail: 'Contact protection des données (INPDP) — en cours d’attribution (joignable via l’e-mail officiel)',
    hostingProvider: 'Infrastructure cloud et bases de données (Google Cloud Firestore / hébergement web) — coordonnées officielles en cours de complétion',
    hostingAddress: 'Adresse de l’hébergeur / centre de données — en cours de complétion',
    mediationContact: 'Service réclamations et médiation — via le support officiel NIAPOLOR',
  },
  en: {
    entityName: 'Registered legal entity name — pending official completion and verification',
    legalForm: 'Legal form of entity — pending completion',
    rneNumber: 'Tunisian National Business Register (RNE) ID (Law No. 2018-52) — pending completion',
    taxId: 'Tax Identification Number (Matricule Fiscal) — pending completion',
    shareCapital: 'Share capital — disclosed where applicable upon confirmation',
    publicationDirector: 'Legal representative / Publication director — pending completion',
    dpoEmail: 'Personal Data Protection contact (INPDP) — pending assignment (reachable via official store email)',
    hostingProvider: 'Cloud infrastructure and databases (Google Cloud Firestore / web hosting) — official host details pending completion',
    hostingAddress: 'Hosting provider physical location — pending completion',
    mediationContact: 'Consumer complaints and mediation channel — via official NIAPOLOR support',
  },
};

function resolveField(raw: string | undefined, fallbackPlaceholder: string): DisclosureFieldResult {
  const clean = typeof raw === 'string' ? raw.trim() : '';
  if (clean) {
    return { value: clean, isPlaceholder: false };
  }
  return { value: fallbackPlaceholder, isPlaceholder: true };
}

export function resolveLegalDisclosures(
  siteSettings: SiteSettings,
  language: Language
): ResolvedLegalDisclosures {
  const ph = PLACEHOLDERS[language] || PLACEHOLDERS.ar;
  const lp = siteSettings.legalProfile || DEFAULT_LEGAL_PROFILE;

  const entityName = resolveField(siteSettings.legalEntityName, ph.entityName);
  const legalForm = resolveField(lp.legalForm, ph.legalForm);
  // Keep backward compatibility with single commercialRegisterId if rneNumber wasn't separately filled
  const rawRne = lp.rneNumber?.trim() || siteSettings.commercialRegisterId?.trim() || '';
  const rneNumber = resolveField(rawRne, ph.rneNumber);
  const taxId = resolveField(lp.taxId, ph.taxId);
  const shareCapital = resolveField(lp.shareCapital, ph.shareCapital);
  const publicationDirector = resolveField(lp.publicationDirector, ph.publicationDirector);
  const dpoEmail = resolveField(lp.dpoEmail, ph.dpoEmail);
  const hostingProvider = resolveField(lp.hostingProvider, ph.hostingProvider);
  const hostingAddress = resolveField(lp.hostingAddress, ph.hostingAddress);
  const mediationContact = resolveField(lp.mediationContact, ph.mediationContact);

  const mandatoryPairs: Array<[string, DisclosureFieldResult]> = [
    ['entityName', entityName],
    ['legalForm', legalForm],
    ['rneNumber', rneNumber],
    ['taxId', taxId],
    ['publicationDirector', publicationDirector],
    ['hostingProvider', hostingProvider],
  ];

  const missingMandatoryKeys = mandatoryPairs
    .filter(([, res]) => res.isPlaceholder)
    .map(([key]) => key);

  const completionPercent = Math.round(
    ((mandatoryPairs.length - missingMandatoryKeys.length) / mandatoryPairs.length) * 100
  );

  return {
    entityName,
    legalForm,
    rneNumber,
    taxId,
    shareCapital,
    publicationDirector,
    dpoEmail,
    hostingProvider,
    hostingAddress,
    mediationContact,
    policyVersion: lp.policyVersion?.trim() || CURRENT_LEGAL_POLICY_VERSION,
    effectiveDate: lp.effectiveDate?.trim() || '2026-01-01',
    retractionDays:
      typeof lp.retractionDays === 'number' && Number.isFinite(lp.retractionDays) && lp.retractionDays > 0
        ? Math.round(lp.retractionDays)
        : 10,
    returnWindowDays:
      typeof siteSettings.returnWindowDays === 'number' && Number.isFinite(siteSettings.returnWindowDays)
        ? Math.max(1, Math.round(siteSettings.returnWindowDays))
        : 7,
    missingMandatoryKeys,
    completionPercent,
  };
}

export function readStoredCookieConsent(): StoredCookieConsent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCookieConsent>;
    if (
      parsed &&
      (parsed.choice === 'essential_only' || parsed.choice === 'all_preferences') &&
      typeof parsed.updatedAt === 'string'
    ) {
      return {
        choice: parsed.choice,
        policyVersion: parsed.policyVersion || CURRENT_LEGAL_POLICY_VERSION,
        updatedAt: parsed.updatedAt,
      };
    }
  } catch {
    // ignore invalid localStorage entry
  }
  return null;
}

export function writeStoredCookieConsent(
  choice: CookieConsentChoice,
  policyVersion = CURRENT_LEGAL_POLICY_VERSION
): StoredCookieConsent {
  const record: StoredCookieConsent = {
    choice,
    policyVersion,
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // ignore storage quota errors
    }
  }
  return record;
}

export function getLegalConsentErrorMessage(
  lang: Language,
  kind: 'checkout' | 'register' | 'partner'
): string {
  if (lang === 'fr') {
    if (kind === 'checkout') {
      return 'Veuillez accepter les Conditions Générales de Vente, la Politique de Retour et la Politique de Confidentialité avant de confirmer la commande.';
    }
    if (kind === 'partner') {
      return 'Veuillez confirmer l’acceptation des Conditions Vendeurs & Partenaires NIAPOLOR.';
    }
    return 'Veuillez accepter les Conditions d’Utilisation et la Politique de Confidentialité pour créer un compte.';
  }
  if (lang === 'en') {
    if (kind === 'checkout') {
      return 'Please accept the Terms of Sale, Return Policy, and Privacy Policy before confirming your order.';
    }
    if (kind === 'partner') {
      return 'Please confirm acceptance of the NIAPOLOR Seller & Partner Agreement.';
    }
    return 'Please accept the Terms of Service and Privacy Policy to create an account.';
  }
  if (kind === 'checkout') {
    return 'يرجى الموافقة على الشروط والأحكام وسياسة الاسترجاع وسياسة الخصوصية قبل تأكيد إرسال الطلب.';
  }
  if (kind === 'partner') {
    return 'يرجى تأكيد موافقة الشريك على شروط البائعين والشركاء في NIAPOLOR.';
  }
  return 'يرجى الموافقة على الشروط والأحكام وسياسة الخصوصية لإنشاء الحساب.';
}
