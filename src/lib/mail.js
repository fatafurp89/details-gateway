// SMTP mail + Arabic OTP template
import nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const LOGO = fileURLToPath(new URL('../../web/assets/logo-details.png', import.meta.url));
// One transport per distinct config (host/port/user/pass) so settings changes take effect without a restart
const transports = new Map();

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const smtpConfigured = (smtp) => !!(smtp.host && smtp.user && smtp.pass);

function getTransport(smtp) {
  const id = createHash('sha256').update(`${smtp.host}|${smtp.port}|${smtp.user}|${smtp.pass}`).digest('hex');
  if (!transports.has(id)) {
    transports.clear();
    transports.set(id, nodemailer.createTransport({
      host: smtp.host, port: Number(smtp.port), secure: Number(smtp.port) === 465,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    }));
  }
  return transports.get(id);
}

export function firstLast(full) {
  const parts = String(full ?? '').trim().split(/s+/).filter(Boolean);
  return parts.length <= 2 ? parts.join(' ') : parts[0] + ' ' + parts[parts.length - 1];
}

function layout(title, inner) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f4;font-family:Tahoma,Arial,sans-serif;color:#0f172a;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f4"><tr><td align="center" style="padding:16px 10px">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:440px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
<tr><td align="center" style="background-color:#0a6b53;background:linear-gradient(135deg,#0a6b53,#1e3a5f);padding:16px 14px;text-align:center">
<img src="cid:logo" alt="ديتيلز" height="40" style="background:#fff;border-radius:8px;padding:5px;vertical-align:middle;display:inline-block">
<div style="color:#fff;font-size:16px;font-weight:bold;margin-top:8px">بوابة الدخول الموحد</div></td></tr>
<tr><td align="center" style="padding:22px 18px;text-align:center;line-height:1.7;font-size:15px">${inner}</td></tr>
<tr><td align="center" style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:10px 14px;font-size:11px;color:#64748b;text-align:center">
ديتيلز للاستشارات الهندسية · رسالة آلية، لا ترد عليها</td></tr></table></td></tr></table></body></html>`;
}

// Pure template
export function renderOtpEmail({ name, code, minutes = 10 }) {
  const nm = firstLast(name);
  const n = escapeHtml(nm);
  const m = Number(minutes) || 10;
  const unit = m >= 3 && m <= 10 ? 'دقائق' : 'دقيقة';
  const html = layout('رمز التحقق', `
<p style="margin:0 0 4px;font-size:15px;color:#475569">مرحبًا</p>
<p style="margin:0 0 14px;font-size:21px;font-weight:bold;color:#b4872f">${n}</p>
<p style="margin:0 0 12px;color:#334155;font-size:14px">رمز التحقق لدخول بوابة ديتيلز</p>
<div style="direction:ltr;text-align:center;font-size:34px;letter-spacing:9px;font-weight:bold;color:#0f8a6b;background:#e6f4ef;border:1px dashed #0f8a6b;border-radius:12px;padding:12px 0 12px 9px;font-family:Consolas,monospace">${escapeHtml(code)}</div>
<p style="margin:14px 0 0;color:#334155;font-size:14px">صلاحية الرمز <b>${m} ${unit}</b> فقط</p>
<p style="margin:14px 0 0;background:#fffbeb;border:1px solid #f1e0b0;padding:8px 10px;border-radius:8px;color:#78350f;font-size:12.5px;text-align:center">
⚠ لا تشارك هذا الرمز مع أحد، فموظفو ديتيلز لن يطلبوه منك أبدًا. إن لم تطلب الدخول فتجاهل الرسالة.</p>`);
  const text = `مرحبًا ${nm}
رمز التحقق لدخول بوابة ديتيلز: ${code}
صلاحية الرمز ${m} ${unit}.
لا تشارك هذا الرمز مع أي شخص.`;
  return { subject: `رمز التحقق: ${code} — بوابة ديتيلز`, html, text };
}

// OTP for revealing/editing technical secrets (admin only); the mail never contains a secret value
export function renderInfraOtpEmail({ name, code }) {
  const n = escapeHtml(name);
  const html = layout('رمز كشف الأسرار التقنية', `
