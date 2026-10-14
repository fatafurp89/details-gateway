-- «بيانات المنشأة»: مستندات مقيّدة للمشرف العام (تحمل أرقام هوية/آيبان/توقيعات): ملفاتها لا تُقدَّم لغير المشرف، وأرقامها مقنّعة في الواجهة.
ALTER TABLE company_documents ADD COLUMN IF NOT EXISTS admin_only boolean NOT NULL DEFAULT false;
