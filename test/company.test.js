import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maskId, maskOwners, expiryState, expiryAlerts, alertNotifications, daysPhrase, validateShares,
  validateProfile, validateOwner, validatePlatform, validateDelegation, validateDocument, validateVersion,
} from '../src/lib/company.js';

const now = new Date('2026-10-14T10:00:00Z');

test('maskId keeps the last 4 digits only', () => {
  assert.equal(maskId('1234567890'), '••••••7890');
  assert.equal(maskId('12'), '••');
  assert.equal(maskId(''), '');
  assert.equal(maskId(null), '');
  const owners = [{ name_ar: 'أ', id_number: '1098765432' }];
  assert.equal(maskOwners(owners, false)[0].id_number, '••••••5432');
  assert.equal(maskOwners(owners, true)[0].id_number, '1098765432');
});

test('expiryState: expired / expiring (≤30 days) / ok / null', () => {
  assert.equal(expiryState(null, now), null);
  assert.equal(expiryState('2026-10-13', now), 'expired');
  assert.equal(expiryState('2026-10-14', now), 'expiring');
  assert.equal(expiryState('2026-11-13', now), 'expiring');
  assert.equal(expiryState('2026-11-14', now), 'ok');
  assert.equal(expiryState('2027-10-29', now), 'ok');
});

test('expiryAlerts: documents, platforms (not closed), active delegations; soonest first; severity by days', () => {
  const alerts = expiryAlerts({
    documents: [{ id: 'd1', title_ar: 'السجل التجاري', expires_on: '2027-10-29' }, { id: 'd2', title_ar: 'العنوان الوطني', expires_on: '2026-11-01' }],
    platforms: [{ id: 'p1', name_ar: 'بلدي', expiry_date: '2026-10-10', status: 'active', account_holder_id: 'e9' }, { id: 'p2', name_ar: 'مغلقة', expiry_date: '2026-10-10', status: 'closed' }],
    delegations: [{ id: 'g1', delegate_name: 'أحمد', valid_to: '2026-10-18', status: 'active', employee_id: 'e1' }, { id: 'g2', delegate_name: 'ملغى', valid_to: '2026-10-18', status: 'revoked' }],
  }, now);
  assert.deepEqual(alerts.map((a) => [a.kind, a.id, a.state, a.severity, a.days_left]), [
    ['platform', 'p1', 'expired', 'urgent', -4], ['delegation', 'g1', 'expiring', 'urgent', 4], ['document', 'd2', 'expiring', 'warn', 18]]);
  assert.equal(alerts[0].employee_id, 'e9');
  assert.equal(alerts[2].url, '/company#documents');
  assert.deepEqual(expiryAlerts({}, now), []);
});

test('alertNotifications: Arabic titles and idempotent source_ref', () => {
  const [exp, soon] = alertNotifications([
    { kind: 'document', id: 'd1', title_ar: 'السجل', expires_on: '2026-10-10', days_left: -4, state: 'expired', severity: 'urgent', url: '/company#documents', employee_id: null },
    { kind: 'platform', id: 'p1', title_ar: 'بلدي', expires_on: '2026-10-16', days_left: 2, state: 'expiring', severity: 'urgent', url: '/company#platforms', employee_id: 'e1' }]);
  assert.equal(exp.source_ref, 'document:d1:expired');
  assert.equal(exp.title_ar, 'انتهت صلاحية المستند «السجل»');
  assert.equal(soon.source_ref, 'platform:p1:expiring');
  assert.equal(soon.title_ar, 'حساب منصة «بلدي» ينتهي خلال يومان');
  assert.equal(soon.employee_id, 'e1');
  assert.equal(daysPhrase(0), 'اليوم');
  assert.equal(daysPhrase(-1), 'منذ يوم واحد');
  assert.equal(daysPhrase(15), 'خلال 15 يومًا');
  assert.equal(daysPhrase(5), 'خلال 5 أيام');
});

test('validateShares: total ≤ 100, NULL ignored', () => {
  assert.deepEqual(validateShares([{ share_pct: 60 }, { share_pct: '40' }, { share_pct: null }]), { ok: true, total: 100 });
  assert.deepEqual(validateShares([]), { ok: true, total: 0 });
  assert.equal(validateShares([{ share_pct: 60 }, { share_pct: 50 }]).ok, false);
  assert.equal(validateShares([{ share_pct: 101 }]).ok, false);
  assert.equal(validateShares([{ share_pct: 33.33 }, { share_pct: 33.33 }, { share_pct: 33.34 }]).total, 100);
});

