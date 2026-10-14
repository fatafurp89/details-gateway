-- «المعلومات التقنية» وخريطة المنظومة: الأجهزة، الوصلات، تكوين ديتيلز، التقارير الحيّة، الأسرار المشفّرة.
-- إضافي وآمن للتكرار. الأسرار تُشفَّر في الخادم بمفتاح SECRETS_KEY من البيئة (AES-256-GCM)، لا في القاعدة.

-- رمز OTP له غرض: 'login' (الدخول) أو 'infra_secrets' (كشف/تعديل الأسرار التقنية)
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'login';
CREATE INDEX IF NOT EXISTS otp_codes_purpose ON otp_codes (employee_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS infra_nodes (
  key              text PRIMARY KEY CHECK (key ~ '^[a-z0-9_-]{2,60}$'),
  name_ar          text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('internet','isp','provider','dns','site','vps','office-server','router','gateway','switch','ap','device','service')),
  model            text,
  provider         text,
  plan             text,
  subscription_end date,
  status_source    text NOT NULL DEFAULT 'manual' CHECK (status_source IN ('agent','ping','manual')),
  status           text NOT NULL DEFAULT 'unknown' CHECK (status IN ('up','down','unknown')),
  status_at        timestamptz,
  public_ip        text,
  local_ip         text,
  tailscale_ip     text,
  wg_ip            text,
  hostname         text,
  os               text,
  urls             jsonb NOT NULL DEFAULT '[]'::jsonb,
  username         text,
  notes            text,
  parent_key       text REFERENCES infra_nodes(key) ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
  sort             int NOT NULL DEFAULT 100,
  external         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS infra_nodes_parent ON infra_nodes (parent_key, sort);

CREATE TABLE IF NOT EXISTS infra_links (
  id        serial PRIMARY KEY,
  from_key  text NOT NULL REFERENCES infra_nodes(key) ON UPDATE CASCADE ON DELETE CASCADE,
  to_key    text NOT NULL REFERENCES infra_nodes(key) ON UPDATE CASCADE ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('lan','internet','wireguard','tailscale','usb')),
  label_ar  text NOT NULL DEFAULT '',
  UNIQUE (from_key, to_key, kind)
);

CREATE TABLE IF NOT EXISTS infra_services (
  id         serial PRIMARY KEY,
  node_key   text NOT NULL REFERENCES infra_nodes(key) ON UPDATE CASCADE ON DELETE CASCADE,
  name_ar    text NOT NULL,
  system_key text REFERENCES systems(key) ON UPDATE CASCADE ON DELETE SET NULL,
  port       int CHECK (port IS NULL OR (port BETWEEN 1 AND 65535)),
  unit_name  text,
  url        text,
  notes      text,
  sort       int NOT NULL DEFAULT 100,
  UNIQUE (node_key, name_ar)
);

