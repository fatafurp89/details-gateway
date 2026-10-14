// «إعدادات النظام»: شبكة أقسام بأيقونات، كل قسم في #hash خاص به. الأسرار (كلمة مرور SMTP، مفاتيح الذكاء الاصطناعي) تُلصق مرة ولا تُعرض بعدها.
'use strict';
(async function () {
  const view = $('view'), bread = $('bread'), overlay = $('overlay');
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (k === 'class') n.className = v;
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : String(c));
    return n;
  };
  const fmt = (d) => (d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'short' }) : '—');
  const bytes = (n) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' م.ب' : n >= 1024 ? Math.round(n / 1024) + ' ك.ب' : n + ' ب');
  const toast = (msg, bad) => { const t = el('div', { class: 'toast' + (bad ? ' bad' : '') }, msg); document.body.append(t); setTimeout(() => t.remove(), 3500); };
  const run = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); throw e; } };
  const table = (heads, rows) => el('div', { class: 'tablewrap' }, el('table', { class: 'dense' }, el('thead', {}, el('tr', {}, heads.map((h) => el('th', {}, h)))), el('tbody', {}, rows)));
  const select = (name, opts, val) => el('select', { name }, Object.entries(opts).map(([v, t]) => el('option', { value: v, selected: v === String(val) }, t)));
  const field = (label, input, hint) => el('label', {}, label, input, hint ? el('span', { class: 'muted small' }, hint) : null);
  const modal = (title, ...body) => {
    const box = el('div', { class: 'imodal wide' }, el('div', { class: 'imodal-head' }, el('h3', {}, title), el('button', { class: 'btn small', type: 'button', on: { click: close } }, 'إغلاق')), ...body);
    overlay.replaceChildren(box); overlay.hidden = false;
    function close() { overlay.hidden = true; overlay.replaceChildren(); }
    return { close };
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.hidden = true; overlay.replaceChildren(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) { overlay.hidden = true; overlay.replaceChildren(); } });

  let meta;
  try { meta = await api('/api/settings/sections'); } catch (e) { view.replaceChildren(el('div', { class: 'err' }, e.message)); return; }
  $('uname').textContent = meta.employee.name; $('uno').textContent = '(' + meta.employee.employee_no + ')';
  const sections = meta.sections;
  const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));

  // ---------- home grid ----------
  function home() {
    const cards = sections.map((s) => {
      const inner = [el('div', { class: 'sicon', 'aria-hidden': 'true' }, s.icon), el('h2', {}, s.label), el('p', {}, s.desc),
        s.updated_at ? el('span', { class: 'muted small' }, 'آخر تعديل: ' + fmt(s.updated_at)) : null,
        s.href ? el('span', { class: 'pill kind' }, 'يفتح صفحة أخرى ↗') : null];
      if (!s.allowed) return el('div', { class: 'scard disabled', title: s.adminOnly ? 'للمشرف العام فقط' : 'لم تُمنح هذا القسم' }, ...inner, el('span', { class: 'pill off' }, s.adminOnly ? 'للمشرف العام' : 'غير ممنوح'));
      if (s.href) return el('a', { class: 'scard', href: s.href, target: '_blank', rel: 'noopener' }, ...inner);
      return el('a', { class: 'scard', href: '#' + s.key }, ...inner);
    });
    return [el('p', { class: 'muted' }, 'اختر القسم. التغييرات تُحفظ في الخادم وتُسجَّل في سجل التدقيق؛ الأسرار تُشفَّر ولا تُعرض بعد حفظها.'),
      meta.secrets_enabled ? null : el('div', { class: 'note' }, 'مفتاح التشفير (SECRETS_KEY) غير مهيأ في الخادم: لا يمكن حفظ كلمة مرور SMTP أو مفاتيح الذكاء الاصطناعي حتى يُضبط.'),
      el('div', { class: 'sgrid' }, cards)];
  }

  // ---------- systems ----------
  const MODE = { proxy: 'proxy', link: 'link', internal: 'internal' };
  const STATUS = { live: 'يعمل', soon: 'قيد التجهيز', off: 'متوقف' };
  const PLACE = { grid: 'بطاقة', compact: 'بطاقة مضغوطة', header: 'زر في الرأس' };
  async function systems() {
    const list = await api('/api/settings/systems');
    const row = (s, isNew) => {
      const inp = (k, w, extra) => el('input', { name: k, value: s[k] ?? '', size: w || 12, ...(extra || {}) });
      const rg = el('input', { type: 'checkbox', name: 'requires_grant', checked: s.requires_grant !== false, title: 'يحتاج منحًا من مصفوفة الصلاحيات' });
      const tr = el('tr', {},
        el('td', {}, isNew ? inp('key', 8, { placeholder: 'المفتاح' }) : el('b', {}, s.key)), el('td', {}, inp('name_ar', 20)), el('td', {}, inp('description_ar', 26)),
        el('td', {}, inp('icon', 3)), el('td', { class: 'ltr' }, inp('host', 18)), el('td', { class: 'ltr' }, inp('local_host', 14)), el('td', {}, select('mode', MODE, s.mode || 'proxy')),
        el('td', { class: 'ltr' }, inp('upstream', 22)), el('td', {}, select('status', STATUS, s.status || 'soon')), el('td', {}, inp('sort', 3)),
        el('td', {}, select('placement', PLACE, s.placement || 'grid')), el('td', { class: 'center' }, rg),
        el('td', {}, el('button', { class: 'btn small primary', type: 'button', on: { click: async () => {
          const body = {}; tr.querySelectorAll('input,select').forEach((i) => { body[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
          await run(() => (isNew ? api('/api/settings/systems', body) : api('/api/settings/systems/' + s.key, body, 'PUT')), 'تم الحفظ');
          show('systems');
        } } }, isNew ? 'إضافة' : 'حفظ'), ' ',
        isNew ? null : el('button', { class: 'btn small danger', type: 'button', title: 'يُحذف فقط إن لم يكن مرتبطًا بشجرة صلاحيات أو إشعارات', on: { click: async () => {
          if (!confirm('حذف النظام «' + s.name_ar + '» (' + s.key + ')؟ تُزال منحه من المصفوفة.')) return;
          await run(() => api('/api/settings/systems/' + s.key, null, 'DELETE'), 'تم الحذف'); show('systems');
        } } }, 'حذف')));
      return tr;
    };
    return [el('p', { class: 'muted' }, 'proxy: نطاق فرعي يحميه nginx (host) · link: رابط خارجي بتذكرة موقّعة (upstream) · internal: مسار داخل البوابة. المضيف المحلي: عنوان داخل المكتب يجرّبه المتصفح أولًا. «يحتاج منحًا»: إن أُلغي ظهر النظام لكل الموظفين.'),
      table(['المفتاح', 'الاسم', 'الوصف', 'الأيقونة', 'host', 'المضيف المحلي', 'النمط', 'upstream', 'الحالة', 'الترتيب', 'الموضع', 'يحتاج منحًا', ''],
        [...list.map((s) => row(s, false)), row({ sort: 100, requires_grant: true }, true)])];
  }

  // ---------- branding ----------
  async function branding() {
    const { value: v } = await api('/api/settings/branding');
    const f = el('form', { class: 'form' });
    const color = (k, label) => { const c = el('input', { type: 'color', value: v[k] }); const t = el('input', { name: k, value: v[k], size: 8, dir: 'ltr' }); c.addEventListener('input', () => { t.value = c.value; }); t.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) c.value = t.value; }); return field(label, el('span', { class: 'colorpair' }, c, t)); };
    const preview = el('div', { class: 'bprev' });
    const paint = () => {
      const b = Object.fromEntries(new FormData(f));
      preview.style.setProperty('--pg', b.color_primary); preview.style.setProperty('--pn', b.color_navy); preview.style.setProperty('--po', b.color_gold);
      preview.replaceChildren(el('img', { src: b.logo_url || '/static/assets/logo-details.png', alt: '' }), el('div', {}, el('b', {}, b.name), el('small', {}, b.sub)));
    };
    f.append(field('اسم البوابة', el('input', { name: 'name', value: v.name })), field('السطر الفرعي', el('input', { name: 'sub', value: v.sub })),
      field('رابط الشعار', el('input', { name: 'logo_url', value: v.logo_url, dir: 'ltr' }), 'مسار داخلي (/static/…) أو https'),
      color('color_primary', 'اللون الأساسي (أخضر)'), color('color_navy', 'اللون الداكن (كحلي)'), color('color_gold', 'اللون الذهبي'),
      el('div', { class: 'span2' }, preview),
      el('div', { class: 'toolbar span2' }, el('button', { class: 'btn primary', type: 'submit' }, 'حفظ الهوية'), el('span', { class: 'muted small' }, 'تُطبَّق على كل صفحات البوابة فور الحفظ.')));
    f.addEventListener('input', paint); paint();
    f.addEventListener('submit', async (e) => { e.preventDefault(); await run(() => api('/api/settings/branding', Object.fromEntries(new FormData(f)), 'PUT'), 'تم حفظ الهوية'); applyBranding(); });
    return [f];
  }

  // ---------- security ----------
  async function security() {
    const { value: v, updated_at } = await api('/api/settings/security');
    const f = el('form', { class: 'form' });
    const num = (k, label, min, max, hint) => field(label, el('input', { name: k, type: 'number', min, max, value: v[k], dir: 'ltr' }), hint);
    f.append(num('session_hours', 'مدة الجلسة القصوى (ساعات)', 1, 168, 'بعدها يلزم دخول جديد مهما كان النشاط (الافتراضي 12)'),
      num('idle_minutes', 'انتهاء الخمول (دقائق)', 5, 1440, 'بلا نشاط خلالها تنتهي الجلسة (الافتراضي 30)'),
      num('otp_ttl_minutes', 'صلاحية رمز التحقق (دقائق)', 1, 30, 'الافتراضي 5'),
      num('otp_max_attempts', 'محاولات الرمز الواحد', 1, 10, 'بعدها يُلغى الرمز (الافتراضي 3)'),
      field('قناة رمز التحقق', select('otp_channel', { email: 'البريد الإلكتروني', whatsapp: 'واتساب (جوال الموظف)', both: 'الاثنان معًا' }, v.otp_channel || 'email'),
        'واتساب: يُرسل الرمز إلى جوال الموظف عبر «واتساب ديتيلز» بقالب المصادقة details_login_otp، ويعود للبريد تلقائيًا عند الفشل أو عند غياب الجوال. يمكن للموظف طلب البريد بدلًا مرة واحدة في كل دخول.'),
      num('google_stranger_tries', 'محاولات حساب Google غير مسجّل', 1, 20, 'بالبريد أو من العنوان نفسه (الافتراضي 2)'),
      num('google_block_minutes', 'مدة حظر الغرباء (دقائق)', 1, 1440, 'الافتراضي 30'),
      el('label', { class: 'span2' }, 'العناوين المحظورة (IPv4 أو IPv4/CIDR، كل عنوان في سطر أو مفصولة بفواصل)',
        el('textarea', { name: 'ip_blocklist', rows: 4, placeholder: '203.0.113.7\n198.51.100.0/24' }, (v.ip_blocklist || []).join('\n')),
        el('span', { class: 'muted small' }, 'تُرفض طلبات هذه العناوين (403) في كل الصفحات عدا المسارات الداخلية. لا يُحظر 127.0.0.1 أبدًا.')),
      el('div', { class: 'toolbar span2' }, el('button', { class: 'btn primary', type: 'submit' }, 'حفظ'),
        el('span', { class: 'muted small' }, updated_at ? 'آخر تعديل: ' + fmt(updated_at) : 'لم يُعدَّل بعد (القيم الافتراضية أو من ملف البيئة SESSION_HOURS/SESSION_IDLE_MINUTES/OTP_TTL_MINUTES/OTP_MAX_ATTEMPTS/GOOGLE_STRANGER_TRIES/GOOGLE_BLOCK_MINUTES/IP_BLOCKLIST).')));
    f.addEventListener('submit', async (e) => { e.preventDefault(); await run(() => api('/api/settings/security', Object.fromEntries(new FormData(f)), 'PUT'), 'تم الحفظ؛ تسري على الجلسات الجديدة خلال 30 ثانية'); show('security'); });
    return [el('p', { class: 'muted' }, 'الحدود تُطبَّق في الخادم. الجلسات القائمة تتأثر بالخمول فورًا، وبالمدة القصوى عند الدخول التالي.'), f];
  }

  // ---------- smtp ----------
  async function smtp() {
    const d = await api('/api/settings/smtp');
    const v = d.value;
    const f = el('form', { class: 'form' });
    const pass = el('input', { name: 'password', type: 'password', autocomplete: 'new-password', dir: 'ltr', placeholder: d.password_set ? '•••••••• (محفوظة — اتركها فارغة للإبقاء عليها)' : 'لم تُحفظ كلمة مرور بعد' });
    const clear = el('input', { type: 'checkbox', name: 'clear_password' });
    f.append(field('خادم SMTP', el('input', { name: 'host', value: v.host, dir: 'ltr' })), field('المنفذ', el('input', { name: 'port', type: 'number', value: v.port, dir: 'ltr' }), '465 = SSL مباشر، 587 = STARTTLS'),
      field('المستخدم (البريد المرسل)', el('input', { name: 'user', value: v.user, dir: 'ltr' })), field('اسم المرسل', el('input', { name: 'from_name', value: v.from_name })),
      field('كلمة المرور', pass, 'تُشفَّر بمفتاح الخادم ولا تُعرض بعد الحفظ. المصدر الحالي: ' + ({ settings: 'الإعدادات (مشفّرة)', env: 'ملف البيئة SMTP_PASS', none: 'غير مضبوطة' }[d.password_source] || '—')),
      el('label', { class: 'inline' }, clear, ' مسح كلمة المرور المحفوظة والرجوع إلى ملف البيئة'),
      el('div', { class: 'toolbar span2' }, el('button', { class: 'btn primary', type: 'submit' }, 'حفظ إعدادات البريد'),
        el('span', { class: 'muted small' }, d.updated_at ? 'آخر تعديل: ' + fmt(d.updated_at) : 'القيم من ملف البيئة (SMTP_HOST/PORT/USER/PASS) حتى تُحفظ هنا.')));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f)); body.clear_password = clear.checked; if (!body.password) delete body.password;
      await run(() => api('/api/settings/smtp', body, 'PUT'), 'تم الحفظ'); pass.value = ''; show('smtp');
    });
    const to = el('input', { type: 'email', value: '', placeholder: 'بريد المستلم (افتراضيًا بريدك)', dir: 'ltr' });
    const test = el('div', { class: 'form' }, el('b', { class: 'span2' }, 'رسالة اختبار'), field('إلى', to),
      el('div', { class: 'toolbar' }, el('button', { class: 'btn', type: 'button', on: { click: async (ev) => {
        ev.target.disabled = true;
        try { const r = await run(() => api('/api/settings/smtp/test', { to: to.value || undefined }), null); toast('أُرسلت رسالة الاختبار إلى ' + r.to); } catch { /* shown */ }
        ev.target.disabled = false;
      } } }, 'إرسال رسالة اختبار')));
    return [f, test];
  }

  // ---------- notifications ----------
  async function notifications() {
    const { value: v } = await api('/api/settings/notifications');
    const SEV = { info: 'معلومة', warn: 'تنبيه', urgent: 'عاجل' };
    const relay = el('input', { type: 'checkbox', checked: v.email_relay });
    const sev = Object.fromEntries(Object.keys(SEV).map((k) => [k, el('input', { type: 'checkbox', checked: !!v.severity?.[k]?.email })]));
    const f = el('form', { class: 'form' },
      el('label', { class: 'inline span2' }, relay, ' تحويل الإشعارات إلى البريد الإلكتروني (حسب الدرجة أدناه)'),
      el('b', { class: 'span2' }, 'الافتراضيات حسب درجة الأهمية — إرسال بريد عند:'),
      ...Object.keys(SEV).map((k) => el('label', { class: 'inline' }, sev[k], ' ', el('span', { class: 'pill sev ' + k }, SEV[k]))),
      el('div', { class: 'toolbar span2' }, el('button', { class: 'btn primary', type: 'submit' }, 'حفظ')));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { email_relay: relay.checked, severity: Object.fromEntries(Object.keys(SEV).map((k) => [k, { email: sev[k].checked }])) };
      await run(() => api('/api/settings/notifications', body, 'PUT'), 'تم الحفظ');
    });
    return [el('p', { class: 'muted' }, 'الإشعارات تبقى في مركز الإشعارات دائمًا؛ هنا فقط ما يُرسَل منها بالبريد أيضًا (يستخدم إعدادات SMTP).'), f];
  }

  // ---------- backup ----------
  async function backup() {
    const d = await api('/api/settings/backup');
    const latest = d.latest;
    const box = el('div', { class: 'form' },
      el('div', { class: 'span2' }, el('b', {}, 'آخر نسخة احتياطية: '), latest ? el('span', {}, latest.name + ' · ' + bytes(latest.size) + ' · ' + fmt(latest.mtime)) : el('span', { class: 'pill off' }, 'لا توجد نسخة بعد')),
      el('div', {}, el('b', {}, 'المجلد الرئيسي: '), el('code', { class: 'ltr' }, d.primary.dir), ' ', d.primary.error ? el('span', { class: 'pill warn' }, d.primary.error) : el('span', { class: 'pill on' }, d.primary.files.length + ' ملف')),
      el('div', {}, el('b', {}, '/root/backups: '), d.root.error ? el('span', { class: 'pill kind' }, d.root.error) : el('span', { class: 'pill on' }, d.root.files.length + ' ملف')),
      el('div', { class: 'toolbar span2' }, el('button', { class: 'btn primary', type: 'button', disabled: d.running || !d.pg_dump, title: d.pg_dump ? '' : 'pg_dump غير متوفر على الخادم', on: { click: async (ev) => {
        ev.target.disabled = true; ev.target.textContent = 'جارٍ إنشاء النسخة…';
        try { const r = await run(() => api('/api/settings/backup/run', {}), null); toast('أُنشئت ' + r.file + ' (' + bytes(r.size) + ')'); } catch { /* shown */ }
        show('backup');
      } } }, d.running ? 'نسخة قيد التنفيذ…' : 'إنشاء نسخة احتياطية الآن'), el('span', { class: 'muted small' }, 'pg_dump بصيغة custom؛ يُحتفظ بآخر ' + d.keep + ' نسخة فقط.')));
    const files = [...d.primary.files.map((f) => ({ ...f, where: 'الرئيسي' })), ...d.root.files.map((f) => ({ ...f, where: '/root/backups' }))].sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    return [box, files.length ? table(['الملف', 'الحجم', 'التاريخ', 'المكان'], files.map((f) => el('tr', {}, el('td', { class: 'ltr' }, f.name), el('td', {}, bytes(f.size)), el('td', {}, fmt(f.mtime)), el('td', {}, f.where)))) : null];
  }

  // ---------- AI keys vault ----------
  const ST = { valid: ['صالح ومتصل', 'on'], invalid: ['مرفوض', 'off'], disconnected: ['غير متصل', 'warn'], unknown: ['لم يُفحص', 'kind'] };
  const pill = (st) => el('span', { class: 'pill ' + (ST[st]?.[1] || 'kind') }, ST[st]?.[0] || st);
  async function ai_keys() {
    const [{ keys, secrets_enabled }, providers] = await Promise.all([api('/api/settings/ai/keys'), api('/api/settings/ai/providers')]);
    const pmap = Object.fromEntries(providers.map((p) => [p.key, p]));
    // add form: the key is pasted once, cleared after save, never shown again
    const f = el('form', { class: 'form' });
    const prov = select('provider', Object.fromEntries(providers.map((p) => [p.key, p.name])), 'deepseek');
    const base = el('input', { name: 'base_url', dir: 'ltr', placeholder: pmap.deepseek.base }), model = el('input', { name: 'default_model', dir: 'ltr', placeholder: pmap.deepseek.model });
    prov.addEventListener('change', () => { base.placeholder = pmap[prov.value].base || 'https://…'; model.placeholder = pmap[prov.value].model || 'اسم النموذج'; });
    const key = el('textarea', { name: 'key', rows: 2, autocomplete: 'off', spellcheck: 'false', placeholder: 'الصق المفتاح هنا مرة واحدة — يُحفظ مشفّرًا ولا يظهر بعدها' });
    f.append(field('المزود', prov), field('اسم المفتاح', el('input', { name: 'label', placeholder: 'مثال: DeepSeek — المفتاح الرئيسي' })),
      field('الرابط الأساسي (اختياري)', base, 'يُترك فارغًا للرابط الافتراضي'), field('النموذج الافتراضي (اختياري)', model),
      el('label', { class: 'span2' }, 'المفتاح السري', key),
      el('div', { class: 'toolbar span2' }, el('button', { class: 'btn primary', type: 'submit', disabled: !secrets_enabled }, 'حفظ وفحص الاتصال'),
        el('span', { class: 'muted small' }, secrets_enabled ? 'يُحفظ مشفّرًا (AES-256-GCM) ثم يُفحص فورًا.' : 'SECRETS_KEY غير مهيأ في الخادم.')));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const r = await run(() => api('/api/settings/ai/keys', body), null);
        key.value = ''; f.reset(); // the secret never stays in the page
        toast('حُفظ المفتاح ' + r.key.key_display + ' — ' + (ST[r.check?.status]?.[0] || 'لم يُفحص') + (r.check?.last_error ? ': ' + r.check.last_error : ''), r.check?.status !== 'valid');
        show('ai_keys');
      } catch { btn.disabled = false; }
    });
    const rows = keys.map((k) => el('tr', {},
      el('td', {}, k.provider_name), el('td', {}, el('b', {}, k.label)), el('td', { class: 'ltr', title: 'البادئة وآخر 4 أحرف فقط' }, k.key_display),
      el('td', { class: 'ltr' }, k.effective_model || '—'), el('td', {}, pill(k.status), k.last_error ? el('div', { class: 'muted small', title: k.last_error }, k.last_error.slice(0, 60)) : null),
      el('td', {}, fmt(k.last_checked_at)), el('td', { class: 'center' }, String(k.usage_count)), el('td', {}, fmt(k.last_used_at)),
      el('td', {}, el('button', { class: 'btn small', type: 'button', on: { click: async (ev) => {
        ev.target.disabled = true; ev.target.textContent = 'جارٍ الفحص…';
        try { const r = await run(() => api('/api/settings/ai/keys/' + k.id + '/check', {}), null); toast(ST[r.status][0] + (r.last_error ? ': ' + r.last_error : '') + ' (' + r.ms + ' م.ث)', r.status !== 'valid'); } catch { /* shown */ }
        show('ai_keys');
      } } }, 'فحص الاتصال'), ' ',
      el('button', { class: 'btn small', type: 'button', on: { click: () => details(k) } }, 'تفاصيل'), ' ',
      el('button', { class: 'btn small', type: 'button', on: { click: () => editKey(k, pmap) } }, 'تعديل'), ' ',
      el('button', { class: 'btn small danger', type: 'button', disabled: !k.deletable, title: k.deletable ? 'حذف المفتاح' : 'لا يمكن حذف مفتاح صالح متصل', on: { click: async () => {
        if (!confirm('حذف المفتاح «' + k.label + '» (' + k.key_display + ')؟')) return;
        await run(() => api('/api/settings/ai/keys/' + k.id, null, 'DELETE'), 'تم الحذف'); show('ai_keys');
      } } }, 'حذف'))));
    return [el('p', { class: 'muted' }, 'المفاتيح تُستخدم من الأنظمة الأخرى عبر البوابة (POST /_gw/ai/complete) فلا يصل المفتاح إلى أي نظام. الحذف مسموح فقط لمفتاح مرفوض أو غير متصل؛ افحص الاتصال أولًا.'),
      el('h3', { class: 'stitle' }, 'إضافة مفتاح'), f,
      el('h3', { class: 'stitle' }, 'المفاتيح المحفوظة (' + keys.length + ')'),
      keys.length ? table(['المزود', 'الاسم', 'المفتاح', 'النموذج', 'الحالة', 'آخر فحص', 'الاستخدام', 'آخر استخدام', ''], rows) : el('p', { class: 'muted' }, 'لا مفاتيح بعد.')];
  }
  async function details(k) {
    const d = await run(() => api('/api/settings/ai/keys/' + k.id));
    const kv = (a, b) => [el('dt', {}, a), el('dd', { class: /^[\x00-\x7F]*$/.test(String(b)) ? 'ltr' : '' }, b)];
    modal('تفاصيل المفتاح — ' + d.key.label,
      el('dl', { class: 'ikv' }, kv('المزود', d.key.provider_name), kv('المفتاح', d.key.key_display), kv('الرابط الأساسي', d.key.effective_base_url), kv('النموذج', d.key.effective_model || '—'),
        kv('الحالة', ST[d.key.status]?.[0] || d.key.status), kv('آخر خطأ', d.key.last_error || '—'), kv('آخر فحص', fmt(d.key.last_checked_at)),
        kv('أضافه', (d.key.created_by_name || '—') + ' · ' + fmt(d.key.created_at)),
        kv('عدّاد الاستخدام', String(d.key.usage_count)), kv('آخر استخدام', fmt(d.key.last_used_at)),
        kv('الاستدعاءات (الكل / 30 يومًا)', d.usage.calls + ' / ' + d.usage.calls_30d), kv('الناجحة', String(d.usage.ok)), kv('مجموع الرموز', String(d.usage.tokens)), kv('متوسط المدة', d.usage.avg_ms + ' م.ث')),
      el('h4', {}, 'آخر 20 استدعاء'),
      d.last_calls.length ? table(['الوقت', 'النظام', 'النموذج', 'الرموز', 'المدة', 'النتيجة'], d.last_calls.map((c) => el('tr', {}, el('td', {}, fmt(c.created_at)), el('td', { class: 'ltr' }, c.system_key || '—'), el('td', { class: 'ltr' }, c.model || ''),
        el('td', {}, c.total_tokens ?? '—'), el('td', {}, c.ms + ' م.ث'), el('td', {}, el('span', { class: 'pill ' + (c.ok ? 'on' : 'off'), title: c.error || '' }, c.ok ? 'نجاح' : 'فشل'))))) : el('p', { class: 'muted' }, 'لم يُستخدم بعد.'));
  }
  function editKey(k, pmap) {
    const f = el('form', { class: 'form iform' });
    const key = el('textarea', { name: 'key', rows: 2, autocomplete: 'off', placeholder: 'اتركه فارغًا للإبقاء على المفتاح الحالي؛ أو الصق مفتاحًا جديدًا ليحل محله' });
    f.append(field('اسم المفتاح', el('input', { name: 'label', value: k.label })), field('الرابط الأساسي', el('input', { name: 'base_url', value: k.base_url || '', dir: 'ltr', placeholder: pmap[k.provider]?.base })),
      field('النموذج الافتراضي', el('input', { name: 'default_model', value: k.default_model || '', dir: 'ltr', placeholder: pmap[k.provider]?.model })),
      el('label', { class: 'span2' }, 'مفتاح جديد (اختياري)', key),
      el('div', { class: 'toolbar span2' }, el('button', { class: 'btn primary', type: 'submit' }, 'حفظ')));
    const m = modal('تعديل — ' + k.label, f);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f)); if (!body.key) delete body.key;
      await run(() => api('/api/settings/ai/keys/' + k.id, body, 'PUT'), 'تم الحفظ'); key.value = ''; m.close(); show('ai_keys');
    });
  }

  // ---------- AI monitoring ----------
  async function ai_monitoring() {
    const [{ overview, providers, daily_trend }] = await Promise.all([api('/api/settings/ai-monitoring')]);

    const box = el('div', { class: 'form' },
      el('div', { class: 'stats-grid' },
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'إجمالي الطلبات'), el('div', { class: 'stat-value' }, overview.total_calls)),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'الطلبات الناجحة'), el('div', { class: 'stat-value on' }, overview.successful_calls)),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'الأخطاء'), el('div', { class: 'stat-value off' }, overview.failed_calls)),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'خلال 24 ساعة'), el('div', { class: 'stat-value' }, overview.calls_24h)),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'أخطاء 24 ساعة'), el('div', { class: 'stat-value warn' }, overview.errors_24h)),
        el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'متوسط الوقت'), el('div', { class: 'stat-value' }, overview.avg_ms + ' م.ث')),
      ));

    // Provider summary table
    const providerRows = providers.map((p) => {
      const rate = p.calls > 0 ? Math.round((p.ok / p.calls) * 100) : 0;
      return el('tr', {},
        el('td', {}, el('b', {}, p.provider_name || p.provider)),
        el('td', { class: 'center' }, p.calls),
        el('td', { class: 'center' }, el('span', { class: 'pill ' + (rate >= 95 ? 'on' : rate >= 80 ? 'kind' : 'warn') }, rate + '%')),
        el('td', { class: 'center' }, p.tokens || '0'),
        el('td', {}, el('button', { class: 'btn small', type: 'button', on: { click: () => { showMonitoringDetails(p.provider); document.querySelector('[name="provider"]').value = p.provider; } } }, 'التفاصيل →')));
    });

    // Daily trend chart (simple bars)
    const maxRequests = Math.max(...daily_trend.map(d => d.requests), 1);
    const trendChart = el('div', { class: 'trend-chart' },
      el('h4', { class: 'stitle' }, 'الاتجاهات اليومية (آخر 30 يوم)'),
      el('div', { class: 'chart-bars' },
        daily_trend.slice(0, 20).reverse().map((d) => {
          const label = new Date(d.day).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'short', day: 'numeric' });
          const barHeight = (d.requests / maxRequests) * 100;
          return el('div', { class: 'chart-bar-group' },
            el('div', { class: 'chart-bar', style: 'height: ' + barHeight + '%', title: d.requests + ' طلب: ' + d.successful + ' نجح، ' + d.failed + ' فشل' }),
            el('div', { class: 'chart-label' }, label));
        })));

    const providerSelector = el('select', { name: 'provider', on: { change: (e) => showMonitoringDetails(e.target.value) } },
      el('option', { value: '' }, 'اختر مزودًا للتفاصيل…'),
      ...providers.map(p => el('option', { value: p.provider }, p.provider_name || p.provider)));

    return [
      el('p', { class: 'muted' }, 'سجلات استخدام مفصلة لكل مفتاح ذكاء اصطناعي مع فلاتر وإحصائيات وتنبيهات.'),
      box,
      el('h3', { class: 'stitle' }, 'ملخص المزودين'),
      providers.length ? table(['المزود', 'الطلبات', 'معدل النجاح', 'الرموز', 'التفاصيل'], providerRows) : el('p', { class: 'muted' }, 'لا مزودين بعد.'),
      trendChart,
      el('div', { class: 'form' }, el('label', {}, 'عرض التفاصيل', providerSelector)),
      el('div', { id: 'monitoring-details' })
    ];
  }

  async function showMonitoringDetails(provider) {
    if (!provider) return document.getElementById('monitoring-details').replaceChildren();

    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = new Date().toISOString().split('T')[0];
    const selectedStatus = document.querySelector('[name="filter-status"]')?.value || '';
    const selectedModel = document.querySelector('[name="filter-model"]')?.value || '';

    try {
      const url = `/api/settings/ai-usage/${provider}?from=${from}T00:00:00Z&to=${to}T23:59:59Z` +
        (selectedModel ? `&model=${encodeURIComponent(selectedModel)}` : '') +
        (selectedStatus ? `&status=${selectedStatus}` : '');
      const d = await api(url);

      const details = el('div', { class: 'monitoring-detail' },
        el('h4', { class: 'stitle' }, 'تفاصيل المزود: ' + d.provider_name),
        el('div', { class: 'stats-grid' },
          el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'إجمالي'), el('div', { class: 'stat-value' }, d.summary.total)),
          el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'ناجح'), el('div', { class: 'stat-value on' }, d.summary.successful)),
          el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'فشل'), el('div', { class: 'stat-value off' }, d.summary.failed)),
          el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'متوسط الوقت'), el('div', { class: 'stat-value' }, d.summary.avg_ms + ' م.ث')),
          el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'أقصى وقت'), el('div', { class: 'stat-value' }, d.summary.max_ms + ' م.ث')),
          el('div', { class: 'stat-card' }, el('div', { class: 'stat-label' }, 'إجمالي الرموز'), el('div', { class: 'stat-value' }, d.summary.total_tokens)),
        ),
        el('h4', { class: 'stitle' }, 'الفلاتر'),
        el('div', { class: 'form' },
          el('label', {}, 'النموذج',
            el('select', { name: 'filter-model', on: { change: () => showMonitoringDetails(provider) } },
              el('option', { value: '' }, 'الكل'),
              ...d.models.map(m => el('option', { value: m }, m)))),
          el('label', {}, 'الحالة',
            el('select', { name: 'filter-status', on: { change: () => showMonitoringDetails(provider) } },
              el('option', { value: '' }, 'الكل'),
              el('option', { value: 'ok' }, 'نجح'),
              el('option', { value: 'error' }, 'فشل')))),
      );

      if (d.top_errors.length > 0) {
        const errorRows = d.top_errors.map(e => el('tr', {},
          el('td', {}, e.error || '—'),
          el('td', { class: 'center' }, e.count)));
        details.append(el('h4', { class: 'stitle' }, 'أكثر الأخطاء شيوعًا'),
          table(['الخطأ', 'العدد'], errorRows));
      }

      // Logs table
      const logRows = d.logs.map(l => el('tr', {},
        el('td', {}, fmt(l.created_at)),
        el('td', {}, l.label || '—'),
        el('td', { class: 'ltr' }, l.model || '—'),
        el('td', { class: 'ltr' }, l.system_key || '—'),
        el('td', {}, (l.prompt_tokens ?? 0) + ' / ' + (l.completion_tokens ?? 0)),
        el('td', {}, l.ms + ' م.ث'),
        el('td', {}, el('span', { class: 'pill ' + (l.ok ? 'on' : 'off') }, l.ok ? 'نجح' : 'فشل')),
        el('td', {}, l.error ? el('div', { class: 'muted small', title: l.error }, l.error.slice(0, 40)) : '—')));

      details.append(el('h4', { class: 'stitle' }, 'السجلات (' + d.logs.length + ')'),
        d.logs.length ? table(['الوقت', 'المفتاح', 'النموذج', 'النظام', 'الرموز', 'الوقت', 'النتيجة', 'ملاحظة'], logRows) : el('p', { class: 'muted' }, 'لا سجلات.'));

      document.getElementById('monitoring-details').replaceChildren(details);
    } catch (e) {
      document.getElementById('monitoring-details').replaceChildren(el('div', { class: 'err' }, e.message));
    }
  }

  // ---------- routing ----------
  const views = { systems, branding, security, smtp, notifications, backup, ai_keys, ai_monitoring };
  async function show(name) {
    const s = byKey[name];
    if (!s || !views[name]) { bread.replaceChildren(el('b', {}, 'إعدادات النظام')); view.replaceChildren(...home().filter(Boolean)); return; }
    bread.replaceChildren(el('a', { href: '#' }, 'إعدادات النظام'), el('span', { class: 'sep' }, '←'), el('b', {}, s.icon + ' ' + s.label));
    if (!s.allowed) { view.replaceChildren(el('div', { class: 'err' }, s.adminOnly ? 'هذا القسم للمشرف العام فقط.' : 'لم تُمنح صلاحية هذا القسم.')); return; }
    view.replaceChildren(el('p', { class: 'muted' }, 'جارٍ التحميل…'));
    try { view.replaceChildren(...(await views[name]()).filter(Boolean)); }
    catch (e) { view.replaceChildren(el('div', { class: 'err' }, e.message)); }
  }
  const route = () => show(location.hash.replace(/^#/, ''));
  window.addEventListener('hashchange', route);
  route();
})();
