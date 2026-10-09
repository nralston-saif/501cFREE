-- 0010: Read-only summaries the pages need as totals or per-record counts.
--
-- PostgREST caps every response at max_rows (1000 by default), so a page
-- that loads a whole table to add it up in JavaScript silently undercounts
-- once the table grows. These functions do the arithmetic in Postgres and
-- return one row (or one row per key).
--
-- All are SECURITY INVOKER (the default): they run with the caller's RLS,
-- so a staff member's expense totals are 0 exactly as a direct select of
-- expenses would be. Set-returning ones can be paged like a table
-- (`.rpc(...).order(key).range(...)`, see lib/supabase/fetch-all.ts).
-- The demo client implements each one in lib/supabase/demo/mock-client.ts.

-- Dashboard stat cards for one fiscal year [p_start, p_end): cash and stock
-- contributions (in-kind has no amount), expenses, and grant disbursements
-- paid.
create or replace function fiscal_year_totals(p_start date, p_end date)
returns table (contributions_cents bigint, expenses_cents bigint, grants_paid_cents bigint)
language sql
stable
set search_path = public
as $$
  select
    (select coalesce(sum(c.amount_cents), 0)::bigint
       from contributions c
      where c.received_date >= p_start and c.received_date < p_end
        and c.method <> 'in_kind' and c.amount_cents is not null),
    (select coalesce(sum(e.amount_cents), 0)::bigint
       from expenses e
      where e.expense_date >= p_start and e.expense_date < p_end),
    (select coalesce(sum(d.amount_cents), 0)::bigint
       from disbursements d
      where d.status = 'paid' and d.paid_date >= p_start and d.paid_date < p_end);
$$;

-- Contributions page summary for [p_start, p_end): cash gifts (everything
-- but stock and in-kind) and stock gifts at their recorded FMV.
create or replace function contribution_summary(p_start date, p_end date)
returns table (cash_cents bigint, cash_count bigint, stock_cents bigint, stock_count bigint)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(c.amount_cents) filter (where c.method not in ('in_kind', 'stock')), 0)::bigint,
    count(*) filter (where c.method not in ('in_kind', 'stock')),
    coalesce(sum(c.amount_cents) filter (where c.method = 'stock'), 0)::bigint,
    count(*) filter (where c.method = 'stock')
  from contributions c
  where c.received_date >= p_start and c.received_date < p_end;
$$;

-- Expenses page summary: totals for [p_start, p_end) by functional class,
-- and everything still unpaid (status 'pending') regardless of date.
create or replace function expense_summary(p_start date, p_end date)
returns table (
  total_cents bigint,
  program_cents bigint,
  management_general_cents bigint,
  fundraising_cents bigint,
  unpaid_count bigint,
  unpaid_cents bigint
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(e.amount_cents) filter (where in_range), 0)::bigint,
    coalesce(sum(e.amount_cents) filter (where in_range and c.functional_class = 'program'), 0)::bigint,
    coalesce(sum(e.amount_cents) filter (where in_range and c.functional_class = 'management_general'), 0)::bigint,
    coalesce(sum(e.amount_cents) filter (where in_range and c.functional_class = 'fundraising'), 0)::bigint,
    count(*) filter (where e.status = 'pending'),
    coalesce(sum(e.amount_cents) filter (where e.status = 'pending'), 0)::bigint
  from expenses e
  left join expense_categories c on c.id = e.category_id
  cross join lateral (select e.expense_date >= p_start and e.expense_date < p_end as in_range) r;
$$;

-- Money tied to each contact: grants awarded to it, contributions it gave
-- (any method with an amount), and PRIs it received. Only contacts with at
-- least one record are returned; p_kind ('person' / 'organization')
-- narrows to one kind.
create or replace function contact_money_totals(p_kind text default null)
returns table (contact_id uuid, granted_cents bigint, donated_cents bigint, pri_cents bigint)
language sql
stable
set search_path = public
as $$
  select t.contact_id,
         coalesce(sum(t.granted), 0)::bigint,
         coalesce(sum(t.donated), 0)::bigint,
         coalesce(sum(t.pri), 0)::bigint
  from (
    select g.grantee_contact_id as contact_id, g.amount_awarded_cents as granted,
           null::bigint as donated, null::bigint as pri
      from grants_out g
    union all
    select c.contact_id, null, c.amount_cents, null from contributions c
    union all
    select p.recipient_contact_id, null, null, p.amount_cents from pris p
  ) t
  where p_kind is null
     or exists (select 1 from contacts k where k.id = t.contact_id and k.kind = p_kind)
  group by t.contact_id;
$$;

-- Distinct notes linked to each contact (contacts with no notes are left out)
create or replace function contact_note_counts()
returns table (contact_id uuid, note_count bigint)
language sql
stable
set search_path = public
as $$
  select l.entity_id, count(distinct l.note_id)
  from note_links l
  where l.entity_type = 'contact'
  group by l.entity_id;
$$;

-- How many of the ten grant-memo sections (lib/grants/memo.ts) have an
-- answer with at least one non-space character, per proposal. Proposals
-- without a memo are left out (0 answered).
create or replace function proposal_memo_progress(p_proposal_ids uuid[])
returns table (proposal_id uuid, answered integer)
language sql
stable
set search_path = public
as $$
  select m.proposal_id,
         (coalesce(m.q_summary_recommendation, '') ~ '\S')::int
       + (coalesce(m.q_org_background, '') ~ '\S')::int
       + (coalesce(m.q_cause_area_fit, '') ~ '\S')::int
       + (coalesce(m.q_theory_of_change, '') ~ '\S')::int
       + (coalesce(m.q_grant_size_structure, '') ~ '\S')::int
       + (coalesce(m.q_counterfactual, '') ~ '\S')::int
       + (coalesce(m.q_success_disappointment, '') ~ '\S')::int
       + (coalesce(m.q_risks_mitigations, '') ~ '\S')::int
       + (coalesce(m.q_legal_compliance, '') ~ '\S')::int
       + (coalesce(m.q_monitoring_evaluation, '') ~ '\S')::int
  from proposal_memos m
  where m.proposal_id = any (p_proposal_ids);
$$;

revoke execute on function fiscal_year_totals(date, date) from public, anon;
revoke execute on function contribution_summary(date, date) from public, anon;
revoke execute on function expense_summary(date, date) from public, anon;
revoke execute on function contact_money_totals(text) from public, anon;
revoke execute on function contact_note_counts() from public, anon;
revoke execute on function proposal_memo_progress(uuid[]) from public, anon;
grant execute on function fiscal_year_totals(date, date) to authenticated;
grant execute on function contribution_summary(date, date) to authenticated;
grant execute on function expense_summary(date, date) to authenticated;
grant execute on function contact_money_totals(text) to authenticated;
grant execute on function contact_note_counts() to authenticated;
grant execute on function proposal_memo_progress(uuid[]) to authenticated;
