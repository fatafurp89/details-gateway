import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNotify, validateNotifyRead, clampLimit, dayBucket, groupByDay, MAX_LIMIT } from '../src/lib/notify.js';

const now = new Date('2026-10-14T10:00:00Z'); // 13:00 Riyadh

test('validateNotify: system, title and a target are required', () => {
  assert.ok(validateNotify(null).error);
  assert.ok(validateNotify({ system: 'HR!', title_ar: 'x', all: true }).error);
  assert.ok(validateNotify({ system: 'hr', all: true }).error);
  assert.ok(validateNotify({ system: 'hr', title_ar: 'x' }).error);
  assert.ok(validateNotify({ system: 'hr', title_ar: 'x', employee_no: '12' }).error);
  assert.ok(validateNotify({ system: 'hr', title_ar: 'x', employee_no: '1012', severity: 'red' }).error);
  assert.ok(validateNotify({ system: 'hr', title_ar: 'x', employee_no: '1012', url: 'javascript:alert(1)' }).error);
  assert.ok(validateNotify({ system: 'hr', title_ar: 'x', employee_no: '1012', url: '//evil' }).error);
});

test('validateNotify: normalizes targets, defaults and meta', () => {
  const one = validateNotify({ system: ' HR ', title_ar: ' طلب إجازة ', employee_no: 1012, url: '/x' }).value;
  assert.deepEqual(one.targets, { employee_nos: ['1012'] });
  assert.equal(one.system, 'hr');
  assert.equal(one.title_ar, 'طلب إجازة');
  assert.equal(one.severity, 'info');
  assert.equal(one.kind, 'info');
  assert.equal(one.source_ref, null);
  assert.deepEqual(one.meta, {});
  const many = validateNotify({ system: 'hr', title_ar: 'x', employee_nos: ['1012', '1012', '1013'], source_ref: 'leave:7', severity: 'urgent', meta: { a: 1 } }).value;
  assert.deepEqual(many.targets, { employee_nos: ['1012', '1013'] });
  assert.equal(many.source_ref, 'leave:7');
  assert.deepEqual(many.meta, { a: 1 });
  assert.deepEqual(validateNotify({ system: 'mail', title_ar: 'x', all: true, url: 'https://details-mail.com/inbox' }).value.targets, { all: true });
});

test('validateNotifyRead + clampLimit', () => {
  assert.ok(validateNotifyRead({ system: 'hr' }).error);
  assert.ok(validateNotifyRead({ system: 'hr', source_ref: 'a', employee_no: 'x' }).error);
  assert.deepEqual(validateNotifyRead({ system: 'hr', source_ref: 'leave:7' }).value, { system: 'hr', source_ref: 'leave:7', employee_no: null });
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit('10'), 10);
  assert.equal(clampLimit(-3), 50);
  assert.equal(clampLimit(99999), MAX_LIMIT);
});

test('dayBucket/groupByDay use the Riyadh day', () => {
  assert.equal(dayBucket('2026-10-14T01:00:00Z', now), 'today');
  assert.equal(dayBucket('2026-10-13T20:30:00Z', now), 'yesterday'); // 23:30 Riyadh on the 13th
  assert.equal(dayBucket('2026-10-13T21:30:00Z', now), 'today');     // 00:30 Riyadh on the 14th
  assert.equal(dayBucket('2026-10-13T05:00:00Z', now), 'yesterday');
  assert.equal(dayBucket('2026-10-01T05:00:00Z', now), 'older');
  assert.equal(dayBucket('garbage', now), 'older');
  const g = groupByDay([{ created_at: '2026-10-14T05:00:00Z' }, { created_at: '2026-10-13T05:00:00Z' }, { created_at: '2026-09-01T05:00:00Z' }, { created_at: '2026-10-14T06:00:00Z' }], now);
  assert.deepEqual(g.map((x) => [x.bucket, x.label_ar, x.items.length]), [['today', 'اليوم', 2], ['yesterday', 'أمس', 1], ['older', 'أقدم', 1]]);
  assert.deepEqual(groupByDay([], now), []);
});
