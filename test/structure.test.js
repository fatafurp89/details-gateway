import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEntity, validateLink, validateBeneficialOwner, childShareTotal, wouldCycle, checkLink, ownershipReport, beneficialReport, structureWarnings,
  maskBeneficialOwners, entityDocStats, buildStructure, COUNTRIES,
} from '../src/lib/structure.js';
import { validateDocument, DOCUMENT_KINDS } from '../src/lib/company.js';
import '../web/js/company-chart.js';

const now = new Date('2026-10-14T10:00:00Z');
const ID = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const EG = ID(1), SA = ID(2), US = ID(3), GB = ID(4), CA = ID(5);
const ents = [
  { id: EG, kind: 'parent', name_ar: 'ركائز ميم للتميز', country_code: 'EG', status: 'active', sort: 10, profile_id: null, registration_no: '75349' },
  { id: SA, kind: 'subsidiary', name_ar: 'ديتيلز السعودية', country_code: 'SA', status: 'active', sort: 20, profile_id: 1, registration_no: null, tax_no: null },
  { id: US, kind: 'subsidiary', name_ar: 'الشركة الأمريكية', country_code: 'US', status: 'active', sort: 30, awaiting_details: true, profile_id: null },
  { id: GB, kind: 'subsidiary', name_ar: 'الشركة البريطانية', country_code: 'GB', status: 'active', sort: 40, awaiting_details: true, profile_id: null },
  { id: CA, kind: 'subsidiary', name_ar: 'الشركة الكندية', country_code: 'CA', status: 'active', sort: 50, awaiting_details: true, profile_id: null },
];
const link = (id, p, c, pct = '100.00', relation = 'owns') => ({ id, parent_entity_id: p, child_entity_id: c, share_pct: pct, relation });
const links = [link('l1', EG, SA), link('l2', EG, US), link('l3', EG, GB), link('l4', EG, CA)];
const bo = (id, name, pct, entity_id = null, extra = {}) => ({ id, entity_id, person_name_ar: name, share_pct: pct, id_no: '2311184515', sort: 10, ...extra });
const owners = [bo('b1', 'محمد نظمي', '50.00', null, { employee_no: '1010' }), bo('b2', 'مصطفى محمد', '50.00', null, { employee_no: '1012', id_no: '2399739933' })];

test('validateEntity: kinds, countries, status, required name; defaults', () => {
  const v = validateEntity({ name_ar: ' الشركة الكندية ', country_code: 'ca', kind: 'subsidiary', awaiting_details: true, incorporated_on: '2024-03-01', sort: '40' });
  assert.equal(v.error, undefined);
  assert.deepEqual([v.value.name_ar, v.value.country_code, v.value.status, v.value.awaiting_details, v.value.sort, v.value.incorporated_on], ['الشركة الكندية', 'CA', 'active', true, 40, '2024-03-01']);
  assert.ok(validateEntity({ name_ar: '', country_code: 'US' }).error);
  assert.ok(validateEntity({ name_ar: 'x', country_code: 'XX' }).error);
  assert.ok(validateEntity({ name_ar: 'x', country_code: 'US', kind: 'cousin' }).error);
  assert.ok(validateEntity({ name_ar: 'x', country_code: 'US', status: 'gone' }).error);
  assert.ok(validateEntity({ name_ar: 'x', country_code: 'US', incorporated_on: '01/03/2024' }).error);
  for (const c of ['EG', 'SA', 'US', 'GB', 'CA']) assert.ok(COUNTRIES.includes(c));
  assert.ok(validateEntity(null).error);
});

test('validateLink: pct 0-100 (default 100), no self link, relation, ids', () => {
  assert.equal(validateLink({ parent_entity_id: EG, child_entity_id: US }).value.share_pct, 100);
  assert.equal(validateLink({ parent_entity_id: EG, child_entity_id: US, share_pct: '33.333' }).value.share_pct, 33.33);
  assert.ok(validateLink({ parent_entity_id: EG, child_entity_id: EG }).error);
  assert.ok(validateLink({ parent_entity_id: EG, child_entity_id: US, share_pct: 101 }).error);
  assert.ok(validateLink({ parent_entity_id: EG, child_entity_id: US, share_pct: -1 }).error);
  assert.ok(validateLink({ parent_entity_id: EG, child_entity_id: US, relation: 'rents' }).error);
  assert.ok(validateLink({ parent_entity_id: 'x', child_entity_id: US }).error);
  assert.equal(validateLink({ parent_entity_id: EG, child_entity_id: US, relation: 'branch_of' }).value.relation, 'branch_of');
});

