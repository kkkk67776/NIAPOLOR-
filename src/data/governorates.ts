export interface TunisianGovernorate {
  id: string;
  nameAr: string;
  nameFr: string;
  nameEn: string;
  postalCodePrefix: string;
  majorDelegations: string[];
  deliveryEstimateDays: string;
}

export const TUNISIAN_GOVERNORATES: TunisianGovernorate[] = [
  {
    id: 'tunis',
    nameAr: 'تونس',
    nameFr: 'Tunis',
    nameEn: 'Tunis',
    postalCodePrefix: '10',
    majorDelegations: [
      'قرطاج',
      'المدينة',
      'باب البحر',
      'باب سويقة',
      'العمران',
      'العمران الأعلى',
      'التحرير',
      'المنزه',
      'حي الخضراء',
      'باردو',
      'السيجومي',
      'الزهور',
      'الحرايرية',
      'سيدي حسين',
      'الوردية',
      'الكبارية',
      'سيدي البشير',
      'جبل الجلود',
      'حلق الوادي',
      'الكرم',
      'المرسى',
    ],
    deliveryEstimateDays: '24-48 ساعة',
  },
  {
    id: 'ariana',
    nameAr: 'أريانة',
    nameFr: 'Ariana',
    nameEn: 'Ariana',
    postalCodePrefix: '20',
    majorDelegations: [
      'أريانة المدينة',
      'سكرة',
      'رواد',
      'قلعة الأندلس',
      'سيدي ثابت',
      'التضامن',
      'المنيهلة',
    ],
    deliveryEstimateDays: '24-48 ساعة',
  },
  {
    id: 'ben_arous',
    nameAr: 'بن عروس',
    nameFr: 'Ben Arous',
    nameEn: 'Ben Arous',
    postalCodePrefix: '20',
    majorDelegations: [
      'بن عروس',
      'المدينة الجديدة',
      'المروج',
      'حمام الأنف',
      'حمام الشط',
      'بومهل البساتين',
      'الزهراء',
      'رادس',
      'مقرين',
      'المحمدية',
      'فوشانة',
      'مرناق',
    ],
    deliveryEstimateDays: '24-48 ساعة',
  },
  {
    id: 'manouba',
    nameAr: 'منوبة',
    nameFr: 'Manouba',
    nameEn: 'Manouba',
    postalCodePrefix: '20',
    majorDelegations: [
      'منوبة',
      'دوار هيشر',
      'وادي الليل',
      'المرناقية',
      'برج العامري',
      'الجديدة',
      'طبربة',
      'البطان',
    ],
    deliveryEstimateDays: '24-48 ساعة',
  },
  {
    id: 'nabeul',
    nameAr: 'نابل',
    nameFr: 'Nabeul',
    nameEn: 'Nabeul',
    postalCodePrefix: '80',
    majorDelegations: [
      'نابل',
      'دار شعبان الفهري',
      'بني خيار',
      'قربة',
      'منزل تميم',
      'الميدة',
      'قليبية',
      'حمام الغزاز',
      'الهوارية',
      'تاكلسة',
      'سليمان',
      'بني خلاد',
      'قرمبالية',
      'بوعرقوب',
      'الحمامات',
      'منزل بوزلفة',
    ],
    deliveryEstimateDays: '24-48 ساعة',
  },
  {
    id: 'zaghouan',
    nameAr: 'زغوان',
    nameFr: 'Zaghouan',
    nameEn: 'Zaghouan',
    postalCodePrefix: '11',
    majorDelegations: [
      'زغوان',
      'الزريبة',
      'بئر مشارقة',
      'الفحص',
      'الناظور',
      'صواف',
    ],
    deliveryEstimateDays: '48 ساعة',
  },
  {
    id: 'bizerte',
    nameAr: 'بنزرت',
    nameFr: 'Bizerte',
    nameEn: 'Bizerte',
    postalCodePrefix: '70',
    majorDelegations: [
      'بنزرت الشمالية',
      'جرزونة',
      'بنزرت الجنوبية',
      'سجنان',
      'جومين',
      'ماطر',
      'غزالة',
      'منزل بورقيبة',
      'تينجة',
      'أوتيك',
      'غار الملح',
      'منزل جميل',
      'العالية',
      'رأس الجبل',
    ],
    deliveryEstimateDays: '24-48 ساعة',
  },
  {
    id: 'beja',
    nameAr: 'باجة',
    nameFr: 'Béja',
    nameEn: 'Beja',
    postalCodePrefix: '90',
    majorDelegations: [
      'باجة الشمالية',
      'باجة الجنوبية',
      'عمدون',
      'نفزة',
      'تبرسق',
      'تيبار',
      'تستور',
      'قبلاط',
      'مجاز الباب',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
  {
    id: 'jendouba',
    nameAr: 'جندوبة',
    nameFr: 'Jendouba',
    nameEn: 'Jendouba',
    postalCodePrefix: '81',
    majorDelegations: [
      'جندوبة',
      'جندوبة الشمالية',
      'بوسالم',
      'طبرقة',
      'عين دراهم',
      'فرنانة',
      'غار الدماء',
      'وادي مليز',
      'بلطة بوعوان',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
  {
    id: 'kef',
    nameAr: 'الكاف',
    nameFr: 'Le Kef',
    nameEn: 'Le Kef',
    postalCodePrefix: '71',
    majorDelegations: [
      'الكاف الغربية',
      'الكاف الشرقية',
      'نبر',
      'ساقية سيدي يوسف',
      'تاجروين',
      'قلعة سنان',
      'القلعة الخصباء',
      'الجريصة',
      'القصور',
      'الدهماني',
      'السرس',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
  {
    id: 'siliana',
    nameAr: 'سليانة',
    nameFr: 'Siliana',
    nameEn: 'Siliana',
    postalCodePrefix: '61',
    majorDelegations: [
      'سليانة الشمالية',
      'سليانة الجنوبية',
      'بوعرادة',
      'قعفور',
      'العروسة',
      'الكريب',
      'بورويس',
      'مكثر',
      'الروحية',
      'كسرى',
      'برقو',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
  {
    id: 'sousse',
    nameAr: 'سوسة',
    nameFr: 'Sousse',
    nameEn: 'Sousse',
    postalCodePrefix: '40',
    majorDelegations: [
      'سوسة المدينة',
      'الزاوية القصيبة الثريات',
      'سوسة الرياض',
      'سوسة جوهرة',
      'سوسة سيدي عبد الحميد',
      'حمام سوسة',
      'أكودة',
      'القلعة الكبرى',
      'سيدي بوعلي',
      'هرقلة',
      'النفيضة',
      'بوفيشة',
      'كندار',
      'سيدي الهاني',
      'مساكن',
      'القلعة الصغرى',
    ],
    deliveryEstimateDays: '24-48 ساعة',
  },
  {
    id: 'monastir',
    nameAr: 'المنستير',
    nameFr: 'Monastir',
    nameEn: 'Monastir',
    postalCodePrefix: '50',
    majorDelegations: [
      'المنستير',
      'الوردانين',
      'الساحلين',
      'زرمدين',
      'بني حسان',
      'جمال',
      'بنبلة',
      'المكنين',
      'البقالطة',
      'طبلبة',
      'قصر هلال',
      'قصيبة المديوني',
      'صيادة لمطة بوحجر',
    ],
    deliveryEstimateDays: '24-48 ساعة',
  },
  {
    id: 'mahdia',
    nameAr: 'المهدية',
    nameFr: 'Mahdia',
    nameEn: 'Mahdia',
    postalCodePrefix: '51',
    majorDelegations: [
      'المهدية',
      'بومرداس',
      'أولاد الشامخ',
      'شربان',
      'هبيرة',
      'السواسي',
      'الجم',
      'الشابة',
      'ملولش',
      'سيدي علوان',
      'قصور الساف',
    ],
    deliveryEstimateDays: '24-48 ساعة',
  },
  {
    id: 'sfax',
    nameAr: 'صفاقس',
    nameFr: 'Sfax',
    nameEn: 'Sfax',
    postalCodePrefix: '30',
    majorDelegations: [
      'صفاقس المدينة',
      'صفاقس الغربية',
      'ساقية الزيت',
      'ساقية الداير',
      'صفاقس الجنوبية',
      'طينة',
      'عقارب',
      'جبنيانة',
      'العامرة',
      'الحنشة',
      'منزل شاكر',
      'الغريبة',
      'بئر علي بن خليفة',
      'الصخيرة',
      'المحرس',
      'قرقنة',
    ],
    deliveryEstimateDays: '24-48 ساعة',
  },
  {
    id: 'kairouan',
    nameAr: 'القيروان',
    nameFr: 'Kairouan',
    nameEn: 'Kairouan',
    postalCodePrefix: '31',
    majorDelegations: [
      'القيروان الشمالية',
      'القيروان الجنوبية',
      'الشبيكة',
      'السبيخة',
      'الوسلاتية',
      'حفوز',
      'العلا',
      'حاجب العيون',
      'نصر الله',
      'الشراردة',
      'بوحجلة',
    ],
    deliveryEstimateDays: '48 ساعة',
  },
  {
    id: 'kasserine',
    nameAr: 'القصرين',
    nameFr: 'Kasserine',
    nameEn: 'Kasserine',
    postalCodePrefix: '12',
    majorDelegations: [
      'القصرين الشمالية',
      'القصرين الجنوبية',
      'الزهور',
      'حاسي الفريد',
      'سبيطلة',
      'سبيبة',
      'جدليان',
      'العيون',
      'تالة',
      'حيدرة',
      'فوسانة',
      'فريانة',
      'ماجل بلعباس',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
  {
    id: 'sidi_bouzid',
    nameAr: 'سيدي بوزيد',
    nameFr: 'Sidi Bouzid',
    nameEn: 'Sidi Bouzid',
    postalCodePrefix: '91',
    majorDelegations: [
      'سيدي بوزيد الغربية',
      'سيدي بوزيد الشرقية',
      'جلمة',
      'سبالة أولاد عسكر',
      'بئر الحفي',
      'سيدي علي بن عون',
      'منزل بوزيان',
      'المكناسي',
      'سوق الجديد',
      'المزونة',
      'الرقاب',
      'أولاد حفوز',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
  {
    id: 'gabes',
    nameAr: 'قابس',
    nameFr: 'Gabès',
    nameEn: 'Gabes',
    postalCodePrefix: '60',
    majorDelegations: [
      'قابس المدينة',
      'قابس الغربية',
      'قابس الجنوبية',
      'غنوش',
      'المطوية',
      'منزل الحبيب',
      'الحامة',
      'مطماطة',
      'مطماطة الجديدة',
      'مارث',
    ],
    deliveryEstimateDays: '48 ساعة',
  },
  {
    id: 'medenine',
    nameAr: 'مدنين',
    nameFr: 'Médenine',
    nameEn: 'Medenine',
    postalCodePrefix: '41',
    majorDelegations: [
      'مدنين الشمالية',
      'مدنين الجنوبية',
      'بني خداش',
      'بنقردان',
      'جرجيس',
      'جربة حومة السوق',
      'جربة ميدون',
      'جربة أجيم',
      'سيدي مخلوف',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
  {
    id: 'tataouine',
    nameAr: 'تطاوين',
    nameFr: 'Tataouine',
    nameEn: 'Tataouine',
    postalCodePrefix: '32',
    majorDelegations: [
      'تطاوين الشمالية',
      'تطاوين الجنوبية',
      'الصمار',
      'بئر لحمر',
      'غمراسن',
      'ذهيبة',
      'رمادة',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
  {
    id: 'gafsa',
    nameAr: 'قفصة',
    nameFr: 'Gafsa',
    nameEn: 'Gafsa',
    postalCodePrefix: '21',
    majorDelegations: [
      'قفصة الشمالية',
      'سيدي عيش',
      'القصر',
      'قفصة الجنوبية',
      'أم العرائس',
      'الرديف',
      'المتلوي',
      'المظيلة',
      'القطار',
      'بلخير',
      'السند',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
  {
    id: 'tozeur',
    nameAr: 'توزر',
    nameFr: 'Tozeur',
    nameEn: 'Tozeur',
    postalCodePrefix: '22',
    majorDelegations: [
      'توزر',
      'دقاش',
      'تمغزة',
      'نفطة',
      'حزوة',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
  {
    id: 'kebili',
    nameAr: 'قبلي',
    nameFr: 'Kébili',
    nameEn: 'Kebili',
    postalCodePrefix: '42',
    majorDelegations: [
      'قبلي الجنوبية',
      'قبلي الشمالية',
      'سوق الأحد',
      'دوز الشمالية',
      'دوز الجنوبية',
      'الفوار',
    ],
    deliveryEstimateDays: '48-72 ساعة',
  },
];

export function getGovernorateName(id: string, lang: 'ar' | 'fr' | 'en'): string {
  const gov = TUNISIAN_GOVERNORATES.find((g) => g.id === id);
  if (!gov) return id;
  if (lang === 'fr') return gov.nameFr;
  if (lang === 'en') return gov.nameEn;
  return gov.nameAr;
}

export function getGovernorateById(govId: string): TunisianGovernorate | undefined {
  const normalized = String(govId || '').trim();
  return TUNISIAN_GOVERNORATES.find((g) => g.id === normalized);
}

export function getDelegationsForGovernorate(govId: string): string[] {
  const gov = getGovernorateById(govId);
  return gov ? gov.majorDelegations : [];
}

export function isValidGovernorate(govId: string): boolean {
  return Boolean(getGovernorateById(govId));
}

export function isValidDelegationForGovernorate(govId: string, delegation: string): boolean {
  const gov = getGovernorateById(govId);
  if (!gov) return false;
  const cleanDel = String(delegation || '').trim();
  if (!cleanDel) return false;
  return gov.majorDelegations.includes(cleanDel);
}

export function normalizeTunisianPhone(raw: string): {
  valid: boolean;
  normalized: string;
  localDigits: string;
} {
  const trimmed = String(raw || '').trim();
  // Convert Arabic/Eastern numerals to ASCII digits if entered
  const ascii = trimmed
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const digits = ascii.replace(/\D/g, '');
  let local = digits;
  if (digits.startsWith('00216') && digits.length === 13) {
    local = digits.slice(5);
  } else if (digits.startsWith('216') && digits.length === 11) {
    local = digits.slice(3);
  }

  // Tunisian numbers are 8 digits starting with 2, 3, 4, 5, 7, 8, or 9
  const valid = /^[2345789]\d{7}$/.test(local);
  return {
    valid,
    normalized: valid ? `+216 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}` : trimmed,
    localDigits: local,
  };
}
