// بيانات المنشأة: صفحة واحدة بأقسام (نظرة عامة، هيكل الملكية، الجهات والمستندات، الملاك والمستفيدون، المنصات والتراخيص، الحسابات البنكية).
// القراءة لكل موظف (أرقام الهوية مقنّعة لغير المشرف)؛ الإضافة والتعديل والحذف للمشرف العام فقط. المخطط في company-chart.js.
'use strict';
(async function () {
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k === 'on') for (const [e, f] of Object.entries(v)) n.addEventListener(e, f); else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k !== '' && k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  };
  const AR = {
    role: { owner: 'مالك', partner: 'شريك', manager: 'مدير' }, kind: { person: 'شخص', entity: 'كيان' },
    category: { government: 'حكومية', bank: 'بنكية', private: 'خاصة', utility: 'خدمات' }, pstatus: { active: 'نشطة', suspended: 'موقوفة', closed: 'مغلقة' },
    dstatus: { active: 'ساري', revoked: 'ملغى', expired: 'منتهٍ' },
    dkind: { cr: 'سجل تجاري', license: 'رخصة', tax: 'ضريبي', contract: 'عقد', lease: 'عقد إيجار', national_address: 'عنوان وطني', certificate: 'شهادة', invoice: 'فاتورة', bank: 'بنكي', other: 'أخرى',
      incorporation: 'شهادة تأسيس / تسجيل', good_standing: 'حسن سير وسلوك', apostille: 'تصديق / أبوستيل', resolution: 'قرار مجلس / شركاء', articles: 'عقد تأسيس / نظام أساس' },
    bstatus: { active: 'نشط', frozen: 'مجمّد', closed: 'مغلق' },
    ekind: { parent: 'شركة أم', subsidiary: 'شركة تابعة', branch: 'فرع' }, estatus: { active: 'نشطة', dormant: 'خاملة', closed: 'مغلقة' },
    relation: { owns: 'تملك', branch_of: 'فرع من' },
    country: { EG: 'مصر', SA: 'المملكة العربية السعودية', US: 'الولايات المتحدة', GB: 'المملكة المتحدة', CA: 'كندا', AE: 'الإمارات', QA: 'قطر', KW: 'الكويت', BH: 'البحرين', OM: 'عُمان', JO: 'الأردن', TR: 'تركيا' },
  };
  const opts = (map) => Object.entries(map).map(([v, t]) => ({ v, t }));
  const WARN_DAYS = 30;
  // قوالب مستندات الكيان الأجنبي (زر «إنشاء قائمة المستندات المطلوبة»)
  const CHECKLIST = [['شهادة التأسيس / التسجيل', 'incorporation'], ['عقد التأسيس / النظام الأساسي', 'articles'], ['شهادة حسن السير والسلوك (Good Standing)', 'good_standing'],
    ['التصديق / الأبوستيل', 'apostille'], ['قرار المجلس / الشركاء', 'resolution'], ['الرقم الضريبي / التسجيل الضريبي', 'tax']];
  const SECTIONS = [['overview', 'نظرة عامة', '◎'], ['structure', 'هيكل الملكية', '⛓'], ['entities', 'الجهات والمستندات', '▤'], ['owners', 'الملاك والمستفيدون الحقيقيون', '◉'], ['platforms', 'المنصات والتراخيص', '⌘'], ['bank', 'الحسابات البنكية', '▦']];
  // روابط قديمة (#documents …) -> القسم الجديد
  const HASH_ALIAS = { profile: 'overview', documents: 'entities', delegations: 'platforms', licenses: 'platforms' };
  let data = null, st = null, selEntity = null, openDocs = new Set(), active = 'overview';

  // ---------- helpers ----------
  const today = () => { const n = new Date(data ? data.server_now : Date.now()); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };
  const daysUntil = (d) => (d ? Math.round((Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') - today()) / 86400000) : null);
  const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }) : '');
  const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '');
  const money = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' ر.س');
  const dayWord = (n) => { const a = Math.abs(n); return a === 1 ? 'يوم واحد' : a === 2 ? 'يومان' : a <= 10 ? a + ' أيام' : a + ' يومًا'; };
  // تواريخ YYYY-MM-DD تُعرض يسار-يمين دائمًا (وإلا تنعكس داخل النص العربي)
  const dt = (d) => (d ? el('bdi', { dir: 'ltr', class: 'dt' }, String(d).slice(0, 10)) : '—');
  const pctTxt = (n) => (n == null || n === '' ? '—' : Number(n) + '%');
  const expPill = (d, isUnlimited = false) => {
    if (isUnlimited) return el('span', { class: 'pill pill-unlimited', title: 'مستند دائم غير محدود الصلاحية' }, '♾️ غير محدود');
    if (!d) return el('span', { class: 'pill pill-unknown', title: 'تاريخ الانتهاء غير محدد' }, '❓ غير معروف');
    const n = daysUntil(d);
    if (n < 0) return el('span', { class: 'pill exp-expired', title: fmtDate(d) }, '🔴 منتهٍ منذ ' + dayWord(n));
    if (n === 0) return el('span', { class: 'pill exp-expired', title: fmtDate(d) }, '🔴 ينتهي اليوم');
    if (n <= WARN_DAYS) return el('span', { class: 'pill exp-expiring', title: fmtDate(d) }, '🟡 ينتهي خلال ' + dayWord(n));
    return el('span', { class: 'pill exp-ok', title: 'ساري حتى ' + fmtDate(d) }, '🟢 ساري (متبقي ' + dayWord(n) + ')');
  };
  const docExpiryBlock = (d) => {
    const isUnlimited = !!d?.is_unlimited;
    const expiresOn = d?.expires_on;
    const pill = expPill(expiresOn, isUnlimited);
    if (isUnlimited) {
      return el('div', { class: 'cdoc-validity-cell' },
        pill,
        el('div', { class: 'cdoc-countdown unlimited' }, '🛡️ دائم · بلا انتهاء')
      );
    }
    if (!expiresOn) {
      return el('div', { class: 'cdoc-validity-cell' },
        pill,
        el('div', { class: 'cdoc-countdown unknown' }, 'لم يُحدد التاريخ')
      );
    }
    const n = daysUntil(expiresOn);
    let cls = 'ok', txt = '⏱️ متبقي ' + dayWord(n);
    if (n < 0) {
      cls = 'expired'; txt = '⚠️ منتهي منذ ' + dayWord(n);
    } else if (n === 0) {
      cls = 'expired'; txt = '⚠️ ينتهي اليوم!';
    } else if (n <= WARN_DAYS) {
      cls = 'warning'; txt = '⏳ متبقي ' + dayWord(n);
    }
    return el('div', { class: 'cdoc-validity-cell' },
      pill,
      el('div', { class: 'cdoc-countdown ' + cls }, txt),
      el('div', { class: 'cdoc-date-sub' }, 'ينتهي: ', dt(expiresOn))
    );
  };
  const link = (url, text) => (url ? el('a', { href: url, target: '_blank', rel: 'noopener' }, text || url) : '');
  const host = (u) => { try { return new URL(u).host; } catch { return u; } };
  const toast = (msg, bad) => { const t = el('div', { class: 'toast' + (bad ? ' bad' : '') }, msg); document.body.append(t); setTimeout(() => t.remove(), bad ? 4200 : 3000); };
  const afterWrite = (r, okMsg) => { const w = r && r.warnings && r.warnings[0]; toast((okMsg || 'تم الحفظ') + (w ? ' — ⚠ ' + w.message : ''), false); };
  const run = async (fn, okMsg) => { try { const r = await fn(); afterWrite(r, okMsg); await load(); } catch (e) { toast(e.message, true); } };
  const confirmDel = (what) => confirm('حذف ' + what + '؟ لا يمكن التراجع.');
  const entities = () => (st ? st.entities : []);
  const entById = (id) => entities().find((e) => e.id === id);
  const primaryId = () => (st ? st.primary_entity_id : null);
  const docEntity = (d) => d.entity_id || primaryId();
  const entName = (id) => entById(id)?.name_ar || '—';
  const FLAGS = () => (window.CompanyChart ? window.CompanyChart.FLAGS : {});
  const flagEl = (code, big) => { const s = el('span', { class: 'zf' + (big ? ' lg' : ''), title: AR.country[code] || code }); s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (FLAGS()[code] || '<rect width="24" height="24" fill="#94a3b8"/>') + '</svg>'; return s; };
  const chip = (text, cls, title) => el('span', { class: 'cx-chip ' + (cls || ''), title: title || null }, text);
  const sectionHead = (note, ...btns) => el('div', { class: 'chead' }, note ? el('span', { class: 'muted small' }, note) : '', el('span', { class: 'spacer' }), ...btns);
  const addBtn = (text, fn) => (data.admin ? el('button', { class: 'btn small primary', type: 'button', on: { click: fn } }, text) : '');
  const rowActs = (...btns) => (data.admin ? el('td', {}, el('div', { class: 'cell' }, ...btns)) : '');
  const smallBtn = (text, fn, cls) => el('button', { class: 'btn small' + (cls ? ' ' + cls : ''), type: 'button', on: { click: fn } }, text);
  const headRow = (cols) => el('thead', {}, el('tr', {}, ...[...cols, data.admin ? '' : null].filter((x) => x !== null).map((h) => el('th', {}, h))));
  const initials = (n) => window.CompanyChart.initials(n);
  const bar = (segs) => { // segs: [{ pct, cls, title, text }] — widths via CSSOM (the CSP forbids inline style attributes)
    const b = el('div', { class: 'csharebar' });
    for (const s of segs) { const x = el('span', { class: s.cls || '', title: s.title || null }, s.text || ''); x.style.width = Math.max(0, Math.min(100, s.pct)) + '%'; b.append(x); }
    return b;
  };

  // ---------- modal form (admin) ----------
  // fields: [{ k, label, type: text|date|number|select|textarea|checkbox|file, options:[{v,t}], span2, dir, ph }]
  const modal = () => $('modal');
  function closeForm() { modal().hidden = true; $('form').replaceChildren(); document.body.classList.remove('cx-modal-open'); }
  function openForm(title, fields, values, onSubmit) {
    const f = $('form'); modal().hidden = false; document.body.classList.add('cx-modal-open'); f.replaceChildren(el('h4', {}, title));
    const inputs = {};
    for (const fd of fields) {
      let inp;
      const v = values?.[fd.k];
      if (fd.type === 'select') { inp = el('select', {}, ...fd.options.map((o) => el('option', { value: o.v }, o.t))); inp.value = v ?? fd.options[0]?.v ?? ''; }
      else if (fd.type === 'textarea') { inp = el('textarea', {}); inp.value = v ?? ''; }
      else if (fd.type === 'checkbox') { inp = el('input', { type: 'checkbox' }); inp.checked = !!v; }
      else if (fd.type === 'file') inp = el('input', { type: 'file', accept: fd.accept || '.pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.doc,.xls,.txt' });
      else { inp = el('input', { type: fd.type || 'text', placeholder: fd.ph || null, dir: fd.dir || null, step: fd.type === 'number' ? 'any' : null }); inp.value = v ?? ''; }
      inputs[fd.k] = inp;
      f.append(el('label', { class: fd.span2 ? 'span2' : null }, fd.label, inp));
    }
    const expInp = inputs['expires_on'] || inputs['v.expires_on'];
    const unlimInp = inputs['is_unlimited'] || inputs['v.is_unlimited'];
    if (unlimInp && expInp) {
      const syncUnlimited = () => {
        if (unlimInp.checked) {
          expInp.disabled = true;
          expInp.value = '';
          expInp.style.opacity = '0.4';
          expInp.style.pointerEvents = 'none';
        } else {
          expInp.disabled = false;
          expInp.style.opacity = '1';
          expInp.style.pointerEvents = 'auto';
        }
      };
      unlimInp.addEventListener('change', syncUnlimited);
      syncUnlimited();
    }
    f.append(el('div', { class: 'acts' }, el('button', { class: 'btn primary', type: 'submit' }, 'حفظ'), el('button', { class: 'btn', type: 'button', on: { click: closeForm } }, 'إلغاء')));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = {};
      let file = null, fileKey = null;
      for (const fd of fields) {
        const i = inputs[fd.k];
        if (fd.type === 'file') { file = i.files && i.files[0] ? i.files[0] : null; fileKey = fd.k; continue; }
        body[fd.k] = fd.type === 'checkbox' ? i.checked : (i.value === '' ? null : i.value);
      }
      if (fileKey && !file && fields.find((x) => x.k === fileKey).required) { toast('اختر ملفًا أولًا', true); return; }
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = file ? 'جارٍ الرفع…' : 'جارٍ الحفظ…';
      try { const r = await onSubmit(body, file); closeForm(); afterWrite(r); await load(); } catch (err) { toast(err.message, true); }
      finally { btn.disabled = false; btn.textContent = 'حفظ'; }
    };
    const first = f.querySelector('input,select,textarea'); if (first) first.focus();
  }
  modal().addEventListener('click', (e) => { if (e.target === modal()) closeForm(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal().hidden) closeForm(); });

  const empSelect = () => [{ v: '', t: '— بلا —' }, ...(data.employees || []).map((e) => ({ v: e.id, t: e.full_name + ' (' + e.employee_no + ')' }))];
  const entSelect = (blank) => [...(blank ? [{ v: '', t: blank }] : []), ...entities().map((e) => ({ v: e.id, t: e.name_ar + ' — ' + (AR.country[e.country_code] || e.country_code) }))];
  // multipart POST: text fields first, then the single file (the server reads them in that order)
  async function upload(path, body, file) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) if (v != null && v !== '') fd.append(k, typeof v === 'boolean' ? String(v) : v);
    fd.append('file', file, file.name);
    let r, out = {};
    try { r = await fetch(path, { method: 'POST', body: fd, credentials: 'same-origin' }); out = await r.json().catch(() => ({})); }
    catch { throw new Error('تعذر الاتصال بالخادم. تحقق من الشبكة.'); }
    if (r.status === 401) { location.href = '/login'; throw new Error(''); }
    if (!r.ok) throw new Error(out.error || 'تعذر رفع الملف');
    return out;
  }
  const fmtSize = (n) => (n == null ? '' : n < 1024 ? n + ' ب' : n < 1048576 ? (n / 1024).toFixed(0) + ' ك.ب' : (n / 1048576).toFixed(1) + ' م.ب');
  // معاينة داخل الصفحة: الصور و PDF؛ غير ذلك يُفتح/يُنزَّل
  function preview(v, title) {
    const url = v.file_url;
    const isImg = /^image\//.test(v.mime || ''), isPdf = (v.mime || '') === 'application/pdf';
    if (!isImg && !isPdf) { window.open(url, '_blank', 'noopener'); return; }
    const close = () => wrap.remove();
    const wrap = el('div', { class: 'cpreview', on: { click: (e) => { if (e.target === wrap) close(); } } },
      el('div', { class: 'cpreview-box' },
        el('div', { class: 'cpreview-head' }, el('b', {}, title + ' — ' + (v.file_name || 'ملف')), el('span', { class: 'spacer' }),
          el('a', { class: 'btn small', href: url + '?download=1' }, 'تنزيل'), el('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'فتح في تبويب'),
          el('button', { class: 'btn small', type: 'button', on: { click: close } }, 'إغلاق')),
        isImg ? el('img', { src: url, alt: v.file_name || '' }) : el('iframe', { src: url, title: v.file_name || 'PDF' })));
    document.body.append(wrap);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }
  // خلية الملف: معاينة + تنزيل لملف مرفوع، أو رابط خارجي، أو «لم يُرفع بعد»
  const fileCell = (v, title, restricted) => {
    if (!v) return el('span', { class: 'muted' }, 'لا إصدار');
    if (restricted && !data.admin) return el('span', { class: 'muted' }, '🔒 الملف للمشرف العام فقط');
    if (v.has_file) return el('span', { class: 'cfile' },
      el('button', { class: 'linkbtn', type: 'button', title: 'معاينة', on: { click: () => preview(v, title) } }, '👁 ' + (v.file_name || 'ملف')),
      el('a', { href: v.file_url + '?download=1', class: 'muted small', title: 'تنزيل' }, '⬇'), v.size ? el('span', { class: 'muted small' }, fmtSize(v.size)) : '');
    if (v.file_url) return link(v.file_url, v.file_name || 'فتح الملف');
    return el('span', { class: 'muted' }, (v.file_name ? v.file_name + ' — ' : '') + 'لم يُرفع بعد');
  };
  const kv = (rows) => el('dl', { class: 'ckv' }, ...rows.flatMap(([k, v, cls]) => {
    const empty = v == null || v === '' || (v instanceof Node && !v.textContent && !v.childElementCount);
    return [el('dt', {}, k), el('dd', { class: (cls || '') + (empty ? ' empty' : '') }, empty ? '—' : v)];
  }));

  // ---------- nav ----------
  function paintNav() {
    const nav = $('nav'); nav.replaceChildren();
    const exp = (st?.totals.expired || 0) + (st?.totals.expiring || 0);
    const warn = st?.validation.warnings.length || 0;
    const badge = { entities: exp ? [exp, 'bad'] : null, owners: warn ? [warn, 'warn'] : null, structure: st ? [st.entities.length, ''] : null };
    for (const [k, t, ic] of SECTIONS) {
      const b = badge[k];
      nav.append(el('a', { href: '#' + k, class: k === active ? 'on' : '', 'data-sec': k, on: { click: (e) => { e.preventDefault(); goSection(k); } } }, el('i', { 'aria-hidden': 'true' }, ic), el('span', {}, t), b ? el('em', { class: 'n ' + b[1] }, b[0]) : ''));
    }
    nav.append(el('button', { class: 'btn small cx-print', type: 'button', on: { click: printStructure } }, '🖨 طباعة الهيكل'));
  }
  function goSection(k, replace = true) {
    const s = $('sec-' + k); if (!s) return;
    active = k; if (replace) history.replaceState(null, '', '#' + k);
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.sec === k));
    s.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function spy() {
    const tops = SECTIONS.map(([k]) => [k, $('sec-' + k).getBoundingClientRect().top]);
    let cur = SECTIONS[0][0];
    for (const [k, t] of tops) if (t <= 120) cur = k;
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1][0];
    if (cur !== active) { active = cur; document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.sec === cur)); }
  }
  let spyTick = false;
  window.addEventListener('scroll', () => { if (!spyTick) { spyTick = true; requestAnimationFrame(() => { spyTick = false; if (data) spy(); }); } }, { passive: true });
  function printStructure() {
    document.body.classList.add('print-structure');
    const done = () => { document.body.classList.remove('print-structure'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); window.print();
  }

  // ---------- overview ----------
  const PROFILE_FIELDS = [
    { k: 'legal_name_ar', label: 'الاسم القانوني (عربي)' }, { k: 'legal_name_en', label: 'الاسم القانوني (إنجليزي)', dir: 'ltr' },
    { k: 'trade_name_ar', label: 'الاسم التجاري (عربي)' }, { k: 'trade_name_en', label: 'الاسم التجاري (إنجليزي)', dir: 'ltr' },
    { k: 'cr_number', label: 'رقم السجل التجاري / الرقم الموحد', dir: 'ltr' }, { k: 'cr_type', label: 'نوع السجل' }, { k: 'cr_copy_no', label: 'رقم النسخة', dir: 'ltr' },
    { k: 'cr_issued_on', label: 'تاريخ إصدار السجل', type: 'date' }, { k: 'cr_expiry', label: 'موعد التأكيد السنوي / انتهاء السجل', type: 'date' }, { k: 'cr_status', label: 'حالة السجل' },
    { k: 'legal_form', label: 'الكيان القانوني' }, { k: 'capital', label: 'رأس المال (ر.س)', type: 'number', dir: 'ltr' },
    { k: 'activity_code', label: 'رمز النشاط', dir: 'ltr' }, { k: 'activity_ar', label: 'النشاط' },
    { k: 'tax_number', label: 'الرقم الضريبي', dir: 'ltr' }, { k: 'engineering_license_no', label: 'رقم ترخيص الهيئة السعودية للمهندسين', dir: 'ltr' }, { k: 'license_expiry', label: 'انتهاء الترخيص', type: 'date' },
    { k: 'chamber_no', label: 'رقم الغرفة التجارية', dir: 'ltr' }, { k: 'established_on', label: 'تاريخ التأسيس', type: 'date' },
    { k: 'phone', label: 'الجوال / الهاتف', dir: 'ltr' }, { k: 'email', label: 'البريد الإلكتروني', dir: 'ltr' }, { k: 'website', label: 'الموقع الإلكتروني', dir: 'ltr' },
    { k: 'city', label: 'المدينة' }, { k: 'district', label: 'الحي' }, { k: 'street', label: 'الشارع' }, { k: 'logo_url', label: 'رابط الشعار', dir: 'ltr' },
    { k: 'notes', label: 'ملاحظات', type: 'textarea', span2: true },
  ];
  const ADDRESS_FIELDS = [
    { k: 'short_address', label: 'العنوان المختصر', dir: 'ltr' }, { k: 'building', label: 'رقم المبنى', dir: 'ltr' }, { k: 'secondary_no', label: 'الرقم الفرعي', dir: 'ltr' }, { k: 'postal_code', label: 'الرمز البريدي', dir: 'ltr' },
    { k: 'street_ar', label: 'الشارع (عربي)' }, { k: 'street_en', label: 'الشارع (إنجليزي)', dir: 'ltr' }, { k: 'district_ar', label: 'الحي (عربي)' }, { k: 'district_en', label: 'الحي (إنجليزي)', dir: 'ltr' },
    { k: 'city_ar', label: 'المدينة' }, { k: 'city_en', label: 'المدينة (إنجليزي)', dir: 'ltr' }, { k: 'country_ar', label: 'الدولة' }, { k: 'country_en', label: 'الدولة (إنجليزي)', dir: 'ltr' },
    { k: 'account_no', label: 'رقم حساب العميل', dir: 'ltr' }, { k: 'registration_date', label: 'تاريخ التسجيل', type: 'date' }, { k: 'proof_no', label: 'رقم الإثبات', dir: 'ltr' },
    { k: 'issued_on', label: 'تاريخ إصدار الإثبات', type: 'date' }, { k: 'expires_on', label: 'انتهاء الإثبات', type: 'date' }, { k: 'verify_url', label: 'رابط التحقق', dir: 'ltr' },
  ];
  const alertLabel = (a) => {
    if (a.kind === 'document') { const d = (data.documents || []).find((x) => x.id === a.id); const e = d && entById(docEntity(d)); return { icon: e ? flagEl(e.country_code) : '', where: e ? e.name_ar : '', go: () => { if (d) selEntity = docEntity(d); paintEntities(); goSection('entities'); } }; }
    if (a.kind === 'delegation') return { icon: '', where: 'تفويض', go: () => goSection('platforms') };
    return { icon: '', where: 'منصة', go: () => goSection('platforms') };
  };
  function paintOverview() {
    const box = $('overview'); box.replaceChildren();
    const p = data.profile || {}; const na = p.national_address || {};
    const logo = p.logo_url || '/static/assets/logo-details.png';
    const sa = entities().find((e) => e.profile_id) || null;
    const crState = p.cr_expiry ? daysUntil(p.cr_expiry) : null;
    const hero = el('div', { class: 'cx-hero' },
      el('img', { class: 'cx-logo', src: logo, alt: 'شعار الشركة' }),
      el('div', { class: 'cx-hero-main' },
        el('div', { class: 'cx-hero-top' }, el('div', {},
          el('div', { class: 'cx-tag' }, flagEl('SA'), 'الكيان السعودي · ' + (sa ? AR.ekind[sa.kind] : 'المنشأة')),
          el('h3', {}, sa ? sa.name_ar : (p.legal_name_ar || 'المنشأة')),
          el('div', { class: 'cx-en ltr' }, p.legal_name_en || (sa && sa.name_en) || '')),
        data.admin ? el('button', { class: 'btn small primary', type: 'button', on: { click: () => editProfile(p) } }, 'تعديل الملف الرسمي') : ''),
        el('div', { class: 'cx-chips' },
          p.cr_status ? chip(p.cr_status, p.cr_status === 'نشط' ? 'ok' : '', 'حالة السجل التجاري') : '', p.legal_form ? chip(p.legal_form, 'plain') : '',
          p.cr_expiry ? chip(crState < 0 ? 'التأكيد السنوي منتهٍ' : ['التأكيد السنوي حتى ', dt(p.cr_expiry)], crState < 0 ? 'bad' : crState <= WARN_DAYS ? 'warn' : 'ok', fmtDate(p.cr_expiry)) : '',
          p.license_expiry ? chip(['ترخيص الهيئة حتى ', dt(p.license_expiry)], daysUntil(p.license_expiry) < 0 ? 'bad' : daysUntil(p.license_expiry) <= WARN_DAYS ? 'warn' : 'ok') : '',
          na.expires_on ? chip(['العنوان الوطني حتى ', dt(na.expires_on)], daysUntil(na.expires_on) < 0 ? 'bad' : daysUntil(na.expires_on) <= WARN_DAYS ? 'warn' : 'ok') : ''),
        el('div', { class: 'cx-facts' },
          fact('السجل التجاري (الرقم الموحد)', p.cr_number, true), fact('الرقم الضريبي (ضريبة القيمة المضافة)', p.tax_number, true),
          fact('العنوان الوطني', na.short_address ? el('span', {}, el('b', { class: 'ltr' }, na.short_address), el('small', {}, [na.building, na.street_ar, na.district_ar, na.city_ar, na.postal_code].filter(Boolean).join('، '))) : ''),
          fact('النشاط', p.activity_code ? p.activity_code + ' — ' + (p.activity_ar || '') : p.activity_ar), fact('رأس المال', money(p.capital), true),
          fact('الجوال', p.phone, true), fact('البريد', p.email ? el('a', { href: 'mailto:' + p.email }, p.email) : '', true),
          fact('الموقع', p.website ? link(/^https?:/.test(p.website) ? p.website : 'https://' + p.website, p.website) : '', true))));
    box.append(hero);
    // kpis
    const t = st.totals;
    box.append(el('div', { class: 'cx-kpis' }, kpi(t.entities, 'كيانات في المجموعة'), kpi(t.documents, 'مستند مسجّل'), kpi(t.expiring, 'تنتهي خلال ' + WARN_DAYS + ' يومًا', t.expiring ? 'warn' : ''), kpi(t.expired, 'منتهية الصلاحية', t.expired ? 'bad' : '')));
    // alerts strip
    const a = data.alerts || [];
    const strip = el('div', { class: 'cx-strip' + (a.length ? ' has' : '') });
    if (a.length) {
      strip.append(el('b', { class: 'cx-strip-h' }, '⚠ ' + a.length + ' عنصر منتهٍ أو ينتهي خلال ' + WARN_DAYS + ' يومًا'));
      const KIND = { document: 'مستند', platform: 'منصة', delegation: 'تفويض' };
      const list = el('div', { class: 'cx-alerts' });
      for (const x of a) { const l = alertLabel(x); list.append(el('button', { class: 'cx-alert ' + x.severity, type: 'button', on: { click: l.go }, title: 'عرض' }, l.icon, el('span', { class: 'cx-alert-t' }, KIND[x.kind] + ' «' + x.title_ar + '»', l.where && x.kind === 'document' ? el('small', {}, l.where) : ''), expPill(x.expires_on))); }
      strip.append(list);
    } else strip.append(el('span', { class: 'muted' }, '✓ لا توجد عناصر منتهية أو تنتهي خلال ' + WARN_DAYS + ' يومًا.'));
    if (data.admin) strip.append(el('div', { class: 'cx-strip-f' }, smallBtn('فحص الصلاحيات الآن وإرسال الإشعارات', () => run(async () => { const r = await api('/api/admin/company/sweep', {}); toast('تم الفحص: ' + r.alerts + ' تنبيه، ' + r.inserted + ' إشعار جديد'); return null; })),
      el('span', { class: 'muted small' }, 'يعمل تلقائيًا كل يوم صباحًا؛ الإشعارات تصل للمشرفين ولصاحب الحساب.')));
    box.append(strip);
    box.append(warningsStrip());
    // full official profile
    box.append(el('details', { class: 'cx-more' }, el('summary', {}, 'كل بيانات الملف الرسمي (السجل التجاري، التراخيص، التواصل، العنوان الوطني)'), profileCards(p, na)));
  }
  const fact = (k, v, ltr) => { const empty = v == null || v === '' || (v instanceof Node && !v.textContent); return el('div', { class: 'cx-fact' }, el('small', {}, k), el('b', { class: ltr ? 'ltr' : '' }, empty ? '—' : v)); };
  const kpi = (n, label, cls) => el('div', { class: 'cx-kpi ' + (cls || '') }, el('b', {}, n), el('span', {}, label));
  function warningsStrip() {
    const w = st.validation.warnings;
    if (!w.length) return '';
    return el('div', { class: 'cx-warn' }, el('b', {}, '⚠ تنبيهات هيكل الملكية'), el('ul', {}, ...w.map((x) => el('li', {}, x.message))));
  }
  function profileCards(p, na) {
    return el('div', { class: 'cgrid' },
      el('div', { class: 'ccard' }, el('h3', {}, 'الاسم والسجل التجاري'), kv([
        ['الاسم القانوني', p.legal_name_ar], ['بالإنجليزية', p.legal_name_en, 'ltr'], ['الاسم التجاري', p.trade_name_ar], ['بالإنجليزية', p.trade_name_en, 'ltr'],
        ['الرقم الموحد / السجل', p.cr_number, 'ltr'], ['نوع السجل', p.cr_type ? p.cr_type + (p.cr_copy_no ? ' — نسخة ' + p.cr_copy_no : '') : ''], ['حالة السجل', p.cr_status],
        ['تاريخ الإصدار', fmtDate(p.cr_issued_on)], ['التأكيد السنوي', p.cr_expiry ? el('span', {}, fmtDate(p.cr_expiry), ' ', expPill(p.cr_expiry)) : ''],
        ['الكيان القانوني', p.legal_form], ['رأس المال', money(p.capital), 'ltr'], ['النشاط', p.activity_code ? p.activity_code + ' — ' + (p.activity_ar || '') : p.activity_ar]])),
      el('div', { class: 'ccard' }, el('h3', {}, 'التراخيص والتسجيلات'), kv([
        ['الرقم الضريبي', p.tax_number, 'ltr'], ['ترخيص الهيئة السعودية للمهندسين', p.engineering_license_no, 'ltr'],
        ['انتهاء الترخيص', p.license_expiry ? el('span', {}, fmtDate(p.license_expiry), ' ', expPill(p.license_expiry)) : ''],
        ['رقم الغرفة التجارية', p.chamber_no, 'ltr'], ['تاريخ التأسيس', fmtDate(p.established_on)]])),
      el('div', { class: 'ccard' }, el('h3', {}, 'التواصل والمقر'), kv([
        ['الجوال', p.phone, 'ltr'], ['البريد', p.email ? el('a', { href: 'mailto:' + p.email }, p.email) : '', 'ltr'], ['الموقع', p.website ? link(/^https?:/.test(p.website) ? p.website : 'https://' + p.website, p.website) : '', 'ltr'],
        ['المدينة', p.city], ['الحي', p.district], ['الشارع', p.street]])),
      el('div', { class: 'ccard' }, el('h3', {}, 'العنوان الوطني'), kv([
        ['العنوان المختصر', na.short_address, 'ltr'], ['المبنى / الفرعي', na.building ? na.building + (na.secondary_no ? ' / ' + na.secondary_no : '') : '', 'ltr'],
        ['الشارع', na.street_ar], ['الحي', na.district_ar], ['المدينة', na.city_ar ? na.city_ar + (na.postal_code ? ' — ' + na.postal_code : '') : ''], ['الدولة', na.country_ar],
        ['رقم الحساب', na.account_no, 'ltr'], ['تاريخ التسجيل', fmtDate(na.registration_date)], ['رقم الإثبات', na.proof_no, 'ltr'], ['إصدار الإثبات', fmtDate(na.issued_on)],
        ['انتهاء الإثبات', na.expires_on ? el('span', {}, fmtDate(na.expires_on), ' ', expPill(na.expires_on)) : ''], ['التحقق', na.verify_url ? link(na.verify_url, 'proof.address.gov.sa') : '', 'ltr']])),
      p.notes ? el('div', { class: 'ccard' }, el('h3', {}, 'ملاحظات'), el('p', { class: 'cnote' }, p.notes)) : '');
  }
  function editProfile(p) {
    const fields = [...PROFILE_FIELDS, ...ADDRESS_FIELDS.map((f) => ({ ...f, k: 'na.' + f.k, label: 'العنوان الوطني: ' + f.label }))];
    const values = { ...p };
    for (const f of ADDRESS_FIELDS) values['na.' + f.k] = p.national_address?.[f.k] ?? '';
    openForm('تعديل الملف الرسمي (الحقول الفارغة تُترك فارغة)', fields, values, async (body) => {
      const out = {}; const na = {};
      for (const [k, v] of Object.entries(body)) { if (k.startsWith('na.')) { if (v != null) na[k.slice(3)] = v; } else out[k] = v ?? ''; }
      for (const k of ['legal_name_ar', 'legal_name_en', 'trade_name_ar', 'trade_name_en']) out[k] = out[k] || '';
      out.national_address = na;
      return api('/api/admin/company/profile', out, 'PUT');
    });
  }

  // ---------- structure chart ----------
  function paintStructure() {
    const box = $('structure'); box.replaceChildren();
    box.append(sectionHead('اضغط أي كيان لفتح ملفه ومستنداته. النِّسب على الخطوط: الذهبي = المستفيدون الحقيقيون (مجموعة)، الرمادي = ملكية الشركة الأم للتابعة.',
      addBtn('+ كيان', () => entityForm(null)), addBtn('+ علاقة ملكية', () => linkForm(null)), addBtn('+ مستفيد حقيقي', () => beneficialForm(null))));
    const w = warningsStrip(); if (w) box.append(w);
    const holder = el('div', { class: 'cstruct', id: 'chart' }); box.append(holder);
    box.append(el('div', { class: 'cx-legend' }, el('span', {}, el('i', { class: 'lg-main' }), 'الكيان الرئيسي (ملف الشركة الرسمي)'), el('span', {}, el('i', { class: 'lg-parent' }), 'الشركة الأم'),
      el('span', {}, el('i', { class: 'lg-pend' }), 'بانتظار الاسم والأوراق'), el('span', {}, el('i', { class: 'lg-own' }), 'مستفيد حقيقي')));
    window.CompanyChart.render(holder, window.CompanyChart.buildModel(st), {
      selectedId: selEntity,
      onSelectEntity: (id) => { selEntity = id; paintEntities(); paintStructure(); goSection('entities'); const p = $('entities'); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); },
      onSelectOwner: () => goSection('owners'),
    });
  }

  // ---------- entities + documents ----------
  const docsOf = (id) => (data.documents || []).filter((d) => docEntity(d) === id);
  function paintEntities() {
    const box = $('entities'); box.replaceChildren();
    if (!entities().length) { box.append(el('p', { class: 'cempty' }, 'لا توجد كيانات بعد.'), sectionHead('', addBtn('+ كيان', () => entityForm(null)))); return; }
    if (!entById(selEntity)) selEntity = primaryId() || entities()[0].id;
    const tabs = el('div', { class: 'cx-etabs', role: 'tablist' });
    for (const e of entities()) {
      const s = e.stats || {};
      tabs.append(el('button', { class: 'cx-etab' + (e.id === selEntity ? ' on' : '') + (e.awaiting_details ? ' pend' : ''), type: 'button', role: 'tab', 'aria-selected': e.id === selEntity ? 'true' : 'false', on: { click: () => { selEntity = e.id; paintEntities(); paintStructure(); } } },
        flagEl(e.country_code), el('span', { class: 'cx-etab-n' }, e.name_ar), el('em', {}, s.documents || 0), s.expired ? el('i', { class: 'dot bad', title: s.expired + ' منتهٍ' }) : s.expiring ? el('i', { class: 'dot warn', title: s.expiring + ' ينتهي قريبًا' }) : ''));
    }
    if (data.admin) tabs.append(el('button', { class: 'cx-etab add', type: 'button', on: { click: () => entityForm(null) } }, '+ كيان'));
    box.append(tabs);
    paintEntityPanel(box, entById(selEntity));
  }
  function ownershipLines(e) {
    const lines = [];
    for (const l of st.links.filter((x) => x.child_entity_id === e.id)) lines.push(el('li', {}, el('b', {}, entName(l.parent_entity_id)), ' ' + (l.relation === 'branch_of' ? 'الكيان فرع منها' : 'تملك ' + pctTxt(l.share_pct) + ' من هذا الكيان')));
    for (const l of st.links.filter((x) => x.parent_entity_id === e.id)) lines.push(el('li', {}, l.relation === 'branch_of' ? 'فرعها: ' : 'تملك ' + pctTxt(l.share_pct) + ' من ', el('b', {}, entName(l.child_entity_id))));
    return lines.length ? el('ul', { class: 'cx-own-list' }, ...lines) : '';
  }
  function paintEntityPanel(box, e) {
    const fromProfile = !!e.profile_id;
    const head = el('div', { class: 'cx-ehead' }, flagEl(e.country_code, true),
      el('div', { class: 'cx-ehead-t' }, el('h3', {}, e.name_ar), e.name_en ? el('div', { class: 'ltr muted small' }, e.name_en) : '',
        el('div', { class: 'cx-chips' }, chip(AR.ekind[e.kind] || e.kind, 'plain'), chip(AR.country[e.country_code] || e.country_code, 'plain'), chip(AR.estatus[e.status] || e.status, e.status === 'active' ? 'ok' : 'warn'),
          e.awaiting_details ? chip('بانتظار الاسم والأوراق', 'wait', 'كيان نائب: عدّل الاسم وارفع الأوراق ثم ألغِ العلامة') : '', e.owned_pct != null ? chip('مملوكة بنسبة ' + pctTxt(e.owned_pct), 'plain') : '')),
      data.admin ? el('div', { class: 'cell' }, smallBtn('تعديل بيانات الكيان', () => entityForm(e)), !fromProfile ? smallBtn('حذف', () => { if (confirmDel('الكيان «' + e.name_ar + '»')) run(() => api('/api/admin/company/entities/' + e.id, {}, 'DELETE'), 'تم الحذف'); }, 'danger') : '') : '');
    box.append(el('div', { class: 'ccard cx-epanel' }, head,
      el('div', { class: 'cx-ebody' }, kv([
        ['الولاية القضائية', e.jurisdiction], ['الشكل القانوني', e.legal_form], ['رقم التسجيل / السجل', e.registration_no, 'ltr'], ['الرقم الضريبي', e.tax_no, 'ltr'],
        ['تاريخ التأسيس', fmtDate(e.incorporated_on)], ['العنوان', e.address], ['الموقع', e.website ? link(/^https?:/.test(e.website) ? e.website : 'https://' + e.website, e.website) : '', 'ltr']]),
      el('div', {}, ownershipLines(e), fromProfile ? el('p', { class: 'muted small' }, 'بيانات هذا الكيان الرسمية (السجل، الضريبي، العنوان) مأخوذة من «الملف الرسمي» في نظرة عامة — ', el('button', { class: 'linkbtn', type: 'button', on: { click: () => goSection('overview') } }, 'عرضها')) : '',
        e.notes ? el('p', { class: 'cnote' }, e.notes) : ''))));
    box.append(el('h4', { class: 'cx-sub', id: 'documents' }, 'مستندات «' + e.name_ar + '»'));
    paintDocuments(box, e);
  }
  const entityForm = (e) => {
    const fromProfile = !!e?.profile_id;
    openForm(e ? 'تعديل الكيان «' + e.name_ar + '»' : 'إضافة كيان', [
      { k: 'name_ar', label: 'الاسم (عربي)' }, { k: 'name_en', label: 'الاسم (إنجليزي)', dir: 'ltr' },
      { k: 'kind', label: 'النوع', type: 'select', options: opts(AR.ekind) }, { k: 'country_code', label: 'الدولة', type: 'select', options: opts(AR.country) },
      { k: 'status', label: 'الحالة', type: 'select', options: opts(AR.estatus) }, { k: 'jurisdiction', label: 'الولاية القضائية / جهة التسجيل' },
      ...(fromProfile ? [] : [{ k: 'legal_form', label: 'الشكل القانوني (LLC / Ltd / Inc…)' }, { k: 'registration_no', label: 'رقم التسجيل / السجل', dir: 'ltr' }, { k: 'tax_no', label: 'الرقم الضريبي', dir: 'ltr' },
        { k: 'incorporated_on', label: 'تاريخ التأسيس', type: 'date' }, { k: 'website', label: 'الموقع الإلكتروني', dir: 'ltr' }, { k: 'address', label: 'العنوان', span2: true }]),
      { k: 'sort', label: 'الترتيب', type: 'number', dir: 'ltr' }, { k: 'awaiting_details', label: 'بانتظار الاسم والأوراق (يظهر شارة على المخطط)', type: 'checkbox' },
      { k: 'notes', label: 'ملاحظات', type: 'textarea', span2: true },
    ], e || { kind: 'subsidiary', status: 'active', country_code: 'US', sort: 100, awaiting_details: true },
    async (body) => { const r = await api(e ? '/api/admin/company/entities/' + e.id : '/api/admin/company/entities', body, e ? 'PUT' : 'POST'); if (!e) selEntity = r.id; return r; });
  };

  function paintDocuments(view, ent) {
    const list = docsOf(ent.id);
    if (data.admin) view.append(el('div', { class: 'chead' }, el('span', { class: 'muted small' }, 'كل إصدار يحمل ملفه (PDF أو صورة أو Word/Excel حتى 25 م.ب) وتاريخي إصداره وانتهائه؛ الإصدار الحالي هو ما تعكسه بطاقة المستند والتنبيهات.'), el('span', { class: 'spacer' }),
      !list.length ? smallBtn('إنشاء قائمة المستندات المطلوبة', () => createChecklist(ent)) : '', addBtn('+ إضافة مستند', () => documentForm(null, ent.id))));
    if (!list.length) { view.append(el('p', { class: 'cempty' }, ent.awaiting_details ? 'لا مستندات بعد — الأوراق ستُرفع لاحقًا لهذا الكيان.' : 'لا توجد مستندات مسجلة لهذا الكيان بعد.')); return; }
    const rows = [];
    for (const d of list) {
      const cur = d.versions.find((v) => v.is_current) || null;
      const open = openDocs.has(d.id);
      rows.push(el('tr', {},
        el('td', { class: 'cdoc-main-col' },
          el('div', { class: 'cdoc-title' },
            el('button', { class: 'linkbtn', type: 'button', title: 'سجل الإصدارات والمستندات الإضافية', on: { click: () => { open ? openDocs.delete(d.id) : openDocs.add(d.id); paintEntities(); } } }, open ? '▾' : '▸'),
            el('b', { class: 'cdoc-name' }, d.title_ar),
            el('span', { class: 'cdoc-vcount', title: 'عدد الإصدارات والمرفقات المرفوعة' }, d.versions.length + (d.versions.length === 1 ? ' ملف' : ' ملفات')),
            d.admin_only ? el('span', { class: 'pill off', title: 'ملفه للمشرف العام فقط' }, '🔒 مقيّد') : ''),
          (d.doc_number || d.issuer_ar) ? el('div', { class: 'muted small' },
            d.doc_number ? el('span', { class: 'cdoc-submeta ltr' }, 'الرقم: ' + d.doc_number) : '',
            d.issuer_ar ? el('span', { class: 'cdoc-submeta' }, 'الجهة: ' + d.issuer_ar) : '') : '',
          d.notes ? el('div', { class: 'muted small cnotes' }, d.notes) : ''),
        el('td', {}, el('span', { class: 'pill kind' }, AR.dkind[d.kind] || d.kind)),
        el('td', {}, fileCell(cur, d.title_ar, d.admin_only)),
        el('td', {}, docExpiryBlock(d)),
        el('td', {}, cur ? 'إصدار ' + cur.version_no + ' من ' + d.versions.length : '—'),
        el('td', {}, cur?.uploaded_by_name ? cur.uploaded_by_name + ' · ' + fmtDT(cur.uploaded_at) : (cur ? fmtDT(cur.uploaded_at) : (d.issued_on ? 'صدر: ' + d.issued_on : '—'))),
        rowActs(
          smallBtn('⬆ تحديث وإرفاق ملف', () => updateDocForm(d), 'primary cdoc-btn-update'),
          smallBtn('تعديل', () => documentForm(d, docEntity(d))),
          smallBtn('حذف', () => { if (confirmDel('مستند «' + d.title_ar + '» وكل إصداراته')) run(() => api('/api/admin/company/documents/' + d.id, {}, 'DELETE'), 'تم الحذف'); }, 'danger'))));
      if (open) rows.push(el('tr', { class: 'cver' }, el('td', { colspan: data.admin ? 7 : 6 },
        el('div', { class: 'cver-panel' },
          el('div', { class: 'cver-head' },
            el('b', {}, 'سجل الإصدارات والمستندات الإضافية لـ«' + d.title_ar + '» (' + d.versions.length + ')'),
            el('span', { class: 'spacer' }),
            data.admin ? smallBtn('+ إرفاق مستند / إصدار إضافي لهذا المستند', () => versionForm(d, null), 'primary') : ''),
          d.versions.length ? el('table', { class: 'dense' },
            headRow(['الإصدار', 'الملف', 'تاريخ الإصدار', 'الصلاحية والعداد', 'رُفع بواسطة', 'تاريخ الرفع', 'ملاحظات']),
            el('tbody', {}, ...d.versions.map((v) => el('tr', {},
              el('td', {}, 'إصدار ' + v.version_no + ' ', v.is_current ? el('span', { class: 'pill on' }, 'الحالي المعرُوض') : ''),
              el('td', {}, fileCell(v, d.title_ar + ' (إصدار ' + v.version_no + ')', d.admin_only)),
              el('td', {}, dt(v.issued_on)),
              el('td', {}, docExpiryBlock(v)),
              el('td', {}, v.uploaded_by_name || '—'),
              el('td', {}, fmtDT(v.uploaded_at)),
              el('td', { class: 'wrap' }, v.notes || ''),
              rowActs(
                !v.is_current ? smallBtn('اجعله الحالي', () => run(() => api('/api/admin/company/documents/' + d.id + '/versions/' + v.id, { ...v, is_current: true }, 'PUT'), 'أصبح الإصدار الحالي')) : '',
                smallBtn('تعديل', () => versionForm(d, v)),
                smallBtn('حذف', () => { if (confirmDel('الإصدار ' + v.version_no)) run(() => api('/api/admin/company/documents/' + d.id + '/versions/' + v.id, {}, 'DELETE'), 'تم الحذف'); }, 'danger'))))))
          : el('p', { class: 'muted small cpad' }, 'لا إصدارات بعد.')))));
    }
    view.append(el('div', { class: 'tablewrap' }, el('table', { class: 'dense' },
      headRow(['المستند والبيانات', 'النوع', 'الملف الحالي', 'الصلاحية والعداد', 'الإصدار', 'آخر تحديث']), el('tbody', {}, ...rows))));
  }
  async function createChecklist(ent) {
    if (!confirm('إنشاء ' + CHECKLIST.length + ' مستندات فارغة (بلا ملفات) لـ«' + ent.name_ar + '» لتُرفع أوراقها لاحقًا؟')) return;
    try {
      for (const [title, kind] of CHECKLIST) await api('/api/admin/company/entities/' + ent.id + '/documents', { title_ar: title, kind, sort: 100 });
      toast('تم إنشاء قائمة المستندات'); await load();
    } catch (e) { toast(e.message, true); await load(); }
  }

  // تحديث مستند: رفع ملف وإصدار جديد وتحديث رقم الوثيقة أو جهة الإصدار أو التواريخ
  const updateDocForm = (d) => {
    openForm('تحديث مستند «' + d.title_ar + '» وإرفاق إصدار / ملف جديد', [
      { k: 'doc_number', label: 'رقم الوثيقة / المستند', dir: 'ltr' },
      { k: 'issuer_ar', label: 'جهة الإصدار' },
      { k: 'file', label: 'الملف المرفق الجديد (PDF / صورة / Word / Excel — حتى 25 م.ب)', type: 'file', span2: true },
      { k: 'issued_on', label: 'تاريخ الإصدار', type: 'date' },
      { k: 'is_unlimited', label: 'مستند دائم / غير محدود الصلاحية (بدون تاريخ انتهاء)', type: 'checkbox' },
      { k: 'expires_on', label: 'تاريخ الانتهاء (يُحسب منه العداد التنازلي والتنبيهات)', type: 'date' },
      { k: 'file_name', label: 'اسم الملف المعروض (اختياري)', dir: 'ltr', ph: 'document.pdf' },
      { k: 'file_url', label: 'أو رابط خارجي للملف (https)', dir: 'ltr' },
      { k: 'notes', label: 'ملاحظات التحديث / الإصدار الجديد', type: 'textarea', span2: true },
      { k: 'is_current', label: 'تعيين هذا الإصدار كإصدار حالي معتمد', type: 'checkbox' },
    ], {
      doc_number: d.doc_number || '',
      issuer_ar: d.issuer_ar || '',
      issued_on: d.issued_on || '',
      is_unlimited: !!d.is_unlimited,
      expires_on: d.is_unlimited ? '' : (d.expires_on || ''),
      notes: '',
      is_current: true,
    }, async (body, file) => {
      // 1) Update metadata on document
      await api('/api/admin/company/documents/' + d.id, {
        title_ar: d.title_ar,
        kind: d.kind,
        doc_number: body.doc_number,
        issuer_ar: body.issuer_ar,
        admin_only: d.admin_only,
        is_unlimited: body.is_unlimited,
        sort: d.sort,
        entity_id: docEntity(d),
      }, 'PUT');

      // 2) If file or external link or new dates are supplied, add as new version
      if (file || body.file_url || body.issued_on || body.expires_on || body.notes || body.is_unlimited) {
        const verBody = {
          file_name: body.file_name,
          file_url: body.file_url,
          issued_on: body.issued_on,
          expires_on: body.is_unlimited ? null : body.expires_on,
          is_unlimited: body.is_unlimited,
          notes: body.notes,
          is_current: body.is_current !== false,
        };
        openDocs.add(d.id);
        if (file) return upload('/api/admin/company/documents/' + d.id + '/versions', verBody, file);
        return api('/api/admin/company/documents/' + d.id + '/versions', verBody);
      }
      return { ok: true };
    });
  };

  const VERSION_META = [
    { k: 'issued_on', label: 'تاريخ الإصدار', type: 'date' },
    { k: 'is_unlimited', label: 'مستند دائم / غير محدود الصلاحية (بدون تاريخ انتهاء)', type: 'checkbox' },
    { k: 'expires_on', label: 'تاريخ الانتهاء (يُشغّل التنبيهات والعداد)', type: 'date' },
    { k: 'file_name', label: 'اسم الملف المعروض (اختياري)', dir: 'ltr', ph: 'document.pdf' },
    { k: 'file_url', label: 'رابط خارجي بدل الرفع (https)', dir: 'ltr' },
    { k: 'notes', label: 'ملاحظات الإصدار', type: 'textarea', span2: true },
  ];
  const NEW_VERSION_FIELDS = [{ k: 'file', label: 'الملف (PDF / صورة / Word / Excel — حتى 25 م.ب)', type: 'file', span2: true }, ...VERSION_META, { k: 'is_current', label: 'اجعله الإصدار الحالي', type: 'checkbox' }];
  const documentForm = (d, entityId) => openForm(d ? 'تعديل مستند «' + d.title_ar + '»' : 'إضافة مستند إلى «' + entName(entityId) + '» (ثم ارفع ملفه كإصدار أول)', [
    { k: 'title_ar', label: 'عنوان المستند' }, { k: 'kind', label: 'النوع', type: 'select', options: opts(AR.dkind) }, { k: 'entity_id', label: 'الكيان', type: 'select', options: entSelect() },
    { k: 'doc_number', label: 'رقم الوثيقة / الترخيص', dir: 'ltr' }, { k: 'issuer_ar', label: 'جهة الإصدار' }, { k: 'sort', label: 'الترتيب', type: 'number', dir: 'ltr' },
    { k: 'is_unlimited', label: 'مستند دائم / غير محدود الصلاحية (بدون انتهاء)', type: 'checkbox' },
    { k: 'admin_only', label: 'ملفه مقيّد للمشرف العام (هويات/آيبان/توقيعات)', type: 'checkbox' },
    { k: 'notes', label: 'ملاحظات', type: 'textarea', span2: true },
    ...(d ? [] : [{ k: 'file', label: 'الملف (PDF / صورة / Word / Excel — حتى 25 م.ب)', type: 'file', span2: true }, ...VERSION_META.filter((f) => f.k !== 'file_name').map((f) => ({ ...f, k: 'v.' + f.k }))]),
  ], d ? { ...d, entity_id: entityId, is_unlimited: !!d.is_unlimited } : { sort: 100, kind: 'other', entity_id: entityId, is_unlimited: false }, async (body, file) => {
    if (d) return api('/api/admin/company/documents/' + d.id, body, 'PUT');
    const out = {}; const version = {};
    for (const [k, v] of Object.entries(body)) { if (k.startsWith('v.')) version[k.slice(2)] = v; else out[k] = v; }
    if (!file && Object.values(version).some((v) => v != null)) out.version = version;
    const r = await api('/api/admin/company/documents', out);
    openDocs.add(r.id);
    if (file) await upload('/api/admin/company/documents/' + r.id + '/versions', version, file);
    return r;
  });
  const versionForm = (d, v) => openForm(v ? 'تعديل الإصدار ' + v.version_no + ' من «' + d.title_ar + '»' : 'رفع إصدار جديد لـ«' + d.title_ar + '»', v ? VERSION_META : NEW_VERSION_FIELDS,
    v ? { ...v, is_unlimited: !!v.is_unlimited } : { is_current: true, is_unlimited: false }, async (body, file) => {
      if (v) return api('/api/admin/company/documents/' + d.id + '/versions/' + v.id, body, 'PUT');
      openDocs.add(d.id);
      if (file) return upload('/api/admin/company/documents/' + d.id + '/versions', body, file);
      if (!body.file_url) throw new Error('ارفع ملفًا أو أدخل رابطًا خارجيًا');
      return api('/api/admin/company/documents/' + d.id + '/versions', body);
    });

  // ---------- owners: beneficial owners, ownership links, commercial-register owners ----------
  const scopeName = (id) => (id ? entName(id) : 'المجموعة كلها');
  function avatar(o) {
    if (o.photo_url && /^(https:\/\/|\/)/.test(o.photo_url)) return el('img', { class: 'cx-av', src: o.photo_url, alt: '' });
    return el('span', { class: 'cx-av' }, initials(o.person_name_ar));
  }
  function paintOwners() {
    const box = $('owners'); box.replaceChildren();
    // 1) beneficial owners
    box.append(el('h4', { class: 'cx-sub' }, 'المستفيدون الحقيقيون'),
      sectionHead('المستفيد الحقيقي: الشخص الطبيعي الذي يملك أو يسيطر فعليًا؛ نطاق «المجموعة كلها» ينطبق على جميع الكيانات ما لم يُحدَّد لكيان بعينه. مجموع كل نطاق يجب أن يساوي 100٪.', addBtn('+ مستفيد حقيقي', () => beneficialForm(null))));
    const bos = st.beneficial_owners;
    const scopes = [...new Set([null, ...bos.map((b) => b.entity_id || null)])];
    if (!bos.length) box.append(el('p', { class: 'cempty' }, 'لا يوجد مستفيدون حقيقيون مسجلون بعد.'));
    for (const sc of scopes) {
      const rows = bos.filter((b) => (b.entity_id || null) === sc);
      if (!rows.length && sc) continue;
      const rep = st.validation.beneficial.find((r) => (r.entity_id || null) === sc) || { total: 0, ok: false };
      box.append(el('div', { class: 'cx-scope' }, el('b', {}, 'نطاق: ' + scopeName(sc)), chip(rep.total + '٪ من 100٪', rep.ok ? 'ok' : 'warn', rep.ok ? 'المجموع مكتمل' : 'المجموع ليس 100٪')));
      if (!rows.length) continue;
      box.append(bar(rows.map((b, i) => ({ pct: Number(b.share_pct), cls: 'seg' + (i % 4), title: b.person_name_ar + ' ' + pctTxt(b.share_pct), text: Number(b.share_pct) >= 10 ? b.person_name_ar.split(' ')[0] + ' ' + pctTxt(b.share_pct) : '' }))));
      box.append(el('div', { class: 'tablewrap' }, el('table', { class: 'dense' },
        headRow(['المستفيد', 'الرقم الوظيفي', 'الجنسية', 'رقم الهوية', 'النسبة', 'الأساس', 'ملاحظات']),
        el('tbody', {}, ...rows.map((b) => el('tr', {},
          el('td', {}, el('div', { class: 'cx-person' }, avatar(b), el('div', {}, el('b', {}, b.person_name_ar), b.person_name_en ? el('div', { class: 'ltr muted small' }, b.person_name_en) : ''))),
          el('td', { class: 'ltr' }, b.employee_no || '—'), el('td', {}, b.nationality || '—'), el('td', { class: 'ltr' }, b.id_no || '—'),
          el('td', {}, el('b', {}, pctTxt(b.share_pct))), el('td', {}, chip(b.basis || 'مستفيد حقيقي', 'gold')), el('td', { class: 'wrap' }, b.notes || ''),
          rowActs(smallBtn('تعديل', () => beneficialForm(b)), smallBtn('حذف', () => { if (confirmDel('المستفيد «' + b.person_name_ar + '»')) run(() => api('/api/admin/company/beneficial-owners/' + b.id, {}, 'DELETE'), 'تم الحذف'); }, 'danger'))))))));
    }
    // 2) ownership links
    box.append(el('h4', { class: 'cx-sub' }, 'علاقات الملكية بين الكيانات'),
      sectionHead('حصص مالكي الكيان الواحد من كل الشركات لا تتجاوز 100٪.', addBtn('+ علاقة ملكية', () => linkForm(null))));
    if (!st.links.length) box.append(el('p', { class: 'cempty' }, 'لا توجد علاقات ملكية مسجلة.'));
    else box.append(el('div', { class: 'tablewrap' }, el('table', { class: 'dense' },
      headRow(['المالك / الأصل', 'العلاقة', 'الكيان التابع', 'النسبة', 'إجمالي حصص التابع', 'منذ', 'ملاحظات']),
      el('tbody', {}, ...st.links.map((l) => { const rep = st.validation.ownership.find((r) => r.entity_id === l.child_entity_id); const c = entById(l.child_entity_id); const pe = entById(l.parent_entity_id); return el('tr', {},
        el('td', {}, el('span', { class: 'cx-inl' }, pe ? flagEl(pe.country_code) : '', el('b', {}, entName(l.parent_entity_id)))), el('td', {}, AR.relation[l.relation] || l.relation),
        el('td', {}, el('span', { class: 'cx-inl' }, c ? flagEl(c.country_code) : '', el('b', {}, entName(l.child_entity_id)))), el('td', {}, el('b', {}, l.relation === 'owns' ? pctTxt(l.share_pct) : '—')),
        el('td', {}, rep ? chip(rep.total + '٪', rep.ok && rep.complete ? 'ok' : 'warn') : '—'), el('td', {}, dt(l.since)), el('td', { class: 'wrap' }, l.notes || ''),
        rowActs(smallBtn('تعديل', () => linkForm(l)), smallBtn('حذف', () => { if (confirmDel('علاقة الملكية')) run(() => api('/api/admin/company/entity-links/' + l.id, {}, 'DELETE'), 'تم الحذف'); }, 'danger'))); })))));
    // 3) commercial-register owners/managers (Saudi entity)
    box.append(el('h4', { class: 'cx-sub' }, 'الملاك والمديرون في السجل التجاري (الكيان السعودي)'));
    paintCrOwners(box);
  }
  const beneficialForm = (b) => openForm(b ? 'تعديل المستفيد «' + b.person_name_ar + '»' : 'إضافة مستفيد حقيقي', [
    { k: 'entity_id', label: 'النطاق', type: 'select', options: entSelect('المجموعة كلها') },
    { k: 'employee_no', label: 'موظف في ديتيلز (يملأ الاسم تلقائيًا)', type: 'select', options: [{ v: '', t: '— شخص من خارج الفريق —' }, ...(data.employees || []).map((e) => ({ v: e.employee_no, t: e.employee_no + ' — ' + e.full_name }))] },
    { k: 'person_name_ar', label: 'الاسم (عربي)' }, { k: 'person_name_en', label: 'الاسم (إنجليزي)', dir: 'ltr' },
    { k: 'nationality', label: 'الجنسية' }, { k: 'id_no', label: 'رقم الهوية / الجواز', dir: 'ltr' },
    { k: 'share_pct', label: 'النسبة ٪', type: 'number', dir: 'ltr' }, { k: 'basis', label: 'الأساس', ph: 'مستفيد حقيقي' }, { k: 'sort', label: 'الترتيب', type: 'number', dir: 'ltr' },
    { k: 'notes', label: 'ملاحظات', type: 'textarea', span2: true },
  ], b ? { ...b, id_no: data.admin ? b.id_no : '' } : { share_pct: 50, basis: 'مستفيد حقيقي', sort: 100 }, (body) => api(b ? '/api/admin/company/beneficial-owners/' + b.id : '/api/admin/company/beneficial-owners', body, b ? 'PUT' : 'POST'));
  const linkForm = (l) => openForm(l ? 'تعديل علاقة الملكية' : 'إضافة علاقة ملكية', [
    { k: 'parent_entity_id', label: 'المالك / الأصل', type: 'select', options: entSelect() }, { k: 'child_entity_id', label: 'الكيان التابع', type: 'select', options: entSelect() },
    { k: 'relation', label: 'العلاقة', type: 'select', options: opts(AR.relation) }, { k: 'share_pct', label: 'نسبة الملكية ٪', type: 'number', dir: 'ltr' },
    { k: 'since', label: 'منذ', type: 'date' }, { k: 'notes', label: 'ملاحظات', type: 'textarea', span2: true },
  ], l || { relation: 'owns', share_pct: 100, parent_entity_id: entities().find((e) => e.kind === 'parent')?.id }, (body) => api(l ? '/api/admin/company/entity-links/' + l.id : '/api/admin/company/entity-links', body, l ? 'PUT' : 'POST'));

  const COLORS = ['seg0', 'seg1', 'seg2', 'seg3'];
  function paintCrOwners(view) {
    const list = data.owners || [];
    const total = Number(data.shares?.total || 0);
    view.append(sectionHead('نسب الملكية المحددة: ' + total + '٪ من 100٪' + (data.shares && !data.shares.ok ? ' — ' + data.shares.error : ''), addBtn('+ إضافة مالك / شريك / مدير', () => ownerForm(null))));
    const segs = list.filter((o) => o.share_pct != null).map((o, i) => ({ pct: Number(o.share_pct), cls: COLORS[i % 4], title: o.name_ar + ' ' + Number(o.share_pct) + '٪', text: Number(o.share_pct) >= 8 ? o.name_ar.split(' ')[0] + ' ' + Number(o.share_pct) + '٪' : '' }));
    if (total < 100) segs.push({ pct: 100 - total, cls: 'rest', title: 'غير محدد', text: 100 - total >= 12 ? 'غير محدد ' + Math.round((100 - total) * 100) / 100 + '٪' : '' });
    view.append(bar(segs));
    if (!list.length) { view.append(el('p', { class: 'cempty' }, 'لا يوجد ملاك مسجلون بعد.')); return; }
    view.append(el('div', { class: 'tablewrap' }, el('table', { class: 'dense' },
      headRow(['الاسم', 'بالإنجليزية', 'النوع', 'الدور', 'رقم الهوية', 'الجنسية', 'النسبة', 'منذ', 'ملاحظات']),
      el('tbody', {}, ...list.map((o) => el('tr', {}, el('td', {}, el('b', {}, o.name_ar)), el('td', { class: 'ltr' }, o.name_en || '—'), el('td', {}, AR.kind[o.entity_kind] || o.entity_kind),
        el('td', {}, el('span', { class: 'pill kind' }, AR.role[o.role] || o.role)), el('td', { class: 'ltr' }, o.id_number || '—'), el('td', {}, o.nationality || '—'),
        el('td', { class: 'ltr' }, o.share_pct != null ? Number(o.share_pct) + '%' : '—'), el('td', {}, dt(o.since)), el('td', { class: 'wrap' }, o.notes || ''),
        rowActs(smallBtn('تعديل', () => ownerForm(o)), smallBtn('حذف', () => { if (confirmDel('«' + o.name_ar + '»')) run(() => api('/api/admin/company/owners/' + o.id, {}, 'DELETE'), 'تم الحذف'); }, 'danger'))))))));
  }
  const ownerForm = (o) => openForm(o ? 'تعديل «' + o.name_ar + '»' : 'إضافة مالك / شريك / مدير', [
    { k: 'name_ar', label: 'الاسم (عربي)' }, { k: 'name_en', label: 'الاسم (إنجليزي)', dir: 'ltr' },
    { k: 'entity_kind', label: 'النوع', type: 'select', options: opts(AR.kind) }, { k: 'role', label: 'الدور', type: 'select', options: opts(AR.role) },
    { k: 'id_number', label: 'رقم الهوية / السجل', dir: 'ltr' }, { k: 'nationality', label: 'الجنسية' }, { k: 'share_pct', label: 'نسبة الملكية ٪ (اتركها فارغة إن لم تُحدد)', type: 'number', dir: 'ltr' },
    { k: 'since', label: 'منذ', type: 'date' }, { k: 'sort', label: 'الترتيب', type: 'number', dir: 'ltr' }, { k: 'notes', label: 'ملاحظات', type: 'textarea', span2: true },
  ], o || { sort: 100 }, (body) => api(o ? '/api/admin/company/owners/' + o.id : '/api/admin/company/owners', body, o ? 'PUT' : 'POST'));

  // ---------- platforms + delegations ----------
  function paintPlatformsSection() {
    const box = $('platforms'); box.replaceChildren();
    paintPlatforms(box);
    box.append(el('h4', { class: 'cx-sub', id: 'delegations' }, 'المفوضون على المنصات'));
    paintDelegations(box);
  }
  function paintPlatforms(view) {
    const list = data.platforms || [];
    view.append(sectionHead(data.admin ? 'بيانات الدخول تُحفظ كأسرار في «المعلومات التقنية»؛ هنا نربط بالعقدة واسم السر فقط.' : '', addBtn('+ إضافة منصة', () => platformForm(null))));
    if (!list.length) { view.append(el('p', { class: 'cempty' }, 'لا توجد منصات مسجلة بعد.')); return; }
    view.append(el('div', { class: 'tablewrap' }, el('table', { class: 'dense' },
      headRow(['المنصة', 'التصنيف', 'اسم المستخدم', 'صاحب الحساب', 'الصفة', 'الصلاحية', 'الحالة', 'الرابط السريع', 'السر', 'ملاحظات']),
      el('tbody', {}, ...list.map((p) => el('tr', {},
        el('td', {}, el('b', {}, p.name_ar), p.url ? el('div', { class: 'ltr muted small' }, link(p.url, host(p.url))) : ''),
        el('td', {}, el('span', { class: 'pill kind' }, AR.category[p.category] || p.category)), el('td', { class: 'ltr' }, p.account_username || '—'),
        el('td', {}, p.account_holder_name || '—'), el('td', {}, p.role_ar || '—'), el('td', {}, expPill(p.expiry_date)),
        el('td', {}, el('span', { class: 'pill ' + (p.status === 'active' ? 'on' : 'off') }, AR.pstatus[p.status] || p.status)),
        el('td', {}, p.quick_link_url ? link(p.quick_link_url, p.quick_link_title || 'رابط') : '—'),
        el('td', {}, p.secret_node_key ? (data.admin ? el('a', { href: '/infra#node=' + p.secret_node_key, target: '_blank', rel: 'noopener', title: 'فتح عقدة الأسرار في المعلومات التقنية' }, '🔐 ' + (p.secret_ref || p.secret_node_key)) : el('span', { class: 'muted' }, '🔐 ' + (p.secret_ref || 'محفوظ'))) : (p.secret_ref ? el('span', { class: 'muted' }, p.secret_ref) : '—')),
        el('td', { class: 'wrap' }, p.notes || ''),
        rowActs(smallBtn('تعديل', () => platformForm(p)), smallBtn('حذف', () => { if (confirmDel('منصة «' + p.name_ar + '»')) run(() => api('/api/admin/company/platforms/' + p.id, {}, 'DELETE'), 'تم الحذف'); }, 'danger'))))))));
  }
  const platformForm = (p) => openForm(p ? 'تعديل «' + p.name_ar + '»' : 'إضافة منصة', [
    { k: 'name_ar', label: 'اسم المنصة' }, { k: 'category', label: 'التصنيف', type: 'select', options: opts(AR.category) }, { k: 'url', label: 'الرابط', dir: 'ltr', ph: 'https://…' },
    { k: 'account_username', label: 'اسم المستخدم / رقم الحساب (بلا كلمة مرور)', dir: 'ltr' }, { k: 'account_holder_id', label: 'صاحب الحساب (موظف)', type: 'select', options: empSelect() },
    { k: 'role_ar', label: 'الصفة (مالك الحساب / مفوض / مدير منشأة…)' }, { k: 'expiry_date', label: 'انتهاء الاشتراك / التفويض', type: 'date' }, { k: 'status', label: 'الحالة', type: 'select', options: opts(AR.pstatus) },
    { k: 'quick_link_id', label: 'الرابط السريع المرتبط', type: 'select', options: [{ v: '', t: '— بلا —' }, ...(data.quick_links || []).map((q) => ({ v: q.id, t: q.title + ' (' + q.category + ')' }))] },
    { k: 'secret_node_key', label: 'عقدة الأسرار في «المعلومات التقنية» (مفتاح العقدة)', dir: 'ltr', ph: 'bridge' }, { k: 'secret_ref', label: 'اسم السر هناك (نص فقط)' },
    { k: 'sort', label: 'الترتيب', type: 'number', dir: 'ltr' }, { k: 'notes', label: 'ملاحظات', type: 'textarea', span2: true },
  ], p || { sort: 100, status: 'active' }, (body) => api(p ? '/api/admin/company/platforms/' + p.id : '/api/admin/company/platforms', body, p ? 'PUT' : 'POST'));

  function paintDelegations(view) {
    const list = data.delegations || [];
    view.append(sectionHead('', addBtn('+ إضافة تفويض', () => delegationForm(null))));
    if (!list.length) { view.append(el('p', { class: 'cempty' }, 'لا توجد تفويضات مسجلة بعد.')); return; }
    view.append(el('div', { class: 'tablewrap' }, el('table', { class: 'dense' },
      headRow(['المفوَّض', 'المنصة', 'نطاق التفويض', 'من', 'إلى', 'السريان', 'الحالة', 'المستند', 'ملاحظات']),
      el('tbody', {}, ...list.map((g) => el('tr', {},
        el('td', {}, el('b', {}, g.delegate_name), g.employee_name ? el('div', { class: 'muted small' }, g.employee_name) : ''), el('td', {}, g.platform_name || '—'), el('td', { class: 'wrap' }, g.scope_ar || '—'),
        el('td', {}, dt(g.valid_from)), el('td', {}, dt(g.valid_to)), el('td', {}, g.status === 'active' ? expPill(g.valid_to) : el('span', { class: 'pill exp-none' }, '—')),
        el('td', {}, el('span', { class: 'pill ' + (g.status === 'active' ? 'on' : 'off') }, AR.dstatus[g.status] || g.status)), el('td', {}, g.document_url ? link(g.document_url, 'فتح') : '—'), el('td', { class: 'wrap' }, g.notes || ''),
        rowActs(smallBtn('تعديل', () => delegationForm(g)), smallBtn('حذف', () => { if (confirmDel('تفويض «' + g.delegate_name + '»')) run(() => api('/api/admin/company/delegations/' + g.id, {}, 'DELETE'), 'تم الحذف'); }, 'danger'))))))));
  }
  const delegationForm = (g) => openForm(g ? 'تعديل تفويض «' + g.delegate_name + '»' : 'إضافة تفويض', [
    { k: 'delegate_name', label: 'اسم المفوَّض' }, { k: 'employee_id', label: 'الموظف (إن كان من فريق ديتيلز)', type: 'select', options: empSelect() },
    { k: 'platform_id', label: 'المنصة', type: 'select', options: [{ v: '', t: '— بلا —' }, ...(data.platforms || []).map((p) => ({ v: p.id, t: p.name_ar }))] },
    { k: 'scope_ar', label: 'نطاق التفويض', span2: true }, { k: 'valid_from', label: 'من', type: 'date' }, { k: 'valid_to', label: 'إلى', type: 'date' },
    { k: 'status', label: 'الحالة', type: 'select', options: opts(AR.dstatus) }, { k: 'document_url', label: 'رابط مستند التفويض', dir: 'ltr', ph: 'https://…' },
    { k: 'notes', label: 'ملاحظات', type: 'textarea', span2: true },
  ], g || { status: 'active' }, (body) => api(g ? '/api/admin/company/delegations/' + g.id : '/api/admin/company/delegations', body, g ? 'PUT' : 'POST'));

  // ---------- bank accounts ----------
  function paintBank() {
    const box = $('bank'); box.replaceChildren();
    const list = data.bank_accounts || [];
    box.append(sectionHead(data.admin ? 'الآيبان ورقم الحساب يظهران كاملين للمشرف فقط؛ بيانات الدخول للبنك الإلكتروني في أسرار «المعلومات التقنية».' : 'الأرقام مقنّعة؛ اطلب الآيبان الكامل من المشرف.', addBtn('+ إضافة حساب بنكي', () => bankForm(null))));
    if (!list.length) { box.append(el('p', { class: 'cempty' }, 'لا توجد حسابات بنكية مسجلة بعد.')); return; }
    const docOf = (id) => (data.documents || []).find((d) => d.id === id);
    box.append(el('div', { class: 'tablewrap' }, el('table', { class: 'dense' },
      headRow(['البنك', 'اسم الحساب', 'الآيبان', 'رقم الحساب', 'العملة / النوع', 'تاريخ الفتح', 'الحالة', 'المفوضون بالتوقيع', 'المستند', 'السر', 'ملاحظات']),
      el('tbody', {}, ...list.map((b) => { const doc = docOf(b.document_id); const cur = doc ? doc.versions.find((v) => v.is_current) : null; return el('tr', {},
        el('td', {}, el('b', {}, b.bank_name_ar), b.bank_name_en ? el('div', { class: 'ltr muted small' }, b.bank_name_en) : '', b.swift ? el('div', { class: 'ltr muted small' }, 'SWIFT ' + b.swift) : ''),
        el('td', {}, b.account_name || '—'), el('td', { class: 'ltr' }, b.iban ? el('code', {}, b.iban) : '—'), el('td', { class: 'ltr' }, b.account_no || '—'),
        el('td', {}, b.currency + (b.account_type ? ' · ' + b.account_type : '') + (b.branch ? ' · ' + b.branch : '')), el('td', {}, dt(b.opened_on)),
        el('td', {}, el('span', { class: 'pill ' + (b.status === 'active' ? 'on' : 'off') }, AR.bstatus[b.status] || b.status)), el('td', { class: 'wrap' }, b.signatories_ar || '—'),
        el('td', {}, doc ? (cur && (cur.has_file || doc.admin_only) ? fileCell(cur, doc.title_ar, doc.admin_only) : doc.title_ar) : '—'),
        el('td', {}, b.secret_node_key ? (data.admin ? el('a', { href: '/infra#node=' + b.secret_node_key, target: '_blank', rel: 'noopener', title: 'فتح عقدة الأسرار في المعلومات التقنية' }, '🔐 ' + (b.secret_ref || b.secret_node_key)) : el('span', { class: 'muted' }, '🔐 ' + (b.secret_ref || 'محفوظ'))) : (b.secret_ref ? el('span', { class: 'muted' }, b.secret_ref) : '—')),
        el('td', { class: 'wrap' }, b.notes || ''),
        rowActs(smallBtn('تعديل', () => bankForm(b)), smallBtn('حذف', () => { if (confirmDel('حساب «' + b.bank_name_ar + '»')) run(() => api('/api/admin/company/bank-accounts/' + b.id, {}, 'DELETE'), 'تم الحذف'); }, 'danger'))); })))));
  }
  const bankForm = (b) => openForm(b ? 'تعديل حساب «' + b.bank_name_ar + '»' : 'إضافة حساب بنكي', [
    { k: 'bank_name_ar', label: 'اسم البنك (عربي)' }, { k: 'bank_name_en', label: 'اسم البنك (إنجليزي)', dir: 'ltr' }, { k: 'account_name', label: 'اسم الحساب / صاحب الحساب', span2: true },
    { k: 'iban', label: 'الآيبان', dir: 'ltr', ph: 'SA…' }, { k: 'account_no', label: 'رقم الحساب', dir: 'ltr' }, { k: 'customer_no', label: 'رقم العميل', dir: 'ltr' }, { k: 'swift', label: 'SWIFT', dir: 'ltr' },
    { k: 'currency', label: 'العملة', dir: 'ltr', ph: 'SAR' }, { k: 'account_type', label: 'نوع الحساب' }, { k: 'branch', label: 'الفرع' }, { k: 'opened_on', label: 'تاريخ الفتح', type: 'date' },
    { k: 'status', label: 'الحالة', type: 'select', options: opts(AR.bstatus) }, { k: 'signatories_ar', label: 'المفوضون بالتوقيع', span2: true },
    { k: 'document_id', label: 'مستند الحساب (شهادة الآيبان…)', type: 'select', options: [{ v: '', t: '— بلا —' }, ...(data.documents || []).map((d) => ({ v: d.id, t: d.title_ar }))] },
    { k: 'platform_id', label: 'منصة البنك الإلكتروني', type: 'select', options: [{ v: '', t: '— بلا —' }, ...(data.platforms || []).map((p) => ({ v: p.id, t: p.name_ar }))] },
    { k: 'secret_node_key', label: 'عقدة الأسرار في «المعلومات التقنية»', dir: 'ltr', ph: 'company-accounts' }, { k: 'secret_ref', label: 'اسم السر هناك (نص فقط)' },
    { k: 'sort', label: 'الترتيب', type: 'number', dir: 'ltr' }, { k: 'notes', label: 'ملاحظات', type: 'textarea', span2: true },
  ], b || { sort: 100, status: 'active', currency: 'SAR' }, (body) => api(b ? '/api/admin/company/bank-accounts/' + b.id : '/api/admin/company/bank-accounts', body, b ? 'PUT' : 'POST'));

  // ---------- paint / load ----------
  function paintAll() {
    if (!data || !st) return;
    const y = window.scrollY;
    paintNav(); paintOverview(); paintStructure(); paintEntities(); paintOwners(); paintPlatformsSection(); paintBank();
    window.scrollTo(0, y);
  }
  async function load() {
    try {
      const [d, s] = await Promise.all([api('/api/company'), api('/api/company/structure')]);
      data = d; st = s;
      if (data.admin && !data.quick_links) { try { data.quick_links = (await api('/api/links')).links; } catch { data.quick_links = []; } }
    } catch (e) { $('overview').replaceChildren(el('div', { class: 'err' }, e.message)); return; }
    paintAll();
  }
  function hashTarget() {
    const raw = location.hash.replace('#', '');
    const k = HASH_ALIAS[raw] || raw;
    return SECTIONS.some(([s]) => s === k) ? k : null;
  }
  window.addEventListener('hashchange', () => { const k = hashTarget(); if (k) goSection(k, false); });
  await load();
  const first = hashTarget();
  if (first && first !== 'overview') setTimeout(() => goSection(first, false), 60);
})();
