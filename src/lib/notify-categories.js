// «مركز الإشعارات»: تصنيف الإشعار إلى «الأعمال» (work) أو «التقنية» (technical) — دالة نقية موثّقة في SPEC.md.
// الأنظمة الأخرى (الموارد البشرية، سكربتات النسخ الاحتياطي، واتساب…) تستطيع تمرير `category` صراحةً؛
// وإلا يُستنتج من هذا الجدول بالترتيب: category الصريح ← نظام تقني ← kind ← source_ref ← نظام للأعمال ← كلمات دالة ← الافتراضي work.

export const CATEGORIES = ['work', 'technical'];
export const CATEGORY_AR = { work: 'الأعمال', technical: 'التقنية' };
export const DEFAULT_CATEGORY = 'work';

/** أنظمة إشعاراتها «أعمال» دائمًا ما لم يُمرَّر category صراحةً أو يدلّ kind على خلل تقني. */
export const WORK_SYSTEMS = ['company', 'hr', 'files', 'bls', 'notifications'];

/** أنظمة إشعاراتها «تقنية» دائمًا (ما لم يُمرَّر category صراحةً). */
export const TECHNICAL_SYSTEMS = ['infra', 'agent', 'system', 'monitor', 'backup'];

/** بادئات kind التقنية (kind يساوي البادئة أو يبدأ بها يليها . أو - أو _ أو :). */
export const TECHNICAL_KIND_PREFIXES = [
  'backup', 'infra', 'system', 'agent', 'security', 'service', 'disk', 'cert', 'ssl', 'tls', 'tunnel', 'wireguard', 'wg',
  'node', 'server', 'deploy', 'cron', 'job', 'monitor', 'health', 'login-blocked', 'blocked',
  'smtp', 'mail-send', 'mail-error', 'mail-service', 'mail-failed', 'send-failed',
  'whatsapp-token', 'whatsapp-error', 'whatsapp-webhook', 'token', 'webhook', 'ai-key', 'api-key',
];

/** بادئات source_ref التقنية (مثل backup-2026-10-14T06:34:13Z). */
export const TECHNICAL_REF_PREFIXES = ['backup-', 'infra:', 'node:', 'disk:', 'cert:', 'service:', 'tunnel:', 'security:', 'agent:'];

/** كلمات دالة (آخر ملاذ حين يكون kind عامًّا مثل info) — تُطبَّق على العنوان والنص. */
export const TECHNICAL_KEYWORDS = /(النسخ الاحتياطي|pg_dump|rsync|wireguard|systemctl|journalctl|مساحة القرص|امتلاء القرص|شهادة\s*(ssl|tls)|ssl certificate|مفتاح الذكاء الاصطناعي|api[ -]?key|توكن|access[ _-]?token|smtp|الوكيل (الفني|التقني))/i;

const matchesPrefix = (value, prefixes) => {
  const v = String(value || '').toLowerCase();
  return prefixes.some((p) => v === p || v.startsWith(p + '.') || v.startsWith(p + '-') || v.startsWith(p + '_') || v.startsWith(p + ':'));
};

/** 'work' | 'technical' | null — null إن لم يكن الإدخال تصنيفًا صالحًا. */
export function normalizeCategory(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return CATEGORIES.includes(s) ? s : null;
}

/**
 * التصنيف الافتراضي لإشعار `{ system, kind, source_ref, title_ar, body_ar, category? }`.
 * الجهل = work (الأهم دائمًا؛ لا نُخفي إشعار عمل خطأً داخل التبويب التقني).
 */
export function categorize(n = {}) {
  const explicit = normalizeCategory(n.category);
  if (explicit) return explicit;
  const system = String(n.system ?? n.system_key ?? '').toLowerCase();
  const kind = String(n.kind || '').toLowerCase();
  const ref = String(n.source_ref || '').toLowerCase();
  if (TECHNICAL_SYSTEMS.includes(system)) return 'technical';
  if (matchesPrefix(kind, TECHNICAL_KIND_PREFIXES)) return 'technical';
  if (TECHNICAL_REF_PREFIXES.some((p) => ref.startsWith(p))) return 'technical';
  if (WORK_SYSTEMS.includes(system)) return 'work';
  if ((kind === 'info' || kind === '') && TECHNICAL_KEYWORDS.test(`${n.title_ar || ''} ${n.body_ar || ''}`)) return 'technical';
  return DEFAULT_CATEGORY;
}
