-- صورة الموظف تُعرض بجوار اسمه في البوابة (رابط داخلي أو خارجي)؛ عند غيابها تُعرض الأحرف الأولى
ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url text;
