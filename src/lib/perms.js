// Unified permissions tree (pure): catalog validation, tree building, branch keys, proxy-key check
import { safeEqual } from './crypto.js';

export const KEY_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
export const SYSTEM_RE = /^[a-z0-9_-]{2,32}$/;
export const KINDS = ['system', 'module', 'screen', 'action'];
export const MAX_NODES = 5000;
export const MAX_KEY = 200;

const clean = (v, max) => (v === undefined || v === null ? '' : String(v).trim()).slice(0, max);
export const depthOf = (key) => key.split('.').length;
export const parentOf = (key) => (key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : null);
export const defaultKind = (depth) => KINDS[Math.min(depth, KINDS.length) - 1];

/**
 * Validate a catalog payload from a system: { system, nodes:[{key,label_ar,description_ar,kind,parent_key,sort}] }.
 * Returns { value: { system, nodes } } (nodes sorted parents-first, root always present) or { error } in Arabic.
 * The root node's label_ar may be '' (the route fills it from systems.name_ar).
 */
export function validateCatalog(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const system = clean(body.system, 40).toLowerCase();
  if (!SYSTEM_RE.test(system)) return { error: 'مفتاح النظام غير صالح' };
  const raw = body.nodes;
  if (!Array.isArray(raw)) return { error: 'قائمة العناصر مطلوبة' };
  if (raw.length > MAX_NODES) return { error: `عدد العناصر يتجاوز الحد (${MAX_NODES})` };

  const map = new Map();
  map.set(system, { key: system, system_key: system, parent_key: null, label_ar: '', description_ar: '', kind: 'system', sort: 0 });
  for (let i = 0; i < raw.length; i++) {
    const n = raw[i];
    if (!n || typeof n !== 'object') return { error: `العنصر رقم ${i + 1} غير صالح` };
    const key = clean(n.key, MAX_KEY + 1).toLowerCase();
    if (!KEY_RE.test(key) || key.length > MAX_KEY) return { error: `مفتاح العنصر رقم ${i + 1} غير صالح` };
    if (key !== system && !key.startsWith(system + '.')) return { error: `العنصر «${key}» لا يتبع النظام «${system}»` };
    if (map.has(key) && key !== system) return { error: `المفتاح «${key}» مكرر` };
    const label_ar = clean(n.label_ar, 120);
    if (key !== system && !label_ar) return { error: `الاسم العربي مطلوب للعنصر «${key}»` };
    const depth = depthOf(key);
    const kind = clean(n.kind, 10) || defaultKind(depth);
    if (!KINDS.includes(kind)) return { error: `نوع العنصر «${key}» غير صالح` };
    if (key === system && kind !== 'system') return { error: 'جذر النظام يجب أن يكون من نوع system' };
    let parent_key = n.parent_key === undefined || n.parent_key === null || n.parent_key === '' ? parentOf(key) : clean(n.parent_key, MAX_KEY + 1).toLowerCase();
    if (key === system) parent_key = null;
    else if (!parent_key || !key.startsWith(parent_key + '.')) return { error: `أب العنصر «${key}» يجب أن يكون بادئة لمفتاحه` };
    const sort = Number.isFinite(Number(n.sort)) ? Math.trunc(Number(n.sort)) : 100;
    map.set(key, { key, system_key: system, parent_key, label_ar, description_ar: clean(n.description_ar, 500), kind, sort });
  }
  for (const n of map.values()) {
    if (n.parent_key && !map.has(n.parent_key)) return { error: `أب العنصر «${n.key}» (${n.parent_key}) غير موجود في الكتالوج` };
  }
  const nodes = [...map.values()].sort((a, b) => depthOf(a.key) - depthOf(b.key) || a.sort - b.sort || a.key.localeCompare(b.key));
  return { value: { system, nodes } };
}

const byOrder = (a, b) => a.sort - b.sort || a.key.localeCompare(b.key);

/** Flat rows -> array of root nodes, each with `children` (sorted by sort, key). Orphans fall back to their system root. */
export function buildTree(rows) {
  const nodes = new Map(rows.map((r) => [r.key, { ...r, children: [] }]));
  const roots = [];
  for (const n of nodes.values()) {
    const parent = (n.parent_key && nodes.get(n.parent_key)) || (n.parent_key && nodes.get(n.system_key)) || null;
    if (parent && parent !== n) parent.children.push(n); else roots.push(n);
  }
  const sortRec = (list) => { list.sort(byOrder); for (const n of list) sortRec(n.children); };
  sortRec(roots);
  return roots;
}

/** Keys of the branch rooted at `key` (itself included); by default only present nodes. */
export function branchKeys(rows, key, { presentOnly = true } = {}) {
  const kids = new Map();
  for (const r of rows) {
    if (!r.parent_key) continue;
    if (!kids.has(r.parent_key)) kids.set(r.parent_key, []);
    kids.get(r.parent_key).push(r);
  }
  const root = rows.find((r) => r.key === key);
  if (!root) return [];
  const out = [];
  const walk = (n) => {
    if (!presentOnly || n.present !== false) out.push(n.key);
    for (const c of kids.get(n.key) || []) walk(c);
  };
  walk(root);
  return out;
}

/** Present nodes nobody has been granted yet (grantees = 0): the «new items» counter. */
export function unreviewedNodes(rows) {
  return rows.filter((r) => r.present !== false && !(Number(r.grantees) > 0));
}

/** Shared-secret check for internal endpoints: 'ok' | 'unconfigured' | 'denied'. */
export function checkProxyKey(header, configured) {
  if (typeof configured !== 'string' || configured.length < 16) return 'unconfigured';
  return typeof header === 'string' && safeEqual(header, configured) ? 'ok' : 'denied';
}
