import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { normalizeSaudiMobile, last4, decideChannel, sendWhatsappOtp, whatsappOtpConfig, OTP_CHANNELS } from '../src/lib/whatsapp-otp.js';
import { validateSecurity, effective, DEFAULTS } from '../src/lib/settings.js';

test('normalizeSaudiMobile: all common Saudi spellings → 9665xxxxxxxx, plus any other country E.164 (موظفون عن بُعد)', () => {
  for (const v of ['0556186732', '556186732', '+966556186732', '00966556186732', '966556186732', '9660556186732', '+966 55 618 6732', '055-618-6732', '٠٥٥٦١٨٦٧٣٢'])
    assert.equal(normalizeSaudiMobile(v), '966556186732', v);
  assert.equal(normalizeSaudiMobile('+971501234567'), '971501234567'); // دولة أخرى: يُقبل الآن للموظفين عن بُعد
  for (const v of ['', null, undefined, '05', '0112345678', 'abc', '05561867321'])
    assert.equal(normalizeSaudiMobile(v), null, String(v));
  assert.equal(last4('966556186732'), '****6732');
  assert.equal(last4(''), '');
});

test('decideChannel: email default; whatsapp needs a valid mobile; both; forced e-mail; none', () => {
  const e = 'a@details-consults.sa', m = '0556186732';
  assert.deepEqual(decideChannel({ pref: 'email', mobile: m, email: e }), { whatsapp: false, email: true, mobile: '966556186732', reason: 'pref_email' });
  assert.deepEqual(decideChannel({ pref: 'whatsapp', mobile: m, email: e }), { whatsapp: true, email: false, mobile: '966556186732', reason: 'pref_whatsapp' });
  assert.deepEqual(decideChannel({ pref: 'whatsapp', mobile: '', email: e }), { whatsapp: false, email: true, mobile: null, reason: 'no_mobile' });
  assert.deepEqual(decideChannel({ pref: 'whatsapp', mobile: '+971501234567', email: e }).whatsapp, true); // دولة أخرى: صالح الآن (موظف عن بُعد)
  assert.deepEqual(decideChannel({ pref: 'both', mobile: m, email: e }), { whatsapp: true, email: true, mobile: '966556186732', reason: 'both' });
  assert.deepEqual(decideChannel({ pref: 'both', mobile: m, email: '' }), { whatsapp: true, email: false, mobile: '966556186732', reason: 'both' });
  assert.deepEqual(decideChannel({ pref: 'whatsapp', mobile: m, email: e, force: 'email' }), { whatsapp: false, email: true, mobile: '966556186732', reason: 'forced_email' });
  assert.deepEqual(decideChannel({ pref: 'whatsapp', mobile: m, email: '', force: 'email' }).email, false);
  const none = decideChannel({ pref: 'whatsapp', mobile: '', email: '' });
  assert.equal(none.whatsapp || none.email, false);
  assert.equal(decideChannel({ pref: 'bogus', mobile: m, email: e }).whatsapp, false); // unknown pref → email
  assert.equal(decideChannel({}).email, false);
});

test('settings: otp_channel default email, env override, validator accepts only known values', () => {
  assert.equal(DEFAULTS.security.otp_channel, 'email');
  assert.deepEqual(OTP_CHANNELS, ['email', 'whatsapp', 'both']);
  assert.equal(effective('security', {}, { OTP_CHANNEL: 'whatsapp' }).otp_channel, 'whatsapp');
  assert.equal(effective('security', { otp_channel: 'both' }, { OTP_CHANNEL: 'whatsapp' }).otp_channel, 'both');
  assert.equal(effective('security', {}, { OTP_CHANNEL: 'sms' }).otp_channel, 'email');
  assert.equal(validateSecurity({ otp_channel: 'whatsapp' }).value.otp_channel, 'whatsapp');
  assert.equal(validateSecurity({ otp_channel: 'telegram' }).value.otp_channel, 'email');
  assert.equal(validateSecurity({}).value.otp_channel, 'email');
});

test('whatsappOtpConfig: defaults point at the WireGuard tunnel with the site Host header', () => {
  const c = whatsappOtpConfig({}, 'k'.repeat(32));
  assert.equal(c.url, 'http://10.9.0.3/internal/otp/send');
  assert.equal(c.host, 'whatsapp.details-wms.cloud');
  assert.equal(c.timeoutMs, 8000);
  assert.equal(c.proxyKey, 'k'.repeat(32));
  assert.equal(whatsappOtpConfig({ WHATSAPP_OTP_TIMEOUT_MS: '3000', WHATSAPP_OTP_URL: 'http://x/y' }, 'k').timeoutMs, 3000);
});

const withServer = async (handler, fn) => {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}/internal/otp/send`); } finally { srv.close(); }
};

test('sendWhatsappOtp: sends Host + proxy key + JSON body, returns message_id', async () => {
  let seen = null;
  await withServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { seen = { host: req.headers.host, key: req.headers['x-gw-proxy-key'], body: JSON.parse(b), url: req.url, method: req.method }; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, message_id: 'wamid.X' })); });
  }, async (url) => {
    const r = await sendWhatsappOtp({ to: '966556186732', code: '4821', ttlMinutes: 5 }, { url, host: 'whatsapp.details-wms.cloud', proxyKey: 'secret-key-0123456789', timeoutMs: 2000 });
    assert.deepEqual(r, { ok: true, message_id: 'wamid.X', dry_run: undefined });
    assert.equal(seen.host, 'whatsapp.details-wms.cloud');
    assert.equal(seen.key, 'secret-key-0123456789');
    assert.equal(seen.method, 'POST');
    assert.deepEqual(seen.body, { to: '966556186732', code: '4821', ttl_minutes: 5, dry_run: false });
  });
});

test('sendWhatsappOtp: never throws — service error, non-JSON, timeout, refused, missing key', async () => {
  await withServer((req, res) => { res.statusCode = 429; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: false, error: 'rate' })); }, async (url) => {
    const r = await sendWhatsappOtp({ to: '966556186732', code: '1' }, { url, host: 'h', proxyKey: 'k', timeoutMs: 2000 });
    assert.deepEqual(r, { ok: false, error: 'rate', status: 429 });
  });
  await withServer((req, res) => { res.end('<html>oops'); }, async (url) => {
    const r = await sendWhatsappOtp({ to: '966556186732', code: '1' }, { url, host: 'h', proxyKey: 'k', timeoutMs: 2000 });
    assert.equal(r.ok, false); assert.equal(r.status, 200);
  });
  await withServer((req, res) => { setTimeout(() => res.end('{"ok":true}'), 1500); }, async (url) => {
    const r = await sendWhatsappOtp({ to: '966556186732', code: '1' }, { url, host: 'h', proxyKey: 'k', timeoutMs: 200 });
    assert.equal(r.ok, false); assert.match(r.error, /timeout/);
  });
  const refused = await sendWhatsappOtp({ to: '966556186732', code: '1' }, { url: 'http://127.0.0.1:1/internal/otp/send', host: 'h', proxyKey: 'k', timeoutMs: 1000 });
  assert.equal(refused.ok, false); assert.equal(refused.status, 0);
  assert.deepEqual(await sendWhatsappOtp({ to: 'x', code: '1' }, { url: 'http://127.0.0.1:1/', host: 'h', proxyKey: '', timeoutMs: 10 }), { ok: false, error: 'GATEWAY_PROXY_KEY missing', status: 0 });
});
