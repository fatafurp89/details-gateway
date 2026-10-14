import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskMobile, maskEmail, normalizeMobile } from '../src/lib/mask.js';

test('mobile masking: 05XX•••••67', () => {
  assert.equal(maskMobile('0551234567'), '0551•••••67');
  assert.equal(maskMobile('+966551234567'), '0551•••••67');
  assert.equal(maskMobile('00966 55 123 4567'), '0551•••••67');
  assert.equal(maskMobile(''), '');
  assert.equal(maskMobile(null), '');
});

test('mobile normalization', () => {
  assert.equal(normalizeMobile('966551234567'), '0551234567');
  assert.equal(normalizeMobile('055-123-4567'), '0551234567');
});

test('email masking keeps the first letter and domain', () => {
  assert.equal(maskEmail('mohammed@details-consults.sa'), 'm•••@details-consults.sa');
  assert.equal(maskEmail('a@details-consults.sa'), 'a•••@details-consults.sa');
  assert.equal(maskEmail('bad'), '');
  assert.equal(maskEmail(undefined), '');
});
