-- «بيانات المنشأة»: الملف الرسمي للشركة، هيكل الملكية، المنصات والحسابات، المفوضون، المستندات بإصداراتها.
-- إضافي وآمن للتكرار. بيانات الدخول للمنصات لا تُخزَّن هنا (مكانها أسرار «المعلومات التقنية»)؛ نربط بالنص والمفتاح فقط.

-- الملف الرسمي: صف واحد فقط (id = 1)
CREATE TABLE IF NOT EXISTS company_profile (
  id                     int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  legal_name_ar          text NOT NULL DEFAULT '',
  legal_name_en          text NOT NULL DEFAULT '',
  trade_name_ar          text NOT NULL DEFAULT '',
  trade_name_en          text NOT NULL DEFAULT '',
  cr_number              text,
  cr_type                text,
  cr_copy_no             text,
  cr_issued_on           date,
  cr_expiry              date,
  cr_status              text,
  tax_number             text,
  legal_form             text,
  capital                numeric(14,2),
  activity_code          text,
  activity_ar            text,
  engineering_license_no text,
  license_expiry         date,
  chamber_no             text,
  city                   text,
  district               text,
  street                 text,
  national_address       jsonb NOT NULL DEFAULT '{}'::jsonb,
  phone                  text,
  email                  text,
  website                text,
  logo_url               text,
  established_on         date,
  notes                  text,
  updated_by             uuid REFERENCES employees(id),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- هيكل الملكية والإدارة
CREATE TABLE IF NOT EXISTS company_owners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar     text NOT NULL,
  name_en     text NOT NULL DEFAULT '',
  entity_kind text NOT NULL DEFAULT 'person' CHECK (entity_kind IN ('person','entity')),
  id_number   text,
  nationality text,
  share_pct   numeric(5,2) CHECK (share_pct IS NULL OR (share_pct >= 0 AND share_pct <= 100)),
  role        text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','partner','manager')),
  since       date,
  notes       text,
  sort        int NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- المنصات والحسابات الرسمية
CREATE TABLE IF NOT EXISTS company_platforms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar           text NOT NULL UNIQUE,
  category          text NOT NULL DEFAULT 'government' CHECK (category IN ('government','bank','private','utility')),
  url               text,
  account_username  text,
  account_holder_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  role_ar           text,
  expiry_date       date,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  notes             text,
  quick_link_id     uuid REFERENCES quick_links(id) ON DELETE SET NULL,
  secret_node_key   text,
  secret_ref        text,
  sort              int NOT NULL DEFAULT 100,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- المفوضون على المنصات
CREATE TABLE IF NOT EXISTS company_delegations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegate_name text NOT NULL,
  employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  platform_id   uuid REFERENCES company_platforms(id) ON DELETE SET NULL,
  scope_ar      text NOT NULL DEFAULT '',
  valid_from    date,
  valid_to      date,
  document_url  text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- المستندات الرسمية: الأعمدة file_url/issued_on/expires_on تعكس الإصدار الحالي (للاستعلام السريع والتنبيهات)
CREATE TABLE IF NOT EXISTS company_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_ar    text NOT NULL,
  kind        text NOT NULL DEFAULT 'other' CHECK (kind IN ('cr','license','tax','contract','national_address','other')),
  file_url    text,
  file_name   text,
  issued_on   date,
  expires_on  date,
  notes       text,
  sort        int NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_documents_expiry ON company_documents (expires_on);

-- إصدارات كل مستند: من رفعه ومتى وصلاحيته؛ إصدار واحد فقط «حالي»
CREATE TABLE IF NOT EXISTS company_document_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES company_documents(id) ON DELETE CASCADE,
  version_no  int NOT NULL,
  file_url    text,
  file_name   text,
  issued_on   date,
  expires_on  date,
  uploaded_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  notes       text,
  is_current  boolean NOT NULL DEFAULT false,
  UNIQUE (document_id, version_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS company_document_versions_current ON company_document_versions (document_id) WHERE is_current;

-- ============ البذرة (من السجل التجاري وإثبات العنوان الوطني، 2026-10-14) ============
INSERT INTO company_profile (id, legal_name_ar, legal_name_en, trade_name_ar, trade_name_en, cr_number, cr_type, cr_copy_no, cr_issued_on, cr_expiry, cr_status,
  legal_form, capital, activity_code, activity_ar, city, district, street, national_address, phone, email, website, established_on, notes)
SELECT 1, 'شركة ديتيلز كونسولتس', 'Details Consults Company', 'ديتيلز للاستشارات الهندسية', 'Details Consulting Engineers',
  '7052303828', 'رئيسي', '3', '2025-10-30', '2027-10-29', 'نشط',
  'شركة ذات مسؤولية محدودة (شخص واحد) — مهنية', 100000.00, '711013', 'أنشطة الاستشارات الهندسية والمعمارية',
  'الرياض', 'حي الملك فهد', 'شارع سعود بن عبدالعزيز بن محمد الفرعي',
  '{"account_no":"31333834827","registration_date":"2025-12-04","proof_no":"1095524137","issued_on":"2026-10-12","expires_on":"2027-04-10",
    "short_address":"RHFB2957","building":"2957","street_ar":"سعود بن عبدالعزيز بن محمد الفرعي","street_en":"Saud Ibn Abdulaziz Ibn Muhammad Branch",
    "secondary_no":"8238","district_ar":"حي الملك فهد","district_en":"King Fahd Dist.","postal_code":"12274","city_ar":"الرياض","city_en":"Riyadh",
    "country_ar":"المملكة العربية السعودية","country_en":"Saudi Arabia","verify_url":"https://proof.address.gov.sa/VerifyProofNA.aspx"}'::jsonb,
  '00966590722827', 'info@details-consults.sa', 'details-consults.sa', '2025-10-30',
  'تاريخ إصدار السجل 1447-05-08 هـ؛ موعد التأكيد السنوي 1449-05-29 هـ. الرقم الضريبي ورخصة الهيئة ورقم الغرفة تُستكمل لاحقًا.'
WHERE NOT EXISTS (SELECT 1 FROM company_profile WHERE id = 1);

INSERT INTO company_owners (name_ar, name_en, entity_kind, role, sort, notes)
SELECT v.name_ar, v.name_en, 'person', 'manager', v.sort, 'من قائمة المديرين في السجل التجاري؛ نسبة الملكية تُحدَّد لاحقًا.'
FROM (VALUES ('محمد نظمي الصابر فلفله', 'MOHAMED NAZMY ALSABER FELFELA', 10), ('مصطفى محمد احمد ابراهيم', 'MUSTAFA MOHAMED AHMED IBRAHEEM', 20)) AS v(name_ar, name_en, sort)
WHERE NOT EXISTS (SELECT 1 FROM company_owners o WHERE o.name_ar = v.name_ar);

INSERT INTO company_platforms (name_ar, category, url, status, sort, quick_link_id, notes)
SELECT v.name_ar, 'government', v.url, 'active', v.sort, (SELECT id FROM quick_links q WHERE q.url = v.link_url LIMIT 1), v.notes
FROM (VALUES
 ('أمانة منطقة الرياض (e.alriyadh.gov.sa)', 'https://e.alriyadh.gov.sa/', 10, 'https://e.alriyadh.gov.sa/ar/profile', 'منصة الرخص والتعاقدات الإلكترونية'),
 ('بلدي', 'https://apps.balady.gov.sa/', 20, 'https://apps.balady.gov.sa/dashboardclient/user-profile', 'بلدي وبلدي أعمال'),
 ('البوابة المكانية', 'https://mapservice.alriyadh.gov.sa/geoportal/login', 30, 'https://mapservice.alriyadh.gov.sa/geoportal/login', NULL),
 ('المركز الوطني للرقابة على الالتزام البيئي', 'https://www.ncec.gov.sa/', 40, 'https://www.ncec.gov.sa/ar/eServices/EservicesDirectory/Environmentalpermit/Pages/default.aspx', 'تصاريح الالتزام البيئي'),
 ('مدينتي', 'https://www.alriyadh.gov.sa/ar/data-sets/madinati-offices/madinati-offices', 50, 'https://www.alriyadh.gov.sa/ar/data-sets/madinati-offices/madinati-offices', 'مراكز مدينتي'),
 ('المركز السعودي للتنافسية والأعمال (Business Sa)', 'https://business.sa', 60, NULL, 'السجل التجاري والتأكيد السنوي'),
 ('العنوان الوطني (البريد السعودي سبل)', 'https://splonline.com.sa', 70, NULL, 'إثبات العنوان الوطني')
) AS v(name_ar, url, sort, link_url, notes)
WHERE NOT EXISTS (SELECT 1 FROM company_platforms p WHERE p.name_ar = v.name_ar);

INSERT INTO company_documents (title_ar, kind, file_name, issued_on, expires_on, sort, notes)
SELECT v.title_ar, v.kind, v.file_name, v.issued_on::date, v.expires_on::date, v.sort, v.notes
FROM (VALUES
 ('السجل التجاري', 'cr', 'document.pdf', '2025-10-30', '2027-10-29', 10, 'الرقم الموحد 7052303828 — نسخة رقم 3؛ موعد التأكيد السنوي 2027-10-29. الملف يُرفع لاحقًا (document.pdf + المركز السعودي للتنافسية والأعمال.pdf).'),
 ('إثبات العنوان الوطني', 'national_address', 'proof-of-address.png', '2026-10-12', '2027-04-10', 20, 'رقم الإثبات 1095524137 — العنوان المختصر RHFB2957. الملف يُرفع لاحقًا.')
) AS v(title_ar, kind, file_name, issued_on, expires_on, sort, notes)
WHERE NOT EXISTS (SELECT 1 FROM company_documents d WHERE d.kind = v.kind AND d.title_ar = v.title_ar);

INSERT INTO company_document_versions (document_id, version_no, file_url, file_name, issued_on, expires_on, notes, is_current)
SELECT d.id, 1, d.file_url, d.file_name, d.issued_on, d.expires_on, 'الإصدار الأول (من البذرة)', true
FROM company_documents d
WHERE d.kind IN ('cr','national_address') AND NOT EXISTS (SELECT 1 FROM company_document_versions v WHERE v.document_id = d.id);

INSERT INTO systems (key, name_ar, description_ar, icon, host, mode, upstream, status, sort, requires_grant) VALUES
 ('company','بيانات المنشأة','الملف الرسمي للشركة: السجل التجاري، العنوان الوطني، هيكل الملكية، المنصات والمفوضون، المستندات وصلاحياتها.','🏢',NULL,'internal','/company','live',80,false)
ON CONFLICT (key) DO UPDATE SET status='live', mode='internal', upstream='/company', requires_grant=false, sort=80;
