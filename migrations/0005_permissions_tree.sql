-- شجرة الصلاحيات الموحدة (تنمو تلقائيًا من كتالوج كل نظام). إضافي وآمن للتكرار.
-- perm_nodes: عناصر الشجرة (نظام → وحدة → شاشة → إجراء). لا تُحذف أبدًا؛ المحذوف من الكتالوج يُوسم present=false.
-- perm_grants: غياب الصف = ممنوع. المشرف العام المطلق (employees.role='admin') لا يحتاج صفوفًا.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'perm_kind') THEN
    CREATE TYPE perm_kind AS ENUM ('system', 'module', 'screen', 'action');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS perm_nodes (
  key            text PRIMARY KEY CHECK (key ~ '^[a-z0-9_-]+(\.[a-z0-9_-]+)*$' AND length(key) <= 200),
  system_key     text NOT NULL REFERENCES systems(key) ON UPDATE CASCADE,
  parent_key     text REFERENCES perm_nodes(key) ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
  label_ar       text NOT NULL,
  description_ar text NOT NULL DEFAULT '',
  kind           perm_kind NOT NULL DEFAULT 'action',
  sort           int NOT NULL DEFAULT 100,
  present        boolean NOT NULL DEFAULT true,
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS perm_nodes_system ON perm_nodes (system_key, sort, key);
CREATE INDEX IF NOT EXISTS perm_nodes_parent ON perm_nodes (parent_key);

CREATE TABLE IF NOT EXISTS perm_grants (
  employee_id uuid NOT NULL REFERENCES employees(id),
  perm_key    text NOT NULL REFERENCES perm_nodes(key) ON UPDATE CASCADE,
  allowed     boolean NOT NULL DEFAULT true,
  granted_by  uuid REFERENCES employees(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  reason      text,
  PRIMARY KEY (employee_id, perm_key)
);
CREATE INDEX IF NOT EXISTS perm_grants_key ON perm_grants (perm_key);

-- جذر واحد لكل نظام قائم، بالاسم العربي من جدول الأنظمة
INSERT INTO perm_nodes (key, system_key, parent_key, label_ar, description_ar, kind, sort)
SELECT key, key, NULL, name_ar, description_ar, 'system', sort
  FROM systems WHERE key IN ('hr', 'wms', 'mail', 'bls')
ON CONFLICT (key) DO NOTHING;

-- بطاقة «الصلاحيات» في الشبكة أُلغيت: صارت أيقونة في رأس البوابة للمشرف العام فقط
DELETE FROM grants  WHERE system_key = 'perms';
DELETE FROM systems WHERE key = 'perms';
