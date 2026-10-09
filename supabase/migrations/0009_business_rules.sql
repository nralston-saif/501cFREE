-- 0009: Business rules enforced in the database, so they hold for every
-- client (the app, the Supabase API, SQL by a signed-in user), not just the
-- app's own checks. Service-role sessions (cron, public intake, PDF
-- generation) have no auth.uid() and are trusted.

-- Blind grant review --------------------------------------------------------

-- True once every member of the voting body (is_grant_voter_member, set by
-- org_settings.grant_review_mode) has voted or recused on the proposal
create or replace function proposal_votes_in(p_proposal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from team_members m where is_grant_voter_member(m.id))
    and not exists (
      select 1 from team_members m
      where is_grant_voter_member(m.id)
        and not exists (
          select 1 from proposal_reviews r
          where r.proposal_id = p_proposal_id
            and r.reviewer_id = m.id
            and (r.recused or r.vote is not null)
        )
    );
$$;

-- Who has weighed in on each proposal (never how): powers the "2 of 3
-- votes in" progress while reviews are still hidden
create or replace function proposal_review_progress(p_proposal_ids uuid[])
returns table (proposal_id uuid, reviewer_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select r.proposal_id, r.reviewer_id
  from proposal_reviews r
  where is_team_member()
    and r.proposal_id = any (p_proposal_ids)
    and (r.recused or r.vote is not null);
$$;

-- Reveal automatically when the last voter weighs in. Runs inside the
-- reviewer's session, so it raises a transaction-local flag that tells
-- guard_proposal_changes this update is the reveal itself; the guard still
-- re-checks that every voter has weighed in.
create or replace function reveal_votes_when_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if proposal_votes_in(new.proposal_id) then
    perform set_config('app.revealing_votes', 'on', true);
    update grant_proposals
    set votes_revealed = true
    where id = new.proposal_id and not votes_revealed and status = 'in_review';
    perform set_config('app.revealing_votes', 'off', true);
  end if;
  return new;
end;
$$;

create trigger proposal_reviews_reveal
  after insert or update on proposal_reviews
  for each row execute function reveal_votes_when_complete();

-- Narrowing the voting body (all_members -> admins) can complete a vote
-- without anyone touching a review: reveal those proposals right away
create or replace function reveal_votes_after_mode_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.revealing_votes', 'on', true);
  update grant_proposals
  set votes_revealed = true
  where status = 'in_review' and not votes_revealed and proposal_votes_in(id);
  perform set_config('app.revealing_votes', 'off', true);
  return new;
end;
$$;

create trigger org_settings_grant_review_mode_reveal
  after update of grant_review_mode on org_settings
  for each row
  when (new.grant_review_mode is distinct from old.grant_review_mode)
  execute function reveal_votes_after_mode_change();

-- Proposal pipeline rules for signed-in users (the app's own transitions in
-- lib/actions/grants-out.ts):
--   anyone   received -> in_review (start review); received, in_review or
--            diligence -> withdrawn; create an internal proposal straight
--            in diligence (it skips review, so it starts revealed)
--   voters   everything else: advance to diligence, decide, decline at
--            review, and the decision fields. Voters are is_grant_voter():
--            every member, or only admins, per org_settings.grant_review_mode.
--            Making the award itself stays admin-only (grants_out policies).
-- votes_revealed is never set by hand, in either direction and at any
-- status: only the reveal above flips it. And a proposal enters review only
-- from 'received', so it can't be parked elsewhere and brought back.
create or replace function guard_proposal_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.votes_revealed and new.status in ('received', 'in_review') then
      raise exception 'Votes are revealed automatically once every reviewer has voted or recused';
    end if;
    if new.status not in ('received', 'diligence') and not is_grant_voter() then
      raise exception 'Only grant reviewers can advance or decide grant proposals';
    end if;
    if (new.decision is not null or new.decision_date is not null or new.declined_stage is not null)
       and not is_grant_voter() then
      raise exception 'Only grant reviewers can advance or decide grant proposals';
    end if;
    return new;
  end if;

  if new.votes_revealed is distinct from old.votes_revealed
     and not (
       current_setting('app.revealing_votes', true) = 'on'
       and new.votes_revealed
       and old.status = 'in_review'
       and new.status = 'in_review'
       and proposal_votes_in(new.id)
     ) then
    raise exception 'Votes are revealed automatically once every reviewer has voted or recused, and can''t be changed by hand';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'in_review' and old.status <> 'received' then
      raise exception 'Only new proposals can be moved into review';
    end if;
    if not is_grant_voter() and not (
      (old.status = 'received' and new.status = 'in_review')
      or (old.status in ('received', 'in_review', 'diligence') and new.status = 'withdrawn')
    ) then
      raise exception 'Only grant reviewers can advance or decide grant proposals';
    end if;
  end if;

  if not is_grant_voter()
     and (new.decision, new.decision_date, new.decision_notes, new.declined_stage)
         is distinct from (old.decision, old.decision_date, old.decision_notes, old.declined_stage) then
    raise exception 'Only grant reviewers can advance or decide grant proposals';
  end if;

  return new;
end;
$$;

create trigger grant_proposals_guard
  before insert or update on grant_proposals
  for each row execute function guard_proposal_changes();

-- Once the votes are revealed the reviews are the record: nobody can add,
-- change or delete one from a user session (deleting the whole proposal
-- still cascades)
create or replace function guard_revealed_reviews()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if exists (
    select 1 from grant_proposals p
    where p.votes_revealed
      and p.id in ((to_jsonb(new) ->> 'proposal_id')::uuid, (to_jsonb(old) ->> 'proposal_id')::uuid)
  ) then
    raise exception 'Votes on this proposal have been revealed, so reviews can no longer be changed';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger proposal_reviews_frozen_after_reveal
  before insert or update or delete on proposal_reviews
  for each row execute function guard_revealed_reviews();

-- Awards and disbursements: money fields are admin-only ---------------------

-- The team can record the agreement date and the award's status; the
-- amount, the grantee and the proposal it came from are set by admins
-- (createAward / recordDecision)
create or replace function guard_award_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;
  if (new.amount_awarded_cents, new.grantee_contact_id, new.proposal_id)
     is distinct from (old.amount_awarded_cents, old.grantee_contact_id, old.proposal_id) then
    raise exception 'Only admins can change an award''s amount or grantee';
  end if;
  return new;
end;
$$;

create trigger grants_out_money_guard
  before update on grants_out
  for each row execute function guard_award_changes();

-- The team can schedule a disbursement, edit a scheduled one's date and
-- method, and cancel it; paying it (markDisbursementPaid) and changing an
-- amount or payment date are admin actions. Only a scheduled disbursement
-- can become paid, for admins too (a cancelled one must be rescheduled first)
create or replace function guard_disbursement_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status = 'paid' and old.status <> 'scheduled' and old.status <> 'paid' then
    raise exception 'Only a scheduled disbursement can be marked paid';
  end if;

  if is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' or new.paid_date is not null then
      raise exception 'Only admins can record a disbursement as paid';
    end if;
    return new;
  end if;

  if (new.amount_cents, new.paid_date, new.grant_out_id)
     is distinct from (old.amount_cents, old.paid_date, old.grant_out_id) then
    raise exception 'Only admins can change a disbursement''s amount or payment';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'scheduled' and new.status = 'cancelled') then
    raise exception 'Only admins can record a disbursement as paid';
  end if;
  return new;
