// «بيانات المنشأة» — هيكل ملكية المجموعة: قراءة لكل موظف (هويات المستفيدين مقنّعة لغير المشرف) + كتابة للمشرف العام (موثَّقة في سجل التدقيق).
// الكيانات (الأم/التابعة/الفروع)، روابط الملكية بالنِّسب، المستفيدون الحقيقيون. مستندات كل كيان تُدار عبر مسارات المستندات (entity_id).
import { MSG, requireUser, requireAdmin } from './helpers.js';
import { audit } from '../lib/audit.js';
import { validateEntity, validateLink, validateBeneficialOwner, checkLink, buildStructure, structureWarnings } from '../lib/structure.js';

const UUID_RE = /^[0-9a-f-]{36}$/;
const D = (c) => `${c}::text AS ${c.split('.').pop()}`;
const ENTITY_COLS = `id, kind, name_ar, name_en, legal_form, country_code, jurisdiction, registration_no, tax_no, ${D('incorporated_on')}, status, address, website, notes, awaiting_details, profile_id, sort, updated_at`;
const LINK_COLS = `id, parent_entity_id, child_entity_id, share_pct::text AS share_pct, relation, ${D('since')}, notes, updated_at`;
const BO_COLS = `b.id, b.entity_id, b.person_name_ar, b.person_name_en, trim(b.employee_no) AS employee_no, b.nationality, b.id_no, b.share_pct::text AS share_pct, b.basis, b.notes, b.sort, b.updated_at,
  e.photo_url, e.full_name AS employee_name`;

