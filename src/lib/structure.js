// «بيانات المنشأة» — هيكل ملكية المجموعة (pure): التحقق من الكيانات والروابط والمستفيدين الحقيقيين، تقارير النِّسب، تجميع الهيكل للواجهة.
import { maskId, expiryState } from './company.js';
import { daysUntil } from './infra.js';

export const ENTITY_KINDS = ['parent', 'subsidiary', 'branch'];
export const ENTITY_KIND_AR = { parent: 'شركة أم', subsidiary: 'شركة تابعة', branch: 'فرع' };
export const ENTITY_STATUSES = ['active', 'dormant', 'closed'];
export const ENTITY_STATUS_AR = { active: 'نشطة', dormant: 'خاملة', closed: 'مغلقة' };
export const LINK_RELATIONS = ['owns', 'branch_of'];
export const LINK_RELATION_AR = { owns: 'تملك', branch_of: 'فرع من' };
export const COUNTRY_AR = { EG: 'مصر', SA: 'المملكة العربية السعودية', US: 'الولايات المتحدة', GB: 'المملكة المتحدة', CA: 'كندا', AE: 'الإمارات', QA: 'قطر', KW: 'الكويت', BH: 'البحرين', OM: 'عُمان', JO: 'الأردن', TR: 'تركيا' };
export const COUNTRIES = Object.keys(COUNTRY_AR);
export const BASIS_DEFAULT = 'مستفيد حقيقي';

const str = (v, max) => (v === undefined || v === null ? '' : String(v).trim()).slice(0, max);
const opt = (v, max) => { const s = str(v, max); return s || null; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const UUID_RE = /^[0-9a-f-]{36}$/;
const round2 = (n) => Math.round(n * 100) / 100;
const dateOpt = (v, label) => { const d = opt(v, 10); if (d !== null && !isDate(d)) return { error: `${label} غير صالح (YYYY-MM-DD)` }; return { value: d }; };
const pct = (v, label = 'النسبة') => {
  if (v === undefined || v === null || v === '') return { error: `${label} مطلوبة` };
  const n = Number(String(v).replace('%', '').trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return { error: `${label} يجب أن تكون بين 0 و100` };
  return { value: round2(n) };
};
const sortOf = (v) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.trunc(+v) : 100);

export function validateEntity(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = {
    kind: str(body.kind, 12) || 'subsidiary', name_ar: str(body.name_ar, 200), name_en: str(body.name_en, 200), legal_form: opt(body.legal_form, 200),
    country_code: str(body.country_code, 2).toUpperCase(), jurisdiction: opt(body.jurisdiction, 200), registration_no: opt(body.registration_no, 100), tax_no: opt(body.tax_no, 100),
    status: str(body.status, 10) || 'active', address: opt(body.address, 500), website: opt(body.website, 300), notes: opt(body.notes, 4000),
    awaiting_details: body.awaiting_details === true || body.awaiting_details === 'true', sort: sortOf(body.sort),
  };
  if (!v.name_ar) return { error: 'اسم الكيان مطلوب' };
  if (!ENTITY_KINDS.includes(v.kind)) return { error: 'نوع الكيان غير صالح' };
  if (!COUNTRIES.includes(v.country_code)) return { error: 'الدولة غير مدعومة' };
  if (!ENTITY_STATUSES.includes(v.status)) return { error: 'حالة الكيان غير صالحة' };
  if (v.website !== null && /\s/.test(v.website)) return { error: 'الموقع الإلكتروني غير صالح' };
  const d = dateOpt(body.incorporated_on, 'تاريخ التأسيس'); if (d.error) return d; v.incorporated_on = d.value;
  return { value: v };
}

export function validateLink(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = { parent_entity_id: str(body.parent_entity_id, 36), child_entity_id: str(body.child_entity_id, 36), relation: str(body.relation, 10) || 'owns', notes: opt(body.notes, 2000) };
  if (!UUID_RE.test(v.parent_entity_id) || !UUID_RE.test(v.child_entity_id)) return { error: 'اختر الكيانين' };
  if (v.parent_entity_id === v.child_entity_id) return { error: 'لا يمكن أن يرتبط الكيان بنفسه' };
  if (!LINK_RELATIONS.includes(v.relation)) return { error: 'نوع العلاقة غير صالح' };
  const p = body.share_pct === undefined || body.share_pct === null || body.share_pct === '' ? { value: 100 } : pct(body.share_pct, 'نسبة الملكية');
  if (p.error) return p; v.share_pct = p.value;
  const s = dateOpt(body.since, 'تاريخ البداية'); if (s.error) return s; v.since = s.value;
  return { value: v };
}

export function validateBeneficialOwner(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = {
    entity_id: opt(body.entity_id, 36), person_name_ar: str(body.person_name_ar, 200), person_name_en: str(body.person_name_en, 200), employee_no: opt(body.employee_no, 4),
    nationality: opt(body.nationality, 80), id_no: opt(body.id_no, 40), basis: str(body.basis, 100) || BASIS_DEFAULT, notes: opt(body.notes, 2000), sort: sortOf(body.sort),
  };
  if (v.entity_id !== null && !UUID_RE.test(v.entity_id)) return { error: 'المعرّف غير صالح' };
  if (v.employee_no !== null && !/^\d{4}$/.test(v.employee_no)) return { error: 'الرقم الوظيفي يتكون من 4 أرقام' };
  if (!v.person_name_ar && !v.employee_no) return { error: 'اسم المستفيد مطلوب' };
  const p = pct(body.share_pct, 'نسبة المستفيد'); if (p.error) return p; v.share_pct = p.value;
  return { value: v };
}

/** Sum of owns-links into one child (excluding `exceptId`), plus a candidate share. { ok, total, error? } — total must stay ≤ 100. */
export function childShareTotal(links, childId, { exceptId = null, add = 0 } = {}) {
  let total = add;
  for (const l of links) if (l.child_entity_id === childId && l.relation === 'owns' && l.id !== exceptId) total += Number(l.share_pct) || 0;
  total = round2(total);
  return total > 100 ? { ok: false, total, error: `مجموع حصص الملاك في هذا الكيان (${total}٪) يتجاوز 100٪` } : { ok: true, total };
}

/** Would adding parent -> child create a cycle? (child already reaches parent through existing links). */
export function wouldCycle(links, parentId, childId, exceptId = null) {
  const next = new Map();
  for (const l of links) if (l.id !== exceptId) { if (!next.has(l.parent_entity_id)) next.set(l.parent_entity_id, []); next.get(l.parent_entity_id).push(l.child_entity_id); }
  const seen = new Set(); const stack = [childId];
  while (stack.length) {
    const n = stack.pop();
    if (n === parentId) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const c of next.get(n) || []) stack.push(c);
  }
  return false;
}

