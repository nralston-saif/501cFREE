-- 0002: Contacts (people and organizations), affiliations, notes, the notes
-- inbox, meetings, tags and tickets.
--
-- One contacts table holds both people and organizations so every other
-- table (contributions, expenses, grants, PRIs, notes, meetings, tickets)
-- has a single foreign-key target.

create table contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('person', 'organization')),

  -- Naming. Organizations use name; people use first/last name, with name
  -- as an optional full-name override (e.g. "Dr. Jane Q. Smith").
  name text,
  first_name text,
  last_name text,
  display_name text generated always as (
    case
      when kind = 'organization' then name
      else coalesce(
        nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
        name
      )
    end
  ) stored,

  -- Roles this contact plays for the organization. A contact can be several.
  is_donor boolean not null default false,
  is_grantee boolean not null default false,
  is_funder boolean not null default false,
  is_vendor boolean not null default false,
  is_lead boolean not null default false,   -- a potential grantee

  -- Contact info
  email text,
  alternative_emails text[] not null default '{}',
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,

  -- People
  title text,
  linkedin_url text,

  -- Organizations
  website text,
  description text,                  -- also a person's short bio

  -- Logo (organizations) or photo (people), in the documents bucket under
  -- contact-images/{contact_id}/
  image_path text,
  twitter_url text,
  entity_type text check (entity_type in ('nonprofit', 'for_profit', 'pbc', 'government', 'other')),
  previous_names text[] not null default '{}',

  -- Tax and compliance (grantees, vendors)
  legal_name text,
  tax_id text,                       -- EIN for organizations; needed for 990 Schedule I
  tax_status text check (tax_status in (
    '501c3_public_charity', '501c3_private_foundation', 'other_nonprofit',
    'government', 'for_profit', 'individual'
  )),
  w9_on_file boolean not null default false,
  qbo_vendor_id text,

  notes text,
  tags text[] not null default '{}',

  -- Relationship history
  introduced_by uuid references contacts (id) on delete set null,
  first_met_date date,
  how_we_met text,
  relationship_notes text,
  is_active boolean not null default true,
  created_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint contacts_named check (display_name is not null and btrim(display_name) <> ''),
  constraint contacts_person_fields check (
    kind = 'person' or (first_name is null and last_name is null and title is null and linkedin_url is null)
  )
);

create index contacts_display_name_idx on contacts (display_name);
create index contacts_display_name_trgm on contacts using gin (display_name extensions.gin_trgm_ops);
create index contacts_email_idx on contacts (lower(email));
create index contacts_kind_idx on contacts (kind);

-- People belong to organizations
create table affiliations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references contacts (id) on delete cascade,
  organization_id uuid not null references contacts (id) on delete cascade,
  relationship text not null default 'contact'
    check (relationship in ('contact', 'employee', 'founder', 'executive', 'board_member', 'advisor', 'other')),
  title text,
  is_primary_contact boolean not null default false,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, organization_id, relationship)
);

create index affiliations_org_idx on affiliations (organization_id);

create or replace function check_affiliation_kinds()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select kind from contacts where id = new.person_id) <> 'person' then
    raise exception 'affiliations.person_id must reference a person contact';
  end if;
  if (select kind from contacts where id = new.organization_id) <> 'organization' then
    raise exception 'affiliations.organization_id must reference an organization contact';
  end if;
  return new;
end;
$$;

create trigger affiliations_check_kinds
  before insert or update of person_id, organization_id on affiliations
  for each row execute function check_affiliation_kinds();

-- A contact can't switch between person and organization once affiliated
create or replace function prevent_affiliated_kind_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind <> old.kind and exists (
    select 1 from affiliations where person_id = new.id or organization_id = new.id
  ) then
    raise exception 'Remove this contact''s affiliations before changing it between person and organization';
  end if;
  return new;
end;
$$;

create trigger contacts_kind_change
  before update of kind on contacts
  for each row execute function prevent_affiliated_kind_change();

-- Notes ---------------------------------------------------------------------

create table notes (
  id uuid primary key default gen_random_uuid(),
  content text not null,             -- sanitized HTML
  note_date date not null default current_date,
  author_id uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_date_idx on notes (note_date desc);

-- A note can be linked to several records; one link is primary
create table note_links (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes (id) on delete cascade,
  entity_type text not null check (entity_type in ('contact', 'meeting', 'grant_proposal', 'pri')),
  entity_id uuid not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (note_id, entity_type, entity_id)
);

create index note_links_entity_idx on note_links (entity_type, entity_id);

create table note_attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes (id) on delete cascade,
  storage_path text not null,        -- in the note-files bucket
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now()
);

