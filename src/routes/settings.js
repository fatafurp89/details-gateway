// «إعدادات النظام» (/settings): sections grid, key/value settings, SMTP (encrypted password), backups (pg_dump), AI keys vault,
// and the internal AI endpoints for other systems (/_gw/ai/keys, /_gw/ai/complete). Every change is audited; secrets never leave the server.
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MSG, sendPage, currentUser } from './helpers.js';
import { checkProxyKey } from '../lib/perms.js';
import { SECTIONS, SECTION_KEYS, permKeyOf, allowedSections, validateBranding, validateSecurity, validateSmtp, validateNotifications, latestBackup, pruneList } from '../lib/settings.js';
import { SMTP_AAD } from '../lib/settings-store.js';
import { validateSystem } from '../lib/validate.js';
import { seal, open, MAX_SECRET_CHARS } from '../lib/secretbox.js';
import { PROVIDERS, PROVIDER_KEYS, MSG_AI, TIMEOUT_MS, CHECK_TIMEOUT_MS, validateAiKey, maskKey, canDelete, checkRequest, classifyCheck,
  validateComplete, completionRequest, normalizeCompletion, publicKey, fetchJson, baseFor, modelFor } from '../lib/ai.js';
import { sendMail, renderTestEmail } from '../lib/mail.js';
import { audit } from '../lib/audit.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const UUID_RE = /^[0-9a-f-]{36}$/;
const AI_AAD = 'ai_keys';
const BACKUP_KEEP = 14;
const SYS_COLS = ['name_ar', 'description_ar', 'icon', 'host', 'mode', 'upstream', 'status', 'sort', 'requires_grant', 'placement'];
const KEY_COLS = `k.id, k.provider, k.label, k.key_prefix, k.key_last4, k.base_url, k.default_model, k.created_by, k.created_at, k.last_checked_at,
  k.status, k.last_error, k.usage_count, k.last_used_at, e.full_name AS created_by_name`;
const MSG_S = {
  noSecretsKey: 'مفتاح التشفير (SECRETS_KEY) غير مهيأ في الخادم؛ لا يمكن حفظ الأسرار',
  noKey: 'المفتاح غير موجود',
  noSystem: 'النظام غير موجود',
  backupRunning: 'توجد نسخة احتياطية قيد التنفيذ الآن',
};

