// One-off (safe to re-run): classify every stored notification (work/technical) with src/lib/notify-categories.js and rewrite
// the technical ones in plain Arabic with src/lib/notify-plain.js. The original text is kept in meta.details.
//   DATABASE_URL=... node scripts/rewrite-notifications.mjs          # dry run: prints before/after, changes nothing
//   DATABASE_URL=... node scripts/rewrite-notifications.mjs --apply  # writes (run migration 0018 first)
import pg from 'pg';
import { categorize } from '../src/lib/notify-categories.js';
import { applyPlain } from '../src/lib/notify-plain.js';

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const { rows } = await db.query('SELECT id, system_key, kind, title_ar, body_ar, severity, source_ref, meta FROM notifications ORDER BY created_at');
  let changed = 0, technical = 0, work = 0, skipped = 0;
  const seen = new Set();
  for (const r of rows) {
    if (r.meta?.plain === true) { skipped++; continue; }
    const category = categorize({ system: r.system_key, kind: r.kind, source_ref: r.source_ref, title_ar: r.title_ar, body_ar: r.body_ar });
    const out = applyPlain({ system: r.system_key, kind: r.kind, severity: r.severity, source_ref: r.source_ref, title_ar: r.title_ar, body_ar: r.body_ar, meta: r.meta || {}, category });
    category === 'technical' ? technical++ : work++;
    const dup = `${r.system_key}|${r.source_ref}|${out.title_ar}`; // the same event is stored once per recipient: print one sample
    if (category === 'technical' && !seen.has(dup)) {
      seen.add(dup);
      console.log(`--- [${category}] ${r.system_key}/${r.kind}  rule=${out.meta.plain_rule}`);
      console.log(`  قبل : ${r.title_ar}\n        ${r.body_ar}`);
      console.log(`  بعد : ${out.title_ar}\n        ${out.body_ar}\n  ماذا يعني؟ ${out.meta.means}\n  ما المطلوب؟ ${out.meta.todo}`);
    }
    if (!apply) continue;
    await db.query('UPDATE notifications SET category = $2, title_ar = $3, body_ar = $4, meta = $5 WHERE id = $1',
      [r.id, category, out.title_ar, out.body_ar, JSON.stringify(out.meta)]);
    changed++;
  }
  console.log(`\n${apply ? 'applied' : 'dry run'}: ${rows.length} rows, ${technical} technical, ${work} work, ${skipped} already plain${apply ? `, ${changed} updated` : ''}`);
} finally {
  await db.end();
}