create index note_attachments_note_idx on note_attachments (note_id);

-- Notes inbox: uploaded files an AI pass turns into proposed notes, which a
-- person reviews before anything is saved.
create table note_intakes (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references team_members (id),
  status text not null default 'uploading'
    check (status in ('uploading', 'processing', 'ready', 'filed', 'failed')),
  proposal jsonb,                    -- the AI's proposal, as returned
  draft jsonb,                       -- the reviewer's in-progress edits
  model text,
  error text,
  note_ids uuid[] not null default '{}',
  processing_started_at timestamptz,
  processed_at timestamptz,
  filed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index note_intakes_creator_idx on note_intakes (created_by, created_at desc);

create table note_intake_files (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references note_intakes (id) on delete cascade,
  storage_path text not null,        -- in the note-files bucket: {intake_id}/{uuid}-{name}
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index note_intake_files_intake_idx on note_intake_files (intake_id);

-- Meetings ------------------------------------------------------------------

create table meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  meeting_date timestamptz not null,
  content text,                      -- notes body (HTML); live-edited via Liveblocks when configured
  created_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meetings_date_idx on meetings (meeting_date desc);

create table meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  created_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (meeting_id, contact_id)
);

create index meeting_attendees_contact_idx on meeting_attendees (contact_id);

-- Tags and tickets ----------------------------------------------------------

create table tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  color text,
  usage_count integer not null default 0,
  created_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type ticket_status as enum ('open', 'in_progress', 'review', 'closed');
create type ticket_priority as enum ('high', 'medium', 'low');

create table tickets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  description text,
  status ticket_status not null default 'open',
  priority ticket_priority not null default 'medium',
  due_date date,
  assigned_to uuid references team_members (id) on delete set null,
  created_by uuid references team_members (id) on delete set null,
  contact_id uuid references contacts (id) on delete set null,
  tags text[] not null default '{}',
  is_flagged boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tickets_status_idx on tickets (status);
create index tickets_assignee_idx on tickets (assigned_to);

create or replace function set_ticket_closed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    new.closed_at = now();
  elsif new.status <> 'closed' then
    new.closed_at = null;
  end if;
  return new;
end;
$$;

create trigger tickets_closed_at
  before insert or update of status on tickets
  for each row execute function set_ticket_closed_at();

create table ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets (id) on delete cascade,
  author_id uuid not null references team_members (id),
  content text not null check (btrim(content) <> ''),
  is_resolution boolean not null default false,  -- the closing comment
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ticket_comments_ticket_idx on ticket_comments (ticket_id, created_at);

-- Row-level security --------------------------------------------------------

alter table contacts enable row level security;
alter table affiliations enable row level security;
alter table notes enable row level security;
alter table note_links enable row level security;
alter table note_attachments enable row level security;
alter table note_intakes enable row level security;
alter table note_intake_files enable row level security;
alter table meetings enable row level security;
alter table meeting_attendees enable row level security;
alter table tags enable row level security;
alter table tickets enable row level security;
alter table ticket_comments enable row level security;

create policy "Members full access" on contacts
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on affiliations
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on notes
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on note_links
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on note_attachments
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on meetings
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on meeting_attendees
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on tags
  for all using ((select is_team_member())) with check ((select is_team_member()));
create policy "Members full access" on tickets
  for all using ((select is_team_member())) with check ((select is_team_member()));

-- Notes-inbox items are private to their uploader until filed (admins see all)
create policy "Own intakes" on note_intakes
  for all using ((select is_team_member()) and (created_by = (select current_member_id()) or (select is_admin())))
  with check ((select is_team_member()) and (created_by = (select current_member_id()) or (select is_admin())));
create policy "Own intake files" on note_intake_files
  for all using (exists (
    select 1 from note_intakes i
    where i.id = intake_id and (select is_team_member()) and (i.created_by = (select current_member_id()) or (select is_admin()))
  ))
  with check (exists (
    select 1 from note_intakes i
    where i.id = intake_id and (select is_team_member()) and (i.created_by = (select current_member_id()) or (select is_admin()))
  ));

-- Ticket comments: everyone reads, authors write their own
create policy "Members read comments" on ticket_comments
  for select using ((select is_team_member()));
create policy "Authors insert own comments" on ticket_comments
  for insert with check ((select is_team_member()) and author_id = (select current_member_id()));
create policy "Authors update own comments" on ticket_comments
  for update using (author_id = (select current_member_id())) with check (author_id = (select current_member_id()));
create policy "Authors delete own comments" on ticket_comments
  for delete using (author_id = (select current_member_id()));

-- Meetings are co-edited live
alter publication supabase_realtime add table meetings;
