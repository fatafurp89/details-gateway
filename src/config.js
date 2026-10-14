// Configuration from environment (/etc/details-gateway/env via systemd). No secrets in code.
const env = process.env;

function required(name, minLen = 1) {
  const v = env[name];
  if (!v || v.length < minLen) throw new Error(`Missing or too short env var ${name}`);
  return v;
}

export function loadConfig() {
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 4000),
    baseUrl: (env.BASE_URL || 'https://details-wms.cloud').replace(/\/$/, ''),
    cookieDomain: env.COOKIE_DOMAIN || '.details-wms.cloud',
    rootDomain: env.ROOT_DOMAIN || 'details-wms.cloud',
    databaseUrl: required('DATABASE_URL'),
    sessionSecret: required('SESSION_SECRET', 32),
    otpPepper: required('OTP_PEPPER', 32),
    ticketSecret: required('TICKET_SECRET', 32),
    // Shared with HR / WMS / mail / BLS for the internal /_gw/catalog and /_gw/grants endpoints (empty = those endpoints refuse)
    proxyKey: env.GATEWAY_PROXY_KEY || '',
    // AES-256-GCM key (64 hex chars) for infra_secrets; empty/invalid = the secrets endpoints answer 503
    secretsKey: env.SECRETS_KEY || '',
    smtp: {
      host: env.SMTP_HOST || 'smtp.hostinger.com',
      port: Number(env.SMTP_PORT || 465),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      fromName: env.SMTP_FROM_NAME || 'ديتيلز للاستشارات الهندسية',
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID || '',
      clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: env.GOOGLE_REDIRECT_URI || 'https://details-wms.cloud/api/auth/google/callback',
    },
    bootstrap: {
      employeeNo: env.BOOTSTRAP_ADMIN_EMPLOYEE_NO || '',
      name: env.BOOTSTRAP_ADMIN_NAME || '',
      email: env.BOOTSTRAP_ADMIN_EMAIL || '',
    },
  };
}
