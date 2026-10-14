-- «الروابط السريعة» كقائمة بأعمدة: الأهمية، مستوى الوصول، الصلاحية (انتهاء اختياري). إضافي وآمن للتكرار.
-- priority: normal (عادي) | important (مهم) | critical (حرج)
-- audience: all (الكل) | staff (الموظفون) | admins (المدراء) — يحل محل access ('all'/'admin') الذي يبقى متزامنًا للتوافق
ALTER TABLE quick_links ADD COLUMN IF NOT EXISTS priority   text NOT NULL DEFAULT 'normal';
ALTER TABLE quick_links ADD COLUMN IF NOT EXISTS audience   text NOT NULL DEFAULT 'all';
ALTER TABLE quick_links ADD COLUMN IF NOT EXISTS expires_at date;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quick_links_priority_check') THEN
    ALTER TABLE quick_links ADD CONSTRAINT quick_links_priority_check CHECK (priority IN ('normal','important','critical'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quick_links_audience_check') THEN
    ALTER TABLE quick_links ADD CONSTRAINT quick_links_audience_check CHECK (audience IN ('all','staff','admins'));
  END IF;
END $$;
UPDATE quick_links SET audience = 'admins' WHERE access = 'admin' AND audience = 'all';
