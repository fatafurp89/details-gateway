// «إعدادات النظام» (pure): sections registry, defaults, env fallback, validators, IP block list matcher
const str = (v, max) => (v === undefined || v === null ? '' : String(v).trim()).slice(0, max);
const int = (v, def, min, max) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || v === '' || v === null || v === undefined) return def;
  return Math.min(max, Math.max(min, n));
};
const COLOR_RE = /^#[0-9a-f]{6}$/i;
export const OTP_CHANNELS = ['email', 'whatsapp', 'both'];
const HOST_RE = /^[a-z0-9.-]{3,253}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Sections of the settings platform. `adminOnly` sections never open for a delegated employee even when the
 * tree node is granted (sensitive). `href` = external page for link cards; otherwise the section lives in /settings#key.
 */
export const SECTIONS = [
  { key: 'systems',       label: 'الأنظمة والبطاقات',       icon: '🗂', desc: 'الاسم، الرابط، المضيف المحلي، الموضع، الترتيب، الحالة، المنح.', adminOnly: false },
  { key: 'branding',      label: 'الهوية والعلامة',         icon: '🎨', desc: 'شعار البوابة واسمها وألوانها.', adminOnly: false },
  { key: 'security',      label: 'الجلسات والأمان',         icon: '🛡', desc: 'مدة الجلسة، رموز التحقق، حظر الغرباء، العناوين المحظورة.', adminOnly: true },
  { key: 'smtp',          label: 'البريد الخارج (SMTP)',    icon: '✉', desc: 'خادم البريد والمستخدم وكلمة المرور المشفّرة ورسالة اختبار.', adminOnly: true },
  { key: 'notifications', label: 'الإشعارات',               icon: '🔔', desc: 'الافتراضيات حسب الأهمية وتحويل الإشعارات إلى البريد.', adminOnly: false },
  { key: 'infra',         label: 'المعلومات التقنية',       icon: '🖧', desc: 'الأجهزة وخريطة المنظومة وتكوين ديتيلز.', href: '/infra', adminOnly: true },
  { key: 'links',         label: 'الروابط السريعة',         icon: '🔗', desc: 'إدارة روابط المنصات والجهات.', href: '/links', adminOnly: false },
  { key: 'perms',         label: 'مركز الصلاحيات',          icon: '🔐', desc: 'شجرة الصلاحيات ومصفوفة الأنظمة.', href: '/admin#perms', adminOnly: true },
  { key: 'backup',        label: 'النسخ الاحتياطي',         icon: '🗄', desc: 'آخر نسخة من القاعدة وتشغيل نسخة الآن (احتفاظ بـ14).', adminOnly: true },
  { key: 'ai_keys',       label: 'مفاتيح الذكاء الاصطناعي', icon: '🤖', desc: 'خزنة مفاتيح DeepSeek وOpenAI وغيرها، مشفّرة، مع فحص الاتصال.', adminOnly: true },
  { key: 'ai_monitoring', label: 'مراقبة أداء الذكاء الاصطناعي للمفاتيح', icon: '📊', desc: 'سجلات استخدام مفصلة مع فلاتر وإحصائيات واتجاهات الأداء.', adminOnly: true },
];
export const SECTION_KEYS = SECTIONS.map((s) => s.key);
export const permKeyOf = (section) => `settings.${section}`;

/** Sections an employee may open: absolute admin → all; otherwise only non-sensitive sections whose tree node is granted. */
export function allowedSections(role, grantedPermKeys = []) {
  if (role === 'admin') return SECTIONS.map((s) => s.key);
  const g = new Set(grantedPermKeys);
  return SECTIONS.filter((s) => !s.adminOnly && g.has(permKeyOf(s.key))).map((s) => s.key);
}

// ---- defaults + env fallback ----
export const DEFAULTS = {
  branding: {
    name: 'بوابة الدخول الموحد لديتيلز', sub: 'شركة ديتيلز للاستشارات الهندسية · أنظمة العمل الداخلية',
    logo_url: '/static/assets/logo-details.png', color_primary: '#0f8a6b', color_navy: '#1e3a5f', color_gold: '#bc9d59',
  },
  security: {
    session_hours: 12, idle_minutes: 30, otp_ttl_minutes: 10, otp_max_attempts: 3,
    // قناة رمز التحقق: email | whatsapp (جوال الموظف عبر واتساب ديتيلز، ويعود للبريد تلقائيًا عند الفشل) | both (الاثنان معًا)
    otp_channel: 'email',
    google_stranger_tries: 2, google_block_minutes: 30, ip_blocklist: [],
  },
  smtp: { host: 'smtp.hostinger.com', port: 465, user: '', from_name: 'ديتيلز للاستشارات الهندسية' },
  notifications: {
    email_relay: false,
    severity: { info: { email: false }, warn: { email: false }, urgent: { email: true } },
  },
};

