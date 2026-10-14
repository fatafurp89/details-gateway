import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize, normalizeCategory } from '../src/lib/notify-categories.js';
import { applyPlain, translate, looksShell, daysAr } from '../src/lib/notify-plain.js';
import { validateNotify, notifAccess, accessCategories, pickCategories, shapeNotification } from '../src/lib/notify.js';

const BRIDGE = { system: 'wms', kind: 'backup', severity: 'urgent', title_ar: 'فشل النسخ الاحتياطي لسيرفر البوابة (bridge)',
  body_ar: 'فشلت نسخة bridge الليلية: line 29: sudo -u postgres pg_dump -Fc -d "$db" -f "$W/db/$db.dump" — راجع /srv/backups/bridge/backup.log' };
const APPS = { system: 'mail', kind: 'backup-offsite-failed', severity: 'urgent', source_ref: 'backup-2026-10-14T06:34:13Z', title_ar: 'فشل النسخ الاحتياطي لسيرفر التطبيقات',
  body_ar: 'فشل نقل النسخة الاحتياطية إلى سيرفر bridge (10.9.0.1): rsync rc=12 — راجع /srv/backups/apps/logs/backup.log' };
const DOC = { system: 'company', kind: 'expiry.expiring', severity: 'warn', title_ar: 'المستند «شهادة عضوية الغرفة التجارية» ينتهي خلال 15 يومًا', body_ar: 'تاريخ الانتهاء 2026-10-29.' };

test('categorize: explicit > technical system > kind > source_ref > work system > keywords > work', () => {
  assert.equal(categorize({ system: 'hr', category: 'technical' }), 'technical');
  assert.equal(categorize({ system: 'infra', kind: 'info' }), 'technical');
  assert.equal(categorize(BRIDGE), 'technical');
  assert.equal(categorize(APPS), 'technical');
  assert.equal(categorize({ system: 'wms', kind: 'info', source_ref: 'backup-1' }), 'technical');
  for (const kind of ['disk.full', 'cert.expiring', 'tunnel.down', 'node.down', 'service.failed', 'security.login-blocked', 'mail-send-failed', 'smtp-error', 'whatsapp-token', 'ai-key-invalid', 'login-blocked']) {
    assert.equal(categorize({ system: 'wms', kind }), 'technical', kind);
  }
  // work
  assert.equal(categorize(DOC), 'work');
  assert.equal(categorize({ system: 'hr', kind: 'leave.request', title_ar: 'طلب إجازة' }), 'work');
  assert.equal(categorize({ system: 'mail', kind: 'new-mail', title_ar: 'رسالة جديدة' }), 'work');
  assert.equal(categorize({ system: 'whatsapp', kind: 'message', title_ar: 'محادثة جديدة' }), 'work');
  assert.equal(categorize({ system: 'files', kind: 'file.received', title_ar: 'ملف جديد' }), 'work');
  assert.equal(categorize({}), 'work'); // unknown = work
  assert.equal(categorize({ system: 'company', kind: 'info', title_ar: 'شهادة SSL' }), 'work'); // work systems are not keyword-guessed
  assert.equal(categorize({ system: 'wms', kind: 'info', title_ar: 'فشل النسخ الاحتياطي' }), 'technical'); // keyword last resort for generic kind
  assert.equal(normalizeCategory(' Technical '), 'technical');
  assert.equal(normalizeCategory('x'), null);
});

test('validateNotify: optional category (validated, defaulted by the mapping table)', () => {
  const base = { system: 'wms', title_ar: 'x', all: true };
  assert.ok(validateNotify({ ...base, category: 'urgent' }).error);
  assert.equal(validateNotify({ ...base, category: 'Technical' }).value.category, 'technical');
  assert.equal(validateNotify({ ...base }).value.category, 'work');
  assert.equal(validateNotify({ ...base, kind: 'backup' }).value.category, 'technical');
  assert.equal(validateNotify({ ...base, kind: 'backup', category: 'work' }).value.category, 'work');
});

