// Authorization decisions (pure): nginx verify, portal visibility, safe redirects
import { sessionStatus, employeeUsable } from './session.js';

/**
 * Decide the /_gw/verify answer from a joined session row (see session.loadSession).
 * Returns { status: 200|401|403, reason, headers }.
 */
export function decideVerify(row, systemKey, now = new Date(), { idleMs } = {}) {
  if (!row) return { status: 401, reason: 'no_session', headers: {} };
  const st = sessionStatus(row, now, idleMs);
  if (st !== 'ok') return { status: 401, reason: `session_${st}`, headers: {} };
  if (!employeeUsable({ active: row.active, expires_at: row.employee_expires_at }, now)) {
    return { status: 401, reason: 'employee_inactive', headers: {} };
  }
  const isAdmin = row.role === 'admin';
  let reason = null;
  if (!systemKey) reason = 'no_system';
  else if (!row.sys_key) reason = 'unknown_system';
  else if (row.sys_status === 'off') reason = 'system_off';
  else if (!isAdmin && row.sys_status !== 'live') reason = 'system_not_live';
  else if (!isAdmin && row.sys_requires_grant !== false && !row.grant_level) reason = 'no_grant';
  if (reason) return { status: 403, reason, headers: {} };
  return {
    status: 200,
    reason: isAdmin ? 'admin' : 'grant',
    headers: {
      'X-Gw-Employee-Id': String(row.employee_id),
      'X-Gw-Employee-No': String(row.employee_no).trim(),
      'X-Gw-Name': encodeURIComponent(row.full_name), // non-ASCII must be encoded in headers
      'X-Gw-Email': row.email || '',
      'X-Gw-Role': row.role,
      'X-Gw-Level': isAdmin ? 'admin' : (row.grant_level || 'use'),
    },
  };
}

// Systems the employee can see on the portal
export function visibleSystems(systems, grantedKeys, role) {
  const granted = new Set(grantedKeys);
  return systems
    .filter((s) => role === 'admin' || s.requires_grant === false || granted.has(s.key))
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
}

export function systemHref(s) {
  if (s.mode === 'proxy') return s.host ? `https://${s.host}/` : null;
  if (s.mode === 'link') return s.upstream ? `/go/${encodeURIComponent(s.key)}` : null;
  return s.upstream && s.upstream.startsWith('/') && !s.upstream.startsWith('//') ? s.upstream : null;
}

// Only allow redirects to our own paths or https://(*.)rootDomain
export function safeNext(next, rootDomain) {
  if (typeof next !== 'string' || !next || next.length > 2000) return '/';
  if (next.startsWith('/')) return /^\/(?![\/\\])/.test(next) ? next : '/';
  try {
    const u = new URL(next);
    const h = u.hostname.toLowerCase();
    if (u.protocol === 'https:' && !u.username && !u.password && (h === rootDomain || h.endsWith('.' + rootDomain))) return u.href;
  } catch { /* invalid */ }
  return '/';
}

/**
 * CORS for GET /api/me only: proxied systems on https://<sub>.details-wms.cloud read the signed-in employee.
 * Exact-origin echo (no wildcard); only one-label https subdomains of rootDomain in normalized form (no port/path/case).
 */
export function corsOriginAllowed(origin, rootDomain) {
  if (typeof origin !== 'string' || origin.length > 300 || !rootDomain) return false;
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) return false;
  if (origin !== `https://${u.hostname}`) return false;
  const root = String(rootDomain).toLowerCase();
  const h = u.hostname;
  if (!h.endsWith('.' + root)) return false;
  const sub = h.slice(0, -(root.length + 1));
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(sub);
}
