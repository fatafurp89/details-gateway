-- تحديث أيقونات الأنظمة: من إيموجي إلى ملفات PNG منفصلة
UPDATE systems SET icon = 'mail' WHERE key = 'mail';
UPDATE systems SET icon = 'whatsapp' WHERE key = 'whatsapp';
UPDATE systems SET icon = 'human_resources' WHERE key = 'hr';
UPDATE systems SET icon = 'archive_search' WHERE key = 'bls';
UPDATE systems SET icon = 'work_management' WHERE key = 'wms';
UPDATE systems SET icon = 'settings' WHERE key = 'settings';
UPDATE systems SET icon = 'notifications' WHERE key = 'notifications';
UPDATE systems SET icon = 'company_data' WHERE key = 'company';
UPDATE systems SET icon = 'quick_links' WHERE key = 'links';
UPDATE systems SET icon = 'receive_send' WHERE key = 'files';
UPDATE systems SET icon = 'hr-portal' WHERE key = 'hr-portal';

-- لا تؤثر على الأيقونات النصية إن وجدت في أنظمة مستقبلية
