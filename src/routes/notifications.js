// «مركز الإشعارات»: استقبال الإشعارات من الأنظمة (proxy key) + واجهة الموظف (قائمة، عدّاد، تعليم كمقروء) + الصفحة
// التصنيف: work (الأعمال) / technical (التقنية). كل نقطة نهاية للموظف تفرض notifications.work / notifications.technical في الخادم.
import { MSG, sendPage, currentUser, requireUser } from './helpers.js';
import { checkProxyKey } from '../lib/perms.js';
import { validateNotify, validateNotifyRead, clampLimit, notifAccess, accessCategories, pickCategories, shapeNotification, PERM_KEYS } from '../lib/notify.js';
import { applyPlain } from '../lib/notify-plain.js';
import { categorize } from '../lib/notify-categories.js';
import { tx } from '../lib/db.js';
import { sendMail, renderNotificationEmail } from '../lib/mail.js';

const UUID_RE = /^[0-9a-f-]{36}$/;
// Visible to one employee: own rows + broadcasts (employee_id NULL); read_at of a broadcast comes from notification_reads
const FROM = `FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.employee_id = $1`;
const WHERE = `WHERE (n.employee_id = $1 OR n.employee_id IS NULL)`;
const COLS = `n.id, n.system_key, n.kind, n.category, n.title_ar, n.body_ar, n.url, n.severity, n.source_ref, n.meta, n.created_at,
  COALESCE(n.read_at, r.read_at) AS read_at, (n.employee_id IS NULL) AS broadcast`;

/**
 * { work, technical, details } of one employee from the permissions tree (absolute admin = everything).
 * `user` needs employee_id (+ role; looked up when absent).
 */
export async function loadNotifAccess(db, user) {
  let role = user.role;
  if (role === undefined) role = (await db.query('SELECT role FROM employees WHERE id = $1', [user.employee_id])).rows[0]?.role;
  if (role === 'admin') return notifAccess('admin');
  const { rows } = await db.query(
    `SELECT g.perm_key FROM perm_grants g JOIN perm_nodes n ON n.key = g.perm_key
      WHERE g.employee_id = $1 AND g.allowed AND n.present AND g.perm_key = ANY($2::text[])`, [user.employee_id, PERM_KEYS]);
  return notifAccess(role, rows.map((r) => r.perm_key));
}

/** Unread count per category the employee may see: { work, technical, total } (total = work + permitted technical). */
export async function unreadByCategory(db, employeeId, access) {
  const cats = accessCategories(access);
  const out = { work: 0, technical: 0, total: 0 };
  if (!cats.length) return out;
  const { rows } = await db.query(
    `SELECT n.category, count(*)::int AS n ${FROM} ${WHERE} AND n.read_at IS NULL AND r.read_at IS NULL AND n.category = ANY($2::text[]) GROUP BY n.category`, [employeeId, cats]);
  for (const r of rows) { out[r.category] = r.n; out.total += r.n; }
  return out;
}

/** Unread count for one employee (used by /api/me and the portal badge); only categories the employee may see. */
export async function countUnread(db, employeeId, access) {
  const a = access || await loadNotifAccess(db, { employee_id: employeeId });
  return (await unreadByCategory(db, employeeId, a)).total;
}

/**
 * Every creator goes through here: category = explicit or inferred (src/lib/notify-categories.js); technical ones are rewritten
 * in plain Arabic with the raw text kept in meta.details (src/lib/notify-plain.js). Idempotent.
 */
export function preparedNotification(v) {
  return applyPlain({ ...v, category: v.category || categorize(v) });
}

/**
 * Insert one notification for a list of recipients (null = broadcast). Idempotent on (system_key, source_ref, employee_id).
 * Returns the number of rows actually inserted.
 */
