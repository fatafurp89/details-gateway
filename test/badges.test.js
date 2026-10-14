import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBadges, fetchRemote, cleanCount, cleanLabel, clearBadgeCache, REMOTE_SOURCES, buildInfo } from '../src/lib/badges.js';

const app = { db: {}, cfg: { proxyKey: 'k'.repeat(32) } };
const emp = { employee_id: 'e1', employee_no: '1012 ', role: 'user' };
const ALL = ['notifications', 'company', 'whatsapp', 'mail', 'hr', 'files', 'bls', 'wms'];
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function mockFetch(map, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const u = new URL(url);
    const r = map[init.headers.Host];
    if (r === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    if (r instanceof Error) throw r;
    return r ? json(...r(u)) : json(404, {});
  };
}

test('counters are cleaned: non-negative integers, capped; labels plain and short', () => {
  assert.equal(cleanCount('7'), 7); assert.equal(cleanCount(-3), 0); assert.equal(cleanCount('x'), 0); assert.equal(cleanCount(1e9), 9999); assert.equal(cleanCount(2.9), 2);
  assert.equal(cleanLabel('رسائل <b>جديدة</b>', 'x'), 'رسائل bجديدة/b'); // tags stripped of angle brackets
  assert.equal(cleanLabel('a'.repeat(61), 'fallback'), 'fallback'); assert.equal(cleanLabel(5, 'fallback'), 'fallback');
});

test('all sources: remote ones go through the tunnel with Host + proxy key; local ones from the db', async () => {
  clearBadgeCache();
  const calls = [];
  const fetch = mockFetch({
    'whatsapp.details-wms.cloud': () => [200, { ok: true, count: 3, label: 'محادثات غير مقروءة' }],
    'mail.details-wms.cloud': () => [200, { ok: true, count: 12 }],
    'hr.details-wms.cloud': () => [200, { ok: true, count: 0 }],
    'files.details-wms.cloud': () => [200, { count: 2, label: 'ملفات جديدة على طلباتي' }],
  }, calls);
  const b = await getBadges(app, emp, ALL, { fetch, countUnread: async () => 5, countCompanyAlerts: async () => 4, baseUrl: 'http://10.9.0.3' });
  assert.deepEqual(b.notifications, { count: 5, label: 'إشعارات غير مقروءة', tone: 'red' });
  assert.equal(b.whatsapp.count, 3); assert.equal(b.mail.count, 12); assert.equal(b.files.count, 2);
  assert.equal(b.hr, undefined, 'zero hides');
  assert.equal(b.company, undefined, 'company is admin only');
  assert.equal(b.bls, undefined); assert.equal(b.wms, undefined);
  assert.equal(calls.length, 4);
  for (const c of calls) {
    assert.match(c.url, /^http:\/\/10\.9\.0\.3\/(internal|api\/internal)\/badge\?employee_no=1012$/);
    assert.equal(c.init.headers['X-Gw-Proxy-Key'], app.cfg.proxyKey);
    assert.ok(REMOTE_SOURCES.some((s) => s.host === c.init.headers.Host));
  }
});

test('company counter: admin only, amber tone', async () => {
  clearBadgeCache();
  const b = await getBadges(app, { ...emp, role: 'admin' }, ['company'], { fetch: mockFetch({}), countUnread: async () => 0, countCompanyAlerts: async () => 4 });
  assert.deepEqual(b.company, { count: 4, label: 'عناصر منتهية أو تنتهي خلال 30 يومًا', tone: 'amber' });
});

