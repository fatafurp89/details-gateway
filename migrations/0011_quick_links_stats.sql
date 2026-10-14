-- «الروابط السريعة»: إحصاءات الاستخدام — عدّاد النقرات وآخر استخدام على الرابط، وسجل نقرات لكل موظف.
-- إضافي وآمن للتكرار. النقر يمر عبر GET /links/go/:id الذي يسجّل ثم يحوّل إلى الرابط.
ALTER TABLE quick_links ADD COLUMN IF NOT EXISTS click_count  int NOT NULL DEFAULT 0;
ALTER TABLE quick_links ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE TABLE IF NOT EXISTS quick_link_clicks (
  id          bigserial PRIMARY KEY,
  link_id     uuid NOT NULL REFERENCES quick_links(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  clicked_at  timestamptz NOT NULL DEFAULT now(),
  user_agent  text
);
CREATE INDEX IF NOT EXISTS quick_link_clicks_link ON quick_link_clicks (link_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS quick_link_clicks_time ON quick_link_clicks (clicked_at DESC);
