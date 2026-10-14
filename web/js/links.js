// الروابط السريعة: جدول بأعمدة لكل تصنيف (رأس قابل للطي بالعدد)، المثبّت أولًا، بحث في كل الأعمدة؛ النقر يمر عبر /links/go/:id ليُسجَّل.
// الإضافة/التعديل/الحذف/التثبيت/الترتيب وسجل الاستخدام للمشرف العام فقط. النموذج والنافذة تُنشأ عند الحاجة فقط (لا حاويات فارغة ولا خلفية معتمة عند التحميل).
'use strict';
(async function () {
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k === 'on') for (const [e, f] of Object.entries(v)) n.addEventListener(e, f); else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k !== '' && k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  };
  let data = { links: [], top_month: [], admin: false };
  let skew = 0;
  const PRI = { normal: ['عادي', 'pri-normal'], important: ['مهم', 'pri-important'], critical: ['حرج', 'pri-critical'] };
  const AUD = { all: 'الكل', staff: 'الموظفون', admins: 'المدراء' };
  const host = (u) => { try { return new URL(u).host; } catch { return u; } };
  const favicon = (u) => 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host(u)) + '&sz=64';
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—');
  const daysAgo = (iso) => {
    if (!iso) return '';
    const d = Math.floor(Math.max(0, Date.now() - skew - new Date(iso).getTime()) / 86400000);
    return d === 0 ? 'اليوم' : d === 1 ? 'منذ يوم' : d === 2 ? 'منذ يومين' : d <= 10 ? 'منذ ' + d + ' أيام' : 'منذ ' + d + ' يومًا';
  };
  const daysLeft = (ymd) => { if (!ymd) return null; return Math.ceil((new Date(ymd + 'T00:00:00+03:00').getTime() - (Date.now() - skew)) / 86400000); };
  const toast = (msg, bad) => { const t = el('div', { class: 'toast' + (bad ? ' bad' : '') }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  let collapsed = new Set(read('dg_links_collapsed', []));

  // ---------- favicon with fallback initial ----------
  const icon = (l) => {
    const box = el('span', { class: 'ql-ico', 'aria-hidden': 'true' });
    const img = el('img', { src: favicon(l.url), alt: '', loading: 'lazy', width: '20', height: '20' });
    img.addEventListener('error', () => { box.replaceChildren(el('b', {}, (l.title || '?').trim()[0] || '?')); });
    box.append(img);
    return box;
  };

  // ---------- modal (created on demand, removed on close) ----------
  function modal(title, ...body) {
    document.getElementById('overlay')?.remove();
    const ov = el('div', { class: 'ql-overlay', id: 'overlay' });
    const box = el('div', { class: 'ql-modal', role: 'dialog', 'aria-label': title },
      el('div', { class: 'ql-modal-head' }, el('h3', {}, title), el('button', { class: 'btn small', type: 'button', on: { click: close } }, 'إغلاق')), ...body);
    ov.append(box); document.body.append(ov);
    function close() { ov.remove(); }
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    return { box, close };
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.getElementById('overlay')?.remove(); });

  // ---------- admin form (in a modal) ----------
  function form(link) {
    const f = el('form', { class: 'cform ql-form' });
    const inp = (k, label, extra = {}) => { const i = el('input', { placeholder: label, value: link?.[k] ?? '', ...extra }); return [el('label', {}, label, i), i]; };
    const [cat, catI] = inp('category', 'التصنيف', { required: true, list: 'cats' });
    const [tit, titI] = inp('title', 'العنوان', { required: true });
    const [url, urlI] = inp('url', 'الرابط (https://…)', { required: true, dir: 'ltr' });
    const [notes, notesI] = inp('notes', 'الوصف');
    const [sort, sortI] = inp('sort', 'الترتيب', { type: 'number', value: link?.sort ?? 100 });
    const [exp, expI] = inp('expires_at', 'الصلاحية (انتهاء اختياري)', { type: 'date', value: link?.expires_at || '' });
    const sel = (opts, val) => { const s = el('select', {}, ...Object.entries(opts).map(([v, t]) => el('option', { value: v }, t))); s.value = val; return s; };
    const priority = sel(Object.fromEntries(Object.entries(PRI).map(([k, v]) => [k, v[0]])), link?.priority || 'normal');
    const audience = sel(AUD, link?.audience || (link?.access === 'admin' ? 'admins' : 'all'));
    const pinned = el('input', { type: 'checkbox' }); pinned.checked = !!link?.pinned;
    const cats = el('datalist', { id: 'cats' }, ...[...new Set(data.links.map((l) => l.category))].map((c) => el('option', { value: c })));
    f.append(cat, tit, el('div', { class: 'span2' }, url), notes, el('label', {}, 'الأهمية', priority), el('label', {}, 'مستوى الوصول', audience), exp, sort,
      el('label', { class: 'ql-check' }, el('span', {}, pinned, ' مثبّت في أعلى تصنيفه')), cats,
      el('div', { class: 'acts' }, el('button', { class: 'btn primary', type: 'submit' }, link ? 'حفظ التعديل' : 'إضافة'), el('button', { class: 'btn', type: 'button', on: { click: () => m.close() } }, 'إلغاء')));
    const m = modal(link ? 'تعديل «' + link.title + '»' : 'رابط جديد', f);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { category: catI.value, title: titI.value, url: urlI.value, notes: notesI.value, sort: +sortI.value, priority: priority.value, audience: audience.value, expires_at: expI.value || null, pinned: pinned.checked };
      try { await api(link ? '/api/admin/links/' + link.id : '/api/admin/links', body, link ? 'PUT' : 'POST'); m.close(); toast('تم الحفظ'); await load(); }
      catch (err) { toast(err.message, true); }
    };
    catI.focus();
  }
  const save = async (l, patch, msg) => { try { await api('/api/admin/links/' + l.id, { ...l, ...patch }, 'PUT'); if (msg) toast(msg); await load(); } catch (e) { toast(e.message, true); } };
  const move = async (l, dir) => { try { const r = await api('/api/admin/links/' + l.id + '/move', { dir }); if (r.moved) await load(); } catch (e) { toast(e.message, true); } };
  const remove = async (l) => { if (!confirm('حذف الرابط «' + l.title + '»؟')) return; try { await api('/api/admin/links/' + l.id, null, 'DELETE'); toast('تم الحذف'); await load(); } catch (e) { toast(e.message, true); } };
  const copy = async (l) => { try { await navigator.clipboard.writeText(l.url); toast('نُسخ الرابط'); } catch { prompt('انسخ الرابط:', l.url); } };

  // ---------- usage log modal (admin) ----------
  async function showLog(l) {
    const m = modal('سجل الاستخدام — ' + l.title, el('p', { class: 'muted' }, 'جارٍ التحميل…'));
    try {
      const d = await api('/api/admin/links/' + l.id + '/clicks');
      m.box.lastChild.replaceWith(el('p', { class: 'muted small' }, d.total + ' نقرة إجمالًا من ' + d.people + ' موظف · آخر 200 نقرة'),
        d.clicks.length ? el('div', { class: 'tablewrap' }, el('table', { class: 'dense' }, el('thead', {}, el('tr', {}, el('th', {}, 'الموظف'), el('th', {}, 'الرقم'), el('th', {}, 'الوقت'))),
          el('tbody', {}, ...d.clicks.map((c) => el('tr', {}, el('td', {}, c.full_name || '—'), el('td', { class: 'ltr' }, c.employee_no || '—'), el('td', { title: c.user_agent || '' }, fmtDT(c.clicked_at)))))))
          : el('p', { class: 'cempty' }, 'لم يُستخدم هذا الرابط بعد.'));
    } catch (e) { m.box.lastChild.replaceWith(el('div', { class: 'err' }, e.message)); }
  }

  // ---------- top of the month ----------
  function paintTop() {
    const t = $('top'); t.replaceChildren();
    if (!data.top_month.length) { t.hidden = true; return; }
    t.hidden = false;
    const max = data.top_month[0].clicks || 1;
    t.append(el('h2', {}, '⭐ الأكثر استخدامًا هذا الشهر'), el('ol', { class: 'ql-toplist' }, ...data.top_month.map((x, i) =>
      el('li', {}, el('a', { href: '/links/go/' + x.id, target: '_blank', rel: 'noopener', title: x.url }, el('span', { class: 'ql-rank' }, i + 1), icon(x), el('span', { class: 'ql-topname' }, x.title, el('small', {}, x.category))),
        el('span', { class: 'ql-topbar' }, el('span', { style: 'width:' + Math.max(6, Math.round(100 * x.clicks / max)) + '%' })), el('b', { class: 'ql-topn' }, x.clicks + ' نقرة')))));
  }

  // ---------- table rows ----------
  const COLS = ['الرابط', 'الأهمية', 'مستوى الوصول', 'الوصف', 'الصلاحية', 'الإنشاء', 'آخر استخدام', 'النقرات', 'إجراءات'];
  // اسم + تاريخ + «منذ N يوم» في سطر واحد (الرقم الوظيفي في التلميح) حتى يبقى الصف 40px
  const who = (name, no, at) => (at ? el('span', { class: 'ql-who', title: (name || '') + (no ? ' (' + no + ')' : '') + ' · ' + fmtDT(at) }, el('b', {}, name || '—'), el('small', {}, fmtDate(at) + ' · ' + daysAgo(at))) : el('span', { class: 'muted' }, 'لم يُستخدم بعد'));
  function row(l, idx, n) {
    const open = el('a', { class: 'ql-title', href: '/links/go/' + l.id, target: '_blank', rel: 'noopener', title: l.url }, icon(l), el('span', { class: 'ql-tt' }, el('b', {}, l.title), el('span', { class: 'ql-host' }, host(l.url))), l.pinned ? el('span', { class: 'ql-pin', title: 'مثبّت' }, '★') : '');
    open.addEventListener('click', () => { l.click_count = (l.click_count || 0) + 1; l.last_used_at = new Date(Date.now() - skew).toISOString(); setTimeout(() => render(), 400); });
    const left = daysLeft(l.expires_at);
    const expiry = !l.expires_at ? el('span', { class: 'muted' }, 'غير محدد')
      : el('span', { class: 'pill ' + (left < 0 ? 'exp-expired' : left <= 30 ? 'exp-expiring' : 'exp-ok'), title: l.expires_at }, fmtDate(l.expires_at) + (left < 0 ? ' · منتهٍ' : left <= 30 ? ' · ' + left + ' يومًا' : ''));
    const acts = [
      el('a', { class: 'ql-ib', href: '/links/go/' + l.id, target: '_blank', rel: 'noopener', title: 'فتح' }, '↗'),
      el('button', { class: 'ql-ib', type: 'button', title: 'نسخ الرابط', on: { click: () => copy(l) } }, '⧉'),
    ];
    if (data.admin) acts.push(
      el('button', { class: 'ql-ib' + (l.pinned ? ' on' : ''), type: 'button', title: l.pinned ? 'إلغاء التثبيت' : 'تثبيت', on: { click: () => save(l, { pinned: !l.pinned }) } }, l.pinned ? '★' : '☆'),
      el('button', { class: 'ql-ib', type: 'button', title: 'رفع الترتيب', disabled: idx === 0, on: { click: () => move(l, 'up') } }, '▲'),
      el('button', { class: 'ql-ib', type: 'button', title: 'خفض الترتيب', disabled: idx === n - 1, on: { click: () => move(l, 'down') } }, '▼'),
      el('button', { class: 'ql-ib', type: 'button', title: 'سجل الاستخدام', on: { click: () => showLog(l) } }, '📋'),
      el('button', { class: 'ql-ib', type: 'button', title: 'تعديل', on: { click: () => form(l) } }, '✎'),
      el('button', { class: 'ql-ib danger', type: 'button', title: 'حذف', on: { click: () => remove(l) } }, '✕'));
    return el('tr', { class: (l.pinned ? 'pinned ' : '') + 'pri-' + (l.priority || 'normal') },
      el('td', { class: 'ql-c-link' }, open),
      el('td', {}, el('span', { class: 'pill ' + (PRI[l.priority]?.[1] || 'pri-normal') }, PRI[l.priority]?.[0] || 'عادي')),
      el('td', {}, AUD[l.audience] || 'الكل'),
      el('td', { class: 'ql-c-notes', title: l.notes || '' }, l.notes ? el('span', { class: 'ql-notes2' }, l.notes) : el('span', { class: 'muted' }, '—')),
      el('td', {}, expiry),
      el('td', {}, who(l.created_by_name, l.created_by_no, l.created_at)),
      el('td', {}, who(l.last_used_by_name, l.last_used_by_no, l.last_used_at)),
      el('td', { class: 'ql-c-n' }, el('span', { class: 'ql-count', title: l.my_last_used_at ? 'آخر استخدام لك: ' + fmtDT(l.my_last_used_at) : '' }, l.click_count || 0)),
      el('td', { class: 'ql-c-acts' }, el('span', { class: 'ql-acts' }, ...acts)));
  }
  const hay = (l) => [l.title, l.category, l.notes, l.url, PRI[l.priority]?.[0], AUD[l.audience], l.created_by_name, l.last_used_by_name, l.expires_at].filter(Boolean).join(' ').toLowerCase();
  function render() {
    const q = ($('q').value || '').trim().toLowerCase();
    const list = $('list'); list.replaceChildren();
    const cats = new Map();
    let shown = 0;
    for (const l of data.links) {
      if (q && !hay(l).includes(q)) continue;
      if (!cats.has(l.category)) cats.set(l.category, []);
      cats.get(l.category).push(l); shown++;
    }
    $('count').textContent = shown ? shown + ' رابط في ' + cats.size + ' تصنيف' : '';
    if (!cats.size) { list.append(el('p', { class: 'cempty' }, q ? 'لا توجد روابط مطابقة.' : 'لا توجد روابط بعد.')); return; }
    for (const [cat, links] of cats) {
      links.sort((a, b) => (b.pinned - a.pinned) || (a.sort - b.sort) || a.title.localeCompare(b.title, 'ar')); // المثبّت أولًا
      const closed = collapsed.has(cat) && !q; // البحث يفتح كل التصنيفات
      const sec = el('section', { class: 'ql-cat' + (closed ? ' closed' : '') });
      const head = el('button', { class: 'ql-cathead', type: 'button', 'aria-expanded': String(!closed), on: { click: () => { if (collapsed.has(cat)) collapsed.delete(cat); else collapsed.add(cat); store('dg_links_collapsed', [...collapsed]); render(); } } },
        el('span', { class: 'ql-chev', 'aria-hidden': 'true' }, '▾'), el('h2', {}, cat), el('span', { class: 'ql-catn' }, links.length), el('span', { class: 'spacer' }),
        links.some((l) => l.pinned) ? el('span', { class: 'muted small' }, '★ ' + links.filter((l) => l.pinned).length + ' مثبّت') : '');
      const table = el('div', { class: 'tablewrap ql-tablewrap' }, el('table', { class: 'dense ql-table' },
        el('thead', {}, el('tr', {}, ...COLS.map((c) => el('th', {}, c)))),
        el('tbody', {}, ...links.map((l, i) => row(l, i, links.length)))));
      sec.append(head, table);
      list.append(sec);
    }
    $('expandall').textContent = collapsed.size ? 'فتح الكل' : 'طي الكل';
  }
  async function load() {
    try { data = await api('/api/links'); } catch (e) { $('list').replaceChildren(el('div', { class: 'err' }, e.message)); return; }
    skew = Date.now() - new Date(data.server_now).getTime();
    $('addbtn').hidden = !data.admin;
    paintTop(); render();
  }
  $('q').addEventListener('input', render);
  $('addbtn').addEventListener('click', () => form(null));
  $('expandall').addEventListener('click', () => { collapsed = collapsed.size ? new Set() : new Set(data.links.map((l) => l.category)); store('dg_links_collapsed', [...collapsed]); render(); });
  window.addEventListener('focus', () => { if (!document.getElementById('overlay')) load(); });
  await load();
})();
