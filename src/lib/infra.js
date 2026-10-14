// «المعلومات التقنية» (pure): validation of nodes/links/services/agent reports, status + alerts, Arabic uptime, topology layout
export const KEY_RE = /^[a-z0-9_-]{2,60}$/;
export const NODE_KINDS = ['internet', 'isp', 'provider', 'dns', 'site', 'vps', 'office-server', 'router', 'gateway', 'switch', 'ap', 'device', 'service'];
export const LINK_KINDS = ['lan', 'internet', 'wireguard', 'tailscale', 'usb'];
export const STATUS_SOURCES = ['agent', 'ping', 'manual'];
export const STATUSES = ['up', 'down', 'unknown'];
export const KIND_AR = {
  internet: 'الإنترنت', isp: 'مزود اتصالات', provider: 'مزود استضافة', dns: 'نطاقات', site: 'موقع', vps: 'خادم سحابي',
  'office-server': 'خادم المكتب', router: 'راوتر', gateway: 'بوابة شبكة', switch: 'سويتش', ap: 'نقطة وصول', device: 'جهاز', service: 'خدمة',
};
export const LINK_AR = { lan: 'شبكة محلية', internet: 'إنترنت', wireguard: 'WireGuard', tailscale: 'Tailscale', usb: 'USB' };
export const STATUS_AR = { up: 'يعمل', down: 'متوقف', unknown: 'غير معروف' };

export const STALE_MS = 10 * 60 * 1000;     // no agent report for 10 minutes -> red
export const DISK_WARN_PCT = 85;            // disk usage above this -> red
export const SUBSCRIPTION_WARN_DAYS = 30;   // subscription ends within this -> warning
export const MAX_URLS = 20;
export const MAX_DISKS = 40;
export const MAX_SERVICES = 200;
export const MAX_PROBES = 100;

const str = (v, max) => (v === undefined || v === null ? '' : String(v).trim()).slice(0, max);
const opt = (v, max) => { const s = str(v, max); return s || null; };
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const HOST_RE = /^[A-Za-z0-9._:/-]{1,120}$/; // IPv4/IPv6/CIDR/hostname

/** Node fields the admin may edit (POST adds key/kind/parent_key/sort too). Returns { value } or { error } in Arabic. */
export function validateNode(body, { isNew = false } = {}) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const v = {};
  if (isNew) {
    v.key = str(body.key, 61).toLowerCase();
    if (!KEY_RE.test(v.key)) return { error: 'مفتاح العقدة غير صالح (حروف لاتينية صغيرة وأرقام و- و_ فقط)' };
  }
  v.name_ar = str(body.name_ar, 160);
  if (!v.name_ar) return { error: 'الاسم العربي مطلوب' };
  if (isNew || body.kind !== undefined) {
    v.kind = str(body.kind, 20);
    if (!NODE_KINDS.includes(v.kind)) return { error: 'نوع العقدة غير صالح' };
  }
  if (isNew || body.parent_key !== undefined) {
    v.parent_key = opt(body.parent_key, 61);
    if (v.parent_key !== null && !KEY_RE.test(v.parent_key)) return { error: 'مفتاح الأب غير صالح' };
    if (isNew && v.parent_key === v.key) return { error: 'العقدة لا يمكن أن تكون أبًا لنفسها' };
  }
  if (isNew || body.sort !== undefined) {
    const s = num(body.sort);
    v.sort = s === null || !Number.isFinite(s) ? 100 : Math.trunc(s);
  }
  if (isNew || body.status_source !== undefined) {
    v.status_source = str(body.status_source, 10) || 'manual';
    if (!STATUS_SOURCES.includes(v.status_source)) return { error: 'مصدر الحالة غير صالح' };
  }
  if (body.status !== undefined) {
    v.status = str(body.status, 10);
    if (!STATUSES.includes(v.status)) return { error: 'الحالة غير صالحة' };
  }
  for (const k of ['model', 'provider', 'plan', 'hostname', 'os', 'username']) if (isNew || body[k] !== undefined) v[k] = opt(body[k], 200);
  if (isNew || body.notes !== undefined) v.notes = opt(body.notes, 4000);
  if (isNew || body.subscription_end !== undefined) {
    const d = opt(body.subscription_end, 10);
    if (d !== null && !isDate(d)) return { error: 'تاريخ انتهاء الاشتراك غير صالح (YYYY-MM-DD)' };
    v.subscription_end = d;
  }
  for (const k of ['public_ip', 'local_ip', 'tailscale_ip', 'wg_ip']) {
    if (!isNew && body[k] === undefined) continue;
    const ip = opt(body[k], 120);
    if (ip !== null && !HOST_RE.test(ip)) return { error: 'العنوان غير صالح' };
    v[k] = ip;
  }
  if (isNew || body.urls !== undefined) {
    const raw = body.urls === undefined || body.urls === null ? [] : body.urls;
    if (!Array.isArray(raw) || raw.length > MAX_URLS) return { error: 'قائمة الروابط غير صالحة' };
    v.urls = [];
    for (const u of raw) {
      if (!u || typeof u !== 'object') return { error: 'قائمة الروابط غير صالحة' };
      const url = str(u.url, 500);
      if (!/^https?:\/\/\S+$/i.test(url)) return { error: `الرابط «${url.slice(0, 40)}» غير صالح (يبدأ بـ http:// أو https://)` };
      v.urls.push({ label_ar: str(u.label_ar, 120) || url, url });
    }
  }
  if (isNew || body.external !== undefined) v.external = body.external === true || body.external === 'true';
  return { value: v };
}

