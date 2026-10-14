// Session cookie signing + session state rules. Pure functions first; DB helpers take `db`.
import { randomUUID } from 'node:crypto';
import { b64url, hmac, safeEqual } from './crypto.js';

export const COOKIE_NAME = 'dg_session';
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000; // 12h absolute
export const IDLE_MS = 30 * 60 * 1000;          // 30min idle
export const TOUCH_MS = 60 * 1000;              // last_seen_at at most once a minute
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function signValue(value, secret) {
  return `${value}.${b64url(hmac(secret, `dg1:${value}`))}`;
}

// Returns the original value, or null when the signature is invalid
export function unsignValue(signed, secret) {
  if (typeof signed !== 'string') return null;
  const i = signed.lastIndexOf('.');
  if (i <= 0) return null;
  const value = signed.slice(0, i);
  return safeEqual(signed, signValue(value, secret)) ? value : null;
}

export function readSessionId(cookieValue, secret) {
  const id = unsignValue(cookieValue, secret);
  return id && UUID_RE.test(id) ? id : null;
}

// 'ok' | 'missing' | 'revoked' | 'expired' | 'idle'  (idleMs from «الجلسات والأمان», default 30 min)
export function sessionStatus(s, now = new Date(), idleMs = IDLE_MS) {
  if (!s) return 'missing';
  if (s.revoked_at) return 'revoked';
  if (new Date(s.expires_at) <= now) return 'expired';
  if (now - new Date(s.last_seen_at) > (Number(idleMs) || IDLE_MS)) return 'idle';
  return 'ok';
}

export function employeeUsable(e, now = new Date()) {
  return !!e && e.active === true && (!e.expires_at || new Date(e.expires_at) > now);
}

export const needsTouch = (s, now = new Date()) => now - new Date(s.last_seen_at) >= TOUCH_MS;

export function cookieOptions(cfg, maxAgeSec = ABSOLUTE_MS / 1000) {
  return { domain: cfg.cookieDomain, path: '/', secure: true, httpOnly: true, sameSite: 'lax', maxAge: maxAgeSec };
}

// ---- DB helpers ----
export async function createSession(db, employeeId, ip, userAgent, absoluteMs = ABSOLUTE_MS) {
  const id = randomUUID();
  const secs = Math.max(60, Math.trunc((Number(absoluteMs) || ABSOLUTE_MS) / 1000));
  await db.query(
    `INSERT INTO sessions (id, employee_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(secs => $5), $3, $4)`,
    [id, employeeId, ip || null, String(userAgent || '').slice(0, 300), secs]);
  return id;
}

// Session + employee + optional system/grant in one query
export async function loadSession(db, sessionId, systemKey = null) {
  if (!sessionId) return null;
  const { rows } = await db.query(
    `SELECT s.id, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
            e.id AS employee_id, e.employee_no, e.full_name, e.email, e.role, e.active,
            e.expires_at AS employee_expires_at,
            sy.key AS sys_key, sy.status AS sys_status, sy.requires_grant AS sys_requires_grant,
            g.level AS grant_level
       FROM sessions s JOIN employees e ON e.id = s.employee_id
       LEFT JOIN systems sy ON sy.key = $2
       LEFT JOIN grants g ON g.employee_id = e.id AND g.system_key = $2
      WHERE s.id = $1`, [sessionId, systemKey]);
  return rows[0] || null;
}

export async function touchSession(db, id) {
  await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
}

export async function revokeSession(db, id) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
}
