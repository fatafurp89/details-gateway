// «هيكل الملكية»: مخطط تنظيمي SVG يُولَّد بالجافاسكربت بلا مكتبات.
// الصف الأعلى: المستفيدون الحقيقيون (للمجموعة) ← الشركة الأم ← الشركات التابعة (نسب الملكية على الخطوط).
// التخطيط (layout) دالة نقية قابلة للاختبار؛ الرسم (render) يعتمد على DOM. وضعان: wide (صفوف) و narrow (عمود واحد للجوال).
// الألوان والخطوط من company.css عبر الأصناف (لا style مضمَّن).
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const CFG = {
    wide: { entW: 212, entH: 150, ownW: 212, ownH: 78, gapX: 26, rowGap: 78, pad: 20, minW: 640 },
    narrow: { W: 340, entH: 150, ownH: 72, gapY: 34, pad: 14, trunk: 28 },
  };
  const COUNTRY_AR = { EG: 'مصر', SA: 'السعودية', US: 'الولايات المتحدة', GB: 'المملكة المتحدة', CA: 'كندا', AE: 'الإمارات', QA: 'قطر', KW: 'الكويت', BH: 'البحرين', OM: 'عُمان', JO: 'الأردن', TR: 'تركيا' };
  const KIND_AR = { parent: 'شركة أم', subsidiary: 'شركة تابعة', branch: 'فرع' };
  const STATUS_AR = { active: 'نشطة', dormant: 'خاملة', closed: 'مغلقة' };
  const FLAGS = {
    SA: '<rect width="24" height="24" fill="#0b8a3c"/><rect x="5" y="9" width="14" height="1.6" rx=".8" fill="#fff"/><rect x="6" y="15.4" width="12" height="1.4" rx=".7" fill="#fff"/>',
    EG: '<rect width="24" height="8" fill="#ce1126"/><rect y="8" width="24" height="8" fill="#fff"/><rect y="16" width="24" height="8" fill="#111"/><circle cx="12" cy="12" r="2.2" fill="#c8a24a"/>',
    US: '<rect width="24" height="24" fill="#fff"/><g fill="#b22234"><rect y="0" width="24" height="2"/><rect y="4" width="24" height="2"/><rect y="8" width="24" height="2"/><rect y="12" width="24" height="2"/><rect y="16" width="24" height="2"/><rect y="20" width="24" height="2"/></g><rect width="11.5" height="13" fill="#3c3b6e"/><g fill="#fff"><circle cx="3" cy="3" r=".7"/><circle cx="6" cy="3" r=".7"/><circle cx="9" cy="3" r=".7"/><circle cx="4.5" cy="6" r=".7"/><circle cx="7.5" cy="6" r=".7"/><circle cx="3" cy="9" r=".7"/><circle cx="6" cy="9" r=".7"/><circle cx="9" cy="9" r=".7"/></g>',
    GB: '<rect width="24" height="24" fill="#1d2f6f"/><path d="M0 0L24 24M24 0L0 24" stroke="#fff" stroke-width="4.4"/><path d="M0 0L24 24M24 0L0 24" stroke="#c8102e" stroke-width="1.6"/><path d="M12 0V24M0 12H24" stroke="#fff" stroke-width="7"/><path d="M12 0V24M0 12H24" stroke="#c8102e" stroke-width="4"/>',
    CA: '<rect width="24" height="24" fill="#fff"/><rect width="6" height="24" fill="#d52b1e"/><rect x="18" width="6" height="24" fill="#d52b1e"/><path d="M12 4.5 13.4 8 15.6 7.1 14.9 11.1 17.3 10.2 16.2 13.2 18.4 14.7 12.9 15.4V19.6H11.1V15.4L5.6 14.7 7.8 13.2 6.7 10.2 9.1 11.1 8.4 7.1 10.6 8Z" fill="#d52b1e"/>',
  };

  const initials = (name) => {
    const w = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '؟';
    return w.length === 1 ? w[0][0] : w[0][0] + ' ' + w[1][0];
  };
  const pctText = (n) => (Number.isInteger(+n) ? String(+n) : String(+n).replace(/0+$/, '')) + '%';

  // ---------- model ----------
  /** Chart model from the GET /api/company/structure payload (group-scope beneficial owners only). */
  function buildModel(structure) {
    const entities = (structure.entities || []).map((e) => ({ ...e }));
    return {
      entities, links: structure.links || [],
      owners: (structure.beneficial_owners || []).filter((b) => !b.entity_id).sort((a, b) => (a.sort - b.sort) || String(a.person_name_ar).localeCompare(String(b.person_name_ar), 'ar')),
    };
  }

  // ---------- layout (pure) ----------
  function levelsOf(entities, links) {
    const ids = new Set(entities.map((e) => e.id));
    const ls = links.filter((l) => ids.has(l.parent_entity_id) && ids.has(l.child_entity_id));
    const level = new Map(entities.map((e) => [e.id, 0]));
    for (let it = 0; it <= entities.length; it++) {
      let changed = false;
      for (const l of ls) {
        const v = level.get(l.parent_entity_id) + 1;
        if (v > level.get(l.child_entity_id) && v <= entities.length) { level.set(l.child_entity_id, v); changed = true; }
      }
      if (!changed) break;
    }
    return { level, links: ls };
  }

  /** Entities grouped into rows by level, each row ordered to keep children near their parents. */
  function entityRows(entities, links) {
    const { level, links: ls } = levelsOf(entities, links);
    const maxL = Math.max(0, ...level.values());
    const rows = [];
    const orderIdx = new Map();
    const sortKey = (e) => [e.kind === 'parent' ? 0 : 1, Number(e.sort) || 0, String(e.name_ar)];
    const cmp = (a, b) => { const ka = sortKey(a), kb = sortKey(b); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2], 'ar'); };
    for (let L = 0; L <= maxL; L++) {
      const row = entities.filter((e) => level.get(e.id) === L);
      if (L === 0) row.sort(cmp);
      else {
        const avg = (e) => { const ps = ls.filter((l) => l.child_entity_id === e.id).map((l) => orderIdx.get(l.parent_entity_id)).filter((x) => x !== undefined); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 99; };
        row.sort((a, b) => avg(a) - avg(b) || cmp(a, b));
      }
      row.forEach((e, i) => orderIdx.set(e.id, i));
      if (row.length) rows.push(row);
    }
    return { rows, links: ls };
  }

  const line = (...p) => p.join(' ');
  /**
   * Positions for nodes and edges. mode: 'wide' | 'narrow'.
   * Returns { mode, width, height, nodes: [{ id, type:'entity'|'owner', x, y, w, h, data }], edges: [{ from, to, pct, relation, d, lx, ly, fromOwner }] }.
   * RTL: the first item of a row sits on the right.
   */
  function layout(model, mode = 'wide') {
    const { rows, links } = entityRows(model.entities, model.links);
    const owners = model.owners || [];
    const rootRow = rows[0] || [];
    const parents = rootRow.filter((e) => e.kind === 'parent');
    const ownerTargets = parents.length ? parents : rootRow;
    const nodes = []; const edges = [];
    const byId = new Map();
    const add = (n) => { nodes.push(n); byId.set(n.id, n); return n; };

    if (mode === 'narrow') {
      const c = CFG.narrow; const nodeW = c.W - 2 * c.pad - c.trunk; const trunkX = c.pad + nodeW + c.trunk / 2;
      let y = c.pad;
      owners.forEach((o) => { add({ id: 'o:' + o.id, type: 'owner', x: c.pad, y, w: nodeW, h: c.ownH, data: o }); y += c.ownH + c.gapY; });
      rows.forEach((row) => row.forEach((e) => { add({ id: e.id, type: 'entity', x: c.pad, y, w: nodeW, h: c.entH, data: e }); y += c.entH + c.gapY; }));
      const mk = (src, dst, pct, relation, fromOwner) => {
        const sy = src.y + src.h / 2, ty = dst.y + dst.h / 2;
        edges.push({ from: src.id, to: dst.id, pct, relation, fromOwner, d: line('M', src.x + src.w, sy, 'H', trunkX, 'V', ty, 'H', dst.x + dst.w), lx: trunkX, ly: fromOwner ? sy : ty });
      };
      owners.forEach((o) => ownerTargets.forEach((t) => mk(byId.get('o:' + o.id), byId.get(t.id), o.share_pct, 'owns', true)));
      links.forEach((l) => mk(byId.get(l.parent_entity_id), byId.get(l.child_entity_id), l.share_pct, l.relation, false));
      return { mode, width: c.W, height: Math.max(y - c.gapY + c.pad, 120), nodes, edges };
    }

    const c = CFG.wide;
    const sizes = [];
    if (owners.length) sizes.push({ items: owners.map((o) => ({ id: 'o:' + o.id, type: 'owner', data: o })), w: c.ownW, h: c.ownH });
    rows.forEach((row) => sizes.push({ items: row.map((e) => ({ id: e.id, type: 'entity', data: e })), w: c.entW, h: c.entH }));
    const rowW = (r) => r.items.length * r.w + (r.items.length - 1) * c.gapX;
    const W = Math.max(c.minW, ...sizes.map(rowW)) + 2 * c.pad;
    let y = c.pad;
    sizes.forEach((r) => {
      const right = (W + rowW(r)) / 2;
      r.items.forEach((it, i) => add({ ...it, x: right - r.w - i * (r.w + c.gapX), y, w: r.w, h: r.h }));
      y += r.h + c.rowGap;
    });
    const mk = (src, dst, pct, relation, fromOwner) => {
      const sx = src.x + src.w / 2, sy = src.y + src.h, tx = dst.x + dst.w / 2, ty = dst.y;
      const my = sy + (ty - sy) / 2;
      edges.push({ from: src.id, to: dst.id, pct, relation, fromOwner, d: line('M', sx, sy, 'V', my, 'H', tx, 'V', ty), lx: fromOwner ? sx : tx, ly: fromOwner ? sy + 22 : ty - 22 });
    };
    owners.forEach((o) => ownerTargets.forEach((t) => mk(byId.get('o:' + o.id), byId.get(t.id), o.share_pct, 'owns', true)));
    links.forEach((l) => mk(byId.get(l.parent_entity_id), byId.get(l.child_entity_id), l.share_pct, l.relation, false));
    return { mode, width: W, height: y - c.rowGap + c.pad, nodes, edges };
  }

  // ---------- drawing ----------
  const S = (tag, attrs = {}, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  };
  const wrapper = (svg) => {
    const probe = S('text', { class: 'cs-probe', x: -9999, y: -9999 });
    svg.append(probe);
    const cache = new Map();
    const width = (t, cls) => {
      const key = cls + '|' + t;
      if (cache.has(key)) return cache.get(key);
      probe.setAttribute('class', 'cs-probe ' + cls); probe.textContent = t;
      let w = 0; try { w = probe.getComputedTextLength(); } catch { w = 0; }
      if (!w) w = t.length * (cls.includes('cs-name') ? 8 : 6.4);
      cache.set(key, w); return w;
    };
    const wrap = (text, maxW, cls, maxLines) => {
      const words = String(text || '').split(/\s+/).filter(Boolean);
      const lines = []; let cur = '';
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (!cur || width(t, cls) <= maxW) cur = t; else { lines.push(cur); cur = w; }
      }
      if (cur) lines.push(cur);
      if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); let last = keep[maxLines - 1] + ' ' + lines.slice(maxLines).join(' '); while (last.length > 3 && width(last + '…', cls) > maxW) last = last.slice(0, -1); keep[maxLines - 1] = last.trim() + '…'; return keep; }
      return lines;
    };
    return { wrap, done: () => probe.remove() };
  };
  const flag = (code, cx, cy, r) => {
    const g = S('g', { class: 'cs-flag' });
    const inner = FLAGS[code];
    if (inner) {
      const f = S('svg', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, viewBox: '0 0 24 24' });
      const holder = S('g', { 'clip-path': 'url(#cs-flagclip)' });
      holder.innerHTML = inner;
      f.append(holder); g.append(f);
    } else g.append(S('circle', { cx, cy, r, class: 'cs-flag-x' }), S('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'cs-flag-t' }, code));
    g.append(S('circle', { cx, cy, r, class: 'cs-flag-ring', fill: 'none' }));
    return g;
  };
  // LRI…PDI: التاريخ يبقى YYYY-MM-DD يسار-يمين داخل النص العربي
  const LRI = String.fromCharCode(0x2066), PDI = String.fromCharCode(0x2069);
  const dateShort = (d) => LRI + String(d || '').slice(0, 10) + PDI;
  const dayWord = (n) => { const a = Math.abs(n); return a === 1 ? 'يوم' : a === 2 ? 'يومين' : a <= 10 ? a + ' أيام' : a + ' يومًا'; };

  function entityNode(n, wr, opts) {
    const e = n.data; const st = e.stats || {};
    const cls = ['cs-node', 'cs-ent', e.kind === 'parent' ? 'parent' : '', e.profile_id ? 'main' : '', e.awaiting_details ? 'pending' : '', e.status !== 'active' ? 'off' : '', opts.selectedId === e.id ? 'sel' : ''].filter(Boolean).join(' ');
    const g = S('g', { class: cls, tabindex: 0, role: 'button', 'aria-label': e.name_ar + ' — ' + (COUNTRY_AR[e.country_code] || e.country_code) + ' — ' + (st.documents || 0) + ' مستند', 'data-id': e.id });
    const { x, y, w, h } = n; const right = x + w; const cx = x + w / 2;
    g.append(S('rect', { class: 'cs-box', x, y, width: w, height: h, rx: 14 }), S('rect', { class: 'cs-band', x: x + 1, y: y + 1, width: w - 2, height: 6, rx: 3 }));
    g.append(flag(e.country_code, right - 24, y + 28, 13));
    g.append(S('text', { class: 'cs-country', x: right - 46, y: y + 33, 'text-anchor': 'start' }, COUNTRY_AR[e.country_code] || e.country_code));
    g.append(S('text', { class: 'cs-kind', x: x + 12, y: y + 33, 'text-anchor': 'end' }, KIND_AR[e.kind] || ''));
    const lines = wr.wrap(e.name_ar, w - 24, 'cs-name', 2);
    lines.forEach((t, i) => g.append(S('text', { class: 'cs-name', x: cx, y: y + 62 + i * 18, 'text-anchor': 'middle' }, t)));
    const pillY = y + 62 + (lines.length - 1) * 18 + 16;
    const label = e.awaiting_details ? 'بانتظار الاسم والأوراق' : (STATUS_AR[e.status] || e.status);
    const pw = e.awaiting_details ? 134 : 62;
    g.append(S('rect', { class: 'cs-pill ' + (e.awaiting_details ? 'wait' : e.status), x: cx - pw / 2, y: pillY, width: pw, height: 18, rx: 9 }), S('text', { class: 'cs-pill-t ' + (e.awaiting_details ? 'wait' : e.status), x: cx, y: pillY + 13, 'text-anchor': 'middle' }, label));
    const fy = y + h - 24;
    g.append(S('text', { class: 'cs-doc', x: cx, y: fy, 'text-anchor': 'middle' }, (st.documents || 0) ? st.documents + ' مستند' + (st.with_files != null ? ' (' + st.with_files + ' بملف)' : '') : 'لا مستندات بعد'));
    const ne = st.next_expiry;
    const expCls = !ne ? 'none' : ne.days_left < 0 ? 'expired' : ne.days_left <= 30 ? 'expiring' : 'ok';
    g.append(S('circle', { class: 'cs-dot ' + expCls, cx: x + 16, cy: fy + 15, r: 4 }));
    g.append(S('text', { class: 'cs-exp ' + expCls, x: cx, y: fy + 19, 'text-anchor': 'middle' }, ne ? (ne.days_left < 0 ? 'انتهى ' + dateShort(ne.expires_on) : 'أقرب انتهاء ' + dateShort(ne.expires_on)) : 'لا تواريخ انتهاء'));
    return g;
  }

  function ownerNode(n, wr, i, defs) {
    const o = n.data; const { x, y, w, h } = n; const right = x + w; const cy = y + h / 2; const r = 22; const ax = right - 14 - r;
    const g = S('g', { class: 'cs-node cs-own', tabindex: 0, role: 'button', 'aria-label': o.person_name_ar + ' — ' + pctText(o.share_pct) + ' — ' + (o.basis || 'مستفيد حقيقي'), 'data-owner': o.id });
    g.append(S('rect', { class: 'cs-box', x, y, width: w, height: h, rx: 14 }));
    const id = 'cs-ph-' + i;
    if (o.photo_url && /^(https:\/\/|\/)/.test(o.photo_url)) {
      defs.append(S('clipPath', { id }, S('circle', { cx: ax, cy, r })));
      g.append(S('circle', { class: 'cs-av', cx: ax, cy, r }), S('image', { href: o.photo_url, x: ax - r, y: cy - r, width: r * 2, height: r * 2, preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#' + id + ')' }));
    } else g.append(S('circle', { class: 'cs-av', cx: ax, cy, r }), S('text', { class: 'cs-av-t', x: ax, y: cy + 5, 'text-anchor': 'middle' }, initials(o.person_name_ar)));
    g.append(S('circle', { class: 'cs-av-ring', cx: ax, cy, r, fill: 'none' }));
    const tw = w - (right - ax + r) - 14 + 8; const tx = ax - r - 10;
    const lines = wr.wrap(o.person_name_ar, tw, 'cs-name', 2);
    const top = cy - (lines.length === 2 ? 14 : 6);
    lines.forEach((t, k) => g.append(S('text', { class: 'cs-name', x: tx, y: top + k * 17, 'text-anchor': 'start' }, t)));
    g.append(S('text', { class: 'cs-basis', x: tx, y: top + lines.length * 17 + 3, 'text-anchor': 'start' }, (o.basis || 'مستفيد حقيقي') + ' · ' + pctText(o.share_pct)));
    return g;
  }

  /**
   * Draws the chart into `container`. opts: { mode, selectedId, onSelectEntity(id), onSelectOwner(id) }.
   * Re-renders itself when the container crosses the narrow/wide breakpoint.
   */
  function render(container, model, opts = {}) {
    container.replaceChildren();
    const w0 = container.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1000);
    const mode = opts.mode || (w0 < 640 ? 'narrow' : 'wide');
    const L = layout(model, mode);
    const svg = S('svg', { class: 'cstruct-svg ' + mode, viewBox: `0 0 ${L.width} ${L.height}`, width: L.width, role: 'group', direction: 'rtl', 'aria-label': 'هيكل ملكية المجموعة' });
    const defs = S('defs', {}, S('clipPath', { id: 'cs-flagclip' }, S('circle', { cx: 12, cy: 12, r: 12 })));
    svg.append(defs, S('title', {}, 'هيكل ملكية المجموعة'));
    container.append(svg);
    const wr = wrapper(svg);
    const gE = S('g', { class: 'cs-edges' }); const gL = S('g', { class: 'cs-labels' }); const gN = S('g', { class: 'cs-nodes' });
    svg.append(gE, gN, gL);
    for (const e of L.edges) {
      gE.append(S('path', { class: 'cs-edge' + (e.fromOwner ? ' own' : '') + (e.relation === 'branch_of' ? ' dash' : ''), d: e.d, fill: 'none' }));
      const t = e.relation === 'branch_of' ? 'فرع' : pctText(e.pct); const lw = Math.max(40, t.length * 8 + 16);
      gL.append(S('g', { class: 'cs-lab' + (e.fromOwner ? ' own' : '') }, S('rect', { x: e.lx - lw / 2, y: e.ly - 11, width: lw, height: 22, rx: 11 }), S('text', { x: e.lx, y: e.ly + 5, 'text-anchor': 'middle' }, t)));
    }
    let oi = 0;
    for (const n of L.nodes) {
      const g = n.type === 'entity' ? entityNode(n, wr, opts) : ownerNode(n, wr, oi++, defs);
      const fire = () => (n.type === 'entity' ? opts.onSelectEntity && opts.onSelectEntity(n.data.id) : opts.onSelectOwner && opts.onSelectOwner(n.data.id));
      g.addEventListener('click', fire);
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fire(); } });
      gN.append(g);
    }
    wr.done();
    container._csState = { model, opts, mode };
    if (!opts.mode && typeof ResizeObserver !== 'undefined' && !container._csObs) {
      container._csObs = new ResizeObserver(() => {
        const st = container._csState; if (!st || !container.isConnected || !container.clientWidth) return;
        const m = container.clientWidth < 640 ? 'narrow' : 'wide';
        if (m !== st.mode) render(container, st.model, st.opts);
      });
      container._csObs.observe(container);
    }
    return L;
  }

  const api = { buildModel, layout, render, initials, pctText, FLAGS, levelsOf };
  root.CompanyChart = api;
})(typeof window !== 'undefined' ? window : globalThis);
