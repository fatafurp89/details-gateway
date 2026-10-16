-- إضافة دعم المستندات غير المحدودة (دائمة / بدون تاريخ انتهاء)
ALTER TABLE company_documents ADD COLUMN IF NOT EXISTS is_unlimited boolean NOT NULL DEFAULT false;
ALTER TABLE company_document_versions ADD COLUMN IF NOT EXISTS is_unlimited boolean NOT NULL DEFAULT false;

-- المستندات ذات الصلاحية الدائمة تفرغ حقل تاريخ الانتهاء
UPDATE company_documents SET expires_on = NULL WHERE is_unlimited = true;
UPDATE company_document_versions SET expires_on = NULL WHERE is_unlimited = true;
