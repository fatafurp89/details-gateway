// «المعلومات التقنية»: device tree + node card, SVG topology map, Details composition, OTP-guarded secrets.
// Loaded by admin.html before admin.js; admin.js calls window.dgInfra(helpers) for the «infra» tab.
'use strict';
window.dgInfra = async function dgInfra(h) {
  const { el, toast, run, table, fmt, select, day } = h;
  const KIND = { internet: 'الإنترنت', isp: 'مزود اتصالات', provider: 'مزود استضافة', dns: 'نطاقات', site: 'موقع', vps: 'خادم سحابي', 'office-server': 'خادم المكتب',
    router: 'راوتر', gateway: 'بوابة شبكة', switch: 'سويتش', ap: 'نقطة وصول', device: 'جهاز', service: 'خدمة' };
  const LINK = { lan: 'شبكة محلية', internet: 'إنترنت', wireguard: 'WireGuard', tailscale: 'Tailscale', usb: 'USB' };
  const STATUS = { up: 'يعمل', down: 'متوقف', unknown: 'غير معروف' };
  const SOURCE = { agent: 'وكيل على الجهاز', ping: 'فحص ping من خادم المكتب', manual: 'يدوي' };
  const ICON = { internet: '🌐', isp: '📡', provider: '☁', dns: '🔤', site: '🏢', vps: '🖥', 'office-server': '🗄', router: '📶', gateway: '🛡', switch: '🔀', ap: '📻', device: '🔌', service: '⚙' };
  const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('ar-SA-u-nu-latn'));
  const gb = (b) => (b === null || b === undefined ? '—' : (b / 1073741824).toFixed(b >= 107374182400 ? 0 : 1) + ' GB');
  const pct = (u, t) => (t > 0 ? Math.round((u / t) * 100) : null);
  const store = (k, v) => { try { v === undefined ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ignore */ } };
  const read = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };

  let data = await api('/api/admin/infra/topology');
  let byKey = new Map();
  const index = () => { byKey = new Map(data.nodes.map((n) => [n.key, n])); };
  index();
  const reload = async () => { data = await api('/api/admin/infra/topology'); index(); paintMain(); if (selected) openNode(selected, true); };

  // رابط عميق من «بيانات المنشأة»: /infra#node=<key> يفتح بطاقة العقدة التي تحوي سر المنصة
  const hashNode = (location.hash.match(/^#node=([a-z0-9_-]{2,60})$/) || [])[1] || null;
  let sub = hashNode ? 'tree' : location.hash === '#resources' ? 'resources' : (read('dg_infra_tab') || 'map');
  let selected = (hashNode && byKey.has(hashNode) ? hashNode : null) || read('dg_infra_node') || null;
  const closed = new Set();

  // ---------- shared bits ----------
  const dot = (status, title) => el('span', { class: 'idot ' + status, title: title || STATUS[status] || status });
  const alertBadge = (alerts) => {
    if (!alerts || !alerts.length) return null;
    const danger = alerts.some((a) => a.level === 'danger');
    return el('span', { class: 'pill ' + (danger ? 'off' : 'warn'), title: alerts.map((a) => a.text).join(' · ') }, alerts.length === 1 ? alerts[0].text.slice(0, 28) : alerts.length + ' تنبيهات');
  };
  const bar = (p, label) => el('div', { class: 'ibar' + (p !== null && p > 85 ? ' bad' : p !== null && p > 70 ? ' warn' : ''), title: label || '' },
    el('div', { class: 'ibar-fill', style: 'width:' + (p ?? 0) + '%' }), el('span', { class: 'ibar-txt' }, p === null ? '—' : p + '٪'));
  const subDays = (n) => {
    if (!n.subscription_end) return null;
    const d = n.days_left;
    const cls = d < 0 ? 'off' : d <= 30 ? 'warn' : 'on';
    const txt = d < 0 ? 'منتهٍ منذ ' + (-d) + ' يومًا' : d === 0 ? 'ينتهي اليوم' : 'متبقٍ ' + d + ' يومًا';
    return el('span', { class: 'pill ' + cls }, txt);
  };

  // ---------- layout (same algorithm as src/lib/infra.js layoutColumns/placeNodes) ----------
  function layout(nodes) {
    const map = new Map(nodes.map((n) => [n.key, { ...n, children: [] }]));
    const roots = [];
    for (const n of map.values()) { const p = n.parent_key && map.get(n.parent_key); if (p && p !== n) p.children.push(n); else roots.push(n); }
    const order = (a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.key.localeCompare(b.key);
    const rec = (l) => { l.sort(order); l.forEach((n) => rec(n.children)); };
    rec(roots);
    return { roots, bands: roots.map((root) => { const columns = []; const walk = (n, d) => { (columns[d] ||= []).push(n.key); n.children.forEach((c) => walk(c, d + 1)); }; walk(root, 0); return { root: root.key, columns }; }) };
  }

  // ---------- tree ----------
  function tree() {
    const { roots } = layout(data.nodes);
    const setOpen = (g, open) => { g.classList.toggle('closed', !open); g.querySelector(':scope > .pkids').hidden = !open; if (open) closed.delete(g.dataset.key); else closed.add(g.dataset.key); };
    const row = (n) => {
      const lab = el('button', { class: 'inode' + (n.key === selected ? ' sel' : ''), type: 'button', title: n.key, on: { click: () => openNode(n.key) } },
        dot(n.status), el('span', { class: 'iicon', 'aria-hidden': 'true' }, ICON[n.kind] || '◼'), el('span', { class: 'plabel' }, n.name_ar),
        el('span', { class: 'pill kind' }, KIND[n.kind] || n.kind), n.external ? el('span', { class: 'pill' }, 'خارج المنظومة') : null, alertBadge(n.alerts),
        n.summary?.uptime_ar ? el('span', { class: 'muted small' }, 'يعمل منذ ' + n.summary.uptime_ar) : null);
      if (!n.children.length) return el('div', { class: 'pleaf', 'data-key': n.key }, lab);
      const g = el('div', { class: 'pgroup', 'data-key': n.key });
      const t = el('button', { class: 'ptoggle', type: 'button', 'aria-label': 'طيّ/فتح', on: { click: () => setOpen(g, g.classList.contains('closed')) } }, '▸');
      g.append(el('div', { class: 'prow' }, t, lab), el('div', { class: 'pkids' }, n.children.map(row)));
      if (closed.has(n.key)) setOpen(g, false);
      return g;
    };
    const box = el('div', { class: 'tree' }, roots.map((r) => el('section', { class: 'psys' }, row(r))));
    if (!data.nodes.length) box.append(el('p', { class: 'muted' }, 'لا توجد عقد بعد. أضف أول جهاز من زر «إضافة عقدة».'));
    return box;
  }

  // ---------- SVG map ----------
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'on') for (const [e, f] of Object.entries(v)) n.addEventListener(e, f); else n.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : String(c)); return n; };
  const LINK_STYLE = { lan: { stroke: '#0f8a6b', dash: '' }, internet: { stroke: '#64748b', dash: '' }, wireguard: { stroke: '#1e3a5f', dash: '7 4' }, tailscale: { stroke: '#bc9d59', dash: '2 4' }, usb: { stroke: '#7c3aed', dash: '1 3' } };
  function map() {
    const W = 172, H = 50, colW = 218, rowH = 66, gap = 54, pad = 16;
    const { bands } = layout(data.nodes);
    const pos = {}; let y0 = pad; let cols = 0;
    for (const b of bands) {
      let tallest = 0;
      b.columns.forEach((keys, col) => { keys.forEach((k, row) => { pos[k] = { col, row, y: y0 + row * rowH }; }); tallest = Math.max(tallest, keys.length); cols = Math.max(cols, b.columns.length); });
      y0 += tallest * rowH + gap;
    }
    const width = cols * colW + pad * 2, height = Math.max(y0 - gap + pad, 120);
    for (const p of Object.values(pos)) p.x = width - pad - (p.col + 1) * colW + (colW - W); // RTL: depth grows to the left
    const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'imap', role: 'img', 'aria-label': 'خريطة المنظومة' });
    const defs = svg('defs', {}, svg('marker', { id: 'iarrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0L10 5L0 10z', fill: '#94a3b8' })));
    root.append(defs);
    // band separators
    let yy = pad; bands.forEach((b, i) => { if (i) root.append(svg('line', { x1: pad, x2: width - pad, y1: yy - gap / 2, y2: yy - gap / 2, stroke: '#e2e8f0', 'stroke-dasharray': '4 6' })); yy += Math.max(...b.columns.map((c) => c.length)) * rowH + gap; });
    const center = (k) => ({ x: pos[k].x + W / 2, y: pos[k].y + H / 2 });
    const links = svg('g', { class: 'ilinks' });
    for (const l of data.links) {
      if (!pos[l.from_key] || !pos[l.to_key]) continue;
      const a = pos[l.from_key], b = pos[l.to_key], st = LINK_STYLE[l.kind] || LINK_STYLE.lan;
      let d, lx, ly;
      if (l.kind === 'lan' || l.kind === 'internet') { // tree edge: from the left side of the parent to the right side of the child
        const ax = a.x, ay = a.y + H / 2, bx = b.x + W, by = b.y + H / 2;
        d = `M${ax} ${ay} C${ax - 24} ${ay}, ${bx + 24} ${by}, ${bx} ${by}`; lx = (ax + bx) / 2; ly = (ay + by) / 2 - 5;
      } else { // overlay tunnel: curve between the bottom of the upper node and the top of the lower one
        const ca = center(l.from_key), cb = center(l.to_key);
        const [u, v] = ca.y <= cb.y ? [ca, cb] : [cb, ca];
        const bulge = Math.max(50, Math.abs(u.x - v.x) * 0.35);
        d = `M${u.x} ${u.y + H / 2} C${u.x + (u.x < v.x ? bulge : -bulge)} ${u.y + H / 2 + 30}, ${v.x + (u.x < v.x ? -bulge : bulge)} ${v.y - H / 2 - 30}, ${v.x} ${v.y - H / 2}`;
        lx = (u.x + v.x) / 2; ly = (u.y + v.y) / 2;
      }
      const p = svg('path', { d, fill: 'none', stroke: st.stroke, 'stroke-width': 1.8, 'stroke-dasharray': st.dash, 'marker-end': 'url(#iarrow)' }, svg('title', {}, LINK[l.kind] + (l.label_ar ? ' · ' + l.label_ar : '')));
      links.append(p);
      if (l.label_ar) links.append(svg('text', { x: lx, y: ly, class: 'ilbl', 'text-anchor': 'middle' }, l.label_ar));
    }
    root.append(links);
    const nodes = svg('g', { class: 'inodes' });
    for (const n of data.nodes) {
      const p = pos[n.key]; if (!p) continue;
      const g = svg('g', { class: 'in ' + n.status + (n.key === selected ? ' sel' : '') + (n.external ? ' ext' : ''), transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button',
        on: { click: () => openNode(n.key), keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNode(n.key); } } } },
        svg('title', {}, n.name_ar + ' · ' + (KIND[n.kind] || n.kind) + ' · ' + STATUS[n.status] + (n.alerts.length ? '\n' + n.alerts.map((a) => a.text).join('\n') : '') + '\n' + n.key),
        svg('rect', { width: W, height: H, rx: 10 }),
        svg('circle', { cx: W - 14, cy: 14, r: 5, class: 'idot-svg' }),
        svg('text', { x: W - 26, y: 20, class: 'iname', 'text-anchor': 'end' }, n.name_ar.length > 24 ? n.name_ar.slice(0, 23) + '…' : n.name_ar),
        svg('text', { x: W - 26, y: 38, class: 'ikind', 'text-anchor': 'end' }, (ICON[n.kind] || '') + ' ' + (KIND[n.kind] || n.kind) + (n.local_ip || n.public_ip ? ' · ' + (n.local_ip || n.public_ip) : '')));
      if (n.alerts.length) g.append(svg('circle', { cx: 14, cy: 14, r: 8, class: 'ialert ' + (n.alerts.some((a) => a.level === 'danger') ? 'danger' : 'warn') }), svg('text', { x: 14, y: 18, class: 'ialert-n', 'text-anchor': 'middle' }, n.alerts.length));
      nodes.append(g);
    }
    root.append(nodes);
    const legend = el('div', { class: 'ilegend' },
      ...Object.entries(LINK).filter(([k]) => k !== 'usb').map(([k, t]) => el('span', {}, el('i', { class: 'iline', style: `border-top-color:${LINK_STYLE[k].stroke};border-top-style:${LINK_STYLE[k].dash ? 'dashed' : 'solid'}` }), t)),
      el('span', {}, dot('up'), 'يعمل'), el('span', {}, dot('down'), 'متوقف'), el('span', {}, dot('unknown'), 'غير معروف'),
      el('span', { class: 'muted' }, 'التدفق من اليمين (الإنترنت) إلى اليسار (الأجهزة). انقر عقدة لفتح بطاقتها.'));
    return el('div', { class: 'imap-wrap' }, el('div', { class: 'imap-scroll' }, root), legend);
  }

  // ---------- services (Details composition) ----------
  function services() {
    const sysName = (k) => (k ? (data.systems.find((s) => s.key === k)?.name_ar || k) : '—');
    const nodeName = (k) => byKey.get(k)?.name_ar || k;
    const sysOpts = Object.fromEntries([['', '— بلا نظام —'], ...data.systems.map((s) => [s.key, s.name_ar])]);
    const nodeOpts = Object.fromEntries(data.nodes.map((n) => [n.key, n.name_ar]));
    const form = el('div', { class: 'form', hidden: true });
    const openForm = (s) => {
      const f = (k, ph, dir) => el('input', { name: k, value: s?.[k] ?? '', placeholder: ph || '', dir: dir || 'rtl' });
      form.replaceChildren(
        el('label', {}, 'الجهاز', select('node_key', nodeOpts, s?.node_key || selected || data.nodes[0]?.key)),
        el('label', {}, 'اسم الخدمة', f('name_ar', 'مثال: نظام ديتيلز WMS')), el('label', {}, 'النظام في البوابة', select('system_key', sysOpts, s?.system_key || '')),
        el('label', {}, 'المنفذ', f('port', '3200', 'ltr')), el('label', {}, 'وحدة systemd', f('unit_name', 'name.service', 'ltr')), el('label', {}, 'الرابط', f('url', 'https://…', 'ltr')),
        el('label', {}, 'ملاحظات', f('notes')), el('label', {}, 'الترتيب', f('sort', '100', 'ltr')),
        el('div', { class: 'toolbar' }, el('button', { class: 'btn primary', type: 'button', on: { click: async () => {
          const body = {}; form.querySelectorAll('input,select').forEach((i) => { body[i.name] = i.value; });
          await run(() => (s ? api('/api/admin/infra/services/' + s.id, body, 'PUT') : api('/api/admin/infra/services', body)), 'تم الحفظ');
          form.hidden = true; await reload();
        } } }, s ? 'حفظ' : 'إضافة'), el('button', { class: 'btn', type: 'button', on: { click: () => { form.hidden = true; } } }, 'إلغاء')));
      form.hidden = false;
    };
    const rows = data.services.slice().sort((a, b) => sysName(a.system_key).localeCompare(sysName(b.system_key)) || a.node_key.localeCompare(b.node_key) || a.sort - b.sort).map((s) => el('tr', {},
      el('td', {}, sysName(s.system_key)), el('td', {}, el('button', { class: 'link', type: 'button', on: { click: () => { openNode(s.node_key); switchTo('tree'); } } }, nodeName(s.node_key))),
      el('td', {}, s.name_ar), el('td', { class: 'ltr' }, s.port ?? ''), el('td', { class: 'ltr' }, s.unit_name || ''),
      el('td', { class: 'ltr' }, s.url ? el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.url) : ''), el('td', {}, s.notes || ''),
      el('td', {}, el('button', { class: 'btn small', on: { click: () => openForm(s) } }, 'تعديل'), ' ',
        el('button', { class: 'btn small danger', on: { click: async () => { if (!confirm('حذف الخدمة «' + s.name_ar + '»؟')) return; await run(() => api('/api/admin/infra/services/' + s.id, {}, 'DELETE'), 'تم الحذف'); await reload(); } } }, 'حذف'))));
    return el('div', {}, el('p', { class: 'muted' }, 'أي نظام يعمل على أي جهاز وبأي منفذ ووحدة systemd. الحالة الحيّة لكل وحدة تظهر في بطاقة الجهاز عندما يرسل وكيله تقريره.'),
      el('div', { class: 'toolbar' }, el('button', { class: 'btn primary', on: { click: () => openForm(null) } }, 'إضافة خدمة')), form,
      table(['النظام', 'الجهاز', 'الخدمة', 'المنفذ', 'وحدة systemd', 'الرابط', 'ملاحظات', ''], rows));
  }

  // ---------- mini sparkline (mem % or load1 over time) ----------
  function sparkline(points, pick, max) {
    const W = 220, H = 36, pad = 2;
    const vals = points.map((p) => pick(p)).map((v) => (v == null ? null : Number(v)));
    const known = vals.filter((v) => v != null);
    if (!known.length) return el('p', { class: 'muted small' }, 'لا سجلات كافية بعد.');
    const top = max || Math.max(...known, 1);
    const stepX = (W - pad * 2) / Math.max(1, vals.length - 1);
    let d = ''; vals.forEach((v, i) => { if (v == null) return; const x = pad + i * stepX, y = H - pad - (Math.min(v, top) / top) * (H - pad * 2); d += (d ? 'L' : 'M') + x + ' ' + y; });
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'ispark' }, svg('path', { d, fill: 'none', stroke: '#0f8a6b', 'stroke-width': 1.6 }));
    return el('div', { class: 'ispark-wrap' }, root);
  }

  // ---------- resources dashboard: all live-agent nodes at a glance ----------
  function resources(resData) {
    if (!resData.nodes.length) return el('p', { class: 'muted' }, 'لا توجد أجهزة عليها وكيل بعد.');
    const cards = resData.nodes.map((n) => {
      const p = n.summary, hist = resData.history[n.key] || [];
      const memP = p?.mem_pct ?? null;
      const body = [
        el('div', { class: 'ihead' }, dot(n.status), el('h3', {}, (ICON[n.kind] || '') + ' ' + n.name_ar), el('span', { class: 'spacer' }),
          el('button', { class: 'btn small', on: { click: () => { location.hash = '#node=' + n.key; switchTo('tree'); } } }, 'التفاصيل')),
        p ? el('dl', { class: 'iinfo' },
          el('div', { class: 'ikv' }, el('dt', {}, 'الذاكرة'), el('dd', {}, bar(memP))),
          el('div', { class: 'ikv' }, el('dt', {}, 'الحِمل'), el('dd', { class: 'ltr' }, (p.load || []).map((x) => Number(x).toFixed(2)).join(' · ') || '—')),
          el('div', { class: 'ikv' }, el('dt', {}, 'وقت التشغيل'), el('dd', {}, p.uptime_ar || '—')),
          p.disk_max_pct != null ? el('div', { class: 'ikv' }, el('dt', {}, 'أعلى قرص'), el('dd', {}, bar(p.disk_max_pct))) : null)
          : el('p', { class: 'muted small' }, 'لا تقرير بعد.'),
        el('h4', { class: 'small' }, 'الذاكرة خلال 24 ساعة'), sparkline(hist, (x) => x.mem ? pct(x.mem.used, x.mem.total) : null, 100),
        n.last_report ? el('p', { class: 'muted small' }, 'آخر تقرير ' + fmt(n.last_report)) : null,
      ];
      return el('div', { class: 'icard' + (n.status !== 'up' ? ' off' : '') }, body);
    });
    return el('div', { class: 'ires-grid' }, cards);
  }

  // ---------- node card ----------
  const panel = el('aside', { class: 'ipanel' });
  async function openNode(key, silent) {
    selected = key; store('dg_infra_node', key);
    if (!silent) { document.querySelectorAll('.inode.sel, .in.sel').forEach((x) => x.classList.remove('sel')); document.querySelectorAll(`[data-key="${CSS.escape(key)}"] > .inode, [data-key="${CSS.escape(key)}"] > .prow > .inode`).forEach((x) => x.classList.add('sel')); }
    panel.replaceChildren(el('p', { class: 'muted' }, 'جارٍ التحميل…'));
    let d;
    try { d = await api('/api/admin/infra/node/' + encodeURIComponent(key)); } catch (e) { panel.replaceChildren(el('div', { class: 'err' }, e.message)); return; }
    panel.replaceChildren(...card(d));
    if (!silent && window.innerWidth < 900) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function card(d) {
    const n = d.node, p = d.status?.payload, live = p && !p.probe;
    const kv = (k, v, ltr) => (v === null || v === undefined || v === '' ? null : el('div', { class: 'ikv' }, el('dt', {}, k), el('dd', { class: ltr ? 'ltr' : '' }, v)));
    const head = el('div', { class: 'ihead' }, dot(n.status), el('h3', { title: n.key }, (ICON[n.kind] || '') + ' ' + n.name_ar),
      el('span', { class: 'pill kind' }, KIND[n.kind] || n.kind), el('span', { class: 'pill ' + (n.status === 'up' ? 'on' : n.status === 'down' ? 'off' : '') }, STATUS[n.status]),
      n.external ? el('span', { class: 'pill' }, 'خارج المنظومة') : null,
      el('span', { class: 'spacer' }), el('button', { class: 'btn small', on: { click: () => nodeForm(n) } }, 'تعديل'));
    const alerts = d.alerts.length ? el('ul', { class: 'ialerts' }, d.alerts.map((a) => el('li', { class: a.level }, a.text))) : el('p', { class: 'muted small' }, 'لا تنبيهات.');
    const subTxt = n.subscription_end ? el('span', {}, (n.plan ? n.plan + ' · ' : '') + 'ينتهي ' + n.subscription_end + ' ', subDays(n)) : n.plan;
    const info = el('dl', { class: 'iinfo' },
      kv('الموديل', n.model), kv('المزود', n.provider), kv('الاشتراك', subTxt), kv('مصدر الحالة', SOURCE[n.status_source] + (n.status_at ? ' · آخر تحديث ' + fmt(n.status_at) : '')),
      kv('اسم المضيف', n.hostname, true), kv('نظام التشغيل', n.os, true), kv('اسم المستخدم', n.username, true),
      kv('IP عام', n.public_ip, true), kv('IP محلي', n.local_ip, true), kv('Tailscale', n.tailscale_ip, true), kv('WireGuard', n.wg_ip, true),
      (n.urls || []).length ? kv('الروابط', el('span', {}, n.urls.map((u, i) => [i ? ' · ' : null, el('a', { href: u.url, target: '_blank', rel: 'noopener', title: u.url }, u.label_ar || u.url)]))) : null,
      kv('ملاحظات', n.notes));
    const out = [head, alerts, info];
    if (live) {
      const memP = p.mem ? pct(p.mem.used, p.mem.total) : null;
      out.push(el('h4', {}, 'البيانات الحيّة', el('span', { class: 'muted small' }, ' · آخر تقرير ' + fmt(d.status.reported_at))),
        el('dl', { class: 'iinfo' },
          kv('وقت التشغيل', n.summary?.uptime_ar), kv('الحِمل (1/5/15 د)', (p.load || []).map((x) => Number(x).toFixed(2)).join(' · ') || null, true),
          p.mem ? kv('الذاكرة', el('div', {}, bar(memP, 'الذاكرة'), el('span', { class: 'muted small ltr' }, gb(p.mem.used) + ' / ' + gb(p.mem.total)))) : null,
          kv('نظام التشغيل (من الوكيل)', p.os, true),
          p.updates ? kv('التحديثات', (p.updates.count ? p.updates.count + ' تحديثات معلّقة' : 'لا تحديثات معلّقة') + (p.updates.reboot_required ? ' · يحتاج إعادة تشغيل' : '') + (p.updates.last_check ? ' · آخر فحص ' + fmt(p.updates.last_check) : '')) : null,
          p.wg ? kv('WireGuard', (p.wg.up ? 'يعمل' : 'متوقف') + ' · ' + p.wg.peers + ' نظير' + (p.wg.handshake_s != null ? ' · آخر مصافحة قبل ' + Math.round(p.wg.handshake_s / 60) + ' د' : '')) : null,
          p.tailscale ? kv('Tailscale', (p.tailscale.online ? 'متصل' : 'غير متصل') + (p.tailscale.ip ? ' · ' + p.tailscale.ip : '')) : null));
      if ((p.disks || []).length) out.push(el('h4', {}, 'الأقراص'), el('div', { class: 'idisks' }, p.disks.map((x) => el('div', { class: 'idisk' },
        el('span', { class: 'ltr' }, x.mount), bar(pct(x.used, x.size), x.mount), el('span', { class: 'muted small ltr' }, gb(x.used) + ' / ' + gb(x.size))))));
      if ((p.services || []).length) out.push(el('h4', {}, 'الخدمات (systemd)'), el('div', { class: 'isvcs' }, p.services.map((s) => el('span', { class: 'pill ' + (s.active ? 'on' : 'off'), title: s.active ? 'يعمل' : 'متوقف' }, s.name))));
      if ((d.history || []).length > 1) {
        out.push(el('h4', {}, 'سجل الذاكرة (آخر التقارير)'), sparkline(d.history, (x) => x.mem ? pct(x.mem.used, x.mem.total) : null, 100));
        out.push(el('h4', {}, 'سجل الحِمل (Load 1m)'), sparkline(d.history, (x) => x.load1, Math.max(1, ...d.history.map((x) => Number(x.load1) || 0))));
      }
    } else if (p && p.probe) {
      out.push(el('h4', {}, 'آخر فحص'), el('p', { class: 'muted small' }, fmt(d.status.reported_at) + ' · ' + (p.ok ? 'يستجيب' + (p.ms != null ? ' خلال ' + p.ms + ' ms' : '') : 'لا يستجيب') + (p.via ? ' · من ' + (byKey.get(p.via)?.name_ar || p.via) : '')));
    } else if (n.status_source === 'agent') {
      out.push(el('p', { class: 'note' }, 'لم يصل تقرير من الوكيل بعد. ثبّت الوكيل على الخادم: deploy/install-infra-agent.sh ' + n.key));
    }
    if (d.services.length) out.push(el('h4', {}, 'تكوين ديتيلز على هذا الجهاز'), el('ul', { class: 'ilist' }, d.services.map((s) => el('li', {},
      el('b', {}, s.name_ar), s.system_name ? ' (' + s.system_name + ')' : '', s.port ? el('span', { class: 'ltr muted' }, ' :' + s.port) : null,
      s.unit_name ? el('span', { class: 'ltr muted small' }, ' ' + s.unit_name) : null, s.url ? [' ', el('a', { href: s.url, target: '_blank', rel: 'noopener' }, 'فتح')] : null))));
    if (d.links.length) out.push(el('h4', {}, 'الوصلات'), el('ul', { class: 'ilist' }, d.links.map((l) => {
      const other = l.from_key === n.key ? { k: l.to_key, nm: l.to_name } : { k: l.from_key, nm: l.from_name };
      return el('li', {}, el('span', { class: 'pill kind' }, LINK[l.kind] || l.kind), ' ', el('button', { class: 'link', type: 'button', on: { click: () => openNode(other.k) } }, other.nm), l.label_ar ? el('span', { class: 'muted small' }, ' · ' + l.label_ar) : null,
        ' ', el('button', { class: 'btn small', title: 'تعديل', on: { click: () => linkForm(l) } }, '✎'), ' ',
        el('button', { class: 'btn small danger', title: 'حذف', on: { click: async () => { if (!confirm('حذف هذه الوصلة؟')) return; await run(() => api('/api/admin/infra/links/' + l.id, {}, 'DELETE'), 'تم الحذف'); await reload(); } } }, '✕'));
    })));
    out.push(el('div', { class: 'toolbar' }, el('button', { class: 'btn small', on: { click: () => linkForm(null, n.key) } }, 'إضافة وصلة')));
    // secrets
    out.push(el('h4', {}, 'الأسرار (بيانات الدخول)', el('span', { class: 'muted small' }, ' · الكشف والتعديل برمز يُرسل إلى بريدك')));
    if (!d.secrets_enabled) out.push(el('p', { class: 'note' }, 'مفتاح تشفير الأسرار (SECRETS_KEY) غير مهيأ في الخادم؛ أضفه في /etc/details-gateway/env ثم أعد تشغيل الخدمة.'));
    out.push(d.secrets.length ? el('ul', { class: 'ilist isecrets' }, d.secrets.map((s) => el('li', {},
      el('b', {}, s.label_ar), s.username ? el('span', { class: 'ltr muted' }, ' · ' + s.username) : null, el('span', { class: 'muted small' }, ' · حُدّث ' + fmt(s.updated_at)), ' ',
      el('button', { class: 'btn small primary', disabled: !d.secrets_enabled, on: { click: () => secretModal('reveal', s, n) } }, 'كشف'), ' ',
      el('button', { class: 'btn small', disabled: !d.secrets_enabled, on: { click: () => secretModal('edit', s, n) } }, 'تعديل'), ' ',
      el('button', { class: 'btn small danger', on: { click: () => secretModal('delete', s, n) } }, 'حذف')))) : el('p', { class: 'muted small' }, 'لا أسرار مسجلة لهذه العقدة.'));
    out.push(el('div', { class: 'toolbar' }, el('button', { class: 'btn small', disabled: !d.secrets_enabled, on: { click: () => secretModal('create', null, n) } }, 'إضافة سر')));
    if (d.reveals.length) out.push(el('details', {}, el('summary', { class: 'muted small' }, 'آخر عمليات الكشف (' + d.reveals.length + ')'),
      el('ul', { class: 'ilist small' }, d.reveals.map((r) => el('li', {}, fmt(r.at) + ' · ' + r.full_name + ' (' + r.employee_no + ') · ' + r.label_ar + (r.ip ? ' · ' + r.ip : ''))))));
    return out;
  }

  // ---------- node add/edit form (modal) ----------
  function modal(title, body, { wide } = {}) {
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const box = el('div', { class: 'imodal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'imodal-head' }, el('h3', {}, title), el('button', { class: 'btn small', type: 'button', 'aria-label': 'إغلاق', on: { click: close } }, '✕')), body);
    const ov = el('div', { class: 'ioverlay', on: { click: (e) => { if (e.target === ov) close(); } } }, box);
    document.body.append(ov); document.addEventListener('keydown', esc);
    return { close, box };
  }
  function nodeForm(n) {
    const isNew = !n;
    const parents = Object.fromEntries([['', '— جذر —'], ...data.nodes.filter((x) => !n || x.key !== n.key).map((x) => [x.key, x.name_ar])]);
    const inp = (k, ph, dir, type) => el('input', { name: k, value: n?.[k] ?? '', placeholder: ph || '', dir: dir || 'rtl', type: type || 'text' });
    const urls = el('textarea', { name: 'urls', placeholder: 'سطر لكل رابط: الاسم | https://…' }, (n?.urls || []).map((u) => u.label_ar + ' | ' + u.url).join('\n'));
    const f = el('form', { class: 'form iform' },
      isNew ? el('label', {}, 'المفتاح التقني (لاتيني)', inp('key', 'office-nas', 'ltr')) : null,
      el('label', {}, 'الاسم العربي', inp('name_ar')), el('label', {}, 'النوع', select('kind', KIND, n?.kind || 'device')), el('label', {}, 'الأب في الشجرة', select('parent_key', parents, n?.parent_key || '')),
      el('label', {}, 'الترتيب', inp('sort', '100', 'ltr')), el('label', {}, 'الموديل / المواصفات', inp('model')), el('label', {}, 'المزود', inp('provider')),
      el('label', {}, 'نوع الاشتراك', inp('plan')), el('label', {}, 'انتهاء الاشتراك', inp('subscription_end', '', 'ltr', 'date')),
      el('label', {}, 'مصدر الحالة', select('status_source', SOURCE, n?.status_source || 'manual')), el('label', {}, 'الحالة (للمصدر اليدوي)', select('status', STATUS, n?.raw_status || n?.status || 'unknown')),
      el('label', {}, 'IP عام', inp('public_ip', '', 'ltr')), el('label', {}, 'IP محلي', inp('local_ip', '', 'ltr')), el('label', {}, 'Tailscale IP', inp('tailscale_ip', '', 'ltr')), el('label', {}, 'WireGuard IP', inp('wg_ip', '', 'ltr')),
      el('label', {}, 'اسم المضيف', inp('hostname', '', 'ltr')), el('label', {}, 'نظام التشغيل', inp('os', '', 'ltr')), el('label', {}, 'اسم المستخدم', inp('username', '', 'ltr')),
      el('label', { class: 'span2' }, 'الروابط', urls), el('label', { class: 'span2' }, 'ملاحظات', el('textarea', { name: 'notes', dir: 'rtl' }, n?.notes || '')),
      el('label', { class: 'inline' }, el('input', { type: 'checkbox', name: 'external', checked: !!n?.external }), ' خارج منظومة ديتيلز (للعلم فقط)'),
      el('div', { class: 'toolbar span2' }, el('button', { class: 'btn primary', type: 'submit' }, isNew ? 'إضافة' : 'حفظ'), el('button', { class: 'btn', type: 'button', on: { click: () => m.close() } }, 'إلغاء')));
    const m = modal(isNew ? 'إضافة عقدة' : 'تعديل ' + n.name_ar, f, { wide: true });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = {}; f.querySelectorAll('input,select,textarea').forEach((i) => { if (i.name) body[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
      body.urls = urls.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('|'); return i < 0 ? { label_ar: '', url: l } : { label_ar: l.slice(0, i).trim(), url: l.slice(i + 1).trim() }; });
      if (body.parent_key === '') body.parent_key = null;
      try {
        const r = await api(isNew ? '/api/admin/infra/node' : '/api/admin/infra/node/' + n.key, body, isNew ? 'POST' : 'PUT');
        toast('تم الحفظ'); m.close(); selected = isNew ? r.key : n.key; store('dg_infra_node', selected); await reload();
      } catch (e) { toast(e.message, true); }
    });
  }
  function linkForm(l, fromKey) {
    const opts = Object.fromEntries(data.nodes.map((x) => [x.key, x.name_ar]));
    const f = el('form', { class: 'form iform' },
      el('label', {}, 'من', select('from_key', opts, l?.from_key || fromKey || data.nodes[0]?.key)), el('label', {}, 'إلى', select('to_key', opts, l?.to_key || '')),
      el('label', {}, 'النوع', select('kind', LINK, l?.kind || 'lan')), el('label', {}, 'وصف (اختياري)', el('input', { name: 'label_ar', value: l?.label_ar || '' })),
      el('div', { class: 'toolbar span2' }, el('button', { class: 'btn primary', type: 'submit' }, l ? 'حفظ' : 'إضافة'), el('button', { class: 'btn', type: 'button', on: { click: () => m.close() } }, 'إلغاء')));
    const m = modal(l ? 'تعديل وصلة' : 'إضافة وصلة', f);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      try { await api(l ? '/api/admin/infra/links/' + l.id : '/api/admin/infra/links', body, l ? 'PUT' : 'POST'); toast('تم الحفظ'); m.close(); await reload(); }
      catch (e) { toast(e.message, true); }
    });
  }

  // ---------- secrets: OTP modal (reveal / create / edit / delete) ----------
  function secretModal(mode, s, n) {
    const titles = { reveal: 'كشف: ' + (s?.label_ar || ''), create: 'إضافة سر لـ ' + n.name_ar, edit: 'تعديل: ' + (s?.label_ar || ''), delete: 'حذف: ' + (s?.label_ar || '') };
    const body = el('div', { class: 'isecret' });
    const m = modal(titles[mode], body);
    const fields = mode === 'create' || mode === 'edit' ? el('div', { class: 'form iform' },
      el('label', {}, 'اسم السر (مثال: SSH root، لوحة Hostinger)', el('input', { name: 'label_ar', value: s?.label_ar || '' })),
      el('label', {}, 'اسم المستخدم', el('input', { name: 'username', value: s?.username || '', dir: 'ltr', autocomplete: 'off' })),
      el('label', { class: 'span2' }, mode === 'edit' ? 'القيمة الجديدة (اتركها فارغة لإبقاء القيمة الحالية)' : 'القيمة (كلمة المرور / المفتاح)', el('textarea', { name: 'secret', dir: 'ltr', autocomplete: 'off', spellcheck: 'false', rows: 2 }))) : null;
    const step = el('div', { class: 'istep' });
    const err = el('p', { class: 'err', hidden: true });
    body.append(fields, mode === 'delete' ? el('p', {}, 'سيُحذف هذا السر نهائيًا. يلزم رمز التحقق للمتابعة.') : null,
      el('p', { class: 'muted small' }, 'يُرسل رمز من 4 أرقام إلى بريدك، صالح 5 دقائق ولعملية واحدة.'), step, err);
    const showErr = (t) => { err.textContent = t || ''; err.hidden = !t; };
    const sendBtn = el('button', { class: 'btn primary', type: 'button', on: { click: () => send() } }, 'إرسال الرمز إلى بريدي');
    step.append(sendBtn);
    let boxes, resendTimer;
    async function send() {
      sendBtn.disabled = true; showErr('');
      let r;
      try { r = await api('/api/admin/infra/secrets/otp', {}); } catch (e) { showErr(e.message); sendBtn.disabled = false; return; }
      const digits = el('div', { class: 'digits' });
      const okBtn = el('button', { class: 'btn primary', type: 'button', disabled: true, on: { click: () => submit(boxes.value()) } }, mode === 'reveal' ? 'كشف' : mode === 'delete' ? 'حذف' : 'حفظ');
      const resend = el('button', { class: 'btn small', type: 'button', disabled: true, on: { click: () => { clearInterval(resendTimer); send(); } } }, 'إعادة الإرسال (60)');
      step.replaceChildren(el('p', {}, 'أُرسل الرمز إلى ' + r.email_masked), digits, el('div', { class: 'toolbar' }, okBtn, resend));
      boxes = digitBoxes(digits, 4, (v) => { okBtn.disabled = v.length !== 4; if (v.length === 4) submit(v); });
      let left = r.resend_after || 60;
      resendTimer = setInterval(() => { left--; resend.textContent = left > 0 ? 'إعادة الإرسال (' + left + ')' : 'إعادة الإرسال'; resend.disabled = left > 0; if (left <= 0) clearInterval(resendTimer); }, 1000);
      let busy = false;
      async function submit(code) {
        if (busy || code.length !== 4) return; busy = true; boxes.disable(true); showErr('');
        try {
          if (mode === 'reveal') {
            const d = await api('/api/admin/infra/secrets/' + s.id + '/reveal', { code });
            showValue(d);
          } else if (mode === 'delete') {
            await api('/api/admin/infra/secrets/' + s.id, { code }, 'DELETE'); toast('تم الحذف'); m.close(); openNode(n.key, true);
          } else {
            const b = { code }; fields.querySelectorAll('input,textarea').forEach((i) => { b[i.name] = i.value; });
            if (mode === 'create') { b.node_key = n.key; await api('/api/admin/infra/secrets', b); } else await api('/api/admin/infra/secrets/' + s.id, b, 'PUT');
            fields.querySelector('[name=secret]').value = ''; toast('تم الحفظ'); m.close(); openNode(n.key, true);
          }
        } catch (e) { showErr(e.message); boxes.disable(false); boxes.clear(); }
        busy = false;
      }
    }
    function showValue(d) {
      clearInterval(resendTimer);
      const copy = (txt, btn) => navigator.clipboard?.writeText(txt).then(() => { btn.textContent = 'تم النسخ'; setTimeout(() => { btn.textContent = 'نسخ'; }, 1500); }, () => toast('تعذر النسخ', true));
      const val = el('code', { class: 'ivalue', dir: 'ltr' }, d.secret);
      const cb = el('button', { class: 'btn small', type: 'button', on: { click: () => copy(d.secret, cb) } }, 'نسخ');
      const ub = el('button', { class: 'btn small', type: 'button', on: { click: () => copy(d.username || '', ub) } }, 'نسخ');
      const cnt = el('span', { class: 'pill warn' }, '60');
      body.replaceChildren(el('div', { class: 'ireveal' },
        d.username ? el('div', { class: 'ikv' }, el('dt', {}, 'اسم المستخدم'), el('dd', {}, el('code', { dir: 'ltr' }, d.username), ' ', ub)) : null,
        el('div', { class: 'ikv' }, el('dt', {}, d.label_ar), el('dd', {}, val, ' ', cb)),
        el('p', { class: 'muted small' }, 'تُخفى القيمة بعد ', cnt, ' ثانية. سُجّل هذا الكشف في سجل التدقيق.')));
      let left = d.show_s || 60;
      const t = setInterval(() => { left--; cnt.textContent = String(left); if (left <= 0) { clearInterval(t); val.textContent = '••••••••'; cb.disabled = true; setTimeout(() => m.close(), 800); } }, 1000);
      const obs = new MutationObserver(() => { if (!document.body.contains(body)) { clearInterval(t); obs.disconnect(); } });
      obs.observe(document.body, { childList: true });
    }
  }

  // ---------- frame: sub-tabs + main area + panel ----------
  const main = el('div', { class: 'imain' });
  const frame = el('div', { class: 'infra' }, main, panel);
  const tabs = el('nav', { class: 'subtabs' }, [['tree', 'الشجرة'], ['map', 'الخريطة'], ['resources', 'مراقبة الموارد'], ['services', 'تكوين ديتيلز']].map(([k, t]) => el('button', { type: 'button', class: k === sub ? 'on' : '', 'data-sub': k, on: { click: () => switchTo(k) } }, t)));
  let resData = null;
  const alertsPill = el('span', { class: 'pill' });
  const head = el('div', { class: 'toolbar' }, tabs, el('span', { class: 'spacer' }), alertsPill,
    el('button', { class: 'btn small', on: { click: () => run(reload, 'تم التحديث') } }, 'تحديث'),
    el('button', { class: 'btn small primary', on: { click: () => nodeForm(null) } }, 'إضافة عقدة'));
  function switchTo(k) { sub = k; store('dg_infra_tab', k); tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.sub === k)); paintMain(); }
  async function paintMain() {
    const total = data.nodes.reduce((s, n) => s + n.alerts.length, 0);
    alertsPill.className = 'pill ' + (total ? 'off' : 'on'); alertsPill.textContent = total ? total + ' تنبيهات' : 'لا تنبيهات';
    frame.classList.toggle('full', sub === 'services' || sub === 'resources');
    if (sub === 'resources') {
      main.replaceChildren(el('p', { class: 'muted' }, 'جارٍ التحميل…'));
      try { resData = await api('/api/admin/infra/resources'); } catch (e) { main.replaceChildren(el('div', { class: 'err' }, e.message)); return; }
      if (sub !== 'resources') return; // تبويب تغيّر أثناء التحميل
      main.replaceChildren(resources(resData));
      return;
    }
    main.replaceChildren(sub === 'tree' ? tree() : sub === 'map' ? map() : services());
  }
  paintMain();
  if (selected && byKey.has(selected)) openNode(selected, true); else panel.replaceChildren(el('p', { class: 'muted' }, 'اختر جهازًا من الشجرة أو الخريطة لعرض بطاقته.'));
  const auto = setInterval(() => { if (!document.body.contains(frame)) return clearInterval(auto); reload().catch(() => {}); }, 120000);
  return [el('p', { class: 'muted' }, 'شجرة الأجهزة وخريطة المنظومة تُرسمان من القاعدة. الخوادم التي عليها وكيل ترسل تقريرها كل دقيقتين؛ الأجهزة الأخرى تُفحص بالـ ping من خادم المكتب. الأسرار مشفّرة ولا تُكشف إلا برمز يُرسل إلى بريدك ويُسجَّل كل كشف.'), head, frame];
};
