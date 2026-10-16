// «بيانات المنشأة» (pure): validation of profile/owners/platforms/delegations/documents, expiry alerts, share total, id masking
import { daysUntil } from './infra.js';

export const EXPIRY_WARN_DAYS = 30;
export const OWNER_ROLES = ['owner', 'partner', 'manager'];
export const OWNER_ROLE_AR = { owner: 'مالك', partner: 'شريك', manager: 'مدير' };
export const ENTITY_KINDS = ['person', 'entity'];
export const PLATFORM_CATEGORIES = ['government', 'bank', 'private', 'utility'];
export const PLATFORM_CATEGORY_AR = { government: 'حكومية', bank: 'بنكية', private: 'خاصة', utility: 'خدمات' };
export const PLATFORM_STATUSES = ['active', 'suspended', 'closed'];
export const PLATFORM_STATUS_AR = { active: 'نشطة', suspended: 'موقوفة', closed: 'مغلقة' };
export const DELEGATION_STATUSES = ['active', 'revoked', 'expired'];
export const DELEGATION_STATUS_AR = { active: 'ساري', revoked: 'ملغى', expired: 'منتهٍ' };
export const DOCUMENT_KINDS = ['cr', 'license', 'tax', 'contract', 'lease', 'national_address', 'certificate', 'invoice', 'bank', 'other', 'incorporation', 'good_standing', 'apostille', 'resolution', 'articles'];
export const DOCUMENT_KIND_AR = { cr: 'سجل تجاري', license: 'رخصة', tax: 'ضريبي', contract: 'عقد', lease: 'عقد إيجار', national_address: 'عنوان وطني', certificate: 'شهادة', invoice: 'فاتورة', bank: 'بنكي', other: 'أخرى',
  incorporation: 'شهادة تأسيس / تسجيل', good_standing: 'حسن سير وسلوك', apostille: 'تصديق / أبوستيل', resolution: 'قرار مجلس / شركاء', articles: 'عقد تأسيس / نظام أساس' };
export const BANK_STATUSES = ['active', 'frozen', 'closed'];
export const BANK_STATUS_AR = { active: 'نشط', frozen: 'مجمّد', closed: 'مغلق' };
export const PROFILE_TEXT = ['legal_name_ar', 'legal_name_en', 'trade_name_ar', 'trade_name_en', 'cr_number', 'cr_type', 'cr_copy_no', 'cr_status', 'tax_number', 'legal_form',
  'activity_code', 'activity_ar', 'engineering_license_no', 'chamber_no', 'city', 'district', 'street', 'phone', 'email', 'website', 'logo_url'];
export const PROFILE_DATES = ['cr_issued_on', 'cr_expiry', 'license_expiry', 'established_on'];
export const ADDRESS_FIELDS = ['account_no', 'registration_date', 'proof_no', 'issued_on', 'expires_on', 'short_address', 'building', 'street_ar', 'street_en',
  'secondary_no', 'district_ar', 'district_en', 'postal_code', 'city_ar', 'city_en', 'country_ar', 'country_en', 'verify_url'];

