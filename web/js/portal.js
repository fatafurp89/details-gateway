// Portal: cards from /api/me (only systems the employee may use)
'use strict';
(async function () {
  function tick() {
    const now = new Date();
    const g = now.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric' });
    const hj = now.toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric' });
    const wd = now.toLocaleDateString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', weekday: 'long' });
    const t = now.toLocaleTimeString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: true });
    const line = wd + ' · ' + hj + ' هـ · ' + g + ' م · ' + t;
    const today = document.getElementById('today');
    if (today) today.textContent = line;
    // توقيتات الدول التي يعمل منها الموظفون؛ يُبرز توقيت الدولة التي يدخل منها المستخدم (منطقة متصفحه لا الخادم)

  // أعلام دائرية بسيطة (SVG) بدل رموز الإيموجي التي لا تظهر كأعلام في ويندوز
  const FLAGS = {
    SA: '<svg viewBox="0 0 24 24"><rect width="24" height="24" fill="#0b8a3c"/><rect x="5" y="9" width="14" height="1.6" rx=".8" fill="#fff"/><rect x="6" y="15.4" width="12" height="1.4" rx=".7" fill="#fff"/></svg>',
    EG: '<svg viewBox="0 0 24 24"><rect width="24" height="8" fill="#ce1126"/><rect y="8" width="24" height="8" fill="#fff"/><rect y="16" width="24" height="8" fill="#111"/><circle cx="12" cy="12" r="2.2" fill="#c8a24a"/></svg>',
    PS: '<svg viewBox="0 0 24 24"><rect width="24" height="8" fill="#111"/><rect y="8" width="24" height="8" fill="#fff"/><rect y="16" width="24" height="8" fill="#0b8a3c"/><path d="M0 0 L12 12 L0 24Z" fill="#ce1126"/></svg>',
    YE: '<svg viewBox="0 0 24 24"><rect width="24" height="8" fill="#ce1126"/><rect y="8" width="24" height="8" fill="#fff"/><rect y="16" width="24" height="8" fill="#111"/></svg>',
  };
  const flagEl = (code) => { const i = document.createElement('i'); i.className = 'zflag'; i.innerHTML = FLAGS[code] || ''; return i; };
    const zonesEl = document.getElementById('zones');
    if (zonesEl) {
      const mine = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
      const off = (tz) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value; } catch { return ''; } };
      const myOff = off(mine);
      const zones = [
        { tz: 'Asia/Riyadh', name: 'السعودية', code: 'SA' },
        { tz: 'Africa/Cairo', name: 'مصر', code: 'EG' },
        { tz: 'Asia/Gaza', name: 'فلسطين', code: 'PS' },
        { tz: 'Asia/Aden', name: 'اليمن', code: 'YE' },
      ];
      const exact = zones.find((z) => z.tz === mine || (z.tz === 'Asia/Gaza' && mine === 'Asia/Hebron'));
      zonesEl.replaceChildren(...zones.map((z) => {
        const chip = document.createElement('span');
        const isMine = exact ? exact.tz === z.tz : (myOff && off(z.tz) === myOff && z.tz === 'Asia/Riyadh' ? mine.startsWith('Asia/') : false);
        chip.className = 'zone' + (isMine ? ' mine' : '');
        chip.title = isMine ? 'توقيت الدولة التي تدخل منها' : z.name;
        const nm = document.createElement('span'); nm.className = 'zn'; nm.textContent = z.name;
        const tm = document.createElement('b'); tm.className = 'zt'; tm.textContent = now.toLocaleTimeString('ar-SA-u-nu-latn', { timeZone: z.tz, hour: '2-digit', minute: '2-digit', hour12: true });
        chip.append(flagEl(z.code), nm, tm);
        return chip;
      }));
    }
  }
  tick(); setInterval(tick, 10000);

  let me;
  try { me = await api('/api/me'); } catch (e) {
    $('note').hidden = false; $('note').textContent = e.message || 'تعذر تحميل قائمة الأنظمة.'; return;
  }
  $('uname').textContent = me.employee.name;
  $('uno').textContent = '(' + me.employee.employee_no + ')';
  $('adminlink').hidden = me.employee.role !== 'admin';
  // صورة الموظف أو أحرفه الأولى
  const av = $('avatar');
  if (me.employee.photo_url) { const img = document.createElement('img'); img.src = me.employee.photo_url; img.alt = ''; av.replaceChildren(img); }
  else av.textContent = (me.employee.name || '').trim().split(/s+/).slice(0, 2).map((w) => w[0] || '').join('');
  // شارات: مدة الجلسة الحالية (تحديث حي) وآخر دخول سابق — الوحدات الصفرية لا تُعرض
  const span = (ms) => {
    let s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); s -= d * 86400; const hh = Math.floor(s / 3600); s -= hh * 3600; const mm = Math.floor(s / 60);
    const parts = []; if (d) parts.push(d + ' ' + (d === 1 ? 'يوم' : d === 2 ? 'يومان' : d <= 10 ? 'أيام' : 'يوم')); if (hh) parts.push(hh + ' ' + (hh === 1 ? 'ساعة' : hh === 2 ? 'ساعتان' : hh <= 10 ? 'ساعات' : 'ساعة')); if (mm) parts.push(mm + ' ' + (mm === 1 ? 'دقيقة' : mm === 2 ? 'دقيقتان' : mm <= 10 ? 'دقائق' : 'دقيقة'));
    return parts.length ? parts.join(' و') : 'أقل من دقيقة';
  };
  const skew = Date.now() - new Date(me.session.server_now).getTime();
  const started = new Date(me.session.started_at).getTime();
  const last = me.session.last_login_at ? new Date(me.session.last_login_at) : null;
  const fmtAbs = (dt) => dt.toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
  function badges() {
    const b = $('badges'); b.replaceChildren();
    const s1 = document.createElement('span'); s1.className = 'badge-time'; s1.title = 'مدة الجلسة الحالية'; s1.textContent = '⏱ ' + span(Date.now() - skew - started); b.append(s1);
    if (last) { const s2 = document.createElement('span'); s2.className = 'badge-time'; s2.title = 'آخر تسجيل دخول سابق: ' + fmtAbs(last); s2.textContent = '↩ آخر دخول قبل ' + span(Date.now() - skew - last.getTime()); b.append(s2); }
  }
  badges(); setInterval(badges, 30000);
  $('permslink').hidden = me.employee.role !== 'admin'; // الخادم يفرض ذلك أيضًا (مسارات الإدارة للمدير فقط)
  $('infralink').hidden = me.employee.role !== 'admin';

  const badgeText = { live: 'يعمل', soon: 'قيد التجهيز', off: 'متوقف مؤقتًا' };
  // أنظمة الرأس (placement = header، مثل «بوابة الموظف»): زر أيقونة صغير بجوار الاسم، يُفتح في تبويب جديد، لا بطاقة في الشبكة
  const headlinks = $('headlinks');
  for (const s of me.systems.filter((x) => x.placement === 'header' && x.href)) {
    const a = document.createElement('a');
    a.className = 'btn ghost headlink'; a.href = s.href; a.target = '_blank'; a.rel = 'noopener';
    a.title = (s.key === 'hr-portal' ? 'بوابتي — ' : '') + s.name + (s.description ? ' · ' + s.description : '');
    a.setAttribute('aria-label', s.name);
    const ic = document.createElement('span'); ic.className = 'hl-icon'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = s.icon || '◼';
    const tx = document.createElement('span'); tx.className = 'hl-text'; tx.textContent = s.key === 'hr-portal' ? 'بوابتي' : s.name;
    a.append(ic, tx);
    headlinks.append(a);
  }
  const grid = $('grid');
  const cards = new Map(); // key -> tile element (grid and compact), for the attention badges
  for (const s of me.systems.filter((x) => x.placement !== 'header')) {
    const a = document.createElement(s.href ? 'a' : 'div');
    a.className = 'card' + (s.href ? '' : ' disabled') + (s.placement === 'compact' ? ' compact' : ''); // compact: أيقونة واسم فقط (الروابط، المرفقات، الإعدادات)
    if (s.href) { a.href = s.href; a.target = '_blank'; a.rel = 'noopener'; } // كل الأنظمة تُفتح في تبويب جديد لتبقى البوابة مفتوحة
    const badge = document.createElement('span');
    badge.className = 'badge ' + (s.status || 'soon');
    badge.textContent = badgeText[s.status] || badgeText.soon;
    const icon = document.createElement('div');
    icon.className = 'icon'; icon.setAttribute('aria-hidden', 'true');
    // استخدم الأيقونة المخصصة إذا كانت موجودة (مثل mail, whatsapp، إلخ)، وإلا استخدم الرمز النصي
    if (s.icon && /^[a-z_]+$/.test(s.icon)) {
      const img = document.createElement('img');
      img.src = '/static/assets/details-2026/icons/' + s.icon + '.png';
      img.alt = s.name;
      img.style.width = img.style.height = '100%';
      img.style.objectFit = 'contain';
      icon.append(img);
    } else {
      icon.textContent = s.icon || '◼';
    }
    const h = document.createElement('h2'); h.textContent = s.name;
    const p = document.createElement('p'); p.textContent = s.description || '';
    a.append(badge, icon, h, p);
    cards.set(s.key, a);
    if (s.host) { const host = document.createElement('span'); host.className = 'host'; host.textContent = s.host; a.append(host); }
    grid.append(a);
    if (s.href && s.local_host && s.mode === 'proxy') probeLocal(a, s);
  }
  // شارات الانتباه: عدّاد أحمر (أو كهرماني للمنشأة) على الزاوية العلوية اليسرى لكل بطاقة، يختفي عند الصفر؛ التلميح = الوصف
  const fromLegacy = (tb) => { const o = {}; if (tb && tb.notifications > 0) o.notifications = { count: tb.notifications, label: 'إشعارات غير مقروءة', tone: 'red' }; if (tb && tb.company > 0) o.company = { count: tb.company, label: 'عناصر منتهية أو تنتهي خلال 30 يومًا', tone: 'amber' }; return o; };
  function applyBadges(badges) {
    for (const [key, card] of cards) {
      const info = badges && badges[key];
      let el = card.querySelector(':scope > .tile-badge');
      const n = info ? Math.floor(Number(info.count)) : 0;
      if (!(n > 0)) { if (el) el.remove(); continue; }
      if (!el) { el = document.createElement('span'); card.append(el); }
      const text = n > 99 ? '99+' : String(n);
      el.className = 'tile-badge' + (info.tone === 'amber' ? ' amber' : '');
      el.textContent = text;
      const tip = (info.label ? info.label + ': ' : '') + n;
      el.title = tip; el.setAttribute('aria-label', tip); el.setAttribute('role', 'status');
    }
  }
  applyBadges(me.badges && Object.keys(me.badges).length ? me.badges : fromLegacy(me.tiles_badges));
  if (me.build) { const v = $('ver'); if (v) v.textContent = 'v' + me.build.version + (me.build.built_at ? ' · ' + me.build.built_at : ''); }
  async function refreshBadges() { try { applyBadges((await api('/api/badges')).badges); } catch { /* keep the last values */ } }
  window.__refreshBadges = refreshBadges;
  setInterval(refreshBadges, 60000);
  window.addEventListener('focus', refreshBadges);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBadges(); });
  if (!me.systems.length) {
    $('note').hidden = false;
    $('note').textContent = 'لا توجد أنظمة مفعّلة لحسابك بعد. تواصل مع مدير النظام لمنحك الصلاحيات المناسبة.';
  }
})();

