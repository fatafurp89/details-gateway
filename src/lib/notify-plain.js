// «مركز الإشعارات» — طبقة التبسيط (pure): تحوّل الأحداث التقنية المعروفة إلى عربية مفهومة لغير المختصين:
//   title_ar (عنوان واضح) + body_ar (جملة واحدة تشرح ما حدث) + meta.means («ماذا يعني؟») + meta.todo («ما المطلوب؟»)
// والنص التقني الأصلي (أوامر، مسارات، أكواد) يُحفظ في meta.details ويظهر في «التفاصيل التقنية» لمن يملك notifications.technical.details فقط.
// idempotent: ما كان meta.plain = true لا يُعاد تبسيطه. المنطق لا يلمس إلا إشعارات التصنيف التقني (انظر applyPlain).
import { categorize } from './notify-categories.js';

export const MAX_DETAILS = 2000;

const SYSTEM_NAMES = {
  mail: 'البريد', wms: 'نظام ديتيلز', hr: 'الموارد البشرية', whatsapp: 'واتساب', bls: 'البحث في الأرشيف',
  files: 'الملفات', infra: 'البنية التقنية', company: 'بيانات المنشأة', notifications: 'مركز الإشعارات', settings: 'إعدادات النظام',
};
const SUBJECTS = { apps: 'سيرفر التطبيقات', bridge: 'سيرفر البوابة' };

