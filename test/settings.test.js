import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, allowedSections, effective, DEFAULTS, validateBranding, validateSecurity, validateSmtp, validateNotifications,
  parseCidr, ipBlocked, latestBackup, pruneList } from '../src/lib/settings.js';
import { validateSystem } from '../src/lib/validate.js';

test('sections: admin gets all; delegated employee gets only granted non-sensitive sections', () => {
  assert.equal(allowedSections('admin').length, SECTIONS.length);
  assert.deepEqual(allowedSections('user', []), []);
  const got = allowedSections('user', ['settings.systems', 'settings.ai_keys', 'settings.smtp', 'settings.links']);
  assert.deepEqual(got, ['systems', 'links']); // ai_keys and smtp are adminOnly even when granted
});

test('effective: defaults → env → stored row; empty stored values do not override', () => {
  const sec = effective('security', { idle_minutes: 45, otp_ttl_minutes: '' }, { SESSION_HOURS: '8', OTP_TTL_MINUTES: '7' });
  assert.equal(sec.session_hours, 8);
  assert.equal(sec.idle_minutes, 45);
  assert.equal(sec.otp_ttl_minutes, 7);
  assert.equal(sec.otp_max_attempts, DEFAULTS.security.otp_max_attempts);
  const n = effective('notifications', { email_relay: true, severity: { warn: { email: true } } }, {});
  assert.equal(n.email_relay, true);
  assert.equal(n.severity.urgent.email, true); // default kept
  assert.equal(n.severity.warn.email, true);
  assert.equal(effective('smtp', null, { SMTP_HOST: 'mail.x.sa' }).host, 'mail.x.sa');
});

test('branding validator: name required, colors #rrggbb, logo path or https', () => {
  assert.ok(validateBranding({ name: 'x' }).error);
  assert.ok(validateBranding({ name: 'بوابة', color_primary: 'green' }).error);
  assert.ok(validateBranding({ name: 'بوابة', logo_url: 'http://x/l.png' }).error);
  const v = validateBranding({ name: 'بوابة ديتيلز', sub: 's', logo_url: '/static/x.png', color_primary: '#0F8A6B' }).value;
  assert.equal(v.color_primary, '#0f8a6b');
  assert.equal(v.color_navy, DEFAULTS.branding.color_navy);
});

test('security validator: clamps numbers, parses/validates block list, never 127.0.0.1', () => {
  const v = validateSecurity({ session_hours: 999, idle_minutes: 1, otp_max_attempts: 'x', ip_blocklist: '203.0.113.7, 198.51.100.0/24\n2001:db8::1' }).value;
  assert.equal(v.session_hours, 168);
  assert.equal(v.idle_minutes, 5);
  assert.equal(v.otp_max_attempts, DEFAULTS.security.otp_max_attempts);
  assert.deepEqual(v.ip_blocklist, ['203.0.113.7', '198.51.100.0/24', '2001:db8::1']);
  assert.ok(validateSecurity({ ip_blocklist: ['300.1.1.1'] }).error);
  assert.ok(validateSecurity({ ip_blocklist: ['10.0.0.0/40'] }).error);
  assert.ok(validateSecurity({ ip_blocklist: ['127.0.0.1'] }).error);
});

test('ip block matcher: exact, CIDR, ipv4-mapped, ipv6 exact, loopback exempt', () => {
  const list = ['203.0.113.7', '198.51.100.0/24', '2001:db8::1'];
  assert.equal(ipBlocked('203.0.113.7', list), true);
  assert.equal(ipBlocked('::ffff:203.0.113.7', list), true);
  assert.equal(ipBlocked('203.0.113.8', list), false);
  assert.equal(ipBlocked('198.51.100.200', list), true);
  assert.equal(ipBlocked('198.51.101.1', list), false);
  assert.equal(ipBlocked('2001:DB8::1', list), true);
  assert.equal(ipBlocked('127.0.0.1', ['127.0.0.1', '0.0.0.0/0']), false);
  assert.equal(ipBlocked('10.1.2.3', ['0.0.0.0/0']), true);
  assert.equal(ipBlocked('10.1.2.3', []), false);
  assert.equal(parseCidr('garbage'), null);
});

test('smtp validator: host/port/user, password separate and never in value', () => {
  const r = validateSmtp({ host: 'SMTP.Hostinger.com', port: '587', user: 'info@details-consults.sa', password: 'p@ss' });
  assert.equal(r.value.host, 'smtp.hostinger.com');
  assert.equal(r.value.port, 587);
  assert.equal(r.password, 'p@ss');
  assert.equal(r.value.password, undefined);
  assert.ok(validateSmtp({ host: 'bad host' }).error);
  assert.ok(validateSmtp({ host: 'h.sa', user: 'notmail' }).error);
  assert.ok(validateSmtp({ host: 'h.sa', password: 'has space' }).error);
  assert.equal(validateSmtp({ host: 'h.sa' }).password, null);
});

test('notifications validator: booleans only', () => {
  const v = validateNotifications({ email_relay: 'yes', severity: { urgent: { email: true }, info: { email: 'x' } } }).value;
  assert.equal(v.email_relay, false);
  assert.equal(v.severity.urgent.email, true);
  assert.equal(v.severity.info.email, false);
  assert.equal(v.severity.warn.email, false);
});

test('systems placement accepts compact; requires_grant string false', () => {
  assert.equal(validateSystem({ key: 'files', name_ar: 'المرفقات', mode: 'internal', upstream: '/files', placement: 'compact' }).value.placement, 'compact');
  assert.ok(validateSystem({ key: 'files', name_ar: 'المرفقات', mode: 'internal', placement: 'tiny' }).error);
  assert.equal(validateSystem({ key: 'links', name_ar: 'الروابط', mode: 'internal', requires_grant: 'false' }).value.requires_grant, false);
  assert.equal(validateSystem({ key: 'links', name_ar: 'الروابط', mode: 'internal' }).value.requires_grant, true);
});

test('backups: latest + retention prune list', () => {
  const files = [
    { name: 'details_gateway-2026-10-01.dump', size: 1, mtime: '2026-10-01T00:00:00Z' },
    { name: 'details_gateway-2026-10-03.dump', size: 1, mtime: '2026-10-03T00:00:00Z' },
    { name: 'details_gateway-2026-10-02.dump', size: 1, mtime: '2026-10-02T00:00:00Z' },
    { name: 'other.txt', size: 1, mtime: '2026-10-09T00:00:00Z' },
  ];
  assert.equal(latestBackup(files).name, 'details_gateway-2026-10-03.dump');
  assert.deepEqual(pruneList(files, 2), ['details_gateway-2026-10-01.dump']);
  assert.deepEqual(pruneList(files, 14), []);
  assert.equal(latestBackup([]), null);
});