/** Full check of a candidate link against the existing ones: cycle + child ≤ 100. */
export function checkLink(links, candidate, exceptId = null) {
  if (wouldCycle(links, candidate.parent_entity_id, candidate.child_entity_id, exceptId)) return { ok: false, error: 'هذه العلاقة تُنشئ دورة في هيكل الملكية' };
  if (candidate.relation === 'owns') {
    const s = childShareTotal(links, candidate.child_entity_id, { exceptId, add: Number(candidate.share_pct) || 0 });
    if (!s.ok) return s;
  }
  return { ok: true };
}

/** Per-child ownership report: [{ entity_id, total, ok, remaining }] for every entity that has owning links. */
export function ownershipReport(links) {
  const totals = new Map();
  for (const l of links) if (l.relation === 'owns') totals.set(l.child_entity_id, round2((totals.get(l.child_entity_id) || 0) + (Number(l.share_pct) || 0)));
  return [...totals].map(([entity_id, total]) => ({ entity_id, total, ok: total <= 100, complete: total === 100, remaining: round2(100 - total) }));
}

/** Beneficial owners per scope (null = whole group): [{ entity_id, total, ok, count }]; ok only when the scope sums to exactly 100. */
export function beneficialReport(rows) {
  const scopes = new Map();
  for (const r of rows) {
    const k = r.entity_id || null;
    const s = scopes.get(k) || { entity_id: k, total: 0, count: 0 };
    s.total = round2(s.total + (Number(r.share_pct) || 0)); s.count++;
    scopes.set(k, s);
  }
  if (!scopes.has(null)) scopes.set(null, { entity_id: null, total: 0, count: 0 });
  return [...scopes.values()].map((s) => ({ ...s, ok: s.total === 100 }));
}