test('validateProfile: partial updates, dates, capital, national address', () => {
  assert.ok(validateProfile({}).error);
  assert.ok(validateProfile({ legal_name_ar: '' }).error);
  assert.ok(validateProfile({ cr_expiry: '29/10/2027' }).error);
  assert.ok(validateProfile({ email: 'nope' }).error);
  assert.ok(validateProfile({ capital: 'abc' }).error);
  assert.ok(validateProfile({ national_address: { verify_url: 'ftp://x' } }).error);
  const { value } = validateProfile({ legal_name_ar: ' شركة ديتيلز كونسولتس ', capital: '100,000.00', cr_expiry: '2027-10-29', tax_number: '', national_address: { short_address: 'RHFB2957', junk: 'x', expires_on: '2027-04-10' } });
  assert.equal(value.legal_name_ar, 'شركة ديتيلز كونسولتس');
  assert.equal(value.capital, 100000);
  assert.equal(value.tax_number, null);
  assert.deepEqual(value.national_address, { short_address: 'RHFB2957', expires_on: '2027-04-10' });
  assert.equal(value.phone, undefined);
});

test('validateOwner / validatePlatform / validateDelegation / validateDocument / validateVersion', () => {
  assert.ok(validateOwner({ name_ar: '' }).error);
  assert.ok(validateOwner({ name_ar: 'x', role: 'ceo' }).error);
  assert.ok(validateOwner({ name_ar: 'x', share_pct: 120 }).error);
  const o = validateOwner({ name_ar: 'محمد', role: 'manager', share_pct: '', since: '2025-10-30' }).value;
  assert.equal(o.share_pct, null); assert.equal(o.since, '2025-10-30'); assert.equal(o.entity_kind, 'person');
  assert.ok(validatePlatform({ name_ar: 'x', url: 'balady' }).error);
  assert.ok(validatePlatform({ name_ar: 'x', category: 'gov' }).error);
  assert.ok(validatePlatform({ name_ar: 'x', account_holder_id: '12' }).error);
  assert.ok(validatePlatform({ name_ar: 'x', secret_node_key: 'Bad Key' }).error);
  const p = validatePlatform({ name_ar: 'بلدي', url: 'https://apps.balady.gov.sa/', expiry_date: '2027-01-01', secret_node_key: 'bridge', secret_ref: 'بلدي — حساب المكتب' }).value;
  assert.equal(p.status, 'active'); assert.equal(p.category, 'government'); assert.equal(p.account_holder_id, null); assert.equal(p.secret_node_key, 'bridge');
  assert.ok(validateDelegation({ delegate_name: '' }).error);
  assert.ok(validateDelegation({ delegate_name: 'x', valid_from: '2026-10-14', valid_to: '2026-10-01' }).error);
  assert.equal(validateDelegation({ delegate_name: 'أحمد', scope_ar: 'إصدار الرخص', valid_to: '2027-01-01' }).value.status, 'active');
  assert.ok(validateDocument({ title_ar: 'x', kind: 'passport' }).error);
  assert.equal(validateDocument({ title_ar: 'السجل', kind: 'cr' }).value.kind, 'cr');
  assert.equal(validateDocument({ title_ar: 'عقد دائم', kind: 'contract', is_unlimited: true }).value.is_unlimited, true);
  assert.ok(validateVersion({ file_url: 'http://insecure' }).error);
  assert.ok(validateVersion({ issued_on: '2027-01-01', expires_on: '2026-01-01' }).error);
  const v = validateVersion({ file_name: 'document.pdf', issued_on: '2025-10-30', expires_on: '2027-10-29' }).value;
  assert.equal(v.file_url, null); assert.equal(v.file_name, 'document.pdf');
  const vu = validateVersion({ file_name: 'perm.pdf', issued_on: '2025-10-30', is_unlimited: true }).value;
  assert.equal(vu.is_unlimited, true); assert.equal(vu.expires_on, null);
  assert.equal(expiryState('2025-01-01', now, 30, true), 'unlimited');
});