/** Defaults overridden by env (when the env var exists), then by the stored row. */
export function effective(section, stored, env = {}) {
  const d = DEFAULTS[section];
  if (!d) return stored || {};
  const fromEnv = {};
  if (section === 'security') {
    if (env.SESSION_HOURS) fromEnv.session_hours = int(env.SESSION_HOURS, d.session_hours, 1, 168);
    if (env.SESSION_IDLE_MINUTES) fromEnv.idle_minutes = int(env.SESSION_IDLE_MINUTES, d.idle_minutes, 5, 1440);
    if (env.OTP_TTL_MINUTES) fromEnv.otp_ttl_minutes = int(env.OTP_TTL_MINUTES, d.otp_ttl_minutes, 1, 30);
    if (env.OTP_MAX_ATTEMPTS) fromEnv.otp_max_attempts = int(env.OTP_MAX_ATTEMPTS, d.otp_max_attempts, 1, 10);
    if (OTP_CHANNELS.includes(env.OTP_CHANNEL)) fromEnv.otp_channel = env.OTP_CHANNEL;
    if (env.GOOGLE_STRANGER_TRIES) fromEnv.google_stranger_tries = int(env.GOOGLE_STRANGER_TRIES, d.google_stranger_tries, 1, 20);
    if (env.GOOGLE_BLOCK_MINUTES) fromEnv.google_block_minutes = int(env.GOOGLE_BLOCK_MINUTES, d.google_block_minutes, 1, 1440);
    if (env.IP_BLOCKLIST) fromEnv.ip_blocklist = String(env.IP_BLOCKLIST).split(/[\s,]+/).filter(Boolean);
  } else if (section === 'smtp') {
    if (env.SMTP_HOST) fromEnv.host = env.SMTP_HOST;
    if (env.SMTP_PORT) fromEnv.port = int(env.SMTP_PORT, d.port, 1, 65535);
    if (env.SMTP_USER) fromEnv.user = env.SMTP_USER;
    if (env.SMTP_FROM_NAME) fromEnv.from_name = env.SMTP_FROM_NAME;
  } else if (section === 'branding') {
    if (env.PORTAL_NAME) fromEnv.name = env.PORTAL_NAME;
  }
  const s = stored && typeof stored === 'object' ? stored : {};
  const out = { ...d, ...fromEnv };
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  if (section === 'notifications') out.severity = { ...d.severity, ...(s.severity || {}) };
  return out;
}

// ---- validators: { value } or { error } (Arabic) ----
export function validateBranding(b) {
  if (!b || typeof b !== 'object') return { error: 'الطلب غير صالح' };
  const v = {
    name: str(b.name, 120), sub: str(b.sub, 200), logo_url: str(b.logo_url, 2000),
    color_primary: str(b.color_primary, 7).toLowerCase(), color_navy: str(b.color_navy, 7).toLowerCase(), color_gold: str(b.color_gold, 7).toLowerCase(),
  };
  if (v.name.length < 2) return { error: 'اسم البوابة مطلوب' };
  if (v.logo_url && !/^(\/(?![\/\\])|https:\/\/)/.test(v.logo_url)) return { error: 'رابط الشعار يجب أن يكون مسارًا داخليًا أو https' };
  for (const k of ['color_primary', 'color_navy', 'color_gold']) {
    if (!v[k]) v[k] = DEFAULTS.branding[k];
    if (!COLOR_RE.test(v[k])) return { error: 'اللون يجب أن يكون بصيغة #rrggbb' };
  }
  return { value: v };
}

