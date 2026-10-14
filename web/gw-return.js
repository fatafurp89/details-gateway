// رابط «بوابة ديتيلز» موحّد يُحقن في صفحات الأنظمة عبر nginx (sub_filter): يوضع داخل هيدر النظام نفسه (لا زرّ عائم).
// إن لم يوجد هيدر في الصفحة يُعرض شريط رفيع أعلى الصفحة. يُعاد تركيبه تلقائيًا إن أزالته الواجهة (هيدرشن React).
(function () {
  if (window.top !== window.self) return;
  var HREF = 'https://details-wms.cloud/';
  var ID = 'dg-return';

  function build(inHeader) {
    var a = document.createElement('a');
    a.id = ID; a.href = HREF; a.title = 'العودة إلى بوابة ديتيلز'; a.setAttribute('aria-label', 'العودة إلى بوابة ديتيلز');
    a.className = inHeader ? 'dg-in' : 'dg-strip';
    a.innerHTML = '<span class="dg-ic">⌂</span><span class="dg-tx">بوابة ديتيلز</span>';
    return a;
  }

  function style() {
    if (!document.getElementById('dg-font')) {
      var f = document.createElement('style'); f.id = 'dg-font';
      f.textContent = 'html,body,button,input,select,textarea,h1,h2,h3,h4,h5,h6,p,a,span,div,td,th,li{font-family:Arial,Tahoma,sans-serif !important}';
      (document.head || document.documentElement).appendChild(f);
    }
    if (document.getElementById('dg-return-css')) return;
    var s = document.createElement('style'); s.id = 'dg-return-css';
    s.textContent =
      '#dg-return{direction:rtl;text-decoration:none;color:#fff;font:600 13px/1 Arial,Tahoma,sans-serif;white-space:nowrap}' +
      '#dg-return.dg-in{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:#0f8a6b;margin-inline:8px;flex:none;box-shadow:0 2px 8px rgba(15,138,107,.25)}' +
      '#dg-return.dg-in:hover{background:#0b6e55}' +
      '#dg-return.dg-strip{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:30px;background:#0f8a6b;box-sizing:border-box}' +
      '#dg-return .dg-ic{font-size:15px;line-height:1}' +
      '@media print{#dg-return{display:none}}' +
      '@media (max-width:480px){#dg-return.dg-in .dg-tx{display:none}#dg-return.dg-in{padding:8px 10px}}';
    (document.head || document.documentElement).appendChild(s);
  }

  // إن كان النظام يعرض رابط «بوابة ديتيلز» في هيدره بنفسه (البريد، واتساب، المرفقات) فلا نضيف شيئًا
  function hasOwnLink() {
    try { return !!document.querySelector('a[href^="https://details-wms.cloud"]:not(#' + ID + ')'); } catch (e) { return false; }
  }

  function findHeader() {
    var sel = ['header', '[role="banner"]', '.dx-portal-head', '.dt-header', 'nav'];
    for (var i = 0; i < sel.length; i++) {
      var list = document.querySelectorAll(sel[i]);
      for (var j = 0; j < list.length; j++) {
        var r = list[j].getBoundingClientRect();
        if (r.height > 24 && r.height < 160 && r.top < 120 && r.width > 300) return list[j];
      }
    }
    return null;
  }

  function mount() {
    if (!document.body) return;
    var cur = document.getElementById(ID);
    if (hasOwnLink()) { if (cur) cur.remove(); return; }
    style();
    var h = findHeader();
    if (cur && ((cur.className === 'dg-in' && cur.closest('header,[role="banner"],.dx-portal-head,.dt-header,nav')) || (cur.className === 'dg-strip' && !h))) return;
    if (cur) cur.remove();
    if (h) {
      // آخر عنصر في الهيدر؛ الاتجاه RTL يضعه عند الطرف الأيسر بجانب أزرار المستخدم
      h.appendChild(build(true));
    } else {
      document.body.insertBefore(build(false), document.body.firstChild);
    }
  }

  function start() {
    mount();
    try {
      var t = null;
      new MutationObserver(function () {
        if (t) return;
        t = setTimeout(function () { t = null; if (!document.getElementById(ID)) mount(); }, 250);
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    setTimeout(mount, 1500); setTimeout(mount, 4000);
  }
  if (document.readyState === 'complete') setTimeout(start, 300); else window.addEventListener('load', function () { setTimeout(start, 300); });
})();