export function validateLink(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const from_key = str(body.from_key, 61).toLowerCase(), to_key = str(body.to_key, 61).toLowerCase(), kind = str(body.kind, 12);
  if (!KEY_RE.test(from_key) || !KEY_RE.test(to_key)) return { error: 'مفتاح العقدة غير صالح' };
  if (from_key === to_key) return { error: 'الوصلة لا يمكن أن تربط العقدة بنفسها' };
  if (!LINK_KINDS.includes(kind)) return { error: 'نوع الوصلة غير صالح' };
  return { value: { from_key, to_key, kind, label_ar: str(body.label_ar, 120) } };
}

export function validateService(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const node_key = str(body.node_key, 61).toLowerCase();
  if (!KEY_RE.test(node_key)) return { error: 'مفتاح العقدة غير صالح' };
  const name_ar = str(body.name_ar, 160);
  if (!name_ar) return { error: 'اسم الخدمة مطلوب' };
  const port = num(body.port);
  if (port !== null && !(Number.isInteger(port) && port >= 1 && port <= 65535)) return { error: 'المنفذ غير صالح' };
  const url = opt(body.url, 500);
  if (url !== null && !/^https?:\/\/\S+$/i.test(url)) return { error: 'الرابط غير صالح' };
  const sort = num(body.sort);
  return { value: { node_key, name_ar, system_key: opt(body.system_key, 32)?.toLowerCase() ?? null, port, unit_name: opt(body.unit_name, 120), url,
    notes: opt(body.notes, 1000), sort: sort === null || !Number.isFinite(sort) ? 100 : Math.trunc(sort) } };
}

