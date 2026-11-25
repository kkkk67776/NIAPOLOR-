import type { Language } from '../types';

export interface LegalNoticeTranslations {
  badge: string;
  title: string;
  subtitle: string;
  versionLabel: string;
  effectiveDateLabel: string;
  completionLabel: string;
  pendingBadge: string;
  entitySectionTitle: string;
  fields: {
    legalEntityName: string;
    legalForm: string;
    rneNumber: string;
    taxId: string;
    shareCapital: string;
    publicationDirector: string;
    headquarters: string;
    officialEmail: string;
    supportPhone: string;
    dpoEmail: string;
    hostingProvider: string;
    hostingAddress: string;
    mediationContact: string;
  };
  ipTitle: string;
  ipBody: string;
  linksTitle: string;
  linksBody: string;
  legalNoteTitle: string;
  legalNoteBody: string;
  customNoticeTitle: string;
}

export interface PrivacyExpandedTranslations {
  frameworkBadge: string;
  frameworkBody: string;
  crossBorderTitle: string;
  crossBorderBody: string;
  securityTitle: string;
  securityBody: string;
  retentionTitle: string;
  retentionItems: { category: string; duration: string; basis: string }[];
  storageTitle: string;
  storageSubtitle: string;
  storageColumns: { name: string; kind: string; purpose: string; retention: string };
  storageItems: { name: string; kind: string; purpose: string; retention: string }[];
  rightsTitle: string;
  rightsList: string[];
  manageCookiesBtn: string;
  openPrivacyCenterBtn: string;
}

export interface TermsExpandedTranslations {
  legalRefsTitle: string;
  legalRefsList: string[];
  extraSections: { title: string; body: string }[];
}

export interface ReturnsExpandedTranslations {
  retractionBadge: string;
  retractionTitle: string;
  retractionBody: string;
  codInspectionTitle: string;
  codInspectionBody: string;
  refundChannelsTitle: string;
  refundChannelsList: string[];
}

export interface SellerTermsTranslations {
  badge: string;
  title: string;
  subtitle: string;
  commissionNotePrefix: string;
  commissionNoteSuffix: string;
  sections: { title: string; body: string }[];
  onboardingLinkLabel: string;
}

export interface CookieBannerTranslations {
  title: string;
  description: string;
  essentialOnlyBtn: string;
  acceptAllBtn: string;
  privacyLink: string;
  legalNoticeLink: string;
  savedNotice: string;
}

export interface CheckoutLegalTranslations {
  prefix: string;
  termsLabel: string;
  returnsLabel: string;
  privacyLabel: string;
  andWord: string;
  requiredError: string;
  retractionNotePrefix: string;
  retractionNoteSuffix: string;
}

export interface RegisterLegalTranslations {
  prefix: string;
  termsLabel: string;
  privacyLabel: string;
  andWord: string;
  requiredError: string;
}

export interface CustomerPrivacyCenterTranslations {
  tabLabel: string;
  title: string;
  subtitle: string;
  consentCardTitle: string;
  consentRecordedLabel: string;
  consentNoneLabel: string;
  versionLabel: string;
  dateLabel: string;
  exportCardTitle: string;
  exportCardDesc: string;
  exportBtn: string;
  exportingBtn: string;
  cookieCardTitle: string;
  cookieCardDesc: string;
  cookieBtn: string;
  requestCardTitle: string;
  requestCardDesc: string;
  requestTypes: {
    rectification: string;
    erasure: string;
    opposition: string;
  };
  detailsPlaceholder: string;
  submitRequestBtn: string;
  submittingBtn: string;
  requestSuccess: string;
  legalLinkText: string;
}

export interface LegalLanguageBundle {
  legalNotice: LegalNoticeTranslations;
  privacyExpanded: PrivacyExpandedTranslations;
  termsExpanded: TermsExpandedTranslations;
  returnsExpanded: ReturnsExpandedTranslations;
  sellerTerms: SellerTermsTranslations;
  cookieBanner: CookieBannerTranslations;
  checkoutLegal: CheckoutLegalTranslations;
  registerLegal: RegisterLegalTranslations;
  customerPrivacyCenter: CustomerPrivacyCenterTranslations;
}

