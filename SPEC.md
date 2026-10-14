# Details Gateway — بوابة الدخول الموحد (مواصفة البناء)

## الهدف
خدمة واحدة على VPS هوستنجر (`details-wms.cloud`, Ubuntu 24.04, nginx موجود) تكون **المدخل الوحيد** لكل أنظمة ديتيلز:
نظام إدارة العمل WMS (على خادم المكتب عبر نفق)، بريد ديتيلز، الموارد البشرية، بحث أرشيف الأمانة BLS، وأي نظام لاحق.
المستخدم يسجل دخولًا مرة واحدة، ويرى فقط الأنظمة التي يملك صلاحيتها، وكل طلب إلى أي نظام يمر عبر nginx `auth_request` إلى هذه الخدمة.
لو توقف الـ VPS لا يستطيع أحد الوصول إلى أي نظام بمعرفة IP ومنفذ، لأن الأنظمة نفسها لا تستمع إلا للجسر.

## الستاك (ثابت)
- Node 22 ESM، Fastify 5، `pg` (PostgreSQL 16 على نفس الـ VPS، قاعدة `details_gateway`، مستخدم `gateway`)، `nodemailer`، `google-auth-library`، `@fastify/cookie`, `@fastify/static`, `@fastify/formbody`, `@fastify/rate-limit`. لا ORM. ترحيلات SQL مرقمة في `migrations/` تُطبَّق بسكربت `npm run migrate` (جدول `schema_migrations`).
- واجهة الصفحات: HTML + CSS + JS خام من مجلد `web/` تُقدَّم من الخدمة نفسها (RTL عربي، نفس هوية الصفحة الحالية في `../portal-site/`: الألوان `--g #0f8a6b`, `--navy #1e3a5f`, `--gold #bc9d59`، الشعار `assets/logo-details.png`). لا إطار واجهة.
- التشغيل: `systemd` unit `details-gateway.service` يستمع على `127.0.0.1:4000` فقط. الأسرار من `/etc/details-gateway/env` (chmod 600). لا سر في الكود ولا في الريبو.
- السجلات: JSON على stdout (journal). كل خطأ للمستخدم رسالة عربية بلا تفاصيل داخلية.

## نموذج البيانات (PostgreSQL)
- `employees` (id uuid, employee_no char(4) unique, full_name, mobile, email unique, google_email unique null, role enum('admin','user'), active bool, expires_at timestamptz null, created_at, updated_at). مصدر الحقيقة مؤقتًا هنا؛ لاحقًا مزامنة من HR.
- `systems` (key text pk, name_ar, description_ar, icon, host text, mode enum('proxy','link','internal'), upstream text null, status enum('live','soon','off'), sort int, requires_grant bool default true).
- `grants` (employee_id, system_key, level enum('use','admin'), granted_by, granted_at, pk(employee_id, system_key)).
- `otp_codes` (id, employee_id, channel enum('email','sms'), code_hash, expires_at, attempts int, consumed_at, ip, created_at). الرمز 4 أرقام، صلاحية 10 دقائق، 5 محاولات ثم إلغاء.
- `sessions` (id uuid, employee_id, created_at, last_seen_at, expires_at, ip, user_agent, revoked_at). كعكة `dg_session` = معرف الجلسة موقّع HMAC-SHA256 بسر `SESSION_SECRET`، `Domain=.details-wms.cloud`, `Secure`, `HttpOnly`, `SameSite=Lax`. انتهاء مطلق 12 ساعة، خمول 30 دقيقة.
- `login_attempts` (id, identifier, ip, ok bool, reason, created_at) للتحديد: 6 طلبات OTP لكل موظف في الساعة، 20 لكل IP، قفل 30 دقيقة بعد 5 رموز خاطئة.
- `audit_log` (id, actor_employee_id null, action, target, meta jsonb, ip, created_at) إلحاق فقط.

## طرق الدخول (صفحة `/login`)
1. **الرئيسية: الرقم الوظيفي** — أربعة مربعات لأربعة أرقام (انتقال تلقائي، لصق، لوحة أرقام على الجوال). عند اكتمال الأربعة: `POST /api/login/lookup` يعيد (إن وُجد موظف نشط) الاسم الكامل، الجوال مقنّعًا `05XX•••••67`، البريد مقنّعًا `m•••@details-consults.sa`. ثم زر «أرسل رمز التحقق» → `POST /api/login/otp` يرسل OTP إلى البريد المسجّل (و SMS لاحقًا عبر واجهة `sms-provider.js` فارغة الآن). صفحة OTP «منمقة» تعرض اسم الموظف وتحية وستة مربعات للرمز وعدّاد إعادة الإرسال 60 ثانية. رسالة الخطأ موحدة لا تكشف هل الرقم مسجل.
2. **Google**: زر «الدخول بحساب Google» → `GET /auth/google/start` → `GET /auth/google/callback`. يُقبل فقط بريد جوجل مطابق لـ `employees.google_email` أو `employees.email` لموظف نشط؛ غير ذلك صفحة «الحساب غير مرتبط بموظف نشط» وقيد في `audit_log`. القيم من `GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET`، و`GOOGLE_REDIRECT_URI=https://details-wms.cloud/auth/google/callback`.
3. **خروج**: `GET /logout` يبطل الجلسة.
- بريد OTP يُرسل عبر SMTP (`SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER=info@details-consults.sa`, `SMTP_PASS`) باسم «ديتيلز للاستشارات الهندسية»، قالب HTML عربي أنيق: شعار، «مرحبًا {الاسم}»، الرمز بخط كبير، صلاحية 10 دقائق، تحذير «لا تشارك الرمز».

## البوابة بعد الدخول (`/`)
- شبكة بطاقات بنفس تصميم `../portal-site/` لكن **من القاعدة**: تظهر فقط الأنظمة التي يملك الموظف `grant` عليها (أو كلها للـ admin). بطاقة النظام `proxy` تفتح `https://<host>` (نطاق فرعي يحميه nginx بـ `auth_request`)، وبطاقة `link` تفتح رابطًا خارجيًا بتذكرة موقّعة `?dg_ticket=<JWT HS256 صالح 60 ثانية يحمل employee_no, name, email, system_key>` ليقبلها النظام الآخر (HR، البريد، BLS) كدخول موحد.
- رأس الصفحة: اسم الموظف ورقمه، زر خروج، وللـ admin رابط «الإدارة».

## التحقق لـ nginx
- `GET /_gw/verify`: يقرأ الكعكة، يتحقق من الجلسة وعدم انتهائها، ويقرأ `X-Gw-System` (مفتاح النظام) ويتحقق من الـ grant. 200 مع ترويسات `X-Gw-Employee-No`, `X-Gw-Name`, `X-Gw-Email`, `X-Gw-Role`؛ وإلا 401 (nginx يحوّل إلى `/login?next=`) أو 403 (صفحة «لا تملك صلاحية هذا النظام»). يحدّث `last_seen_at` بتخفيف (مرة كل دقيقة).
- مثال nginx في `deploy/nginx-subdomain.conf.example`: server block لـ `wms.details-wms.cloud` فيه `auth_request /_gw/verify` مع `proxy_set_header X-Gw-System wms` ثم `proxy_pass http://10.9.0.2:3200` وتمرير ترويسات المستخدم.

## الإدارة (`/admin`, للـ admin فقط)
- الموظفون: جدول كثيف (الرقم، الاسم، الجوال، البريد، بريد جوجل، الدور، الحالة، الانتهاء، آخر دخول)، إضافة/تعديل/تعطيل، استيراد CSV (الأعمدة نفسها)، لا حذف نهائي.
- الصلاحيات: مصفوفة موظف × نظام (مربعات use/admin) تُحفظ فورًا مع قيد تدقيق.
- الأنظمة: جدول (المفتاح، الاسم، الوصف، الأيقونة، host، النمط، upstream، الحالة، الترتيب) قابل للتعديل.
- الجلسات النشطة مع زر إبطال، وسجل التدقيق وسجل محاولات الدخول بفلاتر.
- الإعدادات: فحص SMTP بإرسال رسالة اختبار إلى بريد المدير، حالة Google (مضبوط/غير مضبوط بلا كشف القيم).

