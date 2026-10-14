// Login: employee number + email OTP, Google, logout
import { randomBytes } from 'node:crypto';
import { MSG } from './helpers.js';
import { maskEmail, maskMobile } from '../lib/mask.js';
import { generateCode, hashCode, checkOtp, otpRequestDecision, OTP_TTL_MS, OTP_MAX_ATTEMPTS, LIMITS } from '../lib/otp.js';
import { COOKIE_NAME, cookieOptions, createSession, readSessionId, revokeSession, signValue, unsignValue, employeeUsable } from '../lib/session.js';
import { safeNext } from '../lib/authz.js';
import { recordAttempt, audit } from '../lib/audit.js';
import { sendMail, renderOtpEmail } from '../lib/mail.js';
import { smsEnabled } from '../lib/sms-provider.js';
import { decideChannel, sendWhatsappOtp, whatsappOtpConfig, last4 } from '../lib/whatsapp-otp.js';
import { googleConfigured, startGoogle, finishGoogle } from '../lib/google.js';
import { safeEqual } from '../lib/crypto.js';

const NO_RE = /^\d{4}$/;
// حظر الغرباء وحدود OTP ومدة الجلسة من «إعدادات النظام ← الجلسات والأمان» (افتراضيًا: محاولتان ثم حظر 30 دقيقة)
const limit = (max, minutes) => ({ rateLimit: { max, timeWindow: minutes * 60 * 1000 } });