test('translator: bridge pg_dump failure becomes plain Arabic, raw text kept in meta.details', () => {
  const o = applyPlain(BRIDGE);
  assert.equal(o.category, 'technical');
  assert.equal(o.meta.plain_rule, 'backup.failed');
  assert.match(o.title_ar, /سيرفر البوابة/);
  for (const t of [o.title_ar, o.body_ar, o.meta.means, o.meta.todo]) assert.ok(t && !looksShell(t), t);
  assert.ok(o.meta.details.includes('pg_dump') && o.meta.details.includes(BRIDGE.title_ar));
  assert.equal(applyPlain(o).meta.details, o.meta.details); // idempotent
});

test('translator: apps rsync failure, success summary, node/service/disk/cert/wireguard/security/mail/whatsapp/ai', () => {
  const rule = (n) => applyPlain(n).meta.plain_rule;
  const a = applyPlain(APPS);
  assert.match(a.title_ar, /سيرفر التطبيقات/); assert.ok(!looksShell(a.body_ar) && !/rsync/.test(a.body_ar + a.title_ar));
  assert.equal(rule({ system: 'infra', kind: 'backup-summary', title_ar: 'ملخص النسخ الاحتياطي الأسبوعي', body_ar: 'اكتملت 14 نسخة بنجاح' }), 'backup.success');
  assert.equal(rule({ system: 'wms', kind: 'backup', title_ar: 'نجح النسخ الاحتياطي', body_ar: 'ok' }), 'backup.success');
  assert.equal(rule({ system: 'infra', kind: 'node.down', title_ar: 'الجهاز «mail-vps» لا يستجيب للفحص (ping)' }), 'node');
  assert.match(applyPlain({ system: 'infra', kind: 'node.down', title_ar: 'الجهاز «mail-vps» لا يستجيب للفحص (ping)' }).title_ar, /mail-vps/);
  assert.match(applyPlain({ system: 'infra', kind: 'node.up', title_ar: 'عاد الجهاز «mail-vps» للعمل' }).title_ar, /^عاد الجهاز/);
  assert.equal(rule({ system: 'infra', kind: 'service.down', title_ar: 'الخدمة details-gateway.service توقفت' }), 'service');
  assert.equal(rule({ system: 'infra', kind: 'disk.full', title_ar: 'القرص على «apps» امتلأ 91%' }), 'disk');
  assert.match(applyPlain({ system: 'infra', kind: 'disk.full', title_ar: 'القرص على «apps» امتلأ 91%' }).body_ar, /91%/);
  assert.equal(rule({ system: 'infra', kind: 'cert.expiring', title_ar: 'شهادة SSL لـ details-wms.cloud تنتهي خلال 9 أيام' }), 'cert');
  assert.equal(rule({ system: 'infra', kind: 'tunnel.down', title_ar: 'انقطع نفق WireGuard', body_ar: 'wg0 latest handshake: 4 minutes ago' }), 'wireguard');
  assert.equal(rule({ system: 'wms', kind: 'security.login-blocked', title_ar: 'تم حظر محاولات دخول', body_ar: 'ip=1.2.3.4' }), 'security');
  assert.equal(rule({ system: 'mail', kind: 'mail-send-failed', title_ar: 'فشل إرسال البريد', body_ar: 'SMTP 535 Authentication failed' }), 'mail.send');
  assert.equal(rule({ system: 'whatsapp', kind: 'whatsapp-token', title_ar: 'WhatsApp access token invalid', body_ar: 'OAuthException 190' }), 'whatsapp.token');
  assert.match(applyPlain({ system: 'whatsapp', kind: 'whatsapp-token', title_ar: 'رمز واتساب ينتهي خلال 5 أيام' }).body_ar, /5 أيام/);
  assert.equal(rule({ system: 'wms', kind: 'ai-key', title_ar: 'DeepSeek key invalid', body_ar: '401 Incorrect API key' }), 'ai.key');
  for (const n of [APPS, { system: 'infra', kind: 'tunnel.down', title_ar: 'انقطع نفق WireGuard', body_ar: 'wg0 latest handshake' }]) {
    const o = applyPlain(n); assert.ok(o.meta.means && o.meta.todo);
  }
});

