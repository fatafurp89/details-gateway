import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { safeName, mimeFor, storagePathFor, absPath, storeStream, openStored, removeStored, contentDisposition } from '../src/lib/storage.js';
import { maskBankAccounts, validateBankAccount, validateDocument, DOCUMENT_KINDS } from '../src/lib/company.js';

const DOC = '0b1c2d3e-aaaa-bbbb-cccc-1234567890ab';

test('safeName: strips path chars and traversal, keeps Arabic, never empty', () => {
  assert.equal(safeName('../../etc/passwd'), 'etc passwd');
  assert.equal(safeName('السجل التجاري.pdf'), 'السجل التجاري.pdf');
  assert.equal(safeName('a/b\c:d*?.png'), 'a bc d .png');
  assert.equal(safeName(''), 'file');
  assert.equal(safeName('...'), 'file');
  assert.ok(safeName('x'.repeat(300) + '.pdf').length <= 120);
  assert.ok(safeName('x'.repeat(300) + '.pdf').endsWith('.pdf'));
});

test('mimeFor trusts the extension only and refuses unknown types', () => {
  assert.equal(mimeFor('a.PDF'), 'application/pdf');
  assert.equal(mimeFor('a.jpeg'), 'image/jpeg');
  assert.equal(mimeFor('a.png'), 'image/png');
  assert.equal(mimeFor('a.exe'), null);
  assert.equal(mimeFor('a.html'), null);
  assert.equal(mimeFor('a.svg'), null);
  assert.equal(mimeFor('noext'), null);
});

test('storagePathFor + absPath: company/<doc>/<n>-<name>, stays inside the files root', () => {
  process.env.FILES_DIR = join(tmpdir(), 'gw-files-test');
  assert.equal(storagePathFor(DOC, 2, 'x y.pdf'), `company/${DOC}/2-x y.pdf`);
  assert.throws(() => storagePathFor('../x', 1, 'a.pdf'));
  assert.throws(() => storagePathFor(DOC, 0, 'a.pdf'));
  assert.throws(() => absPath('../../etc/passwd'));
  assert.ok(absPath(`company/${DOC}/1-a.pdf`).startsWith(join(tmpdir(), 'gw-files-test')));
});

test('storeStream: writes atomically with size + sha256; limit aborts and leaves no file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gwf-'));
  process.env.FILES_DIR = root;
  try {
    const rel = storagePathFor(DOC, 1, 'hello.txt');
    const r = await storeStream(rel, Readable.from([Buffer.from('hello '), Buffer.from('world')]));
    assert.equal(r.size, 11);
    assert.equal(r.sha256, 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    assert.equal((await readFile(absPath(rel))).toString(), 'hello world');
    const f = await openStored(rel);
    assert.equal(f.size, 11);
    f.stream.destroy();
    await assert.rejects(() => storeStream(storagePathFor(DOC, 2, 'big.txt'), Readable.from([Buffer.alloc(20)]), { limit: 10 }), { code: 'FILE_TOO_LARGE' });
    assert.equal(await openStored(storagePathFor(DOC, 2, 'big.txt')), null);
    await removeStored(rel);
    assert.equal(await openStored(rel), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('contentDisposition: ASCII fallback + UTF-8 name, inline vs attachment', () => {
  const h = contentDisposition('السجل "x".pdf', true);
  assert.match(h, /^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.ok(!h.includes('\n'));
  assert.match(contentDisposition('a.pdf', false), /^attachment;/);
});

test('maskBankAccounts: IBAN/account/customer masked for non-admin, full for admin', () => {
  const a = [{ iban: 'SA8245000000091065706001', account_no: '091065706001', customer_no: '091065706', bank_name_ar: 'ساب' }];
  const m = maskBankAccounts(a, false)[0];
  assert.equal(m.iban, '••••••••6001');
  assert.equal(m.account_no, '••••••••6001');
  assert.equal(m.bank_name_ar, 'ساب');
  assert.equal(maskBankAccounts(a, true)[0].iban, 'SA8245000000091065706001');
});

test('validateBankAccount: IBAN normalised and validated; bank name required', () => {
  const ok = validateBankAccount({ bank_name_ar: 'ساب', iban: 'sa82 4500 0000 0910 6570 6001', opened_on: '2025-12-11' });
  assert.equal(ok.value.iban, 'SA8245000000091065706001');
  assert.equal(ok.value.currency, 'SAR');
  assert.ok(validateBankAccount({ iban: 'SA82' }).error);
  assert.ok(validateBankAccount({ bank_name_ar: 'x', iban: 'not-an-iban' }).error);
  assert.ok(validateBankAccount({ bank_name_ar: 'x', opened_on: '2025-13-40' }).error);
  assert.ok(validateBankAccount({ bank_name_ar: 'x', secret_node_key: 'Bad Key' }).error);
});

test('validateDocument: new kinds, doc number / issuer / admin_only', () => {
  for (const k of ['lease', 'certificate', 'invoice', 'bank']) assert.ok(DOCUMENT_KINDS.includes(k));
  const v = validateDocument({ title_ar: 'عقد', kind: 'lease', doc_number: '123', issuer_ar: 'إيجار', admin_only: true });
  assert.deepEqual([v.value.kind, v.value.doc_number, v.value.issuer_ar, v.value.admin_only], ['lease', '123', 'إيجار', true]);
  assert.equal(validateDocument({ title_ar: 'x' }).value.admin_only, false);
  assert.ok(validateDocument({ title_ar: 'x', kind: 'nope' }).error);
});