export function validateSecurity(b) {
  if (!b || typeof b !== 'object') return { error: 'الطلب غير صالح' };
  const d = DEFAULTS.security;
  const v = {
    session_hours: int(b.session_hours, d.session_hours, 1, 168),
    idle_minutes: int(b.idle_minutes, d.idle_minutes, 5, 1440),
    otp_ttl_minutes: int(b.otp_ttl_minutes, d.otp_ttl_minutes, 1, 30),
    otp_max_attempts: int(b.otp_max_attempts, d.otp_max_attempts, 1, 10),
    otp_channel: OTP_CHANNELS.includes(b.otp_channel) ? b.otp_channel : d.otp_channel,
    google_stranger_tries: int(b.google_stranger_tries, d.google_stranger_tries, 1, 20),
    google_block_minutes: int(b.google_block_minutes, d.google_block_minutes, 1, 1440),
    ip_blocklist: [],
  };
  const raw = Array.isArray(b.ip_blocklist) ? b.ip_blocklist : String(b.ip_blocklist ?? '').split(/[\s,]+/);
  const list = [...new Set(raw.map((x) => str(x, 50)).filter(Boolean))];
  if (list.length > 500) return { error: 'قائمة الحظر طويلة جدًا (الحد 500)' };
  for (const ip of list) if (!parseCidr(ip)) return { error: `العنوان «${ip}» غير صالح (IPv4 أو IPv4/CIDR)` };
  if (list.includes('127.0.0.1') || list.includes('127.0.0.1/32')) return { error: 'لا يمكن حظر 127.0.0.1' };
  v.ip_blocklist = list;
  return { value: v };
}

/** SMTP settings without the password; `password` is handled by the route (sealed separately). */
export function validateSmtp(b) {
  if (!b || typeof b !== 'object') return { error: 'الطلب غير صالح' };
  const v = { host: str(b.host, 253).toLowerCase(), port: int(b.port, 465, 1, 65535), user: str(b.user, 200), from_name: str(b.from_name, 120) || DEFAULTS.smtp.from_name };
  if (!HOST_RE.test(v.host)) return { error: 'اسم خادم البريد غير صالح' };
  if (v.user && !EMAIL_RE.test(v.user)) return { error: 'مستخدم SMTP يجب أن يكون بريدًا إلكترونيًا' };
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length > 500) return { error: 'كلمة المرور طويلة جدًا' };
  if (/\s/.test(password)) return { error: 'كلمة المرور لا تحتوي مسافات' };
  return { value: v, password: password || null };
}

export function validateNotifications(b) {
  if (!b || typeof b !== 'object') return { error: 'الطلب غير صالح' };
  const v = { email_relay: b.email_relay === true, severity: {} };
  for (const s of ['info', 'warn', 'urgent']) {
    const x = b.severity && typeof b.severity === 'object' ? b.severity[s] : null;
    v.severity[s] = { email: !!(x && x.email === true) };
  }
  return { value: v };
}

// ---- IP block list (IPv4 exact or CIDR; IPv6 only exact) ----
export function parseCidr(s) {
  const t = String(s ?? '').trim();
  const m = t.match(/^(.+?)(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const ip = ipv4ToInt(m[1]);
  if (ip === null) return t.includes(':') && /^[0-9a-f:]{2,39}$/i.test(t) ? { v6: t.toLowerCase() } : null;
  const bits = m[2] === undefined ? 32 : Number(m[2]);
  if (bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { net: (ip & mask) >>> 0, mask };
}
export function ipv4ToInt(s) {
  const m = IPV4_RE.exec(String(s ?? '').trim());
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
/** true when `ip` (string) is covered by any entry of the list (strings). Never blocks loopback. */
export function ipBlocked(ip, list) {
  if (!Array.isArray(list) || !list.length) return false;
  const raw = String(ip ?? '').trim().toLowerCase().replace(/^::ffff:/, '');
  if (raw === '127.0.0.1' || raw === '::1') return false;
  const n = ipv4ToInt(raw);
  for (const e of list) {
    const c = parseCidr(e);
    if (!c) continue;
    if (c.v6) { if (c.v6 === raw) return true; continue; }
    if (n !== null && ((n & c.mask) >>> 0) === c.net) return true;
  }
  return false;
}

/** Latest backup file info from a directory listing: [{name, size, mtime}] → the newest or null. */
export function latestBackup(files) {
  const ok = (files || []).filter((f) => /^details_gateway[-_].*\.(dump|sql|sql\.gz)$/.test(f.name));
  ok.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  return ok[0] || null;
}
/** Names to delete so only `keep` newest backups remain. */
export function pruneList(files, keep = 14) {
  const ok = (files || []).filter((f) => /^details_gateway[-_].*\.dump$/.test(f.name));
  ok.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  return ok.slice(keep).map((f) => f.name);
}
