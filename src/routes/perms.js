// Unified permissions tree: internal catalog/grants endpoints (proxy key) + admin tree API (admin role)
import { requireAdmin, MSG } from './helpers.js';
import { validateCatalog, branchKeys, unreviewedNodes, checkProxyKey, KEY_RE, SYSTEM_RE, MAX_KEY } from '../lib/perms.js';
import { employeeUsable } from '../lib/session.js';
import { audit } from '../lib/audit.js';
import { tx } from '../lib/db.js';

const UUID_RE = /^[0-9a-f-]{36}$/;
const MAX_BATCH = 2000;
const NODE_COLS = `key, system_key, parent_key, label_ar, description_ar, kind, sort, present, first_seen, last_seen`;

export default async function permsRoutes(app) {
  const { db, cfg } = app;

  // ---- internal (nginx exposes /_gw/* only on loopback and the tunnel) ----
  const proxyGuard = async (req, reply) => {
    const r = checkProxyKey(req.headers['x-gw-proxy-key'], cfg.proxyKey);
    reply.header('Cache-Control', 'no-store');
    if (r === 'unconfigured') { req.log.warn('GATEWAY_PROXY_KEY is not set; internal endpoint refused'); return reply.code(503).send({ error: 'الخدمة الداخلية غير مهيأة' }); }
    if (r !== 'ok') return reply.code(401).send({ error: MSG.forbidden });
  };

  // Catalog sync: upsert nodes of one system, mark present; nodes missing from the payload -> present=false (never deleted)
  app.post('/_gw/catalog', { preHandler: proxyGuard, logLevel: 'warn' }, async (req, reply) => {
    const v = validateCatalog(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const { system, nodes } = v.value;
    const { rows: [sys] } = await db.query('SELECT key, name_ar FROM systems WHERE key = $1', [system]);
    if (!sys) return reply.code(404).send({ error: 'النظام غير مسجل في البوابة' });
    const root = nodes[0];
    if (!root.label_ar) root.label_ar = sys.name_ar;
    const out = await tx(db, async (c) => {
      let added = 0;
      for (const n of nodes) {
        const { rows: [r] } = await c.query(
          `INSERT INTO perm_nodes (key, system_key, parent_key, label_ar, description_ar, kind, sort)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (key) DO UPDATE SET system_key = EXCLUDED.system_key, parent_key = EXCLUDED.parent_key,
             label_ar = EXCLUDED.label_ar, description_ar = EXCLUDED.description_ar, kind = EXCLUDED.kind,
             sort = EXCLUDED.sort, present = true, last_seen = now()
           RETURNING (xmax = 0) AS inserted`,
          [n.key, n.system_key, n.parent_key, n.label_ar, n.description_ar, n.kind, n.sort]);
        if (r.inserted) added++;
      }
      const retired = await c.query(
        'UPDATE perm_nodes SET present = false WHERE system_key = $1 AND present AND NOT (key = ANY($2::text[])) RETURNING key',
        [system, nodes.map((n) => n.key)]);
      await audit(c, { action: 'catalog.sync', target: system, ip: req.ip,
        meta: { nodes: nodes.length, added, retired: retired.rows.map((r) => r.key).slice(0, 200) } });
      return { ok: true, system, nodes: nodes.length, added, retired: retired.rowCount };
    });
    return out;
  });

  // Allowed keys for one employee (optionally one system). Absolute admin -> { admin: true }.
  app.get('/_gw/grants/:employee_no', { preHandler: proxyGuard, logLevel: 'warn' }, async (req, reply) => {
    const no = String(req.params.employee_no || '').trim();
    const system = req.query.system === undefined ? null : String(req.query.system).trim().toLowerCase();
    if (!/^\d{4}$/.test(no) || (system !== null && !SYSTEM_RE.test(system))) return reply.code(400).send({ error: MSG.badRequest });
    const { rows: [e] } = await db.query('SELECT id, role, active, expires_at FROM employees WHERE employee_no = $1', [no]);
    if (!e) return reply.code(404).send({ error: 'الموظف غير موجود' });
    const active = employeeUsable(e);
    if (!active) return { admin: false, active: false, employee_no: no, keys: [] };
    if (e.role === 'admin') return { admin: true, active: true, employee_no: no };
    const { rows } = await db.query(
      `SELECT g.perm_key FROM perm_grants g JOIN perm_nodes n ON n.key = g.perm_key
        WHERE g.employee_id = $1 AND g.allowed AND n.present AND ($2::text IS NULL OR n.system_key = $2)
        ORDER BY g.perm_key`, [e.id, system]);
    return { admin: false, active: true, employee_no: no, keys: rows.map((r) => r.perm_key) };
  });

  // ---- admin tree API ----
  const guard = { preHandler: requireAdmin(app) };
  const loadNodes = async () => (await db.query(
    `SELECT ${NODE_COLS}, (SELECT count(*)::int FROM perm_grants g WHERE g.perm_key = n.key AND g.allowed) AS grantees
       FROM perm_nodes n ORDER BY system_key, sort, key`)).rows;
  const loadEmployee = async (id) => (await db.query(
    'SELECT id, trim(employee_no) AS employee_no, full_name, role, active FROM employees WHERE id = $1', [id])).rows[0] || null;
  const validKey = (k) => typeof k === 'string' && k.length <= MAX_KEY && KEY_RE.test(k);

  // Whole tree + employees list + «new items» counter
  app.get('/api/admin/perms', guard, async () => {
    const [nodes, emps, systems] = await Promise.all([
      loadNodes(),
      db.query('SELECT id, trim(employee_no) AS employee_no, full_name, role, active FROM employees ORDER BY employee_no'),
      db.query('SELECT key, name_ar, icon FROM systems ORDER BY sort, key'),
    ]);
    return { nodes, employees: emps.rows, systems: systems.rows, new_count: unreviewedNodes(nodes).length };
  });

  // Allowed keys of one employee
  app.get('/api/admin/perms/:employee_id', guard, async (req, reply) => {
    if (!UUID_RE.test(req.params.employee_id)) return reply.code(400).send({ error: MSG.badRequest });
    const e = await loadEmployee(req.params.employee_id);
    if (!e) return reply.code(404).send({ error: 'الموظف غير موجود' });
    const { rows } = await db.query('SELECT perm_key FROM perm_grants WHERE employee_id = $1 AND allowed', [e.id]);
    return { employee: e, keys: rows.map((r) => r.perm_key) };
  });

  // Grant/revoke one key, or a list of keys (branch). allowed=false deletes the rows (absence = denied).
  app.put('/api/admin/perms', guard, async (req, reply) => {
    const b = req.body || {};
    const keys = Array.isArray(b.perm_keys) ? b.perm_keys : (b.perm_key !== undefined ? [b.perm_key] : []);
    if (!UUID_RE.test(String(b.employee_id)) || typeof b.allowed !== 'boolean' || !keys.length || keys.length > MAX_BATCH || !keys.every(validKey)) {
      return reply.code(400).send({ error: MSG.badRequest });
    }
    const e = await loadEmployee(b.employee_id);
    if (!e) return reply.code(404).send({ error: 'الموظف غير موجود' });
    if (e.role === 'admin') return reply.code(400).send({ error: 'المشرف العام المطلق يملك كل الصلاحيات ولا تُعدَّل شجرته' });
    const uniq = [...new Set(keys)];
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) || null : null;
    const n = await tx(db, async (c) => {
      let count;
      if (b.allowed) {
        const r = await c.query(
          `INSERT INTO perm_grants (employee_id, perm_key, allowed, granted_by, reason)
           SELECT $1, n.key, true, $2, $3 FROM perm_nodes n WHERE n.key = ANY($4::text[])
           ON CONFLICT (employee_id, perm_key) DO UPDATE SET allowed = true, granted_by = EXCLUDED.granted_by, granted_at = now(), reason = EXCLUDED.reason
           RETURNING perm_key`, [e.id, req.user.employee_id, reason, uniq]);
        count = r.rowCount;
        if (uniq.length === 1 && count === 0) throw Object.assign(new Error('no node'), { noNode: true });
      } else {
        const r = await c.query('DELETE FROM perm_grants WHERE employee_id = $1 AND perm_key = ANY($2::text[])', [e.id, uniq]);
        count = r.rowCount;
      }
      await audit(c, { actor: req.user.employee_id, action: b.allowed ? 'perm.grant' : 'perm.revoke', target: e.employee_no, ip: req.ip,
        meta: { keys: uniq.slice(0, 200), count, reason } });
      return count;
    }).catch((err) => { if (err.noNode) return null; throw err; });
    if (n === null) return reply.code(404).send({ error: 'العنصر غير موجود في الشجرة' });
    return { ok: true, count: n };
  });

  // Copy another employee's grants (replace or merge)
  app.post('/api/admin/perms/copy', guard, async (req, reply) => {
    const { from_employee_id: from, to_employee_id: to, mode = 'replace' } = req.body || {};
    if (!UUID_RE.test(String(from)) || !UUID_RE.test(String(to)) || from === to || !['replace', 'merge'].includes(mode)) {
      return reply.code(400).send({ error: MSG.badRequest });
    }
    const [src, dst] = await Promise.all([loadEmployee(from), loadEmployee(to)]);
    if (!src || !dst) return reply.code(404).send({ error: 'الموظف غير موجود' });
    if (dst.role === 'admin') return reply.code(400).send({ error: 'المشرف العام المطلق يملك كل الصلاحيات ولا تُعدَّل شجرته' });
    if (src.role === 'admin') return reply.code(400).send({ error: 'لا يمكن النسخ من مشرف عام مطلق؛ اختر موظفًا له صلاحيات محددة' });
    const count = await tx(db, async (c) => {
      if (mode === 'replace') await c.query('DELETE FROM perm_grants WHERE employee_id = $1', [dst.id]);
      const r = await c.query(
        `INSERT INTO perm_grants (employee_id, perm_key, allowed, granted_by, reason)
         SELECT $1, g.perm_key, true, $2, $3 FROM perm_grants g JOIN perm_nodes n ON n.key = g.perm_key
          WHERE g.employee_id = $4 AND g.allowed AND n.present
         ON CONFLICT (employee_id, perm_key) DO UPDATE SET allowed = true, granted_by = EXCLUDED.granted_by, granted_at = now(), reason = EXCLUDED.reason`,
        [dst.id, req.user.employee_id, `نسخ من ${src.employee_no}`, src.id]);
      await audit(c, { actor: req.user.employee_id, action: 'perm.copy', target: dst.employee_no, ip: req.ip, meta: { from: src.employee_no, mode, count: r.rowCount } });
      return r.rowCount;
    });
    return { ok: true, count };
  });

  // Branch keys for the UI (server-side truth, used by «تعليم الفرع كاملًا»)
  app.get('/api/admin/perms/branch/:key', guard, async (req, reply) => {
    if (!validKey(req.params.key)) return reply.code(400).send({ error: MSG.badRequest });
    const rows = (await db.query('SELECT key, parent_key, system_key, present FROM perm_nodes')).rows;
    return { keys: branchKeys(rows, req.params.key) };
  });

}
