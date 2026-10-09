-- 0090: Cross-cutting triggers, applied after every table exists.

-- updated_at on every table that has the column
do $$
declare
  t record;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'updated_at'
      and tb.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger set_updated_at before update on %I for each row execute function set_updated_at()',
      t.table_name
    );
  end loop;
end;
$$;

-- Audit every team-member write to these tables (see audit_log in 0001)
do $$
declare
  t text;
begin
  foreach t in array array[
    -- contacts and CRM
    'contacts', 'affiliations', 'notes', 'note_links', 'note_attachments',
    'meetings', 'meeting_attendees', 'tickets', 'ticket_comments',
    -- fundraising
    'contributions', 'acknowledgement_letters', 'stock_contribution_details',
    'donation_inquiries',
    -- expenses and files
    'expenses', 'expense_categories', 'attachments',
    -- grantmaking
    'grant_proposals', 'proposal_reviews', 'proposal_comments', 'proposal_memos',
    'grant_research', 'grant_memo_pdfs', 'grants_out', 'disbursements', 'grantee_reports',
    -- PRIs
    'pris', 'pri_memos', 'pri_research', 'pri_memo_pdfs',
    -- administration
    'team_members', 'org_settings', 'program_areas', 'qbo_mappings', 'qbo_sync_state'
  ]
  loop
    execute format(
      'create trigger audit_write after insert or update or delete on %I for each row execute function log_record_write()',
      t
    );
  end loop;
end;
$$;

-- note_links point at several tables without a foreign key; clean them up
-- when the linked record is deleted
create or replace function delete_note_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from note_links where entity_type = tg_argv[0] and entity_id = old.id;
  return old;
end;
$$;

revoke execute on function delete_note_links() from public, anon, authenticated;

create trigger delete_note_links after delete on contacts
  for each row execute function delete_note_links('contact');
create trigger delete_note_links after delete on meetings
  for each row execute function delete_note_links('meeting');
create trigger delete_note_links after delete on grant_proposals
  for each row execute function delete_note_links('grant_proposal');
create trigger delete_note_links after delete on pris
  for each row execute function delete_note_links('pri');

-- Same for attachments on contacts (the other polymorphic owners are
-- financial records that are rarely deleted and keep their files)
create or replace function delete_contact_attachments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from attachments where entity_type = 'contact' and entity_id = old.id;
  return old;
end;
$$;

revoke execute on function delete_contact_attachments() from public, anon, authenticated;

create trigger delete_contact_attachments after delete on contacts
  for each row execute function delete_contact_attachments();