// Split-horizon without DNS tricks: if the office-local address answers from this browser, use it.
async function probeLocal(card, s) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 900);
  try {
    const r = await fetch('https://' + s.local_host + '/_probe', { mode: 'cors', cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
    if (r.ok) {
      card.href = 'https://' + s.local_host + '/';
      const host = card.querySelector('.host');
      if (host) host.textContent = s.local_host + ' · داخل المكتب';
    }
  } catch { /* not inside the office: keep the public link */ } finally { clearTimeout(t); }
}

// جرس الإشعارات: تبويبا «الأعمال» (الأول) و«التقنية» (لمن يملك صلاحيتها)؛ الشارة الحمراء = أعمال + تقنية (إن سُمح بها)
(function () {
  const wrap = document.getElementById('bellwrap'), bell = document.getElementById('bell'), menu = document.getElementById('bellmenu'), list = document.getElementById('belllist'), count = document.getElementById('bellcount');
  const tabsBar = document.getElementById('belltabs');
  if (!bell || !menu) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const SEV = { info: 'معلومة', warn: 'تنبيه', urgent: 'عاجل' };
  const TAB_AR = { work: 'الأعمال', technical: 'التقنية' };
  const TAB_KEY = 'gw.notif.tab';
  const readTab = () => { try { return localStorage.getItem(TAB_KEY); } catch { return null; } };
  const saveTab = (t) => { try { localStorage.setItem(TAB_KEY, t); } catch { /* التخزين المحلي غير متاح */ } };
  let access = { work: true, technical: false, details: false }, by = { work: 0, technical: 0 }, tab = null;
  const ago = (iso) => {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'الآن'; const m = Math.floor(s / 60); if (m < 60) return 'قبل ' + m + ' د'; const h = Math.floor(m / 60); if (h < 24) return 'قبل ' + h + ' س';
    return new Date(iso).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short' });
  };
  // أيقونة النظام: اسم ملف (human_resources…) = صورة صغيرة، وإلا رمز نصي؛ فشل التحميل = لا شيء
  const sysIcon = (icon) => {
    if (icon && /^[a-z][a-z0-9_-]*$/.test(icon)) {
      const img = document.createElement('img'); img.src = '/static/assets/details-2026/icons/' + icon + '.png'; img.alt = ''; img.width = img.height = 16; img.style.verticalAlign = 'middle';
      img.addEventListener('error', () => img.remove(), { once: true }); return img;
    }
    return document.createTextNode(icon || '');
  };
  const total = () => (access.work ? by.work : 0) + (access.technical ? by.technical : 0);
  function setCount() { const n = total(); count.hidden = !(n > 0); count.textContent = n > 99 ? '99+' : String(n || 0); bell.title = n > 0 ? n + ' إشعار غير مقروء' : 'الإشعارات'; }
  function pickTab() { const s = readTab(); return s && access[s] ? s : (access.work ? 'work' : (access.technical ? 'technical' : null)); }
  function applyState(d) {
    if (d.access) access = d.access; if (d.unread_by) by = d.unread_by;
    if (wrap) wrap.hidden = !(access.work || access.technical); // بلا أي صلاحية إشعارات: لا جرس
    if (!tab || !access[tab]) tab = pickTab();
    setCount(); renderTabs();
  }
  function renderTabs() {
    if (!tabsBar) return;
    tabsBar.replaceChildren();
    for (const t of ['work', 'technical']) {
      if (!access[t]) continue;
      const b = el('button', 'ntab' + (t === 'technical' ? ' tech' : ''));
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab === t));
      const c = el('span', 'ntab-count', by[t] > 99 ? '99+' : String(by[t] || 0)); c.hidden = !(by[t] > 0);
      b.append(TAB_AR[t], c);
      b.addEventListener('click', (e) => { e.stopPropagation(); if (tab === t) return; tab = t; saveTab(t); renderTabs(); loadList(); });
      tabsBar.append(b);
    }
  }
  async function refreshCount() { try { applyState(await api('/api/notifications/count')); } catch { /* keep the last value */ } }
  let seq = 0; // تبديل سريع بين التبويبين: آخر طلب فقط يرسم القائمة
  async function loadList() {
    const my = ++seq;
    if (!tab) { list.replaceChildren(el('p', 'muted', 'لا تملك صلاحية عرض الإشعارات.')); return; }
    let d;
    try { d = await api('/api/notifications?limit=10&category=' + tab); } catch (e) { if (my === seq) list.replaceChildren(el('p', 'err', e.message)); return; }
    if (my !== seq) return;
    applyState(d);
    list.replaceChildren();
    if (!d.notifications.length) { list.append(el('p', 'muted', tab === 'technical' ? 'لا توجد إشعارات تقنية.' : 'لا توجد إشعارات أعمال بعد.')); return; }
    for (const n of d.notifications) {
      const tech = n.category === 'technical';
      const a = el('a', 'bell-item sev-' + n.severity + (tech ? ' tech' : '') + (n.read_at ? '' : ' unread'));
      a.href = n.url || '/notifications'; a.target = n.url ? '_blank' : '_self'; a.rel = 'noopener';
      const top = el('div', 'bell-top'); const sys = el('span', 'bell-sys'); sys.append(tech ? document.createTextNode('🛠') : sysIcon(n.system_icon), ' ' + n.system_name); top.append(sys, el('span', 'bell-ago', ago(n.created_at)));
      a.append(top, el('b', null, n.title_ar));
      if (n.body_ar) a.append(el('small', null, n.body_ar));
      if (tech && n.meta && n.meta.todo) a.append(el('small', 'means', 'ما المطلوب؟ ' + n.meta.todo));
      if (n.severity !== 'info') a.append(el('span', 'pill sev ' + n.severity, SEV[n.severity]));
      a.addEventListener('click', () => { if (!n.read_at) { n.read_at = 'x'; api('/api/notifications/' + n.id + '/read', {}).then(refreshCount).catch(() => {}); a.classList.remove('unread'); } });
      list.append(a);
    }
  }
  async function openMenu() { menu.hidden = false; bell.setAttribute('aria-expanded', 'true'); await loadList(); }
  function closeMenu() { menu.hidden = true; bell.setAttribute('aria-expanded', 'false'); }
  bell.addEventListener('click', (e) => { e.stopPropagation(); if (menu.hidden) openMenu(); else closeMenu(); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  document.getElementById('bellreadall').addEventListener('click', async () => {
    try { await api('/api/notifications/read-all', { category: tab }); if (tab) by[tab] = 0; setCount(); renderTabs(); list.querySelectorAll('.unread').forEach((x) => x.classList.remove('unread')); } catch (e) { alert(e.message); }
  });
  refreshCount(); setInterval(refreshCount, 60000);
  window.addEventListener('focus', refreshCount);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCount(); });
})();
