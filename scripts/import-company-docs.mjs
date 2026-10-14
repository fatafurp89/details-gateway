// استيراد مستندات «بيانات المنشأة» من حزمة جاهزة: <dir>/manifest.json + الملفات (+ secrets.json اختياري).
// الاستخدام (على الخادم، بحساب details-gateway وبيئة الخدمة):  node scripts/import-company-docs.mjs /path/to/stage
// آمن للتكرار: يُعرَّف الملف ببصمة sha256 داخل المستند؛ لا يُكرَّر. الأسرار (secrets.json) تُشفَّر بـ SECRETS_KEY وتُحفظ في infra_secrets فقط
// (لا تُسجَّل ولا تُطبع ولا تدخل أعمدة نصية). لا يعتمد على مسارات الخادم الرئيسي.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createPool, tx } from '../src/lib/db.js';
import { storeFile, storagePathFor, safeName, mimeFor } from '../src/lib/storage.js';
import { parseKey, seal } from '../src/lib/secretbox.js';
import { audit } from '../src/lib/audit.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: import-company-docs.mjs <stage-dir>'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
let secrets = [];
try { secrets = JSON.parse(await readFile(join(dir, 'secrets.json'), 'utf8')); } catch { /* none */ }
const db = createPool(process.env.DATABASE_URL);
const fileUrl = (docId, vid) => `/api/company/documents/${docId}/versions/${vid}/file`;
const out = { docs_created: 0, docs_updated: 0, versions_added: 0, versions_adopted: 0, versions_skipped: 0, owners: 0, platforms: 0, banks: 0, secrets_added: 0, secrets_skipped: 0 };
const sha = async (p) => createHash('sha256').update(await readFile(p)).digest('hex');

async function syncCurrent(c, docId) {
  const { rows: [cur] } = await c.query('SELECT file_url, file_name, issued_on, expires_on FROM company_document_versions WHERE document_id = $1 AND is_current', [docId]);
  if (cur) await c.query('UPDATE company_documents SET file_url=$2, file_name=$3, issued_on=$4, expires_on=$5, updated_at=now() WHERE id=$1', [docId, cur.file_url, cur.file_name, cur.issued_on, cur.expires_on]);
  else await c.query('UPDATE company_documents SET file_url=NULL, file_name=NULL, issued_on=NULL, expires_on=NULL, updated_at=now() WHERE id=$1', [docId]);
}

