// بريد ديتيلز خلف البوابة: يضمن أن رمز الجلسة المخزّن في المتصفح يطابق هوية البوابة الحالية
// (يُحقن عبر nginx في صفحات mail.details-wms.cloud فقط). عند الاختلاف يستبدل الرمز ويعيد التحميل مرة واحدة.
(function () {
  if (window.top !== window.self) return;
  var KEY = 'details-mail-token';
  function claims(t) { try { return JSON.parse(atob((t.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return null; } }
  var cur = null; try { cur = localStorage.getItem(KEY); } catch (e) {}
  fetch('/api/auth/gateway?json=1', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !j.token) return;
      var c = cur ? claims(cur) : null;
      var fresh = claims(j.token) || {};
      var expired = !c || !c.exp || c.exp * 1000 < Date.now() + 60000;
      if (expired || c.sub !== fresh.sub) {
        try { localStorage.setItem(KEY, j.token); } catch (e) {}
        var once = 'dg-mail-token-swapped-' + fresh.sub;
        try { if (sessionStorage.getItem(once)) return; sessionStorage.setItem(once, '1'); } catch (e) {}
        location.reload();
      }
    }).catch(function () {});
})();
