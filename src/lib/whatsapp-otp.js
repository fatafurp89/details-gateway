/**
 * رمز التحقق عبر واتساب: استدعاء الخدمة الداخلية لواتساب ديتيلز على خادم التطبيقات عبر نفق WireGuard
 *   POST http://10.9.0.3/internal/otp/send  (Host: whatsapp.details-wms.cloud, X-Gw-Proxy-Key: GATEWAY_PROXY_KEY)
 * الدوال النقية (تطبيع الجوال، قرار القناة) قابلة للاختبار بلا شبكة.
 */

export const OTP_CHANNELS = ['email', 'whatsapp', 'both'];
const TIMEOUT_MS = 8_000;

/** إعدادات الاتصال من البيئة (كلها اختيارية سوى مفتاح البوابة المشترك) */
export function whatsappOtpConfig(env = process.env, proxyKey = env.GATEWAY_PROXY_KEY || '') {
  return {
    url: (env.WHATSAPP_OTP_URL || 'http://10.9.0.3/internal/otp/send').trim(),
    host: (env.WHATSAPP_OTP_HOST || 'whatsapp.details-wms.cloud').trim(),
    proxyKey,
    timeoutMs: Number(env.WHATSAPP_OTP_TIMEOUT_MS) || TIMEOUT_MS,
  };
}

/**
 * تطبيع جوال سعودي إلى 9665xxxxxxxx (بلا +). يقبل 05…، 5…، +966…، 00966…، 966…، والأرقام العربية.
 * يعيد null لأي شيء آخر (الأرقام غير السعودية لا تُستعمل للدخول).
 */
export function normalizeSaudiMobile(input) {
  let d = String(input ?? '').trim().replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2);
  d = d.replace(/\D/g, '');
  if (/^05\d{8}$/.test(d)) return '966' + d.slice(1);
  if (/^5\d{8}$/.test(d)) return '966' + d;
  if (/^9660?5\d{8}$/.test(d)) return '9665' + d.slice(-8);
  return null;
}

/** 966556186732 → ****6732 (للعرض في صفحة الرمز) */
export const last4 = (e164) => { const s = String(e164 || '').replace(/\D/g, ''); return s.length >= 4 ? '****' + s.slice(-4) : ''; };

/**
 * قرار قناة الإرسال (نقي):
 *  pref: email | whatsapp | both (من security.otp_channel) ؛ mobile/email: بيانات الموظف ؛ force: 'email' عندما يطلب الموظف البريد بدلًا.
 * يعيد { whatsapp: bool, email: bool, mobile: '9665…'|null, reason } — كلاهما false يعني لا قناة متاحة.
 */
export function decideChannel({ pref = 'email', mobile, email, force = null } = {}) {
  const m = normalizeSaudiMobile(mobile);
  const hasEmail = Boolean(String(email || '').trim());
  const p = OTP_CHANNELS.includes(pref) ? pref : 'email';
  if (force === 'email') return { whatsapp: false, email: hasEmail, mobile: m, reason: hasEmail ? 'forced_email' : 'no_email' };
  if (p === 'email' || !m) return { whatsapp: false, email: hasEmail, mobile: m, reason: p === 'email' ? 'pref_email' : 'no_mobile' };
  if (p === 'both') return { whatsapp: true, email: hasEmail, mobile: m, reason: 'both' };
  return { whatsapp: true, email: false, mobile: m, reason: 'pref_whatsapp' };
}

/**
 * طلب JSON عبر node:http (وليس fetch: undici يتجاهل ترويسة Host المخصصة، ونحن نصل بعنوان النفق مع Host اسم الموقع).
 * يعيد { status, json, text } ولا يرمي إلا عند خطأ الشبكة/المهلة.
 */
export function httpJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = TIMEOUT_MS, request = null } = {}) {
  return new Promise(async (resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? await import('node:https') : await import('node:http');
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const req = (request || mod.request)({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method,
      headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), Accept: 'application/json', ...headers },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { json = null; } resolve({ status: res.statusCode, json, text }); });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error(`timeout ${timeoutMs}ms`), { name: 'TimeoutError' })));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * الإرسال الفعلي. يعيد { ok, message_id } أو { ok:false, error, status } — لا يرمي استثناءً أبدًا ولا يسجّل الرمز.
 * dryRun=true يطلب من الخدمة التحقق وبناء الحمولة دون إرسال.
 */
export async function sendWhatsappOtp({ to, code, ttlMinutes = 5, dryRun = false }, cfg = whatsappOtpConfig(), { request = null, log = null } = {}) {
  if (!cfg.proxyKey) return { ok: false, error: 'GATEWAY_PROXY_KEY missing', status: 0 };
  try {
    const { status, json: j, text } = await httpJson(cfg.url, { method: 'POST', timeoutMs: cfg.timeoutMs, request,
      headers: { Host: cfg.host, 'X-Gw-Proxy-Key': cfg.proxyKey }, body: { to, code, ttl_minutes: ttlMinutes, dry_run: dryRun } });
    if (status < 200 || status >= 300 || !j || j.ok !== true) {
      const error = String(j?.error || text || `http ${status}`).slice(0, 160);
      if (log) log.warn({ status, error }, 'whatsapp otp send failed');
      return { ok: false, error, status };
    }
    return { ok: true, message_id: j.message_id || null, dry_run: dryRun ? j : undefined };
  } catch (e) {
    const error = String(e.message).slice(0, 160);
    if (log) log.warn({ error }, 'whatsapp otp send error');
    return { ok: false, error, status: 0 };
  }
}

/** حالة قالب رمز التحقق لدى خدمة واتساب (للإعدادات) */
export async function whatsappOtpStatus(cfg = whatsappOtpConfig(), { request = null } = {}) {
  if (!cfg.proxyKey) return { ok: false, error: 'GATEWAY_PROXY_KEY missing' };
  try {
    const { status, json } = await httpJson(cfg.url.replace(/\/send$/, '/status'), { timeoutMs: cfg.timeoutMs, request, headers: { Host: cfg.host, 'X-Gw-Proxy-Key': cfg.proxyKey } });
    if (status !== 200 || !json) return { ok: false, error: `http ${status}` };
    return json;
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 120) }; }
}
