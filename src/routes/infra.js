// «المعلومات التقنية»: agent reports (proxy key) + admin API for nodes/links/services + OTP-guarded encrypted secrets
import { requireAdmin, MSG } from './helpers.js';
import { checkProxyKey } from '../lib/perms.js';
import { validateNode, validateLink, validateService, validateReport, matchProbes, effectiveStatus, computeAlerts, daysUntil,
  humanizeUptime, buildInfraTree, pct, KEY_RE } from '../lib/infra.js';
import { parseKey, seal, open, MAX_SECRET_CHARS } from '../lib/secretbox.js';
import { generateCode, hashCode, checkOtp, OTP_TTL_MS, OTP_MAX_ATTEMPTS, RESEND_MS } from '../lib/otp.js';
import { sendMail, renderInfraOtpEmail } from '../lib/mail.js';
import { maskEmail } from '../lib/mask.js';
import { audit } from '../lib/audit.js';
import { tx } from '../lib/db.js';

const UUID_RE = /^[0-9a-f-]{36}$/;
const ID_RE = /^\d{1,9}$/;
const PURPOSE = 'infra_secrets';
const AAD = 'infra_secrets';
const KEEP_DAYS = 7;
const NODE_COLS = `key, name_ar, kind, model, provider, plan, subscription_end::text AS subscription_end, status_source, status, status_at,
  public_ip, local_ip, tailscale_ip, wg_ip, hostname, os, urls, username, notes, parent_key, sort, external, created_at, updated_at`;
const EDIT_COLS = ['name_ar', 'kind', 'model', 'provider', 'plan', 'subscription_end', 'status_source', 'status', 'public_ip', 'local_ip', 'tailscale_ip', 'wg_ip',
  'hostname', 'os', 'urls', 'username', 'notes', 'parent_key', 'sort', 'external'];
const MSG_INFRA = {
  noNode: 'العقدة غير موجودة',
  noSecret: 'السر غير موجود',
  noKey: 'مفتاح تشفير الأسرار (SECRETS_KEY) غير مهيأ في الخادم',
  codeNeeded: 'أدخل رمز التحقق المرسل إلى بريدك',
  secretNeeded: 'قيمة السر مطلوبة',
};