/** Agent payload -> normalized report (numbers coerced, lists capped, unknown fields dropped). */
export function validateReport(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const node = str(body.node, 61).toLowerCase();
  if (!KEY_RE.test(node)) return { error: 'مفتاح العقدة غير صالح' };
  const r = { node };
  const up = num(body.uptime_s);
  r.uptime_s = up !== null && Number.isFinite(up) && up >= 0 ? Math.trunc(up) : null;
  r.load = Array.isArray(body.load) ? body.load.slice(0, 3).map((x) => Number(x)).filter(Number.isFinite) : [];
  const mem = body.mem && typeof body.mem === 'object' ? body.mem : {};
  r.mem = { total: num(mem.total), used: num(mem.used) };
  if (!(r.mem.total > 0)) r.mem = null;
  const disks = Array.isArray(body.disks) ? body.disks : [];
  if (disks.length > MAX_DISKS) return { error: 'قائمة الأقراص طويلة جدًا' };
  r.disks = disks.filter((d) => d && typeof d === 'object').map((d) => ({ mount: str(d.mount, 200) || '/', size: num(d.size), used: num(d.used) }))
    .filter((d) => d.size > 0 && d.used >= 0);
  const services = Array.isArray(body.services) ? body.services : [];
  if (services.length > MAX_SERVICES) return { error: 'قائمة الخدمات طويلة جدًا' };
  r.services = services.filter((s) => s && typeof s === 'object' && str(s.name, 120)).map((s) => ({ name: str(s.name, 120), active: s.active === true || s.active === 'true' || s.active === 'active' }));
  r.os = opt(body.os, 200);
  const upd = body.updates && typeof body.updates === 'object' ? body.updates : null;
  r.updates = upd ? { count: Math.max(0, Math.trunc(num(upd.count) || 0)), last_check: opt(upd.last_check, 40), reboot_required: upd.reboot_required === true } : null;
  const wg = body.wg && typeof body.wg === 'object' ? body.wg : null;
  r.wg = wg ? { peers: Math.max(0, Math.trunc(num(wg.peers) || 0)), handshake_s: num(wg.handshake_s), up: wg.up !== false } : null;
  const ts = body.tailscale && typeof body.tailscale === 'object' ? body.tailscale : null;
  r.tailscale = ts ? { ip: opt(ts.ip, 60), online: ts.online !== false } : null;
  const probes = Array.isArray(body.probes) ? body.probes : [];
  if (probes.length > MAX_PROBES) return { error: 'قائمة الفحوص طويلة جدًا' };
  r.probes = probes.filter((p) => p && typeof p === 'object' && HOST_RE.test(str(p.host, 120)))
    .map((p) => ({ host: str(p.host, 120), ok: p.ok === true || p.ok === 'true' || p.ok === 1, ms: num(p.ms) }));
  return { value: r };
}

/** Match probe hosts to nodes by any of their addresses. Returns Map host -> node key. */
export function matchProbes(probes, nodes) {
  const byAddr = new Map();
  for (const n of nodes) for (const k of ['local_ip', 'public_ip', 'wg_ip', 'tailscale_ip', 'hostname']) if (n[k]) byAddr.set(String(n[k]).toLowerCase(), n.key);
  const out = new Map();
  for (const p of probes) { const k = byAddr.get(p.host.toLowerCase()); if (k) out.set(p.host, k); }
  return out;
}

/** Status for the dot: 'up' | 'down' | 'unknown', taking staleness into account. */
export function effectiveStatus(node, now = new Date(), staleMs = STALE_MS) {
  if (!node) return 'unknown';
  if (node.status_source === 'manual') return node.status || 'unknown';
  if (!node.status_at) return 'unknown';
  const age = now - new Date(node.status_at);
  if (age > staleMs) return node.status_source === 'agent' ? 'down' : 'unknown';
  return node.status || 'unknown';
}

export function daysUntil(date, now = new Date()) {
  if (!date) return null;
  const d = new Date(typeof date === 'string' && date.length === 10 ? date + 'T00:00:00Z' : date);
  if (Number.isNaN(+d)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d - today) / 86_400_000);
}

export const pct = (used, total) => (total > 0 ? Math.round((used / total) * 100) : null);

/**
 * Alerts for one node: [{ code, level: 'danger'|'warn', text }].
 * codes: stale (no report 10 min), down (probe failed), disk (>85%), subscription (<=30 days or expired), reboot
 */
