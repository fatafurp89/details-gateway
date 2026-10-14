// Cached reader of the `settings` table (defaults → env → stored row). One instance per app (app.settings).
import { effective, DEFAULTS } from './settings.js';
import { parseKey, open } from './secretbox.js';

const TTL_MS = 30_000;
export const SMTP_AAD = 'settings:smtp';

export function createSettingsStore(db, { env = process.env, secretsKey = '', smtpEnv = null, logger = null } = {}) {
  const cache = new Map(); // section -> { at, value, row }
  const key = parseKey(secretsKey);

  async function row(section) {
    const { rows: [r] } = await db.query('SELECT value, updated_at FROM settings WHERE key = $1', [section]);
    return r || null;
  }
  async function raw(section) {
    const c = cache.get(section);
    if (c && Date.now() - c.at < TTL_MS) return c;
    let r = null;
    try { r = await row(section); } catch (e) { if (logger) logger.warn({ err: e.message }, 'settings read failed; defaults used'); }
    const entry = { at: Date.now(), row: r, value: effective(section, r?.value || {}, env) };
    cache.set(section, entry);
    return entry;
  }
  /** Effective values for a section (never includes secrets). */
  async function get(section) { return (await raw(section)).value; }
  async function updatedAt(section) { return (await raw(section)).row?.updated_at || null; }
  /** Effective SMTP transport config: stored host/port/user + decrypted password, falling back to env SMTP_PASS. */
  async function smtp() {
    const e = await raw('smtp');
    const v = e.value;
    let pass = smtpEnv?.pass || '';
    const enc = e.row?.value?.password_enc, iv = e.row?.value?.password_iv;
    if (key && enc && iv) {
      try { pass = open({ enc: Buffer.from(enc, 'base64'), iv: Buffer.from(iv, 'base64') }, key, SMTP_AAD); }
      catch (err) { if (logger) logger.error({ err: err.message }, 'smtp password decrypt failed (SECRETS_KEY changed?)'); }
    }
    return { host: v.host, port: Number(v.port) || 465, user: v.user || smtpEnv?.user || '', pass, fromName: v.from_name || smtpEnv?.fromName || DEFAULTS.smtp.from_name,
      password_set: !!pass, password_source: key && enc ? 'settings' : (smtpEnv?.pass ? 'env' : 'none') };
  }
  async function set(section, value, updatedBy = null) {
    await db.query(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [section, JSON.stringify(value), updatedBy]);
    cache.delete(section);
  }
  const invalidate = (section) => (section ? cache.delete(section) : cache.clear());
  return { get, set, smtp, updatedAt, invalidate, secretsKey: key };
}