/** نص يشبه سطر أوامر أو أثر خطأ برمجي (لا يُعرض لغير المختصين). */
export const SHELL_RE = /(^|[\s(])(sudo|pg_dump|pg_restore|rsync|scp|ssh|systemctl|journalctl|curl|wget|chmod|chown|apt(-get)?|docker|npm|node|bash|sh|cron|tar|df|du|psql)(\s|$)|\/(srv|var|etc|opt|usr|home|tmp|root)\/|line \d+:|\brc=\d+|exit (code|status)|Traceback|\bat\s+\S+\s+\(.*:\d+:\d+\)|\b(ECONN\w+|ENOENT|EACCES|ETIMEDOUT|EAI_AGAIN|ENOSPC)\b|\$\(|\$\{|\$[A-Za-z_]+|\b(ERROR|FATAL|Error):|\w+\.(log|sh|dump)\b|\s-{1,2}[a-zA-Z][\w-]*\s/i;
const AR_RE = /[؀-ۿ]/;
export const looksShell = (s) => SHELL_RE.test(String(s || ''));

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
/** عدد الأيام بصيغة عربية سليمة: يوم / يومان / 3 أيام / 11 يومًا. */
export const daysAr = (n) => { const x = Math.abs(Math.trunc(Number(n))); return x === 1 ? 'يوم' : x === 2 ? 'يومان' : x >= 3 && x <= 10 ? `${x} أيام` : `${x} يومًا`; };
const quoted = (s) => (/«([^»]{1,60})»/.exec(s) || [])[1] || null;
const lower = (s) => String(s || '').toLowerCase();

function ctxOf(n) {
  const meta = n.meta && typeof n.meta === 'object' ? n.meta : {};
  const title = String(n.title_ar || ''), body = String(n.body_ar || '');
  return {
    n, meta, title, body, kind: lower(n.kind), system: lower(n.system ?? n.system_key), ref: lower(n.source_ref),
    text: `${title} ${body} ${n.kind || ''} ${n.source_ref || ''}`,
    sysName: SYSTEM_NAMES[lower(n.system ?? n.system_key)] || null,
  };
}

const FAIL_RE = /(فشل|فشلت|تعذر|تعذّر|failed|failure|error|خطأ|لم (ي|ت)نجح|rc=[1-9]|exit code [1-9])/i;
const OK_RE = /(نجح|نجحت|ناجح|اكتمل|اكتملت|سليم|success|succeeded|completed|\bok\b)/i;
const DOWN_RE = /(لا يستجيب|لا تستجيب|متوقف|توقف|توقفت|انقطع|انقطعت|\bdown\b|unreachable|offline|لا يعمل|inactive|failed)/i;
const UP_RE = /(عاد|عادت|رجع|رجعت|استعاد|back (up|online)|recovered|restored|is up\b|يعمل الآن|يعمل من جديد)/i;

// ---------- القواعد (بالترتيب؛ أول قاعدة تنطبق تفوز) ----------
function backupSubject(c) {
  const by = (s) => (/التطبيقات|\bapps?\b/i.test(s) ? 'apps' : /البوابة|\bbridge\b/i.test(s) ? 'bridge' : null);
  return by(c.title) || by(`${c.kind} ${c.ref}`) || (c.system === 'mail' && /offsite/.test(c.kind) ? 'apps' : null) || by(c.body);
}
function backupCause(c) {
  if (/no space left|disk (is )?full|ENOSPC|لا توجد مساحة|امتلأ|مساحة (القرص|التخزين)/i.test(c.text)) return 'disk';
  if (/rsync|offsite|scp|نقل النسخ|ssh/i.test(c.text)) return 'transfer';
  if (/pg_dump|postgres|قاعدة (ال)?بيانات|\.dump/i.test(c.text)) return 'database';
  return 'other';
}

const RULES = [
  { id: 'backup.success', test: (c) => /backup|النسخ الاحتياطي|نسخة/i.test(c.text) && !FAIL_RE.test(c.text) && (OK_RE.test(c.text) || /summary|weekly|ملخص|أسبوعي/i.test(c.text)), build(c) {
      const cnt = (/(\d+)\s*(نسخ|نسخة|copies|backups?)/i.exec(c.text) || [])[1];
      return {
        title_ar: 'ملخص النسخ الاحتياطي الأسبوعي: كل شيء سليم',
        body_ar: `اكتملت النسخ الاحتياطية لهذا الأسبوع بنجاح${cnt ? ` (${cnt} نسخة)` : ''}.`,
        means: 'بيانات الشركة محفوظة في أكثر من مكان، فلو تعطل أحد السيرفرات يمكن استرجاعها.',
        todo: 'لا شيء مطلوب منك.',
      };
    } },
  { id: 'backup.failed', test: (c) => /backup|النسخ الاحتياطي|نسخة/i.test(c.text) && (FAIL_RE.test(c.text) || c.n.severity === 'urgent'), build(c) {
      const subj = SUBJECTS[backupSubject(c)] || 'أحد السيرفرات';
      const cause = backupCause(c);
      const base = { means: 'الأنظمة تعمل كالمعتاد، لكن آخر نسخة احتياطية سليمة أقدم من المعتاد؛ ولو تعطل شيء الآن قد تضيع بيانات هذه الفترة.', todo: 'أبلغ مسؤول الأنظمة ليراجع سجل النسخ الاحتياطي ويعيد تشغيله. لا يلزمك فعل شيء آخر.' };
      if (cause === 'disk') return { ...base, title_ar: `تعذّر النسخ الاحتياطي ل${subj}: المساحة ممتلئة`, body_ar: `لم تكتمل النسخة الاحتياطية ل${subj} لأن مساحة التخزين لا تكفي.`,
        means: 'لن تُحفظ نسخ جديدة حتى تتوفر مساحة، وقد تتوقف أنظمة أخرى إذا امتلأ القرص تمامًا.', todo: 'أبلغ مسؤول الأنظمة ليحذف النسخ القديمة أو يوسّع المساحة.' };
      if (cause === 'transfer') return { ...base, title_ar: `لم تُنقل النسخة الاحتياطية ل${subj} إلى مكان آمن آخر`, body_ar: `أُخذت نسخة من ${subj} لكن نقلها إلى السيرفر الثاني لم ينجح.`,
        means: 'النسخة موجودة على السيرفر نفسه فقط، فلو تعطل لن تبقى لدينا نسخة ثانية في مكان آخر.', todo: 'يفحص مسؤول الأنظمة الاتصال بين السيرفرين ويعيد النقل؛ غالبًا يُحل بسهولة.' };
      if (cause === 'database') return { ...base, title_ar: `تعذّر النسخ الاحتياطي الليلي ل${subj}`, body_ar: `لم يكتمل أخذ نسخة من قاعدة بيانات ${subj} الليلة الماضية.` };
      return { ...base, title_ar: `تعذّر النسخ الاحتياطي ل${subj}`, body_ar: `لم تكتمل النسخة الاحتياطية ل${subj}.` };
    } },
  { id: 'wireguard', test: (c) => /wireguard|\bwg\d*\b|النفق/i.test(c.text) && (DOWN_RE.test(c.text) || FAIL_RE.test(c.text) || UP_RE.test(c.text) || /handshake|stale/i.test(c.text)), build(c) {
      if (UP_RE.test(c.text) && !DOWN_RE.test(c.text)) return { title_ar: 'عاد النفق الآمن بين السيرفرات للعمل', body_ar: 'عاد الاتصال المشفّر بين سيرفرات ديتيلز بعد انقطاعه.', means: 'التكامل بين الأنظمة (البريد، الموارد البشرية، الشارات) عاد طبيعيًا.', todo: 'لا شيء مطلوب منك.' };
      return { title_ar: 'انقطع الاتصال الآمن بين سيرفرات ديتيلز', body_ar: 'توقف النفق المشفّر (WireGuard) الذي يربط السيرفرات ببعضها.',
        means: 'قد لا تعمل شارات البوابة أو التكامل بين الأنظمة (البريد والموارد البشرية) حتى يعود الاتصال.', todo: 'أبلغ مسؤول الأنظمة إن استمر الانقطاع أكثر من دقائق.' };
    } },
  { id: 'ai.key', test: (c) => /(deepseek|openai|anthropic|gemini|openrouter|مفتاح الذكاء|ai[ _-]?key|api[ _-]?key)/i.test(c.text) && /(invalid|unauthori[sz]ed|\b40[13]\b|incorrect|expired|revoked|غير صالح|منتهي|رُفض|رفض|quota|insufficient|balance|رصيد)/i.test(c.text), build(c) {
      const prov = (/(deepseek|openai|anthropic|gemini|openrouter)/i.exec(c.text) || [])[1];
      const provider = prov ? ({ deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', openrouter: 'OpenRouter' })[prov.toLowerCase()] : null;
      const quota = /(quota|insufficient|balance|رصيد)/i.test(c.text);
      return {
        title_ar: quota ? `رصيد مفتاح الذكاء الاصطناعي${provider ? ` (${provider})` : ''} انتهى` : `مفتاح الذكاء الاصطناعي${provider ? ` (${provider})` : ''} لم يعد يعمل`,
        body_ar: quota ? 'رفض مزوّد الذكاء الاصطناعي الطلبات لأن الرصيد غير كافٍ.' : 'رفض مزوّد الذكاء الاصطناعي المفتاح المحفوظ في البوابة.',
        means: 'ميزات الذكاء الاصطناعي في الأنظمة (مثل القراءة والتلخيص التلقائي) متوقفة مؤقتًا.',
        todo: quota ? 'اطلب من مسؤول الأنظمة شحن الرصيد أو إضافة مفتاح بديل.' : 'يستبدل مسؤول الأنظمة المفتاح من «إعدادات النظام ← مفاتيح الذكاء الاصطناعي».',
      };
    } },
  { id: 'whatsapp.token', test: (c) => /whatsapp|واتساب/i.test(c.text) && /(token|توكن|oauth|access|رمز (الوصول|الربط)|\b190\b|expire|منتهي|ينتهي|انتهت|invalid|غير صالح)/i.test(c.text), build(c) {
      const dead = /(invalid|غير صالح|انتهت|منتهي|expired|oauth|\b190\b)/i.test(c.text);
      if (!dead && /(ينتهي|expires?\b|will expire)/i.test(c.text)) {
        const d = (/(\d+)\s*(يوم|يومًا|أيام|days?)/i.exec(c.text) || [])[1];
        return { title_ar: 'رمز ربط واتساب سينتهي قريبًا', body_ar: `سينتهي رمز الربط مع واتساب${d ? ` خلال ${daysAr(d)}` : ' قريبًا'}.`,
          means: 'إن لم يُجدَّد ستتوقف رسائل واتساب (ومنها رموز الدخول عبر واتساب) عن الإرسال والاستقبال.', todo: 'يجدّد مسؤول الأنظمة الرمز من لوحة Meta قبل انتهائه.' };
      }
      return { title_ar: 'رمز ربط واتساب لم يعد صالحًا', body_ar: 'رفضت واتساب رمز الربط المحفوظ، فلا يمكن إرسال أو استقبال الرسائل حاليًا.',
        means: 'رسائل واتساب ورموز الدخول عبر واتساب متوقفة حتى يُستبدل الرمز.', todo: 'يجدّد مسؤول الأنظمة الرمز من لوحة Meta ويحفظه في الإعدادات.' };
    } },
  { id: 'mail.send', test: (c) => (c.system === 'mail' || /smtp|mail|بريد|إيميل/i.test(`${c.kind} ${c.title}`)) && !/backup|النسخ/i.test(c.text) && /(فشل|تعذر|تعذّر|failed|error|bounce|rejected|refused|\b535\b|\b550\b|auth)/i.test(c.text), build(c) {
      const auth = /(\b535\b|auth|password|login|كلمة المرور)/i.test(c.text);
      return { title_ar: 'تعذّر إرسال رسائل من خدمة البريد', body_ar: auth ? 'رفض خادم البريد بيانات الدخول، فلم تُرسل الرسالة.' : 'حاولت خدمة البريد إرسال رسالة ولم تنجح.',
        means: 'قد لا تصل بعض الرسائل أو رموز التحقق أو الإشعارات البريدية إلى أصحابها.', todo: auth ? 'يحدّث مسؤول الأنظمة كلمة مرور البريد في الإعدادات.' : 'أبلغ مسؤول الأنظمة ليفحص اتصال خدمة البريد.' };
    } },
  { id: 'cert', test: (c) => /(ssl|tls|https|certbot|let'?s ?encrypt|certificate|شهادة (ssl|tls|الأمان|الموقع|التشفير))/i.test(c.text) && /(expir|ينتهي|انتهت|منتهية|renew|تجديد)/i.test(c.text), build(c) {
      const domain = (/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i.exec(c.text) || [])[1];
      const d = (/(\d+)\s*(day|days|يوم|يومًا|أيام)/i.exec(c.text) || [])[1];
      const expired = /(انتهت|منتهية|expired)/i.test(c.text);
      const who = domain ? `«${domain}»` : 'الموقع';
      return { title_ar: expired ? `انتهت شهادة أمان ${who}` : `شهادة أمان ${who} ستنتهي قريبًا`, body_ar: expired ? 'انتهت صلاحية شهادة التشفير (HTTPS) الخاصة بالموقع.' : `ستنتهي شهادة التشفير (HTTPS) الخاصة بالموقع${d ? ` خلال ${daysAr(d)}` : ''}.`,
        means: 'عند انتهائها يعرض المتصفح تحذيرًا أحمر للمستخدمين وقد لا يتمكنون من الدخول.', todo: 'يجدّدها مسؤول الأنظمة؛ وغالبًا يكفي فحص التجديد التلقائي.' };
    } },
  { id: 'disk', test: (c) => /(disk|القرص|مساحة التخزين|df\b|storage|inode)/i.test(c.text) && /(full|امتل|almost|%|ممتلئ|usage|استخدام|low space|لا تكفي)/i.test(c.text), build(c) {
      const pct = (/(\d{2,3})\s*%/.exec(c.text) || [])[1];
      const where = quoted(c.title) || quoted(c.body) || c.meta.node || c.meta.host || null;
      return { title_ar: `مساحة التخزين تكاد تمتلئ${where ? ` في «${clip(where, 40)}»` : ''}`, body_ar: `وصل استخدام القرص${pct ? ` إلى ${pct}%` : ' إلى حد مرتفع'}${where ? ` في «${clip(where, 40)}»` : ''}.`,
        means: 'لو امتلأ القرص قد تتوقف الأنظمة عن حفظ البيانات أو أخذ النسخ الاحتياطية.', todo: 'أبلغ مسؤول الأنظمة ليحذف الملفات القديمة أو يوسّع المساحة.' };
    } },
  { id: 'service', test: (c) => /(service|خدمة|systemd|systemctl|\.service)/i.test(c.text) && (DOWN_RE.test(c.text) || UP_RE.test(c.text)), build(c) {
      const name = c.meta.service || (/([\w@.-]+)\.service/i.exec(c.text) || [])[1] || quoted(c.title) || quoted(c.body);
      const who = name ? ` «${clip(name, 40)}»` : '';
      if (UP_RE.test(c.text) && !/(توقف|متوقف|down|failed)/i.test(c.text)) return { title_ar: who ? `عادت خدمة${who} للعمل` : 'عادت إحدى الخدمات للعمل', body_ar: 'عادت الخدمة للعمل بشكل طبيعي.', means: 'تم الإصلاح ولا تأثير بعد الآن.', todo: 'لا شيء مطلوب منك.' };
      return { title_ar: who ? `خدمة${who} توقفت` : 'توقفت إحدى الخدمات', body_ar: 'توقفت إحدى الخدمات التي يعتمد عليها النظام عن العمل.',
        means: 'قد لا تعمل الميزة المرتبطة بها حتى تعود الخدمة.', todo: 'أبلغ مسؤول الأنظمة ليعيد تشغيلها ويفحص سبب التوقف.' };
    } },
  { id: 'node', test: (c) => /(الجهاز|السيرفر|الخادم|node|server|host|الوكيل|agent|ping)/i.test(c.text) && (DOWN_RE.test(c.text) || UP_RE.test(c.text)) && (/infra|node|server|agent|health|monitor/.test(`${c.kind} ${c.system}`) || /(الجهاز|السيرفر|الخادم)/.test(c.text)), build(c) {
      const name = quoted(c.title) || quoted(c.body) || c.meta.node || c.meta.name || (/(?:الجهاز|السيرفر|الخادم|node)\s+([^\s«»—:،,]+)/i.exec(c.text) || [])[1] || null;
      const who = name ? ` «${clip(name, 40)}»` : '';
      if (UP_RE.test(c.text) && !/(لا يستجيب|متوقف|\bdown\b|offline)/i.test(c.text)) return { title_ar: `عاد الجهاز${who} للعمل`, body_ar: 'استجاب الجهاز لفحص المراقبة من جديد.', means: 'عاد كل شيء طبيعيًا ولا تأثير بعد الآن.', todo: 'لا شيء مطلوب منك.' };
      return { title_ar: `الجهاز${who} لا يستجيب`, body_ar: 'توقف الجهاز عن الرد على فحص المراقبة.',
        means: 'الأنظمة التي تعتمد عليه قد تعمل ببطء أو تتوقف حتى يعود.', todo: 'أبلغ مسؤول الأنظمة إن استمر الانقطاع أكثر من بضع دقائق.' };
    } },
  { id: 'security', test: (c) => /(login[ _-]?blocked|blocked|حظر|أُوقفت|brute|failed (login|password)|محاولات (دخول|تسجيل)|suspicious|مشبوه|fail2ban|unauthori[sz]ed|اختراق)/i.test(c.text), build() {
      return { title_ar: 'أوقف النظام محاولات دخول مشبوهة', body_ar: 'رصدت البوابة محاولات دخول غير معتادة وأوقفتها مؤقتًا لحماية الحسابات.',
        means: 'الحماية عملت تلقائيًا ولا تأثير على عملك، لكن قد تكون هناك محاولة للوصول إلى حساب غير مصرّح به.', todo: 'راجع سجل التدقيق في لوحة الإدارة؛ وإن تكررت المحاولات على حساب موظف فأبلغ مسؤول الأنظمة.' };
    } },
];

/** لا قاعدة معروفة: ننزع نصوص الأوامر والأخطاء ونُبقي الجمل العربية السليمة فقط. */
function fallback(c) {
  const clean = (s) => String(s || '').split(/\s+[—–]\s+|\n+/).map((p) => p.trim()).filter((p) => p && AR_RE.test(p) && !looksShell(p));
  const title = clean(c.title)[0] || (c.sysName ? `حدثت مشكلة تقنية في «${c.sysName}»` : 'حدثت مشكلة تقنية في أحد الأنظمة');
  const body = clean(c.body).join(' — ');
  return {
    title_ar: clip(title, 160),
    body_ar: body ? clip(body, 240) : 'رصد النظام مشكلة تقنية وسُجّلت تفاصيلها لمسؤول الأنظمة.',
    means: 'قد لا تعمل إحدى الميزات كالمعتاد حتى تُراجَع المشكلة.',
    todo: 'أبلغ مسؤول الأنظمة؛ لا يلزمك فعل شيء آخر.',
  };
}

/** يعيد { rule, title_ar, body_ar, means, todo } — لا يقرأ meta.plain ولا التصنيف. */
export function translate(n) {
  const c = ctxOf(n);
  for (const r of RULES) if (r.test(c)) return { rule: r.id, ...r.build(c) };
  return { rule: 'fallback', ...fallback(c) };
}

/**
 * يُطبّق التبسيط على إشعار تقني ويُرجع نسخة جديدة {…n, category, title_ar, body_ar, meta}؛
 * غير التقني أو المبسَّط سابقًا يعود كما هو (مع category). النص الأصلي يُحفظ في meta.details (مقتطع إلى 2000 حرف).
 */
export function applyPlain(n) {
  const category = n.category || categorize(n);
  if (category !== 'technical') return { ...n, category };
  const meta = n.meta && typeof n.meta === 'object' && !Array.isArray(n.meta) ? n.meta : {};
  if (meta.plain === true) return { ...n, category };
  const t = translate({ ...n, meta });
  const parts = [meta.details, n.title_ar, n.body_ar].map((x) => String(x || '').trim()).filter(Boolean);
  const details = [...new Set(parts)].join('\n').slice(0, MAX_DETAILS);
  return {
    ...n, category, title_ar: t.title_ar, body_ar: t.body_ar,
    meta: { ...meta, plain: true, plain_rule: t.rule, means: t.means, todo: t.todo, ...(details ? { details } : {}) },
  };
}
