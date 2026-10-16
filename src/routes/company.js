// «بيانات المنشأة»: قراءة لكل موظف (أرقام الهوية مقنّعة لغير المشرف) + تحرير للمشرف العام + إصدارات المستندات + فحص الصلاحيات
import { MSG, sendPage, currentUser, requireUser, requireAdmin } from './helpers.js';
import multipart from '@fastify/multipart';
import { maskOwners, maskBankAccounts, expiryAlerts, validateShares, validateProfile, validateOwner, validatePlatform, validateDelegation, validateDocument, validateVersion,
  validateBankAccount, PROFILE_TEXT, PROFILE_DATES } from '../lib/company.js';
import { runExpirySweep } from '../jobs/expiry-sweep.js';
import { audit } from '../lib/audit.js';
import { tx } from '../lib/db.js';
import { MAX_FILE_BYTES, mimeFor, safeName, storagePathFor, storeStream, openStored, removeStored, removeDocumentDir, contentDisposition } from '../lib/storage.js';

const UUID_RE = /^[0-9a-f-]{36}$/;
const D = (c) => `${c}::text AS ${c.split('.').pop()}`; // dates as YYYY-MM-DD strings (alias without the table prefix)
const PROFILE_COLS = `id, ${PROFILE_TEXT.join(', ')}, ${PROFILE_DATES.map(D).join(', ')}, capital::text AS capital, national_address, notes, updated_at`;
const OWNER_COLS = `id, name_ar, name_en, entity_kind, id_number, nationality, share_pct::text AS share_pct, role, ${D('since')}, notes, sort, updated_at`;
const PLATFORM_COLS = `p.id, p.name_ar, p.category, p.url, p.account_username, p.account_holder_id, p.role_ar, ${D('p.expiry_date')}, p.status, p.notes, p.quick_link_id,
  p.secret_node_key, p.secret_ref, p.sort, p.updated_at, e.full_name AS account_holder_name, q.title AS quick_link_title, q.url AS quick_link_url`;
const DELEGATION_COLS = `g.id, g.delegate_name, g.employee_id, g.platform_id, g.scope_ar, ${D('g.valid_from')}, ${D('g.valid_to')}, g.document_url, g.status, g.notes, g.updated_at,
  e.full_name AS employee_name, p.name_ar AS platform_name`;
const DOC_COLS = `d.id, d.entity_id, d.title_ar, d.kind, d.admin_only, d.doc_number, d.issuer_ar, d.file_url, d.file_name, ${D('d.issued_on')}, ${D('d.expires_on')}, COALESCE(d.is_unlimited, false) AS is_unlimited, d.notes, d.sort, d.created_at, d.updated_at`;
const VERSION_COLS = `v.id, v.document_id, v.version_no, v.file_url, v.file_name, ${D('v.issued_on')}, ${D('v.expires_on')}, COALESCE(v.is_unlimited, false) AS is_unlimited, v.uploaded_by, v.uploaded_at, v.notes, v.is_current,
  (v.storage_path IS NOT NULL) AS has_file, v.size::int AS size, v.mime, v.sha256, e.full_name AS uploaded_by_name`;
const BANK_COLS = `b.id, b.bank_name_ar, b.bank_name_en, b.account_name, b.iban, b.account_no, b.customer_no, b.swift, b.currency, b.account_type, b.branch, ${D('b.opened_on')}, b.status,
  b.signatories_ar, b.document_id, b.platform_id, b.secret_node_key, b.secret_ref, b.notes, b.sort, b.updated_at, d.title_ar AS document_title, p.name_ar AS platform_name`;
/** URL the UI uses to open/download a stored version. */
export const fileUrl = (docId, vid) => `/api/company/documents/${docId}/versions/${vid}/file`;

/** Expired / expiring-within-30-days count (tile badge). */
export async function countCompanyAlerts(db, now = new Date()) {
  const [{ rows: documents }, { rows: platforms }, { rows: delegations }] = await Promise.all([
    db.query('SELECT id, title_ar, expires_on::text AS expires_on FROM company_documents WHERE expires_on IS NOT NULL AND (is_unlimited IS NULL OR is_unlimited = false)'),
    db.query('SELECT id, name_ar, expiry_date::text AS expiry_date, status, account_holder_id FROM company_platforms WHERE expiry_date IS NOT NULL'),
    db.query('SELECT id, delegate_name, valid_to::text AS valid_to, status, employee_id FROM company_delegations WHERE valid_to IS NOT NULL'),
  ]);
  return expiryAlerts({ documents, platforms, delegations }, now).length;
}

