import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNode, validateLink, validateService, validateReport, matchProbes, effectiveStatus, computeAlerts, daysUntil,
  humanizeUptime, arCount, DAY, buildInfraTree, layoutColumns, placeNodes, pct, STALE_MS,
} from '../src/lib/infra.js';

const now = new Date('2026-10-14T10:00:00Z');
const ago = (ms) => new Date(+now - ms).toISOString();

test('validateNode: new node needs key/name/kind, normalizes urls and ips', () => {
  assert.ok(validateNode({ name_ar: 'x' }, { isNew: true }).error);
  assert.ok(validateNode({ key: 'Bad Key', name_ar: 'x', kind: 'vps' }, { isNew: true }).error);
  assert.ok(validateNode({ key: 'ok', name_ar: 'x', kind: 'nope' }, { isNew: true }).error);
  assert.ok(validateNode({ key: 'ok', name_ar: 'x', kind: 'vps', urls: [{ url: 'ftp://x' }] }, { isNew: true }).error);
  assert.ok(validateNode({ key: 'ok', name_ar: 'x', kind: 'vps', subscription_end: '14/10/2026' }, { isNew: true }).error);
  const { value, error } = validateNode({ key: 'NEW-vps', name_ar: ' خادم ', kind: 'vps', parent_key: 'hostinger', subscription_end: '2027-01-01',
    public_ip: '1.2.3.4', urls: [{ url: 'https://a.b/' }, { label_ar: 'لوحة', url: 'https://c.d/x' }], sort: '7', external: 'true' }, { isNew: true });
  assert.equal(error, undefined);
  assert.equal(value.key, 'new-vps');
  assert.equal(value.name_ar, 'خادم');
  assert.equal(value.sort, 7);
  assert.equal(value.external, true);
  assert.deepEqual(value.urls, [{ label_ar: 'https://a.b/', url: 'https://a.b/' }, { label_ar: 'لوحة', url: 'https://c.d/x' }]);
  assert.equal(value.local_ip, null);
  assert.equal(value.status_source, 'manual');
});

test('validateNode: edit only touches provided fields', () => {
  const { value } = validateNode({ name_ar: 'اسم', notes: 'n' });
  assert.deepEqual(Object.keys(value).sort(), ['name_ar', 'notes']);
  assert.ok(validateNode({ name_ar: 'اسم', status: 'broken' }).error);
  assert.equal(validateNode({ name_ar: 'اسم', status: 'down' }).value.status, 'down');
});

test('validateLink / validateService', () => {
  assert.ok(validateLink({ from_key: 'a1', to_key: 'a1', kind: 'lan' }).error);
  assert.ok(validateLink({ from_key: 'a1', to_key: 'b1', kind: 'wifi' }).error);
  assert.deepEqual(validateLink({ from_key: 'A1', to_key: 'b1', kind: 'wireguard', label_ar: 'x' }).value, { from_key: 'a1', to_key: 'b1', kind: 'wireguard', label_ar: 'x' });
  assert.ok(validateService({ node_key: 'a1', name_ar: 'x', port: 70000 }).error);
  assert.ok(validateService({ node_key: 'a1', name_ar: '' }).error);
  const s = validateService({ node_key: 'a1', name_ar: 'خدمة', port: '3200', system_key: 'WMS', url: 'https://x.y/' }).value;
  assert.equal(s.port, 3200); assert.equal(s.system_key, 'wms'); assert.equal(s.sort, 100);
});

