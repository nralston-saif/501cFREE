-- 0100: Remove the team activity log.
--
-- Owner decision: the product no longer records what individual team members
-- do. v0.1.0 kept an audit_log table filled by triggers (every write to ~34
-- tables, plus sign-ins and sign-outs on auth.sessions) and showed it under
-- Settings → Activity. This migration removes all of it.
--
-- Shipped migrations are never edited, so 0001 (audit_log, log_record_write(),
-- log_session_event(), the auth.sessions triggers) and 0090 (the audit_write
-- triggers) still create these objects; this file drops them again. On an
-- existing v0.1.0 database it removes them and their recorded rows; on a fresh
-- install (setup.sql) they are created and immediately dropped. Every
-- statement is idempotent, so running it twice is harmless.
--
-- Not affected: team_members, roles, set_updated_at triggers and every other
-- trigger and table.

-- 1. The per-table write triggers from 0090 (any table that has one, so a
--    table an installation added itself with the same trigger is covered too)
do $$
declare
  t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where tg.tgname = 'audit_write'
      and not tg.tgisinternal
  loop
    execute format('drop trigger if exists audit_write on %I.%I', t.schema_name, t.table_name);
  end loop;
end;
$$;

-- 2. The sign-in / sign-out triggers on Supabase Auth's sessions table (0001)
drop trigger if exists audit_session_login on auth.sessions;
drop trigger if exists audit_session_logout on auth.sessions;

-- 3. The trigger functions (nothing calls them once the triggers are gone)
drop function if exists log_record_write();
drop function if exists log_session_event();

-- 4. The log itself, with its indexes, policy and recorded events
drop table if exists audit_log;
