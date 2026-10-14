// Fastify app factory (no listening here, so it can be tested with inject)
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import fstatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { MSG } from './routes/helpers.js';
import loginRoutes from './routes/login.js';
import portalRoutes from './routes/portal.js';
import adminRoutes from './routes/admin.js';
import permsRoutes from './routes/perms.js';
import infraRoutes from './routes/infra.js';
import linksRoutes from './routes/links.js';
import notificationsRoutes from './routes/notifications.js';
import companyRoutes from './routes/company.js';
import companyStructureRoutes from './routes/company-structure.js';
import settingsRoutes from './routes/settings.js';
import legalRoutes from './routes/legal.js';
import storageAdminRoutes from './routes/storage-admin.js';
import { createSettingsStore } from './lib/settings-store.js';
import { ipBlocked } from './lib/settings.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));

export async function buildApp({ cfg, db, logger = true }) {
  const app = Fastify({
    logger: logger && { level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: '127.0.0.1', // nginx sets X-Forwarded-For
    bodyLimit: 2 * 1024 * 1024,
  });
  app.decorate('cfg', cfg);
  app.decorate('db', db);
  // «إعدادات النظام»: defaults → env → stored rows (cached 30s); SMTP password decrypted with SECRETS_KEY
  app.decorate('settings', createSettingsStore(db, { secretsKey: cfg.secretsKey, smtpEnv: cfg.smtp, logger: app.log }));

  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({ statusCode: 429, error: MSG.limit }),
  });
  await app.register(fstatic, {
    root: WEB, prefix: '/static/', index: false, decorateReply: false, maxAge: '1h',
    allowedPath: (p) => !p.endsWith('.html'),
  });

  const BASE_ORIGIN = new URL(cfg.baseUrl).origin;
  app.addHook('onRequest', async (req, reply) => {
    // IP block list from «الجلسات والأمان» (never loopback; internal /_gw/* and /healthz are exempt)
    if (!req.url.startsWith('/_gw/') && req.url !== '/healthz') {
      const sec = await app.settings.get('security');
      if (sec.ip_blocklist?.length && ipBlocked(req.ip, sec.ip_blocklist)) return reply.code(403).send({ error: MSG.forbidden });
    }
    // CSRF: state-changing requests must come from our own origin
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== BASE_ORIGIN) return reply.code(403).send({ error: MSG.forbidden });
    }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const type = String(reply.getHeader('content-type') || '');
    if (type.startsWith('text/html')) {
      const legal = /^\/(legal\/)?(privacy|privacy-policy|terms|terms-of-service|data-deletion|data-deletion-request)(\?|$)/.test(req.url || '');
      reply.header('Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: https:; style-src 'self'" + (legal ? " 'unsafe-inline'" : '') + "; script-src 'self'; connect-src 'self'; " +
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    }
    if (!req.url.startsWith('/static/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode === 429) return reply.code(429).send({ error: MSG.limit });
    if (err.validation || (err.statusCode >= 400 && err.statusCode < 500)) {
      return reply.code(err.statusCode || 400).send({ error: MSG.badRequest });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: MSG.server });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'الصفحة غير موجودة' }));

  await app.register(loginRoutes);
  await app.register(legalRoutes);
  await app.register(portalRoutes);
  await app.register(adminRoutes);
  await app.register(permsRoutes);
  await app.register(infraRoutes);
  await app.register(linksRoutes);
  await app.register(notificationsRoutes);
  await app.register(companyRoutes);
  await app.register(companyStructureRoutes);
  await app.register(settingsRoutes);
  await app.register(storageAdminRoutes);
  return app;
}
