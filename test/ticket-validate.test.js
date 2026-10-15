import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signTicket, verifyTicket, withTicket } from '../src/lib/ticket.js';
import { parseCsv, employeesFromCsv, validateEmployee, validateSystem } from '../src/lib/validate.js';

const S = 't'.repeat(40);
const claims = { employee_no: '1021', name: 'موظف', email: 'u@details-consults.sa', system_key: 'hr' };

test('ticket: valid for 60 seconds, bound to the system', () => {
  const t0 = Date.parse('2026-10-14T10:00:00Z');
  const tok = signTicket(claims, S, { now: t0 });
  const p = verifyTicket(tok, S, { now: t0 + 59e3, audience: 'hr' });
  assert.equal(p.employee_no, '1021');
  assert.equal(p.exp - p.iat, 60);
  assert.equal(verifyTicket(tok, S, { now: t0 + 61e3 }), null);
  assert.equal(verifyTicket(tok, S, { now: t0, audience: 'mail' }), null);
  assert.equal(verifyTicket(tok, 'u'.repeat(40), { now: t0 }), null);
  const [h, , sig] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ ...p, employee_no: '1010' })).toString('base64url');
  assert.equal(verifyTicket(`${h}.${forged}.${sig}`, S, { now: t0 }), null);
});

test('ticket is appended as dg_ticket', () => {
  assert.equal(withTicket('https://details-hr.com/sso?x=1', 'abc'), 'https://details-hr.com/sso?x=1&dg_ticket=abc');
});

test('CSV parser handles quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('employee CSV import with Arabic headers', () => {
  const csv = '﻿الرقم,الاسم,الجوال,البريد,بريد جوجل,الدور,الحالة,الانتهاء\n1030,سارة,0551112222,S@details-consults.sa,,مستخدم,نشط,\n12,خطأ,,x@y.sa,,user,,\n';
  const { employees, errors } = employeesFromCsv(csv);
  assert.equal(employees.length, 1);
  assert.equal(employees[0].email, 's@details-consults.sa');
  assert.equal(employees[0].active, true);
  assert.deepEqual(errors.map((e) => e.line), [3]);
});

test('employee and system validation', () => {
  assert.ok(validateEmployee({ employee_no: '1010', full_name: 'مدير', email: 'a@b.sa', mobile: '+966501234567' }).value);
  assert.ok(validateEmployee({ employee_no: '1010', full_name: 'مدير', email: 'a@b.sa' }).error); // الجوال إجباري الآن
  assert.ok(validateEmployee({ employee_no: '101', full_name: 'مدير', email: 'a@b.sa', mobile: '+966501234567' }).error);
  assert.ok(validateEmployee({ employee_no: '1010', full_name: 'مدير', email: 'a@b.sa', mobile: '123' }).error);
  assert.ok(validateSystem({ key: 'wms', name_ar: 'نظام', mode: 'proxy', host: 'wms.details-wms.cloud' }).value);
  assert.ok(validateSystem({ key: 'wms', name_ar: 'نظام', mode: 'link', upstream: 'http://x' }).error);
  assert.ok(validateSystem({ key: 'Bad Key', name_ar: 'نظام' }).error);
});
