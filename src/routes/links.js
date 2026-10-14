// «الروابط السريعة»: قائمة بأعمدة لكل موظف مسجّل + إدارة للمشرف العام + تسجيل النقرات (/links/go/:id) وسجل الاستخدام
import { sendPage, requireUser, requireAdmin, currentUser, MSG } from './helpers.js';
import { audit } from '../lib/audit.js';
import { tx } from '../lib/db.js';

const URL_RE = /^https:\/\/[^\s]{4,2000}$/i;
const UUID_RE = /^[0-9a-f-]{36}$/;
const PRIORITIES = ['normal', 'important', 'critical'];
const AUDIENCES = ['all', 'staff', 'admins'];
// visible rows: audience all/staff for everyone signed in, admins only for the absolute admin
const VISIBLE = `l.active AND (l.audience <> 'admins' OR $1)`;
const LINK_COLS = `l.id, l.category, l.title, l.url, l.notes, l.access, l.audience, l.priority, l.pinned, l.sort, l.click_count, l.last_used_at,
  l.expires_at::text AS expires_at, l.created_at, l.updated_at, ce.full_name AS created_by_name, trim(ce.employee_no) AS created_by_no,
  lu.full_name AS last_used_by_name, trim(lu.employee_no) AS last_used_by_no`;
const FROM = `FROM quick_links l LEFT JOIN employees ce ON ce.id = l.created_by
  LEFT JOIN LATERAL (SELECT e.full_name, e.employee_no FROM quick_link_clicks c JOIN employees e ON e.id = c.employee_id
                      WHERE c.link_id = l.id ORDER BY c.clicked_at DESC LIMIT 1) lu ON true`;

