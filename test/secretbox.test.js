import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKey, seal, open, IV_BYTES, TAG_BYTES } from '../src/lib/secretbox.js';

const KEY = parseKey('a'.repeat(64));

test('parseKey accepts only 64 hex chars', () => {
  assert.equal(parseKey(''), null);
  assert.equal(parseKey('abc'), null);
  assert.equal(parseKey('z'.repeat(64)), null);
  assert.equal(parseKey(undefined), null);
  assert.equal(KEY.length, 32);
});

test('seal/open round-trips unicode, fresh iv each time, tag appended', () => {
  const a = seal('كلمة سرّ 🔐 p@ss', KEY, 'node:bridge');
  const b = seal('كلمة سرّ 🔐 p@ss', KEY, 'node:bridge');
  assert.equal(a.iv.length, IV_BYTES);
  assert.notDeepEqual(a.iv, b.iv);
  assert.notDeepEqual(a.enc, b.enc);
  assert.equal(a.enc.length, Buffer.byteLength('كلمة سرّ 🔐 p@ss') + TAG_BYTES);
  assert.equal(open(a, KEY, 'node:bridge'), 'كلمة سرّ 🔐 p@ss');
});

test('open fails on wrong key, wrong aad or tampered bytes', () => {
  const box = seal('secret', KEY, 'x');
  assert.throws(() => open(box, parseKey('b'.repeat(64)), 'x'));
  assert.throws(() => open(box, KEY, 'y'));
  const t = Buffer.from(box.enc); t[0] ^= 1;
  assert.throws(() => open({ iv: box.iv, enc: t }, KEY, 'x'));
  assert.throws(() => open({ iv: box.iv.subarray(1), enc: box.enc }, KEY, 'x'));
});

test('seal rejects empty / too long / bad key', () => {
  assert.throws(() => seal('', KEY));
  assert.throws(() => seal('x'.repeat(4001), KEY));
  assert.throws(() => seal('x', Buffer.alloc(16)));
});
