import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corsOriginAllowed } from '../src/lib/authz.js';

const ROOT = 'details-wms.cloud';

test('CORS for /api/me: only https one-label subdomains of the root domain, exact normalized origin', () => {
  assert.equal(corsOriginAllowed('https://mail.details-wms.cloud', ROOT), true);
  assert.equal(corsOriginAllowed('https://hr.details-wms.cloud', ROOT), true);
  assert.equal(corsOriginAllowed('https://files.details-wms.cloud', ROOT), true);
  assert.equal(corsOriginAllowed('https://whats-app.details-wms.cloud', ROOT), true);
});

test('CORS for /api/me: rejects everything else', () => {
  assert.equal(corsOriginAllowed('http://mail.details-wms.cloud', ROOT), false); // plain http
  assert.equal(corsOriginAllowed('https://details-wms.cloud', ROOT), false); // bare root (same-origin anyway)
  assert.equal(corsOriginAllowed('https://evil.com', ROOT), false);
  assert.equal(corsOriginAllowed('https://details-wms.cloud.evil.com', ROOT), false);
  assert.equal(corsOriginAllowed('https://xdetails-wms.cloud', ROOT), false);
  assert.equal(corsOriginAllowed('https://mail.details-wms.cloud:8443', ROOT), false); // port
  assert.equal(corsOriginAllowed('https://a.b.details-wms.cloud', ROOT), false); // two labels
  assert.equal(corsOriginAllowed('https://mail.details-wms.cloud/', ROOT), false); // not a normalized origin
  assert.equal(corsOriginAllowed('https://MAIL.details-wms.cloud', ROOT), false); // uppercase is not what browsers send
  assert.equal(corsOriginAllowed('null', ROOT), false);
  assert.equal(corsOriginAllowed('*', ROOT), false);
  assert.equal(corsOriginAllowed('', ROOT), false);
  assert.equal(corsOriginAllowed(undefined, ROOT), false);
  assert.equal(corsOriginAllowed('https://mail.details-wms.cloud', ''), false);
});