test('validateReport: coerces numbers, drops junk, caps lists', () => {
  assert.ok(validateReport({ node: 'x' }).error);
  const { value: r, error } = validateReport({ node: 'Office-Server', uptime_s: '93784.5', load: ['0.5', '1', 'x'], mem: { total: '100', used: '40' },
    disks: [{ mount: '/', size: 100, used: 90 }, { mount: '/bad', size: 0, used: 0 }, 'junk'],
    services: [{ name: 'nginx.service', active: 'active' }, { name: '', active: true }, { name: 'x', active: false }],
    os: 'Ubuntu', updates: { count: '3', reboot_required: true }, wg: { peers: 2 }, tailscale: { ip: '100.1.1.1' },
    probes: [{ host: '10.10.10.10', ok: true, ms: '1.2' }, { host: 'bad host', ok: true }] });
  assert.equal(error, undefined);
  assert.equal(r.node, 'office-server');
  assert.equal(r.uptime_s, 93784);
  assert.deepEqual(r.load, [0.5, 1]);
  assert.deepEqual(r.mem, { total: 100, used: 40 });
  assert.equal(r.disks.length, 1);
  assert.deepEqual(r.services, [{ name: 'nginx.service', active: true }, { name: 'x', active: false }]);
  assert.equal(r.updates.count, 3); assert.equal(r.updates.reboot_required, true);
  assert.deepEqual(r.probes, [{ host: '10.10.10.10', ok: true, ms: 1.2 }]);
  assert.ok(validateReport({ node: 'ok', probes: Array.from({ length: 101 }, () => ({ host: '1.1.1.1', ok: true })) }).error);
  assert.equal(validateReport({ node: 'ok', mem: { total: 0 } }).value.mem, null);
});

test('matchProbes maps hosts to nodes by any address', () => {
  const nodes = [{ key: 'gw', local_ip: '10.10.10.10' }, { key: 'srv', wg_ip: '10.9.0.2', hostname: 'Details-Server' }];
  const m = matchProbes([{ host: '10.10.10.10' }, { host: 'details-server' }, { host: '9.9.9.9' }], nodes);
  assert.equal(m.get('10.10.10.10'), 'gw'); assert.equal(m.get('details-server'), 'srv'); assert.equal(m.has('9.9.9.9'), false);
});

test('effectiveStatus: stale agent -> down, stale ping -> unknown, manual -> stored', () => {
  assert.equal(effectiveStatus({ status_source: 'agent', status: 'up', status_at: ago(60e3) }, now), 'up');
  assert.equal(effectiveStatus({ status_source: 'agent', status: 'up', status_at: ago(STALE_MS + 1) }, now), 'down');
  assert.equal(effectiveStatus({ status_source: 'agent', status: 'up', status_at: null }, now), 'unknown');
  assert.equal(effectiveStatus({ status_source: 'ping', status: 'down', status_at: ago(60e3) }, now), 'down');
  assert.equal(effectiveStatus({ status_source: 'ping', status: 'up', status_at: ago(STALE_MS + 1) }, now), 'unknown');
  assert.equal(effectiveStatus({ status_source: 'manual', status: 'up' }, now), 'up');
  assert.equal(effectiveStatus({ status_source: 'manual' }, now), 'unknown');
});

test('computeAlerts: stale report, failed ping, full disk, subscription window', () => {
  const codes = (n, p) => computeAlerts(n, p, now).map((a) => a.code);
  assert.deepEqual(codes({ status_source: 'agent', status: 'up', status_at: ago(STALE_MS + 1) }), ['stale']);
  assert.deepEqual(codes({ status_source: 'agent', status: 'up', status_at: null }), ['no_report']);
  assert.deepEqual(codes({ status_source: 'ping', status: 'down', status_at: ago(1000) }), ['down']);
  assert.deepEqual(codes({ status_source: 'agent', status: 'up', status_at: ago(1000) }, { payload: { disks: [{ mount: '/', size: 100, used: 86 }, { mount: '/k', size: 100, used: 85 }] } }), ['disk']);
  assert.deepEqual(codes({ status_source: 'manual', subscription_end: '2026-11-13' }), ['subscription']); // 30 days
  assert.deepEqual(codes({ status_source: 'manual', subscription_end: '2026-11-14' }), []);               // 31 days
  const expired = computeAlerts({ status_source: 'manual', subscription_end: '2026-10-01' }, null, now);
  assert.equal(expired[0].level, 'danger'); assert.match(expired[0].text, /انتهى الاشتراك/);
  assert.deepEqual(codes({ status_source: 'manual', subscription_end: '2027-08-16' }), []);
  assert.deepEqual(codes({ status_source: 'agent', status: 'up', status_at: ago(1000) }, { payload: { updates: { reboot_required: true } } }), ['reboot']);
  for (const a of computeAlerts({ status_source: 'agent', status_at: null, subscription_end: '2026-10-20' }, null, now)) assert.match(a.text, /[؀-ۿ]/);
});

