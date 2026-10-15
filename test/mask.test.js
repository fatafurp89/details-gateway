import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskMobile, maskEmail, normalizeMobile } from '../src/lib/mask.js';

test('mobile masking: +9665•••••67 (E.164)', () => {
  assert.equal(maskMobile('0551234567'), '+9665•••••67');
  assert.equal(maskMobile('+966551234567'), '+9665•••••67');
  assert.equal(maskMobile('00966 55 123 4567'), '+9665•••••67');
  assert.equal(maskMobile('+971501234567'), '+9715•••••67'); // دولة أخرى
  assert.equal(maskMobile(''), '');
  assert.equal(maskMobile(null), '');
});

test('mobile normalization: يُخزَّن دائمًا بصيغة E.164 (+)، السعودية افتراضيًا لمن لا رمز دولة له', () => {
  assert.equal(normalizeMobile('966551234567'), '+966551234567');
  assert.equal(normalizeMobile('055-123-4567'), '+966551234567');
  assert.equal(normalizeMobile('+971501234567'), '+971501234567'); // موظف عن بُعد
});

test('email masking keeps the first letter and domain', () => {
  assert.equal(maskEmail('mohammed@details-consults.sa'), 'm•••@details-consults.sa');
  assert.equal(maskEmail('a@details-consults.sa'), 'a•••@details-consults.sa');
  assert.equal(maskEmail('bad'), '');
  assert.equal(maskEmail(undefined), '');
});