export default async function companyStructureRoutes(app) {
  const { db } = app;
  const log = (req, action, target, meta = {}) => audit(db, { actor: req.user?.employee_id ?? null, action, target, meta, ip: req.ip });
  const validId = (id) => UUID_RE.test(String(id || ''));
  const guard = { preHandler: requireAdmin(app) };
  const notFound = (reply, what) => reply.code(404).send({ error: `${what} غير موجود` });
  const bad = (reply, error) => reply.code(400).send({ error });

  const loadAll = async () => {
    const [{ rows: entities }, { rows: links }, { rows: owners }] = await Promise.all([
      db.query(`SELECT ${ENTITY_COLS} FROM company_entities ORDER BY sort, name_ar`),
      db.query(`SELECT ${LINK_COLS} FROM company_entity_links ORDER BY created_at`),
      db.query(`SELECT ${BO_COLS} FROM company_beneficial_owners b LEFT JOIN employees e ON e.employee_no = b.employee_no ORDER BY b.sort, b.person_name_ar`),
    ]);
    return { entities, links, owners };
  };
  const warningsNow = async () => structureWarnings(await loadAll());

  // ---- read: every signed-in employee ----
  app.get('/api/company/structure', { preHandler: requireUser(app) }, async (req) => {
    const admin = req.user.role === 'admin';
    const [all, { rows: documents }, { rows: [profile] }] = await Promise.all([
      loadAll(),
      db.query(`SELECT d.id, d.entity_id, d.title_ar, d.expires_on::text AS expires_on,
          EXISTS (SELECT 1 FROM company_document_versions v WHERE v.document_id = d.id AND v.is_current AND (v.storage_path IS NOT NULL OR v.file_url IS NOT NULL)) AS has_file
        FROM company_documents d`),
      db.query('SELECT cr_number, tax_number, established_on::text AS established_on, website, city, district, street, legal_form FROM company_profile WHERE id = 1'),
    ]);
    const now = new Date();
    return { admin, ...buildStructure({ ...all, documents, profile: profile || null, admin, now }), server_now: now.toISOString() };
  });

  // ---- entities ----
  const entityVals = (e) => [e.kind, e.name_ar, e.name_en, e.legal_form, e.country_code, e.jurisdiction, e.registration_no, e.tax_no, e.incorporated_on, e.status, e.address, e.website, e.notes, e.awaiting_details, e.sort];
  app.post('/api/admin/company/entities', guard, async (req, reply) => {
    const v = validateEntity(req.body);
    if (v.error) return bad(reply, v.error);
    const { rows: [r] } = await db.query(
      `INSERT INTO company_entities (kind, name_ar, name_en, legal_form, country_code, jurisdiction, registration_no, tax_no, incorporated_on, status, address, website, notes, awaiting_details, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, entityVals(v.value));
    await log(req, 'company.entity.add', r.id, { name_ar: v.value.name_ar, country_code: v.value.country_code });
    return { ok: true, id: r.id };
  });
  app.put('/api/admin/company/entities/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return bad(reply, MSG.badRequest);
    const v = validateEntity(req.body);
    if (v.error) return bad(reply, v.error);
    const r = await db.query(
      `UPDATE company_entities SET kind=$2, name_ar=$3, name_en=$4, legal_form=$5, country_code=$6, jurisdiction=$7, registration_no=$8, tax_no=$9, incorporated_on=$10, status=$11,
         address=$12, website=$13, notes=$14, awaiting_details=$15, sort=$16, updated_at=now() WHERE id=$1`, [req.params.id, ...entityVals(v.value)]);
    if (!r.rowCount) return notFound(reply, 'الكيان');
    await log(req, 'company.entity.update', req.params.id, { name_ar: v.value.name_ar });
    return { ok: true };
  });
  app.delete('/api/admin/company/entities/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return bad(reply, MSG.badRequest);
    const { rows: [e] } = await db.query('SELECT name_ar, profile_id FROM company_entities WHERE id = $1', [req.params.id]);
    if (!e) return notFound(reply, 'الكيان');
    if (e.profile_id) return reply.code(409).send({ error: 'الكيان الرئيسي مرتبط بالملف الرسمي ولا يُحذف' });
    const { rows: [c] } = await db.query('SELECT count(*)::int AS n FROM company_documents WHERE entity_id = $1', [req.params.id]);
    if (c.n) return reply.code(409).send({ error: `لا يمكن حذف كيان له ${c.n} مستند؛ انقل مستنداته أو احذفها أولًا` });
    await db.query('DELETE FROM company_entities WHERE id = $1', [req.params.id]);
    await log(req, 'company.entity.remove', req.params.id, { name_ar: e.name_ar });
    return { ok: true, warnings: await warningsNow() };
  });

  // ---- ownership links ----
  const entitiesExist = async (ids) => {
    const { rows } = await db.query('SELECT id FROM company_entities WHERE id = ANY($1::uuid[])', [ids]);
    return rows.length === new Set(ids).size;
  };
  const saveLink = async (req, reply, id) => {
    const v = validateLink(req.body);
    if (v.error) return bad(reply, v.error);
    const l = v.value;
    if (!(await entitiesExist([l.parent_entity_id, l.child_entity_id]))) return bad(reply, 'الكيان غير موجود');
    const { rows: links } = await db.query(`SELECT ${LINK_COLS} FROM company_entity_links`);
    const chk = checkLink(links, l, id);
    if (!chk.ok) return bad(reply, chk.error);
    try {
      if (id) {
        const r = await db.query(
          'UPDATE company_entity_links SET parent_entity_id=$2, child_entity_id=$3, share_pct=$4, relation=$5, since=$6, notes=$7, updated_at=now() WHERE id=$1',
          [id, l.parent_entity_id, l.child_entity_id, l.share_pct, l.relation, l.since, l.notes]);
        if (!r.rowCount) return notFound(reply, 'العلاقة');
        await log(req, 'company.entity.link.update', id, { share_pct: l.share_pct, relation: l.relation });
        return { ok: true, warnings: await warningsNow() };
      }
      const { rows: [r] } = await db.query(
        'INSERT INTO company_entity_links (parent_entity_id, child_entity_id, share_pct, relation, since, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [l.parent_entity_id, l.child_entity_id, l.share_pct, l.relation, l.since, l.notes]);
      await log(req, 'company.entity.link.add', r.id, { parent: l.parent_entity_id, child: l.child_entity_id, share_pct: l.share_pct });
      return { ok: true, id: r.id, warnings: await warningsNow() };
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'هذه العلاقة موجودة مسبقًا' });
      throw e;
    }
  };
  app.post('/api/admin/company/entity-links', guard, (req, reply) => saveLink(req, reply, null));
  app.put('/api/admin/company/entity-links/:id', guard, (req, reply) => (validId(req.params.id) ? saveLink(req, reply, req.params.id) : bad(reply, MSG.badRequest)));
  app.delete('/api/admin/company/entity-links/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return bad(reply, MSG.badRequest);
    const r = await db.query('DELETE FROM company_entity_links WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return notFound(reply, 'العلاقة');
    await log(req, 'company.entity.link.remove', req.params.id);
    return { ok: true, warnings: await warningsNow() };
  });

  // ---- beneficial owners (entity_id null = whole group) ----
  const saveOwner = async (req, reply, id) => {
    const v = validateBeneficialOwner(req.body);
    if (v.error) return bad(reply, v.error);
    const o = v.value;
    if (o.employee_no) {
      const { rows: [emp] } = await db.query('SELECT full_name FROM employees WHERE employee_no = $1', [o.employee_no]);
      if (!emp) return bad(reply, 'الرقم الوظيفي غير موجود');
      if (!o.person_name_ar) o.person_name_ar = emp.full_name;
    }
    if (o.entity_id && !(await entitiesExist([o.entity_id]))) return bad(reply, 'الكيان غير موجود');
    try {
      if (id) {
        const r = await db.query(
          `UPDATE company_beneficial_owners SET entity_id=$2, person_name_ar=$3, person_name_en=$4, employee_no=$5, nationality=$6, id_no=$7, share_pct=$8, basis=$9, notes=$10, sort=$11, updated_at=now() WHERE id=$1`,
          [id, o.entity_id, o.person_name_ar, o.person_name_en, o.employee_no, o.nationality, o.id_no, o.share_pct, o.basis, o.notes, o.sort]);
        if (!r.rowCount) return notFound(reply, 'المستفيد');
        await log(req, 'company.beneficial.update', id, { person_name_ar: o.person_name_ar, share_pct: o.share_pct });
        return { ok: true, warnings: await warningsNow() };
      }
      const { rows: [r] } = await db.query(
        `INSERT INTO company_beneficial_owners (entity_id, person_name_ar, person_name_en, employee_no, nationality, id_no, share_pct, basis, notes, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [o.entity_id, o.person_name_ar, o.person_name_en, o.employee_no, o.nationality, o.id_no, o.share_pct, o.basis, o.notes, o.sort]);
      await log(req, 'company.beneficial.add', r.id, { person_name_ar: o.person_name_ar, share_pct: o.share_pct, entity_id: o.entity_id });
      return { ok: true, id: r.id, warnings: await warningsNow() };
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'هذا المستفيد مسجَّل مسبقًا في النطاق نفسه' });
      throw e;
    }
  };
  app.post('/api/admin/company/beneficial-owners', guard, (req, reply) => saveOwner(req, reply, null));
  app.put('/api/admin/company/beneficial-owners/:id', guard, (req, reply) => (validId(req.params.id) ? saveOwner(req, reply, req.params.id) : bad(reply, MSG.badRequest)));
  app.delete('/api/admin/company/beneficial-owners/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return bad(reply, MSG.badRequest);
    const r = await db.query('DELETE FROM company_beneficial_owners WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return notFound(reply, 'المستفيد');
    await log(req, 'company.beneficial.remove', req.params.id);
    return { ok: true, warnings: await warningsNow() };
  });
}