test('child shares from all parents must stay <= 100; editing a link excludes itself', () => {
  assert.deepEqual(childShareTotal(links, US), { ok: true, total: 100 });
  assert.equal(childShareTotal(links, US, { add: 1 }).ok, false);
  assert.equal(childShareTotal(links, US, { exceptId: 'l2', add: 100 }).ok, true);
  // a second parent taking 60% of a company that is already 100% owned is refused
  const second = { parent_entity_id: SA, child_entity_id: US, share_pct: 60, relation: 'owns' };
  assert.equal(checkLink(links, second).ok, false);
  assert.match(checkLink(links, second).error, /100/);
  // lowering the existing one first makes room (40 + 60)
  const lowered = [link('l1', EG, SA), link('l2', EG, US, '40'), link('l3', EG, GB), link('l4', EG, CA)];
  assert.equal(checkLink(lowered, second).ok, true);
  // branch links do not count as ownership shares
  assert.equal(checkLink(links, { parent_entity_id: SA, child_entity_id: US, share_pct: 100, relation: 'branch_of' }).ok, true);
});

test('wouldCycle: detects loops, ignores the link being edited', () => {
  assert.equal(wouldCycle(links, SA, EG), true);          // SA -> EG while EG -> SA exists
  assert.equal(wouldCycle(links, US, SA), false);
  assert.equal(wouldCycle(links, SA, EG, 'l1'), false);   // l1 (EG->SA) is the one being edited
  assert.equal(checkLink(links, { parent_entity_id: GB, child_entity_id: EG, share_pct: 10, relation: 'owns' }).error, 'هذه العلاقة تُنشئ دورة في هيكل الملكية');
});

test('ownershipReport: totals per child, complete / partial / over', () => {
  const r = ownershipReport([...links, link('l5', SA, US, '10')]);
  const us = r.find((x) => x.entity_id === US);
  assert.deepEqual([us.total, us.ok, us.complete], [110, false, false]);
  const sa = r.find((x) => x.entity_id === SA);
  assert.deepEqual([sa.total, sa.ok, sa.complete, sa.remaining], [100, true, true, 0]);
  const half = ownershipReport([link('x', EG, US, '50')])[0];
  assert.deepEqual([half.ok, half.complete, half.remaining], [true, false, 50]);
});

test('validateBeneficialOwner: name or employee, 4-digit employee no, pct 0-100 required', () => {
  const v = validateBeneficialOwner({ person_name_ar: 'محمد نظمي', employee_no: '1010', share_pct: '50' });
  assert.equal(v.error, undefined);
  assert.deepEqual([v.value.share_pct, v.value.basis, v.value.entity_id, v.value.employee_no], [50, 'مستفيد حقيقي', null, '1010']);
  assert.equal(validateBeneficialOwner({ employee_no: '1012', share_pct: 50 }).error, undefined); // name filled from employees by the route
  assert.ok(validateBeneficialOwner({ share_pct: 50 }).error);
  assert.ok(validateBeneficialOwner({ person_name_ar: 'x', employee_no: '12', share_pct: 50 }).error);
  assert.ok(validateBeneficialOwner({ person_name_ar: 'x', share_pct: 120 }).error);
  assert.ok(validateBeneficialOwner({ person_name_ar: 'x' }).error);
  assert.ok(validateBeneficialOwner({ person_name_ar: 'x', share_pct: 10, entity_id: 'nope' }).error);
});

test('beneficialReport: per scope, ok only when exactly 100; group scope always present', () => {
  const ok = beneficialReport(owners);
  assert.deepEqual(ok, [{ entity_id: null, total: 100, count: 2, ok: true }]);
  const warn = beneficialReport([bo('b1', 'أ', '50'), bo('b3', 'ج', '30', US)]);
  assert.deepEqual(warn.map((s) => [s.entity_id, s.total, s.ok]), [[null, 50, false], [US, 30, false]]);
  assert.deepEqual(beneficialReport([]), [{ entity_id: null, total: 0, count: 0, ok: false }]);
});