export default async function settingsRoutes(app) {
  const { db, cfg, settings } = app;
  const secretsKey = settings.secretsKey;
  const backupDir = process.env.BACKUP_DIR || join(ROOT, 'backups');
  const log = (req, action, target, meta = {}) => audit(db, { actor: req.user?.employee_id ?? null, action, target, meta, ip: req.ip });

  // ---- access: absolute admin → everything; delegated employee → granted non-sensitive sections only ----
  async function sectionsFor(user) {
    if (user.role === 'admin') return allowedSections('admin');
    const [{ rows: g }, { rows: p }] = await Promise.all([
      db.query("SELECT 1 FROM grants WHERE employee_id = $1 AND system_key = 'settings'", [user.employee_id]),
      db.query(`SELECT g.perm_key FROM perm_grants g JOIN perm_nodes n ON n.key = g.perm_key
                 WHERE g.employee_id = $1 AND g.allowed AND n.present AND n.system_key = 'settings'`, [user.employee_id]),
    ]);
    if (!g.length) return [];
    return allowedSections(user.role, p.map((r) => r.perm_key));
  }
  const sectionGuard = (section) => async (req, reply) => {
    req.user = await currentUser(app, req);
    if (!req.user) return reply.code(401).send({ error: MSG.auth });
    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) return reply.code(415).send({ error: MSG.badRequest });
    if (req.user.role === 'admin') return;
    const allowed = await sectionsFor(req.user);
    if (!allowed.includes(section)) return reply.code(403).send({ error: MSG.forbidden });
  };
  const g = (section) => ({ preHandler: sectionGuard(section) });

  // ---- page ----
  app.get('/settings', async (req, reply) => {
    const u = await currentUser(app, req);
    if (!u) return reply.redirect('/login?next=/settings');
    if (u.role !== 'admin' && !(await sectionsFor(u)).length) return reply.redirect('/denied?r=settings');
    return sendPage(reply, 'settings.html');
  });

  app.get('/api/settings/sections', { preHandler: async (req, reply) => { req.user = await currentUser(app, req); if (!req.user) return reply.code(401).send({ error: MSG.auth }); } }, async (req) => {
    const allowed = new Set(await sectionsFor(req.user));
    const updated = {};
    for (const s of ['branding', 'security', 'smtp', 'notifications']) updated[s] = await settings.updatedAt(s);
    return {
      employee: { name: req.user.full_name, employee_no: req.user.employee_no.trim(), role: req.user.role },
      sections: SECTIONS.map((s) => ({ ...s, allowed: allowed.has(s.key), perm_key: permKeyOf(s.key), updated_at: updated[s.key] || null })),
      secrets_enabled: !!secretsKey,
    };
  });

  // Public branding (name/colors/logo only) so every page, including /login, can apply it
  app.get('/api/branding', async (req, reply) => { reply.header('Cache-Control', 'no-store'); return settings.get('branding'); });

  // ---- systems (tile CRUD) ----
  app.get('/api/settings/systems', g('systems'), async () => (await db.query('SELECT * FROM systems ORDER BY sort, key')).rows);
  app.post('/api/settings/systems', g('systems'), async (req, reply) => {
    const v = validateSystem(req.body || {});
    if (v.error) return reply.code(400).send({ error: v.error });
    const local_host = String(req.body?.local_host ?? '').trim().toLowerCase() || null;
    if (local_host && !/^[a-z0-9.-]+$/.test(local_host)) return reply.code(400).send({ error: 'المضيف المحلي غير صالح' });
    const r = await db.query(
      `INSERT INTO systems (key, ${SYS_COLS.join(', ')}, local_host) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
      [v.value.key, ...SYS_COLS.map((c) => v.value[c]), local_host]);
    if (!r.rowCount) return reply.code(409).send({ error: 'مفتاح النظام مستخدم' });
    await log(req, 'system.create', v.value.key, { ...v.value, local_host });
    return { ok: true };
  });
  app.put('/api/settings/systems/:key', g('systems'), async (req, reply) => {
    const v = validateSystem({ ...(req.body || {}), key: req.params.key });
    if (v.error) return reply.code(400).send({ error: v.error });
    const local_host = String(req.body?.local_host ?? '').trim().toLowerCase() || null;
    if (local_host && !/^[a-z0-9.-]+$/.test(local_host)) return reply.code(400).send({ error: 'المضيف المحلي غير صالح' });
    const sets = SYS_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const r = await db.query(`UPDATE systems SET ${sets}, local_host = $${SYS_COLS.length + 2} WHERE key = $1`, [v.value.key, ...SYS_COLS.map((c) => v.value[c]), local_host]);
    if (!r.rowCount) return reply.code(404).send({ error: MSG_S.noSystem });
    await log(req, 'system.update', v.value.key, { ...v.value, local_host });
    return { ok: true };
  });
  app.delete('/api/settings/systems/:key', g('systems'), async (req, reply) => {
    const key = String(req.params.key || '').toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(key)) return reply.code(400).send({ error: MSG.badRequest });
    if (key === 'settings') return reply.code(400).send({ error: 'لا يمكن حذف بطاقة الإعدادات نفسها' });
    const { rows: [refs] } = await db.query(
      `SELECT (SELECT count(*) FROM grants WHERE system_key = $1)::int AS grants, (SELECT count(*) FROM perm_nodes WHERE system_key = $1)::int AS perms,
              (SELECT count(*) FROM notifications WHERE system_key = $1)::int AS notifs, (SELECT count(*) FROM infra_services WHERE system_key = $1)::int AS services`, [key]);
    if (refs.perms || refs.notifs) return reply.code(409).send({ error: 'النظام مرتبط بشجرة صلاحيات أو إشعارات؛ اجعله «متوقف» بدل حذفه' });
    const r = await db.query('WITH d AS (DELETE FROM grants WHERE system_key = $1), s AS (UPDATE infra_services SET system_key = NULL WHERE system_key = $1) DELETE FROM systems WHERE key = $1', [key]);
    if (!r.rowCount) return reply.code(404).send({ error: MSG_S.noSystem });
    await log(req, 'system.delete', key, { grants_removed: refs.grants, services_unlinked: refs.services });
    return { ok: true };
  });

  // ---- key/value sections ----
  const kv = {
    branding: validateBranding, security: validateSecurity, notifications: validateNotifications,
  };
  for (const section of Object.keys(kv)) {
    app.get(`/api/settings/${section}`, g(section), async () => ({ value: await settings.get(section), updated_at: await settings.updatedAt(section) }));
    app.put(`/api/settings/${section}`, g(section), async (req, reply) => {
      const v = kv[section](req.body || {});
      if (v.error) return reply.code(400).send({ error: v.error });
      await settings.set(section, v.value, req.user.employee_id);
      await log(req, `settings.${section}.update`, section, v.value);
      return { ok: true, value: await settings.get(section) };
    });
  }

  // ---- SMTP: host/port/user stored; password sealed with SECRETS_KEY; never returned ----
  app.get('/api/settings/smtp', g('smtp'), async () => {
    const s = await settings.smtp();
    return { value: { host: s.host, port: s.port, user: s.user, from_name: s.fromName }, password_set: s.password_set, password_source: s.password_source,
      secrets_enabled: !!secretsKey, updated_at: await settings.updatedAt('smtp') };
  });
  app.put('/api/settings/smtp', g('smtp'), async (req, reply) => {
    const v = validateSmtp(req.body || {});
    if (v.error) return reply.code(400).send({ error: v.error });
    const { rows: [cur] } = await db.query("SELECT value FROM settings WHERE key = 'smtp'");
    const value = { ...v.value };
    if (v.password) {
      if (!secretsKey) return reply.code(503).send({ error: MSG_S.noSecretsKey });
      const box = seal(v.password, secretsKey, SMTP_AAD);
      value.password_enc = box.enc.toString('base64'); value.password_iv = box.iv.toString('base64');
    } else if (req.body?.clear_password === true) {
      // leave password_enc out → env SMTP_PASS fallback
    } else if (cur?.value?.password_enc) { value.password_enc = cur.value.password_enc; value.password_iv = cur.value.password_iv; }
    await settings.set('smtp', value, req.user.employee_id);
    await log(req, 'settings.smtp.update', v.value.host, { host: v.value.host, port: v.value.port, user: v.value.user, password_changed: !!v.password, password_cleared: req.body?.clear_password === true });
    return { ok: true };
  });
  app.post('/api/settings/smtp/test', { ...g('smtp'), config: { rateLimit: { max: 5, timeWindow: 600_000 } } }, async (req, reply) => {
    const to = String(req.body?.to || req.user.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to)) return reply.code(400).send({ error: 'بريد المستلم غير صالح' });
    try {
      await sendMail(await settings.smtp(), to, renderTestEmail({ name: req.user.full_name }));
      await log(req, 'settings.smtp_test', to, { ok: true });
      return { ok: true, to };
    } catch (err) {
      req.log.error({ err: err.message }, 'smtp test failed');
      await log(req, 'settings.smtp_test', to, { ok: false });
      return reply.code(502).send({ error: 'فشل إرسال رسالة الاختبار. راجع إعدادات SMTP وكلمة المرور.' });
    }
  });

  // ---- backups: list + run pg_dump (fixed args, connection via env, retention 14) ----
  async function listBackups(dir) {
    try {
      const names = await readdir(dir);
      const out = [];
      for (const name of names) {
        if (!/^details_gateway[-_].*\.(dump|sql|sql\.gz)$/.test(name)) continue;
        const s = await stat(join(dir, name));
        if (s.isFile()) out.push({ name, size: s.size, mtime: s.mtime.toISOString() });
      }
      return { dir, files: out.sort((a, b) => new Date(b.mtime) - new Date(a.mtime)), error: null };
    } catch (e) { return { dir, files: [], error: e.code === 'ENOENT' ? 'المجلد غير موجود بعد' : (e.code === 'EACCES' ? 'غير متاح لحساب الخدمة' : e.code) }; }
  }
  app.get('/api/settings/backup', g('backup'), async () => {
    const [primary, root] = await Promise.all([listBackups(backupDir), listBackups('/root/backups')]);
    return { primary, root, latest: latestBackup([...primary.files, ...root.files]), keep: BACKUP_KEEP, running: backupRunning, pg_dump: await hasPgDump() };
  });
  let backupRunning = false;
  let pgDumpOk = null;
  async function hasPgDump() {
    if (pgDumpOk !== null) return pgDumpOk;
    pgDumpOk = await new Promise((res) => { const p = spawn('pg_dump', ['--version'], { stdio: 'ignore' }); p.on('error', () => res(false)); p.on('exit', (c) => res(c === 0)); });
    return pgDumpOk;
  }
  function pgEnv() {
    const u = new URL(cfg.databaseUrl);
    return { PATH: process.env.PATH || '/usr/bin:/bin', PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.replace(/^\//, ''), PGSSLMODE: u.searchParams.get('sslmode') || 'prefer' };
  }
  app.post('/api/settings/backup/run', { ...g('backup'), config: { rateLimit: { max: 3, timeWindow: 600_000 } } }, async (req, reply) => {
    if (backupRunning) return reply.code(409).send({ error: MSG_S.backupRunning });
    if (!(await hasPgDump())) return reply.code(503).send({ error: 'أداة pg_dump غير متوفرة على الخادم' });
    backupRunning = true;
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const name = `details_gateway-${stamp}.dump`;
    const file = join(backupDir, name);
    const t0 = Date.now();
    try {
      await mkdir(backupDir, { recursive: true, mode: 0o700 });
      const result = await new Promise((res) => {
        let err = '';
        const p = spawn('pg_dump', ['--format=custom', '--compress=6', '--no-owner', '--no-privileges', `--file=${file}`], { env: pgEnv(), stdio: ['ignore', 'ignore', 'pipe'] });
        p.stderr.on('data', (d) => { err += String(d).slice(0, 500); });
        p.on('error', (e) => res({ code: -1, err: e.message }));
        p.on('exit', (code) => res({ code, err }));
      });
      if (result.code !== 0) {
        await unlink(file).catch(() => {});
        req.log.error({ code: result.code, err: result.err.slice(0, 300) }, 'pg_dump failed');
        await log(req, 'settings.backup.run', name, { ok: false, code: result.code });
        return reply.code(500).send({ error: 'فشل إنشاء النسخة الاحتياطية (pg_dump)' });
      }
      const s = await stat(file);
      const all = (await listBackups(backupDir)).files;
      const pruned = pruneList(all, BACKUP_KEEP);
      for (const n of pruned) await unlink(join(backupDir, basename(n))).catch(() => {});
      await log(req, 'settings.backup.run', name, { ok: true, size: s.size, ms: Date.now() - t0, pruned });
      return { ok: true, file: name, size: s.size, ms: Date.now() - t0, pruned };
    } finally { backupRunning = false; }
  });

  // ---- AI keys vault (admin only) ----
  const needKey = (reply) => (secretsKey ? null : reply.code(503).send({ error: MSG_S.noSecretsKey }));
  const loadKeyRow = async (id, withSecret = false) => (await db.query(
    `SELECT ${KEY_COLS}${withSecret ? ', k.secret_enc, k.secret_iv' : ''} FROM ai_keys k LEFT JOIN employees e ON e.id = k.created_by WHERE k.id = $1 AND k.deleted_at IS NULL`, [id])).rows[0] || null;
  const openKey = (row) => open({ iv: row.secret_iv, enc: row.secret_enc }, secretsKey, AI_AAD);
  async function runCheck(row, actorId = null, ip = null) {
    let secret;
    try { secret = openKey(row); } catch { return { status: 'disconnected', last_error: 'تعذر فك تشفير المفتاح؛ ربما تغيّر SECRETS_KEY' }; }
    const rq = checkRequest(row.provider, row.base_url, secret);
    const res = await fetchJson(rq.url, { headers: rq.headers, timeoutMs: CHECK_TIMEOUT_MS });
    const c = classifyCheck(res, secret);
    await db.query('UPDATE ai_keys SET status = $2, last_error = $3, last_checked_at = now() WHERE id = $1', [row.id, c.status, c.last_error]);
    await audit(db, { actor: actorId, action: 'ai.key.check', target: row.id, meta: { provider: row.provider, status: c.status, http: res.status, ms: res.ms }, ip });
    return { ...c, http: res.status, ms: res.ms };
  }

  app.get('/api/settings/ai/providers', g('ai_keys'), async () => PROVIDER_KEYS.map((k) => ({ key: k, ...PROVIDERS[k] })));
  app.get('/api/settings/ai/keys', g('ai_keys'), async () => {
    const { rows } = await db.query(`SELECT ${KEY_COLS} FROM ai_keys k LEFT JOIN employees e ON e.id = k.created_by WHERE k.deleted_at IS NULL ORDER BY k.provider, k.created_at`);
    return { keys: rows.map(publicKey), secrets_enabled: !!secretsKey };
  });
  app.post('/api/settings/ai/keys', g('ai_keys'), async (req, reply) => {
    if (needKey(reply)) return;
    const v = validateAiKey(req.body || {}, { isNew: true });
    if (v.error) return reply.code(400).send({ error: v.error });
    if (v.key.length > MAX_SECRET_CHARS) return reply.code(400).send({ error: 'المفتاح طويل جدًا' });
    const box = seal(v.key, secretsKey, AI_AAD);
    const m = maskKey(v.key);
    const { rows: [r] } = await db.query(
      `INSERT INTO ai_keys (provider, label, key_prefix, key_last4, secret_enc, secret_iv, base_url, default_model, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [v.value.provider, v.value.label, m.prefix, m.last4, box.enc, box.iv, v.value.base_url, v.value.default_model, req.user.employee_id]);
    await log(req, 'ai.key.create', r.id, { provider: v.value.provider, label: v.value.label, prefix: m.prefix });
    const row = await loadKeyRow(r.id, true);
    const check = req.body?.check === false ? null : await runCheck(row, req.user.employee_id, req.ip);
    return { ok: true, id: r.id, key: publicKey(await loadKeyRow(r.id)), check };
  });
  app.get('/api/settings/ai/keys/:id', g('ai_keys'), async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const row = await loadKeyRow(req.params.id);
    if (!row) return reply.code(404).send({ error: MSG_S.noKey });
    const [{ rows: usage }, { rows: last }] = await Promise.all([
      db.query(`SELECT count(*)::int AS calls, count(*) FILTER (WHERE ok)::int AS ok, coalesce(sum(total_tokens),0)::bigint AS tokens, coalesce(avg(ms),0)::int AS avg_ms,
                       count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS calls_30d
                  FROM ai_usage_log WHERE key_id = $1`, [row.id]),
      db.query('SELECT system_key, model, prompt_tokens, completion_tokens, total_tokens, ms, ok, error, created_at FROM ai_usage_log WHERE key_id = $1 ORDER BY id DESC LIMIT 20', [row.id]),
    ]);
    return { key: publicKey(row), usage: { ...usage[0], tokens: Number(usage[0].tokens) }, last_calls: last };
  });
  app.put('/api/settings/ai/keys/:id', g('ai_keys'), async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const row = await loadKeyRow(req.params.id);
    if (!row) return reply.code(404).send({ error: MSG_S.noKey });
    const v = validateAiKey({ ...(req.body || {}), provider: row.provider }, { isNew: false });
    if (v.error) return reply.code(400).send({ error: v.error });
    if (v.key) {
      if (needKey(reply)) return;
      const box = seal(v.key, secretsKey, AI_AAD); const m = maskKey(v.key);
      await db.query(`UPDATE ai_keys SET label = $2, base_url = $3, default_model = $4, secret_enc = $5, secret_iv = $6, key_prefix = $7, key_last4 = $8, status = 'unknown', last_error = NULL WHERE id = $1`,
        [row.id, v.value.label, v.value.base_url, v.value.default_model, box.enc, box.iv, m.prefix, m.last4]);
    } else {
      await db.query('UPDATE ai_keys SET label = $2, base_url = $3, default_model = $4 WHERE id = $1', [row.id, v.value.label, v.value.base_url, v.value.default_model]);
    }
    await log(req, 'ai.key.update', row.id, { label: v.value.label, key_replaced: !!v.key });
    return { ok: true, key: publicKey(await loadKeyRow(row.id)) };
  });
  app.post('/api/settings/ai/keys/:id/check', { ...g('ai_keys'), config: { rateLimit: { max: 30, timeWindow: 600_000 } } }, async (req, reply) => {
    if (needKey(reply)) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const row = await loadKeyRow(req.params.id, true);
    if (!row) return reply.code(404).send({ error: MSG_S.noKey });
    const c = await runCheck(row, req.user.employee_id, req.ip);
    return { ok: true, ...c, key: publicKey(await loadKeyRow(row.id)) };
  });
  app.delete('/api/settings/ai/keys/:id', g('ai_keys'), async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const row = await loadKeyRow(req.params.id);
    if (!row) return reply.code(404).send({ error: MSG_S.noKey });
    if (!canDelete(row.status)) { await log(req, 'ai.key.delete_denied', row.id, { status: row.status }); return reply.code(409).send({ error: MSG_AI.noDelete }); }
    await db.query('UPDATE ai_keys SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [row.id]);
    await log(req, 'ai.key.delete', row.id, { provider: row.provider, label: row.label, status: row.status });
    return { ok: true };
  });

  // ---- AI monitoring: usage logs, filters, trends ----
  app.get('/api/settings/ai-monitoring', g('ai_keys'), async () => {
    // Get overview stats: total calls, errors in last 24h, top providers
    const { rows: [overview] } = await db.query(
      `SELECT
        count(*)::int AS total_calls,
        count(*) FILTER (WHERE ok)::int AS successful_calls,
        count(*) FILTER (WHERE NOT ok)::int AS failed_calls,
        count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS calls_24h,
        count(*) FILTER (WHERE NOT ok AND created_at > now() - interval '24 hours')::int AS errors_24h,
        coalesce(round(avg(ms)::numeric), 0)::int AS avg_ms,
        coalesce(sum(total_tokens)::bigint, 0) AS total_tokens
       FROM ai_usage_log`);

    // Get provider stats
    const { rows: providerRows } = await db.query(
      `SELECT k.provider, count(*)::int AS calls,
              count(*) FILTER (WHERE aul.ok)::int AS ok,
              count(*) FILTER (WHERE aul.created_at > now() - interval '24 hours')::int AS calls_24h,
              coalesce(sum(aul.total_tokens)::bigint, 0) AS tokens
       FROM ai_keys k
       LEFT JOIN ai_usage_log aul ON aul.key_id = k.id
       WHERE k.deleted_at IS NULL
       GROUP BY k.provider
       ORDER BY calls DESC`);

    const providers = providerRows.map(p => ({
      ...p,
      provider_name: PROVIDERS[p.provider]?.name || p.provider
    }));

    // Daily trend (last 30 days)
    const { rows: dailyTrend } = await db.query(
      `SELECT
        date_trunc('day', created_at AT TIME ZONE 'Asia/Riyadh')::date AS day,
        count(*)::int AS requests,
        count(*) FILTER (WHERE ok)::int AS successful,
        count(*) FILTER (WHERE NOT ok)::int AS failed
       FROM ai_usage_log
       WHERE created_at > now() - interval '30 days'
       GROUP BY date_trunc('day', created_at AT TIME ZONE 'Asia/Riyadh')
       ORDER BY day DESC`);

    return { overview, providers, daily_trend: dailyTrend };
  });

  app.get('/api/settings/ai-usage/:provider', g('ai_keys'), async (req, reply) => {
    const provider = String(req.params.provider || '').toLowerCase().trim();
    if (!PROVIDER_KEYS.includes(provider)) return reply.code(400).send({ error: 'المزود غير معروف' });

    const dateFrom = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (!Number.isFinite(dateFrom.getTime()) || !Number.isFinite(dateTo.getTime()))
      return reply.code(400).send({ error: 'نطاق التاريخ غير صالح' });

    const model = req.query.model ? String(req.query.model).trim() : null;
    const status = req.query.status ? String(req.query.status).trim() : null; // 'ok' or 'error'

    // Detailed logs with key info
    const params = [provider, dateFrom, dateTo];
    let whereClause = `k.provider = $1 AND aul.created_at >= $2 AND aul.created_at <= $3`;
    if (model) {
      whereClause += ` AND aul.model = $${params.length + 1}`;
      params.push(model);
    }
    if (status === 'ok') {
      whereClause += ` AND aul.ok = true`;
    } else if (status === 'error') {
      whereClause += ` AND aul.ok = false`;
    }

    const { rows: logRows } = await db.query(
      `SELECT
        aul.id, aul.system_key, aul.model, aul.prompt_tokens, aul.completion_tokens, aul.total_tokens,
        aul.ms, aul.ok, aul.error, aul.created_at, k.label, k.key_prefix, k.key_last4,
        k.provider
       FROM ai_usage_log aul
       JOIN ai_keys k ON k.id = aul.key_id
       WHERE ${whereClause}
       ORDER BY aul.created_at DESC
       LIMIT 1000`,
      params);

    const logs = logRows.map(l => ({
      ...l,
      key_display: `${l.key_prefix}…${l.key_last4}`,
      provider_name: PROVIDERS[l.provider]?.name || l.provider
    }));

    // Summary stats
    const { rows: [summary] } = await db.query(
      `SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE aul.ok)::int AS successful,
        count(*) FILTER (WHERE NOT aul.ok)::int AS failed,
        coalesce(round(avg(aul.ms)::numeric), 0)::int AS avg_ms,
        coalesce(max(aul.ms)::int, 0) AS max_ms,
        coalesce(min(aul.ms)::int, 0) AS min_ms,
        coalesce(sum(aul.total_tokens)::bigint, 0) AS total_tokens,
        count(DISTINCT aul.model)::int AS unique_models
       FROM ai_usage_log aul
       JOIN ai_keys k ON k.id = aul.key_id
       WHERE ${whereClause}`,
      params);

    // Available models for filter
    const { rows: models } = await db.query(
      `SELECT DISTINCT aul.model FROM ai_usage_log aul
       JOIN ai_keys k ON k.id = aul.key_id
       WHERE k.provider = $1
       ORDER BY aul.model`,
      [provider]);

    // Top error types
    const { rows: topErrors } = await db.query(
      `SELECT aul.error, count(*)::int AS count
       FROM ai_usage_log aul
       JOIN ai_keys k ON k.id = aul.key_id
       WHERE k.provider = $1 AND aul.ok = false AND aul.error IS NOT NULL
       GROUP BY aul.error
       ORDER BY count DESC
       LIMIT 5`,
      [provider]);

    return {
      provider,
      provider_name: PROVIDERS[provider]?.name || provider,
      logs,
      summary,
      models: models.map(m => m.model),
      top_errors: topErrors,
      from: dateFrom,
      to: dateTo
    };
  });

  // ---- internal (nginx exposes /_gw/* only on loopback and the tunnel) ----
  const proxyGuard = async (req, reply) => {
    const r = checkProxyKey(req.headers['x-gw-proxy-key'], cfg.proxyKey);
    reply.header('Cache-Control', 'no-store');
    if (r === 'unconfigured') { req.log.warn('GATEWAY_PROXY_KEY is not set; internal endpoint refused'); return reply.code(503).send({ error: 'الخدمة الداخلية غير مهيأة' }); }
    if (r !== 'ok') return reply.code(401).send({ error: MSG.forbidden });
  };
  app.get('/_gw/ai/keys', { preHandler: proxyGuard, logLevel: 'warn' }, async (req, reply) => {
    const provider = req.query.provider === undefined ? null : String(req.query.provider).trim().toLowerCase();
    if (provider !== null && !PROVIDER_KEYS.includes(provider)) return reply.code(400).send({ error: 'المزود غير معروف' });
    const { rows } = await db.query(
      `SELECT ${KEY_COLS} FROM ai_keys k LEFT JOIN employees e ON e.id = k.created_by WHERE k.deleted_at IS NULL AND ($1::text IS NULL OR k.provider = $1) ORDER BY k.provider, k.created_at`, [provider]);
    return { keys: rows.map((r) => { const p = publicKey(r); delete p.created_by; delete p.created_by_name; return p; }) };
  });

  app.post('/_gw/ai/complete', { preHandler: proxyGuard, logLevel: 'warn', bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    if (!secretsKey) return reply.code(503).send({ error: MSG_S.noSecretsKey });
    const v = validateComplete(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const q = v.value;
    const systemKey = (q.system || String(req.headers['x-gw-system'] || '').trim().toLowerCase() || null)?.slice(0, 40) || null;
    let row = null;
    if (q.key_id) {
      row = await loadKeyRow(q.key_id, true);
      if (row && q.provider && row.provider !== q.provider) row = null;
    } else {
      // best key for the provider: checked valid first, then unchecked; least used first
      const { rows } = await db.query(
        `SELECT ${KEY_COLS}, k.secret_enc, k.secret_iv FROM ai_keys k LEFT JOIN employees e ON e.id = k.created_by
          WHERE k.deleted_at IS NULL AND k.provider = $1 AND k.status IN ('valid','unknown')
          ORDER BY (k.status = 'valid') DESC, k.usage_count ASC, k.created_at ASC LIMIT 1`, [q.provider]);
      row = rows[0] || null;
    }
    if (!row) return reply.code(404).send({ error: MSG_AI.noKey });
    const model = modelFor(row.provider, q.model, row.default_model);
    if (!model) return reply.code(400).send({ error: 'حدد النموذج (model) أو اضبط النموذج الافتراضي للمفتاح' });
    let secret;
    try { secret = openKey(row); } catch { return reply.code(500).send({ error: 'تعذر فك تشفير المفتاح؛ ربما تغيّر SECRETS_KEY' }); }
    const rq = completionRequest(row.provider, row.base_url, secret, { model, messages: q.messages, max_tokens: q.max_tokens, temperature: q.temperature });
    const res = await fetchJson(rq.url, { method: 'POST', headers: rq.headers, body: rq.body, timeoutMs: TIMEOUT_MS });
    const ok = !res.error && res.status >= 200 && res.status < 300 && res.json;
    const out = ok ? normalizeCompletion(row.provider, res.json, model) : null;
    const errText = ok ? null : (res.error || classifyCheck(res, secret).last_error);
    await db.query(
      `INSERT INTO ai_usage_log (system_key, key_id, model, prompt_tokens, completion_tokens, total_tokens, ms, ok, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [systemKey, row.id, model, out?.usage.prompt_tokens ?? null, out?.usage.completion_tokens ?? null, out?.usage.total_tokens ?? null, res.ms, !!ok, errText]);
    await db.query(`UPDATE ai_keys SET usage_count = usage_count + 1, last_used_at = now()${ok ? ", status = 'valid', last_error = NULL, last_checked_at = now()" : ''} WHERE id = $1`, [row.id]);
    if (!ok && (res.status === 401 || res.status === 403)) await db.query("UPDATE ai_keys SET status = 'invalid', last_error = $2, last_checked_at = now() WHERE id = $1", [row.id, errText]);
    if (!ok) {
      req.log.warn({ provider: row.provider, key_id: row.id, http: res.status, ms: res.ms, system: systemKey }, 'ai completion failed');
      return reply.code(res.error ? 504 : 502).send({ error: errText, provider: row.provider, key_id: row.id, provider_status: res.status || null, ms: res.ms });
    }
    return { ok: true, provider: row.provider, key_id: row.id, model, ms: res.ms, base_url: baseFor(row.provider, row.base_url), ...out };
  });
}
