#!/usr/bin/env node
// One-off seed (run as root on the bridge, from /opt/details-gateway so node_modules resolve):
//   node scripts/seed-deepseek-key.mjs [/root/keep/ai-keys.env] [/etc/details-gateway/env]
// Reads DEEPSEEK_API_KEY from the first file, DATABASE_URL + SECRETS_KEY from the second (parsed, not sourced),
// inserts the key into ai_keys encrypted (provider deepseek, created_by employee 1012), runs the connection check,
// prints only provider / prefix / status, then `shred -u` the key file. Never prints the key.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { parseKey, seal } from '../src/lib/secretbox.js';
import { PROVIDERS, maskKey, checkRequest, classifyCheck, fetchJson, CHECK_TIMEOUT_MS } from '../src/lib/ai.js';

const KEY_FILE = process.argv[2] || '/root/keep/ai-keys.env';
const ENV_FILE = process.argv[3] || '/etc/details-gateway/env';
const LABEL = 'DeepSeek — المفتاح الرئيسي';
const CREATED_BY_NO = '1012';

function parseEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const keys = parseEnv(KEY_FILE);
const env = parseEnv(ENV_FILE);
const apiKey = (keys.DEEPSEEK_API_KEY || '').trim();
if (!apiKey || apiKey.length < 8 || /\s/.test(apiKey)) { console.error('DEEPSEEK_API_KEY missing or malformed in', KEY_FILE); process.exit(1); }
const secretsKey = parseKey(env.SECRETS_KEY);
if (!secretsKey) { console.error('SECRETS_KEY missing/invalid in', ENV_FILE); process.exit(1); }
if (!env.DATABASE_URL) { console.error('DATABASE_URL missing in', ENV_FILE); process.exit(1); }

const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
try {
  const { rows: [emp] } = await db.query('SELECT id FROM employees WHERE employee_no = $1', [CREATED_BY_NO]);
  const m = maskKey(apiKey);
  const { rows: [dup] } = await db.query(
    "SELECT id, status FROM ai_keys WHERE provider = 'deepseek' AND key_prefix = $1 AND key_last4 = $2 AND deleted_at IS NULL", [m.prefix, m.last4]);
  let id = dup?.id;
  if (!id) {
    const box = seal(apiKey, secretsKey, 'ai_keys');
    const { rows: [r] } = await db.query(
      `INSERT INTO ai_keys (provider, label, key_prefix, key_last4, secret_enc, secret_iv, base_url, default_model, created_by)
       VALUES ('deepseek', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [LABEL, m.prefix, m.last4, box.enc, box.iv, PROVIDERS.deepseek.base, PROVIDERS.deepseek.model, emp?.id || null]);
    id = r.id;
    await db.query("INSERT INTO audit_log (actor_employee_id, action, target, meta) VALUES ($1, 'ai.key.create', $2, $3)",
      [emp?.id || null, id, JSON.stringify({ provider: 'deepseek', label: LABEL, prefix: m.prefix, seed: true })]);
  }
  const rq = checkRequest('deepseek', PROVIDERS.deepseek.base, apiKey);
  const res = await fetchJson(rq.url, { headers: rq.headers, timeoutMs: CHECK_TIMEOUT_MS });
  const c = classifyCheck(res, apiKey);
  await db.query('UPDATE ai_keys SET status = $2, last_error = $3, last_checked_at = now() WHERE id = $1', [id, c.status, c.last_error]);
  await db.query("INSERT INTO audit_log (actor_employee_id, action, target, meta) VALUES ($1, 'ai.key.check', $2, $3)",
    [emp?.id || null, id, JSON.stringify({ provider: 'deepseek', status: c.status, http: res.status, ms: res.ms, seed: true })]);
  console.log(JSON.stringify({ provider: 'deepseek', prefix: m.prefix, last4: m.last4, status: c.status, http: res.status, existed: !!dup, created_by: emp ? CREATED_BY_NO : null }));
} finally {
  await db.end();
}
const sh = spawnSync('shred', ['-u', KEY_FILE], { stdio: 'inherit' });
console.log(sh.status === 0 ? `shredded ${KEY_FILE}` : `WARNING: shred failed (${sh.status}); remove ${KEY_FILE} manually`);
