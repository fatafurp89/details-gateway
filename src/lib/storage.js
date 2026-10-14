// تخزين ملفات المستندات على القرص: FILES_DIR (افتراضيًا /opt/details-gateway/files)
// المسار المخزَّن في قاعدة البيانات نسبي: company/<doc_id>/<version>-<name> (بلا ".." ولا فواصل مسارات داخل الاسم)
import { createHash } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, stat, rm, rename, copyFile } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_MIME = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/msword': '.doc', 'application/vnd.ms-excel': '.xls', 'text/plain': '.txt',
};
const EXT_MIME = Object.fromEntries(Object.entries(ALLOWED_MIME).map(([m, e]) => [e, m]));
EXT_MIME['.jpeg'] = 'image/jpeg';

export function filesRoot() {
  return resolve(process.env.FILES_DIR || '/opt/details-gateway/files');
}

/** MIME from the extension (the browser's claim is not trusted). null if not allowed. */
export function mimeFor(name) {
  return EXT_MIME[extname(String(name || '')).toLowerCase()] || null;
}

/** File name safe for disk and headers: keeps Arabic letters, digits, dot, dash, underscore, space; ≤120 chars; never empty. */
export function safeName(name) {
  let s = String(name || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\.\.+/g, '.').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s]+/, '');
  if (s.length > 120) { const ext = extname(s); s = s.slice(0, 120 - ext.length) + ext; }
  return s || 'file';
}

/** Relative storage path for a version file. */
export function storagePathFor(docId, versionNo, name) {
  if (!/^[0-9a-f-]{36}$/.test(docId) || !Number.isInteger(versionNo) || versionNo < 1) throw new Error('bad storage key');
  return `company/${docId}/${versionNo}-${safeName(name)}`;
}

/** Absolute path inside the root; throws on traversal. */
export function absPath(rel) {
  const root = filesRoot();
  const p = resolve(root, String(rel || ''));
  if (p !== root && !p.startsWith(root + sep)) throw new Error('path outside files root');
  return p;
}

class HashCounter extends Transform {
  constructor(limit) { super(); this.hash = createHash('sha256'); this.size = 0; this.limit = limit; }
  _transform(chunk, enc, cb) {
    this.size += chunk.length;
    if (this.size > this.limit) return cb(Object.assign(new Error('file too large'), { code: 'FILE_TOO_LARGE' }));
    this.hash.update(chunk); cb(null, chunk);
  }
}

/** Write a readable stream to rel path (atomic: temp then rename). Returns { storage_path, size, sha256 }. */
export async function storeStream(rel, stream, { limit = MAX_FILE_BYTES } = {}) {
  const dest = absPath(rel);
  await mkdir(resolve(dest, '..'), { recursive: true, mode: 0o750 });
  const tmp = dest + '.part';
  const hc = new HashCounter(limit);
  try {
    await pipeline(stream, hc, createWriteStream(tmp, { mode: 0o640 }));
    await rename(tmp, dest);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return { storage_path: rel, size: hc.size, sha256: hc.hash.digest('hex') };
}

/** Copy a local file into storage (import scripts). */
export async function storeFile(rel, src) {
  return storeStream(rel, createReadStream(src));
}

/** { stream, size } for an existing stored file, or null. */
export async function openStored(rel) {
  const p = absPath(rel);
  let s;
  try { s = await stat(p); } catch { return null; }
  if (!s.isFile()) return null;
  return { stream: createReadStream(p), size: s.size };
}

export async function removeStored(rel) {
  if (!rel) return;
  await rm(absPath(rel), { force: true });
}

/** Remove a whole document directory (after the DB cascade). */
export async function removeDocumentDir(docId) {
  if (!/^[0-9a-f-]{36}$/.test(docId)) return;
  await rm(absPath(join('company', docId)), { recursive: true, force: true });
}

/** RFC 5987 Content-Disposition with an ASCII fallback. */
export function contentDisposition(name, inline = true) {
  const safe = safeName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