## شجرة الصلاحيات الموحدة (ترحيل 0005)
- المبدأ: **ممنوع حتى يُصرَّح**. مصفوفة `grants` تمنح الدخول إلى النظام كاملًا؛ وتحتها شجرة دقيقة: نظام ← وحدة ← شاشة ← إجراء.
  `employees.role='admin'` = مشرف عام مطلق يملك كل شيء دائمًا (لا صفوف له في الشجرة ولا تُعدَّل).
- الجداول: `perm_nodes` (key `system.module.screen.action` يطابق `^[a-z0-9_-]+(.[a-z0-9_-]+)*$`, system_key, parent_key, label_ar, description_ar, kind, sort, present, first_seen, last_seen)
  و`perm_grants` (employee_id, perm_key, allowed, granted_by, granted_at, reason؛ غياب الصف = ممنوع). العناصر لا تُحذف أبدًا؛ ما اختفى من الكتالوج يُوسم `present=false`.
- النمو التلقائي: كل نظام يرسل كتالوجه عند الإقلاع وكل نشر: `POST /_gw/catalog` بترويسة `X-Gw-Proxy-Key` = `GATEWAY_PROXY_KEY` (مقارنة ثابتة الزمن؛ غياب المتغير = 503).
  الجسم `{system, nodes:[{key,label_ar,description_ar?,kind?,parent_key?,sort?}]}`؛ الأب يُشتق من المفتاح إن لم يُذكر، والجذر يُضاف تلقائيًا باسم النظام العربي.
- القراءة: `GET /_gw/grants/:employee_no?system=KEY` (نفس الترويسة) → `{admin:true}` للمشرف العام، وإلا `{keys:[...]}` المصرّح بها فقط (العناصر القائمة)؛ 404 لموظف غير موجود؛ `Cache-Control: no-store`.
  يستدعيها النظام عبر النفق فقط (nginx يعرض `/_gw/*` على 127.0.0.1 و10.9.0.1 حصرًا) ويخزنها 60 ثانية.
- الإدارة: أيقونة درع «الصلاحيات» في رأس البوابة للمشرف العام فقط تفتح `/admin#perms`: اختيار موظف (بحث بالرقم/الاسم)، شجرة بمربعات غير معلّمة افتراضيًا تُحفظ فورًا
  (`PUT /api/admin/perms` `{employee_id, perm_key|perm_keys[], allowed}`)، «تعليم الفرع كاملًا/إلغاء الفرع»، «نسخ من موظف آخر» (`POST /api/admin/perms/copy`)، بحث، وعدّاد «عناصر جديدة لم تُمنح لأحد».
  المفتاح التقني لا يظهر إلا في تلميح. كل منح/سحب/نسخ/مزامنة كتالوج في `audit_log` (`perm.grant`, `perm.revoke`, `perm.copy`, `catalog.sync`).
- بطاقة «الصلاحيات» القديمة (`systems.key='perms'`) أُزيلت؛ المدخل صار أيقونة الرأس.

## «المعلومات التقنية» وخريطة المنظومة (ترحيل 0006)
- أيقونة في رأس البوابة للمشرف العام فقط تفتح `/admin#infra` (تبويب في الإدارة). ثلاثة عروض: **الشجرة** (قابلة للطي، نقطة حالة خضراء/حمراء/رمادية وشارات التنبيه) مع بطاقة العقدة في اللوحة الجانبية،
  **الخريطة** (SVG يُرسم تلقائيًا بطبقات: الإنترنت ← المزود ← الخوادم؛ المكتب ← هواوي ← Ruijie ← السويتشات ← الخادم/نقطة الوصول/البصمة؛ خطوط متصلة للشبكة المحلية/الإنترنت ومتقطعة لـ WireGuard/Tailscale؛ النقر يفتح البطاقة)،
  و**تكوين ديتيلز** (النظام ← الجهاز ← المنفذ ← وحدة systemd ← الرابط). المفاتيح التقنية لا تظهر إلا في التلميحات.
- الجداول: `infra_nodes` (key, name_ar, kind, model, provider, plan, subscription_end, status_source agent/ping/manual, status, status_at, public/local/tailscale/wg ip, hostname, os, urls jsonb, username, notes, parent_key, sort, external)،
  `infra_links` (from_key, to_key, kind lan/internet/wireguard/tailscale/usb, label_ar)، `infra_services` (node_key, name_ar, system_key→systems, port, unit_name, url, notes)،
  `infra_status` (node_key, reported_at, payload؛ يُحتفظ بـ7 أيام)، `infra_secrets` (secret_enc + iv؛ AES-256-GCM بمفتاح `SECRETS_KEY` من البيئة فقط) و`infra_secret_reveals`. البذرة: كل أجهزة 2026-10-14 ووصلاتها وتكوين ديتيلز.
  عمود `otp_codes.purpose` (`login` / `infra_secrets`) يفصل رموز الدخول عن رموز الأسرار.
- الوكيل: `deploy/infra-agent.sh` (bash + curl) مع `infra-agent.service` + `infra-agent.timer` (كل دقيقتين) يُثبَّت بـ `deploy/install-infra-agent.sh <node-key> <GATEWAY_PROXY_KEY> [probes…]`؛
  يرسل `POST /_gw/infra/report` (ترويسة `X-Gw-Proxy-Key`): وقت التشغيل، الحِمل، الذاكرة، الأقراص، وحدات systemd، النظام، التحديثات، WireGuard، Tailscale، ونتائج ping للأجهزة بلا وكيل (`probes`) التي تُطابَق بعناوينها وتُحدَّث حالتها.
- التنبيهات (`src/lib/infra.js`): انقطاع التقرير 10 دقائق (أحمر)، فشل ping، قرص > 85٪، اشتراك ينتهي خلال 30 يومًا أو منتهٍ، إعادة تشغيل مطلوبة.
- واجهات الإدارة (للمشرف العام فقط): `GET /api/admin/infra/tree|topology|node/:key`، `POST /api/admin/infra/node`، `PUT /api/admin/infra/node/:key`، `POST/PUT/DELETE /api/admin/infra/links[/:id]`، `POST/PUT/DELETE /api/admin/infra/services[/:id]`.
- الأسرار: `POST /api/admin/infra/secrets/otp` يرسل رمزًا من 4 أرقام إلى بريد المشرف (5 دقائق، 3 محاولات، لعملية واحدة)؛ `POST /api/admin/infra/secrets/:id/reveal {code}` يعيد `{username, secret}` مرة واحدة وتُعرض 60 ثانية مع زر نسخ؛
  الإضافة/التعديل/الحذف (`POST /api/admin/infra/secrets`, `PUT|DELETE /api/admin/infra/secrets/:id`) بالرمز نفسه. كل كشف في `infra_secret_reveals` وفي `audit_log` (`infra.secret.reveal`, `…_denied`, `infra.secret.create/update/delete`, `infra.node.*`, `infra.link.*`, `infra.service.*`). القيم لا تُسجَّل في أي سجل.

