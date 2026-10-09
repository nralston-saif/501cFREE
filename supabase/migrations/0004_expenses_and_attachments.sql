-- 0004: Expense categories (Form 990 functional classes), expenses, and
-- the polymorphic attachments table used across the app.

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  functional_class text not null
    check (functional_class in ('program', 'management_general', 'fundraising')),
  form_990_line text,
  -- Categories the app itself relies on (e.g. 'grants_paid', used when a
  -- disbursement is paid). Renaming the category is fine; the key stays.
  system_key text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  description text not null,
  category_id uuid not null references expense_categories (id),
  vendor_contact_id uuid references contacts (id),
  payment_method text check (payment_method in ('card', 'check', 'ach', 'wire', 'reimbursement')),
  status text not null default 'paid' check (status in ('pending', 'paid', 'reimbursed')),
  -- Set when a team member fronted the expense personally
  paid_by uuid references team_members (id) on delete set null,
  is_1099_eligible boolean not null default false,
  -- Set when this expense was created by paying a grant disbursement
  -- (foreign key added in 0005 once disbursements exists)
  disbursement_id uuid,
  notes text,
  -- QuickBooks Online sync. qbo_source says which side owns the record:
  -- 'app' = created here; 'qbo' = created from a QuickBooks transaction.
  qbo_source text not null default 'app' check (qbo_source in ('app', 'qbo')),
  qbo_purchase_id text,
  qbo_sync_status text not null default 'not_synced'
    check (qbo_sync_status in ('not_synced', 'synced', 'failed')),
  qbo_synced_at timestamptz,
  qbo_sync_error text,
  entered_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expenses_date_idx on expenses (expense_date);
create index expenses_category_idx on expenses (category_id);
create index expenses_vendor_idx on expenses (vendor_contact_id);

-- Files attached to records. Governance documents (bylaws, determination
-- letter, minutes) use entity_type 'governance' with the nil UUID.
create table attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'expense', 'contribution', 'grant_proposal', 'grant_out', 'grantee_report',
    'contact', 'governance', 'pri'
  )),
  entity_id uuid not null,
  storage_path text not null,        -- in the documents bucket
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index attachments_entity_idx on attachments (entity_type, entity_id);

alter table expense_categories enable row level security;
alter table expenses enable row level security;
alter table attachments enable row level security;

create policy "Members read categories" on expense_categories
  for select using ((select is_team_member()));
create policy "Admins manage categories" on expense_categories
  for all using ((select is_admin())) with check ((select is_admin()));

-- Expenses are admin-only (they expose payroll and reimbursements)
create policy "Admins full access" on expenses
  for all using ((select is_admin())) with check ((select is_admin()));

-- Expense attachments follow expense access; everything else is open to
-- the team
create policy "Members access attachments" on attachments
  for all using ((select is_team_member()) and (entity_type <> 'expense' or (select is_admin())))
  with check ((select is_team_member()) and (entity_type <> 'expense' or (select is_admin())));
