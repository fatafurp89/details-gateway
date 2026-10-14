import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signValue, unsignValue, readSessionId, sessionStatus, needsTouch, employeeUsable, cookieOptions } from '../src/lib/session.js';

const SECRET = 'x'.repeat(40);
const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const now = new Date('2026-10-14T10:00:00Z');
const ago = (ms) => new Date(now - ms);

test('cookie signature round-trip', () => {
  const v = signValue(ID, SECRET);
  assert.match(v, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(unsignValue(v, SECRET), ID);
  assert.equal(readSessionId(v, SECRET), ID);
});

test('cookie signature rejects tampering and wrong secret', () => {
  const v = signValue(ID, SECRET);
  const otherId = 'aaaaaaaa-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
  assert.equal(unsignValue(v, 'y'.repeat(40)), null);
  assert.equal(unsignValue(otherId + v.slice(36), SECRET), null);
  assert.equal(unsignValue(v.slice(0, -1) + (v.endsWith('A') ? 'B' : 'A'), SECRET), null);
  assert.equal(unsignValue(ID, SECRET), null);
  assert.equal(unsignValue(undefined, SECRET), null);
  assert.equal(unsignValue('.abc', SECRET), null);
});

test('readSessionId only accepts UUIDs', () => {
  assert.equal(readSessionId(signValue('not-a-uuid', SECRET), SECRET), null);
});

test('session status: ok / revoked / expired / idle / missing', () => {
  const base = { revoked_at: null, expires_at: new Date(+now + 3600e3), last_seen_at: ago(60e3) };
  assert.equal(sessionStatus(base, now), 'ok');
  assert.equal(sessionStatus({ ...base, revoked_at: ago(1) }, now), 'revoked');
  assert.equal(sessionStatus({ ...base, expires_at: ago(1) }, now), 'expired');
  assert.equal(sessionStatus({ ...base, last_seen_at: ago(31 * 60e3) }, now), 'idle');
  assert.equal(sessionStatus(null, now), 'missing');
});

test('last_seen_at is touched at most once a minute', () => {
  assert.equal(needsTouch({ last_seen_at: ago(30e3) }, now), false);
  assert.equal(needsTouch({ last_seen_at: ago(61e3) }, now), true);
});

test('employee usable only when active and not expired', () => {
  assert.equal(employeeUsable({ active: true, expires_at: null }, now), true);
  assert.equal(employeeUsable({ active: false, expires_at: null }, now), false);
  assert.equal(employeeUsable({ active: true, expires_at: ago(1) }, now), false);
  assert.equal(employeeUsable(undefined, now), false);
});

test('cookie options are secure and scoped to the parent domain', () => {
  const o = cookieOptions({ cookieDomain: '.details-wms.cloud' });
  assert.deepEqual([o.domain, o.secure, o.httpOnly, o.sameSite, o.maxAge], ['.details-wms.cloud', true, true, 'lax', 43200]);
});