test('structureWarnings: Arabic messages for bad beneficial totals and partial/over ownership', () => {
  assert.deepEqual(structureWarnings({ entities: ents, links, owners }), []);
  const w = structureWarnings({ entities: ents, links: [link('l1', EG, SA, '60'), link('l2', EG, US, '100'), link('l9', SA, US, '10')], owners: [bo('b1', 'أ', '50')] });
  const kinds = w.map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['beneficial', 'ownership', 'ownership']);
  assert.ok(w.some((x) => x.message.includes('50٪') && x.message.includes('للمجموعة')));
  assert.ok(w.some((x) => x.message.includes('الشركة الأمريكية') && x.message.includes('يتجاوز')));
  assert.ok(w.some((x) => x.message.includes('ديتيلز السعودية') && x.message.includes('المتبقي 40')));
});

test('maskBeneficialOwners: ids masked for non-admin, full for admin', () => {
  assert.equal(maskBeneficialOwners(owners, false)[0].id_no, '••••••4515');
  assert.equal(maskBeneficialOwners(owners, true)[0].id_no, '2311184515');
  assert.equal(maskBeneficialOwners([{ id_no: null }], false)[0].id_no, '');
});

test('entityDocStats: counts, files, expired/expiring, next expiry; unassigned docs go to the main entity', () => {
  const docs = [
    { entity_id: null, title_ar: 'السجل', expires_on: '2027-10-29', has_file: true },
    { entity_id: SA, title_ar: 'العنوان', expires_on: '2026-10-20', has_file: true },
    { entity_id: SA, title_ar: 'ترخيص منتهٍ', expires_on: '2026-09-01', has_file: false },
    { entity_id: SA, title_ar: 'بلا تاريخ', expires_on: null, has_file: true },
    { entity_id: EG, title_ar: 'تأسيس', expires_on: '2030-01-01', has_file: true },
  ];
  const s = entityDocStats(ents, docs, SA, now);
  const sa = s.get(SA);
  assert.deepEqual([sa.documents, sa.with_files, sa.expired, sa.expiring], [4, 3, 1, 1]);
  assert.equal(sa.next_expiry.title_ar, 'العنوان');
  assert.equal(sa.next_expiry.days_left, 6);
  assert.deepEqual([s.get(EG).documents, s.get(EG).next_expiry.expires_on], [1, '2030-01-01']);
  assert.deepEqual([s.get(US).documents, s.get(US).next_expiry], [0, null]);
  // all dated docs expired -> the most recent expired one is reported
  const only = entityDocStats(ents, [{ entity_id: US, title_ar: 'a', expires_on: '2026-01-01' }, { entity_id: US, title_ar: 'b', expires_on: '2026-08-01' }], SA, now).get(US);
  assert.equal(only.next_expiry.title_ar, 'b');
});

test('buildStructure: overlays the profile on the main entity, masks owners, totals and validation', () => {
  const profile = { cr_number: '7052303828', tax_number: '314348683600003', established_on: '2025-10-30', website: 'details-consults.sa', city: 'الرياض', district: 'حي الملك فهد', street: 'شارع', legal_form: 'ش.ذ.م.م' };
  const docs = [{ entity_id: null, title_ar: 'السجل', expires_on: '2026-10-20', has_file: true }, { entity_id: US, title_ar: 'x', expires_on: '2026-09-01', has_file: false }];
  const out = buildStructure({ entities: ents, links, owners, documents: docs, profile, admin: false, now });
  const sa = out.entities.find((e) => e.id === SA);
  assert.deepEqual([sa.registration_no, sa.tax_no, sa.from_profile, sa.owned_pct], ['7052303828', '314348683600003', true, 100]);
  assert.equal(sa.stats.documents, 1);
  assert.equal(out.entities.find((e) => e.id === EG).registration_no, '75349');
  assert.equal(out.entities.find((e) => e.id === EG).owned_pct, null);
  assert.equal(out.entities.find((e) => e.id === US).awaiting_details, true);
  assert.equal(out.beneficial_owners[0].id_no, '••••••4515');
  assert.equal(out.primary_entity_id, SA);
  assert.deepEqual(out.totals, { entities: 5, documents: 2, expired: 1, expiring: 1 });
  assert.deepEqual(out.validation.warnings, []);
  assert.equal(out.validation.beneficial[0].total, 100);
});