test('translator fallback: shell and stack text never reaches the visible fields', () => {
  const o = applyPlain({ system: 'wms', kind: 'job.failed', title_ar: 'Error: ENOENT /var/lib/x', body_ar: 'at Object.<anonymous> (/opt/app/a.js:10:5)\nsudo journalctl -u app' });
  assert.equal(o.meta.plain_rule, 'fallback');
  assert.ok(!looksShell(o.title_ar) && !looksShell(o.body_ar));
  assert.match(o.title_ar, /نظام ديتيلز/);
  assert.ok(o.meta.details.includes('ENOENT'));
  const keep = applyPlain({ system: 'infra', kind: 'info', title_ar: 'تم تحديث الخادم', body_ar: 'sudo apt upgrade — أُنجز التحديث الأسبوعي' });
  assert.equal(keep.title_ar, 'تم تحديث الخادم'); assert.equal(keep.body_ar, 'أُنجز التحديث الأسبوعي');
});

test('work notifications are never rewritten', () => {
  const o = applyPlain(DOC);
  assert.equal(o.category, 'work'); assert.equal(o.title_ar, DOC.title_ar); assert.equal(o.meta, undefined);
  assert.equal(translate(DOC).rule, 'fallback');
});

test('daysAr', () => {
  assert.deepEqual([1, 2, 5, 15].map(daysAr), ['يوم', 'يومان', '5 أيام', '15 يومًا']);
});

test('notifAccess: admin everything; employees need explicit grants; details needs technical', () => {
  assert.deepEqual(notifAccess('admin'), { work: true, technical: true, details: true });
  assert.deepEqual(notifAccess('user', ['notifications.work']), { work: true, technical: false, details: false });
  assert.deepEqual(notifAccess('user', []), { work: false, technical: false, details: false });
  assert.deepEqual(notifAccess('user', ['notifications.technical.details']), { work: false, technical: false, details: false });
  assert.deepEqual(notifAccess('user', ['notifications.work', 'notifications.technical', 'notifications.technical.details']), { work: true, technical: true, details: true });
  assert.deepEqual(accessCategories(notifAccess('user', ['notifications.technical'])), ['technical']);
});

test('pickCategories: null filter = allowed set; denied or invalid = false', () => {
  const a = notifAccess('user', ['notifications.work']);
  assert.deepEqual(pickCategories(a, undefined), ['work']);
  assert.deepEqual(pickCategories(a, 'work'), ['work']);
  assert.equal(pickCategories(a, 'technical'), false);
  assert.equal(pickCategories(a, 'x'), false);
  assert.deepEqual(pickCategories(notifAccess('admin'), ''), ['work', 'technical']);
});

test('shapeNotification: technical rows expose only means/todo; details only with the permission', () => {
  const row = { category: 'technical', meta: { plain: true, plain_rule: 'x', means: 'm', todo: 't', details: 'sudo pg_dump', secret: 's' } };
  const plain = shapeNotification(row, notifAccess('user', ['notifications.technical']));
  assert.deepEqual(plain.meta, { means: 'm', todo: 't' }); assert.equal(plain.details, undefined);
  assert.equal(shapeNotification(row, notifAccess('user', ['notifications.technical', 'notifications.technical.details'])).details, 'sudo pg_dump');
  const work = { category: 'work', meta: { id: 1 } };
  assert.deepEqual(shapeNotification(work, notifAccess('user', ['notifications.work'])).meta, { id: 1 });
});