export default async function loginRoutes(app) {
  const { db, cfg, settings } = app;
  const security = () => settings.get('security');

  async function findEmployee(no) {
    if (!NO_RE.test(String(no ?? ''))) return null;
    const { rows } = await db.query('SELECT * FROM employees WHERE employee_no = $1', [no]);
    return employeeUsable(rows[0]) ? rows[0] : null;
  }

  async function startSession(req, reply, emp, method) {
    const sec = await security();
    const id = await createSession(db, emp.id, req.ip, req.headers['user-agent'], sec.session_hours * 3_600_000);
    reply.setCookie(COOKIE_NAME, signValue(id, cfg.sessionSecret), cookieOptions(cfg, sec.session_hours * 3600));
    await recordAttempt(db, { identifier: emp.employee_no, ip: req.ip, ok: true, reason: `${method}_ok`, employeeId: emp.id });
  }

  app.get('/api/login/options', async () => ({ google: googleConfigured(cfg.google), sms: smsEnabled() }));

  // Route limits are per IP; the office shares one public IP, so keep them generous (abuse is caught by LIMITS/locks)
  app.post('/api/login/lookup', { config: limit(60, 5) }, async (req, reply) => {
    const no = String(req.body?.employee_no ?? '');
    const emp = await findEmployee(no);
    await recordAttempt(db, { identifier: no, ip: req.ip, ok: !!emp, reason: emp ? 'lookup_ok' : 'lookup_fail', employeeId: emp?.id });
    if (!emp) return reply.code(400).send({ error: MSG.login });
    const ch = decideChannel({ pref: (await security()).otp_channel, mobile: emp.mobile, email: emp.email });
    if (!ch.email && !ch.whatsapp) return reply.code(400).send({ error: emp.email ? MSG.noEmail : MSG.noChannel });
    return {
      name: emp.full_name,
      mobile_masked: maskMobile(emp.mobile),
      email_masked: maskEmail(emp.email),
      channels: [...(ch.email ? ['email'] : []), ...(ch.whatsapp ? ['whatsapp'] : []), ...(smsEnabled() && emp.mobile ? ['sms'] : [])],
      // where the code will go when «أرسل رمز التحقق» is pressed
      otp_channel: ch.whatsapp ? (ch.email ? 'both' : 'whatsapp') : 'email',
      mobile_last4: ch.whatsapp ? last4(ch.mobile) : null,
      email_fallback: ch.whatsapp && !ch.email && Boolean(emp.email),
    };
  });

  const WA_CFG = () => whatsappOtpConfig(process.env, cfg.proxyKey);
  const SWITCH_WINDOW_MIN = 15;

  /**
   * إرسال رمز التحقق. body: { employee_no, channel?: 'email' }
   * القناة من «الجلسات والأمان» (security.otp_channel): email | whatsapp | both. واتساب يعود للبريد تلقائيًا عند الفشل.
   * channel:'email' = طلب الموظف البريد بدلًا من واتساب — مسموح مرة واحدة لكل دخول (يتجاوز مهلة الدقيقة مرة واحدة خلال 15 دقيقة).
   */
  app.post('/api/login/otp', { config: limit(40, 10) }, async (req, reply) => {
    const no = String(req.body?.employee_no ?? '');
    const force = req.body?.channel === 'email' ? 'email' : null;
    const emp = await findEmployee(no);
    const { rows: [c] } = await db.query(
      `SELECT
        (SELECT count(*)::int FROM login_attempts WHERE identifier = $1 AND reason IN ('otp_sent','otp_whatsapp') AND created_at > now() - interval '1 hour') AS employee_hour,
        (SELECT count(*)::int FROM login_attempts WHERE ip = $2 AND reason IN ('otp_sent','otp_whatsapp','otp_unknown') AND created_at > now() - interval '1 hour') AS ip_hour,
        (SELECT count(*)::int FROM login_attempts WHERE identifier = $1 AND reason = 'bad_code' AND created_at > now() - make_interval(mins => $4)) AS bad,
        (SELECT max(created_at) FROM otp_codes WHERE employee_id = $3 AND purpose = 'login') AS last_sent,
        (SELECT count(*)::int FROM login_attempts WHERE identifier = $1 AND reason = 'otp_switch_email' AND created_at > now() - make_interval(mins => $5)) AS switched`,
      [no.slice(0, 20), req.ip, emp?.id ?? null, LIMITS.lockMinutes, SWITCH_WINDOW_MIN]);
    const d = otpRequestDecision({ employeeHour: c.employee_hour, ipHour: c.ip_hour, badCodes30m: c.bad, lastSentAt: c.last_sent });
    const switching = Boolean(force && emp && c.switched === 0);
    if (!d.ok && !(d.reason === 'too_soon' && switching)) {
      await recordAttempt(db, { identifier: no, ip: req.ip, ok: false, reason: `otp_denied_${d.reason}`, employeeId: emp?.id });
      return reply.code(429).send({ error: d.reason === 'too_soon' && emp ? MSG.tooSoon : MSG.limit });
    }
    if (!emp) {
      await recordAttempt(db, { identifier: no, ip: req.ip, ok: false, reason: 'otp_unknown' });
      return reply.code(400).send({ error: MSG.login });
    }
    const sec = await security();
    const ch = decideChannel({ pref: sec.otp_channel, mobile: emp.mobile, email: emp.email, force });
    if (!ch.email && !ch.whatsapp) return reply.code(400).send({ error: emp.email ? MSG.noEmail : MSG.noChannel });
    const code = generateCode();
    const ttl = sec.otp_ttl_minutes || Math.round(OTP_TTL_MS / 60000);
    await db.query("UPDATE otp_codes SET consumed_at = now() WHERE employee_id = $1 AND purpose = 'login' AND consumed_at IS NULL", [emp.id]);
    const { rows: [otp] } = await db.query(
      `INSERT INTO otp_codes (employee_id, channel, code_hash, expires_at, ip, purpose)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5, 'login') RETURNING id`,
      [emp.id, ch.whatsapp ? 'whatsapp' : 'email', hashCode(code, cfg.otpPepper, emp.id), ttl * 60, req.ip]);
    if (switching) await recordAttempt(db, { identifier: no, ip: req.ip, ok: true, reason: 'otp_switch_email', employeeId: emp.id });

    const via = [];
    let sendEmail = ch.email;
    if (ch.whatsapp) {
      const r = await sendWhatsappOtp({ to: ch.mobile, code, ttlMinutes: ttl }, WA_CFG(), { log: req.log });
      if (r.ok) { via.push('whatsapp'); await recordAttempt(db, { identifier: no, ip: req.ip, ok: true, reason: 'otp_whatsapp', employeeId: emp.id }); }
      else {
        req.log.warn({ status: r.status, err: r.error }, 'otp whatsapp failed; falling back to e-mail');
        await recordAttempt(db, { identifier: no, ip: req.ip, ok: false, reason: 'otp_whatsapp_fail', employeeId: emp.id });
        if (emp.email) sendEmail = true; // automatic fallback
      }
    }
    if (sendEmail && emp.email) {
      try {
        await sendMail(await settings.smtp(), emp.email, renderOtpEmail({ name: emp.full_name, code, minutes: ttl }));
        via.push('email');
        await recordAttempt(db, { identifier: no, ip: req.ip, ok: true, reason: 'otp_sent', employeeId: emp.id });
      } catch (err) {
        req.log.error({ err: err.message }, 'otp mail failed');
        await recordAttempt(db, { identifier: no, ip: req.ip, ok: false, reason: 'otp_mail_fail', employeeId: emp.id });
      }
    }
    if (!via.length) {
      await db.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
      return reply.code(503).send({ error: MSG.mail });
    }
    if (!via.includes('whatsapp') && ch.whatsapp) await db.query("UPDATE otp_codes SET channel = 'email' WHERE id = $1", [otp.id]);
    const channel = via.length === 2 ? 'both' : via[0];
    return {
      ok: true, channel, resend_after: 60, ttl_minutes: ttl,
      email_masked: via.includes('email') ? maskEmail(emp.email) : null,
      mobile_last4: via.includes('whatsapp') ? last4(ch.mobile) : null,
      // «أرسل عبر البريد بدلًا» link: only when the code went to WhatsApp alone, e-mail exists and the one-time switch is unused
      email_fallback: channel === 'whatsapp' && Boolean(emp.email) && c.switched === 0 && !switching,
    };
  });

  app.post('/api/login/verify', { config: limit(60, 10) }, async (req, reply) => {
    const no = String(req.body?.employee_no ?? '');
    const code = String(req.body?.code ?? '');
    const emp = await findEmployee(no);
    if (!emp) {
      await recordAttempt(db, { identifier: no, ip: req.ip, ok: false, reason: 'verify_unknown' });
      return reply.code(400).send({ error: MSG.code });
    }
    const { rows: [lock] } = await db.query(
      `SELECT count(*)::int AS n FROM login_attempts WHERE identifier = $1 AND reason = 'bad_code'
         AND created_at > now() - make_interval(mins => $2)`, [no, LIMITS.lockMinutes]);
    if (lock.n >= LIMITS.badCodesForLock) {
      await recordAttempt(db, { identifier: no, ip: req.ip, ok: false, reason: 'verify_locked', employeeId: emp.id });
      return reply.code(429).send({ error: MSG.limit });
    }
    // Reserve one attempt atomically on the latest open code
    const maxAttempts = (await security()).otp_max_attempts || OTP_MAX_ATTEMPTS;
    const { rows: [row] } = await db.query(
      `UPDATE otp_codes o SET attempts = o.attempts + 1
        WHERE o.id = (SELECT id FROM otp_codes WHERE employee_id = $1 AND purpose = 'login' AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1)
          AND o.attempts < $2
        RETURNING o.*`, [emp.id, maxAttempts]);
    const res = checkOtp(row && { ...row, attempts: row.attempts - 1 }, code, { pepper: cfg.otpPepper, maxAttempts });
    if (!res.ok) {
      if (row && res.cancel) await db.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
      const reason = res.reason === 'mismatch' ? 'bad_code' : `otp_${res.reason}`;
      await recordAttempt(db, { identifier: no, ip: req.ip, ok: false, reason, employeeId: emp.id });
      return reply.code(400).send({ error: MSG.code });
    }
    const used = await db.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id', [row.id]);
    if (!used.rowCount) return reply.code(400).send({ error: MSG.code });
    await startSession(req, reply, emp, 'otp');
    return { ok: true, redirect: safeNext(req.body?.next, cfg.rootDomain) };
  });

  // ---- Google ----
  const OAUTH_COOKIE = 'dg_oauth';
  const oauthCookie = { path: '/', secure: true, httpOnly: true, sameSite: 'lax', maxAge: 600 };

  async function googleStart(req, reply) {
    if (!googleConfigured(cfg.google)) return reply.redirect('/login?e=google');
    const state = randomBytes(24).toString('base64url');
    const { url, codeVerifier } = await startGoogle(cfg.google, state);
    const data = Buffer.from(JSON.stringify({ s: state, v: codeVerifier, n: safeNext(req.query.next, cfg.rootDomain), t: Date.now() })).toString('base64url');
    reply.setCookie(OAUTH_COOKIE, signValue(data, cfg.sessionSecret), oauthCookie);
    return reply.redirect(url);
  }
  app.get('/auth/google/start', { config: limit(20, 5) }, googleStart);
  app.get('/api/auth/google/start', { config: limit(20, 5) }, googleStart);

  // Registered redirect URI: https://details-wms.cloud/api/auth/google/callback
  app.get('/api/auth/google/callback', { config: limit(20, 5) }, async (req, reply) => {
    const raw = unsignValue(req.cookies[OAUTH_COOKIE], cfg.sessionSecret);
    reply.clearCookie(OAUTH_COOKIE, { path: '/' });
    let st = null;
    try { st = raw && JSON.parse(Buffer.from(raw, 'base64url').toString()); } catch { st = null; }
    if (!st || Date.now() - st.t > 600_000 || !safeEqual(st.s, req.query.state) || !req.query.code) {
      await recordAttempt(db, { identifier: 'google', ip: req.ip, ok: false, reason: 'google_state' });
      return reply.redirect('/login?e=google');
    }
    let email = null;
    try { email = await finishGoogle(cfg.google, String(req.query.code), st.v); } catch (err) {
      req.log.warn({ err: err.message }, 'google exchange failed');
    }
    if (!email) {
      await recordAttempt(db, { identifier: 'google', ip: req.ip, ok: false, reason: 'google_fail' });
      return reply.redirect('/login?e=google');
    }
    // حظر الغرباء: حساب Google غير مسجّل حاول N مرات (بالبريد أو من نفس العنوان) خلال نافذة الحظر ⇒ يُحظر طوال النافذة
    const sec = await security();
    const TRIES = sec.google_stranger_tries;
    const { rows: [bl] } = await db.query(
      `SELECT count(*) FILTER (WHERE identifier = $1)::int AS by_email, count(*) FILTER (WHERE ip = $2)::int AS by_ip
         FROM login_attempts WHERE reason = 'google_unlinked' AND created_at > now() - make_interval(mins => $3)`, [email, req.ip, sec.google_block_minutes]);
    if (bl.by_email >= TRIES || bl.by_ip >= TRIES) {
      await recordAttempt(db, { identifier: email, ip: req.ip, ok: false, reason: 'google_blocked' });
      return reply.redirect('/denied?r=blocked');
    }
    const { rows } = await db.query(
      `SELECT * FROM employees WHERE lower(google_email) = $1 OR lower(email) = $1
        ORDER BY (lower(google_email) = $1) DESC NULLS LAST LIMIT 1`, [email]);
    const emp = employeeUsable(rows[0]) ? rows[0] : null;
    if (!emp) {
      await recordAttempt(db, { identifier: email, ip: req.ip, ok: false, reason: 'google_unlinked' });
      const nowBlocked = bl.by_email + 1 >= TRIES || bl.by_ip + 1 >= TRIES;
      return reply.redirect(nowBlocked ? '/denied?r=blocked' : '/denied?r=google');
    }
    await startSession(req, reply, emp, 'google');
    return reply.redirect(safeNext(st.n, cfg.rootDomain));
  });

  app.get('/logout', async (req, reply) => {
    const id = readSessionId(req.cookies[COOKIE_NAME], cfg.sessionSecret);
    if (id) {
      await revokeSession(db, id);
      await audit(db, { action: 'logout', target: id, ip: req.ip });
    }
    reply.clearCookie(COOKIE_NAME, { domain: cfg.cookieDomain, path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
    return reply.redirect('/login');
  });
}
