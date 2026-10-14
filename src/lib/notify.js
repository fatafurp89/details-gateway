// «مركز الإشعارات» (pure): validation of /_gw/notify payloads, category access (work/technical), day grouping (اليوم/أمس/أقدم)
import { SYSTEM_RE } from './perms.js';
import { CATEGORIES, categorize, normalizeCategory } from './notify-categories.js';

export const SEVERITIES = ['info', 'warn', 'urgent'];
export const SEVERITY_AR = { info: 'معلومة', warn: 'تنبيه', urgent: 'عاجل' };
export const MAX_TARGETS = 2000;
export const MAX_LIMIT = 200;
const NO_RE = /^\d{4}$/;
const URL_RE = /^(https:\/\/[^\s]{1,2000}|\/(?![\/\\])[^\s]{0,2000})$/i; // https… or our own path

const str = (v, max) => (v === undefined || v === null ? '' : String(v).trim()).slice(0, max);
const opt = (v, max) => { const s = str(v, max); return s || null; };

/**
 * Validate a notification from a source system:
 * { system, employee_no? | employee_nos? | all?, kind?, title_ar, body_ar?, url?, severity?, source_ref?, meta?, category? ('work'|'technical') }
 * `category` omitted -> inferred by src/lib/notify-categories.js (unknown = work).
 * Returns { value } (targets = { all: true } or { employee_nos: [...] }) or { error } in Arabic.
 */
export function validateNotify(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const system = str(body.system, 40).toLowerCase();
  if (!SYSTEM_RE.test(system)) return { error: 'مفتاح النظام غير صالح' };
  const title_ar = str(body.title_ar, 200);
  if (!title_ar) return { error: 'عنوان الإشعار مطلوب' };
  const severity = str(body.severity, 10) || 'info';
  if (!SEVERITIES.includes(severity)) return { error: 'درجة الأهمية غير صالحة (info / warn / urgent)' };
  const rawCat = str(body.category, 12).toLowerCase();
  if (rawCat && !normalizeCategory(rawCat)) return { error: 'التصنيف غير صالح (work / technical)' };
  const url = opt(body.url, 2000);
  if (url !== null && !URL_RE.test(url)) return { error: 'الرابط غير صالح (https أو مسار داخلي)' };
  let targets;
  if (body.all === true) targets = { all: true };
  else {
    const list = Array.isArray(body.employee_nos) ? body.employee_nos : (body.employee_no !== undefined ? [body.employee_no] : []);
    if (!list.length) return { error: 'حدد الموظف (employee_no أو employee_nos) أو all: true' };
    if (list.length > MAX_TARGETS) return { error: `عدد المستهدفين يتجاوز الحد (${MAX_TARGETS})` };
    const nos = [...new Set(list.map((n) => str(n, 8)))];
    const bad = nos.find((n) => !NO_RE.test(n));
    if (bad !== undefined) return { error: `الرقم الوظيفي «${bad}» غير صالح` };
    targets = { employee_nos: nos };
  }
  const meta = body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta) ? body.meta : {};
  if (JSON.stringify(meta).length > 4000) return { error: 'البيانات الإضافية (meta) كبيرة جدًا' };
  const value = { system, kind: str(body.kind, 40) || 'info', title_ar, body_ar: str(body.body_ar, 2000), url, severity, source_ref: opt(body.source_ref, 200), meta, targets };
  value.category = normalizeCategory(rawCat) || categorize(value);
  return { value };
}

/** { system, source_ref, employee_no? } for POST /_gw/notify/read */
export function validateNotifyRead(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const system = str(body.system, 40).toLowerCase();
  if (!SYSTEM_RE.test(system)) return { error: 'مفتاح النظام غير صالح' };
  const source_ref = str(body.source_ref, 200);
  if (!source_ref) return { error: 'مرجع الإشعار (source_ref) مطلوب' };
  const employee_no = opt(body.employee_no, 8);
  if (employee_no !== null && !NO_RE.test(employee_no)) return { error: 'الرقم الوظيفي غير صالح' };
  return { value: { system, source_ref, employee_no } };
}

/** Clamp ?limit= to 1..MAX_LIMIT (default 50). */
export function clampLimit(v, def = 50) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : def;
}

/** 'today' | 'yesterday' | 'older' in the Riyadh calendar day. */
export function dayBucket(at, now = new Date(), tz = 'Asia/Riyadh') {
  const d = new Date(at);
  if (Number.isNaN(+d)) return 'older';
  const key = (x) => x.toLocaleDateString('en-CA', { timeZone: tz });
  const today = key(now);
  if (key(d) === today) return 'today';
  if (key(d) === key(new Date(+now - 86_400_000))) return 'yesterday';
  return 'older';
}
export const DAY_AR = { today: 'اليوم', yesterday: 'أمس', older: 'أقدم' };

/** Group a list (newest first) into [{ bucket, label_ar, items }] keeping the today/yesterday/older order. */
export function groupByDay(list, now = new Date()) {
  const groups = new Map([['today', []], ['yesterday', []], ['older', []]]);
  for (const n of list) groups.get(dayBucket(n.created_at, now)).push(n);
  return [...groups].filter(([, items]) => items.length).map(([bucket, items]) => ({ bucket, label_ar: DAY_AR[bucket], items }));
}

// ---- الصلاحيات: notifications.work / notifications.technical / notifications.technical.details (ترحيل 0018) ----
export const PERM_WORK = 'notifications.work';
export const PERM_TECHNICAL = 'notifications.technical';
export const PERM_DETAILS = 'notifications.technical.details';
export const PERM_KEYS = [PERM_WORK, PERM_TECHNICAL, PERM_DETAILS];

/**
 * { work, technical, details } للموظف. المشرف العام المطلق (role = admin) يرى كل شيء؛ غيره يحتاج المنح الصريح،
 * و«التفاصيل التقنية» لا تُفتح بلا «التقنية».
 */
export function notifAccess(role, grantedKeys = []) {
  if (role === 'admin') return { work: true, technical: true, details: true };
  const g = new Set(grantedKeys);
  const technical = g.has(PERM_TECHNICAL);
  return { work: g.has(PERM_WORK), technical, details: technical && g.has(PERM_DETAILS) };
}
/** التصنيفات المسموحة للموظف بالترتيب (الأعمال أولًا). */
export const accessCategories = (access) => CATEGORIES.filter((c) => access[c]);
/** ?category= المطلوب: null = كل المسموح؛ مصفوفة = المسموح منه؛ false = التصنيف المطلوب غير مسموح/غير صالح. */
export function pickCategories(access, wanted) {
  const allowed = accessCategories(access);
  if (wanted === undefined || wanted === null || wanted === '') return allowed;
  const c = normalizeCategory(wanted);
  return c && allowed.includes(c) ? [c] : false;
}
/** هل يظهر النص التقني الأصلي (meta.details) لهذا الموظف؟ */
export const canSeeDetails = (access) => !!access.details;
/**
 * يجهّز صف إشعار للإرجاع. الإشعار التقني لا يحمل من meta إلا means/todo (النص المبسّط)، و«التفاصيل التقنية» الأصلية
 * تخرج في حقل details لمن يملك notifications.technical.details فقط (لا تصل لغيره حتى داخل meta).
 */
export function shapeNotification(row, access) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  if (row.category !== 'technical') return { ...row, meta };
  const out = { ...row, meta: { means: typeof meta.means === 'string' ? meta.means : undefined, todo: typeof meta.todo === 'string' ? meta.todo : undefined } };
  if (access.details && meta.details) out.details = String(meta.details);
  return out;
}
