-- «مركز الإشعارات»: تجميع إشعارات كل الأنظمة (الموارد البشرية، البريد، نظام ديتيلز، بيانات المنشأة…) في مكان واحد.
-- إضافي وآمن للتكرار. الإشعار يبقى في نظامه الأصلي أيضًا؛ هذا المركز يجمّع فقط.
-- employee_id فارغ = إشعار عام لكل الموظفين (تُسجَّل قراءته لكل موظف في notification_reads).
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  system_key  text NOT NULL REFERENCES systems(key) ON UPDATE CASCADE,
  kind        text NOT NULL DEFAULT 'info',
  title_ar    text NOT NULL,
  body_ar     text NOT NULL DEFAULT '',
  url         text,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','urgent')),
  source_ref  text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_employee ON notifications (employee_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_created ON notifications (created_at DESC);
-- idempotency: the same source reference is inserted once per (system, employee); broadcasts (employee_id NULL) once per system
CREATE UNIQUE INDEX IF NOT EXISTS notifications_source_employee ON notifications (system_key, source_ref, employee_id)
  WHERE source_ref IS NOT NULL AND employee_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_source_broadcast ON notifications (system_key, source_ref)
  WHERE source_ref IS NOT NULL AND employee_id IS NULL;

-- قراءة الإشعارات العامة لكل موظف
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, employee_id)
);

INSERT INTO systems (key, name_ar, description_ar, icon, host, mode, upstream, status, sort, requires_grant) VALUES
 ('notifications','مركز الإشعارات','كل إشعاراتك من الأنظمة في مكان واحد: الموارد البشرية، البريد، نظام ديتيلز، بيانات المنشأة.','🔔',NULL,'internal','/notifications','live',85,false)
ON CONFLICT (key) DO UPDATE SET status='live', mode='internal', upstream='/notifications', requires_grant=false, sort=85;
