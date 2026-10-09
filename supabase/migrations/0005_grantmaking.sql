-- 0005: Grantmaking: proposals (intake → blind review → diligence memo →
-- decision), awards, disbursements and grantee reports.

create table grant_proposals (
  id uuid primary key default gen_random_uuid(),
  -- 'external' = submitted through the public intake endpoint; arrives
  -- with raw applicant fields and no contact until a team member links one.
  -- 'internal' = created by the team; skips review straight to diligence.
  origin text not null default 'internal' check (origin in ('external', 'internal')),
  applicant_contact_id uuid references contacts (id),
  applicant_name text,
  applicant_email text,
  organization_name text,
  raw_submission jsonb,
  title text not null,
  summary text,
  amount_requested_cents bigint check (amount_requested_cents >= 0),
  program_areas text[] not null default '{}',   -- program_areas.slug values
  received_date date,
  entered_date date not null default current_date,
  source text,
  status text not null default 'received'
    check (status in ('received', 'in_review', 'diligence', 'decided', 'withdrawn')),
  -- Blind voting: reviews stay hidden until every active admin has voted
  -- or recused, then this flips and the team advances or declines.
  votes_revealed boolean not null default false,
  decision text check (decision in ('approved', 'declined')),
  decision_date date,
  decision_notes text,
  declined_stage text check (declined_stage in ('review', 'decision')),
  draft_response_email text,
  response_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applicant_identity_present check (applicant_contact_id is not null or applicant_email is not null),
  constraint decided_requires_decision check (status <> 'decided' or decision is not null)
);

-- The pipeline board filters by status and sorts by received date
create index grant_proposals_status_received_idx on grant_proposals (status, received_date desc);
create index grant_proposals_applicant_idx on grant_proposals (applicant_contact_id);

create table proposal_reviews (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references grant_proposals (id) on delete cascade,
  reviewer_id uuid not null references team_members (id),
  score integer check (score between 1 and 5),
  vote text check (vote in ('yes', 'no', 'maybe')),
  comments text,
  recused boolean not null default false,   -- conflict of interest
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proposal_id, reviewer_id),
  constraint recused_means_no_vote check (not recused or (score is null and vote is null))
);

create index proposal_reviews_proposal_idx on proposal_reviews (proposal_id);

