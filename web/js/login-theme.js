// Sign-in theme: Gregorian + Hijri (Umm al-Qura) date cards, computed client-side in Asia/Riyadh.
// Arabic weekday/month names, latin digits. No network, no dependencies.
'use strict';
(function () {
  const TZ = 'Asia/Riyadh';
  const now = new Date();

  function parts(locale, opts) {
    try {
      const o = {};
      for (const p of new Intl.DateTimeFormat(locale, Object.assign({ timeZone: TZ }, opts)).formatToParts(now)) o[p.type] = p.value;
      return o;
    } catch { return null; }
  }
  const pad = (v) => String(v || '').replace(/\D/g, '').padStart(2, '0');

  function render(prefix, cal) {
    const num = parts('ar-u-ca-' + cal + '-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' });
    const txt = parts('ar-u-ca-' + cal + '-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (!num || !txt) return false;
    const val = document.getElementById(prefix + '-date');
    const sub = document.getElementById(prefix + '-sub');
    if (val) val.textContent = pad(num.day) + '/' + pad(num.month) + '/' + String(num.year).replace(/\D/g, '');
    if (sub) sub.textContent = txt.weekday + '، ' + String(txt.day).replace(/\D/g, '') + ' ' + txt.month + ' ' + String(txt.year).replace(/\D/g, '');
    return true;
  }

  render('g', 'gregory');
  // Umm al-Qura first (official Saudi calendar), then the generic Islamic calendar as fallback.
  if (!render('h', 'islamic-umalqura')) render('h', 'islamic');
})();