async function importDoc(d) {
  await tx(db, async (c) => {
    let { rows: [row] } = await c.query('SELECT id FROM company_documents WHERE title_ar = $1', [d.title_ar]);
    if (!row && d.rename_from) ({ rows: [row] } = await c.query('SELECT id FROM company_documents WHERE title_ar = $1', [d.rename_from]));
    if (!row) {
      ({ rows: [row] } = await c.query('INSERT INTO company_documents (title_ar, kind) VALUES ($1,$2) RETURNING id', [d.title_ar, d.kind]));
      out.docs_created++;
    } else out.docs_updated++;
    await c.query(`UPDATE company_documents SET title_ar=$2, kind=$3, doc_number=$4, issuer_ar=$5, admin_only=$6, notes=$7, sort=$8, updated_at=now() WHERE id=$1`,
      [row.id, d.title_ar, d.kind, d.doc_number ?? null, d.issuer_ar ?? null, !!d.admin_only, d.notes ?? null, d.sort ?? 100]);
    const placed = []; // [versionId, wantsCurrent]
    for (const v of d.versions || []) {
      const abs = v.stage ? join(dir, v.stage) : null;
      const hash = abs ? await sha(abs) : null;
      const common = [v.issued_on ?? null, v.expires_on ?? null, v.notes ?? null];
      // same file already in this document -> refresh the metadata only
      if (hash) {
        const { rows: [dup] } = await c.query('SELECT id FROM company_document_versions WHERE document_id = $1 AND sha256 = $2', [row.id, hash]);
        if (dup) {
          await c.query('UPDATE company_document_versions SET issued_on=$2, expires_on=$3, notes=$4 WHERE id=$1', [dup.id, ...common]);
          placed.push([dup.id, !!v.current]); out.versions_skipped++; continue;
        }
      }
      const name = safeName(v.file_name || (abs ? abs.split(/[\\/]/).pop() : ''));
      // adopt the seeded, file-less version (file name only) instead of adding a duplicate
      let target = null;
      if (v.adopt && hash) ({ rows: [target] } = await c.query('SELECT id, version_no FROM company_document_versions WHERE document_id = $1 AND storage_path IS NULL ORDER BY version_no LIMIT 1', [row.id]));
      if (target) {
        const st = await storeFile(storagePathFor(row.id, target.version_no, name), abs);
        await c.query(`UPDATE company_document_versions SET file_name=$2, file_url=$3, storage_path=$4, size=$5, sha256=$6, mime=$7, issued_on=$8, expires_on=$9, notes=$10 WHERE id=$1`,
          [target.id, name, fileUrl(row.id, target.id), st.storage_path, st.size, st.sha256, mimeFor(name), ...common]);
        placed.push([target.id, !!v.current]); out.versions_adopted++; continue;
      }
      const { rows: [m] } = await c.query('SELECT COALESCE(max(version_no),0)+1 AS n FROM company_document_versions WHERE document_id = $1', [row.id]);
      const n = Number(m.n);
      let st = null;
      if (abs) st = await storeFile(storagePathFor(row.id, n, name), abs);
      const { rows: [nv] } = await c.query(
        `INSERT INTO company_document_versions (document_id, version_no, file_name, issued_on, expires_on, notes, is_current, storage_path, size, sha256, mime)
         VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10) RETURNING id`, [row.id, n, name || null, ...common, st?.storage_path ?? null, st?.size ?? null, st?.sha256 ?? null, st ? mimeFor(name) : null]);
      if (st) await c.query('UPDATE company_document_versions SET file_url = $2 WHERE id = $1', [nv.id, fileUrl(row.id, nv.id)]);
      placed.push([nv.id, !!v.current]); out.versions_added++;
    }
    const want = placed.filter(([, cur]) => cur).pop();
    if (want) {
      await c.query('UPDATE company_document_versions SET is_current = false WHERE document_id = $1 AND is_current AND id <> $2', [row.id, want[0]]);
      await c.query('UPDATE company_document_versions SET is_current = true WHERE id = $1', [want[0]]);
    }
    await syncCurrent(c, row.id);
  });
}

async function importOwner(o) {
  const { rows: [r] } = await db.query('SELECT id FROM company_owners WHERE name_ar = $1', [o.name_ar]);
  const vals = [o.name_ar, o.name_en ?? '', o.entity_kind ?? 'person', o.id_number ?? null, o.nationality ?? null, o.share_pct ?? null, o.role ?? 'owner', o.since ?? null, o.notes ?? null, o.sort ?? 100];
  if (r) await db.query('UPDATE company_owners SET name_ar=$2, name_en=$3, entity_kind=$4, id_number=$5, nationality=$6, share_pct=$7, role=$8, since=$9, notes=$10, sort=$11, updated_at=now() WHERE id=$1', [r.id, ...vals]);
  else await db.query('INSERT INTO company_owners (name_ar, name_en, entity_kind, id_number, nationality, share_pct, role, since, notes, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', vals);
  out.owners++;
}

