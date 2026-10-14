import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, hashCode, checkOtp, otpRequestDecision, LIMITS } from '../src/lib/otp.js';

const PEPPER = 'p'.repeat(40);
const EMP = '11111111-2222-4333-8444-555555555555';
const now = new Date('2026-10-14T10:00:00Z');
const rec = (over = {}) => ({
  employee_id: EMP, code_hash: hashCode('1234', PEPPER, EMP), attempts: 0,
  consumed_at: null, expires_at: new Date(+now + 5 * 60e3), ...over,
});
const opts = { pepper: PEPPER, now };

test('generated codes are 4 digits', () => {
  for (let i = 0; i < 200; i++) assert.match(generateCode(), /^\d{4}$/);
});

test('hash depends on pepper and employee, never stores the code', () => {
  const h = hashCode('1234', PEPPER, EMP);
  assert.notEqual(h, hashCode('1234', 'q'.repeat(40), EMP));
  assert.notEqual(h, hashCode('1234', PEPPER, 'other'));
  assert.ok(!h.includes('1234'));
});

test('correct code is accepted', () => {
  assert.deepEqual(checkOtp(rec(), '1234', opts), { ok: true, reason: 'ok', cancel: false });
});

test('wrong code is rejected; 3rd wrong attempt cancels', () => {
  assert.deepEqual(checkOtp(rec(), '0000', opts), { ok: false, reason: 'mismatch', cancel: false });
  assert.deepEqual(checkOtp(rec({ attempts: 2 }), '0000', opts), { ok: false, reason: 'mismatch', cancel: true });
  assert.equal(checkOtp(rec(), 'abc', opts).reason, 'mismatch');
});

test('expired code is rejected even if correct', () => {
  const r = checkOtp(rec({ expires_at: new Date(+now - 1) }), '1234', opts);
  assert.deepEqual(r, { ok: false, reason: 'expired', cancel: true });
});

test('after 3 attempts the correct code no longer works', () => {
  assert.deepEqual(checkOtp(rec({ attempts: 3 }), '1234', opts), { ok: false, reason: 'locked', cancel: true });
});

test('consumed or missing code is rejected', () => {
  assert.equal(checkOtp(rec({ consumed_at: now }), '1234', opts).reason, 'consumed');
  assert.equal(checkOtp(null, '1234', opts).reason, 'missing');
});

test('OTP request limits: lock, IP, employee, resend interval', () => {
  const base = { employeeHour: 0, ipHour: 0, badCodes30m: 0, lastSentAt: null };
  assert.equal(otpRequestDecision(base, now).ok, true);
  assert.equal(otpRequestDecision({ ...base, badCodes30m: 5 }, now).reason, 'locked');
  assert.equal(otpRequestDecision({ ...base, ipHour: LIMITS.perIpHour }, now).reason, 'ip_limit');
  assert.equal(otpRequestDecision({ ...base, employeeHour: 6 }, now).reason, 'employee_limit');
  assert.equal(otpRequestDecision({ ...base, employeeHour: 5 }, now).ok, true);
  assert.equal(otpRequestDecision({ ...base, lastSentAt: new Date(+now - 30e3) }, now).reason, 'too_soon');
  assert.equal(otpRequestDecision({ ...base, lastSentAt: new Date(+now - 61e3) }, now).ok, true);
});
