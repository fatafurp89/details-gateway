// Short-lived signed SSO ticket (JWT HS256) for `link` systems (pure)
import { randomUUID } from 'node:crypto';
import { b64url, hmac, safeEqual } from './crypto.js';

export const TICKET_TTL_SEC = 60;
const enc = (o) => b64url(JSON.stringify(o));

export function signTicket(claims, secret, { now = Date.now(), ttl = TICKET_TTL_SEC, issuer = 'details-wms.cloud' } = {}) {
  const iat = Math.floor(now / 1000);
  const payload = { iss: issuer, aud: claims.system_key, iat, exp: iat + ttl, jti: randomUUID(), ...claims };
  const head = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  return `${head}.${b64url(hmac(secret, head))}`;
}

// Reference verifier (receiving systems implement the same check)
export function verifyTicket(token, secret, { now = Date.now(), audience } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  if (!safeEqual(sig, b64url(hmac(secret, `${h}.${p}`)))) return null;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (header.alg !== 'HS256') return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(now / 1000)) return null;
    if (audience && payload.aud !== audience) return null;
    return payload;
  } catch { return null; }
}

export function withTicket(url, token) {
  const u = new URL(url);
  u.searchParams.set('dg_ticket', token);
  return u.href;
}
