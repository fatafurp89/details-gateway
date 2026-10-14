// Apply numbered SQL migrations from migrations/ (tracked in schema_migrations)
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(dir + f, 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
      await client.query('COMMIT');
      applied++;
      console.log(`applied ${f}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`${f}: ${e.message}`);
    }
  }
  console.log(`migrations ok (${applied} new, ${files.length} total)`);
} catch (e) {
  console.error(`migration failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
