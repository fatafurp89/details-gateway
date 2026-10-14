// «شارات الانتباه» على بطاقات البوابة: عدّاد صغير لكل نظام = عدد العناصر التي تحتاج انتباه الموظف فيه.
// العقد: getBadges(app, employee, systemKeys) -> { <system_key>: { count, label, tone: 'red'|'amber' } } (العدّادات الصفرية لا تُعاد).
// المصادر المحلية (إشعارات، المنشأة) من قاعدة البوابة؛ والمصادر البعيدة (whatsapp, mail, hr, files) عبر نفق WireGuard:
//   GET http://10.9.0.3<path>?employee_no=NNNN  بترويسة Host = <system>.details-wms.cloud و X-Gw-Proxy-Key = GATEWAY_PROXY_KEY.
//   الرد المتوقع JSON: { ok?: true, count: <int>, label?: <string> }. أي فشل أو مهلة (2.5 ث) أو 404 = لا شارة لذلك النظام (لا يعطّل غيره).
// تخزين مؤقت في الذاكرة لكل موظف 45 ثانية (مع دمج الطلبات المتزامنة).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TTL_MS = 45_000;
export const SOURCE_TIMEOUT_MS = 2_500;
const MAX_CACHE = 1000;
const MAX_COUNT = 9999;

/** Remote sources: tile key -> where the system answers (all through the apps-VPS tunnel nginx). */
export const REMOTE_SOURCES = [
  { key: 'whatsapp', host: 'whatsapp.details-wms.cloud', path: '/internal/badge', label: 'محادثات غير مقروءة' },
  { key: 'mail', host: 'mail.details-wms.cloud', path: '/api/internal/badge', label: 'رسائل غير مقروءة' },
  { key: 'hr', host: 'hr.details-wms.cloud', path: '/api/internal/badge', label: 'طلبات بانتظار اعتمادك' },
  { key: 'files', host: 'files.details-wms.cloud', path: '/internal/badge', label: 'ملفات جديدة على طلباتي' },
];
const LABELS = {
  notifications: 'إشعارات غير مقروءة',
  company: 'عناصر منتهية أو تنتهي خلال 30 يومًا',
};

const cache = new Map(); // `${employee_no}|${keys}` -> { at, value }
const inflight = new Map();

/** Clean one source answer to a non-negative integer (anything else -> 0). */
export function cleanCount(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COUNT) : 0;
}
/** Source-provided label if it is short plain text, else the default. */
export function cleanLabel(v, fallback) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim() : '';
  return s && s.length <= 60 ? s : fallback;
}

/**
 * GET via node:http with a fetch-like result ({ ok, status, json() }). Used instead of global fetch because
 * fetch (undici) silently drops a custom Host header, and the tunnel nginx routes by Host (the URL carries the tunnel IP).
 */
export function httpGet(url, { headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers, signal, timeout: SOURCE_TIMEOUT_MS + 500 }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 64 * 1024) req.destroy(new Error('too large')); else chunks.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(text) });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** One remote system. Never throws: null = "show nothing". */
export async function fetchRemote(src, employeeNo, { baseUrl, proxyKey, fetchImpl = httpGet, timeoutMs = SOURCE_TIMEOUT_MS }) {
  if (!proxyKey || !/^\d{4}$/.test(employeeNo)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}${src.path}?employee_no=${encodeURIComponent(employeeNo)}`, {
      method: 'GET', signal: ctrl.signal,
      headers: { Host: src.host, 'X-Gw-Proxy-Key': proxyKey, Accept: 'application/json' },
    });
    if (!res.ok) return null; // 404 (not deployed yet), 401/403, 5xx
    const j = await res.json().catch(() => null);
    if (!j || typeof j !== 'object' || j.ok === false) return null;
    const count = cleanCount(j.count);
    return count > 0 ? { count, label: cleanLabel(j.label, src.label), tone: 'red' } : null;
  } catch {
    return null; // timeout / network
  } finally { clearTimeout(timer); }
}

async function compute(app, employee, keys, deps) {
  const { db, cfg } = app;
  const want = new Set(keys);
  const out = {};
  const put = (key, count, tone = 'red', label = LABELS[key]) => { const c = cleanCount(count); if (c > 0) out[key] = { count: c, label, tone }; };
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };
  const countUnread = deps.countUnread || (await import('../routes/notifications.js')).countUnread;
  const countCompanyAlerts = deps.countCompanyAlerts || (await import('../routes/company.js')).countCompanyAlerts;
  const baseUrl = deps.baseUrl || process.env.BADGES_BASE_URL || 'http://10.9.0.3';
  const remote = REMOTE_SOURCES.filter((s) => want.has(s.key));

  const jobs = [];
  if (want.has('notifications')) jobs.push(safe(() => countUnread(db, employee.employee_id)).then((n) => put('notifications', n)));
  // المنشأة: للمدير فقط (المستندات والمنصات والتفويضات خاصة بإدارة الشركة)
  if (want.has('company') && employee.role === 'admin') jobs.push(safe(() => countCompanyAlerts(db)).then((n) => put('company', n, 'amber')));
  for (const s of remote) {
    jobs.push(fetchRemote(s, employee.employee_no, { baseUrl, proxyKey: cfg.proxyKey, fetchImpl: deps.fetch, timeoutMs: deps.timeoutMs })
      .then((r) => { if (r) out[s.key] = r; }));
  }
  await Promise.all(jobs);
  return out;
}

/**
 * @param app  Fastify app (needs app.db, app.cfg.proxyKey)
 * @param employee { employee_id, employee_no, role }
 * @param systemKeys keys of the tiles the employee can see (a source for an invisible tile is never called)
 * @param deps test hooks: { fetch (url, {headers, signal}) -> {ok,status,json()}, countUnread, countCompanyAlerts, baseUrl, timeoutMs, now }
 */
export async function getBadges(app, employee, systemKeys, deps = {}) {
  const no = String(employee.employee_no || '').trim();
  const keys = [...new Set(systemKeys)].sort();
  const ck = `${no}|${employee.role}|${keys.join(',')}`;
  const now = deps.now ? deps.now() : Date.now();
  const hit = cache.get(ck);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  if (inflight.has(ck)) return inflight.get(ck);
  const p = compute(app, { ...employee, employee_no: no }, keys, deps).then((value) => {
    if (cache.size >= MAX_CACHE) for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(ck, { at: now, value });
    return value;
  }).finally(() => inflight.delete(ck));
  inflight.set(ck, p);
  return p;
}

export function clearBadgeCache() { cache.clear(); inflight.clear(); }

// ---- رقم الإصدار وتاريخ البناء (يظهران صغيرين في تذييل البوابة) ----
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
function newestMtime(dirs) {
  let max = 0;
  const walk = (d, depth) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); } else { try { max = Math.max(max, fs.statSync(p).mtimeMs); } catch { /* skip */ } }
    }
  };
  for (const d of dirs) walk(path.join(ROOT, d), 0);
  return max;
}
let buildCache = null;
export function buildInfo() {
  if (buildCache) return buildCache;
  let version = '1.0.0';
  try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || version; } catch { /* keep default */ }
  const ms = newestMtime(['src', 'web', 'migrations']);
  buildCache = { version, built_at: ms ? new Date(ms).toISOString().slice(0, 10) : null };
  return buildCache;
}