/** Human warnings (Arabic) from the two reports; the UI shows them as a strip, writes return them next to ok:true. */
export function structureWarnings({ entities = [], links = [], owners = [] }) {
  const name = (id) => entities.find((e) => e.id === id)?.name_ar || 'كيان';
  const out = [];
  for (const s of beneficialReport(owners)) {
    if (!s.ok) out.push({ kind: 'beneficial', entity_id: s.entity_id, message: `مجموع نسب المستفيدين الحقيقيين ${s.entity_id ? `لـ«${name(s.entity_id)}»` : 'للمجموعة'} ${s.total}٪ وليس 100٪` });
  }
  for (const r of ownershipReport(links)) {
    if (!r.ok) out.push({ kind: 'ownership', entity_id: r.entity_id, message: `مجموع حصص ملاك «${name(r.entity_id)}» ${r.total}٪ ويتجاوز 100٪` });
    else if (!r.complete) out.push({ kind: 'ownership', entity_id: r.entity_id, message: `حصص ملاك «${name(r.entity_id)}» ${r.total}٪ — المتبقي ${r.remaining}٪ غير موزَّع` });
  }
  return out;
}

/** Beneficial owners as seen by a non-admin: id numbers masked. */
export function maskBeneficialOwners(rows, admin) {
  return rows.map((r) => (admin ? r : { ...r, id_no: maskId(r.id_no) }));
}

/**
 * Per-entity document figures. documents: [{ entity_id, title_ar, expires_on, has_file }]; documents with no entity belong to `primaryId`.
 * Returns Map(entity_id -> { documents, with_files, expired, expiring, next_expiry: { title_ar, expires_on, days_left, state } | null }).
 */
export function entityDocStats(entities, documents, primaryId, now = new Date()) {
  const stats = new Map(entities.map((e) => [e.id, { documents: 0, with_files: 0, expired: 0, expiring: 0, next_expiry: null }]));
  for (const d of documents) {
    const s = stats.get(d.entity_id || primaryId);
    if (!s) continue;
    s.documents++;
    if (d.has_file) s.with_files++;
    const state = expiryState(d.expires_on, now);
    if (state === 'expired') s.expired++; else if (state === 'expiring') s.expiring++;
    if (d.expires_on) {
      const days = daysUntil(d.expires_on, now);
      // the "next" expiry = the soonest not-yet-expired date; if everything dated is expired, the most recent expired one
      const cand = { title_ar: d.title_ar, expires_on: String(d.expires_on).slice(0, 10), days_left: days, state };
      const cur = s.next_expiry;
      const better = !cur || (cand.days_left >= 0 && (cur.days_left < 0 || cand.days_left < cur.days_left)) || (cand.days_left < 0 && cur.days_left < 0 && cand.days_left > cur.days_left);
      if (better) s.next_expiry = cand;
    }
  }
  return stats;
}

/**
 * The payload of GET /api/company/structure.
 * in: { entities, links, owners (beneficial), documents (see entityDocStats), profile, admin, now }
 * Entities pointing at company_profile show the profile's registration/tax/website/address (single source of truth).
 */
export function buildStructure({ entities, links, owners, documents, profile = null, admin = false, now = new Date() }) {
  const primary = entities.find((e) => e.profile_id) || null;
  const stats = entityDocStats(entities, documents, primary?.id || null, now);
  const addr = profile ? [profile.city, profile.district, profile.street].filter(Boolean).join('، ') : '';
  const out = entities.map((e) => {
    const from = e.profile_id && profile ? { registration_no: profile.cr_number || e.registration_no, tax_no: profile.tax_number || e.tax_no,
      incorporated_on: profile.established_on || e.incorporated_on, website: profile.website || e.website, address: addr || e.address,
      legal_form: profile.legal_form || e.legal_form } : {};
    const st = stats.get(e.id);
    const incoming = links.filter((l) => l.child_entity_id === e.id);
    return { ...e, ...from, from_profile: !!e.profile_id, stats: st, owned_pct: incoming.some((l) => l.relation === 'owns') ? childShareTotal(links, e.id).total : null };
  });
  const bos = maskBeneficialOwners(owners, admin);
  return {
    entities: out, links, beneficial_owners: bos,
    validation: { beneficial: beneficialReport(owners), ownership: ownershipReport(links), warnings: structureWarnings({ entities, links, owners }) },
    totals: { entities: out.length, documents: documents.length, expired: [...stats.values()].reduce((a, s) => a + s.expired, 0), expiring: [...stats.values()].reduce((a, s) => a + s.expiring, 0) },
    primary_entity_id: primary?.id || null,
  };
}
