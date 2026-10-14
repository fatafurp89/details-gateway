-- «بيانات المنشأة» — هيكل ملكية المجموعة: الكيانات (الأم/التابعة/الفروع)، روابط الملكية بالنِّسب، المستفيدون الحقيقيون،
-- ومجلد مستندات لكل كيان (company_documents.entity_id). إضافي وآمن للتكرار. لا أرقام هوية جديدة هنا: تُنسخ من company_owners إن وُجدت.

-- الكيانات القانونية في المجموعة
CREATE TABLE IF NOT EXISTS company_entities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL DEFAULT 'subsidiary' CHECK (kind IN ('parent','subsidiary','branch')),
  name_ar          text NOT NULL,
  name_en          text NOT NULL DEFAULT '',
  legal_form       text,
  country_code     text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  jurisdiction     text,
  registration_no  text,
  tax_no           text,
  incorporated_on  date,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','dormant','closed')),
  address          text,
  website          text,
  notes            text,
  awaiting_details boolean NOT NULL DEFAULT false,   -- «بانتظار الاسم والأوراق»: كيان نائب لم تصل بياناته بعد
  profile_id       int UNIQUE REFERENCES company_profile(id) ON DELETE SET NULL,  -- الكيان السعودي: بياناته الرسمية في company_profile ولا تتكرر هنا
  sort             int NOT NULL DEFAULT 100,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_entities_sort ON company_entities (sort, name_ar);

-- روابط الملكية: الأب يملك الابن بنسبة، أو الابن فرع للأب
CREATE TABLE IF NOT EXISTS company_entity_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_entity_id uuid NOT NULL REFERENCES company_entities(id) ON DELETE CASCADE,
  child_entity_id  uuid NOT NULL REFERENCES company_entities(id) ON DELETE CASCADE,
  share_pct        numeric(5,2) NOT NULL DEFAULT 100 CHECK (share_pct >= 0 AND share_pct <= 100),
  relation         text NOT NULL DEFAULT 'owns' CHECK (relation IN ('owns','branch_of')),
  since            date,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_entity_id <> child_entity_id),
  UNIQUE (parent_entity_id, child_entity_id)
);
CREATE INDEX IF NOT EXISTS company_entity_links_child ON company_entity_links (child_entity_id);