test('daysUntil and pct', () => {
  assert.equal(daysUntil('2026-10-14', now), 0);
  assert.equal(daysUntil('2026-10-15', now), 1);
  assert.equal(daysUntil('2026-10-13', now), -1);
  assert.equal(daysUntil(null, now), null);
  assert.equal(daysUntil('garbage', now), null);
  assert.equal(pct(86, 100), 86); assert.equal(pct(1, 0), null);
});

test('humanizeUptime and Arabic counting', () => {
  assert.equal(arCount(1, DAY), 'يوم واحد');
  assert.equal(arCount(2, DAY), 'يومان');
  assert.equal(arCount(3, DAY), '3 أيام');
  assert.equal(arCount(10, DAY), '10 أيام');
  assert.equal(arCount(11, DAY), '11 يومًا');
  assert.equal(humanizeUptime(30), 'أقل من دقيقة');
  assert.equal(humanizeUptime(60), 'دقيقة واحدة');
  assert.equal(humanizeUptime(3600 * 2 + 60 * 5), 'ساعتان و5 دقائق');
  assert.equal(humanizeUptime(86400 * 3 + 3600 * 4 + 60 * 12), '3 أيام و4 ساعات');
  assert.equal(humanizeUptime(86400 * 12), '12 يومًا');
  assert.equal(humanizeUptime(-5), 'أقل من دقيقة');
});

const rows = [
  { key: 'internet', parent_key: null, sort: 10 }, { key: 'hostinger', parent_key: 'internet', sort: 10 },
  { key: 'bridge', parent_key: 'hostinger', sort: 10 }, { key: 'apps', parent_key: 'hostinger', sort: 20 },
  { key: 'office', parent_key: null, sort: 20 }, { key: 'huawei', parent_key: 'office', sort: 10 }, { key: 'ruijie-gw', parent_key: 'huawei', sort: 10 },
  { key: 'sw24', parent_key: 'ruijie-gw', sort: 10 }, { key: 'sw8', parent_key: 'ruijie-gw', sort: 20 },
  { key: 'office-server', parent_key: 'sw24', sort: 10 }, { key: 'ap', parent_key: 'sw24', sort: 20 }, { key: 'fingerprint', parent_key: 'sw8', sort: 10 },
  { key: 'orphan', parent_key: 'missing', sort: 5 },
];

test('buildInfraTree: roots, order, orphans', () => {
  const t = buildInfraTree(rows);
  assert.deepEqual(t.map((r) => r.key), ['orphan', 'internet', 'office']);
  const office = t[2];
  assert.equal(office.children[0].key, 'huawei');
  assert.equal(office.children[0].children[0].children.map((c) => c.key).join(','), 'sw24,sw8');
});

test('layoutColumns: one band per root, column = depth, no key twice; placeNodes gives distinct positions', () => {
  const bands = layoutColumns(rows);
  const office = bands.find((b) => b.root === 'office');
  assert.deepEqual(office.columns[0], ['office']);
  assert.deepEqual(office.columns[1], ['huawei']);
  assert.deepEqual(office.columns[2], ['ruijie-gw']);
  assert.deepEqual(office.columns[3], ['sw24', 'sw8']);
  assert.deepEqual(office.columns[4], ['office-server', 'ap', 'fingerprint']);
  const all = bands.flatMap((b) => b.columns.flat());
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, rows.length);
  const { positions, height, width } = placeNodes(bands, { colW: 100, rowH: 50, bandGap: 20 });
  const seen = new Set(Object.values(positions).map((p) => p.x + ':' + p.y));
  assert.equal(seen.size, rows.length);
  assert.equal(positions['office-server'].col, 4);
  assert.equal(positions['sw8'].y, positions['sw24'].y + 50);
  assert.ok(height > 0 && width === 500);
});