test('documents: new foreign-entity kinds and optional entity_id', () => {
  for (const k of ['incorporation', 'good_standing', 'apostille', 'resolution', 'articles']) assert.ok(DOCUMENT_KINDS.includes(k));
  const v = validateDocument({ title_ar: 'شهادة التأسيس', kind: 'incorporation', entity_id: US });
  assert.equal(v.value.entity_id, US);
  assert.equal(validateDocument({ title_ar: 'x' }).value.entity_id, undefined);       // not provided: keep / default to the main entity
  assert.equal(validateDocument({ title_ar: 'x', entity_id: null }).value.entity_id, null);
  assert.ok(validateDocument({ title_ar: 'x', entity_id: 'bad' }).error);
});

test('chart layout (wide): owners row on top, parent centred, 4 children in one row, RTL order, no overlaps', () => {
  const { layout, buildModel } = globalThis.CompanyChart;
  const model = buildModel({ entities: ents, links, beneficial_owners: owners });
  const L = layout(model, 'wide');
  assert.equal(L.nodes.length, 7);
  const byId = Object.fromEntries(L.nodes.map((n) => [n.id, n]));
  const o1 = byId['o:b1'], o2 = byId['o:b2'], p = byId[EG];
  assert.ok(o1.y < p.y && o2.y === o1.y, 'owners above the parent, same row');
  const kids = [SA, US, GB, CA].map((i) => byId[i]);
  assert.ok(kids.every((k) => k.y > p.y && k.y === kids[0].y), 'children share one row below the parent');
  assert.ok(kids[0].x > kids[1].x && kids[1].x > kids[2].x && kids[2].x > kids[3].x, 'first child on the right (RTL)');
  assert.ok(Math.abs((p.x + p.w / 2) - L.width / 2) < 1, 'parent centred');
  for (const row of [[o1, o2], kids]) for (let i = 1; i < row.length; i++) assert.ok(row[i - 1].x >= row[i].x + row[i].w, 'no horizontal overlap');
  for (const n of L.nodes) assert.ok(n.x >= 0 && n.x + n.w <= L.width && n.y + n.h <= L.height);
  assert.equal(L.edges.length, 2 + 4);
  assert.deepEqual(L.edges.filter((e) => e.fromOwner).map((e) => e.pct), ['50.00', '50.00']);
});

test('chart layout (narrow): single column, every node inside the 340px canvas, edges for all links', () => {
  const { layout, buildModel } = globalThis.CompanyChart;
  const L = layout(buildModel({ entities: ents, links, beneficial_owners: owners }), 'narrow');
  assert.equal(L.width, 340);
  const xs = new Set(L.nodes.map((n) => n.x));
  assert.equal(xs.size, 1, 'one column');
  const ys = L.nodes.map((n) => n.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  for (let i = 1; i < L.nodes.length; i++) assert.ok(L.nodes[i].y >= L.nodes[i - 1].y + L.nodes[i - 1].h, 'no vertical overlap');
  for (const n of L.nodes) assert.ok(n.x + n.w <= L.width);
  assert.equal(L.edges.length, 6);
});

test('chart layout: multi-level (grandchild), entity-scoped owners are not drawn, empty model is safe', () => {
  const { layout, buildModel } = globalThis.CompanyChart;
  const deep = [...ents, { id: ID(6), kind: 'subsidiary', name_ar: 'حفيدة', country_code: 'US', status: 'active', sort: 60 }];
  const L = layout(buildModel({ entities: deep, links: [...links, link('l6', US, ID(6), '100')], beneficial_owners: [...owners, bo('b9', 'خاص', '100', US)] }), 'wide');
  const g = L.nodes.find((n) => n.id === ID(6)), us = L.nodes.find((n) => n.id === US);
  assert.ok(g.y > us.y);
  assert.equal(L.nodes.filter((n) => n.type === 'owner').length, 2);
  const E = layout(buildModel({ entities: [], links: [], beneficial_owners: [] }), 'wide');
  assert.deepEqual([E.nodes.length, E.edges.length], [0, 0]);
  // a cycle in bad data must not hang the layout
  const cyc = layout({ entities: ents.slice(0, 2), links: [link('a', EG, SA), link('b', SA, EG)], owners: [] }, 'wide');
  assert.equal(cyc.nodes.length, 2);
});

test('chart initials / pct helpers', () => {
  const { initials, pctText } = globalThis.CompanyChart;
  assert.equal(initials('محمد نظمي الصابر'), 'م ن');
  assert.equal(initials(''), '؟');
  assert.equal(pctText('50.00'), '50%');
  assert.equal(pctText('33.30'), '33.3%');
  assert.equal(pctText(100), '100%');
});