end;
$$;

create trigger disbursements_money_guard
  before insert or update on disbursements
  for each row execute function guard_disbursement_changes();

-- Program-related investments: funding gate ---------------------------------

create or replace function guard_pri_funding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  threshold bigint;
  memo pri_memos%rowtype;
  memo_attachment uuid;
begin
  if not (old.status = 'committed' and new.status <> 'committed') then
    return new;
  end if;

  select pri_board_approval_threshold_cents into threshold from org_settings where id = 1;
  if threshold is not null and new.amount_cents >= threshold and new.board_approval_date is null then
    raise exception 'Board approval is required before funding this PRI';
  end if;

  select * into memo from pri_memos where pri_id = new.id;
  if memo.id is null
     or coalesce(btrim(memo.q_exempt_purpose), '') = ''
     or coalesce(btrim(memo.q_why_investment), '') = ''
     or coalesce(btrim(memo.q_income_not_significant), '') = ''
     or coalesce(btrim(memo.q_use_of_funds), '') = ''
     or coalesce(btrim(memo.q_key_terms), '') = ''
     or coalesce(btrim(memo.q_success_outcomes), '') = ''
     or coalesce(btrim(memo.q_risks), '') = ''
     or coalesce(btrim(memo.q_exit_plan), '') = ''
     or coalesce(btrim(memo.q_conflicts), '') = ''
     or coalesce(btrim(memo.q_monitoring), '') = '' then
    raise exception 'The mission-alignment memo must be complete before funding this PRI';
  end if;

  -- The generated memo PDF is filed as an attachment too; it isn't the
  -- executed instrument
  select attachment_id into memo_attachment from pri_memo_pdfs where pri_id = new.id;
  if not exists (
    select 1 from attachments a
    where a.entity_type = 'pri' and a.entity_id = new.id
      and a.id is distinct from memo_attachment
  ) then
    raise exception 'Attach the executed instrument before funding this PRI';
  end if;

  return new;
end;
$$;

create trigger pris_funding_gate
  before update of status on pris
  for each row execute function guard_pri_funding();

-- Contributions with a sent acknowledgement letter are frozen -------------

create or replace function guard_acknowledged_contribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Bookkeeping fields that may still change after the letter is sent
  unlocked text[] := array['qbo_txn_type', 'qbo_txn_id', 'notes', 'updated_at'];
begin
  if not exists (
    select 1 from acknowledgement_letters
    where contribution_id = old.id and status = 'sent'
  ) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'This contribution has a sent acknowledgement letter and can''t be deleted';
  end if;

  if (to_jsonb(new) - unlocked) is distinct from (to_jsonb(old) - unlocked) then
    raise exception 'This contribution has a sent acknowledgement letter and can no longer be edited';
  end if;
  return new;
