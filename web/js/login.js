// Login page: 4-digit employee number -> lookup -> send OTP
'use strict';
(function () {
  const next = readNext();
  const errs = { google: 'تعذر الدخول بحساب Google. حاول مرة أخرى أو استخدم الرقم الوظيفي.' };
  const q = new URLSearchParams(location.search.replace(/[?&]next=.*$/, ''));
  if (errs[q.get('e')]) showErr(errs[q.get('e')]);

  let current = '';
  let busy = false;
  const box = digitBoxes($('empno'), 4, async (v) => {
    $('found').hidden = true; $('hint').hidden = false;
    if (v.length !== 4 || v === current || busy) { if (v.length !== 4) current = ''; return; }
    current = v; busy = true; showErr('');
    try {
      const r = await api('/api/login/lookup', { employee_no: v });
      $('fname').textContent = r.name;
      $('fmail').textContent = r.email_masked;
      $('fmobile').textContent = r.mobile_masked || '';
      $('found').hidden = false; $('hint').hidden = true;
      $('send').textContent = r.otp_channel === 'whatsapp' ? 'أرسل رمز التحقق عبر واتساب' : r.otp_channel === 'both' ? 'أرسل رمز التحقق (واتساب + Email)' : 'أرسل رمز التحقق';
      sessionStorage.setItem('dg_login', JSON.stringify({ no: v, name: r.name, email: r.email_masked, otp_channel: r.otp_channel, next }));
      $('send').focus();
    } catch (e) { showErr(e.message); current = ''; }
    busy = false;
  });

  $('send').addEventListener('click', async () => {
    const v = box.value();
    if (v.length !== 4) return;
    $('send').disabled = true; showErr('');
    try {
      const r = await api('/api/login/otp', { employee_no: v });
      sessionStorage.setItem('dg_otp_sent', String(Date.now()));
      sessionStorage.setItem('dg_otp_info', JSON.stringify(r));
      sessionStorage.removeItem('dg_otp_switched');
      location.href = '/otp';
    } catch (e) { showErr(e.message); $('send').disabled = false; }
  });

  api('/api/login/options').then((o) => {
    if (!o.google) return;
    $('google').href = '/auth/google/start?next=' + encodeURIComponent(next);
    $('gbox').hidden = false;
  }).catch(() => {});
})();