-- المستفيدون الحقيقيون: entity_id فارغ = ينطبق على المجموعة كلها
CREATE TABLE IF NOT EXISTS company_beneficial_owners (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid REFERENCES company_entities(id) ON DELETE CASCADE,
  person_name_ar text NOT NULL,
  person_name_en text NOT NULL DEFAULT '',
  employee_no    char(4) REFERENCES employees(employee_no) ON UPDATE CASCADE ON DELETE SET NULL,
  nationality    text,
  id_no          text,                 -- يُقنَّع (maskId) لغير المشرف
  share_pct      numeric(5,2) NOT NULL DEFAULT 0 CHECK (share_pct >= 0 AND share_pct <= 100),
  basis          text NOT NULL DEFAULT 'مستفيد حقيقي',
  notes          text,
  sort           int NOT NULL DEFAULT 100,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_beneficial_owners_uniq
  ON company_beneficial_owners (COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(person_name_ar));

-- مستندات كل كيان (فارغ = الكيان السعودي الرئيسي، للتوافق مع الاستيراد القديم)
ALTER TABLE company_documents ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES company_entities(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS company_documents_entity ON company_documents (entity_id);

-- أنواع مستندات إضافية للكيانات الأجنبية: شهادة تأسيس، حسن سير وسلوك، أبوستيل، قرار مجلس/شركاء، عقد تأسيس/نظام أساس
ALTER TABLE company_documents DROP CONSTRAINT IF EXISTS company_documents_kind_check;
ALTER TABLE company_documents ADD CONSTRAINT company_documents_kind_check
  CHECK (kind IN ('cr','license','tax','contract','lease','national_address','certificate','invoice','bank','other','incorporation','good_standing','apostille','resolution','articles'));

-- ============ البذرة ============
-- الأم المصرية (رقم التسجيل والاسم الإنجليزي من سجل الملاك الحالي إن وُجد؛ لا يُخترع)
INSERT INTO company_entities (kind, name_ar, name_en, legal_form, country_code, jurisdiction, registration_no, status, notes, sort)
SELECT 'parent', 'ركائز ميم للتميز',
  COALESCE((SELECT o.name_en FROM company_owners o WHERE o.entity_kind = 'entity' AND o.role = 'owner' ORDER BY o.sort LIMIT 1), 'Rakaez Meem'),
  'شركة ذات مسؤولية محدودة', 'EG', 'جمهورية مصر العربية',
  (SELECT o.id_number FROM company_owners o WHERE o.entity_kind = 'entity' AND o.role = 'owner' ORDER BY o.sort LIMIT 1),
  'active', 'الشركة الأم المالكة لفرع المملكة والشركات الثلاث الأخرى. الاسم النظامي الكامل كما في ترخيص الاستثمار: ركائز ميم التميز للاستشارات الهندسية.', 10
WHERE NOT EXISTS (SELECT 1 FROM company_entities WHERE kind = 'parent' AND country_code = 'EG');

-- الكيان السعودي: يشير إلى company_profile (السجل 7052303828 وبقية البيانات تبقى هناك)
INSERT INTO company_entities (kind, name_ar, name_en, legal_form, country_code, jurisdiction, status, profile_id, notes, sort)
SELECT 'subsidiary', 'شركة ديتيلز كونسولتس للاستشارات الهندسية', 'Details Consults Company', 'شركة ذات مسؤولية محدودة (شخص واحد) — مهنية',
  'SA', 'المملكة العربية السعودية', 'active', 1, 'البيانات الرسمية (السجل التجاري، الضريبي، العنوان الوطني) في الملف الرسمي للمنشأة.', 20
WHERE EXISTS (SELECT 1 FROM company_profile WHERE id = 1) AND NOT EXISTS (SELECT 1 FROM company_entities WHERE profile_id = 1);

-- ثلاث شركات بانتظار الاسم والأوراق (الأسماء تُعدَّل لاحقًا)
INSERT INTO company_entities (kind, name_ar, name_en, country_code, jurisdiction, status, awaiting_details, notes, sort)
SELECT 'subsidiary', v.name_ar, '', v.cc, v.jur, 'active', true, 'كيان نائب: الاسم والأوراق سترفع لاحقًا.', v.sort
FROM (VALUES ('الشركة الأمريكية', 'US', 'الولايات المتحدة الأمريكية', 30), ('الشركة البريطانية', 'GB', 'المملكة المتحدة', 40), ('الشركة الكندية', 'CA', 'كندا', 50)) AS v(name_ar, cc, jur, sort)
WHERE NOT EXISTS (SELECT 1 FROM company_entities e WHERE e.country_code = v.cc AND e.kind = 'subsidiary' AND e.profile_id IS NULL);

-- الأم تملك كل تابعة بنسبة 100٪ (قابلة للتعديل)
INSERT INTO company_entity_links (parent_entity_id, child_entity_id, share_pct, relation, notes)
SELECT p.id, c.id, 100, 'owns', 'مملوكة بالكامل للشركة الأم'
FROM company_entities p JOIN company_entities c ON c.kind = 'subsidiary'
WHERE p.kind = 'parent' AND p.country_code = 'EG'
  AND NOT EXISTS (SELECT 1 FROM company_entity_links l WHERE l.parent_entity_id = p.id AND l.child_entity_id = c.id);

-- المستفيدان الحقيقيان للمجموعة (1010 و1012 مناصفة): الاسم من employees؛ الهوية والجنسية تُنسخ من سجل الملاك الحالي إن وُجد وإلا تبقى فارغة
INSERT INTO company_beneficial_owners (entity_id, person_name_ar, person_name_en, employee_no, nationality, id_no, share_pct, basis, sort)
SELECT NULL, e.full_name, COALESCE(o.name_en, ''), e.employee_no, o.nationality, o.id_number, 50.00, 'مستفيد حقيقي', CASE e.employee_no WHEN '1010' THEN 10 ELSE 20 END
FROM employees e LEFT JOIN company_owners o ON o.name_ar = e.full_name AND o.entity_kind = 'person'
WHERE e.employee_no IN ('1010', '1012')
  AND NOT EXISTS (SELECT 1 FROM company_beneficial_owners b WHERE b.entity_id IS NULL AND lower(b.person_name_ar) = lower(e.full_name));

-- المستندات الحالية تنتقل إلى الكيان السعودي
UPDATE company_documents SET entity_id = (SELECT id FROM company_entities WHERE profile_id = 1)
WHERE entity_id IS NULL AND EXISTS (SELECT 1 FROM company_entities WHERE profile_id = 1);
