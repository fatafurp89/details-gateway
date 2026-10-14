import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideVerify, visibleSystems, systemHref, safeNext } from '../src/lib/authz.js';

const now = new Date('2026-10-14T10:00:00Z');
const row = (over = {}) => ({
  id: 's1', revoked_at: null, expires_at: new Date(+now + 3600e3), last_seen_at: new Date(+now - 60e3),
  employee_id: 'e1', employee_no: '1021', full_name: 'موظف تجريبي', email: 'u@details-consults.sa', role: 'user',
  active: true, employee_expires_at: null,
  sys_key: 'wms', sys_status: 'live', sys_requires_grant: true, grant_level: null, ...over,
});

test('verify: no session -> 401', () => {
  assert.equal(decideVerify(null, 'wms', now).status, 401);
});

test('verify: expired / idle / revoked session or inactive employee -> 401', () => {
  assert.equal(decideVerify(row({ expires_at: new Date(+now - 1) }), 'wms', now).status, 401);
  assert.equal(decideVerify(row({ last_seen_at: new Date(+now - 31 * 60e3) }), 'wms', now).status, 401);
  assert.equal(decideVerify(row({ revoked_at: now }), 'wms', now).status, 401);
  assert.equal(decideVerify(row({ active: false, grant_level: 'use' }), 'wms', now).status, 401);
  assert.equal(decideVerify(row({ employee_expires_at: new Date(+now - 1), grant_level: 'use' }), 'wms', now).status, 401);
});

test('verify: no grant -> 403', () => {
  const d = decideVerify(row(), 'wms', now);
  assert.equal(d.status, 403);
  assert.equal(d.reason, 'no_grant');
  assert.deepEqual(d.headers, {});
});

test('verify: grant -> 200 with user headers (name URL-encoded)', () => {
  const d = decideVerify(row({ grant_level: 'use' }), 'wms', now);
  assert.equal(d.status, 200);
  assert.equal(d.headers['X-Gw-Employee-No'], '1021');
  assert.equal(decodeURIComponent(d.headers['X-Gw-Name']), 'موظف تجريبي');
  assert.match(d.headers['X-Gw-Name'], /^[\x21-\x7e]+$/);
  assert.equal(d.headers['X-Gw-Email'], 'u@details-consults.sa');
  assert.equal(d.headers['X-Gw-Role'], 'user');
  assert.equal(d.headers['X-Gw-Level'], 'use');
});

test('verify: admin -> 200 without grant, even for systems not live yet', () => {
  assert.equal(decideVerify(row({ role: 'admin' }), 'wms', now).status, 200);
  assert.equal(decideVerify(row({ role: 'admin', sys_status: 'soon' }), 'wms', now).status, 200);
  assert.equal(decideVerify(row({ role: 'admin', sys_status: 'off' }), 'wms', now).status, 403);
});

test('verify: missing/unknown/not-live system -> 403', () => {
  assert.equal(decideVerify(row({ grant_level: 'use' }), null, now).status, 403);
  assert.equal(decideVerify(row({ sys_key: null }), 'nope', now).status, 403);
  assert.equal(decideVerify(row({ grant_level: 'use', sys_status: 'soon' }), 'wms', now).status, 403);
});

test('verify: system without requires_grant is open to any active employee', () => {
  assert.equal(decideVerify(row({ sys_requires_grant: false }), 'wms', now).status, 200);
});

test('portal shows only granted systems (all for admin)', () => {
  const systems = [{ key: 'hr', sort: 30 }, { key: 'wms', sort: 10 }, { key: 'mail', sort: 20, requires_grant: false }];
  assert.deepEqual(visibleSystems(systems, ['hr'], 'user').map((s) => s.key), ['mail', 'hr']);
  assert.deepEqual(visibleSystems(systems, [], 'admin').map((s) => s.key), ['wms', 'mail', 'hr']);
});

test('system links', () => {
  assert.equal(systemHref({ mode: 'proxy', host: 'wms.details-wms.cloud' }), 'https://wms.details-wms.cloud/');
  assert.equal(systemHref({ mode: 'link', key: 'hr', upstream: 'https://details-hr.com/sso' }), '/go/hr');
  assert.equal(systemHref({ mode: 'link', key: 'bls', upstream: null }), null);
  assert.equal(systemHref({ mode: 'internal', upstream: '//evil.com' }), null);
});

test('safeNext allows only our domain', () => {
  const d = 'details-wms.cloud';
  assert.equal(safeNext('/admin', d), '/admin');
  assert.equal(safeNext('https://wms.details-wms.cloud/x?a=1&b=2', d), 'https://wms.details-wms.cloud/x?a=1&b=2');
  assert.equal(safeNext('https://details-wms.cloud/', d), 'https://details-wms.cloud/');
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'https://details-wms.cloud.evil.com/', 'http://wms.details-wms.cloud/',
    'javascript:alert(1)', 'https://user@wms.details-wms.cloud/', '', undefined]) {
    assert.equal(safeNext(bad, d), '/', String(bad));
  }
});
