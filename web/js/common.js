// Shared helpers for gateway pages (no framework)
'use strict';
const $ = (id) => document.getElementById(id);
const yr = $('year'); if (yr) yr.textContent = new Date().getFullYear();

// Arabic-Indic and Persian digits -> ASCII
const toAscii = (s) => String(s || '').replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);

async function api(path, body, method) {
  const opt = { method: method || (body ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r, data = {};
  try { r = await fetch(path, opt); data = await r.json().catch(() => ({})); }
  catch { throw new Error('تعذر الاتصال بالخادم. تحقق من الشبكة.'); }
  if (r.status === 401 && !path.startsWith('/api/login')) { location.href = '/login'; throw new Error(data.error || ''); }
  if (!r.ok) { const e = new Error(data.error || 'حدث خطأ غير متوقع.'); e.data = data; throw e; }
  return data;
}

function showErr(msg) { const e = $('err'); if (!e) return; e.textContent = msg || ''; e.hidden = !msg; }

// `next` may come raw from nginx (…?next=https://host/path?a=1&b=2) — take everything after next=
function readNext() {
  const m = location.search.match(/[?&]next=(.*)$/);
  if (!m) return '/';
  let v = m[1];
  if (/^(https?%3A|%2F)/i.test(v)) { try { v = decodeURIComponent(v); } catch { v = '/'; } }
  return v;
}

// N single-digit boxes: auto-advance, paste, backspace, numeric keypad
function digitBoxes(container, n, onChange) {
  const boxes = [];
  for (let i = 0; i < n; i++) {
    const inp = document.createElement('input');
    Object.assign(inp, { type: 'text', inputMode: 'numeric', maxLength: n, autocomplete: i === 0 && n === 6 ? 'one-time-code' : 'off' });
    inp.setAttribute('pattern', '[0-9]*');
    inp.setAttribute('aria-label', 'الرقم ' + (i + 1));
    container.appendChild(inp);
    boxes.push(inp);
  }
  const value = () => boxes.map((b) => b.value).join('');
  const fill = (from, text) => {
    const ds = toAscii(text).replace(/\D/g, '').split('');
    let i = from;
    for (const d of ds) { if (i >= n) break; boxes[i++].value = d; }
    boxes[Math.min(i, n - 1)].focus();
    onChange(value());
  };
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => { const v = b.value; b.value = ''; fill(i, v); });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].value = ''; boxes[i - 1].focus(); onChange(value()); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' && i < n - 1) boxes[i + 1].focus();
      else if (e.key === 'ArrowRight' && i > 0) boxes[i - 1].focus();
    });
    b.addEventListener('paste', (e) => { e.preventDefault(); fill(i, (e.clipboardData || window.clipboardData).getData('text')); });
    b.addEventListener('focus', () => b.select());
  });
  boxes[0].focus();
  return {
    value,
    clear() { boxes.forEach((b) => { b.value = ''; }); boxes[0].focus(); onChange(''); },
    disable(on) { boxes.forEach((b) => { b.disabled = on; }); },
  };
}

// الهوية والعلامة من «إعدادات النظام»: الألوان على كل الصفحات، والاسم والسطر الفرعي والشعار في رأس البوابة
async function applyBranding() {
  try {
    const r = await fetch('/api/branding', { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) return;
    const b = await r.json();
    const root = document.documentElement.style;
    if (b.color_primary) root.setProperty('--g', b.color_primary);
    if (b.color_navy) root.setProperty('--navy', b.color_navy);
    if (b.color_gold) root.setProperty('--gold', b.color_gold);
    if (b.logo_url) document.querySelectorAll('img.logo').forEach((img) => { if (img.getAttribute('src') !== b.logo_url) img.src = b.logo_url; });
    if (document.body.dataset.page === 'portal') {
      const h = document.querySelector('.brand h1'), s = document.querySelector('.brand .sub');
      if (h && b.name) { h.textContent = b.name; document.title = b.name; }
      if (s && b.sub) s.textContent = b.sub;
    }
  } catch { /* keep the built-in identity */ }
}
if (document.body) applyBranding(); else document.addEventListener('DOMContentLoaded', applyBranding);

// تأكيد قبل تسجيل الخروج من أي صفحة في بوابة ديتيلز
document.addEventListener('click', function (e) {
  var a = e.target && e.target.closest ? e.target.closest('a[href="/logout"]') : null;
  if (!a) return;
  if (!window.confirm('هل تريد تسجيل الخروج من بوابة ديتيلز؟')) e.preventDefault();
}, true);
