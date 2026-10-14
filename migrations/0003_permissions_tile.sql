-- «الصلاحيات»: an internal tile that opens the grants matrix; visible to admins only (requires a grant no one gets)
INSERT INTO systems (key, name_ar, description_ar, icon, host, mode, upstream, status, sort, requires_grant) VALUES
 ('perms', 'الصلاحيات', 'منح الموظفين حق استخدام أو إدارة كل نظام: الأرشيف، الموارد البشرية، البريد، ونظام ديتيلز.', '🔐', NULL, 'internal', '/admin#grants', 'live', 90, true)
ON CONFLICT (key) DO NOTHING;
