// Append-only audit log + login attempt records
export async function audit(db, { actor = null, action, target = null, meta = {}, ip = null }) {
  await db.query(
    'INSERT INTO audit_log (actor_employee_id, action, target, meta, ip) VALUES ($1, $2, $3, $4, $5)',
    [actor, action, target, JSON.stringify(meta), ip]);
}

// Every login attempt goes to login_attempts (rate limiting) and audit_log (history)
export async function recordAttempt(db, { identifier, ip, ok, reason, employeeId = null }) {
  await db.query('INSERT INTO login_attempts (identifier, ip, ok, reason) VALUES ($1, $2, $3, $4)',
    [String(identifier || '-').slice(0, 200), ip, ok, reason]);
  await audit(db, { actor: employeeId, action: `login.${reason}`, target: String(identifier || '-').slice(0, 200), meta: { ok }, ip });
}