## «مركز الإشعارات» (ترحيل 0009)
- مكان واحد يجمّع إشعارات كل الأنظمة؛ الإشعار يبقى في نظامه الأصلي أيضًا. جرس في رأس البوابة (بجوار الاسم) بعدّاد غير المقروء يتحدّث كل 60 ثانية وعند العودة للنافذة، يفتح قائمة بآخر 10 ورابط «كل الإشعارات»؛
  بطاقة `notifications` «مركز الإشعارات» (`/notifications`, بلا grant, ترتيب 85) تحمل شارة حمراء بعدد غير المقروء (من `GET /api/me` → `tiles_badges`).
- الجدول `notifications` (employee_id فارغ = إشعار عام لكل الموظفين، system_key→systems, kind, title_ar, body_ar, url, severity info/warn/urgent, source_ref, meta, created_at, read_at)
  و`notification_reads` (قراءة الإشعارات العامة لكل موظف). فهرس فريد على (system_key, source_ref, employee_id) يمنع التكرار.
- **كيف يرسل أي نظام إشعارًا** (الموارد البشرية، البريد، نظام ديتيلز، البحث…): `POST /_gw/notify` بترويسة `X-Gw-Proxy-Key: <GATEWAY_PROXY_KEY>` (المسار داخلي عبر nginx على loopback/النفق فقط) وجسم JSON:
  `{ "system": "hr", "employee_no": "1012" }` أو `"employee_nos": ["1012","1013"]` أو `"all": true`، مع `"kind": "leave.approved"`, `"title_ar": "اعتُمدت إجازتك"`, `"body_ar"?`, `"url"?` (https أو مسار داخلي؛ يُفتح في تبويب جديد),
  `"severity"?: "info"|"warn"|"urgent"`, `"source_ref"?: "leave:7"` (معرّف ثابت عند المصدر = لا تكرار عند إعادة الإرسال), `"meta"?: {}`. الرد `{ ok, inserted, unknown[] }`.
  لتعليم إشعار كمقروء من النظام المصدر: `POST /_gw/notify/read {system, source_ref, employee_no?}`. النظام يجب أن يكون مسجّلًا في `systems`.
- واجهة الموظف: `GET /api/notifications?unread=1&limit=50&system=hr`, `GET /api/notifications/count`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.
  الصفحة `/notifications`: تجميع حسب اليوم (اليوم/أمس/أقدم بتوقيت الرياض)، تصفية بالنظام وغير المقروء، ألوان حسب الأهمية، النقر يفتح `url` في تبويب جديد ويعلّم كمقروء، «تعليم الكل كمقروء».
  المنطق النقي في `src/lib/notify.js` (`validateNotify`, `groupByDay`).

## «مركز الإشعارات» — الأعمال / التقنية (ترحيل 0020)
- **التصنيف**: عمود `notifications.category` = `work` (الأعمال، الأهم، الافتراضي) | `technical` (التقنية). كل المنشئين يقبلون `category` اختياريًا:
  `POST /_gw/notify` (حقل `"category": "work"|"technical"`، قيمة غير صالحة = 400)، مهمة الفحص اليومي (`work`)، وأي منشئ داخلي عبر `insertNotifications` (يمرّ كله عبر `preparedNotification`).
  الرد صار `{ ok, inserted, unknown[], category }`. **عند الغياب** يُستنتج من الجدول الموثّق في `src/lib/notify-categories.js` (`categorize`) بهذا الترتيب (أول تطابق يفوز):
  1. `category` الصريح من المرسل.
  2. `system` ∈ `infra, agent, system, monitor, backup` ← **technical**.
  3. `kind` يساوي أو يبدأ (يليه `.` أو `-` أو `_` أو `:`) بأحد: `backup, infra, system, agent, security, service, disk, cert, ssl, tls, tunnel, wireguard, wg, node, server, deploy, cron, job, monitor, health, login-blocked, blocked, smtp, mail-send, mail-error, mail-service, mail-failed, send-failed, whatsapp-token, whatsapp-error, whatsapp-webhook, token, webhook, ai-key, api-key` ← **technical**.
  4. `source_ref` يبدأ بـ `backup-, infra:, node:, disk:, cert:, service:, tunnel:, security:, agent:` ← **technical**.
  5. `system` ∈ `company, hr, files, bls, notifications` ← **work**.
  6. `kind` عام (`info` أو فارغ) والعنوان/النص يحوي كلمة دالة (النسخ الاحتياطي، pg_dump، rsync، wireguard، systemctl، شهادة SSL، مفتاح الذكاء الاصطناعي، توكن، smtp…) ← **technical**.
  7. غير ذلك ← **work** (المجهول = أعمال؛ لا نُخفي إشعار عمل داخل التبويب التقني).
  أمثلة للأنظمة الأخرى: الموارد البشرية (اعتماد إجازة، طلب بانتظار الاعتماد) ← `work` تلقائيًا؛ فشل مزامنة الموارد البشرية ← أرسل `"category":"technical"`؛ البريد: رسالة جديدة `kind:"new-mail"` ← work، تعذّر الإرسال `kind:"mail-send-failed"` ← technical؛
  واتساب: محادثة جديدة ← work، `kind:"whatsapp-token"` (رمز غير صالح/ينتهي) ← technical؛ سكربتات النسخ الاحتياطي: `kind:"backup"` أو `"backup-offsite-failed"` أو `source_ref:"backup-<تاريخ>"` ← technical (أو `"category":"technical"` صراحةً).
- **التبسيط بالعربية** (`src/lib/notify-plain.js`، يُطبَّق عند الإنشاء على كل إشعار تقني، وعلى الموجود عبر `scripts/rewrite-notifications.mjs`): يتحول النص التقني إلى
  `title_ar` عنوان واضح + `body_ar` جملة واحدة + `meta.means` («ماذا يعني؟») + `meta.todo` («ما المطلوب؟») + `meta.plain = true` + `meta.plain_rule`، ويُحفظ النص الأصلي كاملًا (حتى 2000 حرف) في `meta.details`.
  القواعد: فشل النسخ الاحتياطي (سيرفر البوابة/التطبيقات؛ pg_dump / rsync / مساحة)، ملخص النسخ الأسبوعي الناجح، توقف/عودة جهاز، توقف/عودة خدمة، امتلاء القرص، قرب انتهاء/انتهاء شهادة SSL، انقطاع نفق WireGuard، حظر دخول/تنبيه أمني،
  فشل إرسال البريد، رمز واتساب غير صالح أو ينتهي قريبًا، مفتاح ذكاء اصطناعي غير صالح أو انتهى رصيده، وقاعدة احتياطية عامة تنزع أسطر الأوامر والمسارات وآثار الأخطاء (لا يظهر سطر أوامر لمستخدم عادي أبدًا). الإشعارات غير التقنية لا تُلمس.
  يمكن للمرسل تمرير نص عربي جاهز مع `meta.plain = true` (و`means`/`todo`) فلا يُعاد تبسيطه.
- **الصلاحيات** (شجرة الصلاحيات، النظام الداخلي `notifications`): `notifications.work` «الإشعارات: الأعمال» — ممنوحة افتراضيًا لكل موظف (الموجودين بالترحيل، والجدد بمشغّل `employees_grant_notifications_work`) وقابلة للسحب؛
  `notifications.technical` «الإشعارات: التقنية» — ممنوعة افتراضيًا؛ `notifications.technical.details` «التفاصيل التقنية» (يتطلب التقنية) — يرى `details` الأصلي. المشرف العام المطلق (`role=admin`، 1010/1012) يتجاوز دائمًا.
  يُفرض في الخادم في كل نقاط النهاية: `GET /api/notifications?category=work|technical` (تصنيف غير مسموح = 403، بلا `category` = كل المسموح)، `GET /api/notifications/count` (يعيد `{unread, unread_by:{work,technical}, access}`؛ بلا أي صلاحية يعيد أصفارًا و`access` كله false فيختفي الجرس)،
  `POST /api/notifications/read-all {category?}`، `POST /api/notifications/:id/read` (إشعار تصنيف غير مسموح = 404)، والصفحة `/notifications` (بلا أي صلاحية → `/denied?s=notifications`). الإشعار التقني يخرج من `meta` بـ `means`/`todo` فقط، و`details` حقل مستقل لمن يملك صلاحية التفاصيل.
  `unread` = أعمال + تقنية (إن سُمح بها)، وهو ما تعدّه الشارة الحمراء للجرس وبطاقة «مركز الإشعارات»؛ البطاقة نفسها تختفي من `GET /api/me` لمن لا يملك أيًّا من الصلاحيتين، و`/api/me` يعيد `notifications: {access, unread_by}`. البريد المُحوَّل (`email_relay`) للإشعار التقني يصل المشرفين وأصحاب `notifications.technical` فقط.
