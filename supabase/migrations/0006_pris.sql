-- 0006: Program-related investments (PRIs): mission-aligned investments
-- (SAFE, note, equity, loan) carried as balance-sheet assets (Form 990
-- Part X line 13, Schedule D Part VIII), not grants. Funding never creates
-- an expense. Funding is gated in the app on a complete mission-alignment
-- memo, an attached executed instrument, and (above the threshold in
-- org_settings) a board approval date.

create table pris (
  id uuid primary key default gen_random_uuid(),
  recipient_contact_id uuid not null references contacts (id),
  instrument text not null check (instrument in ('safe', 'convertible_note', 'equity', 'loan', 'other')),
  purpose text,
  amount_cents bigint not null check (amount_cents >= 0),
  investment_date date,
  board_approval_date date,
  funded_date date,
  method text check (method in ('check', 'ach', 'wire')),
  status text not null default 'committed'
    check (status in ('committed', 'funded', 'converted', 'repaid', 'exited', 'written_off')),
  notes text,
  qbo_txn_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pri_noncommitted_requires_funded_date check (status = 'committed' or funded_date is not null)
);

create index pris_recipient_idx on pris (recipient_contact_id);
create index pris_status_idx on pris (status);

-- Ten-question mission-alignment memo (registry in lib/pris/memo.ts)
create table pri_memos (
  id uuid primary key default gen_random_uuid(),
  pri_id uuid not null unique references pris (id) on delete cascade,
  q_exempt_purpose text,
  q_why_investment text,
  q_income_not_significant text,
  q_use_of_funds text,
  q_key_terms text,
  q_success_outcomes text,
  q_risks text,
  q_exit_plan text,
  q_conflicts text,
  q_monitoring text,
  started_by uuid references team_members (id) on delete set null,
  last_edited_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pri_research (
  id uuid primary key default gen_random_uuid(),
  pri_id uuid not null references pris (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  draft jsonb,
  sources jsonb,
  open_questions jsonb,
  error text,
  model text,
  requested_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pri_research_pri_idx on pri_research (pri_id, created_at desc);

-- Rendered memorandum PDF, filed as an attachment under the PRI
create table pri_memo_pdfs (
  id uuid primary key default gen_random_uuid(),
  pri_id uuid not null unique references pris (id) on delete cascade,
  attachment_id uuid references attachments (id) on delete set null,
  pdf_storage_path text not null,
  body_snapshot jsonb not null,
  generated_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pris enable row level security;
alter table pri_memos enable row level security;
alter table pri_research enable row level security;
alter table pri_memo_pdfs enable row level security;

create policy "Members full access" on pris
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on pri_memos
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on pri_research
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on pri_memo_pdfs
  for all using ((select is_team_member())) with check ((select is_team_member()));
