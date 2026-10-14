-- «الروابط السريعة»: روابط المنصات الحكومية والجهات، تُعرض لكل الموظفين كبطاقة صغيرة وصفحة /links
CREATE TABLE IF NOT EXISTS quick_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category    text NOT NULL,
  title       text NOT NULL,
  url         text NOT NULL,
  notes       text NOT NULL DEFAULT '',
  access      text NOT NULL DEFAULT 'all' CHECK (access IN ('all','admin')),
  pinned      boolean NOT NULL DEFAULT false,
  sort        int NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES employees(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO quick_links (category, title, url, notes, pinned, sort) VALUES
 ('تعاقدات إلكترونية للرخص','رابط قبول التعاقدات','https://e.alriyadh.gov.sa/ar/profile/contracts','النظام الجديد',true,10),
 ('تعاقدات إلكترونية للرخص','رابط التعاقد الجديد','https://e.alriyadh.gov.sa/ar/eservices/ups/sbls/contract','التعاقد لإصدار رخصة بناء (حكومي/بالتزامن/زراعي/عادي)',true,20),
 ('تعاقدات إلكترونية للرخص','ملف العميل (للمكتب الهندسي)','https://e.alriyadh.gov.sa/ar/profile','',true,30),
 ('تعاقدات إلكترونية للرخص','ملف العميل (للمستفيد)','https://e.alriyadh.gov.sa/ar/user-profile','',false,40),
 ('روابط خاصة برخص البناء','قائمة طلبات الرخص — النظام الجديد','https://e.alriyadh.gov.sa/ar/profile/requests','منصة طلبات المكتب',true,10),
 ('روابط خاصة برخص البناء','البوابة المكانية','https://mapservice.alriyadh.gov.sa/geoportal/login','',true,20),
 ('روابط خاصة برخص البناء','نظام الرخص القديم (الأخضر)','https://rmapp.alriyadh.gov.sa/BLS/faces/home','ما زال يعمل لبعض الطلبات',false,30),
 ('روابط خاصة برخص البناء','تقسيم الأراضي (landsubdivision)','https://landsubdivision.alriyadh.gov.sa/amanat-alriyadh/#/amanat-alriyadh-registration/login','',false,40),
 ('المركز الوطني للرقابة على الالتزام البيئي','تصريح الالتزام البيئي للأعمال في المواقع الإنشائية','https://www.ncec.gov.sa/ar/eServices/EservicesDirectory/Environmentalpermit/Pages/default.aspx','',false,10),
 ('مراكز مدينتي','الرابط الرسمي لمواقع مكاتب مدينتي','https://www.alriyadh.gov.sa/ar/data-sets/madinati-offices/madinati-offices','',false,10),
 ('بلدي وبلدي أعمال','بلدي','https://apps.balady.gov.sa/dashboardclient/user-profile','',false,10)
ON CONFLICT DO NOTHING;
INSERT INTO systems (key, name_ar, description_ar, icon, host, mode, upstream, status, sort, requires_grant) VALUES
 ('links','الروابط السريعة','روابط المنصات الحكومية والجهات: أمانة الرياض، البوابة المكانية، بلدي، التعاقدات.','🔗',NULL,'internal','/links','live',95,false)
ON CONFLICT (key) DO UPDATE SET status='live', mode='internal', upstream='/links', requires_grant=false, sort=95;