create table proposal_comments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references grant_proposals (id) on delete cascade,
  author_id uuid not null references team_members (id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index proposal_comments_proposal_idx on proposal_comments (proposal_id);

-- Grant memorandum written during diligence: ten numbered sections
-- (registry in lib/grants/memo.ts) plus free-text header fields
create table proposal_memos (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references grant_proposals (id) on delete cascade,
  header_purpose text,
  header_structure text,
  header_decision text,
  header_grantee_descriptor text,
  q_summary_recommendation text,
  q_org_background text,
  q_cause_area_fit text,
  q_theory_of_change text,
  q_counterfactual text,
  q_grant_size_structure text,
  q_success_disappointment text,
  q_risks_mitigations text,
  q_legal_compliance text,
  q_monitoring_evaluation text,
  started_by uuid references team_members (id) on delete set null,
  last_edited_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- AI research runs that draft memo sections (a person saving the memo is
-- the approval step; the AI never writes proposal_memos)
create table grant_research (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references grant_proposals (id) on delete cascade,
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

create index grant_research_proposal_idx on grant_research (proposal_id, created_at desc);

-- Rendered memorandum PDF (in the letters bucket), with a frozen snapshot
create table grant_memo_pdfs (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references grant_proposals (id) on delete cascade,
  pdf_storage_path text not null,
  body_snapshot jsonb not null,
  generated_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table grants_out (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid unique references grant_proposals (id),
  grantee_contact_id uuid not null references contacts (id),
  purpose text,
  amount_awarded_cents bigint not null check (amount_awarded_cents >= 0),
  award_date date,
  restriction text,
  -- Disbursements can't be paid until the grant agreement is signed
  agreement_signed_date date,
  status text not null default 'awarded' check (status in ('awarded', 'active', 'completed', 'terminated')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index grants_out_grantee_idx on grants_out (grantee_contact_id);

create table disbursements (
  id uuid primary key default gen_random_uuid(),
  grant_out_id uuid not null references grants_out (id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  scheduled_date date,
  paid_date date,
  method text check (method in ('check', 'ach', 'wire')),
  status text not null default 'scheduled' check (status in ('scheduled', 'paid', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index disbursements_grant_idx on disbursements (grant_out_id);
-- Dashboard agenda (scheduled, by date) and paid-in-period totals
create index disbursements_status_scheduled_idx on disbursements (status, scheduled_date);
create index disbursements_status_paid_idx on disbursements (status, paid_date);

-- Paying a disbursement creates a matching "Grants paid" expense
alter table expenses
  add constraint expenses_disbursement_fk
  foreign key (disbursement_id) references disbursements (id) on delete set null;
-- ...and at most one: a double "Mark paid" can't book the grant twice
create unique index expenses_disbursement_unique on expenses (disbursement_id)
  where disbursement_id is not null;

create table grantee_reports (
  id uuid primary key default gen_random_uuid(),
  grant_out_id uuid not null references grants_out (id) on delete cascade,
  report_type text not null check (report_type in ('progress', 'final', 'financial')),
  due_date date not null,
  received_date date,
  status text not null default 'upcoming' check (status in ('upcoming', 'received', 'overdue', 'waived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index grantee_reports_grant_idx on grantee_reports (grant_out_id);
create index grantee_reports_due_idx on grantee_reports (due_date);

-- Program-area tags must exist in program_areas
create or replace function check_proposal_program_areas()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform assert_program_areas(new.program_areas);
  return new;
end;
$$;

create trigger grant_proposals_program_areas
  before insert or update of program_areas on grant_proposals
  for each row execute function check_proposal_program_areas();

alter table grant_proposals enable row level security;
alter table proposal_reviews enable row level security;
alter table proposal_comments enable row level security;
alter table proposal_memos enable row level security;
alter table grant_research enable row level security;
alter table grant_memo_pdfs enable row level security;
alter table grants_out enable row level security;
alter table disbursements enable row level security;
alter table grantee_reports enable row level security;

create policy "Members full access" on grant_proposals
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on proposal_memos
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on grant_research
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on grant_memo_pdfs
  for all using ((select is_team_member())) with check ((select is_team_member()));
-- Awards and disbursements move money. The team reads them and handles the
-- paperwork (agreement date, award status, scheduling and cancelling
-- payments); making awards, deleting them and anything that pays or
-- re-prices a disbursement is for admins. Column-level rules live in
-- 0009_business_rules.sql.
create policy "Members read awards" on grants_out
  for select using ((select is_team_member()));
create policy "Admins create awards" on grants_out
  for insert with check ((select is_admin()));
create policy "Members update awards" on grants_out
  for update using ((select is_team_member())) with check ((select is_team_member()));
create policy "Admins delete awards" on grants_out
  for delete using ((select is_admin()));
create policy "Members read disbursements" on disbursements
  for select using ((select is_team_member()));
create policy "Members schedule disbursements" on disbursements
  for insert with check ((select is_team_member()));
create policy "Members update disbursements" on disbursements
  for update using ((select is_team_member())) with check ((select is_team_member()));
create policy "Admins delete disbursements" on disbursements
  for delete using ((select is_admin()));
create policy "Members full access" on grantee_reports
  for all using ((select is_team_member())) with check ((select is_team_member()));

-- The grant-review voting body, set by org_settings.grant_review_mode:
-- every active team member ('all_members', the default) or only active
-- admins ('admins'). Every voting rule (review policies, the reveal, the
-- pipeline guard in 0009) goes through these, so they can't drift apart.
create or replace function grant_review_mode()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select grant_review_mode from org_settings where id = 1), 'all_members');
$$;

create or replace function is_grant_voter_member(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from team_members m
    where m.id = p_member_id
      and m.is_active
      and (grant_review_mode() = 'all_members' or m.role = 'admin')
  );
$$;

-- The signed-in user votes on grant proposals
create or replace function is_grant_voter()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_grant_voter_member(current_member_id());
$$;

-- Reviews: the voting body (is_grant_voter) writes, each only their own.
-- Reads are blind: a member sees their own review, and everyone's once the
-- proposal's votes are revealed (0009 also freezes reviews after that).
create policy "Members read own or revealed reviews" on proposal_reviews
  for select using (
    (select is_team_member())
    and (
      reviewer_id = (select current_member_id())
      or exists (select 1 from grant_proposals p where p.id = proposal_id and p.votes_revealed)
    )
  );
create policy "Reviewers insert own review" on proposal_reviews
  for insert with check ((select is_grant_voter()) and reviewer_id = (select current_member_id()));
create policy "Reviewers update own review" on proposal_reviews
  for update using (reviewer_id = (select current_member_id()))
  with check ((select is_grant_voter()) and reviewer_id = (select current_member_id()));
create policy "Reviewers delete own review" on proposal_reviews
  for delete using (reviewer_id = (select current_member_id()));

-- Comments: the team reads all; each person writes only their own
create policy "Members read comments" on proposal_comments
  for select using ((select is_team_member()));
create policy "Authors insert own comments" on proposal_comments
  for insert with check (author_id = (select current_member_id()));
create policy "Authors update own comments" on proposal_comments
  for update using (author_id = (select current_member_id())) with check (author_id = (select current_member_id()));
create policy "Authors delete own comments" on proposal_comments
  for delete using (author_id = (select current_member_id()));
