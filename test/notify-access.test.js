// Integration: «الأعمال» / «التقنية» enforcement in every notification endpoint, against a real PostgreSQL with all migrations applied.
//   TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/scratch_db node --test test/notify-access.test.js
// Without TEST_DATABASE_URL the suite is skipped (npm test stays green on machines with no database).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../src/lib/db.js';
import { buildApp } from '../src/app.js';
import { createSession, signValue } from '../src/lib/session.js';

const URL_ = process.env.TEST_DATABASE_URL;
const skip = !URL_ && 'TEST_DATABASE_URL is not set';
const SECRET = 's'.repeat(40);
const KEY = 'k'.repeat(32);
const NOS = ['9001', '9002', '9003', '9004', '9005'];
let db, app;
const cookies = {};
const ids = {};

const GET = (path, who) => app.inject({ method: 'GET', url: path, headers: who ? { cookie: cookies[who] } : {} });
const POST = (path, who, body) => app.inject({ method: 'POST', url: path, headers: { cookie: cookies[who], 'content-type': 'application/json' }, payload: JSON.stringify(body ?? {}) });
const internal = (body) => app.inject({ method: 'POST', url: '/_gw/notify', headers: { 'x-gw-proxy-key': KEY, 'content-type': 'application/json' }, payload: JSON.stringify(body) });

const RAW = 'فشلت نسخة bridge الليلية: line 29: sudo -u postgres pg_dump -Fc -d "$db" -f "$W/db/$db.dump" — راجع /srv/backups/bridge/backup.log';

async function purge() {
  const sub = '(SELECT id FROM employees WHERE employee_no = ANY($1::text[]))';
  await db.query("DELETE FROM notifications WHERE system_key = 'wms' AND source_ref LIKE 'test-na-%'");
  for (const t of ['sessions', 'perm_grants', 'grants']) await db.query(`DELETE FROM ${t} WHERE employee_id IN ${sub}`, [NOS]);
  await db.query('DELETE FROM audit_log WHERE actor_employee_id IN ' + sub, [NOS]).catch(() => {});
  await db.query('DELETE FROM employees WHERE employee_no = ANY($1::text[])', [NOS]);
}

