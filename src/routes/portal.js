// Pages, portal API, SSO tickets and the nginx auth_request endpoint
import { MSG, sendPage, currentUser, requireUser } from './helpers.js';
import { COOKIE_NAME, readSessionId, loadSession, needsTouch, touchSession } from '../lib/session.js';
import { decideVerify, visibleSystems, systemHref, safeNext, corsOriginAllowed } from '../lib/authz.js';
import { signTicket, withTicket } from '../lib/ticket.js';
import { audit } from '../lib/audit.js';
import { unreadByCategory, loadNotifAccess } from './notifications.js';
import { accessCategories } from '../lib/notify.js';
import { countCompanyAlerts } from './company.js';
import { getBadges, buildInfo } from '../lib/badges.js';

export default async function portalRoutes(app) {
  const { db, cfg, settings } = app;
  const idle = async () => ({ idleMs: (await settings.get('security')).idle_minutes * 60_000 });

  // ---- pages ----
  app.get('/', async (req, reply) => ((await currentUser(app, req)) ? sendPage(reply, 'portal.html') : reply.redirect('/login')));
  app.get('/login', async (req, reply) => {
    if (await currentUser(app, req)) return reply.redirect(safeNext(req.query.next, cfg.rootDomain));
    return sendPage(reply, 'login.html');
  });
  app.get('/otp', async (req, reply) => sendPage(reply, 'otp.html'));
  app.get('/denied', async (req, reply) => sendPage(reply, 'denied.html'));
  app.get('/admin', async (req, reply) => {
    const u = await currentUser(app, req);
    if (!u) return reply.redirect('/login?next=/admin');
    return u.role === 'admin' ? sendPage(reply, 'admin.html') : reply.redirect('/denied?r=admin');
  });
  app.get('/infra', async (req, reply) => {
    const u = await currentUser(app, req);
    if (!u) return reply.redirect('/login?next=/infra');
    return u.role === 'admin' ? sendPage(reply, 'infra.html') : reply.redirect('/denied?r=infra');
  });
  app.get('/favicon.ico', async (req, reply) => reply.redirect('/static/assets/favicon.png'));
  app.get('/healthz', { logLevel: 'warn' }, async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  // ---- portal data ----
  // CORS (this route only): proxied systems on https://<sub>.details-wms.cloud fetch it with credentials to show the employee's name/photo.
  const corsMe = async (req, reply) => {
    const origin = req.headers.origin;
    reply.header('Vary', 'Origin');
    if (origin && corsOriginAllowed(origin, cfg.rootDomain)) {
      reply.header('Access-Control-Allow-Origin', origin).header('Access-Control-Allow-Credentials', 'true')
        .header('Access-Control-Allow-Methods', 'GET').header('Access-Control-Allow-Headers', 'Accept').header('Access-Control-Max-Age', '600');
    }
  };
  app.options('/api/me', async (req, reply) => { await corsMe(req, reply); return reply.code(204).send(); });
  app.get('/api/me', { preHandler: [corsMe, requireUser(app)] }, async (req) => {
    const u = req.user;
    const [{ rows: systems }, { rows: grants }, nAccess] = await Promise.all([
      db.query('SELECT * FROM systems ORDER BY sort, key'),
      db.query('SELECT system_key FROM grants WHERE employee_id = $1', [u.employee_id]),
      loadNotifAccess(db, u),
    ]);
    // «مركز الإشعارات»: البطاقة تتبع صلاحيتي الأعمال/التقنية (بلا أي منهما تختفي)
    const canNotify = accessCategories(nAccess).length > 0;
    const list = visibleSystems(systems, grants.map((g) => g.system_key), u.role).filter((s) => s.key !== 'notifications' || canNotify).map((s) => ({
      key: s.key, name: s.name_ar, description: s.description_ar, icon: s.icon, host: s.host, local_host: s.local_host || null,
      mode: s.mode, status: s.status, href: s.status === 'live' || (u.role === 'admin' && s.status !== 'off') ? systemHref(s) : null,
      placement: s.placement || 'grid', // 'header' = زر صغير بجوار اسم الموظف بدل بطاقة
    }));
    const { rows: [prev] } = await db.query(
      'SELECT created_at FROM sessions WHERE employee_id = $1 AND id <> $2 ORDER BY created_at DESC LIMIT 1', [u.employee_id, u.id]);
    const [{ rows: [ph] }, unread, companyAlerts] = await Promise.all([
      db.query('SELECT photo_url FROM employees WHERE id = $1', [u.employee_id]),
      unreadByCategory(db, u.employee_id, nAccess),
      countCompanyAlerts(db),
    ]);
    // شارات الانتباه لكل بطاقة (انظر src/lib/badges.js)؛ فشل أي مصدر لا يعطّل الباقي
    const badges = await getBadges(app, u, list.map((s) => s.key)).catch(() => ({}));
    return {
      employee: { employee_no: u.employee_no.trim(), name: u.full_name, email: u.email, role: u.role, photo_url: ph?.photo_url || null },
      session: { started_at: u.created_at, last_login_at: prev?.created_at || null, server_now: new Date().toISOString() },
      systems: list,
      // شارات حمراء على البطاقات: إشعارات غير مقروءة، وعناصر المنشأة المنتهية أو التي تنتهي خلال 30 يومًا
      tiles_badges: { notifications: unread.total, company: companyAlerts },
      notifications: { access: { work: nAccess.work, technical: nAccess.technical, details: nAccess.details }, unread_by: { work: unread.work, technical: unread.technical } },
      badges,
      build: buildInfo(),
    };
  });

  // تحديث الشارات فقط (كل 60 ثانية من البوابة): أخف من /api/me
  app.get('/api/badges', { preHandler: requireUser(app) }, async (req, reply) => {
    const u = req.user;
    const [{ rows: systems }, { rows: grants }] = await Promise.all([
      db.query('SELECT key, sort, requires_grant FROM systems ORDER BY sort, key'),
      db.query('SELECT system_key FROM grants WHERE employee_id = $1', [u.employee_id]),
    ]);
    const keys = visibleSystems(systems, grants.map((g) => g.system_key), u.role).map((s) => s.key);
    reply.header('Cache-Control', 'no-store');
    return { badges: await getBadges(app, u, keys).catch(() => ({})) };
  });

  // Link systems: redirect with a signed 60s ticket
  app.get('/go/:key', async (req, reply) => {
    const id = readSessionId(req.cookies[COOKIE_NAME], cfg.sessionSecret);
    const row = id ? await loadSession(db, id, String(req.params.key)) : null;
    const d = decideVerify(row, String(req.params.key), new Date(), await idle());
    if (d.status === 401) return reply.redirect('/login');
    if (d.status !== 200) return reply.redirect(`/denied?s=${encodeURIComponent(req.params.key)}`);
    const { rows: [s] } = await db.query("SELECT * FROM systems WHERE key = $1 AND mode = 'link'", [req.params.key]);
    if (!s?.upstream) return reply.redirect(`/denied?s=${encodeURIComponent(req.params.key)}`);
    const token = signTicket(
      { employee_no: row.employee_no.trim(), name: row.full_name, email: row.email, system_key: s.key },
      cfg.ticketSecret);
    await audit(db, { actor: row.employee_id, action: 'ticket.issued', target: s.key, ip: req.ip });
    return reply.redirect(withTicket(s.upstream, token));
  });

  // ---- nginx auth_request ----
  app.get('/_gw/verify', { logLevel: 'warn' }, async (req, reply) => {
    const systemKey = String(req.headers['x-gw-system'] || '').trim().toLowerCase() || null;
    const id = readSessionId(req.cookies[COOKIE_NAME], cfg.sessionSecret);
    const row = id ? await loadSession(db, id, systemKey) : null;
    const d = decideVerify(row, systemKey, new Date(), await idle());
    if (d.status === 200 && needsTouch(row)) await touchSession(db, row.id);
    reply.code(d.status).headers(d.headers).header('Cache-Control', 'no-store');
    return reply.send(d.status === 200 ? '' : (d.status === 401 ? MSG.auth : MSG.forbidden));
  });
}