export const LEGAL_TRANSLATIONS: Record<Language, LegalLanguageBundle> = {
  ar: {
    legalNotice: {
      badge: 'البيانات القانونية الرسمية — Mentions Légales',
      title: 'البيانات القانونية والتجارية — NIAPOLOR',
      subtitle:
        'إفصاح قانوني موجّه للجمهور التونسي وفق متطلبات الشفافية في السجل الوطني للمؤسسات (القانون عدد 52 لسنة 2018) والتجارة الإلكترونية (القانون عدد 83 لسنة 2000).',
      versionLabel: 'إصدار الوثائق القانونية:',
      effectiveDateLabel: 'تاريخ السريان:',
      completionLabel: 'نسبة اكتمال المعرّفات الرسمية:',
      pendingBadge: 'قيد الاستكمال',
      entitySectionTitle: 'هوية الناشر والمعرّفات التجارية والجبائية والاستضافة',
      fields: {
        legalEntityName: 'الاسم القانوني / التسمية الاجتماعية',
        legalForm: 'الشكل القانوني',
        rneNumber: 'معرّف السجل الوطني للمؤسسات (RNE)',
        taxId: 'المعرّف الجبائي (Matricule Fiscal)',
        shareCapital: 'رأس المال الاجتماعي',
        publicationDirector: 'الممثل القانوني / مدير النشر',
        headquarters: 'المقر الاجتماعي / عنوان النشاط',
        officialEmail: 'البريد الإلكتروني الرسمي',
        supportPhone: 'هاتف الدعم والاستفسار',
        dpoEmail: 'بريد حماية المعطيات الشخصية (INPDP)',
        hostingProvider: 'مزوّد الاستضافة والبنية السحابية',
        hostingAddress: 'عنوان الاستضافة / مركز المعطيات',
        mediationContact: 'قناة معالجة الشكاوى والوساطة',
      },
      ipTitle: 'الملكية الفكرية والعلامة التجارية',
      ipBody:
        'جميع عناصر الواجهة، شعار NIAPOLOR، النصوص، الهيكلة البرمجية، وقواعد البيانات المعروضة في هذا المتجر محمية بموجب التشريع التونسي والاتفاقيات الدولية للملكية الأدبية والفنية والصناعية. تبقى صور وعلامات الشركات الشريكة ملكاً لأصحابها وتُعرض لأغراض التسويق المشروع ضمن المنصة.',
      linksTitle: 'الروابط الخارجية وبوابات الدفع',
      linksBody:
        'قد يتضمن الموقع روابط لخدمات دفع خارجية معتمدة (مثل Konnect أو Flouci عند تفعيلها) أو قنوات تواصل مباشرة (واتساب). لا تتحمل المنصة مسؤولية محتوى أو سياسات المواقع الخارجية خارج نطاق معالجة المعاملات المرتبطة بالمتجر.',
      legalNoteTitle: 'الشفافية القانونية وموثوقية المعطيات',
      legalNoteBody:
        'أي بيانات تحمل علامة «قيد الاستكمال» تعني أن استكمالها أو التحقق منها لا يزال جاريًا، وسيتم تحديثها عند توفر المعلومات المعتمدة. تلتزم NIAPOLOR بعدم عرض أي أرقام سجل تجاري (RNE) أو معرّف جبائي أو صفة قانونية غير موثقة، وبمواصلة استيفاء المتطلبات التنظيمية والجبائية ومعايير حماية المعطيات الشخصية لدى الهيئة الوطنية لحماية المعطيات الشخصية (INPDP) وفق القانون الأساسي عدد 63 لسنة 2004.',
      customNoticeTitle: 'إفصاحات وتنبيهات قانونية إضافية',
    },
    privacyExpanded: {
      frameworkBadge: 'القانون الأساسي عدد 63 لسنة 2004 — الجمهورية التونسية',
      frameworkBody:
        'تُعالج NIAPOLOR المعطيات الشخصية في إطار الاحترام التام لأحكام القانون الأساسي عدد 63 لسنة 2004 المؤرخ في 27 جويلية 2004 المتعلق بحماية المعطيات الشخصية وتحت إشراف مبادئ الهيئة الوطنية لحماية المعطيات الشخصية (INPDP)، بناءً على الموافقة الصريحة والمسبقة أو لتنفيذ العقد التجاري المبرم مع الحريف.',
      crossBorderTitle: 'الاستضافة السحابية وتأمين نقل المعطيات',
      crossBorderBody:
        'تعتمد المنصة على بنية استضافة سحابية وقواعد بيانات مُدارة (Google Cloud Firestore / خوادم الاستضافة المهيّأة) مع تشفير الاتصالات عبر HTTPS، وقد تستقر الخوادم خارج التراب التونسي. تلتزم NIAPOLOR باتخاذ التدابير التعاقدية والتقنية اللازمة واستيفاء التراخيص أو التصاريح القانونية المستوجبة لدى INPDP متى انطبق ذلك.',
      securityTitle: 'التدابير التقنية والأمنية المطبّقة فعلياً',
      securityBody:
        'تُحفظ كلمات مرور الحسابات عبر خوارزمية PBKDF2-SHA256 مع ملح عشوائي مستقل، وتُوقّع الجلسات بمفاتيح HMAC-SHA256 خادمية عبر ملفات تعريف ارتباط HttpOnly مع حماية CSRF وفصل تام لمعلومات الدفع الحساسة، كما تُعزل الملفات المرفوعة (مثل وصولات Poste CCP) وتُفحص خادمياً.',
      retentionTitle: 'مدد الاحتفاظ بالمعطيات',
      retentionItems: [
        {
          category: 'معطيات الحساب الشخصي والعناوين والمفضلة',
          duration: 'طيلة فترة نشاط الحساب أو إلى حين طلب الحذف القانوني',
          basis: 'تنفيذ خدمة الحساب والموافقة الصريحة',
        },
        {
          category: 'الطلبات، الفواتير، ومعاملات الدفع أو المساهمات الطوعية',
          duration: 'تُحفظ وفق الالتزامات المحاسبية والجبائية وإثبات المعاملات في التشريع التونسي',
          basis: 'التزام قانوني ومحاسبي (القانون 2000-83 والقانون الجبائي)',
        },
        {
          category: 'سجلات الموافقات القانونية وطلبات الخصوصية',
          duration: 'سجل تدقيق محمي لإثبات تاريخ الموافقة والإصدار (الفصل 36 من القانون 2000-83)',
          basis: 'إثبات قانوني للموافقة والمعاملات الإلكترونية',
        },
      ],
      storageTitle: 'جرد فعلي لملفات الارتباط (Cookies) والتخزين المحلي (LocalStorage)',
      storageSubtitle:
        'لا تستخدم NIAPOLOR أي برمجيات تتبع إعلاني أو إعادة استهداف تابعة لأطراف ثالثة. يقتصر التخزين على العناصر الوظيفية والأمنية التالية:',
      storageColumns: {
        name: 'المعرّف',
        kind: 'النوع',
        purpose: 'الغرض الوظيفي والأمني',
        retention: 'المدة',
      },
      storageItems: [
        {
          name: '__customer_session',
          kind: 'Cookie (HttpOnly)',
          purpose: 'تأمين جلسة دخول الحريف والتحقق الخادمي دون كشفها للبرمجيات',
          retention: '14 يوماً أو عند تسجيل الخروج',
        },
        {
          name: '__session & echox_csrf',
          kind: 'Cookie (HttpOnly / CSRF)',
          purpose: 'تأمين الجلسات المحمية والتحقق من سلامة الطلبات ومنع هجمات التزوير (CSRF)',
          retention: 'طيلة الجلسة / منتهية الصلاحية خادمياً',
        },
        {
          name: 'سلة المشتريات والمفضلة واللغة والمظهر',
          kind: 'LocalStorage',
          purpose: 'حفظ محتويات السلة والمفضلة واختيار اللغة (AR/FR/EN) والوضع الداكن/الفاتح على جهازك',
          retention: 'تبقى على متصفحك حتى مسحها',
        },
        {
          name: 'niapolor_cookie_consent_v1',
          kind: 'LocalStorage',
          purpose: 'تذكّر اختيارك بخصوص إشعار ملفات الارتباط وإصدار السياسة الموافق عليه',
          retention: 'حتى تغيير التفضيلات',
        },
        {
          name: 'الطلبات المتتبعة محلياً وذاكرة وضع عدم الاتصال (PWA)',
          kind: 'LocalStorage / Service Worker Cache',
          purpose: 'عرض آخر نسخة متصفحة عند انقطاع الإنترنت وحفظ أرقام التتبع التي فتحتها محلياً',
          retention: 'تحديث آلي عند توفر الاتصال',
        },
      ],
      rightsTitle: 'حقوقك بمقتضى القانون الأساسي عدد 63 لسنة 2004',
      rightsList: [
        'حق النفاذ: الاطلاع على جميع معطياتك الشخصية وتصدير نسخة إلكترونية (JSON) مباشرة من حسابك.',
        'حق التحيين والإصلاح: تعديل الاسم ورقم الهاتف وعناوين التوصيل مباشرة من بوابة الحريف أو بطلب تحيين.',
        'حق المحو والحذف: طلب حذف الحساب والبيانات الشخصية متى لم يعد الاحتفاظ بها مستوجباً قانونياً.',
        'حق الاعتراض: الاعتراض على أي معالجة غير أساسية أو اختيارية وفق الأطر القانونية.',
      ],
      manageCookiesBtn: 'إدارة تفضيلات الكوكيز والتخزين',
      openPrivacyCenterBtn: 'فتح مركز الخصوصية وتصدير بياناتي',
    },
    termsExpanded: {
      legalRefsTitle: 'المرجعيات التشريعية التونسية المنطبقة',
      legalRefsList: [
        'القانون عدد 83 لسنة 2000 المؤرخ في 9 أوت 2000 المتعلق بالمبادلات والتجارة الإلكترونية (لا سيما الفصول 25، 27، 35، و36).',
        'القانون عدد 117 لسنة 1992 المؤرخ في 7 ديسمبر 1992 المتعلق بحماية المستهلك.',
        'القانون الأساسي عدد 63 لسنة 2004 المتعلق بحماية المعطيات الشخصية.',
        'القانون عدد 52 لسنة 2018 المتعلق بالسجل الوطني للمؤسسات.',
      ],
      extraSections: [
        {
          title: '6. نموذج السوق متعدد البائعين ومسؤولية المنتجات',
          body: 'تعرض منصة NIAPOLOR منتجات خاصة بها ومنتجات موردة عبر بائعين وشركاء مدرجين. يتولى كل بائع مسؤولية مطابقة سلعته وأصالتها وتجهيز حصته ضمن الطلب، فيما تتولى المنصة تنسيق العرض، اعتماد الأسعار الموثقة، الإشراف على المراجعة، وتسيير قنوات الدفع والتتبع والوساطة مع الحريف.',
        },
        {
          title: '7. التحقق بخطوتين وإصلاح الأخطاء قبل العقد (الفصل 27 من القانون 2000-83)',
          body: 'يتيح ملخص الطلب في نافذة الدفع للحريف مراجعة جميع المنتجات، الكميات، تكلفة التوصيل للولاية والمعتمدية، والخصومات، وتعديلها أو التراجع عنها قبل الضغط على زر «تأكيد الطلب» والموافقة الصريحة على هذه الشروط.',
        },
        {
          title: '8. المساهمات الطوعية (ادعم NIAPOLOR)',
          body: 'تُعدّ ميزة «ادعم NIAPOLOR» مساهمة طوعية مستقلة لدعم تطوير المنصة ولا تمثل شراءً لسلعة ولا تبرعاً خاضعاً لإعفاء ضريبي، كما أنها منفصلة تماماً عن طلبات المنتجات ودفاتر البائعين.',
        },
        {
          title: '9. القوة القاهرة والاختصاص القضائي',
          body: 'تُعفى المنصة من التأخير الناتج عن حالات القوة القاهرة الخارجة عن السيطرة المعقولة. وفي حال تعذّر التسوية الودية لأي نزاع تجاري، تختص المحاكم التونسية المختصة بالنظر وفق القوانين الجاري بها العمل.',
        },
      ],
    },
    returnsExpanded: {
      retractionBadge: 'الإعلام بالعدول وفق الفصل 30 وما بعده من القانون 2000-83',
      retractionTitle: 'مهلة العدول والضمانات التونسية',
      retractionBody:
        'إضافة إلى حالات عدم المطابقة أو العيوب المصنعية، يتمتع المستهلك في البيع عن بُعد في تونس بحق العدول ضمن الآجال القانونية المنطبقة (المضبوطة حالياً بالمتجر بـ {DAYS} أيام من تاريخ الاستلام، وفق شروط حفظ السلعة سليمة وفي تغليفها الأصلي مع تحمل مصاريف الإرجاع عند العدول غير المعلل بعيب).',
      codInspectionTitle: 'حق المعاينة الظاهرية عند الدفع عند الاستلام',
      codInspectionBody:
        'عند اختيار الدفع نقداً عند الاستلام، يحق للحريف فحص الطرد ظاهرياً والتأكد من مطابقة المرجع المطلوب قبل السداد للموزع.',
      refundChannelsTitle: 'طرق وآجال استرجاع المبالغ',
      refundChannelsList: [
        'الطلبات المدفوعة عبر البريد التونسي / CCP أو التحويل البنكي: يتم الاسترجاع عبر حوالة بريدية أو تحويل بنكي لنفس صاحب الطلب بعد فحص المرتجع.',
        'الطلبات المدفوعة إلكترونياً بالبطاقة (عند تفعيل البوابة): يتم إرجاع المبلغ عبر نفس وسيلة الدفع أو وفق آليات مزود الخدمة المصرفية.',
        'تُعالج طلبات الإلغاء أو الاسترجاع دون تأخير غير مبرر بما ينسجم مع الآجال المنصوص عليها في تشريع التجارة الإلكترونية التونسي (لا تتجاوز 10 أيام عمل من تاريخ إرجاع السلعة والتثبت من حالتها متى استُوجب الرد).',
      ],
    },
    sellerTerms: {
      badge: 'ميثاق وشروط الشركاء البائعين',
      title: 'شروط انضمام البائعين والشركاء — NIAPOLOR Marketplace',
      subtitle:
        'تنظم هذه الاتفاقية العلاقة المهنية والتجارية بين منصة NIAPOLOR والمؤسسات أو البائعين المشاركين في العرض ضمن السوق متعدد الفئات.',
      commissionNotePrefix: 'نسبة العمولة الافتراضية المطبّقة على مبيعات الشركاء بالمنصة هي حالياً',
      commissionNoteSuffix:
        'وتُحتسب آلياً على مستوى كل طلب قبل التسوية النهائية لمستحقات الشريك.',
      sections: [
        {
          title: '1. الأهلية القانونية والهوية التجارية',
          body: 'يلتزم كل شريك أو بائع بتقديم معطيات تجارية صحيحة ومحيّنة (الاسم التجاري، العنوان، الولاية، الهاتف، والبريد الإلكتروني، إضافة إلى معرّف RNE والمعرّف الجبائي متى كان مسجلاً كشخص معنوي أو مهني) والالتزام بالتصاريح القانونية والضريبية الخاصة بنشاطه في تونس.',
        },
        {
          title: '2. مطابقة المنتجات وأصالتها والسلع المحظورة',
          body: 'يضمن البائع أن جميع المنتجات المعروضة أصلية أو مطابقة للوصف والمواصفات المعلنة، سليمة وخالية من العيوب الخفية (وفق القانون عدد 117 لسنة 1992)، وغير مخالفة للقانون التونسي (يُمنع عرض السلع المقلدة، المحظورة، أو الخطرة دون ترخيص).',
        },
        {
          title: '3. الأسعار والعمولات والتسوية المالية',
          body: 'تُعرض الأسعار بالدينار التونسي (TND) وفق التسعيرة المعتمدة بالمنصة. تُحتسب مستحقات كل بائع ضمن كشف حساب مالي مخصص بعد خصم عمولة المنصة، وتتم تسويتها بعد التحقق من الدفع الفعلي أو تأكيد تسليم الطلب دون إلغاء.',
        },
        {
          title: '4. تجهيز الطلبات والإلغاء أو الاسترجاع',
          body: 'يتعهد الشريك بتوفير المخزون المعلن وتسليم الطلبات المؤكدة ضمن الآجال المعتمدة (24–72 ساعة حسب الولاية). في حال إلغاء الطلب أو قبول إرجاع منتج بسبب عيب مصنعي أو عدم مطابقة، تُعدّل المستحقات في كشف حساب الشريك ويُعاد ضبط المخزون.',
        },
        {
          title: '5. حماية المعطيات وتعليق الشراكة',
          body: 'يُمنع على البائع استخدام أرقام هواتف أو عناوين الحرفاء لأغراض تسويقية خارج نطاق تنفيذ الطلبات، وتحتفظ NIAPOLOR بحق تعليق عرض منتجات أي شريك يخل بجودة الخدمة أو شروط الامتثال.',
        },
      ],
      onboardingLinkLabel: 'شروط مرجعية معتمدة لتنظيم انضمام وعمل البائعين والشركاء التجاريين عبر منصة NIAPOLOR',
    },
    cookieBanner: {
      title: 'إشعار الخصوصية، الكوكيز والتخزين المحلي',
      description:
        'تستخدم NIAPOLOR ملفات ارتباط أمنية أساسية (HttpOnly / CSRF) وتخزيناً محلياً لحفظ سلتك وتفضيلات اللغة والمظهر وتصفح وضع عدم الاتصال، دون أي برمجيات تتبع إعلاني.',
      essentialOnlyBtn: 'الضرورية فقط',
      acceptAllBtn: 'موافقة على الأساسي والتفضيلات',
      privacyLink: 'سياسة الخصوصية',
      legalNoticeLink: 'البيانات القانونية',
      savedNotice: 'تم حفظ اختيارك.',
    },
    checkoutLegal: {
      prefix: 'أقرّ بأنني راجعت الطلب وأوافق صراحةً على',
      termsLabel: 'الشروط والأحكام العامة للبيع',
      returnsLabel: 'سياسة الاسترجاع والعدول',
      privacyLabel: 'سياسة الخصوصية وحماية المعطيات',
      andWord: 'و',
      requiredError: 'يرجى تأكيد الموافقة على الشروط والأحكام وسياسة الاسترجاع والخصوصية لإتمام الطلب.',
      retractionNotePrefix: 'إعلام قانوني: تخضع الطلبات عن بُعد لحق المعاينة والاسترجاع/العدول ضمن',
      retractionNoteSuffix: 'أيام وفق سياسة المتجر والتشريع التونسي.',
    },
    registerLegal: {
      prefix: 'أوافق صراحةً على',
      termsLabel: 'الشروط والأحكام',
      privacyLabel: 'سياسة الخصوصية (القانون 2004-63)',
      andWord: 'و',
      requiredError: 'يرجى الموافقة على الشروط والأحكام وسياسة الخصوصية لإنشاء الحساب.',
    },
    customerPrivacyCenter: {
      tabLabel: 'الخصوصية وحقوقي',
      title: 'مركز الخصوصية وحماية المعطيات الشخصية',
      subtitle:
        'ممارسة حقوقك القانونية بمقتضى القانون الأساسي التونسي عدد 63 لسنة 2004 (الاطلاع، التصدير، التحيين، الحذف، والاعتراض).',
      consentCardTitle: 'سجل موافقتك المسجلة',
      consentRecordedLabel: 'تم توثيق موافقتك الصريحة على الشروط والخصوصية',
      consentNoneLabel: 'حساب مسجل قبل تفعيل ختم الإصدار المحدّث — تخضع خدمات الحساب للسياسة المعلنة.',
      versionLabel: 'إصدار السياسة:',
      dateLabel: 'تاريخ الموافقة:',
      exportCardTitle: 'تصدير نسخة من بياناتك (حق النفاذ)',
      exportCardDesc: 'حمّل ملف JSON يحتوي على بيانات حسابك، العناوين، المفضلة، سجل موافقاتك، وطلباتك المسجلة.',
      exportBtn: 'تصدير بياناتي (JSON)',
      exportingBtn: 'جاري تجهيز الملف...',
      cookieCardTitle: 'تفضيلات التخزين المحلي والكوكيز',
      cookieCardDesc: 'يمكنك مراجعة أو تعديل موافقتك حول حفظ تفضيلات التصفح في أي وقت.',
      cookieBtn: 'تغيير تفضيلات الكوكيز',
      requestCardTitle: 'تقديم طلب تصحيح، حذف، أو اعتراض',
      requestCardDesc: 'يُسجّل طلبك مباشرة في سجل الخصوصية الرسمي وتتم متابعته ومعالجته وفق الآجال القانونية.',
      requestTypes: {
        rectification: 'تصحيح / تحيين معطيات',
        erasure: 'طلب حذف / محو الحساب والبيانات',
        opposition: 'الاعتراض على معالجة غير أساسية',
      },
      detailsPlaceholder: 'اذكر تفاصيل الطلب (اختياري — مثال: سبب الحذف أو البيان المطلوب تصحيحه)...',
      submitRequestBtn: 'إرسال الطلب القانوني',
      submittingBtn: 'جاري التسجيل...',
      requestSuccess: 'تم تسجيل طلب الخصوصية بنجاح وسيتم التعامل معه وفق الإجراءات المعتمدة.',
      legalLinkText: 'قراءة النص الكامل لسياسة الخصوصية',
    },
  },

  fr: {
    legalNotice: {
      badge: 'Mentions Légales & Transparence',
      title: 'Mentions Légales — NIAPOLOR Tunisie',
      subtitle:
        'Informations légales publiées conformément aux exigences tunisiennes de transparence commerciale (Loi n° 2018-52 relative au RNE et Loi n° 2000-83 sur le commerce électronique).',
      versionLabel: 'Version des politiques :',
      effectiveDateLabel: 'Date d’entrée en vigueur :',
      completionLabel: 'Complétude des mentions obligatoires :',
      pendingBadge: 'En cours de complétion',
      entitySectionTitle: 'Éditeur, immatriculation commerciale & hébergement',
      fields: {
        legalEntityName: 'Dénomination / Raison sociale',
        legalForm: 'Forme juridique',
        rneNumber: 'Identifiant Unique RNE',
        taxId: 'Matricule Fiscal / Patente',
        shareCapital: 'Capital social',
        publicationDirector: 'Représentant légal / Directeur de publication',
        headquarters: 'Siège / Adresse d’activité',
        officialEmail: 'Email officiel',
        supportPhone: 'Téléphone de contact',
        dpoEmail: 'Contact Données Personnelles (INPDP)',
        hostingProvider: 'Hébergeur & Infrastructure Cloud',
        hostingAddress: 'Adresse de l’hébergeur / Data Center',
        mediationContact: 'Contact réclamations & médiation',
      },
      ipTitle: 'Propriété intellectuelle',
      ipBody:
        'L’architecture du site, le logo NIAPOLOR, les textes, graphismes et bases de données sont protégés par la législation tunisienne et internationale relative à la propriété intellectuelle. Les marques et visuels des vendeurs partenaires restent la propriété de leurs titulaires respectifs.',
      linksTitle: 'Liens externes & Prestataires de paiement',
      linksBody:
        'La plateforme peut orienter vers des passerelles de paiement agréées (telles que Konnect ou Flouci lorsqu’elles sont actives) ou des canaux de support (WhatsApp). NIAPOLOR n’assume aucune responsabilité quant aux contenus de sites tiers externes au processus de commande.',
      legalNoteTitle: 'Note de transparence juridique et de fiabilité des données',
      legalNoteBody:
        'Toute mention portant la marque « En cours de complétion » signifie que sa validation ou sa mise à jour est toujours en cours et qu’elle sera publiée dès disponibilité des informations officielles confirmées. NIAPOLOR s’engage à n’afficher aucun identifiant RNE, matricule fiscal ou statut juridique non vérifié, et à poursuivre la mise en conformité réglementaire, fiscale et de protection des données personnelles auprès de l’INPDP (Loi organique n° 2004-63).',
      customNoticeTitle: 'Mentions et avis juridiques complémentaires',
    },
    privacyExpanded: {
      frameworkBadge: 'Loi organique n° 2004-63 du 27 juillet 2004 — Tunisie',
      frameworkBody:
        'NIAPOLOR traite vos données personnelles dans le respect des principes de la Loi organique tunisienne n° 2004-63 relative à la protection des données à caractère personnel (INPDP), sur la base de votre consentement préalable exprès ou pour l’exécution de vos commandes et la sécurisation de votre compte.',
      crossBorderTitle: 'Infrastructure Cloud & transfert international',
      crossBorderBody:
        'La persistance applicative repose sur une infrastructure cloud sécurisée (Google Cloud Firestore / hébergement web) chiffrée via HTTPS, susceptible d’être hébergée hors de Tunisie. NIAPOLOR s’engage à maintenir les garanties contractuelles et techniques appropriées et à effectuer toute formalité applicable auprès de l’INPDP.',
      securityTitle: 'Mesures techniques de sécurité mises en œuvre',
      securityBody:
        'Les mots de passe clients sont hachés côté serveur via PBKDF2-SHA256 avec sel aléatoire unique. Les sessions utilisent des signatures HMAC-SHA256 et des cookies HttpOnly protégés contre le CSRF. Les justificatifs Poste CCP volontairement transmis sont validés et stockés de façon isolée.',
      retentionTitle: 'Durées de conservation',
      retentionItems: [
        {
          category: 'Compte client, adresses tunisiennes et favoris',
          duration: 'Pendant toute la durée d’activité du compte ou jusqu’à demande d’effacement',
          basis: 'Exécution du service et consentement',
        },
        {
          category: 'Commandes, factures, transactions & soutiens volontaires',
          duration: 'Conservés selon les obligations comptables, fiscales et de preuve en Tunisie',
          basis: 'Obligation légale & preuve électronique (Loi 2000-83)',
        },
        {
          category: 'Journal des consentements & demandes de confidentialité',
          duration: 'Archivage horodaté pour prouver la version acceptée et traiter vos demandes',
          basis: 'Preuve légale du consentement (Art. 36 Loi 2000-83)',
        },
      ],
      storageTitle: 'Inventaire réel des Cookies & Stockage Local',
      storageSubtitle:
        'NIAPOLOR n’utilise aucun traceur publicitaire tiers. Seuls les éléments techniques suivants sont utilisés :',
      storageColumns: {
        name: 'Identifiant',
        kind: 'Support',
        purpose: 'Finalité fonctionnelle / sécurité',
        retention: 'Durée',
      },
      storageItems: [
        {
          name: '__customer_session',
          kind: 'Cookie (HttpOnly)',
          purpose: 'Authentification sécurisée de votre compte client côté serveur',
          retention: '14 jours ou déconnexion',
        },
        {
          name: '__session & echox_csrf',
          kind: 'Cookie (HttpOnly / CSRF)',
          purpose: 'Sécurisation de session et protection anti-CSRF sur les requêtes sensibles',
          retention: 'Durée de session / expiration serveur',
        },
        {
          name: 'Panier, Favoris, Langue (AR/FR/EN) & Thème',
          kind: 'LocalStorage',
          purpose: 'Mémorisation du panier, de la liste d’envies et de vos préférences d’affichage',
          retention: 'Persistant jusqu’à suppression locale',
        },
        {
          name: 'niapolor_cookie_consent_v1',
          kind: 'LocalStorage',
          purpose: 'Enregistrement de votre choix relatif aux préférences cookies et à la version',
          retention: 'Jusqu’à modification',
        },
        {
          name: 'Suivi hors ligne & cache PWA',
          kind: 'LocalStorage / Service Worker',
          purpose: 'Consultation hors ligne de la dernière boutique synchronisée et suivis récents',
          retention: 'Actualisé lors de la reconnexion',
        },
      ],
      rightsTitle: 'Vos droits selon la Loi n° 2004-63',
      rightsList: [
        'Droit d’accès : consulter vos informations et télécharger un export complet (JSON) depuis votre compte.',
        'Droit de rectification : mettre à jour votre nom, téléphone et adresses directement ou sur demande.',
        'Droit d’effacement : demander la suppression de votre compte et données non soumises à conservation légale.',
        'Droit d’opposition : vous opposer à tout traitement non indispensable à la livraison de vos commandes.',
      ],
      manageCookiesBtn: 'Gérer mes préférences cookies',
      openPrivacyCenterBtn: 'Accéder à mon Centre de Confidentialité',
    },
    termsExpanded: {
      legalRefsTitle: 'Références législatives tunisiennes applicables',
      legalRefsList: [
        'Loi n° 2000-83 du 9 août 2000 relative aux échanges et au commerce électroniques (art. 25, 27, 35 et 36).',
        'Loi n° 92-117 du 7 décembre 1992 relative à la protection du consommateur.',
        'Loi organique n° 2004-63 du 27 juillet 2004 sur la protection des données personnelles.',
        'Loi n° 2018-52 du 29 octobre 2018 relative au Registre National des Entreprises (RNE).',
      ],
      extraSections: [
        {
          title: '6. Modèle Marketplace multi-vendeurs & responsabilité',
          body: 'NIAPOLOR propose des produits distribués directement ainsi que des articles fournis par des vendeurs partenaires identifiés. Chaque vendeur répond de la conformité et de l’authenticité de ses lots ; la plateforme assure la fiabilité des prix affichés, la coordination logistique, la traçabilité et le suivi client.',
        },
        {
          title: '7. Validation en deux étapes & correction d’erreurs (Art. 27 Loi 2000-83)',
          body: 'Avant toute conclusion du contrat, le récapitulatif de commande permet au client de vérifier le détail des articles, frais de port selon le gouvernorat/délégation, remises éventuelles et total TND, et de corriger toute erreur avant d’accepter explicitement les présentes conditions.',
        },
        {
          title: '8. Contributions volontaires (« Soutenir NIAPOLOR »)',
          body: 'Les contributions envoyées via le module « Soutenir NIAPOLOR » sont purement facultatives, distinctes des commandes commerciales et des comptes vendeurs, et ne constituent pas des dons ouvrant droit à déduction fiscale.',
        },
        {
          title: '9. Force majeure & juridiction compétente',
          body: 'Aucune partie ne saurait être tenue responsable d’un retard dû à un cas de force majeure. À défaut d’accord amiable, les tribunaux compétents de la République Tunisienne sont seuls compétents.',
        },
      ],
    },
    returnsExpanded: {
      retractionBadge: 'Information sur la rétractation — Loi n° 2000-83',
      retractionTitle: 'Délai de rétractation & garanties légales',
      retractionBody:
        'Indépendamment de la garantie de conformité ou vices cachés, les ventes à distance en Tunisie ouvrent droit à une rétractation dans les conditions légales applicables (fixée actuellement sur la plateforme à {DAYS} jours à compter de la réception effective, pour un article neuf non utilisé dans son emballage intact, frais de retour à la charge de l’acheteur hors défaut).',
      codInspectionTitle: 'Vérification visuelle lors du Paiement à la Livraison',
      codInspectionBody:
        'En choisissant le paiement à la livraison (COD), vous pouvez vérifier l’aspect extérieur et la correspondance apparente du colis avant le règlement.',
      refundChannelsTitle: 'Modalités et délais de remboursement',
      refundChannelsList: [
        'Commandes réglées via Poste CCP ou virement : remboursement par mandat postal ou virement vers le titulaire après contrôle du retour.',
        'Paiements électroniques par carte (si passerelle active) : recrédit selon les procédures de la passerelle et délais bancaires.',
        'Conformément aux principes de la Loi n° 2000-83, les remboursements validés sont exécutés sans retard injustifié dans un délai maximal conforme aux prescriptions légales (10 jours ouvrables après vérification de l’article retourné).',
      ],
    },
    sellerTerms: {
      badge: 'Accord Vendeurs & Partenaires',
      title: 'Conditions Générales Vendeurs & Partenaires — NIAPOLOR',
      subtitle:
        'Cadre contractuel régissant l’intégration des fournisseurs, boutiques et partenaires commerciaux sur la marketplace NIAPOLOR en Tunisie.',
      commissionNotePrefix: 'Le taux de commission plateforme par défaut actuellement configuré est de',
      commissionNoteSuffix:
        'calculé automatiquement sur chaque commande vendeur avant versement net.',
      sections: [
        {
          title: '1. Éligibilité légale & identification du partenaire',
          body: 'Le partenaire garantit fournir des informations véridiques et à jour (raison sociale, adresse, gouvernorat, téléphone, email, et identifiant RNE / Matricule fiscal selon son statut juridique) et respecter ses obligations fiscales et sociales tunisiennes.',
        },
        {
          title: '2. Conformité, authenticité & produits interdits',
          body: 'Le vendeur garantit la qualité, l’authenticité et la conformité de ses produits aux descriptifs publiés et à la Loi n° 92-117. Les produits contrefaits, dangereux ou interdits à la commercialisation en Tunisie sont strictement prohibés.',
        },
        {
          title: '3. Prix vérifiés, commissions & reversements',
          body: 'Les prix sont affichés en TND selon les tarifs validés sur la plateforme. Chaque vente génère un relevé comptable dédié indiquant le montant brut, la commission NIAPOLOR et le net vendeur, réglé après confirmation effective du paiement ou de la livraison.',
        },
        {
          title: '4. Préparation des commandes, retours & annulations',
          body: 'Le partenaire s’engage à honorer les stocks déclarés dans les délais annoncés (24–72h). En cas d’annulation ou de retour pour défaut imputable au produit, le relevé comptable est ajusté et le stock rééquilibré.',
        },
        {
          title: '5. Protection des données acheteurs & suspension',
          body: 'Les coordonnées des acheteurs ne peuvent être utilisées que pour l’exécution de la commande. Tout manquement grave aux obligations légales ou qualité expose le compte partenaire à une suspension immédiate.',
        },
      ],
      onboardingLinkLabel: 'Conditions de référence applicables à l’intégration et à l’activité des vendeurs partenaires sur NIAPOLOR',
    },
    cookieBanner: {
      title: 'Confidentialité, Cookies & Stockage Local',
      description:
        'NIAPOLOR utilise des cookies techniques essentiels (HttpOnly / CSRF) et le stockage local pour votre panier, la langue et la navigation hors ligne, sans aucun traceur publicitaire.',
      essentialOnlyBtn: 'Essentiels uniquement',
      acceptAllBtn: 'Accepter essentiels & préférences',
      privacyLink: 'Politique de confidentialité',
      legalNoticeLink: 'Mentions légales',
      savedNotice: 'Préférence enregistrée.',
    },
    checkoutLegal: {
      prefix: 'Je confirme avoir vérifié ma commande et j’accepte expressément les',
      termsLabel: 'Conditions Générales de Vente',
      returnsLabel: 'la Politique de Retour',
      privacyLabel: 'la Politique de Confidentialité',
      andWord: 'et',
      requiredError: 'Veuillez accepter les CGV, la Politique de Retour et la Confidentialité avant de confirmer.',
      retractionNotePrefix: 'Information légale : droit d’inspection et rétractation applicable sous',
      retractionNoteSuffix: 'jours selon nos conditions et le droit tunisien.',
    },
    registerLegal: {
      prefix: 'J’accepte expressément les',
      termsLabel: 'Conditions d’Utilisation',
      privacyLabel: 'la Politique de Confidentialité (Loi 2004-63)',
      andWord: 'et',
      requiredError: 'Veuillez accepter les Conditions d’Utilisation et la Politique de Confidentialité.',
    },
    customerPrivacyCenter: {
      tabLabel: 'Confidentialité & Droits',
      title: 'Centre de Confidentialité & Droits (Loi n° 2004-63)',
      subtitle:
        'Exercez vos droits d’accès, d’export, de rectification, d’effacement et d’opposition sur vos données personnelles.',
      consentCardTitle: 'Preuve de consentement enregistrée',
      consentRecordedLabel: 'Consentement exprès enregistré sur votre compte',
      consentNoneLabel: 'Compte antérieur au suivi de version — la politique en vigueur s’applique.',
      versionLabel: 'Version :',
      dateLabel: 'Date :',
      exportCardTitle: 'Exporter mes données (Droit d’accès)',
      exportCardDesc: 'Téléchargez un fichier JSON contenant votre profil, adresses, favoris, consentements et commandes.',
      exportBtn: 'Télécharger mes données (JSON)',
      exportingBtn: 'Préparation...',
      cookieCardTitle: 'Préférences Cookies & Stockage',
      cookieCardDesc: 'Modifiez à tout moment votre choix concernant le stockage des préférences.',
      cookieBtn: 'Modifier mes préférences',
      requestCardTitle: 'Demande de rectification, suppression ou opposition',
      requestCardDesc: 'Votre demande est enregistrée avec accusé d’horodatage et traitée conformément aux délais légaux.',
      requestTypes: {
        rectification: 'Rectification / mise à jour des données',
        erasure: 'Suppression de compte & effacement',
        opposition: 'Opposition à un traitement non essentiel',
      },
      detailsPlaceholder: 'Précisez votre demande (optionnel)...',
      submitRequestBtn: 'Envoyer la demande légale',
      submittingBtn: 'Enregistrement...',
      requestSuccess: 'Votre demande de confidentialité a bien été enregistrée pour traitement.',
      legalLinkText: 'Lire l’intégralité de la Politique de Confidentialité',
    },
  },

  en: {
    legalNotice: {
      badge: 'Legal Notice & Disclosures — Mentions Légales',
      title: 'Legal Notice & Corporate Disclosures — NIAPOLOR',
      subtitle:
        'Public corporate, tax, and hosting disclosures structured for Tunisian e-commerce transparency under Law No. 2018-52 (RNE) and Law No. 2000-83.',
      versionLabel: 'Policy Version:',
      effectiveDateLabel: 'Effective Date:',
      completionLabel: 'Mandatory Disclosure Completion:',
      pendingBadge: 'Pending Completion',
      entitySectionTitle: 'Publisher Identity, Commercial Registration & Cloud Hosting',
      fields: {
        legalEntityName: 'Registered Legal Entity Name',
        legalForm: 'Legal Form',
        rneNumber: 'National Business Register (RNE) ID',
        taxId: 'Tax Identification Number (Matricule Fiscal)',
        shareCapital: 'Share Capital',
        publicationDirector: 'Legal Representative / Publication Director',
        headquarters: 'Registered Headquarters / Activity Address',
        officialEmail: 'Official Contact Email',
        supportPhone: 'Support & Inquiries Phone',
        dpoEmail: 'Personal Data Protection Contact (INPDP)',
        hostingProvider: 'Cloud Infrastructure & Hosting Provider',
        hostingAddress: 'Hosting Location / Address',
        mediationContact: 'Complaints & Dispute Mediation Channel',
      },
      ipTitle: 'Intellectual Property',
      ipBody:
        'The NIAPOLOR brand identity, interface structure, source software, copy, and curated catalog databases are protected under Tunisian and international intellectual property laws. Partner brand logos and trademarks remain the property of their respective owners.',
      linksTitle: 'External Links & Payment Providers',
      linksBody:
        'This storefront may link to authorized Tunisian payment gateways (such as Konnect or Flouci when enabled) or direct communication channels (WhatsApp). NIAPOLOR is not responsible for external third-party websites outside authorized order processing.',
      legalNoteTitle: 'Legal Transparency & Data Accuracy Notice',
      legalNoteBody:
        'Any field marked "Pending Completion" indicates that its completion or verification is still in progress and will be updated once verified official information is available. NIAPOLOR never displays unverified National Business Register (RNE), Matricule Fiscal, or legal-form claims, and remains committed to applicable Tunisian commercial, tax, and personal data protection compliance (INPDP / Organic Law No. 2004-63).',
      customNoticeTitle: 'Additional Legal Notices & Disclosures',
    },
    privacyExpanded: {
      frameworkBadge: 'Tunisian Organic Law No. 2004-63 of 27 July 2004',
      frameworkBody:
        'NIAPOLOR processes personal data in alignment with Tunisian Organic Law No. 2004-63 on the Protection of Personal Data (INPDP principles), grounded in your explicit prior consent or contractual necessity to fulfill orders and secure accounts.',
      crossBorderTitle: 'Cloud Hosting & Cross-Border Transfer Notice',
      crossBorderBody:
        'Platform data is persisted over HTTPS on managed cloud infrastructure (Google Cloud Firestore / configured web hosting), which may operate servers outside Tunisia. NIAPOLOR commits to appropriate contractual and security safeguards and applicable INPDP authorizations or declarations where required.',
      securityTitle: 'Implemented Technical Safeguards',
      securityBody:
        'Customer passwords are hashed server-side using PBKDF2-SHA256 with unique cryptographic salts. Sessions use HMAC-SHA256 signatures in HttpOnly cookies with CSRF protection. Voluntary Poste CCP receipts are validated server-side and isolated from public paths.',
      retentionTitle: 'Data Retention Schedule',
      retentionItems: [
        {
          category: 'Customer Account, Addresses & Wishlist',
          duration: 'Active account lifetime or until a verified erasure request is fulfilled',
          basis: 'Account service performance & express consent',
        },
        {
          category: 'Orders, Invoices, Payment Records & Voluntary Support',
          duration: 'Retained per Tunisian commercial, accounting, and tax record-keeping obligations',
          basis: 'Legal & evidentiary obligation (Law No. 2000-83)',
        },
        {
          category: 'Legal Consent Audit & Privacy Requests Log',
          duration: 'Timestamped server audit trail recording accepted version and user requests',
          basis: 'Electronic transaction evidentiary proof (Art. 36 Law 2000-83)',
        },
      ],
      storageTitle: 'Actual Cookies & LocalStorage Inventory',
      storageSubtitle:
        'NIAPOLOR uses zero third-party advertising trackers or behavioral ad cookies. Browser storage is strictly limited to:',
      storageColumns: {
        name: 'Identifier',
        kind: 'Mechanism',
        purpose: 'Operational / Security Purpose',
        retention: 'Duration',
      },
      storageItems: [
        {
          name: '__customer_session',
          kind: 'Cookie (HttpOnly)',
          purpose: 'Server-verified authenticated customer session cookie',
          retention: '14 days or until sign-out',
        },
        {
          name: '__session & echox_csrf',
          kind: 'Cookie (HttpOnly / CSRF)',
          purpose: 'Protected session integrity and Cross-Site Request Forgery (CSRF) defense',
          retention: 'Session lifetime / server expiry',
        },
        {
          name: 'Cart, Wishlist, Language (AR/FR/EN) & Theme',
          kind: 'LocalStorage',
          purpose: 'Persists shopping cart items, saved favorites, UI language, and light/dark mode',
          retention: 'Until cleared by user',
        },
        {
          name: 'niapolor_cookie_consent_v1',
          kind: 'LocalStorage',
          purpose: 'Stores your cookie/storage preference and accepted policy version',
          retention: 'Until updated',
        },
        {
          name: 'Offline Snapshot & Tracked Codes (PWA)',
          kind: 'LocalStorage / Service Worker',
          purpose: 'Supports offline catalog browsing and quick local tracking code lookup',
          retention: 'Refreshed when online',
        },
      ],
      rightsTitle: 'Your Rights Under Organic Law No. 2004-63',
      rightsList: [
        'Right of Access: View your personal data and download a portable JSON export from your Account.',
        'Right of Rectification: Update your full name, Tunisian phone, and addresses anytime.',
        'Right of Erasure: Request account and personal data deletion where statutory retention does not apply.',
        'Right of Opposition: Object to any non-essential processing through the Privacy Center.',
      ],
      manageCookiesBtn: 'Manage Cookie & Storage Preferences',
      openPrivacyCenterBtn: 'Open My Privacy & Data Rights Center',
    },
    termsExpanded: {
      legalRefsTitle: 'Applicable Tunisian Legislative Framework',
      legalRefsList: [
        'Law No. 2000-83 of 9 August 2000 on Electronic Exchanges and E-Commerce (Art. 25, 27, 35, 36).',
        'Law No. 92-117 of 7 December 1992 on Consumer Protection.',
        'Organic Law No. 2004-63 of 27 July 2004 on Personal Data Protection.',
        'Law No. 2018-52 of 29 October 2018 on the National Business Register (RNE).',
      ],
      extraSections: [
        {
          title: '6. Multi-Vendor Marketplace Model & Product Responsibility',
          body: 'NIAPOLOR operates a multi-category marketplace featuring platform-fulfilled items and partner vendor listings. Each partner is responsible for product authenticity, conformity, and order fulfillment, while NIAPOLOR ensures verified pricing integrity, order coordination, payment controls, and customer dispute support.',
        },
        {
          title: '7. Two-Step Checkout Validation & Error Correction (Art. 27 Law 2000-83)',
          body: 'Before binding an order, the Checkout review screen lets buyers inspect all item quantities, governorate/delegation shipping fees, coupon discounts, and the total TND price, and modify or cancel inputs prior to explicit consent and final confirmation.',
        },
        {
          title: '8. Voluntary Platform Support ("Support NIAPOLOR")',
          body: 'Contributions via Support NIAPOLOR are strictly voluntary, isolated from product sales and partner accounts, and do not constitute tax-deductible charitable donations.',
        },
        {
          title: '9. Force Majeure & Governing Law',
          body: 'Neither party is liable for delays caused by force majeure events. Unresolved disputes fall under the competent courts of the Republic of Tunisia.',
        },
      ],
    },
    returnsExpanded: {
      retractionBadge: 'Distance-Sale Retraction Notice — Law No. 2000-83',
      retractionTitle: 'Statutory Retraction & Conformity Guarantees',
      retractionBody:
        'In addition to defective or mismatched product claims, distance purchases in Tunisia carry statutory retraction rights within applicable legal conditions (currently configured on NIAPOLOR as {DAYS} days from delivery for unused items in intact original packaging; return shipping applies for non-defect buyer-remorse returns).',
      codInspectionTitle: 'Visual Package Inspection for Cash on Delivery',
      codInspectionBody:
        'For Cash on Delivery (COD) orders, customers may visually inspect the parcel exterior and reference match before handing payment to the courier.',
      refundChannelsTitle: 'Refund Channels & Statutory Timelines',
      refundChannelsList: [
        'Poste CCP or Bank Transfer Orders: Refunded via postal money order or bank transfer to the ordering party after returned item verification.',
        'Online Card Gateway Orders (when active): Refunded through the payment processor per standard banking clearing windows.',
        'Approved refunds are processed without undue delay in accordance with Tunisian e-commerce rules (within 10 business days following return receipt and inspection).',
      ],
    },
    sellerTerms: {
      badge: 'Seller & Partner Agreement',
      title: 'Sellers & Partners Compliance Terms — NIAPOLOR Marketplace',
      subtitle:
        'Commercial and compliance obligations governing third-party suppliers, stores, and partners listed on NIAPOLOR Tunisia.',
      commissionNotePrefix: 'The platform default marketplace commission currently configured is',
      commissionNoteSuffix:
        'calculated automatically per partner order prior to net payout settlement.',
      sections: [
        {
          title: '1. Legal Eligibility & Partner Identification',
          body: 'Partners must supply accurate, up-to-date business contact details (company name, governorate, address, phone, email, and RNE / Matricule Fiscal where applicable) and remain solely compliant with Tunisian tax and commercial obligations.',
        },
        {
          title: '2. Product Conformity, Authenticity & Prohibited Goods',
          body: 'Sellers warrant that listed goods are genuine, match published specifications, comply with Law No. 92-117 consumer safety standards, and exclude counterfeit, hazardous, or unlicensed restricted goods.',
        },
        {
          title: '3. Verified Pricing, Commission & Partner Settlement',
          body: 'Prices are denominated in TND in accordance with verified platform pricing. Each confirmed sale generates a dedicated partner statement detailing the gross amount, platform commission, and net payable balance prior to settlement.',
        },
        {
          title: '4. Order Fulfillment, Cancellations & Defective Returns',
          body: 'Partners must maintain accurate stock and hand off confirmed orders within advertised timelines (24–72h). Approved cancellations or defective-item returns adjust statement balances and restore inventory.',
        },
        {
          title: '5. Buyer Data Confidentiality & Suspension',
          body: 'Buyer shipping and phone details may only be used to fulfill active orders. NIAPOLOR may suspend or delist any partner violating legal compliance or fulfillment standards.',
        },
      ],
      onboardingLinkLabel: 'Reference terms governing seller and commercial partner onboarding and operations on NIAPOLOR',
    },
    cookieBanner: {
      title: 'Privacy, Cookies & Browser Storage',
      description:
        'NIAPOLOR uses strictly necessary security cookies (HttpOnly / CSRF) and local browser storage for your cart, language, theme, and offline browsing — with zero ad-tracking cookies.',
      essentialOnlyBtn: 'Essential Only',
      acceptAllBtn: 'Accept Essential & Preferences',
      privacyLink: 'Privacy Policy',
      legalNoticeLink: 'Legal Notice',
      savedNotice: 'Preference saved.',
    },
    checkoutLegal: {
      prefix: 'I have reviewed my order summary and expressly accept the',
      termsLabel: 'Terms of Sale',
      returnsLabel: 'Return Policy',
      privacyLabel: 'Privacy Policy',
      andWord: 'and',
      requiredError: 'Please accept the Terms of Sale, Return Policy, and Privacy Policy before confirming.',
      retractionNotePrefix: 'Legal notice: Visual inspection & return/retraction apply within',
      retractionNoteSuffix: 'days per store policy and Tunisian law.',
    },
    registerLegal: {
      prefix: 'I expressly accept the',
      termsLabel: 'Terms of Service',
      privacyLabel: 'Privacy Policy (Law 2004-63)',
      andWord: 'and',
      requiredError: 'Please accept the Terms of Service and Privacy Policy to register.',
    },
    customerPrivacyCenter: {
      tabLabel: 'Privacy & Rights',
      title: 'Personal Data & Privacy Center (Law No. 2004-63)',
      subtitle:
        'Exercise your statutory rights of access, data export, rectification, erasure, and objection.',
      consentCardTitle: 'Recorded Consent Proof',
      consentRecordedLabel: 'Explicit consent verified on your account',
      consentNoneLabel: 'Account registered prior to version stamp — current platform policies apply.',
      versionLabel: 'Policy Version:',
      dateLabel: 'Accepted At:',
      exportCardTitle: 'Export My Personal Data (Right of Access)',
      exportCardDesc: 'Download a portable JSON copy of your profile, addresses, wishlist, consent proof, and orders.',
      exportBtn: 'Download My Data (JSON)',
      exportingBtn: 'Preparing Export...',
      cookieCardTitle: 'Cookie & Browser Storage Preferences',
      cookieCardDesc: 'Review or update your preference choice at any time.',
      cookieBtn: 'Update Cookie Preferences',
      requestCardTitle: 'Submit Rectification, Erasure, or Objection Request',
      requestCardDesc: 'Logged in our official privacy registry and handled in accordance with statutory timelines.',
      requestTypes: {
        rectification: 'Data rectification / correction',
        erasure: 'Account & personal data deletion (erasure)',
        opposition: 'Objection to non-essential processing',
      },
      detailsPlaceholder: 'Add details or specify fields to update/remove (optional)...',
      submitRequestBtn: 'Submit Legal Request',
      submittingBtn: 'Submitting...',
      requestSuccess: 'Your privacy request has been recorded for review and handling.',
      legalLinkText: 'Read full Privacy Policy',
    },
  },
};
