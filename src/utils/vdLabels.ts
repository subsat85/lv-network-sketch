import type { CableKind, SpanReview } from '../types/drawing';
import type { MissingItem, PoleStatus, ProvisionalReason, SettingMissing } from './voltageDrop';
import type { CircuitStatus, NetworkIssue } from './network';

// Arabic wording of the voltage-drop data, statuses and warnings (one place).

export const MISSING_LABEL: Record<MissingItem, string> = {
  'length': 'طول المقطع غير مُدخل',
  'length-suspect': 'طول المقطع 1 م أو أقل (قيمة الرسم الافتراضية) — أدخل الطول الفعلي',
  'system': 'نظام التغذية (عدد الأطوار)',
  'resistance': 'المقاومة: مادة الموصل ومقطعه، أو R يدويًا',
  'resistance-bare': 'موصلات عارية: جدول IEC 60228 خاص بالكوابل المعزولة ولا ينطبق — أدخل R من معيار/كتالوج الموصل',
  'resistance-kind': 'حدد نوع الكيبل (ABC أو أرضي) لاستعمال جدول IEC 60228، أو أدخل R من مصدر موثق',
  'section-not-in-table': 'المقطع غير موجود في جدول IEC 60228 — أدخل R يدويًا',
  'reactance': 'المفاعلة X (مطلوبة لأن cos φ أقل من 1)',
  'neutral': 'المحايد: مقطعه أو Rn يدويًا (يمر فيه تيار)',
  'neutral-not-in-table': 'مقطع المحايد غير موجود في الجدول — أدخل Rn يدويًا',
  'neutral-material': 'مادة المحايد غير محددة (لا تُفترض مثل الطور)',
  'neutral-alloy': 'محايد من سبيكة ألمنيوم (مثل حامل ABC): ليس في الجدول — أدخل Rn من كتالوج الكيبل',
  'parallel': 'عدد الموصلات المتوازية غير صالح',
  'three-phase-on-single-phase': 'حمل ثلاثي الطور يتغذى عبر مقطع أحادي الطور',
  'downstream-voltage-unknown': 'نموذج القدرة الثابتة: فولتية بعض الأحمال بعد هذا المقطع غير معروفة (بيانات ناقصة بعده)',
  'not-converged': 'غير قابل للحساب: لم يتقارب (نموذج القدرة الثابتة)',
  'invalid-load': 'مشترك بعد هذا المقطع قيمة حمله غير صالحة (صفر أو سالب أو عدد غير صحيح) — صحّحها',
};

export const PROVISIONAL_LABEL: Record<ProvisionalReason, string> = {
  'review': 'مقطع على المسار عليه علامة مراجعة',
  'inherited': 'خصائص منسوخة من المقطع السابق ولم تُعتمد',
  'length-estimated': 'طول تقديري (ناتج عن إضافة عمود) — أدخل الطول المقاس',
  'source-unknown': 'مصدر قيم R / X غير مذكور',
};
/** shown instead of the plain status when the value is provisional */
export const PROVISIONAL_STATUS = 'تقديري — يحتاج مراجعة';
export const PROVISIONAL_MARK = '≈';

export const SETTING_MISSING_LABEL: Record<SettingMissing, string> = {
  powerFactor: 'معامل القدرة cos φ (في إعدادات هبوط الفولتية)',
  conductorTempC: 'حرارة تشغيل الموصل (في إعدادات هبوط الفولتية) — مطلوبة لاستعمال جدول المقاومة',
};

export const REVIEW_LABEL: Record<SpanReview, string> = {
  'split': 'قُسم هذا المقطع بإضافة عمود: نُسخت خصائصه، وطوله تقديري (نصف الطول السابق) حتى يُدخل الطول المقاس — تحقّق',
  'merge': 'دُمج هذا المقطع من مقطعين — تحقّق',
  'merge-different': 'دُمج مقطعان بخصائص مختلفة: استُعملت خصائص الأول، وكل القيم الأصلية محفوظة أدناه — راجعها واحفظ',
  'merge-partial': 'دُمج مقطع له خصائص مع مقطع بلا خصائص: استُعملت الموجودة، والأصل محفوظ أدناه — راجعها واحفظ',
  'moved': 'أُعيد ربط الخصائص بهذا المقطع حسب أعمدته — تحقّق',
  'v2': 'خصائص من ملف إصدار 2 (feature/vd) محفوظة كما هي، ولا تُستخدم في الحساب',
  'defaults': 'افتراضي — يحتاج مراجعة: عُبّئت الخصائص الناقصة لهذا المقطع بالقيم الافتراضية (جدول الشركة). تحقّق منها واحفظ لاعتمادها',
};
export const DEFAULTS_REVIEW_SHORT = 'افتراضي — يحتاج مراجعة';
export const INHERITED_LABEL = 'منسوخة من المقطع السابق — راجعها واحفظ';

