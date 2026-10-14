// PostgreSQL pool + transaction helper
import pg from 'pg';

export function createPool(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
  pool.on('error', (err) => console.error(JSON.stringify({ level: 50, msg: 'pg pool error', err: err.message })));
  return pool;
}

export async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
