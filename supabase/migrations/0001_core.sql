-- 0001: Core: team members and roles, access helpers, org settings,
-- program areas, audit log.
--
-- Access model: only people listed in team_members can sign in (public
-- signups should also be disabled in Supabase Auth settings; the trigger
-- below rejects any other email). Two roles:
--   admin  - everything, including expenses, QuickBooks, team management,
--            and the audit log; admins are the grant-review voting body
--   staff  - everything else

create extension if not exists pgcrypto;
create extension if not exists pg_trgm with schema extensions;

-- Shared updated_at trigger function (attached to every table with an
-- updated_at column in 0090_triggers.sql)
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table team_members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  email text not null unique,
  full_name text not null,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS helpers. SECURITY DEFINER so they can read team_members regardless of
-- the caller's policies; STABLE so the planner evaluates once per statement.
create or replace function is_team_member()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from team_members
    where auth_user_id = auth.uid() and is_active
  );
$$;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from team_members
    where auth_user_id = auth.uid() and is_active and role = 'admin'
  );
$$;

create or replace function current_member_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from team_members
  where auth_user_id = auth.uid() and is_active;
$$;

-- Link new auth users to their team_members row by email, and reject any
-- email that isn't on the team.
--
-- Only a user who proved they own the address is linked: one created by an
-- admin invite (invited_at is set; the app and scripts/bootstrap-admin.mjs
-- both use inviteUserByEmail) or one whose email is already confirmed.
-- An unconfirmed sign-up for a team email is let through but stays
-- unlinked (no access) until the confirmation trigger below links it, so
-- knowing a team member's email address isn't enough to claim their seat.
create or replace function link_team_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from team_members
    where lower(email) = lower(new.email)
      and (auth_user_id is null or auth_user_id = new.id)
  ) then
    raise exception 'Email % is not on the team for this workspace', new.email;
  end if;

  if new.invited_at is not null or new.email_confirmed_at is not null then
    update team_members
    set auth_user_id = new.id
    where lower(email) = lower(new.email)
      and auth_user_id is null;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function link_team_member();

-- Link a team email once its owner confirms it (sign-ups that weren't
-- invited). Never raises: this runs inside Supabase Auth's own update.
create or replace function link_confirmed_team_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from team_members where auth_user_id = new.id) then
    update team_members
    set auth_user_id = new.id
    where lower(email) = lower(new.email)
      and auth_user_id is null;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function link_confirmed_team_member();

-- There must always be at least one active admin, or nobody could manage
-- the team or settings again
create or replace function keep_an_active_admin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.role = 'admin' and old.is_active)
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.is_active)
     and not exists (
       select 1 from team_members
       where role = 'admin' and is_active and id <> old.id
     ) then
    raise exception 'At least one active admin is required';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger team_members_keep_admin
  before update of role, is_active or delete on team_members
  for each row execute function keep_an_active_admin();

alter table team_members enable row level security;

create policy "Members view team" on team_members
  for select using ((select is_team_member()));
create policy "Admins manage team" on team_members
  for all using ((select is_admin())) with check ((select is_admin()));