export async function insertNotifications(db, input, recipients) {
  const v = preparedNotification(input);
  let inserted = 0;
  for (const employee_id of recipients) {
    const r = await db.query(
      `INSERT INTO notifications (employee_id, system_key, kind, title_ar, body_ar, url, severity, source_ref, meta, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
      [employee_id, v.system, v.kind, v.title_ar, v.body_ar, v.url, v.severity, v.source_ref, JSON.stringify(v.meta || {}), v.category]);
    inserted += r.rowCount;
  }
  return inserted;
}

export default async function notificationsRoutes(app) {
  const { db, cfg, settings } = app;

  // «الإشعارات» في إعدادات النظام: تحويل الإشعار إلى بريد المستلمين حسب درجة الأهمية (أفضل جهد، لا يعطّل الإدراج)
  async function relayByEmail(n, recipients, req) {
    const conf = await settings.get('notifications');
    if (!conf.email_relay || !conf.severity?.[n.severity]?.email) return;
    const broadcast = recipients.length === 1 && recipients[0] === null;
    // التقني لا يُرسل بريديًا إلا لمن يملك صلاحيته (المشرف العام أو منحة notifications.technical)
    const tech = n.category === 'technical';
    const { rows } = await db.query(
      `SELECT e.email, e.full_name FROM employees e
        WHERE e.active AND e.email IS NOT NULL AND ($1::boolean OR e.id = ANY($2::uuid[]))
          AND (NOT $3::boolean OR e.role = 'admin' OR EXISTS (SELECT 1 FROM perm_grants g JOIN perm_nodes pn ON pn.key = g.perm_key
                 WHERE g.employee_id = e.id AND g.allowed AND pn.present AND g.perm_key = 'notifications.technical'))
        LIMIT 200`,
      [broadcast, broadcast ? [] : recipients, tech]);
    const smtp = await settings.smtp();
    for (const e of rows) {
      sendMail(smtp, e.email, renderNotificationEmail({ name: e.full_name, title: n.title_ar, body: n.body_ar, url: n.url, severity: n.severity, baseUrl: cfg.baseUrl }))
        .catch((err) => req.log.warn({ err: err.message }, 'notification mail relay failed'));
    }
  }

  app.get('/notifications', async (req, reply) => {
    const u = await currentUser(app, req);
    if (!u) return reply.redirect('/login?next=/notifications');
    if (!accessCategories(await loadNotifAccess(db, u)).length) return reply.redirect('/denied?s=notifications');
    return sendPage(reply, 'notifications.html');
  });

  // ---- internal: any system posts here (nginx exposes /_gw/* only on loopback and the tunnel) ----
  const proxyGuard = async (req, reply) => {
    const r = checkProxyKey(req.headers['x-gw-proxy-key'], cfg.proxyKey);
    reply.header('Cache-Control', 'no-store');
    if (r === 'unconfigured') { req.log.warn('GATEWAY_PROXY_KEY is not set; internal endpoint refused'); return reply.code(503).send({ error: 'الخدمة الداخلية غير مهيأة' }); }
    if (r !== 'ok') return reply.code(401).send({ error: MSG.forbidden });
  };

  app.post('/_gw/notify', { preHandler: proxyGuard, logLevel: 'warn' }, async (req, reply) => {
    const v = validateNotify(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const n = preparedNotification(v.value); // category (explicit or from the mapping table) + plain Arabic for technical ones
    const { rows: [sys] } = await db.query('SELECT key FROM systems WHERE key = $1', [n.system]);
    if (!sys) return reply.code(404).send({ error: 'النظام غير مسجل في البوابة' });
    let recipients, unknown = [];
    if (n.targets.all) recipients = [null];
    else {
      const { rows } = await db.query('SELECT id, trim(employee_no) AS employee_no FROM employees WHERE employee_no = ANY($1::text[])', [n.targets.employee_nos]);
      const found = new Map(rows.map((r) => [r.employee_no, r.id]));
      unknown = n.targets.employee_nos.filter((no) => !found.has(no));
      recipients = [...found.values()];
      if (!recipients.length) return reply.code(404).send({ error: 'لا يوجد موظف بهذه الأرقام الوظيفية', unknown });
    }
    const inserted = await tx(db, (c) => insertNotifications(c, n, recipients));
    if (inserted) relayByEmail(n, recipients, req).catch((err) => req.log.warn({ err: err.message }, 'notification relay failed'));
    return { ok: true, inserted, unknown, category: n.category };
  });

  // Source system marks its own notification as read (e.g. the employee opened it inside HR)
  app.post('/_gw/notify/read', { preHandler: proxyGuard, logLevel: 'warn' }, async (req, reply) => {
    const v = validateNotifyRead(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const { system, source_ref, employee_no } = v.value;
    let emp = null;
    if (employee_no) {
      const { rows: [e] } = await db.query('SELECT id FROM employees WHERE employee_no = $1', [employee_no]);
      if (!e) return reply.code(404).send({ error: 'الموظف غير موجود' });
      emp = e.id;
    }
    const updated = await tx(db, async (c) => {
      const r = await c.query(
        `UPDATE notifications SET read_at = now() WHERE system_key = $1 AND source_ref = $2 AND read_at IS NULL AND employee_id IS NOT NULL AND ($3::uuid IS NULL OR employee_id = $3)`,
        [system, source_ref, emp]);
      let n = r.rowCount;
      if (emp) {
        const b = await c.query(
          `INSERT INTO notification_reads (notification_id, employee_id) SELECT id, $3 FROM notifications WHERE system_key = $1 AND source_ref = $2 AND employee_id IS NULL
           ON CONFLICT DO NOTHING`, [system, source_ref, emp]);
        n += b.rowCount;
      }
      return n;
    });
    return { ok: true, updated };
  });

  // ---- employee API: every endpoint enforces notifications.work / notifications.technical server-side ----
  const withAccess = async (req, reply) => {
    await requireUser(app)(req, reply);
    if (reply.sent) return reply;
    req.access = await loadNotifAccess(db, req.user);
  };
  const guard = { preHandler: async (req, reply) => {
    if (await withAccess(req, reply)) return reply;
    if (!accessCategories(req.access).length) return reply.code(403).send({ error: MSG.forbidden });
  } };
  // the bell polls this: with no category granted it answers zeros + access all false (the bell hides itself) instead of 403
  const softGuard = { preHandler: withAccess };
  const accessOut = (a) => ({ work: a.work, technical: a.technical, details: a.details });

  app.get('/api/notifications', guard, async (req, reply) => {
    const unread = req.query.unread === '1' || req.query.unread === 'true';
    const limit = clampLimit(req.query.limit);
    const system = typeof req.query.system === 'string' && /^[a-z0-9_-]{2,32}$/.test(req.query.system) ? req.query.system : null;
    const cats = pickCategories(req.access, req.query.category);
    if (!cats) return reply.code(403).send({ error: MSG.forbidden });
    const params = [req.user.employee_id, limit, system, cats];
    const { rows } = await db.query(
      `SELECT ${COLS}, s.name_ar AS system_name, s.icon AS system_icon ${FROM} JOIN systems s ON s.key = n.system_key
        ${WHERE} ${unread ? 'AND n.read_at IS NULL AND r.read_at IS NULL' : ''} AND ($3::text IS NULL OR n.system_key = $3) AND n.category = ANY($4::text[])
        ORDER BY n.created_at DESC LIMIT $2`, params);
    const [{ rows: systems }, by] = await Promise.all([
      db.query(`SELECT DISTINCT s.key, s.name_ar, s.icon, s.sort FROM notifications n JOIN systems s ON s.key = n.system_key
                 WHERE (n.employee_id = $1 OR n.employee_id IS NULL) AND n.category = ANY($2::text[]) ORDER BY s.sort, s.key`, [req.user.employee_id, cats]),
      unreadByCategory(db, req.user.employee_id, req.access),
    ]);
    reply.header('Cache-Control', 'no-store');
    return {
      notifications: rows.map((r) => shapeNotification(r, req.access)),
      systems: systems.map(({ key, name_ar, icon }) => ({ key, name_ar, icon })),
      unread: by.total, unread_by: { work: by.work, technical: by.technical },
      access: accessOut(req.access),
      category: cats.length === 1 ? cats[0] : null,
      server_now: new Date().toISOString(),
    };
  });

  app.get('/api/notifications/count', softGuard, async (req, reply) => {
    const by = await unreadByCategory(db, req.user.employee_id, req.access);
    reply.header('Cache-Control', 'no-store');
    return { unread: by.total, unread_by: { work: by.work, technical: by.technical }, access: accessOut(req.access) };
  });

  app.post('/api/notifications/read-all', guard, async (req, reply) => {
    const cats = pickCategories(req.access, req.body && typeof req.body === 'object' ? req.body.category : undefined);
    if (!cats) return reply.code(403).send({ error: MSG.forbidden });
    const n = await tx(db, async (c) => {
      const a = await c.query('UPDATE notifications SET read_at = now() WHERE employee_id = $1 AND read_at IS NULL AND category = ANY($2::text[])', [req.user.employee_id, cats]);
      const b = await c.query(
        `INSERT INTO notification_reads (notification_id, employee_id) SELECT n.id, $1 FROM notifications n WHERE n.employee_id IS NULL AND n.category = ANY($2::text[])
         ON CONFLICT DO NOTHING`, [req.user.employee_id, cats]);
      return a.rowCount + b.rowCount;
    });
    return { ok: true, updated: n };
  });

  app.post('/api/notifications/:id/read', guard, async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const cats = accessCategories(req.access);
    const ok = await tx(db, async (c) => {
      const a = await c.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND employee_id = $2 AND read_at IS NULL AND category = ANY($3::text[])', [req.params.id, req.user.employee_id, cats]);
      if (a.rowCount) return true;
      const b = await c.query(
        `INSERT INTO notification_reads (notification_id, employee_id) SELECT id, $2 FROM notifications WHERE id = $1 AND employee_id IS NULL AND category = ANY($3::text[]) ON CONFLICT DO NOTHING`,
        [req.params.id, req.user.employee_id, cats]);
      if (b.rowCount) return true;
      const { rows: [x] } = await c.query('SELECT 1 FROM notifications WHERE id = $1 AND (employee_id = $2 OR employee_id IS NULL) AND category = ANY($3::text[])', [req.params.id, req.user.employee_id, cats]);
      return !!x; // already read
    });
    if (!ok) return reply.code(404).send({ error: 'الإشعار غير موجود' });
    return { ok: true };
  });
}
