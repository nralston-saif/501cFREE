-- 0091: Default data every installation starts with. Edit freely in the
-- app afterwards (Expenses → Categories).

-- US Form 990 Part IX expense lines, grouped by functional class
insert into expense_categories (name, functional_class, form_990_line, system_key) values
  ('Grants paid', 'program', 'Part IX line 1', 'grants_paid');

insert into expense_categories (name, functional_class, form_990_line) values
  ('Program supplies & services', 'program', 'Part IX line 24'),
  ('Travel', 'program', 'Part IX line 17'),
  ('Conferences & meetings', 'program', 'Part IX line 19'),
  ('Salaries & wages', 'management_general', 'Part IX line 7'),
  ('Payroll taxes', 'management_general', 'Part IX line 10'),
  ('Payroll fees', 'management_general', 'Part IX line 11g'),
  ('Employee benefits', 'management_general', 'Part IX line 9'),
  ('Legal fees', 'management_general', 'Part IX line 11b'),
  ('Accounting fees', 'management_general', 'Part IX line 11c'),
  ('Professional fees - other', 'management_general', 'Part IX line 11g'),
  ('Insurance', 'management_general', 'Part IX line 23'),
  ('Software & IT', 'management_general', 'Part IX line 14'),
  ('Office & postage', 'management_general', 'Part IX line 13'),
  ('Bank & payment fees', 'management_general', 'Part IX line 24'),
  ('Filing & registration fees', 'management_general', 'Part IX line 24'),
  ('Fundraising events', 'fundraising', 'Part IX line 24'),
  ('Fundraising - other', 'fundraising', 'Part IX line 24');
