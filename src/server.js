// Details Gateway — entry point (listens on 127.0.0.1:4000 behind nginx)
import { loadConfig } from './config.js';
import { createPool } from './lib/db.js';
import { audit } from './lib/audit.js';
import { validateEmployee } from './lib/validate.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
const db = createPool(cfg.databaseUrl);
const app = await buildApp({ cfg, db });

// First run: create the admin from BOOTSTRAP_ADMIN_* when employees is empty
async function bootstrap() {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM employees');
  if (rows[0].n > 0) return;
  const b = cfg.bootstrap;
  const v = validateEmployee({ employee_no: b.employeeNo, full_name: b.name, email: b.email, role: 'admin' });
  if (v.error) { app.log.warn('employees table empty and BOOTSTRAP_ADMIN_* not valid; no admin created'); return; }
  const r = await db.query(
    `INSERT INTO employees (employee_no, full_name, email, role) VALUES ($1, $2, $3, 'admin')
     ON CONFLICT DO NOTHING RETURNING id`, [v.value.employee_no, v.value.full_name, v.value.email]);
  if (r.rows[0]) {
    await audit(db, { action: 'bootstrap.admin', target: v.value.employee_no });
    app.log.info({ employee_no: v.value.employee_no }, 'bootstrap admin created');
  }
}

// Housekeeping: drop stale OTPs and very old sessions
async function cleanup() {
  try {
    await db.query("DELETE FROM otp_codes WHERE created_at < now() - interval '1 day'");
    await db.query("DELETE FROM sessions WHERE expires_at < now() - interval '30 days'");
  } catch (err) { app.log.error({ err }, 'cleanup failed'); }
}

await bootstrap();
setInterval(cleanup, 60 * 60 * 1000).unref();

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => { await app.close(); await db.end(); process.exit(0); });
}

await app.listen({ host: cfg.host, port: cfg.port });
