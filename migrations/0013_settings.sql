-- «إعدادات النظام»: منصة إعدادات كاملة (/settings) + مخزن إعدادات مفتاح/قيمة + خزنة مفاتيح الذكاء الاصطناعي + سجل استخدامها.
-- إضافي وآمن للتكرار. المفاتيح والأسرار تُشفَّر في الخادم بمفتاح SECRETS_KEY (AES-256-GCM عبر src/lib/secretbox.js)، لا تُخزَّن نصًا أبدًا.

-- مخزن الإعدادات: صف لكل قسم (branding, security, smtp, notifications…) والقيمة jsonb؛ غياب الصف = الافتراضي (ثم متغيرات البيئة).
CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.-]{2,64}$'),
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES employees(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- خزنة مفاتيح الذكاء الاصطناعي: secret_enc = النص المشفّر + وسم GCM، secret_iv = 12 بايت. لا يُعاد المفتاح من أي واجهة بعد الحفظ.
CREATE TABLE IF NOT EXISTS ai_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL CHECK (provider IN ('deepseek','openai','anthropic','google','openrouter','other')),
  label           text NOT NULL,
  key_prefix      text NOT NULL,
  key_last4       text NOT NULL,
  secret_enc      bytea NOT NULL,
  secret_iv       bytea NOT NULL,
  base_url        text,
  default_model   text,
  created_by      uuid REFERENCES employees(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  status          text NOT NULL DEFAULT 'unknown' CHECK (status IN ('valid','invalid','disconnected','unknown')),
  last_error      text,
  usage_count     bigint NOT NULL DEFAULT 0,
  last_used_at    timestamptz,
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS ai_keys_provider ON ai_keys (provider, deleted_at, created_at);

-- سجل استدعاءات /_gw/ai/complete: من أي نظام، بأي مفتاح ونموذج، الرموز إن أعادها المزود، المدة، النجاح.
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id                bigserial PRIMARY KEY,
  system_key        text,
  key_id            uuid REFERENCES ai_keys(id) ON DELETE SET NULL,
  model             text,
  prompt_tokens     int,
  completion_tokens int,
  total_tokens      int,
  ms                int,
  ok                boolean NOT NULL,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_log_key ON ai_usage_log (key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_log_created ON ai_usage_log (created_at DESC);

-- موضع البطاقة: grid (بطاقة كاملة) | header (زر في الرأس) | compact (بطاقة مضغوطة: أيقونة واسم فقط، كما كانت «الروابط السريعة»)
ALTER TABLE systems DROP CONSTRAINT IF EXISTS systems_placement_check;
ALTER TABLE systems ADD CONSTRAINT systems_placement_check CHECK (placement IN ('grid','header','compact'));
UPDATE systems SET placement = 'compact' WHERE key IN ('links','files') AND placement = 'grid';

-- بطاقة «إعدادات النظام»: أيقونة فقط في البوابة (compact)، تفتح /settings في تبويب جديد. للمشرف العام (أو من يُمنح النظام + عناصر الشجرة).
INSERT INTO systems (key, name_ar, description_ar, icon, host, mode, upstream, status, sort, requires_grant, placement) VALUES
 ('settings','إعدادات النظام','الأنظمة والبطاقات، الهوية، الجلسات والأمان، البريد، الإشعارات، النسخ الاحتياطي، مفاتيح الذكاء الاصطناعي.','⚙️',NULL,'internal','/settings','live',97,true,'compact')
ON CONFLICT (key) DO UPDATE SET status='live', mode='internal', upstream='/settings', sort=97, icon='⚙️', requires_grant=true, placement='compact';

-- شجرة الصلاحيات لمنصة الإعدادات (نظام داخلي في البوابة): الجذر + وحدة لكل قسم.
-- الأقسام الحساسة (مفاتيح الذكاء الاصطناعي، البريد، الأمان، النسخ الاحتياطي) تبقى للمشرف العام مطلقًا حتى لو مُنح العنصر.
INSERT INTO perm_nodes (key, system_key, parent_key, label_ar, description_ar, kind, sort) VALUES
 ('settings',               'settings', NULL,       'إعدادات النظام',            'منصة إعدادات البوابة',                                                       'system', 0),
 ('settings.systems',       'settings', 'settings', 'الأنظمة والبطاقات',         'جدول الأنظمة: الاسم، الرابط، الموضع، الترتيب، الحالة، المنح',               'module', 10),
 ('settings.branding',      'settings', 'settings', 'الهوية والعلامة',           'شعار البوابة واسمها وألوانها',                                                'module', 20),
 ('settings.security',      'settings', 'settings', 'الجلسات والأمان',           'مدة الجلسة، رموز التحقق، حظر الغرباء، قائمة العناوين المحظورة (للمشرف العام فقط)', 'module', 30),
 ('settings.smtp',          'settings', 'settings', 'البريد الخارج (SMTP)',      'خادم البريد وكلمة مروره المشفّرة ورسالة اختبار (للمشرف العام فقط)',          'module', 40),
 ('settings.notifications', 'settings', 'settings', 'الإشعارات',                 'الافتراضيات حسب الأهمية وتحويل الإشعارات إلى البريد',                        'module', 50),
 ('settings.infra',         'settings', 'settings', 'المعلومات التقنية',         'رابط إلى صفحة المعلومات التقنية',                                             'module', 60),
 ('settings.links',         'settings', 'settings', 'الروابط السريعة',           'رابط إلى إدارة الروابط السريعة',                                              'module', 70),
 ('settings.perms',         'settings', 'settings', 'مركز الصلاحيات',            'رابط إلى شجرة الصلاحيات',                                                     'module', 80),
 ('settings.backup',        'settings', 'settings', 'النسخ الاحتياطي',           'آخر نسخة وتشغيل نسخة الآن (للمشرف العام فقط)',                               'module', 90),
 ('settings.ai_keys',       'settings', 'settings', 'مفاتيح الذكاء الاصطناعي',   'خزنة المفاتيح المشفّرة وفحص الاتصال (للمشرف العام فقط)',                     'module', 100),
 ('settings.ai_monitoring', 'settings', 'settings', 'مراقبة أداء الذكاء الاصطناعي للمفاتيح', 'سجلات الاستخدام والإحصائيات والاتجاهات والتنبيهات (للمشرف العام فقط)', 'module', 110)
ON CONFLICT (key) DO UPDATE SET label_ar = EXCLUDED.label_ar, description_ar = EXCLUDED.description_ar, present = true, last_seen = now();