- **الواجهة**: تبويبان «الأعمال» (الأول والافتراضي، بعدّاده) و«التقنية» (هادئ اللون، يظهر لمن يملكها فقط، بعدّاده الرمادي) في قائمة الجرس وفي `/notifications` مع المرشحات (النظام، غير المقروء)؛ آخر تبويب يُحفظ في `localStorage` (`gw.notif.tab`).
  الإشعار التقني يعرض النص المبسّط + «ماذا يعني؟» + «ما المطلوب؟» وزر «التفاصيل التقنية» (يظهر فقط حين يعيد الخادم `details`). الملفات: `web/css/notifications.css`، `web/js/notifications.js`، جرس البوابة في `web/js/portal.js`.
- الاختبارات: `test/notify-plain.test.js` (تصنيف، مترجم، صلاحيات نقية)، و`test/notify-access.test.js` تكامل على PostgreSQL حقيقي عبر `TEST_DATABASE_URL` (يُتخطى بدونه) يتحقق من فرض التصنيف في كل نقاط النهاية.

## «بيانات المنشأة» (ترحيل 0010)
- بطاقة `company` «بيانات المنشأة» (`/company`, بلا grant, ترتيب 80, 🏢) لكل الموظفين؛ التعديل للمشرف العام فقط؛ أرقام الهوية مقنّعة لغير المشرف (`maskId`). شارة حمراء على البطاقة بعدد العناصر المنتهية أو التي تنتهي خلال 30 يومًا.
- الجداول: `company_profile` (صف واحد: الاسم القانوني/التجاري عربي وإنجليزي، السجل التجاري ونوعه ونسخته وتاريخه والتأكيد السنوي، الكيان، رأس المال، النشاط، الرقم الضريبي، ترخيص الهيئة، الغرفة، المدينة/الحي/الشارع، `national_address` jsonb، التواصل، الشعار، ملاحظات)،
  `company_owners` (شخص/كيان، هوية، جنسية، نسبة ≤100٪ مجموعًا، دور مالك/شريك/مدير)، `company_platforms` (منصة، تصنيف حكومية/بنكية/خاصة/خدمات، رابط، اسم المستخدم، صاحب الحساب، الصفة، انتهاء، حالة، ربط برابط سريع وبعقدة/اسم سر في «المعلومات التقنية» — **لا كلمات مرور هنا**)،
  `company_delegations` (مفوَّض، موظف، منصة، نطاق، من/إلى، مستند، حالة)، `company_documents` + `company_document_versions` (إصدارات: رقم، ملف، إصدار/انتهاء، من رفعه ومتى، ملاحظات، إصدار حالي واحد؛ أعمدة المستند تعكس الإصدار الحالي).
- البذرة: السجل التجاري 7052303828 (شركة ديتيلز كونسولتس / Details Consults Company، ش.ذ.م.م شخص واحد مهنية، رأس المال 100,000، نشاط 711013، إصدار 2025-10-30، تأكيد سنوي 2027-10-29)، العنوان الوطني (RHFB2957، مبنى 2957، شارع سعود بن عبدالعزيز بن محمد الفرعي، حي الملك فهد 12274، إثبات 1095524137 حتى 2027-04-10)،
  المديران من السجل (بلا نسب)، المنصات: أمانة الرياض، بلدي، البوابة المكانية، المركز الوطني للرقابة على الالتزام البيئي، مدينتي، المركز السعودي للتنافسية والأعمال، العنوان الوطني (سبل)؛ مستندا «السجل التجاري» و«إثبات العنوان الوطني» بإصدار أول بلا ملف (الرفع لاحقًا).
- الواجهات: `GET /api/company` (الكل + تنبيهات + مجموع النسب)، `PUT /api/admin/company/profile`، `POST/PUT/DELETE /api/admin/company/{owners,platforms,delegations,documents}[/:id]`،
  `POST /api/admin/company/documents/:id/versions` (يصبح الحالي)، `PUT|DELETE …/versions/:vid` (`is_current:true` لتبديل الحالي)، `POST /api/admin/company/sweep` (فحص الآن).
- فحص الصلاحيات اليومي: `src/jobs/expiry-sweep.js` بمؤقّت `deploy/company-expiry-sweep.timer` (07:00 الرياض) يُنشئ إشعارات في مركز الإشعارات (`system_key: company`, `source_ref: <kind>:<id>:<expiring|expired>`) لكل المشرفين ولصاحب الحساب؛ آمن للتكرار.
  التثبيت: `cp deploy/company-expiry-sweep.{service,timer} /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now company-expiry-sweep.timer`.
  المنطق النقي في `src/lib/company.js` (`expiryAlerts`, `alertNotifications`, `validateShares`, `maskId`, التحقق).

## «بيانات المنشأة» — ملفات المستندات والحسابات البنكية (ترحيلات 0016 و0017)
- **التخزين**: `src/lib/storage.js` — الملفات على القرص تحت `FILES_DIR` (افتراضيًا `/opt/details-gateway/files`) في `company/<doc_id>/<رقم الإصدار>-<الاسم>`؛ الكتابة ذرّية (ملف مؤقت ثم rename) مع حد 25 م.ب وبصمة `sha256`؛ نوع الملف من الامتداد فقط (PDF، صور png/jpg/webp/gif، Word/Excel/txt) — لا HTML ولا SVG؛ منع الخروج من الجذر (`absPath`). أعمدة `company_document_versions`: `storage_path, size, sha256, mime`. الوحدة systemd تضيف `ReadWritePaths=/opt/details-gateway/files` (المجلد `details-gateway:details-gateway 750`).
- **الواجهات**: `POST /api/admin/company/documents/:id/versions` يقبل JSON (رابط/بيانات فقط) أو `multipart/form-data` (حقول `issued_on, expires_on, notes, file_name, is_current` **قبل** حقل `file`؛ ملف واحد)؛ `is_current=false` يحفظ الإصدار كسجل تاريخي. `GET /api/company/documents/:id/versions/:vid/file` لكل موظف مسجَّل (معاينة داخل الصفحة لـPDF/الصور، `?download=1` للتنزيل، `X-Content-Type-Options: nosniff`)؛ بلا جلسة = 401. حذف إصدار/مستند يحذف ملفه من القرص.
- **مستندات مقيّدة** (`company_documents.admin_only`، ترحيل 0017): غير المشرف يرى سجل المستند (العنوان/الرقم/التواريخ) ولا يرى الملف ولا رابطه والمسار يعيد 403 — للمستندات ذات الهويات والآيبان والتوقيعات (إثباتات الشركاء، عقد التأسيس، نماذج التوقيع، خطابات الغرفة، المستندات البنكية، عقد الإيجار والصك).
- **حقول جديدة للمستند**: `doc_number` (رقم الوثيقة/الترخيص)، `issuer_ar` (جهة الإصدار)؛ أنواع إضافية: `lease` عقد إيجار، `certificate` شهادة، `invoice` فاتورة، `bank` بنكي. الصلاحية (`expires_on`) تُؤخذ من الإصدار الحالي وتغذّي التنبيهات اليومية.
- **الحسابات البنكية** `company_bank_accounts` (تبويب «الحسابات البنكية»): البنك، اسم الحساب، `iban`، `account_no`، `customer_no`، SWIFT، العملة، النوع، الفرع، تاريخ الفتح، الحالة، المفوضون بالتوقيع، ربط بمستند (شهادة الآيبان) وبمنصة وبسر. **الآيبان/رقم الحساب/رقم العميل كاملة للمشرف ومقنّعة (آخر 4) لغيره** (`maskBankAccounts`). `POST/PUT/DELETE /api/admin/company/bank-accounts[/:id]`. **بيانات دخول البنك والمنصات لا تُخزَّن هنا**: تُحفظ مشفّرة (AES-256-GCM) في `infra_secrets` على عقدة «حسابات الشركة» (`company-accounts`) ويُربط بها بالاسم فقط (`secret_node_key` + `secret_ref`).
- **الاستيراد**: `scripts/import-company-docs.mjs <مجلد>` (manifest.json + ملفات + secrets.json اختياري، على الخادم بحساب الخدمة): آمن للتكرار بالبصمة؛ تُحذف الأسرار الخام بعد التشغيل.
- **أدوار الإضافة بعد الاستيراد (2026-10-14)**: 32 مستندًا و48 ملفًا (26 م.ب) وحسابًا بنكيًا واحدًا (ساب) ومالكًا (ركائز ميم 100٪) وتسع منصات؛ ينقصها: الرخصة النهائية لبلدي وعقد التأسيس المعدَّل (غير موجودين بالمجلدات) وبيانات قوى/التأمينات سوى رقم ملف المنشأة 1-4569953.

