-- بيانات تجريبية للتطوير فقط (لا تُشغَّل على الإنتاج)
-- psql "$DATABASE_URL" -f seed/dev-seed.sql
INSERT INTO systems (key, name_ar, description_ar, icon, host, mode, upstream, status, sort) VALUES
 ('wms',  'نظام إدارة العمل Details WMS', 'المعاملات، مركز المستندات، التقارير الفنية والمساحية، الإشراف، العقود والعروض.', '🗂', 'wms.details-wms.cloud', 'proxy', 'http://10.9.0.2:3200', 'soon', 10),
 ('mail', 'بريد ديتيلز', 'البريد الموحد للشركة: الوارد والصادر، التصنيف، الاعتماد قبل الإرسال، المرفقات والتقويم.', '✉', 'details-mail.com', 'link', 'https://details-mail.com/sso', 'soon', 20),
 ('hr',   'الموارد البشرية', 'ملفات الموظفين، الحضور والبصمة، الإجازات، الرواتب، التقييمات.', '👥', 'details-hr.com', 'link', 'https://details-hr.com/sso', 'soon', 30),
 ('bls',  'بحث في أرشيف ديتيلز', 'البحث بالقطعة والرخصة والصك والطلب والمالك، الخريطة والطبقات، ملفات القطع.', '🔎', 'داخل الشبكة', 'link', NULL, 'soon', 40)
ON CONFLICT (key) DO UPDATE SET name_ar = EXCLUDED.name_ar, description_ar = EXCLUDED.description_ar,
  icon = EXCLUDED.icon, host = EXCLUDED.host, mode = EXCLUDED.mode, upstream = EXCLUDED.upstream,
  status = EXCLUDED.status, sort = EXCLUDED.sort;

INSERT INTO employees (employee_no, full_name, mobile, email, google_email, role) VALUES
 ('1010', 'مدير النظام', '0550000010', 'admin@details-consults.sa', NULL, 'admin'),
 ('1021', 'موظف تجريبي أول', '0550000021', 'user1@details-consults.sa', NULL, 'user'),
 ('1022', 'موظف تجريبي ثانٍ', '0550000022', 'user2@details-consults.sa', NULL, 'user')
ON CONFLICT (employee_no) DO NOTHING;

INSERT INTO grants (employee_id, system_key, level)
SELECT e.id, g.k, g.l::grant_level FROM employees e
JOIN (VALUES ('1021','wms','use'), ('1021','mail','use'), ('1022','hr','use')) AS g(no, k, l) ON g.no = e.employee_no
ON CONFLICT DO NOTHING;
