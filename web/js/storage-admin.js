(() => {
  const rowsEl = document.getElementById('rows');
  const errEl = document.getElementById('err');

  function showErr(msg) { errEl.hidden = false; errEl.textContent = msg; }

  function render(list) {
    if (!list.length) { rowsEl.innerHTML = '<tr><td colspan="5">لا يوجد موظفون مصرّح لهم بنظام مستكشف الملفات بعد.</td></tr>'; return; }
    rowsEl.replaceChildren(...list.map((e) => {
      const tr = document.createElement('tr');
      const tdNo = document.createElement('td'); tdNo.textContent = e.employeeNo;
      const tdName = document.createElement('td'); tdName.textContent = e.fullName;
      const tdActive = document.createElement('td');
      const activeBadge = document.createElement('span'); activeBadge.className = 'sa-badge ' + (e.active ? 'yes' : 'no');
      activeBadge.textContent = e.active ? 'نشط' : 'موقوف'; tdActive.append(activeBadge);
      const tdAcc = document.createElement('td');
      const accBadge = document.createElement('span'); accBadge.className = 'sa-badge ' + (e.hasAccount ? 'yes' : 'no');
      accBadge.textContent = e.hasAccount ? 'موجود' : 'غير موجود'; tdAcc.append(accBadge);
      const tdAction = document.createElement('td');
      if (!e.hasAccount) {
        const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = 'إنشاء حساب';
        btn.onclick = async () => {
          btn.disabled = true; btn.textContent = 'جارٍ الإنشاء…';
          try {
            const r = await fetch(`/api/storage-admin/employees/${e.employeeNo}/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'فشل الإنشاء');
            await load();
          } catch (err) { showErr(err.message); btn.disabled = false; btn.textContent = 'إنشاء حساب'; }
        };
        tdAction.append(btn);
      }
      tr.append(tdNo, tdName, tdActive, tdAcc, tdAction);
      return tr;
    }));
  }

  async function load() {
    errEl.hidden = true;
    try {
      const r = await fetch('/api/storage-admin/employees');
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'تعذر جلب البيانات');
      render(await r.json());
    } catch (err) { showErr(err.message); rowsEl.innerHTML = ''; }
  }

  load();
})();
