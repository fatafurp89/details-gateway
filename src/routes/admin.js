// Admin API (admin role only, JSON only, every change audited)
import { requireAdmin, MSG } from './helpers.js';
import { validateEmployee, validateSystem, validateHrEmployee } from '../lib/validate.js';
import { checkProxyKey } from '../lib/perms.js';
import { audit } from '../lib/audit.js';
import { tx } from '../lib/db.js';
import { smtpConfigured, sendMail, renderTestEmail } from '../lib/mail.js';
import { googleConfigured } from '../lib/google.js';

const EMP_COLS = ['employee_no', 'full_name', 'mobile', 'email', 'google_email', 'role', 'active', 'expires_at'];
const SYS_COLS = ['name_ar', 'description_ar', 'icon', 'host', 'mode', 'upstream', 'status', 'sort', 'requires_grant', 'placement'];
const UUID_RE = /^[0-9a-f-]{36}$/;
// سياسة: إنشاء الموظفين من البوابة غير مسموح؛ الموارد البشرية هي المصدر الوحيد
const MSG_HR_ONLY = 'إضافة الموظفين تتم من نظام «الموارد البشرية» فقط؛ البوابة تستقبلهم تلقائيًا بالمزامنة.';

export default async function adminRoutes(app) {
  const { db, cfg, settings } = app;
  const guard = { preHandler: requireAdmin(app) };
  const proxyGuard = async (req, reply) => {
    const r = checkProxyKey(req.headers['x-gw-proxy-key'], cfg.proxyKey);
    reply.header('Cache-Control', 'no-store');
    if (r === 'unconfigured') { req.log.warn('GATEWAY_PROXY_KEY is not set; internal endpoint refused'); return reply.code(503).send({ error: 'الخدمة الداخلية غير مهيأة' }); }
    if (r !== 'ok') return reply.code(401).send({ error: MSG.forbidden });
  };
  const log = (req, action, target, meta = {}) => audit(db, { actor: req.user.employee_id, action, target, meta, ip: req.ip });
  // Map unique violations to a readable message
  const conflict = (reply, e) => {
    if (e.code === '23505') return reply.code(409).send({ error: 'القيمة مستخدمة لموظف آخر (الرقم أو البريد)' });
    throw e;
  };

  // ---- employees ----
  app.get('/api/admin/employees', guard, async () => {
    const { rows } = await db.query(
      `SELECT e.id, trim(e.employee_no) AS employee_no, e.full_name, e.mobile, e.email, e.google_email, e.role,
              e.active, e.expires_at, (SELECT max(created_at) FROM sessions s WHERE s.employee_id = e.id) AS last_login
         FROM employees e ORDER BY e.employee_no`);
    return rows;
  });

  // Disabled by policy: employees are created in HR only (synced through /_gw/employees/upsert)
  app.post('/api/admin/employees', guard, async (req, reply) => reply.code(403).send({ error: MSG_HR_ONLY }));

  app.put('/api/admin/employees/:id', guard, async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const v = validateEmployee(req.body || {});
    if (v.error) return reply.code(400).send({ error: v.error });
    if (req.params.id === req.user.employee_id && (v.value.role !== 'admin' || !v.value.active)) {
      return reply.code(400).send({ error: 'لا يمكنك تعطيل حسابك أو إزالة صلاحية الإدارة عن نفسك' });
    }
    // حماية ذاتية: لا يمكن تعطيل آخر مدير نشط أو إزالة صلاحيته
    if (v.value.role !== 'admin' || !v.value.active) {
      const { rows: [a] } = await db.query("SELECT count(*)::int AS n FROM employees WHERE role = 'admin' AND active AND id <> $1", [req.params.id]);
      const { rows: [cur] } = await db.query('SELECT role, active FROM employees WHERE id = $1', [req.params.id]);
      if (cur && cur.role === 'admin' && cur.active && a.n === 0) return reply.code(400).send({ error: 'هذا آخر مدير نشط في البوابة، لا يمكن تعطيله أو إزالة صلاحيته' });
    }
    try {
      const sets = EMP_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const r = await db.query(`UPDATE employees SET ${sets}, updated_at = now() WHERE id = $1`,
        [req.params.id, ...EMP_COLS.map((c) => v.value[c])]);
      if (!r.rowCount) return reply.code(404).send({ error: 'الموظف غير موجود' });
      if (!v.value.active) await db.query('UPDATE sessions SET revoked_at = now() WHERE employee_id = $1 AND revoked_at IS NULL', [req.params.id]);
      await log(req, 'employee.update', v.value.employee_no, v.value);
      return { ok: true };
    } catch (e) { return conflict(reply, e); }
  });

  // Disabled by policy (CSV import): HR is the single source of employees
  app.post('/api/admin/employees/import', guard, async (req, reply) => reply.code(403).send({ error: MSG_HR_ONLY }));

  // ---- internal: HR sync (nginx exposes /_gw/* only on loopback and the tunnel) ----
  // Never touches role; never deactivates the last active admin.
  const lastAdminGuard = async (c, employeeNo) => {
    const { rows: [cur] } = await c.query('SELECT id, role, active FROM employees WHERE employee_no = $1', [employeeNo]);
    if (!cur || cur.role !== 'admin' || !cur.active) return null;
    const { rows: [a] } = await c.query("SELECT count(*)::int AS n FROM employees WHERE role = 'admin' AND active AND id <> $1", [cur.id]);
    return a.n === 0 ? 'هذا آخر مدير نشط في البوابة؛ لا يمكن تعطيله من المزامنة' : null;
  };
  app.post('/_gw/employees/upsert', { preHandler: proxyGuard, logLevel: 'warn' }, async (req, reply) => {
    const v = validateHrEmployee(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const e = v.value;
    try {
      const out = await tx(db, async (c) => {
        if (e.active === false) { const err = await lastAdminGuard(c, e.employee_no); if (err) return { err }; }
        const { rows: [cur] } = await c.query('SELECT id FROM employees WHERE employee_no = $1', [e.employee_no]);
        if (!cur) {
          const { rows: [r] } = await c.query(
            `INSERT INTO employees (employee_no, full_name, mobile, email, google_email, role, active, expires_at, photo_url, hr_meta, hr_synced_at)
             VALUES ($1, $2, $3, $4, $5, 'user', $6, $7, $8, $9, now()) RETURNING id`,
            [e.employee_no, e.full_name, e.mobile ?? null, e.email ?? null, e.google_email ?? null, e.active ?? true, e.expires_at ?? null, e.photo_url ?? null, JSON.stringify(e.hr_meta || {})]);
          await audit(c, { action: 'employee.hr.create', target: e.employee_no, meta: { fields: Object.keys(e) }, ip: req.ip });
          return { id: r.id, created: true };
        }
        const sets = ['full_name = $2', 'hr_synced_at = now()', 'updated_at = now()'];
        const vals = [cur.id, e.full_name];
        for (const k of ['mobile', 'email', 'google_email', 'photo_url', 'active', 'expires_at']) {
          if (e[k] === undefined) continue;
          vals.push(e[k]); sets.push(`${k} = $${vals.length}`);
        }
        if (e.hr_meta) { vals.push(JSON.stringify(e.hr_meta)); sets.push(`hr_meta = hr_meta || $${vals.length}::jsonb`); }
        await c.query(`UPDATE employees SET ${sets.join(', ')} WHERE id = $1`, vals);
        if (e.active === false) await c.query('UPDATE sessions SET revoked_at = now() WHERE employee_id = $1 AND revoked_at IS NULL', [cur.id]);
        await audit(c, { action: 'employee.hr.update', target: e.employee_no, meta: { fields: Object.keys(e) }, ip: req.ip });
        return { id: cur.id, created: false };
      });
      if (out.err) return reply.code(409).send({ error: out.err });
      return { ok: true, ...out };
    } catch (err) { return conflict(reply, err); }
  });
  app.post('/_gw/employees/deactivate', { preHandler: proxyGuard, logLevel: 'warn' }, async (req, reply) => {
    const no = String(req.body?.employee_no ?? '').trim();
    if (!/^\d{4}$/.test(no)) return reply.code(400).send({ error: 'الرقم الوظيفي يجب أن يكون أربعة أرقام' });
    const out = await tx(db, async (c) => {
      const err = await lastAdminGuard(c, no);
      if (err) return { err };
      const r = await c.query('UPDATE employees SET active = false, hr_synced_at = now(), updated_at = now() WHERE employee_no = $1 RETURNING id', [no]);
      if (!r.rowCount) return { missing: true };
      await c.query('UPDATE sessions SET revoked_at = now() WHERE employee_id = $1 AND revoked_at IS NULL', [r.rows[0].id]);
      await audit(c, { action: 'employee.hr.deactivate', target: no, ip: req.ip });
      return { id: r.rows[0].id };
    });
    if (out.err) return reply.code(409).send({ error: out.err });
    if (out.missing) return reply.code(404).send({ error: 'الموظف غير موجود' });
    return { ok: true, id: out.id };
  });

  // ---- grants ----
  app.get('/api/admin/grants', guard, async () => {
    const [emps, systems, grants] = await Promise.all([
      db.query('SELECT id, trim(employee_no) AS employee_no, full_name, role, active FROM employees ORDER BY employee_no'),
      db.query('SELECT key, name_ar FROM systems ORDER BY sort, key'),
      db.query('SELECT employee_id, system_key, level FROM grants'),
    ]);
    return { employees: emps.rows, systems: systems.rows, grants: grants.rows };
  });

  app.put('/api/admin/grants', guard, async (req, reply) => {
    const { employee_id: emp, system_key: key, level } = req.body || {};
    if (!UUID_RE.test(String(emp)) || typeof key !== 'string' || ![null, 'use', 'admin'].includes(level ?? null)) {
      return reply.code(400).send({ error: MSG.badRequest });
    }
    if (level) {
      await db.query(
        `INSERT INTO grants (employee_id, system_key, level, granted_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_id, system_key) DO UPDATE SET level = EXCLUDED.level, granted_by = EXCLUDED.granted_by, granted_at = now()`,
        [emp, key, level, req.user.employee_id]);
    } else {
      await db.query('DELETE FROM grants WHERE employee_id = $1 AND system_key = $2', [emp, key]);
    }
    await log(req, level ? 'grant.set' : 'grant.revoke', `${emp}:${key}`, { level: level || null });
    return { ok: true };
  });

  // ---- systems ----
  app.get('/api/admin/systems', guard, async () => (await db.query('SELECT * FROM systems ORDER BY sort, key')).rows);

  app.post('/api/admin/systems', guard, async (req, reply) => {
    const v = validateSystem(req.body || {});
    if (v.error) return reply.code(400).send({ error: v.error });
    const r = await db.query(
      `INSERT INTO systems (key, ${SYS_COLS.join(', ')}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [v.value.key, ...SYS_COLS.map((c) => v.value[c])]);
    if (!r.rowCount) return reply.code(409).send({ error: 'مفتاح النظام مستخدم' });
    await log(req, 'system.create', v.value.key, v.value);
    return { ok: true };
  });

  app.put('/api/admin/systems/:key', guard, async (req, reply) => {
    const v = validateSystem({ ...(req.body || {}), key: req.params.key });
    if (v.error) return reply.code(400).send({ error: v.error });
    const sets = SYS_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const r = await db.query(`UPDATE systems SET ${sets} WHERE key = $1`, [v.value.key, ...SYS_COLS.map((c) => v.value[c])]);
    if (!r.rowCount) return reply.code(404).send({ error: 'النظام غير موجود' });
    await log(req, 'system.update', v.value.key, v.value);
    return { ok: true };
  });

  // ---- sessions ----
  app.get('/api/admin/sessions', guard, async () => (await db.query(
    `SELECT s.id, trim(e.employee_no) AS employee_no, e.full_name, s.created_at, s.last_seen_at, s.expires_at,
            host(s.ip) AS ip, s.user_agent
       FROM sessions s JOIN employees e ON e.id = s.employee_id
      WHERE s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - interval '30 minutes'
      ORDER BY s.last_seen_at DESC LIMIT 500`)).rows);

  app.post('/api/admin/sessions/:id/revoke', guard, async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [req.params.id]);
    await log(req, 'session.revoke', req.params.id);
    return { ok: true };
  });

  // ---- logs (filters: q text, from/to dates) ----
  function filters(q, textCols, ts = 'created_at') {
    const where = [], args = [];
    if (q.q) { args.push(`%${String(q.q).slice(0, 100)}%`); where.push(`(${textCols.map((c) => `${c} ILIKE $${args.length}`).join(' OR ')})`); }
    if (q.from && !Number.isNaN(Date.parse(q.from))) { args.push(q.from); where.push(`${ts} >= ${args.length}`); }
    if (q.to && !Number.isNaN(Date.parse(q.to))) { args.push(q.to); where.push(`${ts} < ${args.length}::date + 1`); }
    if (q.ok === 'true' || q.ok === 'false') { args.push(q.ok === 'true'); where.push(`ok = $${args.length}`); }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
  }

  app.get('/api/admin/audit', guard, async (req) => {
    const f = filters(req.query, ['a.action', 'a.target', 'e.full_name', 'trim(e.employee_no)'], 'a.created_at');
    return (await db.query(
      `SELECT a.id, a.created_at, a.action, a.target, a.meta, host(a.ip) AS ip, e.full_name AS actor
         FROM audit_log a LEFT JOIN employees e ON e.id = a.actor_employee_id
         ${f.sql} ORDER BY a.id DESC LIMIT 500`, f.args)).rows;
  });

  app.get('/api/admin/attempts', guard, async (req) => {
    const f = filters(req.query, ['identifier', 'reason', 'host(ip)']);
    return (await db.query(
      `SELECT id, created_at, identifier, host(ip) AS ip, ok, reason FROM login_attempts ${f.sql} ORDER BY id DESC LIMIT 500`,
      f.args)).rows;
  });

  // ---- settings ----
  app.get('/api/admin/settings', guard, async (req) => {
    const smtp = await settings.smtp();
    return { smtp: { configured: smtpConfigured(smtp), host: smtp.host, source: smtp.password_source }, google: { configured: googleConfigured(cfg.google) }, admin_email: req.user.email };
  });

  app.post('/api/admin/settings/smtp-test', { ...guard, config: { rateLimit: { max: 5, timeWindow: 600_000 } } }, async (req, reply) => {
    try {
      await sendMail(await settings.smtp(), req.user.email, renderTestEmail({ name: req.user.full_name }));
      await log(req, 'settings.smtp_test', req.user.email, { ok: true });
      return { ok: true, to: req.user.email };
    } catch (err) {
      req.log.error({ err: err.message }, 'smtp test failed');
      await log(req, 'settings.smtp_test', req.user.email, { ok: false });
      return reply.code(502).send({ error: 'فشل إرسال رسالة الاختبار. راجع إعدادات SMTP في ملف البيئة.' });
    }
  });
}