export const CABLE_KIND_LABEL: Record<CableKind, string> = {
  abc: 'هوائي مجدول (ABC)',
  bare: 'موصلات هوائية عارية',
  underground: 'كيبل أرضي',
  other: 'آخر',
};

export const POLE_STATUS_LABEL: Record<PoleStatus, string> = {
  ok: 'ضمن الحد',
  near: 'يقترب من الحد',
  over: 'يتجاوز الحد',
  na: 'غير قابل للحساب',
};
/** status symbol shown next to the value (colour is never used for status) */
export const POLE_STATUS_MARK: Record<PoleStatus, string> = { ok: '✓', near: '⚠', over: '‼', na: '؟' };

export const CIRCUIT_STATUS_LABEL: Record<CircuitStatus, string> = {
  'ok': 'محسوبة',
  'no-source': 'لا يوجد مصدر تغذية: أضف محولة أو اختر عمود المصدر',
  'multiple-sources': 'أكثر من عمود مصدر في الشبكة نفسها: اختر مصدرًا واحدًا',
  'multiple-transformers': 'أكثر من محولة متصلة في الشبكة نفسها: اختر عمود المصدر لهذه الدائرة',
  'non-radial': 'الشبكة ليست شعاعية (حلقة أو مقاطع متوازية بنفس اللون): لا تُحسب بالطريقة الشعاعية',
  'ambiguous': 'الاتصال غير محدد في الرسم (انظر التحذيرات): لا تُحسب حتى يُوضَّح',
};

export const issueText = (i: NetworkIssue, poleName: (id: string) => string): string => {
  switch (i.kind) {
    case 'parallel-spans': return `كوابل بنفس اللون متوازية بين ${poleName(i.poles[0])} و${poleName(i.poles[1])} (${i.cableIds.length}): إن كانت موصلات متوازية فاحذف المكرر واكتب العدد في «الموصلات المتوازية»`;
    case 'loop': return 'حلقة مغلقة في الشبكة: الحساب الشعاعي لا ينطبق';
    case 'transformer-not-source': return `المحولة ${poleName(i.poleId)} ضمن الشبكة لكنها ليست مصدر الحساب المختار`;
    case 'orphan-consumer': return `مشترك على ${poleName(i.poleId)} لا يوجد عنده كيبل بلونه، فلم يُحسب حمله`;
    case 'legacy-jumper': return 'وصلة بين عمودين من ملف إصدار 2: محفوظة ومرسومة ولا تُستخدم في الحساب';
    case 'missing-pole': return 'كيبل يشير إلى عمود غير موجود';
    case 'three-phase-on-single-phase': return 'حمل ثلاثي الطور بعد مقطع أحادي الطور';
    case 'passes-source-pole': return `كيبل يمر عبر المحولة ${poleName(i.poleId)} دون أن يبدأ أو ينتهي عندها: لا يُعرف إن كان يتغذى منها. اختر المحولة «مصدر التغذية» يدويًا إن كان كذلك، أو ارسمه منتهيًا عندها`;
    case 'same-colour-crossing': return `كوابل بنفس اللون تمر عبر ${poleName(i.poleId)} دون ربط بينها (تقاطع): إن كانت متصلة فأضف Jumper`;
    case 'ambiguous-junction': return `كيبل ينتهي عند ${poleName(i.poleId)} حيث يمر أكثر من كيبل بنفس اللون: لا يُعرف بأيّها يتصل — استعمل Jumper أو لونًا مختلفًا`;
    case 'isolated-end-jumpered': return `طرف كيبل عند ${poleName(i.poleId)} معلَّم «منفصل» لكن عليه Jumper: اعتُبر الـ Jumper (يربط طرفين محددين) — راجع أحدهما`;
    case 'connected-end-alone': return `طرف كيبل عند ${poleName(i.poleId)} معلَّم «متصل» ولا يوجد عنده كيبل آخر بلونه يتصل به`;
    case 'invalid-load': return `مشترك على ${poleName(i.poleId)} قيمة حمله غير صالحة («${i.label}»): لم يُستعمل في الحساب`;
  }
};

export const fmt = (v: number | undefined, digits = 2) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits));

export const END_LINK_LABEL = { auto: 'تلقائي', connected: 'متصل', isolated: 'منفصل' } as const;
export const END_LINK_HINT = {
  auto: 'حسب الرسم: يتصل بالكوابل التي بلونه عند هذا العمود',
  connected: 'الاتصال مؤكد (لا يظهر في قائمة المراجعة)',
  isolated: 'لا يتصل بأي كيبل عند هذا العمود',
} as const;

export const LOAD_MODEL_LABEL = { 'constant-current': 'تيار ثابت', 'constant-power': 'قدرة ثابتة' } as const;