export default async function companyRoutes(app) {
  const { db } = app;
  const log = (req, action, target, meta = {}) => audit(db, { actor: req.user?.employee_id ?? null, action, target, meta, ip: req.ip });
  // multipart only inside this plugin (document uploads); one file per request, size-capped
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10, fieldSize: 4000 } });
  const validId = (id) => UUID_RE.test(String(id || ''));

  app.get('/company', async (req, reply) => {
    const u = await currentUser(app, req);
    if (!u) return reply.redirect('/login?next=/company');
    return sendPage(reply, 'company.html');
  });

  const loadDocuments = async (admin) => {
    const [{ rows: docs }, { rows: versions }] = await Promise.all([
      db.query(`SELECT ${DOC_COLS} FROM company_documents d ORDER BY d.sort, d.title_ar`),
      db.query(`SELECT ${VERSION_COLS} FROM company_document_versions v LEFT JOIN employees e ON e.id = v.uploaded_by ORDER BY v.document_id, v.version_no DESC`),
    ]);
    const byDoc = new Map(docs.map((d) => [d.id, { ...d, versions: [] }]));
    for (const v of versions) byDoc.get(v.document_id)?.versions.push(v);
    // restricted documents: non-admins see the record (title, number, dates) but never the file
    if (!admin) for (const d of byDoc.values()) if (d.admin_only) {
      d.file_url = null; d.file_name = null;
      d.versions = d.versions.map((v) => ({ ...v, file_url: null, file_name: null, has_file: false, size: null, mime: null, sha256: null }));
    }
    return [...byDoc.values()];
  };

  // ---- read: every signed-in employee ----
  app.get('/api/company', { preHandler: requireUser(app) }, async (req) => {
    const admin = req.user.role === 'admin';
    const [{ rows: [profile] }, { rows: owners }, { rows: platforms }, { rows: delegations }, documents, { rows: employees }, { rows: banks }] = await Promise.all([
      db.query(`SELECT ${PROFILE_COLS} FROM company_profile WHERE id = 1`),
      db.query(`SELECT ${OWNER_COLS} FROM company_owners ORDER BY sort, name_ar`),
      db.query(`SELECT ${PLATFORM_COLS} FROM company_platforms p LEFT JOIN employees e ON e.id = p.account_holder_id LEFT JOIN quick_links q ON q.id = p.quick_link_id ORDER BY p.sort, p.name_ar`),
      db.query(`SELECT ${DELEGATION_COLS} FROM company_delegations g LEFT JOIN employees e ON e.id = g.employee_id LEFT JOIN company_platforms p ON p.id = g.platform_id ORDER BY g.status, g.valid_to NULLS LAST, g.delegate_name`),
      loadDocuments(admin),
      admin ? db.query('SELECT id, trim(employee_no) AS employee_no, full_name FROM employees WHERE active ORDER BY employee_no') : { rows: [] },
      db.query(`SELECT ${BANK_COLS} FROM company_bank_accounts b LEFT JOIN company_documents d ON d.id = b.document_id LEFT JOIN company_platforms p ON p.id = b.platform_id ORDER BY b.sort, b.bank_name_ar`),
    ]);
    const now = new Date();
    return {
      admin, profile: profile || null, owners: maskOwners(owners, admin), platforms, delegations, documents, employees, bank_accounts: maskBankAccounts(banks, admin),
      alerts: expiryAlerts({ documents, platforms, delegations }, now), shares: validateShares(owners),
      counts: { owners: owners.length, platforms: platforms.length, delegations: delegations.length, documents: documents.length, bank_accounts: banks.length }, server_now: now.toISOString(),
    };
  });

  // the stored file of a version: every signed-in employee; inline (preview) for PDF/images, ?download=1 forces a download
  app.get('/api/company/documents/:id/versions/:vid/file', { preHandler: requireUser(app) }, async (req, reply) => {
    if (!validId(req.params.id) || !validId(req.params.vid)) return reply.code(400).send({ error: MSG.badRequest });
    const { rows: [v] } = await db.query(
      `SELECT v.storage_path, v.file_name, v.mime, d.admin_only FROM company_document_versions v JOIN company_documents d ON d.id = v.document_id WHERE v.id = $1 AND v.document_id = $2`, [req.params.vid, req.params.id]);
    if (!v || !v.storage_path) return reply.code(404).send({ error: 'الملف غير موجود' });
    if (v.admin_only && req.user.role !== 'admin') return reply.code(403).send({ error: 'هذا المستند مقيّد للمشرف العام' });
    const f = await openStored(v.storage_path);
    if (!f) return reply.code(404).send({ error: 'الملف غير موجود على الخادم' });
    const inline = req.query?.download !== '1' && /^(application\/pdf|image\/)/.test(v.mime || '');
    return reply
      .header('Content-Type', v.mime || 'application/octet-stream')
      .header('Content-Length', f.size)
      .header('Content-Disposition', contentDisposition(v.file_name || 'file', inline))
      .header('X-Content-Type-Options', 'nosniff')
      .send(f.stream);
  });

  // ---- admin writes ----
  const guard = { preHandler: requireAdmin(app) };
  const notFound = (reply, what) => reply.code(404).send({ error: `${what} غير موجود` });

  app.put('/api/admin/company/profile', guard, async (req, reply) => {
    const v = validateProfile(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const keys = Object.keys(v.value);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const vals = keys.map((k) => (k === 'national_address' ? JSON.stringify(v.value[k]) : v.value[k]));
    await db.query(
      `INSERT INTO company_profile (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await db.query(`UPDATE company_profile SET ${sets}, updated_by = $${keys.length + 1}, updated_at = now() WHERE id = 1`, [...vals, req.user.employee_id]);
    await log(req, 'company.profile.update', 'profile', { fields: keys });
    return { ok: true };
  });

  // owners
  app.post('/api/admin/company/owners', guard, async (req, reply) => {
    const v = validateOwner(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const { rows: others } = await db.query('SELECT share_pct FROM company_owners');
    const s = validateShares([...others, v.value]);
    if (!s.ok) return reply.code(400).send({ error: s.error });
    const o = v.value;
    const { rows: [r] } = await db.query(
      `INSERT INTO company_owners (name_ar, name_en, entity_kind, id_number, nationality, share_pct, role, since, notes, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [o.name_ar, o.name_en, o.entity_kind, o.id_number, o.nationality, o.share_pct, o.role, o.since, o.notes, o.sort]);
    await log(req, 'company.owner.add', r.id, { name_ar: o.name_ar, role: o.role });
    return { ok: true, id: r.id };
  });
  app.put('/api/admin/company/owners/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const v = validateOwner(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const { rows: others } = await db.query('SELECT share_pct FROM company_owners WHERE id <> $1', [req.params.id]);
    const s = validateShares([...others, v.value]);
    if (!s.ok) return reply.code(400).send({ error: s.error });
    const o = v.value;
    const r = await db.query(
      `UPDATE company_owners SET name_ar=$2, name_en=$3, entity_kind=$4, id_number=$5, nationality=$6, share_pct=$7, role=$8, since=$9, notes=$10, sort=$11, updated_at=now() WHERE id=$1`,
      [req.params.id, o.name_ar, o.name_en, o.entity_kind, o.id_number, o.nationality, o.share_pct, o.role, o.since, o.notes, o.sort]);
    if (!r.rowCount) return notFound(reply, 'المالك');
    await log(req, 'company.owner.update', req.params.id, { name_ar: o.name_ar });
    return { ok: true };
  });
  app.delete('/api/admin/company/owners/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const r = await db.query('DELETE FROM company_owners WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return notFound(reply, 'المالك');
    await log(req, 'company.owner.remove', req.params.id);
    return { ok: true };
  });

  // platforms
  const platformVals = (p) => [p.name_ar, p.category, p.url, p.account_username, p.account_holder_id, p.role_ar, p.expiry_date, p.status, p.notes, p.quick_link_id, p.secret_node_key, p.secret_ref, p.sort];
  app.post('/api/admin/company/platforms', guard, async (req, reply) => {
    const v = validatePlatform(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const { rows: [r] } = await db.query(
      `INSERT INTO company_platforms (name_ar, category, url, account_username, account_holder_id, role_ar, expiry_date, status, notes, quick_link_id, secret_node_key, secret_ref, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (name_ar) DO NOTHING RETURNING id`, platformVals(v.value));
    if (!r) return reply.code(409).send({ error: 'يوجد منصة بهذا الاسم' });
    await log(req, 'company.platform.add', r.id, { name_ar: v.value.name_ar });
    return { ok: true, id: r.id };
  });
  app.put('/api/admin/company/platforms/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const v = validatePlatform(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const { rows: [dup] } = await db.query('SELECT 1 FROM company_platforms WHERE name_ar = $1 AND id <> $2', [v.value.name_ar, req.params.id]);
    if (dup) return reply.code(409).send({ error: 'يوجد منصة بهذا الاسم' });
    const r = await db.query(
      `UPDATE company_platforms SET name_ar=$2, category=$3, url=$4, account_username=$5, account_holder_id=$6, role_ar=$7, expiry_date=$8, status=$9, notes=$10, quick_link_id=$11,
         secret_node_key=$12, secret_ref=$13, sort=$14, updated_at=now() WHERE id=$1`, [req.params.id, ...platformVals(v.value)]);
    if (!r.rowCount) return notFound(reply, 'المنصة');
    await log(req, 'company.platform.update', req.params.id, { name_ar: v.value.name_ar });
    return { ok: true };
  });
  app.delete('/api/admin/company/platforms/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const r = await db.query('DELETE FROM company_platforms WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return notFound(reply, 'المنصة');
    await log(req, 'company.platform.remove', req.params.id);
    return { ok: true };
  });

  // delegations
  const delegationVals = (g) => [g.delegate_name, g.employee_id, g.platform_id, g.scope_ar, g.valid_from, g.valid_to, g.document_url, g.status, g.notes];
  app.post('/api/admin/company/delegations', guard, async (req, reply) => {
    const v = validateDelegation(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const { rows: [r] } = await db.query(
      `INSERT INTO company_delegations (delegate_name, employee_id, platform_id, scope_ar, valid_from, valid_to, document_url, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      delegationVals(v.value));
    await log(req, 'company.delegation.add', r.id, { delegate_name: v.value.delegate_name });
    return { ok: true, id: r.id };
  });
  app.put('/api/admin/company/delegations/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const v = validateDelegation(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const r = await db.query(
      `UPDATE company_delegations SET delegate_name=$2, employee_id=$3, platform_id=$4, scope_ar=$5, valid_from=$6, valid_to=$7, document_url=$8, status=$9, notes=$10, updated_at=now() WHERE id=$1`,
      [req.params.id, ...delegationVals(v.value)]);
    if (!r.rowCount) return notFound(reply, 'التفويض');
    await log(req, 'company.delegation.update', req.params.id, { delegate_name: v.value.delegate_name });
    return { ok: true };
  });
  app.delete('/api/admin/company/delegations/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const r = await db.query('DELETE FROM company_delegations WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return notFound(reply, 'التفويض');
    await log(req, 'company.delegation.remove', req.params.id);
    return { ok: true };
  });

  // documents (metadata) — the file/dates live in versions; a new document may carry its first version inline
  const syncCurrent = async (c, docId) => {
    await c.query(
      `UPDATE company_documents d SET file_url = v.file_url, file_name = v.file_name, issued_on = v.issued_on, expires_on = v.expires_on, is_unlimited = COALESCE(v.is_unlimited, false), updated_at = now()
         FROM company_document_versions v WHERE v.document_id = d.id AND v.is_current AND d.id = $1`, [docId]);
  };
  // ver: { file_url, file_name, issued_on, expires_on, notes, is_unlimited }; file (optional): { stream, name, mime } stored under files/company/<doc>/<n>-<name>
  const addVersion = async (c, docId, ver, actor, file = null, makeCurrent = true) => {
    const { rows: [m] } = await c.query('SELECT COALESCE(max(version_no), 0) + 1 AS n FROM company_document_versions WHERE document_id = $1', [docId]);
    const n = Number(m.n);
    const stored = file ? await storeStream(storagePathFor(docId, n, file.name), file.stream) : null;
    if (makeCurrent) await c.query('UPDATE company_document_versions SET is_current = false WHERE document_id = $1 AND is_current', [docId]);
    const isUnlimited = ver.is_unlimited === true || ver.is_unlimited === 'true';
    const expiresOn = isUnlimited ? null : ver.expires_on;
    const { rows: [r] } = await c.query(
      `INSERT INTO company_document_versions (document_id, version_no, file_url, file_name, issued_on, expires_on, is_unlimited, uploaded_by, notes, is_current, storage_path, size, sha256, mime)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, version_no`,
      [docId, n, ver.file_url, file ? safeName(file.name) : ver.file_name, ver.issued_on, expiresOn, isUnlimited, actor, ver.notes, makeCurrent,
        stored?.storage_path ?? null, stored?.size ?? null, stored?.sha256 ?? null, file?.mime ?? null]);
    if (stored) await c.query('UPDATE company_document_versions SET file_url = $2 WHERE id = $1', [r.id, fileUrl(docId, r.id)]);
    await syncCurrent(c, docId);
    return r;
  };
  /** One multipart request: text fields -> body, the single file -> { stream, name, mime }. Fields must precede the file (the UI builds the form that way). */
  const readUpload = async (req) => {
    const body = {};
    let file = null;
    for await (const part of req.parts()) {
      if (part.type !== 'file') { body[part.fieldname] = part.value; continue; }
      if (!part.filename) { part.file.resume(); continue; }
      const mime = mimeFor(part.filename);
      if (!mime) { part.file.resume(); throw Object.assign(new Error('نوع الملف غير مسموح (PDF أو صورة أو Word/Excel)'), { statusCode: 400 }); }
      file = { stream: part.file, name: part.filename, mime };
      break; // the stream is consumed by the caller; nothing else is read from this request
    }
    return { body, file };
  };
  // admin + multipart (requireAdmin insists on JSON for writes; this mirrors it for uploads)
  const requireAdminUpload = async (req, reply) => {
    req.user = await currentUser(app, req);
    if (!req.user) return reply.code(401).send({ error: MSG.auth });
    if (req.user.role !== 'admin') return reply.code(403).send({ error: MSG.forbidden });
    if (!req.isMultipart()) return reply.code(415).send({ error: MSG.badRequest });
  };
  // the entity a document belongs to: the given one (must exist) or, when omitted/null, the main (profile-linked) entity
  const resolveEntity = async (entityId) => {
    if (entityId) {
      const { rows: [e] } = await db.query('SELECT id FROM company_entities WHERE id = $1', [entityId]);
      return e ? e.id : false;
    }
    const { rows: [p] } = await db.query('SELECT id FROM company_entities WHERE profile_id IS NOT NULL ORDER BY sort LIMIT 1');
    return p ? p.id : null;
  };
  const createDocument = async (req, reply, forcedEntityId = undefined) => {
    const body = forcedEntityId ? { ...req.body, entity_id: forcedEntityId } : req.body;
    const v = validateDocument(body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const ver = body?.version !== undefined ? validateVersion(body.version) : { value: null };
    if (ver.error) return reply.code(400).send({ error: ver.error });
    const d = v.value;
    const entityId = await resolveEntity(d.entity_id);
    if (entityId === false) return reply.code(400).send({ error: 'الكيان غير موجود' });
    const out = await tx(db, async (c) => {
      const { rows: [r] } = await c.query('INSERT INTO company_documents (title_ar, kind, doc_number, issuer_ar, admin_only, notes, sort, entity_id, is_unlimited) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [d.title_ar, d.kind, d.doc_number, d.issuer_ar, d.admin_only, d.notes, d.sort, entityId, d.is_unlimited || false]);
      if (ver.value) await addVersion(c, r.id, ver.value, req.user.employee_id);
      return r;
    });
    await log(req, 'company.document.add', out.id, { title_ar: d.title_ar, kind: d.kind, entity_id: entityId });
    return { ok: true, id: out.id, entity_id: entityId };
  };
  app.post('/api/admin/company/documents', guard, (req, reply) => createDocument(req, reply));
  // a document folder per entity: same as above with the entity taken from the path (upload its file afterwards via …/documents/:id/versions)
  app.post('/api/admin/company/entities/:id/documents', guard, (req, reply) => (validId(req.params.id) ? createDocument(req, reply, req.params.id) : reply.code(400).send({ error: MSG.badRequest })));
  app.put('/api/admin/company/documents/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const v = validateDocument(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const d = v.value;
    // entity_id omitted -> unchanged; given (or null = main entity) -> moves the document to that entity
    const moveTo = d.entity_id === undefined ? undefined : await resolveEntity(d.entity_id);
    if (moveTo === false) return reply.code(400).send({ error: 'الكيان غير موجود' });
    const r = await db.query('UPDATE company_documents SET title_ar=$2, kind=$3, doc_number=$4, issuer_ar=$5, admin_only=$6, notes=$7, sort=$8, is_unlimited=$9, entity_id=CASE WHEN $10::boolean THEN $11::uuid ELSE entity_id END, updated_at=now() WHERE id=$1',
      [req.params.id, d.title_ar, d.kind, d.doc_number, d.issuer_ar, d.admin_only, d.notes, d.sort, d.is_unlimited || false, moveTo !== undefined, moveTo ?? null]);
    if (!r.rowCount) return notFound(reply, 'المستند');
    await log(req, 'company.document.update', req.params.id, { title_ar: d.title_ar, ...(moveTo ? { entity_id: moveTo } : {}) });
    return { ok: true };
  });
  app.delete('/api/admin/company/documents/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const r = await db.query('DELETE FROM company_documents WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return notFound(reply, 'المستند');
    await removeDocumentDir(req.params.id).catch((e) => req.log.warn({ err: e }, 'document dir cleanup failed'));
    await log(req, 'company.document.remove', req.params.id);
    return { ok: true };
  });

  // versions: add (becomes current), set current / edit notes+dates, delete (current -> latest remaining becomes current)
  // JSON body (link/metadata only) or multipart (text fields + one file stored on disk); is_current=false keeps it as history
  app.post('/api/admin/company/documents/:id/versions', { preHandler: (req, reply) => (req.isMultipart() ? requireAdminUpload : requireAdmin(app))(req, reply) }, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const { rows: [doc] } = await db.query('SELECT id FROM company_documents WHERE id = $1', [req.params.id]);
    if (!doc) return notFound(reply, 'المستند');
    let body = req.body, file = null;
    if (req.isMultipart()) {
      try { ({ body, file } = await readUpload(req)); }
      catch (e) { if (e.statusCode === 400) return reply.code(400).send({ error: e.message }); throw e; }
    }
    const v = validateVersion(body);
    if (v.error) { file?.stream.resume(); return reply.code(400).send({ error: v.error }); }
    const makeCurrent = !(body?.is_current === false || body?.is_current === 'false');
    let r;
    try { r = await tx(db, (c) => addVersion(c, doc.id, v.value, req.user.employee_id, file, makeCurrent)); }
    catch (e) {
      if (e.code === 'FILE_TOO_LARGE' || e.code === 'FST_REQ_FILE_TOO_LARGE' || file?.stream.truncated) return reply.code(413).send({ error: 'الملف أكبر من الحد المسموح (25 م.ب)' });
      throw e;
    }
    await log(req, 'company.document.version.add', doc.id, { version_no: r.version_no, file_name: file ? safeName(file.name) : v.value.file_name, uploaded: !!file });
    return { ok: true, id: r.id, version_no: r.version_no };
  });
  app.put('/api/admin/company/documents/:id/versions/:vid', guard, async (req, reply) => {
    if (!validId(req.params.id) || !validId(req.params.vid)) return reply.code(400).send({ error: MSG.badRequest });
    const v = validateVersion(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const makeCurrent = req.body?.is_current === true;
    const ok = await tx(db, async (c) => {
      // a stored file keeps its URL; its display name may be renamed but not blanked
      const isUnlimited = v.value.is_unlimited === true || v.value.is_unlimited === 'true';
      const expiresOn = isUnlimited ? null : v.value.expires_on;
      const r = await c.query(
        `UPDATE company_document_versions SET file_url = CASE WHEN storage_path IS NULL THEN $3 ELSE file_url END, file_name = CASE WHEN storage_path IS NULL THEN $4 ELSE COALESCE($4, file_name) END,
           issued_on=$5, expires_on=$6, is_unlimited=$7, notes=$8 WHERE id=$2 AND document_id=$1`,
        [req.params.id, req.params.vid, v.value.file_url, v.value.file_name, v.value.issued_on, expiresOn, isUnlimited, v.value.notes]);
      if (!r.rowCount) return false;
      if (makeCurrent) {
        await c.query('UPDATE company_document_versions SET is_current = false WHERE document_id = $1 AND is_current AND id <> $2', [req.params.id, req.params.vid]);
        await c.query('UPDATE company_document_versions SET is_current = true WHERE id = $1', [req.params.vid]);
      }
      await syncCurrent(c, req.params.id);
      return true;
    });
    if (!ok) return notFound(reply, 'الإصدار');
    await log(req, 'company.document.version.update', req.params.vid, { document_id: req.params.id, is_current: makeCurrent });
    return { ok: true };
  });
  app.delete('/api/admin/company/documents/:id/versions/:vid', guard, async (req, reply) => {
    if (!validId(req.params.id) || !validId(req.params.vid)) return reply.code(400).send({ error: MSG.badRequest });
    let storagePath = null;
    const ok = await tx(db, async (c) => {
      const r = await c.query('DELETE FROM company_document_versions WHERE id = $1 AND document_id = $2 RETURNING is_current, storage_path', [req.params.vid, req.params.id]);
      if (!r.rowCount) return false;
      storagePath = r.rows[0].storage_path;
      if (r.rows[0].is_current) {
        await c.query(
          `UPDATE company_document_versions SET is_current = true WHERE id = (SELECT id FROM company_document_versions WHERE document_id = $1 ORDER BY version_no DESC LIMIT 1)`, [req.params.id]);
        const { rows: [left] } = await c.query('SELECT 1 FROM company_document_versions WHERE document_id = $1 AND is_current', [req.params.id]);
        if (left) await syncCurrent(c, req.params.id);
        else await c.query('UPDATE company_documents SET file_url = NULL, file_name = NULL, issued_on = NULL, expires_on = NULL, updated_at = now() WHERE id = $1', [req.params.id]);
      }
      return true;
    });
    if (!ok) return notFound(reply, 'الإصدار');
    await removeStored(storagePath).catch((e) => req.log.warn({ err: e }, 'version file cleanup failed'));
    await log(req, 'company.document.version.remove', req.params.vid, { document_id: req.params.id });
    return { ok: true };
  });

  // bank accounts (admin writes; everyone reads masked via GET /api/company)
  const bankVals = (b) => [b.bank_name_ar, b.bank_name_en, b.account_name, b.iban, b.account_no, b.customer_no, b.swift, b.currency, b.account_type, b.branch, b.opened_on, b.status,
    b.signatories_ar, b.document_id, b.platform_id, b.secret_node_key, b.secret_ref, b.notes, b.sort];
  app.post('/api/admin/company/bank-accounts', guard, async (req, reply) => {
    const v = validateBankAccount(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const { rows: [r] } = await db.query(
      `INSERT INTO company_bank_accounts (bank_name_ar, bank_name_en, account_name, iban, account_no, customer_no, swift, currency, account_type, branch, opened_on, status, signatories_ar, document_id, platform_id,
         secret_node_key, secret_ref, notes, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`, bankVals(v.value));
    await log(req, 'company.bank.add', r.id, { bank_name_ar: v.value.bank_name_ar });
    return { ok: true, id: r.id };
  });
  app.put('/api/admin/company/bank-accounts/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const v = validateBankAccount(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const r = await db.query(
      `UPDATE company_bank_accounts SET bank_name_ar=$2, bank_name_en=$3, account_name=$4, iban=$5, account_no=$6, customer_no=$7, swift=$8, currency=$9, account_type=$10, branch=$11, opened_on=$12,
         status=$13, signatories_ar=$14, document_id=$15, platform_id=$16, secret_node_key=$17, secret_ref=$18, notes=$19, sort=$20, updated_at=now() WHERE id=$1`, [req.params.id, ...bankVals(v.value)]);
    if (!r.rowCount) return notFound(reply, 'الحساب البنكي');
    await log(req, 'company.bank.update', req.params.id, { bank_name_ar: v.value.bank_name_ar });
    return { ok: true };
  });
  app.delete('/api/admin/company/bank-accounts/:id', guard, async (req, reply) => {
    if (!validId(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const r = await db.query('DELETE FROM company_bank_accounts WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return notFound(reply, 'الحساب البنكي');
    await log(req, 'company.bank.remove', req.params.id);
    return { ok: true };
  });

  // run the daily expiry sweep now
  app.post('/api/admin/company/sweep', guard, async (req) => {
    const out = await runExpirySweep(db);
    await log(req, 'company.sweep', 'company', out);
    return { ok: true, ...out };
  });
}