## «بيانات المنشأة» — هيكل ملكية المجموعة والمستفيدون الحقيقيون (ترحيل 0018)
- **الجداول**: `company_entities` (كيان قانوني: `kind` parent|subsidiary|branch، الاسم عربي/إنجليزي، `country_code` (EG/SA/US/GB/CA وغيرها بحرفين)، الولاية القضائية، الشكل القانوني، `registration_no`، `tax_no`، `incorporated_on`، `status` active|dormant|closed، العنوان، الموقع، ملاحظات، `awaiting_details` (شارة «بانتظار الاسم والأوراق»)، `profile_id` يشير إلى `company_profile`، `sort`)،
  `company_entity_links` (`parent_entity_id` → `child_entity_id`، `share_pct numeric(5,2)` بقيد 0–100، `relation` owns|branch_of، `since`، فريدة لكل زوج، بلا ارتباط ذاتي)،
  `company_beneficial_owners` (`entity_id` فارغ = ينطبق على المجموعة كلها، `person_name_ar/en`، `employee_no` اختياري → `employees`، الجنسية، `id_no` (يُقنَّع بـ`maskId` لغير المشرف)، `share_pct`، `basis` = «مستفيد حقيقي»، فريد لكل (نطاق، شخص))، والعمود `company_documents.entity_id` (مجلد مستندات لكل كيان؛ الفارغ = الكيان السعودي الرئيسي للتوافق مع الاستيراد القديم). أنواع مستندات جديدة للكيانات الأجنبية: `incorporation` (شهادة تأسيس/تسجيل)، `good_standing`، `apostille`، `resolution`، `articles`.
- **البذرة**: الأم «ركائز ميم للتميز» (EG؛ رقم التسجيل 75349 والاسم الإنجليزي من سجل الملاك الحالي)، «شركة ديتيلز كونسولتس للاستشارات الهندسية» (SA، `profile_id = 1`: السجل 7052303828 والضريبي والعنوان الوطني تبقى في `company_profile` ولا تتكرر)، وثلاثة كيانات نائبة «الشركة الأمريكية» (US) و«الشركة البريطانية» (GB) و«الشركة الكندية» (CA) بشارة «بانتظار الاسم والأوراق»؛ روابط الأم ← كل تابعة 100٪ (قابلة للتعديل)؛ المستفيدان الحقيقيان للمجموعة 1010 و1012 بنسبة 50٪ لكلٍّ (الاسم من `employees`، والهوية/الجنسية تُنسخ من `company_owners` إن وُجدت ولا تُخترع)؛ المستندات الحالية (32) أُسندت للكيان السعودي. `company_owners` تبقى «الملاك والمديرين في السجل التجاري» للكيان السعودي.
- **التحقق** (`src/lib/structure.js`، نقي ومُختبَر): مجموع حصص ملاك أي كيان من كل الشركات ≤ 100٪ (يُرفض الربط الذي يتجاوزها)، لا دورات في الهيكل، لا ارتباط ذاتي؛ مجموع المستفيدين الحقيقيين في كل نطاق = 100٪ (**تحذير فقط** — يعود `warnings[]` مع كل كتابة ويظهر شريطًا في الصفحة)؛ حصص التابعة الناقصة عن 100٪ تُنبَّه كذلك.
- **الواجهات**: `GET /api/company/structure` (كل موظف: الكيانات + الروابط + المستفيدون (هويات مقنّعة لغير المشرف) + `stats` لكل كيان: عدد المستندات/بملفات/منتهية/تنتهي قريبًا/أقرب انتهاء + `validation.warnings`)؛ للمشرف (موثَّقة في التدقيق `company.entity.*`, `company.entity.link.*`, `company.beneficial.*`):
  `POST/PUT/DELETE /api/admin/company/entities[/:id]` (حذف كيان له مستندات = 409، والكيان الرئيسي لا يُحذف)، `…/entity-links[/:id]`، `…/beneficial-owners[/:id]`، و`POST /api/admin/company/entities/:id/documents` (مستند جديد في مجلد الكيان؛ ثم الرفع بـ`…/documents/:id/versions` كالمعتاد). `POST|PUT /api/admin/company/documents` يقبل `entity_id` (الغياب = الرئيسي في الإنشاء، وبلا تغيير في التعديل). تنبيهات الصلاحية اليومية لمستندات الكيانات الأجنبية تحمل اسم الكيان في العنوان.
- **الواجهة** `/company` (`web/company.html` + `web/js/company.js` + `web/js/company-chart.js` + `web/css/company.css`): صفحة بأقسام مع قائمة جانبية ثابتة: نظرة عامة (بطاقة الكيان السعودي: الشعار، السجل، الضريبي، العنوان الوطني، الشارات، شريط التنبيهات، مؤشرات) ← هيكل الملكية (مخطط SVG يُولَّد بالجافاسكربت بلا مكتبات: المستفيدون ← الأم ← التابعة بالنِّسب والأعلام وعدد المستندات وأقرب انتهاء؛ ينقر الكيان فيفتح ملفه؛ يتحول لعمود واحد على الجوال؛ زر «طباعة الهيكل») ← الجهات والمستندات (تبويب لكل كيان بجدول المستندات والإصدارات والرفع كما كان) ← الملاك والمستفيدون الحقيقيون ← المنصات والتراخيص (والمفوضون) ← الحسابات البنكية. النماذج نافذة منبثقة؛ لا `style` مضمَّن (CSP). الروابط القديمة `#documents` `#delegations` `#profile` تعمل. زر «إنشاء قائمة المستندات المطلوبة» ينشئ ست مستندات فارغة للكيان الأجنبي.
- **كيف تُضاف الشركات الأجنبية**: «الجهات والمستندات» ← تبويب الكيان ← «تعديل بيانات الكيان» (الاسم، رقم التسجيل، التأسيس…) وإلغاء علامة «بانتظار الاسم والأوراق» ← «+ إضافة مستند» أو «⬆ رفع إصدار». الاختبارات: `test/structure.test.js`.