export function computeAlerts(node, latest, now = new Date()) {
  const out = [];
  if (!node) return out;
  const status = effectiveStatus(node, now);
  if (node.status_source === 'agent') {
    if (!node.status_at) out.push({ code: 'no_report', level: 'warn', text: 'لم يصل أي تقرير من الوكيل بعد' });
    else if (now - new Date(node.status_at) > STALE_MS) out.push({ code: 'stale', level: 'danger', text: 'انقطع تقرير الوكيل منذ أكثر من 10 دقائق' });
  } else if (node.status_source === 'ping') {
    if (status === 'down') out.push({ code: 'down', level: 'danger', text: 'الجهاز لا يستجيب للفحص (ping)' });
    else if (node.status_at && now - new Date(node.status_at) > STALE_MS) out.push({ code: 'stale', level: 'warn', text: 'لم يُفحص الجهاز منذ أكثر من 10 دقائق' });
  }
  const payload = latest?.payload || latest || {};
  for (const d of payload.disks || []) {
    const p = pct(d.used, d.size);
    if (p !== null && p > DISK_WARN_PCT) out.push({ code: 'disk', level: 'danger', text: `القرص ${d.mount} ممتلئ ${p}٪` });
  }
  if (payload.updates?.reboot_required) out.push({ code: 'reboot', level: 'warn', text: 'يحتاج الخادم إلى إعادة تشغيل بعد التحديثات' });
  const days = daysUntil(node.subscription_end, now);
  if (days !== null) {
    if (days < 0) out.push({ code: 'subscription', level: 'danger', text: `انتهى الاشتراك منذ ${arCount(-days, DAY)}` });
    else if (days <= SUBSCRIPTION_WARN_DAYS) out.push({ code: 'subscription', level: 'warn', text: days === 0 ? 'ينتهي الاشتراك اليوم' : `ينتهي الاشتراك خلال ${arCount(days, DAY)}` });
  }
  return out;
}

// ---- Arabic counting (1 / 2 / 3-10 / 11+) ----
export const DAY = { one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا' };
export const HOUR = { one: 'ساعة واحدة', two: 'ساعتان', few: 'ساعات', many: 'ساعة' };
export const MINUTE = { one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة' };
export function arCount(n, f) {
  n = Math.trunc(Number(n) || 0);
  if (n === 1) return f.one;
  if (n === 2) return f.two;
  if (n >= 3 && n <= 10) return `${n} ${f.few}`;
  return `${n} ${f.many}`;
}

/** 93784 -> "يوم واحد و2 ساعتان…" style: days, hours, minutes (largest two non-zero units), "أقل من دقيقة" under 60 s. */
export function humanizeUptime(seconds) {
  const s = Math.max(0, Math.trunc(Number(seconds) || 0));
  if (s < 60) return 'أقل من دقيقة';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(arCount(d, DAY));
  if (h) parts.push(arCount(h, HOUR));
  if (m && parts.length < 2) parts.push(arCount(m, MINUTE));
  return parts.slice(0, 2).join(' و');
}

/** Flat rows -> roots with `children` (sorted by sort, key); orphans become roots. */
export function buildInfraTree(rows) {
  const map = new Map(rows.map((r) => [r.key, { ...r, children: [] }]));
  const roots = [];
  for (const n of map.values()) {
    const p = n.parent_key && map.get(n.parent_key);
    if (p && p !== n) p.children.push(n); else roots.push(n);
  }
  const order = (a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.key.localeCompare(b.key);
  const rec = (list) => { list.sort(order); for (const n of list) rec(n.children); };
  rec(roots);
  return roots;
}

/**
 * Layered auto-layout: one band per root (internet / office …), inside a band one column per tree depth,
 * rows ordered by a depth-first walk (so children sit next to their parent). Cycles are impossible (tree by parent_key).
 * Returns [{ root, columns: [[keys], …] }].
 */
export function layoutColumns(rows) {
  const roots = buildInfraTree(rows);
  return roots.map((root) => {
    const columns = [];
    const walk = (n, depth) => { (columns[depth] ||= []).push(n.key); for (const c of n.children) walk(c, depth + 1); };
    walk(root, 0);
    return { root: root.key, columns };
  });
}

/** Bands -> absolute positions { key: { x, y, col, row } } (x grows with depth; caller mirrors for RTL). */
export function placeNodes(bands, { colW = 190, rowH = 64, bandGap = 40 } = {}) {
  const pos = {};
  let y0 = 0;
  for (const b of bands) {
    let tallest = 0;
    b.columns.forEach((keys, col) => {
      keys.forEach((key, row) => { pos[key] = { x: col * colW, y: y0 + row * rowH, col, row }; });
      tallest = Math.max(tallest, keys.length);
    });
    y0 += tallest * rowH + bandGap;
  }
  return { positions: pos, height: Math.max(0, y0 - bandGap), width: Math.max(0, ...bands.map((b) => b.columns.length)) * colW };
}
