// Shared route helpers: messages, pages, current user
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COOKIE_NAME, readSessionId, loadSession, sessionStatus, employeeUsable, needsTouch, touchSession } from '../lib/session.js';

// Uniform Arabic messages — never reveal internal details or whether an employee exists
export const MSG = {
  login: 'تعذر التحقق من البيانات. تأكد من الرقم الوظيفي أو تواصل مع مدير النظام.',
  code: 'رمز التحقق غير صحيح أو انتهت صلاحيته.',
  limit: 'تم تجاوز عدد المحاولات المسموح. حاول مرة أخرى لاحقًا.',
  tooSoon: 'انتظر دقيقة قبل طلب رمز جديد.',
  noEmail: 'لا يوجد بريد إلكتروني مسجل لهذا الرقم. تواصل مع مدير النظام لإضافته.',
  noChannel: 'لا يوجد بريد إلكتروني أو رقم جوال مسجل لهذا الرقم. تواصل مع مدير النظام لإضافته.',
  mail: 'تعذر إرسال رمز التحقق الآن. حاول بعد قليل أو تواصل مع مدير النظام.',
  auth: 'انتهت الجلسة. سجّل الدخول من جديد.',
  forbidden: 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  badRequest: 'الطلب غير صالح.',
  server: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
};

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const cache = new Map();
export function sendPage(reply, name) {
  if (!cache.has(name) || process.env.NODE_ENV !== 'production') cache.set(name, readFileSync(WEB + name));
  return reply.type('text/html; charset=utf-8').send(cache.get(name));
}

// Valid session row (with employee) or null
export async function currentUser(app, req) {
  const id = readSessionId(req.cookies[COOKIE_NAME], app.cfg.sessionSecret);
  if (!id) return null;
  const row = await loadSession(app.db, id);
  const sec = app.settings ? await app.settings.get('security') : null;
  if (sessionStatus(row, new Date(), sec ? sec.idle_minutes * 60_000 : undefined) !== 'ok') return null;
  if (!employeeUsable({ active: row.active, expires_at: row.employee_expires_at })) return null;
  if (needsTouch(row)) await touchSession(app.db, id);
  return row;
}

// preHandlers for JSON APIs
export const requireUser = (app) => async (req, reply) => {
  req.user = await currentUser(app, req);
  if (!req.user) return reply.code(401).send({ error: MSG.auth });
};
export const requireAdmin = (app) => async (req, reply) => {
  req.user = await currentUser(app, req);
  if (!req.user) return reply.code(401).send({ error: MSG.auth });
  if (req.user.role !== 'admin') return reply.code(403).send({ error: MSG.forbidden });
  // admin writes must be JSON (blocks cross-site form posts)
  if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
    return reply.code(415).send({ error: MSG.badRequest });
  }
};
