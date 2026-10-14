// إدارة مستخدمي مستكشف الملفات (File Browser على WMS VPS): عرض الموظفين المصرح لهم بنظام storage
// وإنشاء حساب وصول فعلي لمن يختاره المدير. محمي بصلاحية storage.manage_users (أو admin عام).
import { requireUser, MSG, sendPage, currentUser } from './helpers.js';
import { audit } from '../lib/audit.js';

const STORAGE_ADMIN_URL = process.env.STORAGE_ADMIN_URL || 'http://10.9.0.4:8091';
const STORAGE_ADMIN_SECRET = process.env.STORAGE_ADMIN_SECRET || '';

async function hasManagePerm(db, employeeId, role) {
  if (role === 'admin') return true;
  const { rows } = await db.query(
    `SELECT 1 FROM perm_grants WHERE employee_id = $1 AND perm_key = 'storage.manage_users' AND allowed LIMIT 1`,
    [employeeId]
  );
  return rows.length > 0;
}

const guard = (app) => async (req, reply) => {
  req.user = await currentUser(app, req);
  if (!req.user) return reply.code(401).send({ error: MSG.auth });
  const ok = await hasManagePerm(app.db, req.user.employee_id, req.user.role);
  if (!ok) return reply.code(403).send({ error: MSG.forbidden });
};

async function callStorageAdmin(path, options = {}) {
  if (!STORAGE_ADMIN_SECRET) throw new Error('STORAGE_ADMIN_SECRET غير مهيأ');
  const res = await fetch(`${STORAGE_ADMIN_URL}${path}`, {
    ...options,
    headers: { 'X-Admin-Key': STORAGE_ADMIN_SECRET, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`storage-admin ${path}: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json().catch(() => ({}));
}

export default async function storageAdminRoutes(app) {
  const { db } = app;

  app.get('/storage-admin', { preHandler: requireUser(app) }, async (req, reply) => sendPage(reply, 'storage-admin.html'));

  // الموظفون المصرح لهم بنظام storage (من grants) + حالتهم الفعلية على File Browser
  app.get('/api/storage-admin/employees', { preHandler: guard(app) }, async (req, reply) => {
    const { rows } = await db.query(
      `SELECT e.id, trim(e.employee_no) AS employee_no, e.full_name, e.active
         FROM grants g JOIN employees e ON e.id = g.employee_id
        WHERE g.system_key = 'storage'
        ORDER BY e.employee_no`
    );
    let existingUsers = [];
    try {
      const data = await callStorageAdmin('/list-users', { method: 'GET' });
      existingUsers = data.users || [];
    } catch (e) {
      req.log.warn({ err: e }, 'تعذر الاتصال بخدمة storage-admin على WMS');
      return reply.code(502).send({ error: 'تعذر الاتصال بخادم مستكشف الملفات الآن' });
    }
    return rows.map((r) => ({
      id: r.id,
      employeeNo: r.employee_no,
      fullName: r.full_name,
      active: r.active,
      hasAccount: existingUsers.includes(r.employee_no),
    }));
  });

  // إنشاء حساب وصول فعلي لموظف مُختار (الاسم = الرقم الوظيفي، مطابقة مع X-Gw-Employee-No)
  app.post('/api/storage-admin/employees/:employeeNo/create', { preHandler: guard(app) }, async (req, reply) => {
    const empNo = String(req.params.employeeNo || '');
    if (!/^\d{4}$/.test(empNo)) return reply.code(400).send({ error: MSG.badRequest });
    const { rows } = await db.query(
      `SELECT 1 FROM grants WHERE system_key = 'storage' AND employee_id = (SELECT id FROM employees WHERE trim(employee_no) = $1)`,
      [empNo]
    );
    if (!rows.length) return reply.code(404).send({ error: 'هذا الموظف غير مصرّح له بنظام مستكشف الملفات أصلاً' });
    try {
      const result = await callStorageAdmin('/create-user', { method: 'POST', body: JSON.stringify({ employee_no: empNo }) });
      await audit(db, { actor: req.user.employee_id, action: 'storage.create_user', target: empNo, meta: result, ip: req.ip });
      return result;
    } catch (e) {
      req.log.error({ err: e }, 'فشل إنشاء مستخدم مستكشف الملفات');
      return reply.code(502).send({ error: 'تعذر إنشاء الحساب على خادم مستكشف الملفات' });
    }
  });
}
