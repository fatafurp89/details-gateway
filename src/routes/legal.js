// صفحات عامة (بلا جلسة) تطلبها منصات خارجية مثل Meta: سياسة الخصوصية، شروط الخدمة، حذف البيانات.
import { sendPage } from './helpers.js';

export default async function legalRoutes(app) {
  for (const p of ['/privacy', '/privacy-policy', '/legal/privacy']) app.get(p, async (_req, reply) => sendPage(reply, 'legal/privacy.html'));
  for (const p of ['/terms', '/terms-of-service', '/legal/terms']) app.get(p, async (_req, reply) => sendPage(reply, 'legal/terms.html'));
  for (const p of ['/data-deletion', '/data-deletion-request', '/legal/data-deletion']) app.get(p, async (_req, reply) => sendPage(reply, 'legal/data-deletion.html'));
  // Meta "Data deletion request callback" may POST a signed_request; acknowledge with a confirmation code + status URL.
  app.post('/data-deletion', async (req, reply) => {
    const code = 'DD-' + Date.now().toString(36).toUpperCase();
    app.log.info({ code, ip: req.ip }, 'data deletion request received');
    return reply.send({ url: 'https://details-wms.cloud/data-deletion?code=' + code, confirmation_code: code });
  });
}
