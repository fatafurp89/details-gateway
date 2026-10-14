-- Employees imported from HR may have no e-mail yet; they cannot use OTP until one is set.
ALTER TABLE employees ALTER COLUMN email DROP NOT NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hr_status text;
