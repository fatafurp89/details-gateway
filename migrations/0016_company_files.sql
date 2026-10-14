-- «بيانات المنشأة» — ملفات المستندات على القرص + الحسابات البنكية + أنواع مستندات إضافية (فاتورة/شهادة/بنكي/عقد إيجار)
-- إضافي وآمن للتكرار. الملفات تُخزَّن تحت FILES_DIR (افتراضيًا /opt/details-gateway/files) في company/<doc_id>/<version>-<name>.

-- إصدارات المستندات: مسار الملف على القرص وحجمه وبصمته ونوعه
ALTER TABLE company_document_versions ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE company_document_versions ADD COLUMN IF NOT EXISTS size bigint;
ALTER TABLE company_document_versions ADD COLUMN IF NOT EXISTS sha256 text;
ALTER TABLE company_document_versions ADD COLUMN IF NOT EXISTS mime text;

-- المستند: رقم الوثيقة وجهة الإصدار (للعرض والتقارير)
ALTER TABLE company_documents ADD COLUMN IF NOT EXISTS doc_number text;
ALTER TABLE company_documents ADD COLUMN IF NOT EXISTS issuer_ar text;

-- أنواع إضافية: invoice (فاتورة)، certificate (شهادة)، bank (بنكي)، lease (عقد إيجار)
ALTER TABLE company_documents DROP CONSTRAINT IF EXISTS company_documents_kind_check;
ALTER TABLE company_documents ADD CONSTRAINT company_documents_kind_check
  CHECK (kind IN ('cr','license','tax','contract','lease','national_address','certificate','invoice','bank','other'));

-- الحسابات البنكية للشركة: الآيبان ورقم الحساب يُعرضان كاملين للمشرف فقط (مقنّعان لغيره)؛ بيانات الدخول للبنك الإلكتروني في أسرار «المعلومات التقنية»
CREATE TABLE IF NOT EXISTS company_bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name_ar    text NOT NULL,
  bank_name_en    text NOT NULL DEFAULT '',
  account_name    text NOT NULL DEFAULT '',
  iban            text,
  account_no      text,
  customer_no     text,
  swift           text,
  currency        text NOT NULL DEFAULT 'SAR',
  account_type    text,
  branch          text,
  opened_on       date,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
  signatories_ar  text,
  document_id     uuid REFERENCES company_documents(id) ON DELETE SET NULL,
  platform_id     uuid REFERENCES company_platforms(id) ON DELETE SET NULL,
  secret_node_key text,
  secret_ref      text,
  notes           text,
  sort            int NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- عقدة في «المعلومات التقنية» تحمل أسرار حسابات المنصات الحكومية والبنكية (secret_node_key في المنصات/الحسابات يشير إليها)
INSERT INTO infra_nodes (key, name_ar, kind, status_source, urls, notes, parent_key, sort, external)
SELECT 'company-accounts', 'حسابات الشركة على المنصات الحكومية والبنكية', 'service', 'manual', '[]'::jsonb,
  'أسرار الدخول لمنصات الشركة (وزارة الاستثمار، هيئة المهندسين، الغرفة، سبل، الزكاة، البنك…). تُكشف بـ OTP من هنا فقط؛ صفحة «بيانات المنشأة» تربط بالاسم.',
  'internet', 95, true
WHERE NOT EXISTS (SELECT 1 FROM infra_nodes WHERE key = 'company-accounts');
