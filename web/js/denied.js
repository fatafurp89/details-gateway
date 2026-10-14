// Denied page: message by reason
'use strict';
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('r') === 'google') {
    $('title').textContent = 'الحساب غير مرتبط بموظف نشط';
    $('msg').textContent = 'حساب Google الذي اخترته غير مرتبط بموظف نشط في ديتيلز. استخدم الرقم الوظيفي أو اطلب من مدير النظام ربط بريدك.';
    $('home').textContent = 'العودة إلى تسجيل الدخول';
    $('home').href = '/login';
  } else if (q.get('r') === 'blocked') {
    $('title').textContent = 'تم حظر المحاولة مؤقتًا';
    $('msg').textContent = 'حساب Google الذي تستخدمه غير مسجّل لدى ديتيلز، وتكررت المحاولة. أُوقفت محاولات الدخول من هذا الحساب والعنوان لمدة 30 دقيقة وسُجّلت للمراجعة. إن كنت موظفًا فاطلب من مدير النظام ربط بريدك.';
    $('home').textContent = 'العودة إلى تسجيل الدخول';
    $('home').href = '/login';
  } else if (q.get('r') === 'admin') {
    $('title').textContent = 'هذه الصفحة للمدير فقط';
    $('msg').textContent = 'صفحة الإدارة متاحة لمديري النظام فقط.';
  }
})();