end;
$$;

create trigger contributions_acknowledged_lock
  before update or delete on contributions
  for each row execute function guard_acknowledged_contribution();

-- A sent acknowledgement letter is final -----------------------------------

-- The contribution lock above keys off the letter's status, so a sent
-- letter can't be regenerated, edited, reset or deleted from a user session
-- (that would lift the lock and let the gift change under the donor's
-- receipt). The one change allowed is recording a resend of the same PDF
-- ("Resend" in the app): a later sent_at with its recipient and message id.
create or replace function guard_sent_letter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resend_fields text[] := array['sent_to_email', 'sent_at', 'resend_message_id', 'updated_at'];
begin
  if auth.uid() is null or old.status <> 'sent' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'This acknowledgement letter was sent and can''t be deleted';
  end if;
  if (to_jsonb(new) - resend_fields) is distinct from (to_jsonb(old) - resend_fields) then
    raise exception 'This acknowledgement letter was sent and can no longer be changed';
  end if;
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at')
     and not (new.sent_at is not null and (old.sent_at is null or new.sent_at > old.sent_at)) then
    raise exception 'This acknowledgement letter was sent and can no longer be changed';
  end if;
  return new;
end;
$$;

create trigger acknowledgement_letters_sent_lock
  before update or delete on acknowledgement_letters
  for each row execute function guard_sent_letter();

-- Authors and creators are whoever is signed in -----------------------------

-- Stamps the signed-in member into the column named by the trigger
-- argument on insert, and keeps it from being reassigned later. Service-
-- role writes (cron, public intake) set it explicitly or leave it null.
-- proposal_comments and ticket_comments don't need this: their policies
-- already require author_id = current_member_id().
create or replace function stamp_current_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  col text := tg_argv[0];
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new := jsonb_populate_record(new, jsonb_build_object(col, current_member_id()));
  elsif (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
    raise exception '%.% can''t be changed', tg_table_name, col;
  end if;
  return new;
end;
$$;

create trigger stamp_author before insert or update of author_id on notes
  for each row execute function stamp_current_member('author_id');
create trigger stamp_creator before insert or update of created_by on tickets
  for each row execute function stamp_current_member('created_by');
create trigger stamp_creator before insert or update of created_by on meetings
  for each row execute function stamp_current_member('created_by');
create trigger stamp_creator before insert or update of created_by on note_intakes
  for each row execute function stamp_current_member('created_by');
create trigger stamp_creator before insert or update of created_by on contacts
  for each row execute function stamp_current_member('created_by');

-- Notes-inbox files live under their intake's folder ----------------------

-- Storage access to note files is decided by the folder ({intake_id}/...),
-- so a file row can't claim an object from someone else's intake
alter table note_intake_files
  add constraint note_intake_files_in_intake_folder
  check (split_part(storage_path, '/', 1) = intake_id::text);

-- Note attachments must come from the uploader's own notes-inbox files ------

create or replace function guard_note_attachment_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not exists (
    select 1
    from note_intake_files f
    join note_intakes i on i.id = f.intake_id
    where f.storage_path = new.storage_path
      and (i.created_by = current_member_id() or is_admin())
  ) then
    raise exception 'Attachments must be files from your own notes inbox';
  end if;
  return new;
end;
$$;

create trigger note_attachments_path_guard
  before insert or update of storage_path on note_attachments
  for each row execute function guard_note_attachment_path();

-- Helper functions are for policies and triggers, not for anonymous callers
revoke execute on function proposal_votes_in(uuid) from public, anon;
revoke execute on function proposal_review_progress(uuid[]) from public, anon;
revoke execute on function reveal_votes_when_complete() from public, anon, authenticated;
revoke execute on function reveal_votes_after_mode_change() from public, anon, authenticated;
revoke execute on function guard_proposal_changes() from public, anon, authenticated;
revoke execute on function guard_pri_funding() from public, anon, authenticated;
revoke execute on function guard_acknowledged_contribution() from public, anon, authenticated;
revoke execute on function guard_note_attachment_path() from public, anon, authenticated;
revoke execute on function guard_revealed_reviews() from public, anon, authenticated;
revoke execute on function guard_award_changes() from public, anon, authenticated;
revoke execute on function guard_disbursement_changes() from public, anon, authenticated;
revoke execute on function guard_sent_letter() from public, anon, authenticated;
revoke execute on function stamp_current_member() from public, anon, authenticated;
revoke execute on function note_file_owned(text) from public, anon;
revoke execute on function note_file_attached(text) from public, anon;
revoke execute on function assert_program_areas(text[]) from public, anon;
grant execute on function proposal_votes_in(uuid) to authenticated;
grant execute on function proposal_review_progress(uuid[]) to authenticated;
grant execute on function note_file_owned(text) to authenticated;
grant execute on function note_file_attached(text) to authenticated;
grant execute on function assert_program_areas(text[]) to authenticated;