<p style="margin:0 0 6px;font-size:18px;font-weight:bold">مرحبًا ${n}</p>
<p style="margin:0 0 18px;color:#334155">رمز التحقق لكشف أو تعديل بيانات الدخول في «المعلومات التقنية»:</p>
<div style="direction:ltr;text-align:center;font-size:38px;letter-spacing:12px;font-weight:bold;color:#1e3a5f;background:#eef2f7;border:1px dashed #1e3a5f;border-radius:12px;padding:14px 0;font-family:Consolas,monospace">${escapeHtml(code)}</div>
<p style="margin:16px 0 0;color:#334155">صلاحية الرمز <b>5 دقائق</b> ولعملية واحدة فقط.</p>
<p style="margin:12px 0 0;background:#fef2f2;border-right:4px solid #b91c1c;padding:8px 12px;border-radius:6px;color:#7f1d1d">
⚠ إن لم تطلب هذا الرمز فقد يحاول أحد الوصول إلى أسرار الخوادم بحسابك؛ راجع سجل التدقيق فورًا.</p>`);
  const text = `مرحبًا ${name}\nرمز كشف الأسرار التقنية في بوابة ديتيلز: ${code}\nصلاحية الرمز 5 دقائق ولعملية واحدة.`;
  return { subject: `رمز كشف الأسرار التقنية: ${code} — بوابة ديتيلز`, html, text };
}

// Relay of a notification (from «مركز الإشعارات») to e-mail; the button opens the notification url or the notifications page
export function renderNotificationEmail({ name, title, body, url, severity, baseUrl }) {
  const SEV = { info: 'معلومة', warn: 'تنبيه', urgent: 'عاجل' };
  const color = severity === 'urgent' ? '#b91c1c' : (severity === 'warn' ? '#b45309' : '#0f8a6b');
  const href = url && /^https:\/\//.test(url) ? url : `${baseUrl || ''}${url && url.startsWith('/') ? url : '/notifications'}`;
  const html = layout(title, `
<p style="margin:0 0 6px;font-size:18px;font-weight:bold">مرحبًا ${escapeHtml(name)}</p>
<p style="margin:0 0 10px"><span style="display:inline-block;padding:2px 10px;border-radius:99px;background:${color};color:#fff;font-size:12px">${SEV[severity] || 'معلومة'}</span></p>
<p style="margin:0 0 8px;font-size:16px;font-weight:bold">${escapeHtml(title)}</p>
${body ? `<p style="margin:0 0 14px;color:#334155;white-space:pre-line">${escapeHtml(body)}</p>` : ''}
<p style="margin:0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#0f8a6b;color:#fff;text-decoration:none;padding:9px 18px;border-radius:10px;font-weight:bold">فتح الإشعار</a></p>`);
  const text = `مرحبًا ${name}\n${title}\n${body || ''}\n${href}`;
  return { subject: `${SEV[severity] ? SEV[severity] + ': ' : ''}${title} — بوابة ديتيلز`, html, text };
}

export function renderTestEmail({ name }) {
  return {
    subject: 'رسالة اختبار — بوابة ديتيلز',
    html: layout('اختبار', `<p style="margin:0">مرحبًا ${escapeHtml(name)}،</p><p>إعدادات البريد (SMTP) في بوابة ديتيلز تعمل بشكل صحيح.</p>`),
    text: `مرحبًا ${name}\nإعدادات البريد في بوابة ديتيلز تعمل بشكل صحيح.`,
  };
}

export async function sendMail(smtp, to, { subject, html, text }) {
  if (!smtpConfigured(smtp)) throw new Error('SMTP not configured');
  await getTransport(smtp).sendMail({
    from: { name: smtp.fromName, address: smtp.user }, to, subject, html, text,
    attachments: [{ filename: 'logo.png', path: LOGO, cid: 'logo' }],
  });
}