## «الروابط السريعة» — إحصاءات الاستخدام (ترحيل 0011)
- الصفحة `/links`: شبكة بطاقات مصنّفة (رأس التصنيف بالعدد، قابل للطي ويُحفظ محليًا)، كل بطاقة: أيقونة الموقع (`google.com/s2/favicons` مع حرف أول بديل)، العنوان، المضيف، نجمة التثبيت، وإحصاءات «النقرات» و«أضيف في» و«آخر استخدام» (نسبي)؛ بحث؛ أيقونات الإدارة عند التحويم (تثبيت/سجل/تعديل/حذف)؛ ملخص «الأكثر استخدامًا هذا الشهر» (أعلى 5). بطاقة البوابة المضغوطة لم تتغير.
- النقر يمر عبر `GET /links/go/:id` (جلسة مطلوبة) الذي يُدرج في `quick_link_clicks` (link_id, employee_id, clicked_at, user_agent) ويحدّث `quick_links.click_count` و`last_used_at` ثم يحوّل 302 إلى الرابط (يبقى في تبويب جديد).
- `GET /api/links` يعيد الروابط مع العدّادات و`my_last_used_at` و`top_month`؛ `GET /api/admin/links/:id/clicks` (المشرف العام) آخر 200 نقرة: الموظف ورقمه والوقت.

## سياسة الموظفين ومزامنة الموارد البشرية (ترحيل 0012)
- **إنشاء الموظفين من البوابة غير مسموح**: نظام «الموارد البشرية» هو المصدر الوحيد. أُزيل «موظف جديد» و«استيراد CSV» من الإدارة؛ `POST /api/admin/employees` و`POST /api/admin/employees/import` يعيدان 403 برسالة عربية. تبقى في البوابة: الدور، الحالة، الانتهاء، ربط بريد جوجل (`PUT /api/admin/employees/:id`).
- **مزامنة من HR** (ترويسة `X-Gw-Proxy-Key`، عبر nginx على loopback/النفق فقط):
  `POST /_gw/employees/upsert` بجسم `{ employee_no, full_name, mobile?, email?, google_email?, department?, title?, hr_status?, active?, expires_at?, photo_url? }` → ينشئ الموظف (دور `user`) أو يحدّث الحقول المرسلة فقط؛ القسم والمسمى وحالة HR تُحفظ في `employees.hr_meta` (jsonb) مع `hr_synced_at`. **لا يغيّر الدور أو صلاحيات الإدارة أبدًا، ولا يعطّل آخر مدير نشط** (409). الرد `{ ok, id, created }`.
  `POST /_gw/employees/deactivate {employee_no}` → `active=false` وإبطال الجلسات (404 إن لم يوجد، 409 إن كان آخر مدير). كل عملية في `audit_log` (`employee.hr.create/update/deactivate`).
- عمود `systems.placement` (`grid` بطاقة | `header` زر صغير في رأس البوابة بجوار اسم الموظف). الصف `hr-portal` «بوابة الموظف» (link → `https://hr.details-wms.cloud/portal`, بلا grant, placement `header`) يظهر كزر «بوابتي» لكل موظف ويُفتح في تبويب جديد عبر `/go/hr-portal` بتذكرة موقّعة؛ يبقى قابلًا للتعديل من تبويب «الأنظمة» (عمود «الموضع»).
- `/infra` (المعلومات التقنية) تعرض محتواها فقط: الحارس في `admin.js` يعمل بسمة `data-page="infra"` أو بغياب تبويبات الإدارة، فلا يظهر قسم الموظفين تحت رأسها.

## الأمان
- كل التحقق في الخادم. `@fastify/rate-limit` على مسارات الدخول. مقارنات ثابتة الزمن للرموز والتوقيعات. الرموز تُخزَّن hash (sha256 + pepper من البيئة). ترويسات أمان من nginx. لا كشف لوجود موظف من رسائل الخطأ. كل محاولة دخول وكل تغيير صلاحية في `audit_log`.
- Bootstrap: عند أول تشغيل إن كان `employees` فارغًا يُنشأ مدير من `BOOTSTRAP_ADMIN_EMPLOYEE_NO/NAME/EMAIL` في البيئة.

## التسليم
- مجلد `details-gateway/`: `package.json`, `src/` (server.js, routes/, lib/ db, session, otp, mail, google, authz), `migrations/0001_init.sql`, `web/` (login.html, otp.html, portal.html, admin.html, denied.html + css/js), `deploy/` (`details-gateway.service`, `env.example`, `nginx-gateway.conf`, `nginx-subdomain.conf.example`, `install.sh` يثبت PostgreSQL 16 وNode 22 وينشئ القاعدة والمستخدم ويضع الخدمة)، `README.md` عربي قصير (التشغيل، المتغيرات، كيف يضيف المدير نظامًا).
- اختبارات: `node --test` لـ: توقيع الكعكة، تحقق OTP (صحيح/منتهي/محاولات)، قرار `verify` (لا جلسة/لا grant/admin)، تقنيع الجوال والبريد. يجب أن تنجح `npm test`.
- بيانات تجريبية في `seed/dev-seed.sql`: موظف مدير 1010، موظفان، الأنظمة الأربعة (wms soon/proxy, mail soon/link, hr soon/link, bls soon/link).

