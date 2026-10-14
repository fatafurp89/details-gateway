// فحص الصلاحيات اليومي لـ«بيانات المنشأة»: المستندات والمنصات والتفويضات المنتهية أو التي تنتهي خلال 30 يومًا
// -> إشعارات في مركز الإشعارات (system_key 'company') لكل المشرفين (ولصاحب الحساب إن وُجد). آمن للتكرار: مرجع واحد لكل (عنصر، حالة).
// يُشغَّل بمؤقّت systemd (deploy/company-expiry-sweep.timer) أو فورًا من POST /api/admin/company/sweep.
import { pathToFileURL } from 'node:url';
import { expiryAlerts, alertNotifications } from '../lib/company.js';
import { insertNotifications } from '../routes/notifications.js';
import { tx } from '../lib/db.js';

export const SWEEP_SYSTEM = 'company';

/** Runs the sweep on a pool; returns { alerts, inserted, recipients }. */
export async function runExpirySweep(db, now = new Date()) {
  const [{ rows: documents }, { rows: platforms }, { rows: delegations }, { rows: admins }] = await Promise.all([
    // documents of the foreign entities carry the entity name in the title (the main Saudi entity keeps the plain title)
    db.query(`SELECT d.id, CASE WHEN e.id IS NOT NULL AND e.profile_id IS NULL THEN e.name_ar || ' — ' || d.title_ar ELSE d.title_ar END AS title_ar, d.expires_on::text AS expires_on
      FROM company_documents d LEFT JOIN company_entities e ON e.id = d.entity_id WHERE d.expires_on IS NOT NULL`),
    db.query('SELECT id, name_ar, expiry_date::text AS expiry_date, status, account_holder_id FROM company_platforms WHERE expiry_date IS NOT NULL'),
    db.query('SELECT id, delegate_name, valid_to::text AS valid_to, status, employee_id FROM company_delegations WHERE valid_to IS NOT NULL'),
    db.query("SELECT id FROM employees WHERE role = 'admin' AND active AND (expires_at IS NULL OR expires_at > now())"),
  ]);
  const alerts = expiryAlerts({ documents, platforms, delegations }, now);
  const rows = alertNotifications(alerts);
  const adminIds = admins.map((a) => a.id);
  const inserted = await tx(db, async (c) => {
    let n = 0;
    for (const r of rows) {
      const recipients = [...new Set([...adminIds, ...(r.employee_id ? [r.employee_id] : [])])];
      n += await insertNotifications(c, { system: SWEEP_SYSTEM, category: 'work', ...r }, recipients);
    }
    return n;
  });
  return { alerts: alerts.length, inserted, recipients: adminIds.length };
}

// CLI: node src/jobs/expiry-sweep.js (reads DATABASE_URL)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { createPool } = await import('../lib/db.js');
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
  const db = createPool(url);
  try {
    const out = await runExpirySweep(db);
    console.log(JSON.stringify({ level: 30, msg: 'company expiry sweep', ...out }));
  } catch (err) {
    console.error(JSON.stringify({ level: 50, msg: 'company expiry sweep failed', err: err.message }));
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