export default async function linksRoutes(app) {
  const { db } = app;
  app.get('/links', async (req, reply) => {
    const u = await currentUser(app, req);
    if (!u) return reply.redirect('/login?next=/links');
    return sendPage(reply, 'links.html');
  });

  // Click-through: record who used which link and when, then redirect (the page opens it in a new tab)
  app.get('/links/go/:id', async (req, reply) => {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) return reply.code(404).send({ error: 'الرابط غير موجود' });
    const u = await currentUser(app, req);
    if (!u) return reply.redirect('/login?next=' + encodeURIComponent('/links/go/' + id));
    const admin = u.role === 'admin';
    const { rows: [l] } = await db.query(`SELECT l.id, l.url FROM quick_links l WHERE l.id = $2 AND ${VISIBLE}`, [admin, id]);
    if (!l) return reply.code(404).send({ error: 'الرابط غير موجود' });
    await db.query('INSERT INTO quick_link_clicks (link_id, employee_id, user_agent) VALUES ($1, $2, $3)', [l.id, u.employee_id, String(req.headers['user-agent'] || '').slice(0, 300)]);
    await db.query('UPDATE quick_links SET click_count = click_count + 1, last_used_at = now() WHERE id = $1', [l.id]);
    reply.header('Cache-Control', 'no-store');
    return reply.redirect(l.url);
  });

  app.get('/api/links', { preHandler: requireUser(app) }, async (req) => {
    const admin = req.user.role === 'admin';
    const [{ rows }, { rows: top }, { rows: mine }] = await Promise.all([
      db.query(`SELECT ${LINK_COLS} ${FROM} WHERE ${VISIBLE} ORDER BY l.category, l.pinned DESC, l.sort, l.title`, [admin]),
      // الأكثر استخدامًا هذا الشهر (بتوقيت الرياض)
      db.query(`SELECT l.id, l.title, l.category, l.url, count(c.id)::int AS clicks
                  FROM quick_link_clicks c JOIN quick_links l ON l.id = c.link_id
                 WHERE ${VISIBLE} AND c.clicked_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
                 GROUP BY l.id, l.title, l.category, l.url ORDER BY clicks DESC, l.title LIMIT 5`, [admin]),
      db.query('SELECT link_id, max(clicked_at) AS at FROM quick_link_clicks WHERE employee_id = $1 GROUP BY link_id', [req.user.employee_id]),
    ]);
    const my = new Map(mine.map((m) => [m.link_id, m.at]));
    return { links: rows.map((l) => ({ ...l, my_last_used_at: my.get(l.id) || null })), top_month: top, admin, server_now: new Date().toISOString() };
  });

  const guard = requireAdmin(app);
  const clean = (b) => {
    const audience = AUDIENCES.includes(b?.audience) ? b.audience : (b?.access === 'admin' ? 'admins' : 'all');
    const expires = String(b?.expires_at ?? '').trim().slice(0, 10);
    return {
      category: String(b?.category ?? '').trim().slice(0, 120), title: String(b?.title ?? '').trim().slice(0, 200),
      url: String(b?.url ?? '').trim(), notes: String(b?.notes ?? '').trim().slice(0, 1000),
      audience, access: audience === 'admins' ? 'admin' : 'all', // access kept in sync for older readers
      priority: PRIORITIES.includes(b?.priority) ? b.priority : 'normal',
      pinned: !!b?.pinned, sort: Number.isFinite(+b?.sort) ? +b.sort : 100,
      expires_at: expires && /^\d{4}-\d{2}-\d{2}$/.test(expires) && !Number.isNaN(Date.parse(expires)) ? expires : (expires ? 'bad' : null),
    };
  };
  const validate = (v) => (!v.category || !v.title || !URL_RE.test(v.url) ? 'التصنيف والعنوان والرابط (https) مطلوبة' : (v.expires_at === 'bad' ? 'تاريخ الصلاحية غير صحيح' : null));
  app.post('/api/admin/links', { preHandler: guard }, async (req, reply) => {
    const v = clean(req.body); const err = validate(v);
    if (err) return reply.code(400).send({ error: err });
    const { rows: [r] } = await db.query(
      `INSERT INTO quick_links (category, title, url, notes, access, audience, priority, pinned, sort, expires_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [v.category, v.title, v.url, v.notes, v.access, v.audience, v.priority, v.pinned, v.sort, v.expires_at, req.user.employee_id]);
    await audit(db, { action: 'links.add', target: r.id, actor: req.user.employee_id, ip: req.ip, meta: { title: v.title, category: v.category } });
    return { ok: true, id: r.id };
  });
  app.put('/api/admin/links/:id', { preHandler: guard }, async (req, reply) => {
    if (!UUID_RE.test(String(req.params.id))) return reply.code(400).send({ error: MSG.badRequest });
    const v = clean(req.body); const err = validate(v);
    if (err) return reply.code(400).send({ error: err });
    const r = await db.query(
      `UPDATE quick_links SET category=$2, title=$3, url=$4, notes=$5, access=$6, audience=$7, priority=$8, pinned=$9, sort=$10, expires_at=$11, updated_at=now() WHERE id=$1 AND active`,
      [req.params.id, v.category, v.title, v.url, v.notes, v.access, v.audience, v.priority, v.pinned, v.sort, v.expires_at]);
    if (!r.rowCount) return reply.code(404).send({ error: 'الرابط غير موجود' });
    await audit(db, { action: 'links.update', target: req.params.id, actor: req.user.employee_id, ip: req.ip, meta: { title: v.title } });
    return { ok: true };
  });
  // رفع/خفض الترتيب داخل التصنيف: يُعاد ترقيم التصنيف (10، 20، …) بترتيبه الحالي ثم يُبدَّل مع الجار
  app.post('/api/admin/links/:id/move', { preHandler: guard }, async (req, reply) => {
    if (!UUID_RE.test(String(req.params.id))) return reply.code(400).send({ error: MSG.badRequest });
    const dir = req.body?.dir === 'up' ? -1 : (req.body?.dir === 'down' ? 1 : 0);
    if (!dir) return reply.code(400).send({ error: MSG.badRequest });
    const out = await tx(db, async (c) => {
      const { rows: [l] } = await c.query('SELECT id, category, pinned FROM quick_links WHERE id = $1 AND active FOR UPDATE', [req.params.id]);
      if (!l) return { missing: true };
      const { rows } = await c.query('SELECT id FROM quick_links WHERE category = $1 AND active AND pinned = $2 ORDER BY sort, title FOR UPDATE', [l.category, l.pinned]);
      const ids = rows.map((r) => r.id);
      const i = ids.indexOf(l.id), j = i + dir;
      if (j < 0 || j >= ids.length) return { moved: false };
      [ids[i], ids[j]] = [ids[j], ids[i]];
      for (let k = 0; k < ids.length; k++) await c.query('UPDATE quick_links SET sort = $2, updated_at = now() WHERE id = $1', [ids[k], (k + 1) * 10]);
      return { moved: true };
    });
    if (out.missing) return reply.code(404).send({ error: 'الرابط غير موجود' });
    if (out.moved) await audit(db, { action: 'links.move', target: req.params.id, actor: req.user.employee_id, ip: req.ip, meta: { dir: req.body.dir } });
    return { ok: true, moved: out.moved };
  });
  app.delete('/api/admin/links/:id', { preHandler: guard }, async (req, reply) => {
    if (!UUID_RE.test(String(req.params.id))) return reply.code(400).send({ error: MSG.badRequest });
    const r = await db.query(`UPDATE quick_links SET active=false, updated_at=now() WHERE id=$1 AND active`, [req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'الرابط غير موجود' });
    await audit(db, { action: 'links.remove', target: req.params.id, actor: req.user.employee_id, ip: req.ip });
    return { ok: true };
  });
  // سجل الاستخدام لرابط واحد (آخر 200 نقرة): من ومتى — للمشرف العام فقط
  app.get('/api/admin/links/:id/clicks', { preHandler: guard }, async (req, reply) => {
    if (!UUID_RE.test(String(req.params.id))) return reply.code(400).send({ error: MSG.badRequest });
    const { rows } = await db.query(
      `SELECT c.clicked_at, c.user_agent, e.full_name, trim(e.employee_no) AS employee_no
         FROM quick_link_clicks c LEFT JOIN employees e ON e.id = c.employee_id
        WHERE c.link_id = $1 ORDER BY c.clicked_at DESC LIMIT 200`, [req.params.id]);
    const { rows: [tot] } = await db.query('SELECT count(*)::int AS n, count(DISTINCT employee_id)::int AS people FROM quick_link_clicks WHERE link_id = $1', [req.params.id]);
    return { clicks: rows, total: tot.n, people: tot.people };
  });
}