## «إعدادات النظام» ومفاتيح الذكاء الاصطناعي (ترحيل 0013)
- بطاقة `settings` «إعدادات النظام» (⚙️, internal → `/settings`, ترتيب 97, `requires_grant=true`, `placement=compact`): للمشرف العام (يراها دائمًا)؛ غيره يراها فقط إن مُنح نظام `settings` في المصفوفة ومُنح عنصرًا من شجرته. تُفتح في تبويب جديد كبقية البطاقات.
- **مواضع البطاقات** صارت ثلاثة: `grid` بطاقة كاملة، `header` زر في الرأس، `compact` بطاقة مضغوطة (أيقونة واسم فقط، الشكل القديم لبطاقة الروابط). الصفوف `links` و`files` و`settings` على `compact`؛ قيد `systems_placement_check` وتحقق `validateSystem` يقبلان القيم الثلاث.
- المنصة `/settings` (بلا موجّه: `#القسم`): شبكة بطاقات بأيقونات لعشرة أقسام من `src/lib/settings.js` (`SECTIONS`). الشجرة: جذر `settings` + وحدة `settings.<القسم>` لكل قسم.
  الأقسام الحساسة (`security`, `smtp`, `backup`, `ai_keys`, `infra`, `perms`) **للمشرف العام فقط** حتى لو مُنح العنصر؛ الأقسام القابلة للتفويض عبر الشجرة: `systems`, `branding`, `notifications`, `links`. الخادم يفرض ذلك في `sectionGuard` (`GET /api/settings/sections` يعيد الأقسام المسموحة).
  - «الأنظمة والبطاقات» (`#systems`): جدول الأنظمة (المفتاح، الاسم، الوصف، الأيقونة، host، المضيف المحلي، النمط، upstream، الحالة، الترتيب، الموضع، يحتاج منحًا) — `GET/POST /api/settings/systems`, `PUT/DELETE /api/settings/systems/:key` (الحذف مرفوض 409 إن ارتبط النظام بشجرة صلاحيات أو إشعارات). تبويب «الأنظمة» في `/admin` صار رابطًا إلى هنا.
  - «الهوية والعلامة» (`#branding`): الاسم، السطر الفرعي، الشعار، ثلاثة ألوان — `GET/PUT /api/settings/branding`؛ `GET /api/branding` (عام) تقرؤه كل الصفحات عبر `applyBranding()` في `common.js` فتُطبَّق الألوان على كل الصفحات والاسم على رأس البوابة.
  - «الجلسات والأمان» (`#security`): مدة الجلسة القصوى (ساعات)، الخمول (دقائق)، صلاحية OTP ومحاولاته، محاولات حساب Google غير المسجّل ونافذة الحظر، قائمة العناوين المحظورة (IPv4/CIDR) — `GET/PUT /api/settings/security`.
    الافتراضيات (12 س / 30 د / 5 د / 3 / 2 / 30 د / لا شيء) ثم متغيرات البيئة الاختيارية `SESSION_HOURS, SESSION_IDLE_MINUTES, OTP_TTL_MINUTES, OTP_MAX_ATTEMPTS, GOOGLE_STRANGER_TRIES, GOOGLE_BLOCK_MINUTES, IP_BLOCKLIST` ثم الصف المحفوظ. تُطبَّق في الخادم: `createSession` و`sessionStatus` و`/_gw/verify` (الخمول)، `login.js` (OTP وGoogle)، وخطاف `onRequest` في `app.js` للحظر (403، لا يشمل `/_gw/*` و`/healthz` ولا 127.0.0.1 أبدًا).
  - «البريد الخارج (SMTP)» (`#smtp`): الخادم/المنفذ/المستخدم/اسم المرسل في `settings.smtp`؛ كلمة المرور تُشفَّر بـ `SECRETS_KEY` (secretbox، AAD `settings:smtp`) داخل القيمة نفسها (`password_enc`/`password_iv`) ولا تُعاد أبدًا (`password_set`, `password_source` فقط) — `GET/PUT /api/settings/smtp` (`clear_password:true` يعود إلى `SMTP_PASS` من البيئة)، `POST /api/settings/smtp/test {to?}`. كل إرسال (OTP الدخول، رموز الأسرار، الاختبار، تحويل الإشعارات) يستخدم `app.settings.smtp()` فتسري التغييرات دون إعادة تشغيل.
  - «الإشعارات» (`#notifications`): `email_relay` (تشغيل/إيقاف) و`severity.{info|warn|urgent}.email` — `GET/PUT /api/settings/notifications`. عند التفعيل يرسل `/_gw/notify` نسخة بريدية (قالب `renderNotificationEmail`) للمستلمين (أو كل النشطين للإشعار العام، حد 200) بأفضل جهد دون تعطيل الإدراج.
  - «المعلومات التقنية» → `/infra`، «الروابط السريعة» → `/links` (الإدارة تظهر تلقائيًا للمشرف)، «مركز الصلاحيات» → `/admin#perms`.
  - «النسخ الاحتياطي» (`#backup`): `GET /api/settings/backup` يعرض آخر نسخة وقائمة الملفات في `BACKUP_DIR` (افتراضيًا `/opt/details-gateway/backups`) وفي `/root/backups` إن كان مقروءًا؛ `POST /api/settings/backup/run` يشغّل `pg_dump --format=custom --compress=6 --no-owner --no-privileges --file=<dir>/details_gateway-<ts>.dump` بوسائط ثابتة والاتصال عبر متغيرات `PG*` (لا سر في سطر الأوامر)، يحتفظ بآخر 14 نسخة. وحدة systemd تحتاج `ReadWritePaths=/opt/details-gateway/backups` (أُضيفت في `deploy/details-gateway.service`).
- **خزنة مفاتيح الذكاء الاصطناعي** (`#ai_keys`, ترحيل 0013): جدول `ai_keys` (provider ∈ deepseek|openai|anthropic|google|openrouter|other، label، `key_prefix` أول 6 + `key_last4`، `secret_enc`+`secret_iv` بـ AES-256-GCM (AAD `ai_keys`)، base_url، default_model، created_by، last_checked_at، status ∈ valid|invalid|disconnected|unknown، last_error، usage_count، last_used_at، deleted_at) وجدول `ai_usage_log` (system_key, key_id, model, prompt/completion/total_tokens, ms, ok, error).
  - المفتاح يُلصق **مرة واحدة** في النموذج ويُحفظ مشفّرًا ويُمسح من الصفحة؛ لا تعيده أي واجهة بعدها (البادئة وآخر 4 فقط). عدة مفاتيح لكل مزود. «فحص الاتصال» يستدعي أرخص نقطة لدى المزود — OpenAI/DeepSeek/OpenRouter/other: `GET {base}/models` بـ Bearer؛ Anthropic: `GET /v1/models` بـ `x-api-key`؛ Google: `GET /models` بترويسة `x-goog-api-key` (بدل `?key=` حتى لا يظهر المفتاح في أي سجل) — ويحدّث status/last_checked_at/last_error (2xx/429 صالح، 401/403 مرفوض، 5xx/شبكة غير متصل).
  - **الحذف مسموح فقط** إذا كانت الحالة `invalid` أو `disconnected` (الخادم يرد 409 «لا يمكن حذف مفتاح صالح متصل»؛ الواجهة تعطّل الزر بالتلميح نفسه). الحذف ناعم (`deleted_at`).
  - واجهة الإدارة: `GET /api/settings/ai/providers`, `GET/POST /api/settings/ai/keys`, `GET /api/settings/ai/keys/:id` (التفاصيل + إحصاءات الاستخدام + آخر 20 استدعاء), `PUT …/:id` (الاسم/الرابط/النموذج، ومفتاح جديد اختياري يعيد الحالة إلى unknown), `POST …/:id/check`, `DELETE …/:id`. كل عملية في `audit_log` (`ai.key.create/update/check/delete/delete_denied`).
  - **واجهة داخلية للأنظمة الأخرى** (البريد، الموارد البشرية، WMS…؛ ترويسة `X-Gw-Proxy-Key`، عبر nginx على loopback/النفق فقط):
    - `GET /_gw/ai/keys?provider=deepseek` → `{ keys:[{ id, provider, label, key_display, effective_base_url, effective_model, status, usage_count, last_used_at, … }] }` بلا أسرار.
    - `POST /_gw/ai/complete` بجسم `{ provider?: "deepseek", key_id?: "<uuid>", model?: "deepseek-chat", messages: [{role: system|user|assistant, content}], max_tokens?, temperature?, system?: "mail" }` (أحد `provider`/`key_id` مطلوب؛ `system` أو ترويسة `X-Gw-System` = النظام المستدعي للسجل).
      البوابة تختار المفتاح (المحدد، أو أفضل مفتاح للمزود: صالح ثم غير مفحوص، الأقل استخدامًا)، وتستدعي المزود بالمفتاح المخزّن بمهلة 30 ثانية، وتعيد **JSON متوافقًا مع OpenAI** لكل المزودين: `{ ok, provider, key_id, model, ms, id, choices:[{index, message:{role, content}, finish_reason}], usage:{prompt_tokens, completion_tokens, total_tokens} }` (Anthropic وGoogle تُترجم ذهابًا وإيابًا). تزيد `usage_count` وتسجّل في `ai_usage_log`؛ 401/403 من المزود تجعل المفتاح `invalid`. الأخطاء: 400 (الجسم)، 404 «لا يوجد مفتاح متاح لهذا المزود»، 502 (رد المزود)، 504 (مهلة)، 503 (SECRETS_KEY غير مهيأ). المفتاح لا يغادر البوابة أبدًا.
    - مثال: `curl -s -H "X-Gw-Proxy-Key: $GATEWAY_PROXY_KEY" -H "Content-Type: application/json" http://127.0.0.1:4000/_gw/ai/complete -d '{"provider":"deepseek","system":"mail","messages":[{"role":"user","content":"لخّص هذا البريد…"}],"max_tokens":300}'`
  - البذرة الأولى: `scripts/seed-deepseek-key.mjs` (يُشغَّل مرة على الجسر كـ root) يقرأ `/root/keep/ai-keys.env`، يدرج مفتاح DeepSeek مشفّرًا باسم «DeepSeek — المفتاح الرئيسي» (created_by = 1012)، يفحص الاتصال، يطبع المزود/البادئة/الحالة فقط، ثم `shred -u` للملف.
