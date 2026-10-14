// Shared crypto helpers (pure)
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const hmac = (secret, data) => createHmac('sha256', secret).update(data).digest();
export const sha256hex = (data) => createHash('sha256').update(data).digest('hex');

// Constant-time string compare (only the length can leak)
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
}
