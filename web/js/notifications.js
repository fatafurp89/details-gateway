// مركز الإشعارات: تبويبا «الأعمال» (الافتراضي) و«التقنية» (لمن يملك صلاحيتها)، قائمة مجمّعة حسب اليوم، تصفية بالنظام وغير المقروء
'use strict';
(async function () {
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k === 'on') for (const [e, f] of Object.entries(v)) n.addEventListener(e, f); else if (v != null) n.setAttribute(k, v); }
    for (const k of kids.flat()) if (k !== '' && k != null) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  };
  const SEV = { info: 'معلومة', warn: 'تنبيه', urgent: 'عاجل' };
  const DAY = { today: 'اليوم', yesterday: 'أمس', older: 'أقدم' };
  const TAB_AR = { work: 'الأعمال', technical: 'التقنية' };
  const EMPTY = {
    work: 'لا توجد إشعارات أعمال بعد. ستظهر هنا إشعارات الموارد البشرية والبريد وواتساب وبيانات المنشأة والملفات.',
    technical: 'لا توجد إشعارات تقنية. ستظهر هنا أخبار السيرفرات والنسخ الاحتياطي والأمان بلغة مبسّطة.',
  };
  const TAB_KEY = 'gw.notif.tab';
  const readTab = () => { try { return localStorage.getItem(TAB_KEY); } catch { return null; } };
  const saveTab = (t) => { try { localStorage.setItem(TAB_KEY, t); } catch { /* التخزين المحلي غير متاح */ } };
  const dayKey = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  const bucket = (iso, now) => {
    const d = new Date(iso); if (Number.isNaN(+d)) return 'older';
    if (dayKey(d) === dayKey(now)) return 'today';
    if (dayKey(d) === dayKey(new Date(+now - 86400000))) return 'yesterday';
    return 'older';
  };
  const fmt = (iso) => new Date(iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  let data = { notifications: [], systems: [], unread: 0 };
  let access = { work: true, technical: false, details: false };
  let counts = { work: 0, technical: 0 };
  let tab = 'work';
  let skew = 0;

  // أيقونة النظام: اسم ملف (human_resources…) يُعرض صورة من /static/assets/details-2026/icons، وغير ذلك رمز نصي؛ فشل التحميل يعود إلى 🔔
  const iconNode = (icon) => {
    if (icon && /^[a-z][a-z0-9_-]*$/.test(icon)) {
      const img = el('img', { src: '/static/assets/details-2026/icons/' + icon + '.png', alt: '', width: '26', height: '26' });
      img.addEventListener('error', () => img.replaceWith('🔔'), { once: true });
      return img;
    }
    return icon || '🔔';
  };
  function renderTabs() {
    const bar = $('ntabs'); bar.replaceChildren();
    for (const t of ['work', 'technical']) {
      if (!access[t]) continue;
      const c = counts[t] || 0;
      bar.append(el('button', { class: 'ntab' + (t === 'technical' ? ' tech' : ''), type: 'button', role: 'tab', 'aria-selected': String(tab === t), id: 'ntab-' + t, on: { click: () => switchTab(t) } },
        TAB_AR[t], el('span', { class: 'ntab-count', hidden: c > 0 ? null : '' }, c > 99 ? '99+' : String(c))));
    }
  }
  async function switchTab(t) {
    if (t === tab || !access[t]) return;
    tab = t; saveTab(t); $('fsys').value = ''; renderTabs(); await load();
  }
  async function markRead(n, node) {
    if (n.read_at) return;
    n.read_at = new Date().toISOString(); node.classList.remove('unread'); data.unread = Math.max(0, data.unread - 1);
    counts[tab] = Math.max(0, (counts[tab] || 0) - 1); renderTabs(); summary();
    try { await api('/api/notifications/' + n.id + '/read', {}); } catch { /* الواجهة فقط؛ الخادم يُحدَّث في المرة القادمة */ }
  }
  function summary() {
    const unread = counts[tab] || 0;
    $('summary').textContent = data.notifications.length ? data.notifications.length + ' إشعار · ' + (unread ? unread + ' غير مقروء' : 'الكل مقروء') : '';
    $('readall').disabled = !unread;
  }
  function item(n) {
    const tech = n.category === 'technical';
    const kids = [el('b', {}, n.title_ar), n.body_ar ? el('p', {}, n.body_ar) : ''];
    if (tech && (n.meta?.means || n.meta?.todo)) {
      kids.push(el('ul', { class: 'nplain' },
        n.meta.means ? el('li', {}, el('b', {}, 'ماذا يعني؟ '), n.meta.means) : '',
        n.meta.todo ? el('li', {}, el('b', {}, 'ما المطلوب؟ '), n.meta.todo) : ''));
    }
    if (tech && n.details) {
      const pre = el('pre', { class: 'ndetails', hidden: '' }, n.details);
      const tg = el('button', { class: 'linkbtn ndet-toggle', type: 'button', 'aria-expanded': 'false' }, 'التفاصيل التقنية');
      tg.addEventListener('click', (e) => { e.stopPropagation(); const open = pre.hidden; pre.hidden = !open; tg.setAttribute('aria-expanded', String(open)); tg.textContent = open ? 'إخفاء التفاصيل التقنية' : 'التفاصيل التقنية'; });
      tg.addEventListener('keydown', (e) => e.stopPropagation());
      kids.push(tg, pre);
    }
    kids.push(el('div', { class: 'nmeta' }, el('span', {}, n.system_name), el('span', {}, '·'), el('span', { title: n.created_at }, fmt(n.created_at)),
      n.severity !== 'info' ? el('span', { class: 'pill sev ' + n.severity }, SEV[n.severity]) : '',
      n.url ? el('span', { class: 'ltr muted' }, '↗') : ''));
    const node = el('div', { class: 'nitem sev-' + n.severity + (tech ? ' tech' : '') + (n.read_at ? '' : ' unread'), role: 'link', tabindex: '0', title: n.url ? 'فتح في تبويب جديد' : 'تعليم كمقروء' },
      el('span', { class: 'ndot', 'aria-hidden': 'true' }),
      el('div', { class: 'nicon', 'aria-hidden': 'true' }, tech ? '🛠' : iconNode(n.system_icon)),
      el('div', { class: 'nbody' }, kids));
    const act = () => { markRead(n, node); if (n.url) window.open(n.url, '_blank', 'noopener'); };
    node.addEventListener('click', act);
    node.addEventListener('keydown', (e) => { if (e.target === node && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); act(); } });
    return node;
  }
  function render() {
    const list = $('list'); list.replaceChildren();
    const now = new Date(Date.now() - skew);
    if (!data.notifications.length) { list.append(el('p', { class: 'cempty' }, $('funread').checked ? 'لا توجد إشعارات غير مقروءة.' : EMPTY[tab])); return; }
    const groups = new Map([['today', []], ['yesterday', []], ['older', []]]);
    for (const n of data.notifications) groups.get(bucket(n.created_at, now)).push(n);
    for (const [k, items] of groups) {
      if (!items.length) continue;
      list.append(el('h2', { class: 'nday' }, DAY[k], ' ', el('small', { class: 'muted' }, '(' + items.length + ')')));
      for (const n of items) list.append(item(n));
    }
  }
  let seq = 0; // الاستجابة المتأخرة لتبويب سابق (أو لتحديث عند عودة التركيز) لا تطمس التبويب الحالي
  async function load() {
    const my = ++seq;
    const q = new URLSearchParams({ limit: '200', category: tab });
    if ($('funread').checked) q.set('unread', '1');
    if ($('fsys').value) q.set('system', $('fsys').value);
    let d;
    try { d = await api('/api/notifications?' + q); } catch (e) { if (my === seq) $('list').replaceChildren(el('div', { class: 'err' }, e.message)); return; }
    if (my !== seq) return;
    data = d;
    access = data.access || access; counts = data.unread_by || counts;
    skew = Date.now() - new Date(data.server_now).getTime();
    const sel = $('fsys'); const cur = sel.value;
    sel.replaceChildren(el('option', { value: '' }, 'كل الأنظمة'), ...data.systems.map((s) => el('option', { value: s.key }, (/^[a-z][a-z0-9_-]*$/.test(s.icon || '') ? '' : (s.icon || '') + ' ') + s.name_ar)));
    sel.value = cur;
    renderTabs(); summary(); render();
  }
  $('fsys').addEventListener('change', load);
  $('funread').addEventListener('change', load);
  $('refresh').addEventListener('click', load);
  $('readall').addEventListener('click', async () => {
    try { await api('/api/notifications/read-all', { category: tab }); await load(); } catch (e) { alert(e.message); }
  });
  window.addEventListener('focus', load);

  // الصلاحيات والعدّادات أولًا ثم اختيار التبويب: المحفوظ إن كان مسموحًا، وإلا «الأعمال»
  try {
    const c = await api('/api/notifications/count');
    access = c.access; counts = c.unread_by;
  } catch (e) { $('list').replaceChildren(el('div', { class: 'err' }, e.message)); return; }
  const saved = readTab();
  tab = saved && access[saved] ? saved : (access.work ? 'work' : 'technical');
  renderTabs();
  await load();
})();
