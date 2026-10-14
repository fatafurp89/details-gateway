// Admin console: employees, grants, systems, sessions, logs, settings
'use strict';
(function () {
  const view = $('view');
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (k === 'class') n.className = v;
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined) n.append(c.nodeType ? c : String(c));
    return n;
  };
  const fmt = (d) => (d ? new Date(d).toLocaleString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'short' }) : '—');
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  function toast(msg, bad) {
    const t = el('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
    document.body.append(t); setTimeout(() => t.remove(), 3500);
  }
  const run = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); throw e; } };
  const table = (heads, rows) => el('div', { class: 'tablewrap' },
    el('table', { class: 'dense' }, el('thead', {}, el('tr', {}, heads.map((h) => el('th', {}, h)))), el('tbody', {}, rows)));
  const select = (name, opts, val) => el('select', { name }, Object.entries(opts).map(([v, t]) => el('option', { value: v, selected: v === String(val) }, t)));
  const ROLE = { user: 'مستخدم', admin: 'مدير' };
  const MODE = { proxy: 'proxy', link: 'link', internal: 'internal' };
  const STATUS = { live: 'يعمل', soon: 'قيد التجهيز', off: 'متوقف' };

  // ---- employees ----
  // سياسة: إنشاء الموظفين من البوابة غير مسموح؛ نظام الموارد البشرية هو المصدر الوحيد (يزامن عبر /_gw/employees/upsert).
  // هنا يُعدَّل فقط: الدور، الحالة، الانتهاء، ربط بريد جوجل.
  async function employees() {
    const list = await api('/api/admin/employees');
    const form = el('form', { class: 'form', hidden: true });
    let editing = null;
    const fields = [['employee_no', 'الرقم'], ['full_name', 'الاسم'], ['mobile', 'الجوال'], ['email', 'البريد'], ['google_email', 'بريد جوجل']];
    function openForm(e) {
      editing = e;
      form.replaceChildren(
        ...fields.map(([k, t]) => el('label', {}, t, el('input', { name: k, value: e?.[k] || '', dir: k === 'full_name' ? 'rtl' : 'ltr', readonly: k !== 'google_email', title: k === 'mobile' ? 'يُعدَّل من نظام الموارد البشرية — إليه يُرسل رمز التحقق عبر واتساب' : k !== 'google_email' ? 'يُعدَّل من نظام الموارد البشرية' : null }))),
        el('label', {}, 'الدور', select('role', ROLE, e?.role || 'user')),
        el('label', {}, 'الحالة', select('active', { true: 'نشط', false: 'معطل' }, e ? e.active : true)),
        el('label', {}, 'الانتهاء', el('input', { name: 'expires_at', type: 'date', value: day(e?.expires_at) })),
        el('div', { class: 'toolbar' }, el('button', { class: 'btn primary', type: 'submit' }, 'حفظ التعديل'),
          el('button', { class: 'btn', type: 'button', on: { click: () => { form.hidden = true; } } }, 'إلغاء')));
      form.hidden = false; form.querySelector('input[name=google_email]').focus();
    }
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!editing) return;
      const body = Object.fromEntries(new FormData(form));
      body.active = body.active === 'true';
      await run(() => api('/api/admin/employees/' + editing.id, body, 'PUT'), 'تم الحفظ');
      show('employees');
    });
    const search = el('input', { placeholder: 'بحث بالاسم أو الرقم أو البريد', on: { input: () => {
      const q = search.value.trim().toLowerCase();
      tbody.querySelectorAll('tr').forEach((tr) => { tr.hidden = q && !tr.textContent.toLowerCase().includes(q); });
    } } });
    const rows = list.map((e) => el('tr', {},
      el('td', {}, e.employee_no), el('td', {}, e.full_name), el('td', { class: 'ltr' }, e.mobile || ''), el('td', { class: 'ltr' }, e.email),
      el('td', { class: 'ltr' }, e.google_email || ''), el('td', {}, ROLE[e.role]),
      el('td', {}, el('span', { class: 'pill ' + (e.active ? 'on' : 'off') }, e.active ? 'نشط' : 'معطل')),
      el('td', {}, e.expires_at ? day(e.expires_at) : '—'), el('td', {}, fmt(e.last_login)),
      el('td', {}, el('button', { class: 'btn small', on: { click: () => openForm(e) } }, 'تعديل'), ' ',
        el('button', { class: 'btn small' + (e.active ? ' danger' : ''), on: { click: async () => {
          await run(() => api('/api/admin/employees/' + e.id, { ...e, active: !e.active, expires_at: day(e.expires_at) }, 'PUT'), 'تم التحديث');
          show('employees');
        } } }, e.active ? 'تعطيل' : 'تفعيل'))));
    const t = table(['الرقم', 'الاسم', 'الجوال', 'البريد', 'بريد جوجل', 'الدور', 'الحالة', 'الانتهاء', 'آخر دخول', ''], rows);
    const tbody = t.querySelector('tbody');
    return [el('div', { class: 'toolbar' }, search, el('span', { class: 'spacer' }),
      el('span', { class: 'muted small' }, 'إضافة الموظفين وبياناتهم الأساسية من نظام «الموارد البشرية» فقط (يزامن تلقائيًا)؛ هنا الدور والحالة والانتهاء وبريد جوجل.')), form, t];
  }

  // ---- grants matrix ----
  async function grants() {
    const d = await api('/api/admin/grants');
    const lv = new Map(d.grants.map((g) => [g.employee_id + ':' + g.system_key, g.level]));
    const rows = d.employees.map((e) => el('tr', {}, el('td', {}, e.employee_no), el('td', {}, e.full_name, e.role === 'admin' ? ' (مدير)' : ''),
      d.systems.map((s) => {
        const cur = lv.get(e.id + ':' + s.key);
        const use = el('input', { type: 'checkbox', checked: !!cur, title: 'يستخدم هذا النظام' });
        use.addEventListener('change', async () => {
          try { await run(() => api('/api/admin/grants', { employee_id: e.id, system_key: s.key, level: use.checked ? 'use' : null }, 'PUT'), 'تم الحفظ'); }
          catch { use.checked = !use.checked; }
        });
        return el('td', {}, el('div', { class: 'cell' }, el('label', {}, use, ' يستخدم')));
      })));
    return [el('p', { class: 'muted' }, 'صلاحية واحدة لكل نظام: هل يستطيع الموظف استخدامه أم لا. بوابة ديتيلز نفسها متاحة لكل الموظفين دون منح، والمشرف العام يرى كل الأنظمة. تفاصيل ما يراه الموظف داخل كل نظام في «شجرة الصلاحيات». التغيير يُحفظ فورًا ويُسجَّل في سجل التدقيق.'),
      table(['الرقم', 'الموظف', ...d.systems.map((s) => s.name_ar + ' (' + s.key + ')')], rows)];
  }

  // ---- systems: moved to «إعدادات النظام» (/settings#systems); this tab only points there ----
  async function systems() {
    return [el('div', { class: 'form' }, el('p', { style: 'margin:0' }, 'انتقل جدول الأنظمة والبطاقات إلى منصة «إعدادات النظام».'),
      el('div', { class: 'toolbar' }, el('a', { class: 'btn primary', href: '/settings#systems', target: '_blank', rel: 'noopener' }, 'فتح الأنظمة والبطاقات ↗'),
        el('a', { class: 'btn', href: '/settings', target: '_blank', rel: 'noopener' }, 'كل الإعدادات')))];
  }
  // (الجدول القديم أُبقي للرجوع؛ لم يعد يُستدعى)
  async function systemsLegacy() {
    const list = await api('/api/admin/systems');
    const row = (s, isNew) => {
      const inp = (k, w) => el('input', { name: k, value: s[k] ?? '', size: w || 12 });
      const tr = el('tr', {},
        el('td', {}, isNew ? inp('key', 8) : s.key), el('td', {}, inp('name_ar', 22)), el('td', {}, inp('description_ar', 30)),
        el('td', {}, inp('icon', 3)), el('td', { class: 'ltr' }, inp('host', 20)), el('td', {}, select('mode', MODE, s.mode || 'proxy')),
        el('td', { class: 'ltr' }, inp('upstream', 24)), el('td', {}, select('status', STATUS, s.status || 'soon')), el('td', {}, inp('sort', 3)),
        el('td', {}, select('placement', { grid: 'بطاقة', header: 'زر في الرأس', compact: 'بطاقة مضغوطة' }, s.placement || 'grid')),
        el('td', {}, el('button', { class: 'btn small primary', on: { click: async () => {
          const body = {}; tr.querySelectorAll('input,select').forEach((i) => { body[i.name] = i.value; });
          await run(() => (isNew ? api('/api/admin/systems', body) : api('/api/admin/systems/' + s.key, body, 'PUT')), 'تم الحفظ');
          show('systems');
        } } }, isNew ? 'إضافة' : 'حفظ')));
      return tr;
    };
    return [el('p', { class: 'muted' }, 'proxy: نطاق فرعي يحميه nginx (host) · link: رابط خارجي بتذكرة موقّعة (upstream) · internal: مسار داخل البوابة.'),
      table(['المفتاح', 'الاسم', 'الوصف', 'الأيقونة', 'host', 'النمط', 'upstream', 'الحالة', 'الترتيب', 'الموضع', ''],
        [...list.map((s) => row(s, false)), row({ sort: 100 }, true)])];
  }

  // ---- sessions ----
  async function sessions() {
    const list = await api('/api/admin/sessions');
    return [table(['الموظف', 'الرقم', 'بدأت', 'آخر نشاط', 'تنتهي', 'IP', 'المتصفح', ''], list.map((s) => el('tr', {},
      el('td', {}, s.full_name), el('td', {}, s.employee_no), el('td', {}, fmt(s.created_at)), el('td', {}, fmt(s.last_seen_at)),
      el('td', {}, fmt(s.expires_at)), el('td', { class: 'ltr' }, s.ip || ''), el('td', { class: 'ltr', title: s.user_agent || '' }, (s.user_agent || '').slice(0, 40)),
      el('td', {}, el('button', { class: 'btn small danger', on: { click: async () => {
        await run(() => api('/api/admin/sessions/' + s.id + '/revoke', {}), 'تم إبطال الجلسة'); show('sessions');
      } } }, 'إبطال')))))];
  }

  // ---- logs with filters ----
  function logView(path, heads, toRow, withOk) {
    return async function () {
      const q = el('input', { placeholder: 'بحث' });
      const from = el('input', { type: 'date' });
      const to = el('input', { type: 'date' });
      const ok = select('ok', { '': 'الكل', true: 'ناجحة', false: 'فاشلة' }, '');
      const box = el('div');
      const load = async () => {
        const p = new URLSearchParams({ q: q.value, from: from.value, to: to.value, ok: withOk ? ok.value : '' });
        const list = await run(() => api(path + '?' + p));
        box.replaceChildren(table(heads, list.map(toRow)));
      };
      await load();
      return [el('div', { class: 'toolbar' }, q, 'من', from, 'إلى', to, withOk ? ok : null,
        el('button', { class: 'btn primary', on: { click: load } }, 'تصفية')), box];
    };
  }
  const audit = logView('/api/admin/audit', ['الوقت', 'المنفذ', 'الإجراء', 'الهدف', 'تفاصيل', 'IP'], (a) => el('tr', {},
    el('td', {}, fmt(a.created_at)), el('td', {}, a.actor || '—'), el('td', { class: 'ltr' }, a.action), el('td', { class: 'ltr' }, a.target || ''),
    el('td', { class: 'ltr', title: JSON.stringify(a.meta) }, JSON.stringify(a.meta).slice(0, 60)), el('td', { class: 'ltr' }, a.ip || '')));
  const attempts = logView('/api/admin/attempts', ['الوقت', 'المعرّف', 'IP', 'النتيجة', 'السبب'], (a) => el('tr', {},
    el('td', {}, fmt(a.created_at)), el('td', { class: 'ltr' }, a.identifier), el('td', { class: 'ltr' }, a.ip || ''),
    el('td', {}, el('span', { class: 'pill ' + (a.ok ? 'on' : 'off') }, a.ok ? 'نجاح' : 'فشل')), el('td', { class: 'ltr' }, a.reason)), true);

  // ---- settings ----
  async function settings() {
    const s = await api('/api/admin/settings');
    const state = (on) => el('span', { class: 'pill ' + (on ? 'on' : 'off') }, on ? 'مضبوط' : 'غير مضبوط');
    return [el('div', { class: 'form' },
      el('div', {}, el('b', {}, 'البريد (SMTP) '), state(s.smtp.configured), el('p', { class: 'muted' }, 'الخادم: ' + s.smtp.host),
        el('button', { class: 'btn primary', disabled: !s.smtp.configured, on: { click: async (e) => {
          e.target.disabled = true;
          try { await run(() => api('/api/admin/settings/smtp-test', {}), 'أُرسلت رسالة اختبار إلى ' + s.admin_email); } catch { /* shown */ }
          e.target.disabled = false;
        } } }, 'إرسال رسالة اختبار إلى بريدي')),
      el('div', {}, el('b', {}, 'الدخول بحساب Google '), state(s.google.configured),
        el('p', { class: 'muted' }, 'القيم تُضبط في /etc/details-gateway/env ولا تظهر هنا.')),
      el('div', {}, el('b', {}, 'المنصة الكاملة '), el('a', { class: 'btn small primary', href: '/settings', target: '_blank', rel: 'noopener' }, 'إعدادات النظام ↗'),
        el('p', { class: 'muted' }, 'الهوية، الجلسات والأمان، البريد (كلمة المرور مشفّرة)، الإشعارات، النسخ الاحتياطي، مفاتيح الذكاء الاصطناعي.')))];
  }

  // ---- permissions tree (fine-grained layer under the grants matrix) ----
  const KIND = { system: 'نظام', module: 'وحدة', screen: 'شاشة', action: 'إجراء' };
  async function perms() {
    const d = await api('/api/admin/perms');
    const byKey = new Map(d.nodes.map((n) => [n.key, n]));
    const kids = new Map();
    for (const n of d.nodes) { if (n.parent_key && byKey.has(n.parent_key)) { if (!kids.has(n.parent_key)) kids.set(n.parent_key, []); kids.get(n.parent_key).push(n); } }
    const order = (a, b) => a.sort - b.sort || a.key.localeCompare(b.key);
    const roots = d.nodes.filter((n) => !n.parent_key || !byKey.has(n.parent_key)).sort(order);
    const branch = (key) => { const out = []; const walk = (k) => { const n = byKey.get(k); if (!n) return; if (n.present) out.push(k); for (const c of kids.get(k) || []) walk(c.key); }; walk(key); return out; };
    const isNew = (n) => n.present && !(n.grantees > 0);
    const present = () => d.nodes.filter((n) => n.present).length;

    let emp = null, allowed = new Set();
    const closed = new Set(); // branches the admin collapsed (kept across repaints)
    const newCount = el('span', { class: 'pill warn', title: 'عناصر موجودة في الأنظمة ولم تُمنح لأي موظف بعد' });
    const refreshNew = () => { const c = d.nodes.filter(isNew).length; newCount.textContent = 'عناصر جديدة لم تُمنح لأحد: ' + c; newCount.classList.toggle('on', c === 0); };
    refreshNew();

    // employee picker: search by number or name
    const empSearch = el('input', { placeholder: 'ابحث بالرقم أو الاسم', autocomplete: 'off' });
    const empSel = el('select');
    const fillEmp = () => {
      const q = empSearch.value.trim().toLowerCase();
      const list = d.employees.filter((e) => !q || e.employee_no.includes(q) || e.full_name.toLowerCase().includes(q));
      empSel.replaceChildren(el('option', { value: '' }, list.length ? '— اختر الموظف —' : 'لا نتائج'),
        ...list.map((e) => el('option', { value: e.id }, e.employee_no + ' · ' + e.full_name + (e.role === 'admin' ? ' (مشرف عام)' : '') + (e.active ? '' : ' (معطل)'))));
      if (emp && list.some((e) => e.id === emp.id)) empSel.value = emp.id;
    };
    fillEmp();
    empSearch.addEventListener('input', () => { fillEmp(); if (empSel.options.length === 2 && empSel.value !== empSel.options[1].value) { empSel.selectedIndex = 1; empSel.dispatchEvent(new Event('change')); } });

    const treeSearch = el('input', { placeholder: 'بحث في الشجرة (اسم الشاشة أو الزر)' });
    const onlyNew = el('input', { type: 'checkbox' });
    const copyBtn = el('button', { class: 'btn', type: 'button', disabled: true }, 'نسخ من موظف آخر');
    const setOpen = (group, open) => { group.classList.toggle('closed', !open); group.querySelector(':scope > .pkids').hidden = !open; if (open) closed.delete(group.dataset.key); else closed.add(group.dataset.key); };
    const expandAll = (open) => tree.querySelectorAll('.pgroup').forEach((g) => setOpen(g, open));
    const head = el('div', { class: 'toolbar' },
      el('label', { class: 'inline' }, 'الموظف ', empSearch), empSel, copyBtn,
      el('span', { class: 'spacer' }), newCount);
    const tools = el('div', { class: 'toolbar' }, treeSearch,
      el('label', { class: 'inline' }, onlyNew, ' الجديدة فقط'),
      el('button', { class: 'btn small', type: 'button', on: { click: () => expandAll(true) } }, 'فتح الكل'),
      el('button', { class: 'btn small', type: 'button', on: { click: () => expandAll(false) } }, 'طيّ الكل'));
    const notice = el('div', { class: 'note', hidden: true });
    const tree = el('div', { class: 'tree' });
    const stats = el('p', { class: 'muted' });

    const save = async (keys, on) => {
      if (!emp) { toast('اختر الموظف أولًا', true); return false; }
      const body = keys.length === 1 ? { employee_id: emp.id, perm_key: keys[0], allowed: on } : { employee_id: emp.id, perm_keys: keys, allowed: on };
      try { await api('/api/admin/perms', body, 'PUT'); }
      catch (e) { toast(e.message, true); return false; }
      for (const k of keys) {
        const had = allowed.has(k);
        if (on) allowed.add(k); else allowed.delete(k);
        const n = byKey.get(k); if (n && had !== on) n.grantees = Math.max(0, (n.grantees || 0) + (on ? 1 : -1));
      }
      refreshNew(); paint(); toast(on ? 'تم المنح' : 'تم الإلغاء');
      return true;
    };

    function nodeRow(n) {
      const locked = !emp || emp.role === 'admin' || !n.present;
      const cb = el('input', { type: 'checkbox', checked: emp?.role === 'admin' ? n.present : allowed.has(n.key), disabled: locked });
      cb.addEventListener('change', async () => { if (!(await save([n.key], cb.checked))) cb.checked = !cb.checked; });
      const lab = el('label', { class: 'pnode kind-' + n.kind, title: n.key },
        cb, el('span', { class: 'plabel' }, n.label_ar),
        el('span', { class: 'pill kind' }, KIND[n.kind] || n.kind),
        n.present ? null : el('span', { class: 'pill off' }, 'لم يعد موجودًا'),
        isNew(n) ? el('span', { class: 'pill warn' }, 'جديد') : null,
        n.grantees > 0 && emp?.role !== 'admin' ? el('span', { class: 'muted small' }, 'ممنوح لـ ' + n.grantees) : null,
        n.description_ar ? el('span', { class: 'pdesc' }, n.description_ar) : null);
      const attrs = { 'data-key': n.key, 'data-text': (n.label_ar + ' ' + n.description_ar).toLowerCase(), 'data-new': isNew(n) ? '1' : '0' };
      const children = (kids.get(n.key) || []).slice().sort(order);
      if (!children.length) return el('div', { class: 'pleaf', ...attrs }, lab);
      const group = el('div', { class: 'pgroup', ...attrs });
      const toggle = el('button', { class: 'ptoggle', type: 'button', 'aria-label': 'طيّ/فتح', on: { click: () => setOpen(group, group.classList.contains('closed')) } }, '▸');
      const branchBtns = emp && emp.role !== 'admin' ? el('span', { class: 'pbranch' },
        el('button', { class: 'btn small', type: 'button', on: { click: () => save(branch(n.key), true) } }, 'تعليم الفرع كاملًا'),
        el('button', { class: 'btn small', type: 'button', on: { click: () => save(branch(n.key), false) } }, 'إلغاء الفرع')) : null;
      group.append(el('div', { class: 'prow' }, toggle, lab, branchBtns), el('div', { class: 'pkids' }, children.map(nodeRow)));
      if (closed.has(n.key)) setOpen(group, false);
      return group;
    }

    function paint() {
      notice.hidden = !emp || emp.role !== 'admin';
      if (emp?.role === 'admin') notice.textContent = emp.employee_no + ' · ' + emp.full_name + ' — مشرف عام مطلق: كل الصلاحيات في كل الأنظمة، دائمًا ودون تعليم.';
      copyBtn.disabled = !emp || emp.role === 'admin';
      tree.replaceChildren(...roots.map((r) => {
        const sys = d.systems.find((s) => s.key === r.system_key);
        return el('section', { class: 'psys' }, el('h3', {}, (sys?.icon || '◼') + ' ' + (sys?.name_ar || r.label_ar)), nodeRow(r));
      }));
      if (!d.nodes.length) tree.replaceChildren(el('p', { class: 'muted' }, 'الشجرة فارغة بعد. تمتلئ تلقائيًا عندما يرسل كل نظام كتالوج عناصره عند إقلاعه.'));
      filter();
      stats.textContent = emp
        ? (emp.role === 'admin' ? '' : 'الممنوح لهذا الموظف: ' + allowed.size + ' من ' + present() + ' عنصرًا')
        : 'اختر موظفًا لعرض صلاحياته. ما لم يُعلَّم هنا فهو ممنوع (الافتراضي: لا شيء).';
    }
    // show matching nodes with their ancestors (opened) and their whole subtree
    function filter() {
      const q = treeSearch.value.trim().toLowerCase();
      const nw = onlyNew.checked;
      const all = [...tree.querySelectorAll('[data-key]')];
      const sections = [...tree.querySelectorAll('.psys')];
      if (!q && !nw) { all.forEach((x) => { x.hidden = false; }); sections.forEach((x) => { x.hidden = false; }); return; }
      all.forEach((x) => { x.hidden = true; });
      for (const x of all) {
        if ((q && !x.dataset.text.includes(q)) || (nw && x.dataset.new !== '1')) continue;
        x.hidden = false;
        x.querySelectorAll('[data-key]').forEach((c) => { c.hidden = false; });
        for (let a = x.parentElement?.closest('.pgroup'); a; a = a.parentElement?.closest('.pgroup')) { a.hidden = false; setOpen(a, true); }
      }
      sections.forEach((x) => { x.hidden = !x.querySelector('[data-key]:not([hidden])'); }); // hide systems with no match
    }
    treeSearch.addEventListener('input', filter); onlyNew.addEventListener('change', filter);

    empSel.addEventListener('change', async () => {
      const id = empSel.value;
      emp = null; allowed = new Set();
      if (id) {
        try { const r = await api('/api/admin/perms/' + id); emp = r.employee; allowed = new Set(r.keys); }
        catch (e) { toast(e.message, true); }
      }
      paint();
    });
    copyBtn.addEventListener('click', () => {
      if (!emp || head.nextElementSibling?.classList.contains('copybox')) return;
      const src = el('select', {}, el('option', { value: '' }, '— الموظف المصدر —'),
        ...d.employees.filter((e) => e.id !== emp.id && e.role !== 'admin').map((e) => el('option', { value: e.id }, e.employee_no + ' · ' + e.full_name)));
      const mode = select('mode', { replace: 'استبدال صلاحياته الحالية', merge: 'إضافة إلى صلاحياته الحالية' }, 'replace');
      const box = el('div', { class: 'form copybox' }, el('label', {}, 'نسخ صلاحيات الموظف', src), el('label', {}, 'الطريقة', mode),
        el('div', { class: 'toolbar' },
          el('button', { class: 'btn primary', type: 'button', on: { click: async () => {
            if (!src.value) { toast('اختر الموظف المصدر', true); return; }
            try {
              const r = await api('/api/admin/perms/copy', { from_employee_id: src.value, to_employee_id: emp.id, mode: mode.value });
              box.remove();
              const fresh = await api('/api/admin/perms');
              for (const n of d.nodes) { const f = fresh.nodes.find((x) => x.key === n.key); if (f) n.grantees = f.grantees; }
              refreshNew(); empSel.dispatchEvent(new Event('change'));
              toast('تم نسخ ' + r.count + ' عنصرًا');
            } catch (e) { toast(e.message, true); }
          } } }, 'نسخ'),
          el('button', { class: 'btn', type: 'button', on: { click: () => box.remove() } }, 'إلغاء')));
      head.after(box);
    });

    paint();
    return [el('p', { class: 'muted' }, 'تبويب «الصلاحيات» يمنح الدخول إلى النظام كاملًا؛ هذه الشجرة تحدد ما يراه الموظف داخل كل نظام (الوحدات والشاشات والأزرار). كل عنصر جديد يظهر غير معلّم ولا يراه أحد غير المشرف العام حتى يُمنح. التغيير يُحفظ فورًا ويُسجَّل في سجل التدقيق.'),
      head, notice, tools, stats, tree];
  }

  // «المعلومات التقنية» lives in admin-infra.js (same helpers, same tab/hash routing)
  const infra = () => window.dgInfra({ el, toast, run, table, fmt, select, day });
  const views = { employees, grants, perms, infra, systems, sessions, audit, attempts, settings };
  void systemsLegacy;
  // صفحة «المعلومات التقنية» المستقلة (/infra): محتواها الخاص فقط، بلا تبويبات الإدارة ولا قسم الموظفين.
  // الشرط مزدوج (سمة الصفحة أو غياب تبويبات الإدارة) حتى لا يُعرض محتوى الإدارة إن اختلفت النسخة المخزّنة من الملف.
  const standaloneInfra = document.body.dataset.page === 'infra' || !document.querySelector('#tabs button[data-tab]');
  if (standaloneInfra) {
    view.replaceChildren(el('p', { class: 'muted' }, 'جارٍ التحميل…'));
    views.infra().then((nodes) => view.replaceChildren(...nodes)).catch((e) => view.replaceChildren(el('div', { class: 'err' }, e.message)));
    return;
  }
  async function show(name) {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    view.replaceChildren(el('p', { class: 'muted' }, 'جارٍ التحميل…'));
    try { view.replaceChildren(...(await views[name]())); }
    catch (e) { view.replaceChildren(el('div', { class: 'err' }, e.message)); }
    try { sessionStorage.setItem('dg_admin_tab', name); } catch { /* ignore */ }
    try { history.replaceState(null, '', '#' + name); } catch { /* ignore */ }
  }
  $('tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) show(e.target.dataset.tab); });
  let first = 'employees';
  try { first = sessionStorage.getItem('dg_admin_tab') || first; } catch { /* ignore */ }
  const hash = location.hash.replace(/^#/, '');
  if (views[hash]) first = hash; // /admin#perms من أيقونة الدرع، /admin#grants من الروابط القديمة
  show(views[first] ? first : 'employees');
  window.addEventListener('hashchange', () => { const h = location.hash.replace(/^#/, ''); if (views[h]) show(h); });
})();
