-- سياسة الموظفين: نظام الموارد البشرية هو المصدر الوحيد؛ يزامن عبر POST /_gw/employees/upsert ويحفظ قسمه ومسماه وحالته في hr_meta.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hr_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hr_synced_at timestamptz;

-- «بوابة الموظف»: رابط يظهر كزر صغير في رأس البوابة بجوار اسم الموظف بدل بطاقة في الشبكة.
-- عمود placement على systems: 'grid' (بطاقة في الشبكة، الافتراضي) أو 'header' (زر في الرأس). الصف يبقى قابلًا للتعديل من الإدارة.
ALTER TABLE systems ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'grid';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'systems_placement_check') THEN
    ALTER TABLE systems ADD CONSTRAINT systems_placement_check CHECK (placement IN ('grid','header'));
  END IF;
END $$;

INSERT INTO systems (key, name_ar, description_ar, icon, host, mode, upstream, status, sort, requires_grant, placement) VALUES
 ('hr-portal','بوابة الموظف','بوابتي: بياناتي، إجازاتي، حضوري، رواتبي — من نظام الموارد البشرية.','🪪',NULL,'link','https://hr.details-wms.cloud/portal','live',5,false,'header')
ON CONFLICT (key) DO UPDATE SET placement = 'header', requires_grant = false;