async function importPlatform(p) {
  let { rows: [r] } = await db.query('SELECT id FROM company_platforms WHERE name_ar = $1', [p.name_ar]);
  if (!r && p.rename_from) ({ rows: [r] } = await db.query('SELECT id FROM company_platforms WHERE name_ar = $1', [p.rename_from]));
  let ql = null;
  if (p.quick_link_url) ({ rows: [ql] } = await db.query('SELECT id FROM quick_links WHERE url = $1 LIMIT 1', [p.quick_link_url]));
  const vals = [p.name_ar, p.category ?? 'government', p.url ?? null, p.account_username ?? null, p.role_ar ?? null, p.status ?? 'active', p.notes ?? null, ql?.id ?? null, p.sort ?? 100];
  if (r) {
    await db.query(`UPDATE company_platforms SET name_ar=$2, category=$3, url=$4, account_username=COALESCE($5, account_username), role_ar=COALESCE($6, role_ar), status=$7, notes=$8,
      quick_link_id=COALESCE($9, quick_link_id), sort=$10, updated_at=now() WHERE id=$1`, [r.id, ...vals]);
  } else {
    await db.query(`INSERT INTO company_platforms (name_ar, category, url, account_username, role_ar, status, notes, quick_link_id, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, vals);
  }
  out.platforms++;
}

async function importBank(b) {
  const doc = b.document_title ? (await db.query('SELECT id FROM company_documents WHERE title_ar = $1', [b.document_title])).rows[0] : null;
  const plat = b.platform_name ? (await db.query('SELECT id FROM company_platforms WHERE name_ar = $1', [b.platform_name])).rows[0] : null;
  const vals = [b.bank_name_ar, b.bank_name_en ?? '', b.account_name ?? '', b.iban ?? null, b.account_no ?? null, b.customer_no ?? null, b.swift ?? null, b.currency ?? 'SAR', b.account_type ?? null,
    b.branch ?? null, b.opened_on ?? null, b.status ?? 'active', b.signatories_ar ?? null, doc?.id ?? null, plat?.id ?? null, b.secret_node_key ?? null, b.secret_ref ?? null, b.notes ?? null, b.sort ?? 100];
  const { rows: [r] } = await db.query('SELECT id FROM company_bank_accounts WHERE iban = $1', [b.iban]);
  if (r) await db.query(`UPDATE company_bank_accounts SET bank_name_ar=$2, bank_name_en=$3, account_name=$4, iban=$5, account_no=$6, customer_no=$7, swift=$8, currency=$9, account_type=$10, branch=$11,
    opened_on=$12, status=$13, signatories_ar=$14, document_id=$15, platform_id=$16, secret_node_key=$17, secret_ref=$18, notes=$19, sort=$20, updated_at=now() WHERE id=$1`, [r.id, ...vals]);
  else await db.query(`INSERT INTO company_bank_accounts (bank_name_ar, bank_name_en, account_name, iban, account_no, customer_no, swift, currency, account_type, branch, opened_on, status, signatories_ar,
    document_id, platform_id, secret_node_key, secret_ref, notes, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`, vals);
  out.banks++;
}

async function importSecrets() {
  if (!secrets.length) return;
  const key = parseKey(process.env.SECRETS_KEY || '');
  if (!key) throw new Error('SECRETS_KEY missing/invalid: refusing to store secrets');
  for (const s of secrets) {
    const { rows: [ex] } = await db.query('SELECT id FROM infra_secrets WHERE node_key = $1 AND label_ar = $2', [s.node_key, s.label_ar]);
    if (ex) { out.secrets_skipped++; }
    else {
      const box = seal(s.secret, key, 'infra_secrets');
      await db.query('INSERT INTO infra_secrets (node_key, label_ar, username, secret_enc, iv) VALUES ($1,$2,$3,$4,$5)', [s.node_key, s.label_ar, s.username ?? null, box.enc, box.iv]);
      out.secrets_added++;
    }
    // link the platform to the secret by NAME only (never the value)
    if (s.platform_name) await db.query('UPDATE company_platforms SET secret_node_key=$2, secret_ref=$3, updated_at=now() WHERE name_ar=$1', [s.platform_name, s.node_key, s.label_ar]);
  }
}

try {
  for (const o of manifest.owners || []) await importOwner(o);
  for (const p of manifest.platforms || []) await importPlatform(p);
  for (const d of manifest.documents || []) await importDoc(d);
  await importSecrets();
  for (const b of manifest.bank_accounts || []) await importBank(b);
  if (manifest.profile) {
    const keys = Object.keys(manifest.profile);
    if (keys.length) await db.query(`UPDATE company_profile SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = 1`, keys.map((k) => manifest.profile[k]));
  }
  await audit(db, { actor: null, action: 'company.import', target: 'company', meta: out, ip: null });
  console.log(JSON.stringify({ level: 30, msg: 'company import done', ...out }));
} catch (e) {
  console.error(JSON.stringify({ level: 50, msg: 'company import failed', err: e.message }));
  process.exitCode = 1;
} finally {
  await db.end();
}