test('404, 401, error body, network error and timeout show nothing and never fail the others', async () => {
  clearBadgeCache();
  const fetch = mockFetch({
    'whatsapp.details-wms.cloud': () => [404, {}],
    'mail.details-wms.cloud': () => [401, { error: 'x' }],
    'hr.details-wms.cloud': 'hang',
    'files.details-wms.cloud': new Error('ECONNREFUSED'),
  });
  const t0 = Date.now();
  const b = await getBadges(app, emp, ['notifications', 'whatsapp', 'mail', 'hr', 'files'], { fetch, countUnread: async () => 2, timeoutMs: 80 });
  assert.ok(Date.now() - t0 < 1500);
  assert.deepEqual(Object.keys(b), ['notifications']);
});

test('a throwing local source is skipped; invisible tiles are never queried', async () => {
  clearBadgeCache();
  const calls = [];
  const b = await getBadges(app, emp, ['notifications', 'mail'], {
    fetch: mockFetch({ 'mail.details-wms.cloud': () => [200, { count: 1 }] }, calls),
    countUnread: async () => { throw new Error('db down'); }, countCompanyAlerts: async () => 9,
  });
  assert.deepEqual(Object.keys(b), ['mail']);
  assert.equal(calls.length, 1);
});

test('per-employee cache 45s: second call does not hit the sources; expires after TTL; employees are isolated', async () => {
  clearBadgeCache();
  let n = 0; let t = 1_000_000;
  const deps = { fetch: mockFetch({}), countUnread: async () => ++n, now: () => t };
  assert.equal((await getBadges(app, emp, ['notifications'], deps)).notifications.count, 1);
  assert.equal((await getBadges(app, emp, ['notifications'], deps)).notifications.count, 1);
  assert.equal((await getBadges(app, { ...emp, employee_no: '1013' }, ['notifications'], deps)).notifications.count, 2);
  t += 44_000; assert.equal((await getBadges(app, emp, ['notifications'], deps)).notifications.count, 1);
  t += 2_000; assert.equal((await getBadges(app, emp, ['notifications'], deps)).notifications.count, 3);
});

test('concurrent calls share one computation', async () => {
  clearBadgeCache();
  let n = 0;
  const deps = { fetch: mockFetch({}), countUnread: async () => { n++; await new Promise((r) => setTimeout(r, 20)); return 1; } };
  await Promise.all([getBadges(app, emp, ['notifications'], deps), getBadges(app, emp, ['notifications'], deps)]);
  assert.equal(n, 1);
});

test('no proxy key or bad employee number: remote systems are not called', async () => {
  clearBadgeCache();
  const calls = [];
  const fetch = mockFetch({ 'mail.details-wms.cloud': () => [200, { count: 1 }] }, calls);
  assert.deepEqual(await getBadges({ ...app, cfg: { proxyKey: '' } }, emp, ['mail'], { fetch }), {});
  assert.equal(await fetchRemote(REMOTE_SOURCES[1], 'abcd', { baseUrl: 'http://x', proxyKey: 'k', fetchImpl: fetch }), null);
  assert.equal(calls.length, 0);
});

test('build info has a version and a date', () => {
  const b = buildInfo();
  assert.match(b.version, /^\d+\.\d+\.\d+/); assert.match(b.built_at, /^\d{4}-\d{2}-\d{2}$/);
});

test('default transport sends the Host header and the proxy key (real http server)', async () => {
  const { createServer } = await import('node:http');
  const { httpGet } = await import('../src/lib/badges.js');
  let seen;
  const srv = createServer((req, res) => { seen = { host: req.headers.host, key: req.headers['x-gw-proxy-key'], url: req.url }; res.setHeader('content-type', 'application/json'); res.end('{"ok":true,"count":4}'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    clearBadgeCache();
    const b = await getBadges(app, emp, ['mail'], { baseUrl: base });
    assert.equal(b.mail.count, 4);
    assert.equal(seen.host, 'mail.details-wms.cloud');
    assert.equal(seen.key, app.cfg.proxyKey);
    assert.equal(seen.url, '/api/internal/badge?employee_no=1012');
    const r = await httpGet(base + '/x', { headers: {} });
    assert.equal(r.ok, true);
  } finally { srv.close(); }
});