- **CORS لـ `GET /api/me` فقط**: الأنظمة الموكّلة على `https://<sub>.details-wms.cloud` (البريد، HR، واتساب، المرفقات…) تقرأ اسم الموظف وصورته بـ `fetch('https://details-wms.cloud/api/me', { credentials: 'include' })` لأن كعكة `dg_session` على النطاق الأب. الخادم يعيد الأصل نفسه حرفيًا (`corsOriginAllowed` في `authz.js`: https، تسمية فرعية واحدة من النطاق الجذر، بلا منفذ أو مسار، لا بدل عام) مع `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Methods: GET`, `Vary: Origin`؛ `OPTIONS /api/me` يرد 204 بالترويسات نفسها. لا مسار آخر يحمل CORS.
- متغير بيئة اختياري جديد: `BACKUP_DIR`. تصحيح جانبي: استعادة `$1` المفقودة في ثلاثة استعلامات في `routes/admin.js` (حماية آخر مدير، فلاتر التاريخ في السجلات).

## «الروابط السريعة» كقائمة بأعمدة (ترحيل 0014)
- الصفحة `/links` صارت **جدولًا لكل تصنيف** (رأس التصنيف بالاسم والعدد، قابل للطي ويُحفظ محليًا؛ المثبّت أولًا؛ بحث في كل الأعمدة؛ رأس ثابت، تظليل متناوب، Arial 13px، صفوف 40px). الأعمدة: الرابط (أيقونة الموقع + العنوان والمضيف ونجمة التثبيت)، الأهمية (عادي/مهم/حرج)، مستوى الوصول (الكل/الموظفون/المدراء)، الوصف، الصلاحية («غير محدد» أو التاريخ مع تنبيه ≤30 يومًا/منتهٍ)، الإنشاء (الاسم + التاريخ + «منذ N يوم»)، آخر استخدام (كذلك)، النقرات (شارة)، إجراءات (فتح، نسخ؛ وللمشرف: تثبيت، ▲▼ ترتيب، سجل الاستخدام، تعديل، حذف).
- أعمدة جديدة على `quick_links`: `priority` (normal|important|critical)، `audience` (all|staff|admins — يحل محل `access` الذي يبقى متزامنًا)، `expires_at date`. `GET /api/links` يعيد أيضًا اسم المنشئ وآخر مستخدم. جديد: `POST /api/admin/links/:id/move {dir: up|down}` (يعيد ترقيم التصنيف 10، 20، … ثم يبدّل مع الجار). النقر ما زال عبر `/links/go/:id`.
- إصلاح: قاعدة عامة `[hidden]{display:none !important}` في `gateway.css` (كانت `display:grid/flex` على الحاويات تتغلب على السمة `hidden` فتظهر خلفية معتمة ونموذج فارغ عند التحميل)؛ النموذج ونافذة السجل في الروابط تُنشأ عند الحاجة فقط. بطاقة البوابة المضغوطة لم تتغير.

## «شارات الانتباه» على بطاقات البوابة (`src/lib/badges.js`)
- كل بطاقة (شبكة أو مضغوطة) تحمل **عدّادًا صغيرًا في زاويتها العلوية اليسرى** = عدد العناصر التي تحتاج انتباه الموظف في ذلك النظام: أحمر، وكهرماني لـ«بيانات المنشأة» (مستندات منتهية/تنتهي خلال 30 يومًا)؛ يختفي عند الصفر؛ التلميح = الوصف + العدد؛ أكثر من 99 يظهر «99+». زر «بوابتي» في الرأس بلا شارة. تتحدث الشارات كل 60 ثانية وعند عودة التركيز للنافذة (مع الجرس) عبر `GET /api/badges`.
- **الواجهة**: `GET /api/me` يعيد الحقل `badges` (مع بقاء `tiles_badges` للتوافق) و`build {version, built_at}`؛ و`GET /api/badges` → `{ badges }` فقط. الشكل: `{ "<system_key>": { "count": 3, "label": "محادثات غير مقروءة", "tone": "red"|"amber" } }` — العدّادات الصفرية لا تُعاد. مفتاح النظام = مفتاح البطاقة في `systems`.
- **الحساب**: `getBadges(app, employee, systemKeys)` يحسب بالتوازي فقط للأنظمة التي يراها الموظف، مع تخزين مؤقت في الذاكرة لكل موظف 45 ثانية (ودمج الطلبات المتزامنة) ومهلة 2.5 ثانية لكل مصدر؛ فشل أو مهلة أو 404 لمصدر = لا شارة له دون تعطيل البقية.
  | البطاقة | المصدر |
  |---|---|
  | `notifications` | إشعارات غير مقروءة للموظف (`countUnread`) |
  | `company` | عناصر المنشأة المنتهية أو التي تنتهي خلال 30 يومًا (`countCompanyAlerts`) — للمدير فقط، كهرماني |
  | `whatsapp` | `GET /internal/badge` (محادثات مفتوحة غير مقروءة يحق له رؤيتها) |
  | `mail` | `GET /api/internal/badge` (رسائل الوارد غير المقروءة عبر الصناديق المسموحة، دون أرشيف رسائل التحقق والمخفي بالتصنيف) |
  | `hr` | `GET /api/internal/badge` (طلبات وعمليات بانتظار اعتماده: `operations_inbox().my_turn` + معلّقات الإجازات/الحضور/العمل الإضافي/التأمين لمشرفي HR) |
  | `files` | `GET /internal/badge` (ملفات وردت خلال 7 أيام على طلباته ولم يفتح الطلب بعدها؛ `file_requests.last_opened_at`) |
  | `bls`, `wms` | لا شيء حاليًا |
- **عقد `/internal/badge` لأي نظام جديد** (يُضاف اسمه في `REMOTE_SOURCES` داخل `badges.js`): البوابة تستدعيه عبر النفق `GET http://10.9.0.3<path>?employee_no=NNNN` بترويسة `Host: <system>.details-wms.cloud` و`X-Gw-Proxy-Key: <GATEWAY_PROXY_KEY>`؛ يرد JSON `{ "ok": true, "count": <عدد صحيح ≥ 0>, "label"?: "نص عربي ≤ 60 حرفًا", "allowed"?: bool, "url"?: "…" }`؛ 401 لمفتاح خاطئ أو غائب، 400 لرقم وظيفي غير مكوّن من 4 أرقام. شروط الأمان: مقارنة المفتاح ثابتة الزمن، وnginx على خادم التطبيقات يسمح لـ`10.9.0.1` فقط ويحجب أي طلب يحمل `X-Gw-Employee-No` (أي عابر من المتصفح عبر الجسر)، ولا يعيد الرد أسرارًا ولا أسماء. الهدف زمنيًا < 300ms (استعلام واحد مفهرس)؛ العدّ يكون «ما ينتظر هذا الموظف تحديدًا» لا إجمالي النظام.
- **تذييل البوابة**: شريط ثابت 38px: يمين = توقيتات السعودية/مصر/فلسطين/اليمن (علم + اسم + وقت، وتوقيت بلد الدخول مظلّل، يتحدث حيًا)، يسار = «جميع الحقوق محفوظة © 2026 ديتيلز كونسولتس للاستشارات الهندسية · بوابة ديتيلز» مع رقم الإصدار وتاريخ البناء (أحدث تعديل لملفات `src`/`web`/`migrations`). سطر التاريخ (هجري + ميلادي + اليوم + ساعة الرياض) شريط ضيق من سطر واحد تحت الرأس. أنماط الشارات والسطر والتذييل في `web/css/portal-badges.css` (ملف مستقل عن `gateway.css`).
