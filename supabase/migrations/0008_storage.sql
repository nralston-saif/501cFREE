-- 0008: Storage buckets and policies. All buckets are private; the app
-- serves files through short-lived signed URLs.
--
--   documents   attachments: {entity_type}/{entity_id}/{uuid}-{name},
--               bulk invoice uploads under expense-import/
--   letters     generated PDFs (acknowledgement letters, memoranda) and the
--               letter signature image (assets/signature)
--   note-files  notes-inbox uploads: {intake_id}/{uuid}-{name}; filed notes
--               keep pointing at the same objects via note_attachments

-- Size limits sit above the app's own per-upload limits (10 MB attachments,
-- 20 MB invoices and notes-inbox files) so they only stop uploads that go
-- around the app.
--
-- documents: 50 MB, no type allowlist. General attachments accept any
-- file (spreadsheets, Word documents, archives...) and browsers often
-- report an empty or generic type, so a list would break legitimate
-- uploads. Files are only ever served through signed download URLs.
-- letters: 25 MB; generated PDFs plus the PNG/JPEG signature image.
-- note-files: 25 MB; exactly the types lib/note-intake-core/formats.ts
-- accepts (the drop zone uploads with that content type).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 52428800, null),
  ('letters', 'letters', false, 26214400, array['application/pdf', 'image/png', 'image/jpeg']),
  ('note-files', 'note-files', false, 26214400, array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'text/plain', 'text/markdown', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ])
on conflict (id) do nothing;

-- documents: open to the team, except expense receipts and invoice
-- uploads, which follow expense access (admins only). The helper calls are
-- wrapped in (select ...) so Postgres evaluates them once per statement,
-- not once per object.
create policy "documents read" on storage.objects
  for select using (
    bucket_id = 'documents' and (select is_team_member())
    and ((storage.foldername(name))[1] not in ('expense', 'expense-import') or (select is_admin()))
  );
create policy "documents insert" on storage.objects
  for insert with check (
    bucket_id = 'documents' and (select is_team_member())
    and ((storage.foldername(name))[1] not in ('expense', 'expense-import') or (select is_admin()))
  );
create policy "documents update" on storage.objects
  for update using (
    bucket_id = 'documents' and (select is_team_member())
    and ((storage.foldername(name))[1] not in ('expense', 'expense-import') or (select is_admin()))
  );
create policy "documents delete" on storage.objects
  for delete using (
    bucket_id = 'documents' and (select is_team_member())
    and ((storage.foldername(name))[1] not in ('expense', 'expense-import') or (select is_admin()))
  );

-- letters: the team can read; only admins write from a user session (the
-- app generates letters and memoranda with the service role, so a sent
-- letter's PDF and the signature image can't be swapped by other members)
create policy "letters read" on storage.objects
  for select using (bucket_id = 'letters' and (select is_team_member()));
create policy "letters insert" on storage.objects
  for insert with check (bucket_id = 'letters' and (select is_admin()));
create policy "letters update" on storage.objects
  for update using (bucket_id = 'letters' and (select is_admin()));
create policy "letters delete" on storage.objects
  for delete using (bucket_id = 'letters' and (select is_admin()));

-- note-files: an upload belongs to its intake; the uploader (or an admin)
-- can see it while it's in the inbox, and the whole team can see it once
-- it's attached to a filed note
create or replace function note_file_owned(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from note_intakes i
    where i.id::text = (storage.foldername(object_name))[1]
      and (i.created_by = current_member_id() or is_admin())
  );
$$;

create or replace function note_file_attached(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from note_attachments a where a.storage_path = object_name);
$$;

create policy "note files read" on storage.objects
  for select using (
    bucket_id = 'note-files' and (select is_team_member())
    and (note_file_owned(name) or note_file_attached(name))
  );
create policy "note files insert" on storage.objects
  for insert with check (bucket_id = 'note-files' and (select is_team_member()) and note_file_owned(name));
create policy "note files delete" on storage.objects
  for delete using (bucket_id = 'note-files' and (select is_team_member()) and note_file_owned(name));