const str = (v, max) => (v === undefined || v === null ? '' : String(v).trim()).slice(0, max);
const opt = (v, max) => { const s = str(v, max); return s || null; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const UUID_RE = /^[0-9a-f-]{36}$/;
const URL_RE = /^https?:\/\/[^\s]{1,2000}$/i;
const DOT = '•';

/** Keep only the last 4 characters: 1234567890 -> ••••••7890 (empty stays empty). */
export function maskId(id) {
  const s = str(id, 40);
  if (!s) return '';
  if (s.length <= 4) return DOT.repeat(s.length);
  return DOT.repeat(Math.min(s.length - 4, 8)) + s.slice(-4);
}

/** Owners seen by a non-admin: id numbers masked. */
export function maskOwners(owners, admin) {
  return owners.map((o) => (admin ? o : { ...o, id_number: maskId(o.id_number) }));
}

/** Bank accounts seen by a non-admin: IBAN / account / customer numbers masked (last 4 kept). */
export function maskBankAccounts(accounts, admin) {
  return accounts.map((a) => (admin ? a : { ...a, iban: maskId(a.iban), account_no: maskId(a.account_no), customer_no: maskId(a.customer_no) }));
}

/** 'expired' | 'expiring' | 'ok' | 'unlimited' | null (no date). */
export function expiryState(date, now = new Date(), warnDays = EXPIRY_WARN_DAYS, isUnlimited = false) {
  if (isUnlimited) return 'unlimited';
  const d = daysUntil(date, now);
  if (d === null) return null;
  if (d < 0) return 'expired';
  if (d <= warnDays) return 'expiring';
  return 'ok';
}

const dateOpt = (v, label) => {
  const d = opt(v, 10);
  if (d !== null && !isDate(d)) return { error: `${label} غير صالح (YYYY-MM-DD)` };
  return { value: d };
};

/**
 * One alert per document / platform / delegation that is expired or expires within `warnDays`.
 * items: { documents:[{id,title_ar,expires_on,is_unlimited}], platforms:[{id,name_ar,expiry_date,account_holder_id}], delegations:[{id,delegate_name,valid_to,employee_id,status}] }
 * Returns [{ kind, id, title_ar, expires_on, days_left, state, severity, url, employee_id }] sorted soonest first.
 */
export function expiryAlerts(items, now = new Date(), warnDays = EXPIRY_WARN_DAYS) {
  const out = [];
  const push = (kind, id, title_ar, date, employee_id, tab) => {
    const state = expiryState(date, now, warnDays);
    if (state !== 'expired' && state !== 'expiring') return;
    const days_left = daysUntil(date, now);
    out.push({ kind, id, title_ar, expires_on: String(date).slice(0, 10), days_left, state, severity: state === 'expired' || days_left <= 7 ? 'urgent' : 'warn',
      url: `/company#${tab}`, employee_id: employee_id || null });
  };
  for (const d of items.documents || []) {
    if (d.is_unlimited) continue;
    push('document', d.id, d.title_ar, d.expires_on, null, 'documents');
  }
  for (const p of items.platforms || []) if (p.status !== 'closed') push('platform', p.id, p.name_ar, p.expiry_date, p.account_holder_id, 'platforms');
  for (const g of items.delegations || []) if (g.status === 'active') push('delegation', g.id, g.delegate_name, g.valid_to, g.employee_id, 'delegations');
  return out.sort((a, b) => a.days_left - b.days_left || a.title_ar.localeCompare(b.title_ar, 'ar'));
}

const KIND_AR = { document: 'المستند', platform: 'حساب منصة', delegation: 'التفويض' };
/** Arabic day phrase: 'منذ 3 أيام' / 'اليوم' / 'خلال 5 أيام'. */
export function daysPhrase(days) {
  const n = Math.abs(days);
  const unit = n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : n <= 10 ? `${n} أيام` : `${n} يومًا`;
  if (days === 0) return 'اليوم';
  return days < 0 ? `منذ ${unit}` : `خلال ${unit}`;
}

/** Turn alerts into notification rows (title/body/source_ref); idempotent per (kind, id, state). */
export function alertNotifications(alerts) {
  return alerts.map((a) => ({
    source_ref: `${a.kind}:${a.id}:${a.state}`, kind: `expiry.${a.state}`, severity: a.severity, url: a.url, employee_id: a.employee_id,
    title_ar: a.state === 'expired' ? `انتهت صلاحية ${KIND_AR[a.kind]} «${a.title_ar}»` : `${KIND_AR[a.kind]} «${a.title_ar}» ينتهي ${daysPhrase(a.days_left)}`,
    body_ar: `تاريخ الانتهاء ${a.expires_on}${a.state === 'expired' ? ` (${daysPhrase(a.days_left)})` : ''}. راجع «بيانات المنشأة» لتجديده أو تحديث التاريخ.`,
    meta: { kind: a.kind, id: a.id, state: a.state, expires_on: a.expires_on, days_left: a.days_left },
  }));
}

/** Sum of share_pct (NULL ignored); { ok, total, error? } — total may not exceed 100. */
export function validateShares(owners) {
  let total = 0;
  for (const o of owners) {
    if (o.share_pct === null || o.share_pct === undefined || o.share_pct === '') continue;
    const n = Number(o.share_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, total, error: 'نسبة الملكية يجب أن تكون بين 0 و100' };
    total = Math.round((total + n) * 100) / 100;
  }
  if (total > 100) return { ok: false, total, error: `مجموع نسب الملكية (${total}٪) يتجاوز 100٪` };
  return { ok: true, total };
}

export function validateProfile(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = {};
  for (const k of PROFILE_TEXT) if (body[k] !== undefined) v[k] = k.startsWith('legal_name') || k.startsWith('trade_name') ? str(body[k], 200) : opt(body[k], 300);
  if (v.legal_name_ar === '') return { error: 'الاسم القانوني العربي مطلوب' };
  if (v.email !== undefined && v.email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return { error: 'البريد الإلكتروني غير صالح' };
  if (v.logo_url !== undefined && v.logo_url !== null && !/^(https:\/\/|\/)/.test(v.logo_url)) return { error: 'رابط الشعار غير صالح' };
  for (const k of PROFILE_DATES) if (body[k] !== undefined) { const r = dateOpt(body[k], 'التاريخ'); if (r.error) return r; v[k] = r.value; }
  if (body.capital !== undefined) {
    const c = body.capital === null || body.capital === '' ? null : Number(String(body.capital).replace(/,/g, ''));
    if (c !== null && (!Number.isFinite(c) || c < 0)) return { error: 'رأس المال غير صالح' };
    v.capital = c;
  }
  if (body.notes !== undefined) v.notes = opt(body.notes, 4000);
  if (body.national_address !== undefined) {
    const a = body.national_address && typeof body.national_address === 'object' && !Array.isArray(body.national_address) ? body.national_address : {};
    const na = {};
    for (const k of ADDRESS_FIELDS) { const s = str(a[k], 300); if (s) na[k] = s; }
    for (const k of ['registration_date', 'issued_on', 'expires_on']) if (na[k] && !isDate(na[k])) return { error: 'تاريخ في العنوان الوطني غير صالح (YYYY-MM-DD)' };
    if (na.verify_url && !URL_RE.test(na.verify_url)) return { error: 'رابط التحقق من العنوان غير صالح' };
    v.national_address = na;
  }
  if (!Object.keys(v).length) return { error: 'لا توجد حقول للتحديث' };
  return { value: v };
}

export function validateOwner(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = { name_ar: str(body.name_ar, 200), name_en: str(body.name_en, 200), entity_kind: str(body.entity_kind, 10) || 'person', id_number: opt(body.id_number, 40),
    nationality: opt(body.nationality, 80), role: str(body.role, 10) || 'owner', notes: opt(body.notes, 2000), sort: Number.isFinite(+body.sort) ? Math.trunc(+body.sort) : 100 };
  if (!v.name_ar) return { error: 'الاسم مطلوب' };
  if (!ENTITY_KINDS.includes(v.entity_kind)) return { error: 'نوع المالك غير صالح' };
  if (!OWNER_ROLES.includes(v.role)) return { error: 'الدور غير صالح (مالك / شريك / مدير)' };
  if (body.share_pct === undefined || body.share_pct === null || body.share_pct === '') v.share_pct = null;
  else { const n = Number(body.share_pct); if (!Number.isFinite(n) || n < 0 || n > 100) return { error: 'نسبة الملكية يجب أن تكون بين 0 و100' }; v.share_pct = Math.round(n * 100) / 100; }
  const s = dateOpt(body.since, 'تاريخ البداية'); if (s.error) return s; v.since = s.value;
  return { value: v };
}

export function validatePlatform(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = { name_ar: str(body.name_ar, 200), category: str(body.category, 12) || 'government', url: opt(body.url, 2000), account_username: opt(body.account_username, 200),
    role_ar: opt(body.role_ar, 200), status: str(body.status, 12) || 'active', notes: opt(body.notes, 2000), secret_node_key: opt(body.secret_node_key, 60), secret_ref: opt(body.secret_ref, 200),
    sort: Number.isFinite(+body.sort) ? Math.trunc(+body.sort) : 100 };
  if (!v.name_ar) return { error: 'اسم المنصة مطلوب' };
  if (!PLATFORM_CATEGORIES.includes(v.category)) return { error: 'تصنيف المنصة غير صالح' };
  if (!PLATFORM_STATUSES.includes(v.status)) return { error: 'حالة المنصة غير صالحة' };
  if (v.url !== null && !URL_RE.test(v.url)) return { error: 'رابط المنصة غير صالح' };
  if (v.secret_node_key !== null && !/^[a-z0-9_-]{2,60}$/.test(v.secret_node_key)) return { error: 'مفتاح عقدة الأسرار غير صالح' };
  for (const k of ['account_holder_id', 'quick_link_id']) { const id = opt(body[k], 36); if (id !== null && !UUID_RE.test(id)) return { error: 'المعرّف غير صالح' }; v[k] = id; }
  const d = dateOpt(body.expiry_date, 'تاريخ الانتهاء'); if (d.error) return d; v.expiry_date = d.value;
  return { value: v };
}

export function validateDelegation(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = { delegate_name: str(body.delegate_name, 200), scope_ar: str(body.scope_ar, 1000), document_url: opt(body.document_url, 2000), status: str(body.status, 10) || 'active', notes: opt(body.notes, 2000) };
  if (!v.delegate_name) return { error: 'اسم المفوَّض مطلوب' };
  if (!DELEGATION_STATUSES.includes(v.status)) return { error: 'حالة التفويض غير صالحة' };
  if (v.document_url !== null && !URL_RE.test(v.document_url)) return { error: 'رابط مستند التفويض غير صالح' };
  for (const k of ['employee_id', 'platform_id']) { const id = opt(body[k], 36); if (id !== null && !UUID_RE.test(id)) return { error: 'المعرّف غير صالح' }; v[k] = id; }
  const f = dateOpt(body.valid_from, 'تاريخ البداية'); if (f.error) return f; v.valid_from = f.value;
  const t = dateOpt(body.valid_to, 'تاريخ النهاية'); if (t.error) return t; v.valid_to = t.value;
  if (v.valid_from && v.valid_to && v.valid_to < v.valid_from) return { error: 'تاريخ النهاية قبل تاريخ البداية' };
  return { value: v };
}

export function validateDocument(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = { title_ar: str(body.title_ar, 200), kind: str(body.kind, 20) || 'other', doc_number: opt(body.doc_number, 120), issuer_ar: opt(body.issuer_ar, 200),
    admin_only: body.admin_only === true || body.admin_only === 'true',
    is_unlimited: body.is_unlimited === true || body.is_unlimited === 'true',
    notes: opt(body.notes, 2000), sort: Number.isFinite(+body.sort) ? Math.trunc(+body.sort) : 100 };
  // entity_id: undefined = not provided (keep / default to the main entity), null = explicitly unassigned
  if (body.entity_id !== undefined) { const id = opt(body.entity_id, 36); if (id !== null && !UUID_RE.test(id)) return { error: 'المعرّف غير صالح' }; v.entity_id = id; }
  if (!v.title_ar) return { error: 'عنوان المستند مطلوب' };
  if (!DOCUMENT_KINDS.includes(v.kind)) return { error: 'نوع المستند غير صالح' };
  return { value: v };
}

/** A document version: file_url (optional until uploads exist), file_name, issued_on, expires_on, notes, is_unlimited. */
export function validateVersion(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = { file_url: opt(body.file_url, 2000), file_name: opt(body.file_name, 300), notes: opt(body.notes, 2000),
    is_unlimited: body.is_unlimited === true || body.is_unlimited === 'true' };
  if (v.file_url !== null && !/^(https:\/\/|\/)/.test(v.file_url)) return { error: 'رابط الملف غير صالح' };
  const i = dateOpt(body.issued_on, 'تاريخ الإصدار'); if (i.error) return i; v.issued_on = i.value;
  if (v.is_unlimited) {
    v.expires_on = null;
  } else {
    const e = dateOpt(body.expires_on, 'تاريخ الانتهاء'); if (e.error) return e; v.expires_on = e.value;
    if (v.issued_on && v.expires_on && v.expires_on < v.issued_on) return { error: 'تاريخ الانتهاء قبل تاريخ الإصدار' };
  }
  return { value: v };
}

const IBAN_RE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
/** A bank account row (admin form). IBAN is stored without spaces, upper-case. */
export function validateBankAccount(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = { bank_name_ar: str(body.bank_name_ar, 200), bank_name_en: str(body.bank_name_en, 200), account_name: str(body.account_name, 200),
    iban: opt(String(body.iban ?? '').replace(/\s+/g, '').toUpperCase(), 40), account_no: opt(String(body.account_no ?? '').replace(/\s+/g, ''), 40), customer_no: opt(body.customer_no, 40),
    swift: opt(body.swift, 20), currency: (str(body.currency, 3) || 'SAR').toUpperCase(), account_type: opt(body.account_type, 80), branch: opt(body.branch, 200),
    status: str(body.status, 10) || 'active', signatories_ar: opt(body.signatories_ar, 1000), secret_node_key: opt(body.secret_node_key, 60), secret_ref: opt(body.secret_ref, 200),
    notes: opt(body.notes, 2000), sort: Number.isFinite(+body.sort) ? Math.trunc(+body.sort) : 100 };
  if (!v.bank_name_ar) return { error: 'اسم البنك مطلوب' };
  if (!BANK_STATUSES.includes(v.status)) return { error: 'حالة الحساب غير صالحة' };
  if (v.iban !== null && !IBAN_RE.test(v.iban)) return { error: 'الآيبان غير صالح' };
  if (!/^[A-Z]{3}$/.test(v.currency)) return { error: 'العملة غير صالحة (3 أحرف)' };
  if (v.secret_node_key !== null && !/^[a-z0-9_-]{2,60}$/.test(v.secret_node_key)) return { error: 'مفتاح عقدة الأسرار غير صالح' };
  for (const k of ['document_id', 'platform_id']) { const id = opt(body[k], 36); if (id !== null && !UUID_RE.test(id)) return { error: 'المعرّف غير صالح' }; v[k] = id; }
  const d = dateOpt(body.opened_on, 'تاريخ الفتح'); if (d.error) return d; v.opened_on = d.value;
  return { value: v };
}