-- تقرير الوكيل (أو نتيجة ping) لكل عقدة؛ يُحتفظ بآخر 7 أيام
CREATE TABLE IF NOT EXISTS infra_status (
  id          bigserial PRIMARY KEY,
  node_key    text NOT NULL REFERENCES infra_nodes(key) ON UPDATE CASCADE ON DELETE CASCADE,
  reported_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS infra_status_node ON infra_status (node_key, reported_at DESC);

-- أسرار الدخول لكل عقدة: secret_enc = النص المشفّر + وسم GCM (16 بايت)، iv = 12 بايت
CREATE TABLE IF NOT EXISTS infra_secrets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_key   text NOT NULL REFERENCES infra_nodes(key) ON UPDATE CASCADE ON DELETE CASCADE,
  label_ar   text NOT NULL,
  username   text,
  secret_enc bytea NOT NULL,
  iv         bytea NOT NULL,
  created_by uuid REFERENCES employees(id),
  updated_by uuid REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS infra_secrets_node ON infra_secrets (node_key);

CREATE TABLE IF NOT EXISTS infra_secret_reveals (
  id          bigserial PRIMARY KEY,
  secret_id   uuid NOT NULL REFERENCES infra_secrets(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  at          timestamptz NOT NULL DEFAULT now(),
  ip          inet
);
CREATE INDEX IF NOT EXISTS infra_secret_reveals_secret ON infra_secret_reveals (secret_id, at DESC);

-- ============ البذرة الأولية (ما نعرفه 2026-10-14) ============
INSERT INTO infra_nodes (key, name_ar, kind, model, provider, plan, subscription_end, status_source, public_ip, local_ip, tailscale_ip, wg_ip, hostname, os, urls, notes, parent_key, sort, external) VALUES
 ('internet', 'الإنترنت', 'internet', NULL, NULL, NULL, NULL, 'manual', NULL, NULL, NULL, NULL, NULL, NULL, '[]', 'الشبكة العامة؛ منها تصل الخوادم السحابية ومكتب ديتيلز.', NULL, 10, false),
 ('hostinger', 'Hostinger (استضافة الخوادم والنطاقات)', 'provider', NULL, 'Hostinger', NULL, NULL, 'manual', NULL, NULL, NULL, NULL, NULL, NULL,
   '[{"label_ar":"لوحة Hostinger (hPanel)","url":"https://hpanel.hostinger.com/"}]', 'مزود الخوادم الافتراضية (VPS KVM) ونطاقات ديتيلز.', 'internet', 10, false),
 ('bridge', 'الجسر والبوابة (details-webApp.cloud)', 'vps', 'VPS KVM 4 (4 vCPU، 16 GB RAM، 193 GB)', 'Hostinger', 'KVM 4', '2027-08-16', 'agent',
   '179.198.192.141', NULL, '100.114.89.112', '10.9.0.1', 'details-webApp.cloud', 'Ubuntu 24.04',
   '[{"label_ar":"بوابة ديتيلز","url":"https://details-wms.cloud/"},{"label_ar":"إدارة البوابة","url":"https://details-wms.cloud/admin"}]',
   'يستضيف بوابة الدخول الموحد وnginx وطرف WireGuard المركزي (10.9.0.1).', 'hostinger', 10, false),
 ('apps', 'سيرفر التطبيقات (details-mail.com): البريد + الموارد البشرية', 'vps', 'VPS KVM 4 (4 vCPU، 16 GB RAM)', 'Hostinger', 'KVM 4', '2027-09-05', 'agent',
   '31.97.196.127', NULL, '100.71.94.95', '10.9.0.3', 'details-mail.com', 'Ubuntu 24.04',
   '[{"label_ar":"بريد ديتيلز","url":"https://details-mail.com/"},{"label_ar":"الموارد البشرية","url":"https://details-hr.com/"}]',
   'يشغّل نظام البريد (API + واجهة) ونظام الموارد البشرية مع PostgreSQL 16.', 'hostinger', 20, false),
 ('spare', 'خادم احتياطي فارغ (details-hr.cloud)', 'vps', 'VPS KVM 1', 'Hostinger', 'KVM 1', '2027-07-01', 'agent',
   '82.25.118.156', NULL, '100.101.112.111', NULL, 'details-hr.cloud', 'Ubuntu 24.04', '[]', 'غير مستخدم حاليًا؛ احتياطي.', 'hostinger', 30, false),
 ('accounting', 'personal-accounting-system.cloud (خارج منظومة ديتيلز)', 'vps', 'VPS KVM 1', 'Hostinger', 'KVM 1', '2027-04-11', 'manual',
   '72.60.194.140', NULL, NULL, NULL, 'personal-accounting-system.cloud', NULL, '[]', 'يُعرض للعلم فقط؛ لا يتبع منظومة ديتيلز.', 'hostinger', 40, true),
 ('dns', 'النطاقات (Hostinger DNS)', 'dns', NULL, 'Hostinger', 'DNS', NULL, 'manual', NULL, NULL, NULL, NULL, NULL, NULL,
   '[{"label_ar":"details-wms.cloud","url":"https://details-wms.cloud/"},{"label_ar":"details-mail.com","url":"https://details-mail.com/"},{"label_ar":"details-hr.com","url":"https://details-hr.com/"},{"label_ar":"details-consults.sa","url":"https://details-consults.sa/"}]',
   'النطاقات: details-wms.cloud · details-mail.com · details-hr.com · details-consults.sa', 'hostinger', 50, false),
 ('office', 'مكتب ديتيلز', 'site', NULL, NULL, NULL, NULL, 'manual', NULL, '10.10.10.0/24', NULL, NULL, NULL, NULL, '[]', 'الشبكة المحلية للمكتب 10.10.10.0/24.', NULL, 20, false),
 ('huawei', 'راوتر هواوي 5G (الإنترنت الرئيسي)', 'router', 'Huawei 5G CPE', 'مزود الاتصالات (IP عام متغيّر)', NULL, NULL, 'ping',
   NULL, '192.168.8.1', NULL, NULL, NULL, NULL, '[{"label_ar":"واجهة الراوتر","url":"http://192.168.8.1/"}]', 'الخط الرئيسي للإنترنت في المكتب؛ العنوان العام يتغيّر.', 'office', 10, false),
 ('ruijie-gw', 'بوابة Ruijie EG105G-P (راوتر المكتب وDHCP)', 'gateway', 'Ruijie EG105G-P', 'Ruijie Cloud', NULL, NULL, 'ping',
   NULL, '10.10.10.10', NULL, NULL, NULL, NULL, '[{"label_ar":"واجهة البوابة","url":"http://10.10.10.10/"},{"label_ar":"Ruijie Cloud","url":"https://cloud.ruijienetworks.com/"}]',
   'WAN 192.168.8.3 (من راوتر هواوي) · LAN 10.10.10.10 · يوزّع DHCP على شبكة المكتب.', 'huawei', 10, false),
 ('sw24', 'سويتش Ruijie ES228GS-P (24 منفذ)', 'switch', 'Ruijie ES228GS-P', 'Ruijie', NULL, NULL, 'ping', NULL, '10.10.10.13', NULL, NULL, NULL, NULL,
   '[{"label_ar":"واجهة السويتش","url":"http://10.10.10.13/"}]', NULL, 'ruijie-gw', 10, false),
 ('sw8', 'سويتش Ruijie ES208GC (8 منافذ)', 'switch', 'Ruijie ES208GC', 'Ruijie', NULL, NULL, 'ping', NULL, '10.10.10.14', NULL, NULL, NULL, NULL,
   '[{"label_ar":"واجهة السويتش","url":"http://10.10.10.14/"}]', NULL, 'ruijie-gw', 20, false),
 ('office-server', 'خادم المكتب (details-server)', 'office-server', 'Lenovo Tower · i7 الجيل 14 · 32 GB RAM · NVMe 1 TB · HDD 10 TB · K-drive 7.3 TB', NULL, NULL, NULL, 'agent',
   NULL, '10.10.10.99', '100.104.255.88', '10.9.0.2', 'details-server', 'Ubuntu 24.04', '[]',
   'يشغّل نظام ديتيلز WMS وأرشيف BLS وPostgreSQL 16؛ يراقب أجهزة المكتب بالـ ping ويبلّغ عنها ضمن تقريره.', 'sw24', 10, false),
 ('ap', 'نقطة وصول Ruijie RAP2260(G) (Wi-Fi)', 'ap', 'Ruijie RAP2260(G)', 'Ruijie', NULL, NULL, 'ping', NULL, '10.10.10.19', NULL, NULL, NULL, NULL, '[]', NULL, 'sw24', 20, false),
 ('fingerprint', 'جهاز البصمة ZKTeco', 'device', 'ZKTeco SPK7252401007', 'ZKTeco', NULL, NULL, 'ping', NULL, '10.10.10.12', NULL, NULL, NULL, NULL, '[]',
   'جهاز حضور وانصراف؛ يقرأه نظام الموارد البشرية.', 'sw8', 10, false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO infra_links (from_key, to_key, kind, label_ar) VALUES
 ('internet', 'hostinger', 'internet', ''),
 ('hostinger', 'bridge', 'internet', ''),
 ('hostinger', 'apps', 'internet', ''),
 ('hostinger', 'spare', 'internet', ''),
 ('hostinger', 'accounting', 'internet', ''),
 ('hostinger', 'dns', 'internet', ''),
 ('internet', 'huawei', 'internet', 'خط 5G'),
 ('huawei', 'ruijie-gw', 'lan', 'WAN 192.168.8.3'),
 ('ruijie-gw', 'sw24', 'lan', ''),
 ('ruijie-gw', 'sw8', 'lan', ''),
 ('sw24', 'office-server', 'lan', '10.10.10.99'),
 ('sw24', 'ap', 'lan', ''),
 ('sw8', 'fingerprint', 'lan', ''),
 ('bridge', 'office-server', 'wireguard', '10.9.0.1 ↔ 10.9.0.2'),
 ('bridge', 'apps', 'wireguard', '10.9.0.1 ↔ 10.9.0.3'),
 ('bridge', 'office-server', 'tailscale', ''),
 ('bridge', 'apps', 'tailscale', ''),
 ('bridge', 'spare', 'tailscale', ''),
 ('apps', 'office-server', 'tailscale', '')
ON CONFLICT (from_key, to_key, kind) DO NOTHING;

-- تكوين ديتيلز: أي نظام يعمل على أي جهاز وبأي منفذ (system_key يشير إلى جدول الأنظمة إن وُجد)
INSERT INTO infra_services (node_key, name_ar, system_key, port, unit_name, url, notes, sort)
SELECT v.node_key, v.name_ar, CASE WHEN EXISTS (SELECT 1 FROM systems s WHERE s.key = v.system_key) THEN v.system_key END, v.port, v.unit_name, v.url, v.notes, v.sort
FROM (VALUES
 ('bridge', 'بوابة ديتيلز (details-gateway)', NULL, 4000, 'details-gateway.service', 'https://details-wms.cloud/', 'Node 22 + Fastify خلف nginx', 10),
 ('bridge', 'PostgreSQL 16 (details_gateway)', NULL, 5432, 'postgresql.service', NULL, 'قاعدة البوابة (محلي فقط)', 20),
 ('bridge', 'nginx (TLS والتوجيه)', NULL, 443, 'nginx.service', NULL, 'details-wms.cloud والنطاقات الفرعية', 30),
 ('bridge', 'WireGuard 10.9.0.0/24 (الطرف المركزي)', NULL, 51820, 'wg-quick@wg0.service', NULL, '10.9.0.1', 40),
 ('bridge', 'Tailscale', NULL, NULL, 'tailscaled.service', NULL, '100.114.89.112', 50),
 ('office-server', 'نظام ديتيلز WMS', 'wms', 3200, 'details-wms.service', 'https://wms.details-wms.cloud/', 'يصل عبر WireGuard من الجسر (10.9.0.2:3200)', 10),
 ('office-server', 'PostgreSQL 16 (WMS)', 'wms', 5432, 'postgresql.service', NULL, NULL, 20),
 ('office-server', 'أرشيف ديتيلز BLS — الواجهة', 'bls', 9999, 'bls-web.service', NULL, 'داخل شبكة المكتب', 30),
 ('office-server', 'أرشيف ديتيلز BLS — الباكند', 'bls', 9998, 'bls-api.service', NULL, 'Node + SQLite', 40),
 ('office-server', 'nginx', NULL, 443, 'nginx.service', NULL, NULL, 50),
 ('office-server', 'WireGuard (10.9.0.2)', NULL, NULL, 'wg-quick@wg0.service', NULL, NULL, 60),
 ('office-server', 'Tailscale', NULL, NULL, 'tailscaled.service', NULL, '100.104.255.88', 70),
 ('office-server', 'وكيل المعلومات التقنية', NULL, NULL, 'infra-agent.timer', NULL, 'كل دقيقتين إلى /_gw/infra/report + ping أجهزة المكتب', 80),
 ('apps', 'الموارد البشرية', 'hr', 3300, 'details-hr.service', 'https://details-hr.com/', NULL, 10),
 ('apps', 'PostgreSQL 16 (hr_app)', 'hr', 5432, 'postgresql.service', NULL, 'قاعدة hr_app', 20),
 ('apps', 'بريد ديتيلز — API', 'mail', 5000, 'details-mail-api.service', NULL, NULL, 30),
 ('apps', 'بريد ديتيلز — الواجهة', 'mail', 3100, 'details-mail-web.service', 'https://details-mail.com/', NULL, 40),
 ('apps', 'PostgreSQL (details_mail)', 'mail', 5432, 'postgresql.service', NULL, 'قاعدة details_mail', 50),
 ('apps', 'nginx', NULL, 443, 'nginx.service', NULL, NULL, 60),
 ('apps', 'WireGuard (10.9.0.3)', NULL, NULL, 'wg-quick@wg0.service', NULL, NULL, 70),
 ('apps', 'Tailscale', NULL, NULL, 'tailscaled.service', NULL, '100.71.94.95', 80)
) AS v(node_key, name_ar, system_key, port, unit_name, url, notes, sort)
ON CONFLICT (node_key, name_ar) DO NOTHING;
