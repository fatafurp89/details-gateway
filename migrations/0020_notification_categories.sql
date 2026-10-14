-- «مركز الإشعارات»: تصنيف كل إشعار إلى «الأعمال» (work) أو «التقنية» (technical) + صلاحياتهما في شجرة الصلاحيات. إضافي وآمن للتكرار.
-- التصنيف الافتراضي للمجهول = work. جدول الاستنتاج الرسمي في src/lib/notify-categories.js (موثّق في SPEC.md)؛
-- هذا الترحيل يصنّف الموجود بأنماط kind/source_ref/system فقط، ثم scripts/rewrite-notifications.mjs يعيد التصنيف ويبسّط نصوص التقني.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'work';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_category_check') THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK (category IN ('work','technical'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS notifications_category ON notifications (employee_id, category, read_at, created_at DESC);

UPDATE notifications SET category = 'technical'
 WHERE category = 'work'
   AND (system_key IN ('infra','agent','system','monitor','backup')
        OR kind ~* '^(backup|infra|system|agent|security|service|disk|cert|ssl|tls|tunnel|wireguard|wg|node|server|deploy|cron|job|monitor|health|login-blocked|blocked|smtp|mail-send|mail-error|mail-service|mail-failed|send-failed|whatsapp-token|whatsapp-error|whatsapp-webhook|token|webhook|ai-key|api-key)([._:-]|$)'
        OR source_ref ~* '^(backup-|infra:|node:|disk:|cert:|service:|tunnel:|security:|agent:)');

-- شجرة الصلاحيات: نظام داخلي في البوابة (systems.key = notifications من الترحيل 0009)
INSERT INTO perm_nodes (key, system_key, parent_key, label_ar, description_ar, kind, sort) VALUES
 ('notifications',                     'notifications', NULL,                     'مركز الإشعارات',          'إشعارات الأنظمة في مكان واحد',                                                                  'system', 0),
 ('notifications.work',                'notifications', 'notifications',          'الإشعارات: الأعمال',      'إشعارات العمل: اعتمادات الموارد البشرية، مستندات المنشأة، الرسائل، الطلبات، الملفات (ممنوحة افتراضيًا لكل موظف)', 'module', 10),
 ('notifications.technical',           'notifications', 'notifications',          'الإشعارات: التقنية',      'إشعارات الأنظمة والسيرفرات والنسخ الاحتياطي والأمان بلغة مبسّطة (ممنوعة افتراضيًا)',                'module', 20),
 ('notifications.technical.details',   'notifications', 'notifications.technical','التفاصيل التقنية',       'رؤية النص التقني الأصلي (أوامر وأكواد) داخل الإشعار التقني',                                        'action', 10)
ON CONFLICT (key) DO UPDATE SET label_ar = EXCLUDED.label_ar, description_ar = EXCLUDED.description_ar, parent_key = EXCLUDED.parent_key, present = true, last_seen = now();

-- «الأعمال» ممنوحة افتراضيًا لكل موظف (قابلة للسحب من شجرة الصلاحيات): للموجودين الآن + مشغّل للجدد.
-- (التقنية والتفاصيل: بلا منح — المشرف العام المطلق 1010/1012 يتجاوز دائمًا بدور admin.)
INSERT INTO perm_grants (employee_id, perm_key, allowed, reason)
SELECT e.id, 'notifications.work', true, 'افتراضي: إشعارات الأعمال لكل موظف'
  FROM employees e
ON CONFLICT (employee_id, perm_key) DO NOTHING;

CREATE OR REPLACE FUNCTION grant_notifications_work() RETURNS trigger AS $$
BEGIN
  INSERT INTO perm_grants (employee_id, perm_key, allowed, reason)
  VALUES (NEW.id, 'notifications.work', true, 'افتراضي: إشعارات الأعمال لكل موظف')
  ON CONFLICT (employee_id, perm_key) DO NOTHING;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS employees_grant_notifications_work ON employees;
CREATE TRIGGER employees_grant_notifications_work AFTER INSERT ON employees
  FOR EACH ROW EXECUTE FUNCTION grant_notifications_work();
