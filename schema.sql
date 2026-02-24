-- ====== Constraints: roles / severity / status ======
alter table employees
add constraint employees_role_check
check (role in ('admin','hr','supervisor','operator','observer'));

alter table warning_letters
add constraint warning_letters_severity_check
check (severity in ('low','medium','high','critical'));

alter table warning_letters
add constraint warning_letters_status_check
check (status in ('active','resolved','revoked'));

-- ====== Evaluations: RLS + unique week entry ======
alter table employee_weekly_evaluations enable row level security;

create unique index if not exists uniq_eval_employee_week
on employee_weekly_evaluations(employee_id, week_start);

-- Employees can view own evaluations (for future direct client access)
create policy "Employees can view own evaluations"
on employee_weekly_evaluations
for select
using (auth.uid() = employee_id);

-- HR/Admin full access (for future direct client access)
create policy "HR and Admin full access evaluations"
on employee_weekly_evaluations
for all
using (exists (
  select 1 from employees
  where employees.id = auth.uid()
    and employees.role in ('hr','admin')
));