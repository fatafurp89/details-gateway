// OTP generation, hashing and verification rules (pure)
import { randomInt } from 'node:crypto';
import { sha256hex, safeEqual } from './crypto.js';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 3; // 4-digit code: fewer guesses per code
export const RESEND_MS = 60 * 1000;
// perIpHour is high because the whole office shares one public IP (CGNAT)
export const LIMITS = { perEmployeeHour: 6, perIpHour: 60, badCodesForLock: 5, lockMinutes: 30 };

export const generateCode = () => String(randomInt(0, 10_000)).padStart(4, '0');

// Hash bound to the employee so a stored hash cannot be reused for another account
export const hashCode = (code, pepper, employeeId) => sha256hex(`${pepper}:${employeeId}:${code}`);

/**
 * Check a code against an OTP record as it was BEFORE this attempt.
 * Returns { ok, reason, cancel } — cancel=true when the record can no longer be used.
 */
export function checkOtp(record, code, { pepper, now = new Date(), maxAttempts = OTP_MAX_ATTEMPTS }) {
  if (!record) return { ok: false, reason: 'missing', cancel: false };
  if (record.consumed_at) return { ok: false, reason: 'consumed', cancel: true };
  if (new Date(record.expires_at) <= now) return { ok: false, reason: 'expired', cancel: true };
  if (record.attempts >= maxAttempts) return { ok: false, reason: 'locked', cancel: true };
  const last = record.attempts + 1 >= maxAttempts;
  const c = String(code ?? '');
  if (!/^\d{4}$/.test(c)) return { ok: false, reason: 'mismatch', cancel: last };
  if (safeEqual(record.code_hash, hashCode(c, pepper, record.employee_id))) return { ok: true, reason: 'ok', cancel: false };
  return { ok: false, reason: 'mismatch', cancel: last };
}

/**
 * May a new OTP be sent?  counts: { employeeHour, ipHour, badCodes30m, lastSentAt }
 */
export function otpRequestDecision(counts, now = new Date(), limits = LIMITS) {
  if (counts.badCodes30m >= limits.badCodesForLock) return { ok: false, reason: 'locked' };
  if (counts.ipHour >= limits.perIpHour) return { ok: false, reason: 'ip_limit' };
  if (counts.employeeHour >= limits.perEmployeeHour) return { ok: false, reason: 'employee_limit' };
  if (counts.lastSentAt && now - new Date(counts.lastSentAt) < RESEND_MS) return { ok: false, reason: 'too_soon' };
  return { ok: true, reason: 'ok' };
}
