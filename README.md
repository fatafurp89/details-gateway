# بوابة الدخول الموحد لديتيلز (Details Gateway)

خدمة Node واحدة على `details-wms.cloud` هي المدخل الوحيد لأنظمة ديتيلز: دخول بالرقم الوظيفي + رمز تحقق بالبريد أو بحساب Google،
وبوابة تعرض الأنظمة المصرح بها فقط، و`/_gw/verify` يستدعيه nginx (`auth_request`) قبل كل طلب لأي نظام محمي.

## التشغيل على الخادم (Ubuntu 24.04)
```bash
sudo bash deploy/install.sh        # آمن للتكرار: Node 22 + PostgreSQL 16 + القاعدة + الخدمة
sudo nano /etc/details-gateway/env # أكمل SMTP_PASS و GOOGLE_* و BOOTSTRAP_ADMIN_*
sudo systemctl restart details-gateway
sudo cp deploy/nginx-gateway.conf /etc/nginx/sites-available/details-wms.cloud
sudo nginx -t && sudo systemctl reload nginx
```
- الخدمة: `details-gateway.service` على `127.0.0.1:4000` فقط. السجلات: `journalctl -u details-gateway -f` (JSON).
- الترحيلات: `npm run migrate` (يقرأ `DATABASE_URL`)، أو على الخادم: `cd /opt/details-gateway && sudo node --env-file=/etc/details-gateway/env src/migrate.js`.
- أول مدير: إن كان جدول الموظفين فارغًا يُنشأ من `BOOTSTRAP_ADMIN_*` عند بدء الخدمة.
- بيانات تجريبية للتطوير فقط: `psql "$DATABASE_URL" -f seed/dev-seed.sql`.
- الاختبارات: `npm test` (بلا شبكة ولا قاعدة).

## المتغيرات (`/etc/details-gateway/env`, chmod 600)
| المتغير | الوصف |
|---|---|
| `DATABASE_URL` | اتصال PostgreSQL (يولّده المثبت) |
| `SESSION_SECRET` | سر توقيع كعكة `dg_session` (HMAC-SHA256) |
| `OTP_PEPPER` | يُخلط مع رموز التحقق قبل تخزينها hash |
| `TICKET_SECRET` | سر تذكرة `dg_ticket` (JWT HS256، 60 ثانية) — يُعطى للأنظمة المرتبطة لتتحقق منها |
| `GATEWAY_PROXY_KEY` | سر الترويسة `X-Gw-Proxy-Key` لمساري الصلاحيات الداخليين `/_gw/catalog` و`/_gw/grants` — يُعطى للأنظمة (فارغ = المساران يرفضان) |
| `BASE_URL`, `COOKIE_DOMAIN`, `ROOT_DOMAIN` | `https://details-wms.cloud`, `.details-wms.cloud`, `details-wms.cloud` |
| `SMTP_HOST/PORT/USER/PASS` | بريد إرسال الرموز (Hostinger، المنفذ 465) |
| `GOOGLE_CLIENT_ID/SECRET` | الدخول بحساب Google (فارغ = يختفي الزر) |
| `GOOGLE_REDIRECT_URI` | `https://details-wms.cloud/api/auth/google/callback` (المسجّل في Google) |
| `BOOTSTRAP_ADMIN_EMPLOYEE_NO/NAME/EMAIL` | المدير الأول |

## كيف يضيف المدير نظامًا
1. **الإدارة ← الأنظمة**: أضف صفًا جديدًا (مفتاح إنجليزي قصير مثل `crm`، الاسم، الوصف، الأيقونة، الحالة).
   - **proxy** (نظام داخلي خلف nginx): ضع `host` مثل `crm.details-wms.cloud`.
   - **link** (نظام خارجي): ضع `upstream` رابط https يستقبل `?dg_ticket=` ويتحقق منه بـ `TICKET_SECRET`
     (الحقول: `employee_no, name, email, system_key, aud, exp`).
2. **الإدارة ← الصلاحيات**: فعّل `use` أو `admin` للموظفين المطلوبين.
3. لنظام **proxy** فقط: انسخ `deploy/nginx-subdomain.conf.example` إلى ملف جديد، غيّر `server_name` و`X-Gw-System`
   و`proxy_pass`، استخرج شهادة (`certbot certonly --webroot -w /var/www/portal -d crm.details-wms.cloud`)،
   ثم `nginx -t && systemctl reload nginx`. احذف كتلة `map` من النسخ الإضافية (تُعرَّف مرة واحدة).
4. غيّر الحالة إلى «يعمل» عند الجاهزية.

يتسلم النظام المحمي هوية المستخدم في الترويسات: `X-Gw-Employee-No`, `X-Gw-Name` (UTF-8 مرمّز URL), `X-Gw-Email`, `X-Gw-Role`, `X-Gw-Level`.
يجب ألا يستمع أي نظام إلا للجسر/الشبكة الداخلية حتى لا يمكن تجاوز البوابة.

## شجرة الصلاحيات (الدقيقة)
- كل نظام يرسل كتالوج عناصره (وحدات/شاشات/أزرار) إلى `POST /_gw/catalog` عبر النفق بترويسة `X-Gw-Proxy-Key`، ويقرأ المصرّح به للموظف من `GET /_gw/grants/<الرقم>?system=<المفتاح>` (`{admin:true}` للمشرف العام أو `{keys:[...]}`).
- المشرف العام يمنح من أيقونة الدرع «الصلاحيات» في رأس البوابة (`/admin#perms`). كل عنصر جديد يظهر غير معلّم حتى يُمنح. التفاصيل في `SPEC.md`.

## الأمان باختصار
تحقق كامل في الخادم · كعكة موقّعة `Secure; HttpOnly; SameSite=Lax` على `.details-wms.cloud` (12 ساعة مطلقة، 30 دقيقة خمول) ·
رموز OTP مخزنة sha256 + pepper، 10 دقائق، 5 محاولات · حدود: 6 رموز/موظف/ساعة، 20/IP/ساعة، قفل 30 دقيقة بعد 5 رموز خاطئة ·
مقارنات ثابتة الزمن · رسائل خطأ موحدة · كل دخول وتغيير صلاحية في `audit_log` (إلحاق فقط بقادح في القاعدة).
