// Symmetric sealing of small secrets: AES-256-GCM with a 32-byte key from env SECRETS_KEY (64 hex chars).
// Stored as { iv (12 bytes), enc (ciphertext || 16-byte auth tag) }; the key never leaves the process.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const MAX_SECRET_CHARS = 4000;

/** 64 hex chars -> 32-byte Buffer, otherwise null (treat as "unconfigured"). */
export function parseKey(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

export function seal(plain, key, aad = '') {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('bad key');
  const text = String(plain ?? '');
  if (!text || text.length > MAX_SECRET_CHARS) throw new Error('bad secret');
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(String(aad)));
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final(), c.getAuthTag()]);
  return { iv, enc };
}

/** Throws on wrong key, wrong aad or tampered data. */
export function open({ iv, enc }, key, aad = '') {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('bad key');
  if (!Buffer.isBuffer(iv) || iv.length !== IV_BYTES || !Buffer.isBuffer(enc) || enc.length <= TAG_BYTES) throw new Error('bad box');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  if (aad) d.setAAD(Buffer.from(String(aad)));
  d.setAuthTag(enc.subarray(enc.length - TAG_BYTES));
  return Buffer.concat([d.update(enc.subarray(0, enc.length - TAG_BYTES)), d.final()]).toString('utf8');
}
