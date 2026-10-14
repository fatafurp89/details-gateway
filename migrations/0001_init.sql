-- Details Gateway: initial schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE employee_role AS ENUM ('admin', 'user');
CREATE TYPE system_mode   AS ENUM ('proxy', 'link', 'internal');
CREATE TYPE system_status AS ENUM ('live', 'soon', 'off');
CREATE TYPE grant_level   AS ENUM ('use', 'admin');
CREATE TYPE otp_channel   AS ENUM ('email', 'sms');

CREATE TABLE employees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_no  char(4) NOT NULL UNIQUE CHECK (employee_no ~ '^[0-9]{4}$'),
  full_name    text NOT NULL,
  mobile       text,
  email        text NOT NULL UNIQUE,
  google_email text UNIQUE,
  role         employee_role NOT NULL DEFAULT 'user',
  active       boolean NOT NULL DEFAULT true,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employees_email_lower ON employees (lower(email));
CREATE UNIQUE INDEX employees_google_lower ON employees (lower(google_email)) WHERE google_email IS NOT NULL;

CREATE TABLE systems (
  key            text PRIMARY KEY CHECK (key ~ '^[a-z0-9_-]{2,32}$'),
  name_ar        text NOT NULL,
  description_ar text NOT NULL DEFAULT '',
  icon           text NOT NULL DEFAULT '◼',
  host           text,
  mode           system_mode NOT NULL DEFAULT 'proxy',
  upstream       text,
  status         system_status NOT NULL DEFAULT 'soon',
  sort           int NOT NULL DEFAULT 100,
  requires_grant boolean NOT NULL DEFAULT true
);

CREATE TABLE grants (
  employee_id uuid NOT NULL REFERENCES employees(id),
  system_key  text NOT NULL REFERENCES systems(key) ON UPDATE CASCADE,
  level       grant_level NOT NULL DEFAULT 'use',
  granted_by  uuid REFERENCES employees(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, system_key)
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  channel     otp_channel NOT NULL DEFAULT 'email',
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_employee ON otp_codes (employee_id, created_at DESC);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           inet,
  user_agent   text,
  revoked_at   timestamptz
);
CREATE INDEX sessions_employee ON sessions (employee_id);

CREATE TABLE login_attempts (
  id         bigserial PRIMARY KEY,
  identifier text NOT NULL,
  ip         inet,
  ok         boolean NOT NULL,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_identifier ON login_attempts (identifier, created_at DESC);
CREATE INDEX login_attempts_ip ON login_attempts (ip, created_at DESC);

CREATE TABLE audit_log (
  id                bigserial PRIMARY KEY,
  actor_employee_id uuid REFERENCES employees(id),
  action            text NOT NULL,
  target            text,
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip                inet,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created ON audit_log (created_at DESC);

-- audit_log is append-only
CREATE FUNCTION audit_log_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_readonly();

-- default systems (admin may edit later)
INSERT INTO systems (key, name_ar, description_ar, icon, host, mode, upstream, status, sort) VALUES
 ('wms',  'نظام إدارة العمل Details WMS', 'المعاملات، مركز المستندات، التقارير الفنية والمساحية، الإشراف، العقود والعروض.', '🗂', 'wms.details-wms.cloud', 'proxy', 'http://10.9.0.2:3200', 'soon', 10),
 ('mail', 'بريد ديتيلز', 'البريد الموحد للشركة: الوارد والصادر، التصنيف، الاعتماد قبل الإرسال، المرفقات والتقويم.', '✉', 'details-mail.com', 'link', 'https://details-mail.com/sso', 'soon', 20),
 ('hr',   'الموارد البشرية', 'ملفات الموظفين، الحضور والبصمة، الإجازات، الرواتب، التقييمات.', '👥', 'details-hr.com', 'link', 'https://details-hr.com/sso', 'soon', 30),
 ('bls',  'بحث في أرشيف ديتيلز', 'البحث بالقطعة والرخصة والصك والطلب والمالك، الخريطة والطبقات، ملفات القطع.', '🔎', 'داخل الشبكة', 'link', NULL, 'soon', 40)
ON CONFLICT (key) DO NOTHING;
