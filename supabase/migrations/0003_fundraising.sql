-- 0003: Fundraising: contributions and IRS acknowledgement letters, stock
-- gifts and price cache, and donation inquiries.

create table contributions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts (id),
  -- Null only for in-kind gifts: the organization describes the property but
  -- never asserts a value (IRS Pub 1771: valuation is the donor's job).
  -- For stock gifts this is the internal fair-market value.
  amount_cents bigint check (amount_cents >= 0),
  received_date date not null,
  method text not null
    check (method in ('check', 'ach', 'wire', 'credit_card', 'stock', 'crypto', 'in_kind')),
  vehicle text not null default 'direct'
    check (vehicle in ('direct', 'daf', 'private_foundation', 'ira_qcd', 'employer_match', 'charitable_trust', 'other')),
  vehicle_sponsor_name text,         -- e.g. the DAF sponsor
  in_kind_description text,
  restriction text not null default 'unrestricted'
    check (restriction in ('unrestricted', 'donor_restricted')),
  restriction_purpose text,
  quid_pro_quo boolean not null default false,
  goods_services_description text,
  goods_services_value_cents bigint check (goods_services_value_cents >= 0),
  check_number text,
  notes text,
  qbo_txn_type text,
  qbo_txn_id text,
  entered_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint in_kind_requires_description check (method <> 'in_kind' or in_kind_description is not null),
  constraint cash_requires_amount check (method = 'in_kind' or amount_cents is not null),
  constraint quid_pro_quo_requires_details check (
    not quid_pro_quo or (goods_services_description is not null and goods_services_value_cents is not null)
  ),
  -- DAF and QCD gifts can't carry benefits back to the donor
  constraint vehicle_no_quid_pro_quo check (not quid_pro_quo or vehicle not in ('daf', 'ira_qcd'))
);

create index contributions_contact_idx on contributions (contact_id);
create index contributions_date_idx on contributions (received_date);

create table acknowledgement_letters (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null unique references contributions (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'generated', 'sent')),
  pdf_storage_path text,
  -- Frozen copy of the data the letter was rendered from, so later edits to
  -- the contribution or settings never silently change a sent letter
  body_snapshot jsonb,
  sent_to_email text,
  sent_at timestamptz,
  resend_message_id text,
  generated_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table stock_contribution_details (
  contribution_id uuid primary key references contributions (id) on delete cascade,
  security_name text not null,
  ticker_symbol text check (ticker_symbol is null or ticker_symbol = upper(ticker_symbol)),
  cusip text,
  shares numeric(20, 6) not null check (shares > 0),
  valuation_date date not null,
  fmv_per_share_cents numeric(20, 6) check (fmv_per_share_cents >= 0),
  fmv_total_cents bigint not null check (fmv_total_cents >= 0),
  valuation_source text not null default 'manual'
    check (valuation_source in ('manual', 'api_estimate', 'broker_statement')),
  market_price_source text,
  brokerage_account text,
  transfer_received_date date,
  sale_date date,
  sale_gross_cents bigint check (sale_gross_cents >= 0),
  sale_fees_cents bigint check (sale_fees_cents >= 0),
  sale_net_cents bigint check (sale_net_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stock_contribution_ticker_idx on stock_contribution_details (ticker_symbol);
create index stock_contribution_valuation_date_idx on stock_contribution_details (valuation_date);

-- Daily market data cache (optional Financial Modeling Prep integration)
create table security_prices (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol = upper(symbol)),
  price_date date not null,
  open_cents bigint check (open_cents >= 0),
  high_cents bigint check (high_cents >= 0),
  low_cents bigint check (low_cents >= 0),
  close_cents bigint not null check (close_cents >= 0),
  adjusted_close_cents bigint check (adjusted_close_cents >= 0),
  volume bigint check (volume >= 0),
  source text not null default 'manual',
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (symbol, price_date, source)
);

create index security_prices_symbol_date_idx on security_prices (symbol, price_date desc);

-- Gift intentions submitted from the organization's public website
create table donation_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  organization text,
  gift_method text not null default 'other'
    check (gift_method in ('check', 'wire_ach', 'daf', 'stock_crypto', 'other')),
  amount_cents bigint check (amount_cents >= 0),
  amount_text text,
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'archived')),
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index donation_inquiries_status_idx on donation_inquiries (status);
create index donation_inquiries_created_idx on donation_inquiries (created_at desc);

alter table contributions enable row level security;
alter table acknowledgement_letters enable row level security;
alter table stock_contribution_details enable row level security;
alter table security_prices enable row level security;
alter table donation_inquiries enable row level security;

create policy "Members full access" on contributions
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on acknowledgement_letters
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on stock_contribution_details
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on security_prices
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on donation_inquiries
  for all using ((select is_team_member())) with check ((select is_team_member()));
