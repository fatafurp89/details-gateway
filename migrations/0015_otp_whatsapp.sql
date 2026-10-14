-- رمز التحقق عبر واتساب: قناة جديدة في otp_codes.channel، وتوثيق مفتاح الإعداد security.otp_channel وأسباب login_attempts الجديدة.
-- إضافي وآمن للتكرار (PostgreSQL 16: ADD VALUE داخل معاملة مسموح؛ القيمة تُستعمل في معاملات لاحقة فقط).
ALTER TYPE otp_channel ADD VALUE IF NOT EXISTS 'whatsapp';

-- settings.security.otp_channel: 'email' (افتراضي) | 'whatsapp' | 'both'
--   whatsapp: يُرسل الرمز إلى جوال الموظف عبر خدمة واتساب ديتيلز (POST /internal/otp/send)؛ عند الفشل أو غياب الجوال يُرسل بالبريد تلقائيًا.
--   both:     يُرسل إلى واتساب والبريد معًا.
-- login_attempts.reason الجديدة: otp_whatsapp (أُرسل عبر واتساب)، otp_whatsapp_fail (فشل واتساب ثم بريد)، otp_switch_email (طلب الموظف البريد بدلًا من واتساب).
COMMENT ON COLUMN otp_codes.channel IS 'email | sms | whatsapp — القناة التي أُرسل بها الرمز فعليًا (both في الإعدادات = whatsapp هنا والبريد نسخة)';
