// OTP page: greeting, 4-digit code, channel notice (e-mail / WhatsApp / both), «أرسل عبر البريد بدلًا» once, 60s resend countdown
'use strict';
(function () {
  let st;
  try { st = JSON.parse(sessionStorage.getItem('dg_login') || 'null'); } catch { st = null; }
  if (!st || !st.no) { location.replace('/login'); return; }

  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh', hour: 'numeric', hour12: false }));
  $('daypart').textContent = h < 12 ? 'صباح الخير' : 'مساء الخير';
  $('name').textContent = st.name;

  // Where the code went (from the last /api/login/otp response, stored by login.js / resend)
  function describe(sent) {
    const s = sent || {};
    const email = s.email_masked || st.email || '';
    const mob = s.mobile_last4 || '';
    const ch = s.channel || 'email';
    if (ch === 'whatsapp') return { html: 'أرسلنا الرمز إلى <b>واتساب</b> الجوال المنتهي بـ <b dir="ltr">' + esc(mob) + '</b>', note: 'افتح واتساب واضغط «نسخ الرمز» ثم الصقه هنا.' };
    if (ch === 'both') return { html: 'أرسلنا الرمز إلى <b>واتساب</b> الجوال المنتهي بـ <b dir="ltr">' + esc(mob) + '</b> وإلى البريد <b dir="ltr">' + esc(email) + '</b>', note: 'يكفي أحدهما.' };
    return { html: 'أرسلنا رمز تحقق من أربعة أرقام إلى <b dir="ltr">' + esc(email) + '</b>', note: '' };
  }
  function esc(x) { return String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function render() {
    let sent = null; try { sent = JSON.parse(sessionStorage.getItem('dg_otp_info') || 'null'); } catch { sent = null; }
    const d = describe(sent);
    $('lead').innerHTML = d.html + (d.note ? '<br><small class="muted">' + d.note + '</small>' : '');
    const ttl = sent && sent.ttl_minutes ? Number(sent.ttl_minutes) : (st.ttl_minutes || 5);
    $('ttl').textContent = 'صلاحية الرمز ' + ttl + ' ' + (ttl >= 3 && ttl <= 10 ? 'دقائق' : 'دقيقة') + '. لا تشارك الرمز مع أي شخص.';
    $('viamail').hidden = !(sent && sent.email_fallback && !sessionStorage.getItem('dg_otp_switched'));
  }
  render();

  let timer = null;
  function countdown() {
    const sent = Number(sessionStorage.getItem('dg_otp_sent') || Date.now());
    clearInterval(timer);
    const tick = () => {
      const left = Math.max(0, 60 - Math.floor((Date.now() - sent) / 1000));
      $('count').textContent = left;
      $('resend').disabled = left > 0;
      if (!left) { $('resend').textContent = 'إعادة إرسال الرمز'; clearInterval(timer); }
    };
    $('resend').innerHTML = 'إعادة الإرسال بعد <span id="count">60</span> ث';
    tick(); timer = setInterval(tick, 1000);
  }
  countdown();

  let sending = false;
  async function verify() {
    const code = box.value();
    if (code.length !== 4 || sending) return;
    sending = true; $('verify').disabled = true; box.disable(true); showErr('');
    try {
      const r = await api('/api/login/verify', { employee_no: st.no, code, next: st.next || '/' });
      for (const k of ['dg_login', 'dg_otp_sent', 'dg_otp_info', 'dg_otp_switched']) sessionStorage.removeItem(k);
      location.replace(r.redirect || '/');
      return;
    } catch (e) {
      showErr(e.message); box.disable(false); box.clear();
    }
    sending = false;
  }

  const box = digitBoxes($('code'), 4, (v) => { $('verify').disabled = v.length !== 4; if (v.length === 4) verify(); });
  $('verify').addEventListener('click', verify);

  async function resend(channel) {
    $('resend').disabled = true; $('viamail').disabled = true; showErr(''); $('okmsg').hidden = true;
    try {
      const r = await api('/api/login/otp', channel ? { employee_no: st.no, channel } : { employee_no: st.no });
      sessionStorage.setItem('dg_otp_sent', String(Date.now()));
      sessionStorage.setItem('dg_otp_info', JSON.stringify(r));
      if (channel === 'email') sessionStorage.setItem('dg_otp_switched', '1');
      $('okmsg').textContent = r.channel === 'email' ? 'تم إرسال رمز جديد إلى بريدك.' : r.channel === 'both' ? 'تم إرسال رمز جديد إلى واتساب والبريد.' : 'تم إرسال رمز جديد إلى واتساب.';
      $('okmsg').hidden = false;
      box.clear(); render();
    } catch (e) { showErr(e.message); $('viamail').disabled = false; }
    countdown();
  }
  $('resend').addEventListener('click', () => resend(null));
  $('viamail').addEventListener('click', () => resend('email'));
})();