export default async function infraRoutes(app) {
  const { db, cfg, settings } = app;
  const secretsKey = parseKey(cfg.secretsKey);
  const log = (req, action, target, meta = {}) => audit(db, { actor: req.user?.employee_id ?? null, action, target, meta, ip: req.ip });

  // ---- summary helpers (shared by tree / topology / node) ----
  const summarize = (p) => {
    if (!p || p.probe) return p ? { ping_ms: p.ms ?? null } : null;
    const diskMax = (p.disks || []).reduce((m, d) => Math.max(m, pct(d.used, d.size) ?? 0), 0);
    return {
      uptime_s: p.uptime_s ?? null, uptime_ar: p.uptime_s != null ? humanizeUptime(p.uptime_s) : null,
      load: p.load || [], mem_pct: p.mem ? pct(p.mem.used, p.mem.total) : null, disk_max_pct: (p.disks || []).length ? diskMax : null,
      services_down: (p.services || []).filter((s) => !s.active).length, updates: p.updates?.count ?? null,
    };
  };
  const decorate = (n, now) => {
    const payload = n.last_payload || null;
    return {
      ...n, last_payload: undefined, status: effectiveStatus(n, now), raw_status: n.status, alerts: computeAlerts(n, payload, now),
      days_left: daysUntil(n.subscription_end, now), summary: summarize(payload), last_report: n.last_report || null,
    };
  };
  const loadNodes = async () => (await db.query(
    `SELECT ${NODE_COLS}, s.reported_at AS last_report, s.payload AS last_payload
       FROM infra_nodes n
       LEFT JOIN LATERAL (SELECT reported_at, payload FROM infra_status WHERE node_key = n.key ORDER BY reported_at DESC LIMIT 1) s ON true
      ORDER BY sort, key`)).rows;
  const loadNode = async (key) => (await db.query(`SELECT ${NODE_COLS} FROM infra_nodes n WHERE key = $1`, [key])).rows[0] || null;
  const validKey = (k) => typeof k === 'string' && KEY_RE.test(k);

  // ================= internal: agent report =================
  const proxyGuard = async (req, reply) => {
    const r = checkProxyKey(req.headers['x-gw-proxy-key'], cfg.proxyKey);
    reply.header('Cache-Control', 'no-store');
    if (r === 'unconfigured') { req.log.warn('GATEWAY_PROXY_KEY is not set; internal endpoint refused'); return reply.code(503).send({ error: 'الخدمة الداخلية غير مهيأة' }); }
    if (r !== 'ok') return reply.code(401).send({ error: MSG.forbidden });
  };

  app.post('/_gw/infra/report', { preHandler: proxyGuard, logLevel: 'warn' }, async (req, reply) => {
    const v = validateReport(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const r = v.value;
    const node = await loadNode(r.node);
    if (!node) return reply.code(404).send({ error: MSG_INFRA.noNode });
    const { probes, ...payload } = r;
    const others = probes.length ? (await db.query('SELECT key, local_ip, public_ip, wg_ip, tailscale_ip, hostname FROM infra_nodes WHERE status_source = $1', ['ping'])).rows : [];
    const matched = matchProbes(probes, others);
    const out = await tx(db, async (c) => {
      await c.query('INSERT INTO infra_status (node_key, payload) VALUES ($1, $2)', [node.key, JSON.stringify(payload)]);
      await c.query(
        `UPDATE infra_nodes SET status = 'up', status_at = now(), status_source = CASE WHEN status_source = 'manual' THEN 'agent' ELSE status_source END,
           os = COALESCE($2, os), updated_at = now() WHERE key = $1`, [node.key, r.os]);
      await c.query(`DELETE FROM infra_status WHERE node_key = $1 AND reported_at < now() - make_interval(days => $2)`, [node.key, KEEP_DAYS]);
      let n = 0;
      for (const p of probes) {
        const key = matched.get(p.host);
        if (!key) continue;
        await c.query('UPDATE infra_nodes SET status = $2, status_at = now(), updated_at = now() WHERE key = $1', [key, p.ok ? 'up' : 'down']);
        await c.query('INSERT INTO infra_status (node_key, payload) VALUES ($1, $2)', [key, JSON.stringify({ probe: true, ok: p.ok, ms: p.ms, via: node.key })]);
        await c.query(`DELETE FROM infra_status WHERE node_key = $1 AND reported_at < now() - make_interval(days => $2)`, [key, KEEP_DAYS]);
        n++;
      }
      return n;
    });
    return { ok: true, node: node.key, probes_matched: out, probes_ignored: probes.length - out };
  });

  // ================= admin API (super admin only) =================
  const guard = { preHandler: requireAdmin(app) };

  app.get('/api/admin/infra/tree', guard, async () => {
    const now = new Date();
    const nodes = (await loadNodes()).map((n) => decorate(n, now));
    const alerts = nodes.reduce((s, n) => s + n.alerts.length, 0);
    return { roots: buildInfraTree(nodes), alerts_total: alerts, now: now.toISOString() };
  });

  app.get('/api/admin/infra/topology', guard, async () => {
    const now = new Date();
    const [nodes, links, services, systems] = await Promise.all([
      loadNodes(), db.query('SELECT id, from_key, to_key, kind, label_ar FROM infra_links ORDER BY id'),
      db.query('SELECT id, node_key, name_ar, system_key, port, unit_name, url, notes, sort FROM infra_services ORDER BY node_key, sort, id'),
      db.query('SELECT key, name_ar, icon FROM systems ORDER BY sort, key'),
    ]);
    return { nodes: nodes.map((n) => decorate(n, now)), links: links.rows, services: services.rows, systems: systems.rows, secrets_enabled: !!secretsKey, now: now.toISOString() };
  });

  app.get('/api/admin/infra/node/:key', guard, async (req, reply) => {
    const key = req.params.key;
    if (!validKey(key)) return reply.code(400).send({ error: MSG.badRequest });
    const now = new Date();
    const { rows: [n] } = await db.query(
      `SELECT ${NODE_COLS}, s.reported_at AS last_report, s.payload AS last_payload FROM infra_nodes n
         LEFT JOIN LATERAL (SELECT reported_at, payload FROM infra_status WHERE node_key = n.key ORDER BY reported_at DESC LIMIT 1) s ON true
        WHERE key = $1`, [key]);
    if (!n) return reply.code(404).send({ error: MSG_INFRA.noNode });
    const [services, links, secrets, reveals, history] = await Promise.all([
      db.query('SELECT s.id, s.name_ar, s.system_key, sy.name_ar AS system_name, s.port, s.unit_name, s.url, s.notes, s.sort FROM infra_services s LEFT JOIN systems sy ON sy.key = s.system_key WHERE s.node_key = $1 ORDER BY s.sort, s.id', [key]),
      db.query(`SELECT l.id, l.from_key, l.to_key, l.kind, l.label_ar, f.name_ar AS from_name, t.name_ar AS to_name
                  FROM infra_links l JOIN infra_nodes f ON f.key = l.from_key JOIN infra_nodes t ON t.key = l.to_key
                 WHERE l.from_key = $1 OR l.to_key = $1 ORDER BY l.kind, l.id`, [key]),
      db.query('SELECT id, label_ar, username, updated_at FROM infra_secrets WHERE node_key = $1 ORDER BY created_at', [key]),
      db.query(`SELECT r.at, r.ip, e.employee_no, e.full_name, s.label_ar FROM infra_secret_reveals r JOIN infra_secrets s ON s.id = r.secret_id
                  JOIN employees e ON e.id = r.employee_id WHERE s.node_key = $1 ORDER BY r.at DESC LIMIT 10`, [key]),
      db.query(`SELECT reported_at, payload->'load'->0 AS load1, payload->'mem' AS mem FROM infra_status
                 WHERE node_key = $1 AND NOT coalesce((payload->>'probe')::boolean, false) ORDER BY reported_at DESC LIMIT 60`, [key]),
    ]);
    const d = decorate(n, now);
    return { node: d, status: n.last_report ? { reported_at: n.last_report, payload: n.last_payload } : null, alerts: d.alerts,
      services: services.rows, links: links.rows, secrets: secrets.rows, reveals: reveals.rows, history: history.rows.reverse(), secrets_enabled: !!secretsKey };
  });

  app.post('/api/admin/infra/node', guard, async (req, reply) => {
    const v = validateNode(req.body, { isNew: true });
    if (v.error) return reply.code(400).send({ error: v.error });
    const n = v.value;
    if (n.parent_key && !(await loadNode(n.parent_key))) return reply.code(400).send({ error: 'العقدة الأب غير موجودة' });
    try {
      await tx(db, async (c) => {
        await c.query(
          `INSERT INTO infra_nodes (key, name_ar, kind, model, provider, plan, subscription_end, status_source, public_ip, local_ip, tailscale_ip, wg_ip, hostname, os, urls, username, notes, parent_key, sort, external)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [n.key, n.name_ar, n.kind, n.model, n.provider, n.plan, n.subscription_end, n.status_source, n.public_ip, n.local_ip, n.tailscale_ip, n.wg_ip,
            n.hostname, n.os, JSON.stringify(n.urls), n.username, n.notes, n.parent_key, n.sort, n.external]);
        if (n.parent_key) {
          await c.query(`INSERT INTO infra_links (from_key, to_key, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [n.parent_key, n.key, ['vps', 'provider', 'dns'].includes(n.kind) ? 'internet' : 'lan']);
        }
        await log(req, 'infra.node.create', n.key, { name_ar: n.name_ar, kind: n.kind, parent_key: n.parent_key });
      });
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'المفتاح مستخدم لعقدة أخرى' });
      throw e;
    }
    return { ok: true, key: n.key };
  });

  app.put('/api/admin/infra/node/:key', guard, async (req, reply) => {
    const key = req.params.key;
    if (!validKey(key)) return reply.code(400).send({ error: MSG.badRequest });
    const v = validateNode(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const cur = await loadNode(key);
    if (!cur) return reply.code(404).send({ error: MSG_INFRA.noNode });
    const n = v.value;
    if (n.parent_key !== undefined && n.parent_key !== null) {
      if (n.parent_key === key) return reply.code(400).send({ error: 'العقدة لا يمكن أن تكون أبًا لنفسها' });
      const all = (await db.query('SELECT key, parent_key FROM infra_nodes')).rows;
      const parents = new Map(all.map((r) => [r.key, r.parent_key]));
      if (!parents.has(n.parent_key)) return reply.code(400).send({ error: 'العقدة الأب غير موجودة' });
      for (let p = n.parent_key; p; p = parents.get(p)) if (p === key) return reply.code(400).send({ error: 'لا يمكن نقل العقدة تحت أحد فروعها' });
    }
    if (n.status !== undefined && (n.status_source ?? cur.status_source) !== 'manual') delete n.status; // only manual nodes take a hand-set status
    const cols = EDIT_COLS.filter((c) => n[c] !== undefined);
    if (!cols.length) return reply.code(400).send({ error: MSG.badRequest });
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const vals = cols.map((c) => (c === 'urls' ? JSON.stringify(n[c]) : n[c]));
    await tx(db, async (c) => {
      await c.query(`UPDATE infra_nodes SET ${sets}, updated_at = now() WHERE key = $1`, [key, ...vals]);
      const changed = Object.fromEntries(cols.filter((k) => String(cur[k] ?? '') !== String(n[k] ?? '') && k !== 'urls' && k !== 'notes').map((k) => [k, n[k]]));
      await log(req, 'infra.node.update', key, { fields: cols, changed });
    });
    return { ok: true };
  });

  // ---- links ----
  app.post('/api/admin/infra/links', guard, async (req, reply) => {
    const v = validateLink(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const l = v.value;
    const { rows } = await db.query('SELECT key FROM infra_nodes WHERE key = ANY($1::text[])', [[l.from_key, l.to_key]]);
    if (rows.length !== 2) return reply.code(404).send({ error: MSG_INFRA.noNode });
    const { rows: [r] } = await db.query(
      `INSERT INTO infra_links (from_key, to_key, kind, label_ar) VALUES ($1, $2, $3, $4)
       ON CONFLICT (from_key, to_key, kind) DO UPDATE SET label_ar = EXCLUDED.label_ar RETURNING id`, [l.from_key, l.to_key, l.kind, l.label_ar]);
    await log(req, 'infra.link.create', `${l.from_key}->${l.to_key}`, { kind: l.kind, id: r.id });
    return { ok: true, id: r.id };
  });
  app.put('/api/admin/infra/links/:id', guard, async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const v = validateLink(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const l = v.value;
    const { rows } = await db.query('SELECT key FROM infra_nodes WHERE key = ANY($1::text[])', [[l.from_key, l.to_key]]);
    if (rows.length !== 2) return reply.code(404).send({ error: MSG_INFRA.noNode });
    try {
      const r = await db.query('UPDATE infra_links SET from_key = $2, to_key = $3, kind = $4, label_ar = $5 WHERE id = $1', [Number(req.params.id), l.from_key, l.to_key, l.kind, l.label_ar]);
      if (!r.rowCount) return reply.code(404).send({ error: 'الوصلة غير موجودة' });
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'توجد وصلة مطابقة بالفعل' });
      throw e;
    }
    await log(req, 'infra.link.update', req.params.id, l);
    return { ok: true };
  });
  app.delete('/api/admin/infra/links/:id', guard, async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const r = await db.query('DELETE FROM infra_links WHERE id = $1 RETURNING from_key, to_key, kind', [Number(req.params.id)]);
    if (!r.rowCount) return reply.code(404).send({ error: 'الوصلة غير موجودة' });
    await log(req, 'infra.link.delete', req.params.id, r.rows[0]);
    return { ok: true };
  });

  // ---- services (Details composition) ----
  app.post('/api/admin/infra/services', guard, async (req, reply) => {
    const v = validateService(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const s = v.value;
    if (!(await loadNode(s.node_key))) return reply.code(404).send({ error: MSG_INFRA.noNode });
    if (s.system_key && !(await db.query('SELECT 1 FROM systems WHERE key = $1', [s.system_key])).rowCount) return reply.code(400).send({ error: 'النظام غير مسجل في البوابة' });
    try {
      const { rows: [r] } = await db.query(
        `INSERT INTO infra_services (node_key, name_ar, system_key, port, unit_name, url, notes, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [s.node_key, s.name_ar, s.system_key, s.port, s.unit_name, s.url, s.notes, s.sort]);
      await log(req, 'infra.service.create', s.node_key, { id: r.id, name_ar: s.name_ar, port: s.port });
      return { ok: true, id: r.id };
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'توجد خدمة بهذا الاسم على العقدة نفسها' });
      throw e;
    }
  });
  app.put('/api/admin/infra/services/:id', guard, async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const v = validateService(req.body);
    if (v.error) return reply.code(400).send({ error: v.error });
    const s = v.value;
    if (!(await loadNode(s.node_key))) return reply.code(404).send({ error: MSG_INFRA.noNode });
    if (s.system_key && !(await db.query('SELECT 1 FROM systems WHERE key = $1', [s.system_key])).rowCount) return reply.code(400).send({ error: 'النظام غير مسجل في البوابة' });
    try {
      const r = await db.query(
        `UPDATE infra_services SET node_key = $2, name_ar = $3, system_key = $4, port = $5, unit_name = $6, url = $7, notes = $8, sort = $9 WHERE id = $1`,
        [Number(req.params.id), s.node_key, s.name_ar, s.system_key, s.port, s.unit_name, s.url, s.notes, s.sort]);
      if (!r.rowCount) return reply.code(404).send({ error: 'الخدمة غير موجودة' });
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ error: 'توجد خدمة بهذا الاسم على العقدة نفسها' });
      throw e;
    }
    await log(req, 'infra.service.update', req.params.id, { node_key: s.node_key, name_ar: s.name_ar, port: s.port });
    return { ok: true };
  });
  app.delete('/api/admin/infra/services/:id', guard, async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const r = await db.query('DELETE FROM infra_services WHERE id = $1 RETURNING node_key, name_ar', [Number(req.params.id)]);
    if (!r.rowCount) return reply.code(404).send({ error: 'الخدمة غير موجودة' });
    await log(req, 'infra.service.delete', req.params.id, r.rows[0]);
    return { ok: true };
  });

  // ================= secrets (encrypted, OTP-guarded) =================
  const needKey = (reply) => (secretsKey ? null : reply.code(503).send({ error: MSG_INFRA.noKey }));

  // Verify + consume one fresh code of this admin (3 attempts per code). Returns { ok, reason }.
  async function consumeCode(req, code) {
    const { rows: [row] } = await db.query(
      `UPDATE otp_codes o SET attempts = o.attempts + 1
        WHERE o.id = (SELECT id FROM otp_codes WHERE employee_id = $1 AND purpose = $2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1)
          AND o.attempts < $3
        RETURNING o.*`, [req.user.employee_id, PURPOSE, OTP_MAX_ATTEMPTS]);
    const res = checkOtp(row && { ...row, attempts: row.attempts - 1 }, code, { pepper: cfg.otpPepper });
    if (!res.ok) {
      if (row && res.cancel) await db.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
      return { ok: false, reason: res.reason };
    }
    const used = await db.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [row.id]);
    return used.rowCount ? { ok: true, reason: 'ok' } : { ok: false, reason: 'consumed' };
  }
  // Common gate for every secret operation: valid code or 403 + audit
  async function gate(req, reply, action, target) {
    const code = String(req.body?.code ?? '');
    if (!/^\d{4}$/.test(code)) {
      await log(req, `${action}_denied`, target, { reason: 'no_code' });
      return reply.code(403).send({ error: MSG_INFRA.codeNeeded });
    }
    const r = await consumeCode(req, code);
    if (!r.ok) {
      await log(req, `${action}_denied`, target, { reason: r.reason });
      return reply.code(403).send({ error: MSG.code });
    }
    return null;
  }

  app.post('/api/admin/infra/secrets/otp', { ...guard, config: { rateLimit: { max: 8, timeWindow: 600_000 } } }, async (req, reply) => {
    if (needKey(reply)) return;
    if (!req.user.email) return reply.code(400).send({ error: MSG.noEmail });
    const { rows: [c] } = await db.query('SELECT max(created_at) AS last FROM otp_codes WHERE employee_id = $1 AND purpose = $2', [req.user.employee_id, PURPOSE]);
    if (c.last && Date.now() - new Date(c.last) < RESEND_MS) return reply.code(429).send({ error: MSG.tooSoon });
    const code = generateCode();
    await db.query('UPDATE otp_codes SET consumed_at = now() WHERE employee_id = $1 AND purpose = $2 AND consumed_at IS NULL', [req.user.employee_id, PURPOSE]);
    await db.query(
      `INSERT INTO otp_codes (employee_id, channel, code_hash, expires_at, ip, purpose) VALUES ($1, 'email', $2, now() + make_interval(secs => $3), $4, $5)`,
      [req.user.employee_id, hashCode(code, cfg.otpPepper, req.user.employee_id), OTP_TTL_MS / 1000, req.ip, PURPOSE]);
    try {
      await sendMail(await settings.smtp(), req.user.email, renderInfraOtpEmail({ name: req.user.full_name, code }));
    } catch (err) {
      req.log.error({ err: err.message }, 'infra otp mail failed');
      await log(req, 'infra.secret.otp', req.user.email, { ok: false });
      return reply.code(503).send({ error: MSG.mail });
    }
    await log(req, 'infra.secret.otp', req.user.email, { ok: true });
    return { ok: true, email_masked: maskEmail(req.user.email), valid_s: OTP_TTL_MS / 1000, resend_after: RESEND_MS / 1000 };
  });

  app.post('/api/admin/infra/secrets/:id/reveal', { ...guard, config: { rateLimit: { max: 30, timeWindow: 600_000 } } }, async (req, reply) => {
    if (needKey(reply)) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const { rows: [s] } = await db.query('SELECT id, node_key, label_ar, username, secret_enc, iv FROM infra_secrets WHERE id = $1', [req.params.id]);
    if (!s) return reply.code(404).send({ error: MSG_INFRA.noSecret });
    if (await gate(req, reply, 'infra.secret.reveal', `${s.node_key}:${s.id}`)) return;
    let secret;
    try { secret = open({ iv: s.iv, enc: s.secret_enc }, secretsKey, AAD); }
    catch { req.log.error({ secret: s.id }, 'infra secret decrypt failed (key changed?)'); return reply.code(500).send({ error: 'تعذر فك تشفير السر؛ ربما تغيّر SECRETS_KEY' }); }
    await db.query('INSERT INTO infra_secret_reveals (secret_id, employee_id, ip) VALUES ($1, $2, $3)', [s.id, req.user.employee_id, req.ip]);
    await log(req, 'infra.secret.reveal', `${s.node_key}:${s.id}`, { label_ar: s.label_ar });
    return { ok: true, id: s.id, label_ar: s.label_ar, username: s.username, secret, show_s: 60 };
  });

  app.post('/api/admin/infra/secrets', guard, async (req, reply) => {
    if (needKey(reply)) return;
    const b = req.body || {};
    const node_key = String(b.node_key ?? '').trim().toLowerCase();
    const label_ar = String(b.label_ar ?? '').trim().slice(0, 120);
    const username = String(b.username ?? '').trim().slice(0, 200) || null;
    const secret = typeof b.secret === 'string' ? b.secret : '';
    if (!validKey(node_key) || !label_ar) return reply.code(400).send({ error: 'اسم السر والعقدة مطلوبان' });
    if (!secret || secret.length > MAX_SECRET_CHARS) return reply.code(400).send({ error: MSG_INFRA.secretNeeded });
    if (!(await loadNode(node_key))) return reply.code(404).send({ error: MSG_INFRA.noNode });
    if (await gate(req, reply, 'infra.secret.create', node_key)) return;
    const box = seal(secret, secretsKey, AAD);
    const { rows: [r] } = await db.query(
      `INSERT INTO infra_secrets (node_key, label_ar, username, secret_enc, iv, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
      [node_key, label_ar, username, box.enc, box.iv, req.user.employee_id]);
    await log(req, 'infra.secret.create', `${node_key}:${r.id}`, { label_ar, has_username: !!username });
    return { ok: true, id: r.id };
  });

  app.put('/api/admin/infra/secrets/:id', guard, async (req, reply) => {
    if (needKey(reply)) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const b = req.body || {};
    const { rows: [s] } = await db.query('SELECT id, node_key, label_ar, username FROM infra_secrets WHERE id = $1', [req.params.id]);
    if (!s) return reply.code(404).send({ error: MSG_INFRA.noSecret });
    const label_ar = b.label_ar === undefined ? s.label_ar : String(b.label_ar).trim().slice(0, 120);
    const username = b.username === undefined ? s.username : (String(b.username).trim().slice(0, 200) || null);
    const secret = b.secret === undefined || b.secret === '' ? null : (typeof b.secret === 'string' ? b.secret : '');
    if (!label_ar) return reply.code(400).send({ error: 'اسم السر مطلوب' });
    if (secret !== null && (!secret || secret.length > MAX_SECRET_CHARS)) return reply.code(400).send({ error: MSG_INFRA.secretNeeded });
    if (await gate(req, reply, 'infra.secret.update', `${s.node_key}:${s.id}`)) return;
    if (secret !== null) {
      const box = seal(secret, secretsKey, AAD);
      await db.query('UPDATE infra_secrets SET label_ar = $2, username = $3, secret_enc = $4, iv = $5, updated_by = $6, updated_at = now() WHERE id = $1',
        [s.id, label_ar, username, box.enc, box.iv, req.user.employee_id]);
    } else {
      await db.query('UPDATE infra_secrets SET label_ar = $2, username = $3, updated_by = $4, updated_at = now() WHERE id = $1', [s.id, label_ar, username, req.user.employee_id]);
    }
    await log(req, 'infra.secret.update', `${s.node_key}:${s.id}`, { label_ar, secret_changed: secret !== null });
    return { ok: true };
  });

  app.delete('/api/admin/infra/secrets/:id', guard, async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: MSG.badRequest });
    const { rows: [s] } = await db.query('SELECT id, node_key, label_ar FROM infra_secrets WHERE id = $1', [req.params.id]);
    if (!s) return reply.code(404).send({ error: MSG_INFRA.noSecret });
    if (await gate(req, reply, 'infra.secret.delete', `${s.node_key}:${s.id}`)) return;
    await db.query('DELETE FROM infra_secrets WHERE id = $1', [s.id]);
    await log(req, 'infra.secret.delete', `${s.node_key}:${s.id}`, { label_ar: s.label_ar });
    return { ok: true };
  });
}