before(async () => {
  if (skip) return;
  db = createPool(URL_);
  const cfg = { baseUrl: 'https://details-wms.cloud', rootDomain: 'details-wms.cloud', cookieDomain: '.details-wms.cloud', sessionSecret: SECRET, otpPepper: 'o'.repeat(32), ticketSecret: 't'.repeat(32), proxyKey: KEY, secretsKey: '', smtp: { host: 'x', port: 465, user: '', pass: '' }, google: {}, bootstrap: {} };
  app = await buildApp({ cfg, db, logger: false });
  await purge();
  const mk = async (no, role, name) => (await db.query(`INSERT INTO employees (employee_no, full_name, role) VALUES ($1, $2, $3) RETURNING id`, [no, name, role])).rows[0].id;
  ids.admin = await mk('9001', 'admin', 'مدير الاختبار');
  ids.plain = await mk('9002', 'user', 'موظف عادي');
  ids.tech = await mk('9003', 'user', 'موظف تقني');
  ids.details = await mk('9004', 'user', 'موظف تفاصيل');
  ids.revoked = await mk('9005', 'user', 'موظف مسحوب');
  const grant = (id, key) => db.query('INSERT INTO perm_grants (employee_id, perm_key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, key]);
  await grant(ids.tech, 'notifications.technical');
  await grant(ids.details, 'notifications.technical');
  await grant(ids.details, 'notifications.technical.details');
  await db.query('DELETE FROM perm_grants WHERE employee_id = $1 AND perm_key = $2', [ids.revoked, 'notifications.work']);
  for (const k of Object.keys(ids)) cookies[k] = `dg_session=${signValue(await createSession(db, ids[k], '127.0.0.1', 'test'), SECRET)}`;
});

after(async () => {
  if (skip) return;
  await purge();
  await app.close(); await db.end();
});

test('new employees get notifications.work by default (trigger), technical stays denied', { skip }, async () => {
  const { rows } = await db.query('SELECT perm_key FROM perm_grants WHERE employee_id = $1', [ids.plain]);
  assert.deepEqual(rows.map((r) => r.perm_key), ['notifications.work']);
});

test('POST /_gw/notify: category validated, inferred by kind, explicit wins; technical text becomes plain Arabic with raw text in meta.details', { skip }, async () => {
  assert.equal((await internal({ system: 'wms', title_ar: 'x', all: true, category: 'urgent' })).statusCode, 400);
  const w = await internal({ system: 'wms', all: true, kind: 'info', title_ar: 'اجتماع الإدارة غدًا', source_ref: 'test-na-work' });
  assert.equal(w.json().category, 'work');
  const t = await internal({ system: 'wms', all: true, kind: 'backup', severity: 'urgent', title_ar: 'فشل النسخ الاحتياطي لسيرفر البوابة (bridge)', body_ar: RAW, source_ref: 'test-na-tech' });
  assert.equal(t.json().category, 'technical');
  const explicit = await internal({ system: 'wms', all: true, kind: 'info', category: 'technical', title_ar: 'تنبيه من نظام العمل', body_ar: 'sudo systemctl restart foo', source_ref: 'test-na-tech2' });
  assert.equal(explicit.json().category, 'technical');
  const { rows: [r] } = await db.query("SELECT title_ar, body_ar, meta, category FROM notifications WHERE source_ref = 'test-na-tech' AND employee_id IS NULL");
  assert.equal(r.category, 'technical');
  assert.ok(!/pg_dump|sudo|\/srv\//.test(r.title_ar + r.body_ar), 'no shell text in the visible text');
  assert.equal(r.meta.plain, true);
  assert.ok(r.meta.details.includes('pg_dump'));
  assert.ok(r.meta.means && r.meta.todo);
});

test('work-only employee: sees work, technical is hidden everywhere', { skip }, async () => {
  const list = await GET('/api/notifications', 'plain');
  assert.equal(list.statusCode, 200);
  const body = list.json();
  assert.ok(body.notifications.length >= 1);
  assert.ok(body.notifications.every((n) => n.category === 'work'));
  assert.deepEqual(body.access, { work: true, technical: false, details: false });
  assert.equal(body.unread_by.technical, 0);
  assert.ok(!/pg_dump|sudo/.test(list.body), 'raw technical text never reaches a work-only employee');
  assert.equal((await GET('/api/notifications?category=technical', 'plain')).statusCode, 403);
  assert.equal((await GET('/api/notifications?category=work', 'plain')).statusCode, 200);
  const cnt = (await GET('/api/notifications/count', 'plain')).json();
  assert.equal(cnt.unread, cnt.unread_by.work);
  assert.equal((await POST('/api/notifications/read-all', 'plain', { category: 'technical' })).statusCode, 403);
  const { rows: [tn] } = await db.query("SELECT id FROM notifications WHERE source_ref = 'test-na-tech' AND employee_id IS NULL");
  assert.equal((await POST(`/api/notifications/${tn.id}/read`, 'plain')).statusCode, 404);
  assert.equal((await GET('/notifications', 'plain')).statusCode, 200);
});

test('read-all by category does not touch the other tab', { skip }, async () => {
  const before = (await GET('/api/notifications/count', 'tech')).json();
  assert.ok(before.unread_by.work >= 1 && before.unread_by.technical >= 1);
  assert.equal(before.unread, before.unread_by.work + before.unread_by.technical);
  assert.equal((await POST('/api/notifications/read-all', 'tech', { category: 'work' })).statusCode, 200);
  const after_ = (await GET('/api/notifications/count', 'tech')).json();
  assert.equal(after_.unread_by.work, 0);
  assert.equal(after_.unread_by.technical, before.unread_by.technical);
  assert.equal((await POST('/api/notifications/read-all', 'tech', { category: 'technical' })).statusCode, 200);
  assert.equal((await GET('/api/notifications/count', 'tech')).json().unread, 0);
});

test('technical employee without the details permission: plain text + means/todo, never the raw text', { skip }, async () => {
  const res = await GET('/api/notifications?category=technical', 'tech');
  assert.equal(res.statusCode, 200);
  const { notifications, access } = res.json();
  assert.equal(access.technical, true); assert.equal(access.details, false);
  assert.ok(notifications.length >= 2 && notifications.every((n) => n.category === 'technical'));
  assert.ok(notifications.every((n) => n.details === undefined && n.meta.details === undefined));
  assert.ok(notifications.every((n) => n.meta.means && n.meta.todo));
  assert.ok(!/pg_dump|sudo|systemctl|\/srv\//.test(res.body));
});

test('details permission (and the absolute admin) get the raw technical text separately', { skip }, async () => {
  for (const who of ['details', 'admin']) {
    const res = await GET('/api/notifications?category=technical', who);
    const bridge = res.json().notifications.find((n) => n.source_ref === 'test-na-tech');
    assert.ok(bridge.details.includes('pg_dump'), who);
    assert.equal(res.json().access.details, true);
  }
  // an unfiltered list contains both categories for a user who may see both
  const all = (await GET('/api/notifications', 'admin')).json();
  assert.ok(all.notifications.some((n) => n.category === 'work') && all.notifications.some((n) => n.category === 'technical'));
});

test('work revoked and nothing else: no list, no page, no tile, count answers zeros', { skip }, async () => {
  assert.equal((await GET('/api/notifications', 'revoked')).statusCode, 403);
  assert.equal((await POST('/api/notifications/read-all', 'revoked')).statusCode, 403);
  const c = await GET('/api/notifications/count', 'revoked');
  assert.equal(c.statusCode, 200);
  assert.deepEqual(c.json().access, { work: false, technical: false, details: false });
  assert.equal(c.json().unread, 0);
  const page = await GET('/notifications', 'revoked');
  assert.equal(page.statusCode, 302);
  assert.match(page.headers.location, /^\/denied/);
  const me = (await GET('/api/me', 'revoked')).json();
  assert.ok(!me.systems.some((s) => s.key === 'notifications'), 'tile hidden');
  assert.equal(me.tiles_badges.notifications, 0);
  const meOk = (await GET('/api/me', 'plain')).json();
  assert.ok(meOk.systems.some((s) => s.key === 'notifications'), 'tile visible for work');
  assert.equal(meOk.tiles_badges.notifications, meOk.notifications.unread_by.work);
});

test('technical-only (work revoked) still gets the page and the technical tab', { skip }, async () => {
  await db.query('DELETE FROM perm_grants WHERE employee_id = $1 AND perm_key = $2', [ids.tech, 'notifications.work']);
  const l = await GET('/api/notifications', 'tech');
  assert.equal(l.statusCode, 200);
  assert.ok(l.json().notifications.every((n) => n.category === 'technical'));
  assert.equal((await GET('/api/notifications?category=work', 'tech')).statusCode, 403);
  assert.equal((await GET('/notifications', 'tech')).statusCode, 200);
});
