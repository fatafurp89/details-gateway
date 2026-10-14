// Input validation + CSV parsing for the admin (pure)
import { normalizeMobile } from './mask.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i;
const ROLES = ['admin', 'user'];
const MODES = ['proxy', 'link', 'internal'];
const STATUSES = ['live', 'soon', 'off'];

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
const optEmail = (v) => { const s = clean(v).toLowerCase(); return s || null; };
const toBool = (v) => !['0', 'false', 'no', 'معطل', 'غير نشط', 'لا'].includes(clean(v).toLowerCase());

// Returns { value } or { error } with an Arabic message
export function validateEmployee(input) {
  const v = {
    employee_no: clean(input.employee_no),
    full_name: clean(input.full_name).slice(0, 120),
    mobile: input.mobile ? normalizeMobile(input.mobile) : null,
    email: optEmail(input.email),
    google_email: optEmail(input.google_email),
    role: clean(input.role) || 'user',
    active: typeof input.active === 'boolean' ? input.active : (clean(input.active) === '' ? true : toBool(input.active)),
    expires_at: clean(input.expires_at) || null,
  };
  if (!/^\d{4}$/.test(v.employee_no)) return { error: 'الرقم الوظيفي يجب أن يكون أربعة أرقام' };
  if (v.full_name.length < 2) return { error: 'الاسم مطلوب' };
  if (v.mobile && !/^05\d{8}$/.test(v.mobile)) return { error: 'رقم الجوال غير صحيح (05XXXXXXXX)' };
  if (v.email && !EMAIL_RE.test(v.email)) return { error: 'البريد الإلكتروني غير صحيح' };
  if (v.google_email && !EMAIL_RE.test(v.google_email)) return { error: 'بريد جوجل غير صحيح' };
  if (v.role === 'مدير') v.role = 'admin';
  if (v.role === 'مستخدم') v.role = 'user';
  if (!ROLES.includes(v.role)) return { error: 'الدور غير صحيح' };
  if (v.expires_at && Number.isNaN(Date.parse(v.expires_at))) return { error: 'تاريخ الانتهاء غير صحيح' };
  return { value: v };
}

// مزامنة من نظام الموارد البشرية (/_gw/employees/upsert): لا دور ولا صلاحيات هنا — تُدار من البوابة فقط.
// Returns { value } with only the provided optional fields, or { error }.
export function validateHrEmployee(input) {
  if (!input || typeof input !== 'object') return { error: 'الطلب غير صالح' };
  const v = { employee_no: clean(input.employee_no), full_name: clean(input.full_name).slice(0, 120) };
  if (!/^\d{4}$/.test(v.employee_no)) return { error: 'الرقم الوظيفي يجب أن يكون أربعة أرقام' };
  if (v.full_name.length < 2) return { error: 'الاسم مطلوب' };
  if (input.mobile !== undefined) {
    v.mobile = clean(input.mobile) ? normalizeMobile(input.mobile) : null;
    if (v.mobile && !/^05\d{8}$/.test(v.mobile)) return { error: 'رقم الجوال غير صحيح (05XXXXXXXX)' };
  }
  if (input.email !== undefined) { v.email = optEmail(input.email); if (v.email && !EMAIL_RE.test(v.email)) return { error: 'البريد الإلكتروني غير صحيح' }; }
  if (input.google_email !== undefined) { v.google_email = optEmail(input.google_email); if (v.google_email && !EMAIL_RE.test(v.google_email)) return { error: 'بريد جوجل غير صحيح' }; }
  if (input.photo_url !== undefined) { v.photo_url = clean(input.photo_url).slice(0, 2000) || null; if (v.photo_url && !/^(https:\/\/|\/)/.test(v.photo_url)) return { error: 'رابط الصورة غير صحيح' }; }
  if (input.active !== undefined) v.active = typeof input.active === 'boolean' ? input.active : toBool(input.active);
  if (input.expires_at !== undefined) { v.expires_at = clean(input.expires_at) || null; if (v.expires_at && Number.isNaN(Date.parse(v.expires_at))) return { error: 'تاريخ الانتهاء غير صحيح' }; }
  // بيانات وصفية من HR تُحفظ في meta (قسم، مسمى، حالة HR) دون أعمدة جديدة
  const meta = {};
  for (const k of ['department', 'title', 'hr_status']) if (input[k] !== undefined) meta[k] = clean(input[k]).slice(0, 200) || null;
  if (Object.keys(meta).length) v.hr_meta = meta;
  return { value: v };
}

export function validateSystem(input) {
  const v = {
    key: clean(input.key).toLowerCase(),
    name_ar: clean(input.name_ar).slice(0, 120),
    description_ar: clean(input.description_ar).slice(0, 500),
    icon: clean(input.icon).slice(0, 8) || '◼',
    host: clean(input.host) || null,
    mode: clean(input.mode) || 'proxy',
    upstream: clean(input.upstream) || null,
    status: clean(input.status) || 'soon',
    sort: Number.parseInt(input.sort, 10) || 100,
    requires_grant: !(input.requires_grant === false || input.requires_grant === 'false'),
    placement: clean(input.placement) || 'grid', // 'grid' بطاقة | 'header' زر في رأس البوابة | 'compact' بطاقة مضغوطة (أيقونة واسم)
  };
  if (!/^[a-z0-9_-]{2,32}$/.test(v.key)) return { error: 'مفتاح النظام: حروف إنجليزية صغيرة وأرقام فقط' };
  if (!['grid', 'header', 'compact'].includes(v.placement)) return { error: 'الموضع غير صحيح (grid / header / compact)' };
  if (v.name_ar.length < 2) return { error: 'اسم النظام مطلوب' };
  if (!MODES.includes(v.mode)) return { error: 'النمط غير صحيح' };
  if (!STATUSES.includes(v.status)) return { error: 'الحالة غير صحيحة' };
  if (v.mode === 'proxy' && (!v.host || !/^[a-z0-9.-]+$/i.test(v.host))) return { error: 'نمط proxy يتطلب host صحيحًا' };
  if (v.mode === 'link' && v.upstream && !/^https:\/\//.test(v.upstream)) return { error: 'رابط النظام الخارجي يجب أن يبدأ بـ https://' };
  return { value: v };
}

// Minimal RFC4180 CSV parser (quotes, commas, CRLF)
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const HEADERS = {
  employee_no: ['employee_no', 'الرقم', 'الرقم الوظيفي'], full_name: ['full_name', 'الاسم'],
  mobile: ['mobile', 'الجوال'], email: ['email', 'البريد'], google_email: ['google_email', 'بريد جوجل'],
  role: ['role', 'الدور'], active: ['active', 'الحالة'], expires_at: ['expires_at', 'الانتهاء'],
};

// CSV text -> { employees: [...valid], errors: [{line, error}] }
export function employeesFromCsv(text) {
  const [head, ...body] = parseCsv(text);
  if (!head) return { employees: [], errors: [{ line: 1, error: 'الملف فارغ' }] };
  const idx = {};
  head.forEach((h, i) => {
    const k = Object.keys(HEADERS).find((key) => HEADERS[key].includes(h.trim()));
    if (k) idx[k] = i;
  });
  if (idx.employee_no === undefined) return { employees: [], errors: [{ line: 1, error: 'عمود الرقم الوظيفي غير موجود' }] };
  const employees = [], errors = [];
  body.forEach((r, n) => {
    const obj = {};
    for (const [k, i] of Object.entries(idx)) obj[k] = r[i];
    const res = validateEmployee(obj);
    if (res.error) errors.push({ line: n + 2, error: res.error });
    else employees.push(res.value);
  });
  return { employees, errors };
}
