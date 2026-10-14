import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHrEmployee, validateSystem } from '../src/lib/validate.js';

test('validateHrEmployee: employee_no + full_name required, optional fields only when provided', () => {
  assert.ok(validateHrEmployee(null).error);
  assert.ok(validateHrEmployee({ employee_no: '12', full_name: 'x y' }).error);
  assert.ok(validateHrEmployee({ employee_no: '1012', full_name: 'x' }).error);
  assert.ok(validateHrEmployee({ employee_no: '1012', full_name: 'محمد', mobile: '123' }).error);
  assert.ok(validateHrEmployee({ employee_no: '1012', full_name: 'محمد', email: 'bad' }).error);
  assert.ok(validateHrEmployee({ employee_no: '1012', full_name: 'محمد', photo_url: 'http://x/y.png' }).error);
  const min = validateHrEmployee({ employee_no: ' 1012 ', full_name: ' محمد نظمي ' }).value;
  assert.deepEqual(min, { employee_no: '1012', full_name: 'محمد نظمي' });
  const full = validateHrEmployee({ employee_no: '1012', full_name: 'محمد', mobile: '+966590722827', email: 'M@Details-Consults.sa', google_email: '', department: 'الهندسة', title: 'مهندس', hr_status: 'active', active: 'false', photo_url: '/static/p.png', role: 'admin' }).value;
  assert.equal(full.mobile, '0590722827');
  assert.equal(full.email, 'm@details-consults.sa');
  assert.equal(full.google_email, null);
  assert.equal(full.active, false);
  assert.equal(full.role, undefined); // never set from HR
  assert.deepEqual(full.hr_meta, { department: 'الهندسة', title: 'مهندس', hr_status: 'active' });
});

test('validateSystem: placement grid|header', () => {
  assert.equal(validateSystem({ key: 'hr-portal', name_ar: 'بوابة الموظف', mode: 'link', upstream: 'https://hr.details-wms.cloud/portal' }).value.placement, 'grid');
  assert.equal(validateSystem({ key: 'hr-portal', name_ar: 'بوابة الموظف', mode: 'link', placement: 'header' }).value.placement, 'header');
  assert.ok(validateSystem({ key: 'hr-portal', name_ar: 'بوابة الموظف', mode: 'link', placement: 'sidebar' }).error);
});
