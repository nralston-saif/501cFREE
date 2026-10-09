-- 0007: QuickBooks Online integration (optional; enabled by QBO_* env vars).
--
-- Bank feeds in QuickBooks are the source of cash transactions. The app
-- never creates QuickBooks transactions on its own: it fills in matched
-- bank-feed transactions (payee, account, class, receipts), and pulls
-- changed transactions into qbo_inbox for review. See docs/quickbooks.md.

-- OAuth tokens (singleton)
create table qbo_connection (
  id integer primary key default 1 check (id = 1),
  environment text not null check (environment in ('sandbox', 'production')),
  realm_id text not null,
  company_name text,
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  connected_by uuid references team_members (id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Local values → QuickBooks ids: expense categories → accounts, functional
-- classes → Classes, payment methods → paid-from accounts
create table qbo_mappings (
  id uuid primary key default gen_random_uuid(),
  mapping_type text not null check (mapping_type in ('category', 'functional_class', 'payment_method')),
  local_key text not null,
  qbo_id text not null,
  qbo_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mapping_type, local_key)
);

-- Pull settings and last-run status (singleton)
create table qbo_sync_state (
  id integer primary key default 1 check (id = 1),
  pull_enabled boolean not null default false,
  -- Only exact scheduled-disbursement matches are ever auto-applied
  auto_apply_enabled boolean not null default false,
  pull_since date not null default current_date,
  last_cdc_at timestamptz,
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('ok', 'error')),
  last_run_error text,
  last_run_stats jsonb,
  updated_at timestamptz not null default now()
);

insert into qbo_sync_state (id) values (1);

-- One row per QuickBooks transaction pulled for review at /banking
create table qbo_inbox (
  id uuid primary key default gen_random_uuid(),
  qbo_entity_type text not null check (qbo_entity_type in (
    'Purchase', 'Deposit', 'Transfer', 'JournalEntry', 'Bill', 'BillPayment', 'SalesReceipt'
  )),
  qbo_entity_id text not null,
  kind text not null default 'new' check (kind in ('new', 'changed', 'deleted')),
  -- 'echo' = a transaction this app sent itself
  status text not null default 'pending'
    check (status in ('pending', 'auto_applied', 'approved', 'dismissed', 'echo')),
  raw jsonb not null,
  previous_raw jsonb,
  txn_date date,
  amount_cents bigint,
  direction text check (direction in ('money_in', 'money_out')),
  counterparty_name text,
  qbo_payment_account_id text,
  qbo_line_account_ids text[] not null default '{}',
  qbo_doc_number text,
  qbo_private_note text,
  suggestion jsonb,
  resolution jsonb,
  dismiss_reason text,
  reviewed_by uuid references team_members (id) on delete set null,
  reviewed_at timestamptz,
  expense_id uuid references expenses (id) on delete set null,
  contribution_id uuid references contributions (id) on delete set null,
  disbursement_id uuid references disbursements (id) on delete set null,
  pri_id uuid references pris (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (qbo_entity_type, qbo_entity_id)
);

-- Banking tabs filter by status and sort by transaction date
create index qbo_inbox_status_txn_date_idx on qbo_inbox (status, txn_date desc);
create index qbo_inbox_txn_date_idx on qbo_inbox (txn_date);

alter table qbo_connection enable row level security;
alter table qbo_mappings enable row level security;
alter table qbo_sync_state enable row level security;
alter table qbo_inbox enable row level security;

create policy "Admins full access" on qbo_connection
  for all using ((select is_admin())) with check ((select is_admin()));
create policy "Admins full access" on qbo_mappings
  for all using ((select is_admin())) with check ((select is_admin()));
create policy "Admins full access" on qbo_sync_state
  for all using ((select is_admin())) with check ((select is_admin()));
create policy "Admins full access" on qbo_inbox
  for all using ((select is_admin())) with check ((select is_admin()));