-- Organization settings (singleton row, id = 1). Everything an
-- organization would otherwise have to edit in code lives here.
create table org_settings (
  id integer primary key default 1 check (id = 1),
  -- Identity
  org_legal_name text,               -- used in letters and memos; required before generating either
  org_display_name text,             -- short name for the UI and email sign-offs
  org_aliases text[] not null default '{}', -- other spellings on invoices ("Acme Fdn")
  ein text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  website_url text,
  -- Mission, fed to the AI research and email-drafting features
  mission_statement text,
  -- Calendar and policy
  timezone text not null default 'America/New_York',
  fiscal_year_start_month integer not null default 1
    check (fiscal_year_start_month between 1 and 12),
  -- Program-related investments at or above this amount need a recorded
  -- board approval date before they can be funded. Null = no requirement.
  pri_board_approval_threshold_cents bigint
    check (pri_board_approval_threshold_cents is null or pri_board_approval_threshold_cents >= 0),
  -- The organization's IRS classification, printed on acknowledgement
  -- letters. Null = not specified (letters state only 501(c)(3) status).
  public_charity_status text
    check (public_charity_status in ('509a1', '509a2', '509a3', 'private_foundation')),
  -- Who votes on and advances grant proposals: every active team member
  -- ('all_members') or only active admins ('admins'). See is_grant_voter()
  -- in 0005_grantmaking.sql.
  grant_review_mode text not null default 'all_members'
    check (grant_review_mode in ('all_members', 'admins')),
  -- Acknowledgement letters
  letter_signatory_name text,
  letter_signatory_title text,
  letter_from_email text,
  letter_closing_text text not null default 'Thank you for your generous support of our mission.',
  -- Per-vehicle letter wording overrides ({ "daf": { "opening": "...",
  -- "tax": "..." } }); a missing group or field uses the default in
  -- lib/pdf/letter-templates.ts
  letter_templates jsonb not null default '{}'::jsonb
    check (jsonb_typeof(letter_templates) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into org_settings (id) values (1);

alter table org_settings enable row level security;

create policy "Members read settings" on org_settings
  for select using ((select is_team_member()));
create policy "Admins update settings" on org_settings
  for update using ((select is_admin())) with check ((select is_admin()));

-- Program areas: the organization's own taxonomy for tagging grant
-- proposals and awards (e.g. "Education", "Health"). Referenced by slug.
create table program_areas (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9_-]*$'),
  label text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table program_areas enable row level security;

create policy "Members read program areas" on program_areas
  for select using ((select is_team_member()));
create policy "Admins manage program areas" on program_areas
  for all using ((select is_admin())) with check ((select is_admin()));

-- Validates a text[] of program-area slugs (used by CHECK-like triggers on
-- tables that tag records with program areas).
create or replace function assert_program_areas(slugs text[])
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  unknown text;
begin
  select s into unknown
  from unnest(coalesce(slugs, '{}')) as s
  where not exists (select 1 from program_areas pa where pa.slug = s)
  limit 1;
  if unknown is not null then
    raise exception 'Unknown program area: %', unknown using errcode = '23503';
  end if;
end;
$$;

-- Audit log: every write by a team member to a tracked table, plus
-- sign-ins and sign-outs. Readable by admins only.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_member_id uuid references team_members (id) on delete set null,
  actor_email text,
  actor_role text,
  event_type text not null,       -- e.g. 'contributions:insert', 'login'
  entity_type text,               -- table name, or 'session'
  entity_id uuid,
  summary text,
  metadata jsonb not null default '{}'
);

create index audit_log_time_idx on audit_log (occurred_at desc);
create index audit_log_actor_idx on audit_log (actor_member_id, occurred_at desc);

alter table audit_log enable row level security;

create policy "Admins read audit log" on audit_log
  for select using ((select is_admin()));

create or replace function log_record_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select id, email, role into m from team_members
  where auth_user_id = auth.uid() and is_active;
  if m.id is null then
    return coalesce(new, old);
  end if;
  insert into audit_log (actor_member_id, actor_email, actor_role, event_type, entity_type, entity_id)
  values (
    m.id,
    m.email,
    m.role,
    tg_table_name || ':' || lower(tg_op),
    tg_table_name,
    ((to_jsonb(coalesce(new, old)))->>'id')::uuid
  );
  return coalesce(new, old);
exception when others then
  -- Auditing must never block the write it describes
  return coalesce(new, old);
end;
$$;

create or replace function log_session_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select id, email, role into m from team_members
  where auth_user_id = coalesce(new.user_id, old.user_id);
  if m.id is null then
    return coalesce(new, old);
  end if;
  insert into audit_log (actor_member_id, actor_email, actor_role, event_type, entity_type)
  values (m.id, m.email, m.role, case when tg_op = 'INSERT' then 'login' else 'logout' end, 'session');
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);
end;
$$;

create trigger audit_session_login
  after insert on auth.sessions
  for each row execute function log_session_event();
create trigger audit_session_logout
  after delete on auth.sessions
  for each row execute function log_session_event();

-- Trigger-only functions should not be callable through the API
revoke execute on function log_record_write() from public, anon, authenticated;
revoke execute on function log_session_event() from public, anon, authenticated;
revoke execute on function link_team_member() from public, anon, authenticated;
revoke execute on function link_confirmed_team_member() from public, anon, authenticated;
revoke execute on function set_updated_at() from public, anon, authenticated;
