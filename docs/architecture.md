# Architecture

One Next.js 16 App Router application on one Supabase project (Postgres, Auth, Storage). TypeScript strict mode, Tailwind 4. One organization per installation; no multi-tenancy.

See [features.md](features.md) for each feature area and [glossary.md](glossary.md) for the tax terms.

## Layout

```
proxy.ts                  request gate: auth redirect + per-request CSP nonce (Next 16 "proxy", formerly middleware)
next.config.ts            basePath, security headers, 10 MB server-action body limit
vercel.json               cron schedules
app/
  layout.tsx              root layout (reads headers() so pages render per request, which the CSP nonce needs)
  (app)/                  signed-in pages; layout.tsx requires an active team member
    page.tsx              dashboard
    contributions/ inquiries/                 donations
    grants-out/ pris/ portfolio/              grantmaking
    expenses/ banking/ reports/               finance (admin-only layout.tsx in each)
    organizations/ people/ notes-inbox/       CRM
    contacts/                                 redirects only (old links → organizations/people)
    meetings/ tickets/ settings/ account/
  api/                    route handlers, only for what server actions can't do:
    cron/                 scheduled jobs (CRON_SECRET)
    public/               website form intake (shared secrets)
    quickbooks/           OAuth connect + callback
    letters/ exports/ proposals/*/memorandum, pris/*/memorandum   file streaming
    proposals/*/research, pris/*/research, proposals/*/decline-email, invoices/extract,
    note-intake/*/process  AI work
    search/               global search
    liveblocks-auth/      room tokens for live meeting notes
    demo-files/           demo-mode file serving
  auth/  login/  access-denied/   sign-in, invite and password flows
components/               shared UI (ActionForm, SubmitButton, NavShell, SearchModal, ContactNotes, ...)
  crm/                    Organizations/People building blocks; crm/notes/ is the notes composer + timeline
  meetings/               live (Liveblocks + TipTap) editor
lib/
  actions/                server actions: every write goes through here
  auth.ts                 getAuthState()
  settings.ts             getOrgSettings(), orgToday(), orgName()
  supabase/               server/browser/admin clients, middleware helper, types, demo/
  security/               sanitize-html, constant-time secret compare
  grants/ pris/ contacts/ invoices/ note-intake-core/ note-intake/ quickbooks/ pdf/ market/ exports/ ...
                          domain logic, mostly pure and unit-tested
  ai/                     model ids, organization context for prompts
  utils/                  money, dates, fiscal year, tax-status labels
scripts/
  onboard.mjs             `pnpm onboard`: guided setup (writes .env.local, checks keys and auth settings, creates the first admin)
  bootstrap-admin.mjs     `pnpm bootstrap-admin`: adds an admin and emails an invite
  bundle-migrations.mjs   `pnpm db:bundle`: regenerates supabase/setup.sql
  lib/setup-helpers.mjs   their pure helpers (unit-tested)
supabase/migrations/      the schema (the source of truth)
supabase/setup.sql        every migration in one file, for a single paste into the SQL editor (generated)
supabase/tests/           PGlite database tests
```

## Request and data flow

| Step | How |
|---|---|
| Every request | `proxy.ts` builds a CSP with a fresh nonce and passes it on the request and the response. In live mode it calls `updateSession()` (`lib/supabase/middleware.ts`), which refreshes the session cookie and redirects signed-out users to `/login?next=...` (public paths: `/login`, `/auth`, `/_next`, `/access-denied`). |
| API routes | `proxy.ts` rejects `/api/*` requests that carry no Supabase session cookie with 401, except `/api/public/`, `/api/cron/` and `/api/demo-files`. Each route then does its own check (`getAuthState()`, a shared secret, or `isAuthorizedCronRequest()`). |
| Reads | Server components call `createClient()` (`lib/supabase/server.ts`): the publishable key plus the user's cookies, so RLS applies. They pass plain props to client components. |
| Writes | Client components call server actions in `lib/actions/`. Each action checks the member (`requireMemberId()` / `requireAdminId()`), writes with the RLS client, and calls `revalidatePath()`. |
| Background work | `after()` runs work after the response: the notes-inbox AI pass (`app/api/note-intake/[id]/process/route.ts`) and QuickBooks pushes after an expense is saved. Inside `after()`, use `createClientSnapshot()`, which reads cookies up front. Grant and PRI research hold the request open instead (up to `maxDuration = 800`). |
| Service role | `createAdminClient()` (`lib/supabase/admin.ts`, `server-only`, uses `SUPABASE_SECRET_KEY`) bypasses RLS. Used for: cron jobs, public intake, writing letter/memo PDFs and the signature to storage, downloading them for email, team invites (`auth.admin`), and a few cleanups a user session can't do (for example removing orphaned note files). |

### Server-action results

Next.js strips the message of any error thrown out of a server action in production (the browser gets a generic digest; `pnpm dev` shows the real text, so the bug hides locally). So actions return failures.

| Piece | File | Role |
|---|---|---|
| `ActionError` | `lib/actions/result.ts` | A message safe to show the user. Throw it inside actions. |
| `runAction(fn)` | same | Wraps an action body. Returns `ActionResult<T>` = `{ ok: true, data } \| { ok: false, error }`. Rethrows `redirect()`/`notFound()` with `unstable_rethrow`. Non-`ActionError` errors are logged and become `GENERIC_ACTION_ERROR`. |
| `actionErrorMessage(err, fallback)` | same | Same conversion for actions that build their own result shape. |
| `unwrap(result)` | same | Client side: returns `data`, or throws a plain `Error(message)` for `try/catch` + toast code. Tolerates actions that redirect and return nothing. |
| `unwrapAction(result)` | same | Server side, action-to-action: re-raises a failure as `ActionError` (used by `acceptPriFunding` → `markPriFunded`). |
| `ActionForm` | `components/ActionForm.tsx` | Replaces `<form action={serverAction}>`. Toasts the error and keeps the input; resets and optionally toasts on success. |
| `SubmitButton` | `components/SubmitButton.tsx` | Shows `pendingLabel` while an `ActionForm` (via context) or a plain form (`useFormStatus`) is submitting. |
| Guard test | `lib/actions/server-actions-guard.test.ts` | Fails when a throw, `requireMemberId`, `requireAdminId` or `requiredString` in an exported action isn't inside `runAction`, `asState` or `try`. |

Other result shapes, all built with `try/catch` + `actionErrorMessage`:
- `{ ok: true, ...fields } | { ok: false, error }`: `contacts.ts`, `crm-create.ts`, `notes.ts`, `meetings.ts`, `tickets.ts`, `note-intake.ts`, `invoice-uploads.ts`.
- `{ html } | { error }`: `documents.ts` (`previewDocx`).
- `{ error: string | null, ok: boolean }` for React `useActionState`: `settings.ts` (local `asState()`), `team.ts`, `account.ts`. These forms use `<form action={formAction}>` from `useActionState`, which is fine because the action never throws.

## Loading data

PostgREST returns at most `max_rows` rows per request (1000 on Supabase, configurable; don't lower it below 1000). A capped response has no error and no marker, so a page that loads a whole table to total it, count it or look up names silently goes wrong once the table grows. The rules:

| Need | Do | Example |
|---|---|---|
| A count | Head-only count with the filter in SQL | `.select('id', { count: 'exact', head: true }).eq('status', 'pending')` (dashboard, banking tabs, grants board tabs) |
| A total or per-record aggregate | A summary function in `supabase/migrations/0010_summaries.sql`, via `rpc()` | `fiscal_year_totals` (dashboard), `contribution_summary`, `expense_summary`, `contact_money_totals` (organizations), `contact_note_counts` (people), `proposal_memo_progress` (diligence tab) |
| Names or parent fields | A foreign-key embed naming the FK column | `contact:contacts!contact_id(display_name)`; one-to-many: `disbursements:disbursements!grant_out_id(amount_cents, status)` |
| Rows by a list of ids | `fetchByKeys(ids, (chunk) => query.in('id', chunk))` | 150 ids per request, so the URL stays short |
| The whole list | `fetchAll(() => query.order(...).order('id'))` | Reports, CSV exports, contact pickers, people/organizations lists, the awards ledger |

- `fetchAll` (`lib/supabase/fetch-all.ts`) requests pages with `.range()` until one comes back short, and throws on an error instead of returning a partial list. The query must end with an ordering on a unique column, or pages can overlap. It works on `rpc()` results too. **Reports and exports must be complete**, so every row set there goes through it (`lib/reports/finance.ts` holds the loaders the Reports page and `app/api/exports/[report]/route.ts` share).
- Only the top level of a response is capped; embedded arrays come back whole. Embedded selects aren't typed by the hand-written types, so cast the rows. When the embedded side's FK column is unique (`grants_out.proposal_id`, `acknowledgement_letters.contribution_id`), PostgREST returns an object rather than an array while the demo mock returns an array; read it with `oneEmbed()` (`lib/reports/embed.ts`) or handle both.
- Summary functions are `SECURITY INVOKER`, so RLS applies: a staff member's expense total is 0, exactly as their direct select would be. Each has a demo twin in `lib/supabase/demo/functions.ts`.
- Select only the columns a page renders. Load only the active tab (Grants, Banking) and count the others.
- **One wave per page.** Start independent queries together in a `Promise.all`. A query that needs another's result chains off that promise inside the same `Promise.all` (the dashboard's fiscal-year queries wait only for the settings row; the proposal page's contact picker waits only for the proposal). `getOrgSettings()` and `getAuthState()` are loaded once per request whoever calls them.
- **Streaming.** Every heavy section has a `loading.tsx` built from `components/PageSkeleton.tsx`, and `app/(app)/loading.tsx` covers the rest, so the nav stays responsive while a page loads. Async server components rendered inside a page (`CreateTicketButton`, `ContactNotes`, `QuickBooksCard`) sit behind their own `<Suspense>`, so their queries neither wait for the page's data nor hold the page back.
- **Bundles.** The notes editor (TipTap) loads with `next/dynamic` (`components/crm/notes/LazyRichTextEditor.tsx`), out of the first JavaScript of contact, proposal and PRI pages. The notes-inbox page imports only `lib/note-intake-core/config.ts` for its enabled check; the pipeline in `lib/note-intake-core/server.ts` (Anthropic SDK, sharp, mammoth, xlsx) is imported only by `app/api/note-intake/[id]/process/route.ts`, dynamically inside `after()`.
- **Indexes** match the hot filters: `disbursements (status, scheduled_date)` and `(status, paid_date)`, `qbo_inbox (status, txn_date desc)`, `grant_proposals (status, received_date desc)`, plus the date and FK indexes in each domain migration.

## Auth and roles

- **Whitelist.** `team_members` (email, `full_name`, `role` `admin`/`staff`, `is_active`, `auth_user_id`) is the sign-in list. The `on_auth_user_created` trigger (`link_team_member()`, `0001_core.sql`) rejects any auth user whose email isn't on it, and links `auth_user_id` only when the user was invited (`invited_at`) or has a confirmed email. `on_auth_user_confirmed` links an unconfirmed sign-up once it confirms. A team email alone can't claim a seat.
- **At least one active admin** always exists (`keep_an_active_admin` trigger).
- **Roles.** Admin: everything, including expenses, Banking/QuickBooks, Reports and exports, Settings (team), making awards and paying disbursements. Staff: everything else.
- **Grant reviewers.** Who votes on, advances and decides proposals is `org_settings.grant_review_mode`: `all_members` (default, every active member) or `admins`. SQL: `grant_review_mode()`, `is_grant_voter_member(id)`, `is_grant_voter()` (`0005_grantmaking.sql`); app: `isVotingMember()` (`lib/grants/voting.ts`) and `requireGrantVoterId()` (`lib/actions/helpers.ts`).
- **SQL helpers** (`0001_core.sql`, `SECURITY DEFINER`): `is_team_member()`, `is_admin()`, `current_member_id()`. Policies use them, always wrapped as `(select is_team_member())` so Postgres evaluates each once per statement (an init plan) instead of once per row; the meaning is the same. A test in `schema.test.ts` ("policy performance") fails on a bare call. Helpers that take a column (`note_file_owned(name)`) are per row by nature.
- **`getAuthState()`** (`lib/auth.ts`, cached per request with React `cache`): validates the JWT locally with `getClaims()` (no auth-server round trip), then reads the active `team_members` row. Returns `{ userId, memberId, memberRole, isAdmin, memberName }`.
- **`requireMemberId()` / `requireAdminId()`** (`lib/actions/helpers.ts`) throw `ActionError` ("Not authenticated", "Not an active team member", "Only admins can do this").
- **Page gates.** `app/(app)/layout.tsx` redirects to `/login` (no user) or `/access-denied` (not an active member). `layout.tsx` files in `expenses/`, `banking/`, `reports/` and `settings/` redirect non-admins to `/`. `components/NavShell.tsx` hides `adminOnly` items.
- **Sign-in flows.** `app/login/page.tsx`; every email link lands on `app/auth/callback/route.ts` (PKCE `code`, `token_hash`, or a URL fragment handed to `app/auth/confirm/page.tsx`); invites and recoveries go to `app/auth/set-password/`. Sign-out: `app/auth/signout/route.ts`.
- **CSP** (`proxy.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, plus `'unsafe-eval'` only when `NODE_ENV=development` (React's dev build needs it). `connect-src` allows the Supabase origin (https + wss) and Liveblocks. Other headers (HSTS, `X-Frame-Options`, ...) are in `next.config.ts`.

## Data model

All tables are in `supabase/migrations/`. Every table has RLS. Unless noted, the policy is "active team member, full access".

**Core** (`0001_core.sql`)

| Table | Key columns / notes |
|---|---|
| `team_members` | `email`, `full_name`, `role`, `is_active`, `auth_user_id`. Members read; admins write. |
| `org_settings` | Singleton (`id = 1`). Legal/display name, `org_aliases`, EIN, address, `mission_statement`, `timezone`, `fiscal_year_start_month`, `pri_board_approval_threshold_cents`, `public_charity_status` (letters), `grant_review_mode`, `letter_templates` (jsonb letter wording overrides), letter signatory/from-address/closing. Admins update. |
| `program_areas` | `slug` (PK), `label`, `sort_order`, `is_active`. Admins write. `assert_program_areas()` validates slug arrays. |

**Contacts and CRM** (`0002_contacts_and_crm.sql`)

| Table | Key columns / notes |
|---|---|
| `contacts` | People and organizations (`kind`). `display_name` is **generated** (org: `name`; person: first + last, else `name`). Role flags `is_donor`, `is_grantee`, `is_funder`, `is_vendor`, `is_lead`. Contact info, `alternative_emails`, `title`, `linkedin_url`, `twitter_url`, `website`, `description`, `image_path`, `entity_type`, `previous_names`, `legal_name`, `tax_id`, `tax_status`, `w9_on_file`, `tags`, `introduced_by` (self-FK), `first_met_date`, `how_we_met`, `is_active` (archive), `created_by`. CHECKs `contacts_named` and `contacts_person_fields`. The single FK target for donors, vendors, grantees, PRI recipients. |
| `affiliations` | `person_id` → person, `organization_id` → organization (trigger-checked), `relationship` (`contact`, `employee`, `founder`, `executive`, `board_member`, `advisor`, `other`), `title`, `is_primary_contact`, `start_date`, `end_date`. A contact with affiliations can't change `kind`. |
| `notes` | `content` (sanitized HTML), `note_date`, `author_id` (stamped). |
| `note_links` | `note_id`, `entity_type` (`contact`, `meeting`, `grant_proposal`, `pri`), `entity_id`, `is_primary`. No FK on `entity_id`; triggers in `0090` delete links when the record is deleted. |
| `note_attachments` | Files filed with a note (`note-files` bucket). |
| `note_intakes` | Notes-inbox drop: `status` (`uploading`, `processing`, `ready`, `filed`, `failed`), `proposal` (AI output), `draft` (reviewer edits), `note_ids`. Private to `created_by` (admins see all). |
| `note_intake_files` | Uploaded files; `storage_path` must start with `{intake_id}/`. |
| `meetings`, `meeting_attendees` | `title`, `meeting_date`, `content` (HTML). Attendees are contacts. `meetings` is in the realtime publication. |
| `tags` | `name` (unique), `color`, `usage_count`. Shared by contacts and tickets (stored as `text[]` on each). |
| `tickets`, `ticket_comments` | `status` enum (`open`, `in_progress`, `review`, `closed`; `closed_at` set by trigger), `priority`, `assigned_to`, `contact_id`, `tags`, `is_flagged`. Comments: everyone reads, authors write their own. |

**Fundraising** (`0003_fundraising.sql`)

| Table | Key columns / notes |
|---|---|
| `contributions` | `contact_id`, `amount_cents` (null only for in-kind), `received_date`, `method`, `vehicle`, `vehicle_sponsor_name`, `in_kind_description`, `restriction`, `restriction_purpose`, `quid_pro_quo` + goods/services fields, `qbo_txn_*`. CHECKs for in-kind, cash amount, quid pro quo details, and no quid pro quo on DAF/QCD. |
| `acknowledgement_letters` | One per contribution. `status` (`draft`, `generated`, `sent`), `pdf_storage_path`, `body_snapshot` (frozen letter data), `sent_to_email`, `sent_at`, `resend_message_id`. |
| `stock_contribution_details` | Security, ticker, shares, valuation date and source, FMV, sale fields. |
| `security_prices` | Daily price cache (`symbol`, `price_date`, `source`). |
| `donation_inquiries` | Website donate-form submissions; `status` (`new`, `contacted`, `archived`). |

**Expenses and files** (`0004_expenses_and_attachments.sql`)

| Table | Key columns / notes |
|---|---|
| `expense_categories` | `name`, `functional_class` (`program`, `management_general`, `fundraising`), `form_990_line`, `system_key` (`grants_paid`). Members read; admins write. |
| `expenses` | **Admins only.** `expense_date`, `amount_cents`, `category_id`, `vendor_contact_id`, `payment_method`, `status` (`pending`, `paid`, `reimbursed`), `paid_by`, `is_1099_eligible`, `disbursement_id`, `qbo_source`, `qbo_purchase_id`, `qbo_sync_status`. |
| `attachments` | Polymorphic files in the `documents` bucket: `entity_type` (`expense`, `contribution`, `grant_proposal`, `grant_out`, `grantee_report`, `contact`, `governance`, `pri`), `entity_id`. Expense attachments are admin-only (and `deleteExpense` removes them, files included). Governance documents use the nil UUID. |

**Grantmaking** (`0005_grantmaking.sql`)

| Table | Key columns / notes |
|---|---|
| `grant_proposals` | `origin` (`external` from the website, `internal`), applicant contact or raw applicant fields, `title`, `amount_requested_cents`, `program_areas` (validated slugs), `status` (`received`, `in_review`, `diligence`, `decided`, `withdrawn`), `votes_revealed`, `decision`, `decision_date`, `declined_stage`, `draft_response_email`, `response_email_sent_at`. |
| `proposal_reviews` | One per (proposal, reviewer): `score` 1–5, `vote` (`yes`, `no`, `maybe`), `comments`, `recused`. Admins write their own; hidden until revealed. |
| `proposal_comments` | Team discussion; authors write their own. |
| `proposal_memos` | Grant memorandum: four header fields and ten `q_*` sections (registry `lib/grants/memo.ts`). |
| `grant_research` | AI research runs: `status`, `draft`, `sources`, `open_questions`. |
| `grant_memo_pdfs` | Rendered memorandum (`letters` bucket) + `body_snapshot`. |
| `grants_out` | Awards: `proposal_id` (unique), `grantee_contact_id`, `amount_awarded_cents`, `agreement_signed_date`, `status` (`awarded`, `active`, `completed`, `terminated`). Members read/update; admins insert/delete. |
| `disbursements` | `grant_out_id`, `amount_cents`, `scheduled_date`, `paid_date`, `method`, `status` (`scheduled`, `paid`, `cancelled`). Members insert/update (trigger-limited); admins delete. |
| `grantee_reports` | `report_type` (`progress`, `final`, `financial`), `due_date`, `received_date`, `status` (`upcoming`, `received`, `overdue`, `waived`). |

Paying a disbursement creates an `expenses` row in the `grants_paid` category with `disbursement_id` set (`lib/grants/disburse.ts`).

**PRIs** (`0006_pris.sql`)

| Table | Key columns / notes |
|---|---|
| `pris` | `recipient_contact_id`, `instrument` (`safe`, `convertible_note`, `equity`, `loan`, `other`), `amount_cents`, `investment_date`, `board_approval_date`, `funded_date`, `status` (`committed`, `funded`, `converted`, `repaid`, `exited`, `written_off`). Never creates expenses. |
| `pri_memos` | Ten-question mission-alignment memo (registry `lib/pris/memo.ts`). |
| `pri_research` | AI research runs. |
| `pri_memo_pdfs` | Rendered memo, filed as an `attachments` row (`attachment_id`). |

**QuickBooks** (`0007_quickbooks.sql`, all admin-only): `qbo_connection` (singleton OAuth tokens), `qbo_mappings` (category/functional class/payment method → QuickBooks id), `qbo_sync_state` (singleton pull settings and last-run status), `qbo_inbox` (one row per pulled transaction, with `suggestion` and `resolution`). See [quickbooks.md](quickbooks.md).

**Summaries** (`0010_summaries.sql`): read-only totals and per-record counts for pages (see [Loading data](#loading-data)).

**Cross-cutting** (`0090_triggers.sql`): `set_updated_at` on every table with `updated_at`; note-link and contact-attachment cleanup on delete. (It also creates v0.1.0's `audit_write` triggers, which `0100_remove_activity_log.sql` drops again along with `audit_log` and its session triggers: the app keeps no activity log.) **Defaults** (`0091_default_data.sql`): Form 990 Part IX expense categories.

## Database-enforced rules

These hold for every signed-in session, including someone calling the Supabase REST API directly with their own token. The user-facing guards return early when `auth.uid()` is null: **service-role sessions (cron, public intake, PDF generation) are trusted.** These apply to every session, service role included: the PRI funding gate, the contribution lock, the keep-an-admin and sign-up triggers, the contact and program-area triggers, and all CHECK constraints. Tests: `supabase/tests/schema.test.ts` (`business rules` and `security rules` blocks).

| Rule | Where | What it does |
|---|---|---|
| Blind voting | `0009`: `proposal_votes_in()`, `reveal_votes_when_complete()`, `reveal_votes_after_mode_change()`, policy "Members read own or revealed reviews" | Reviews are visible only to their author until every grant reviewer (`is_grant_voter_member()`) has voted or recused. The reveal trigger then sets `votes_revealed`, only while `in_review`. Narrowing the reviewers in Settings reveals any vote that is now complete. |
| `votes_revealed` is never set by hand | `0009`: `guard_proposal_changes()` | A user session can change `votes_revealed` only inside the reveal trigger, which sets the transaction-local flag `app.revealing_votes`; the guard re-checks `proposal_votes_in()`. Inserts can't start revealed at `received`/`in_review`. |
| Reviews frozen after reveal | `0009`: `guard_revealed_reviews()` | No insert/update/delete of a review once its proposal is revealed. |
| Proposal transitions | `0009`: `guard_proposal_changes()` | Any member may: create `received` or `diligence` (internal) proposals, move `received → in_review`, and withdraw from `received`/`in_review`/`diligence`. Everything else (advance, decide, decision fields) needs `is_grant_voter()`. `in_review` can only be entered from `received`. |
| Only reviewers vote | `0005` review policies, `is_grant_voter()` | Insert/update a review only as a grant reviewer (everyone, or admins, per `grant_review_mode`), for yourself. |
| Award money | `0005` policies + `0009`: `guard_award_changes()` | Admins create/delete awards; staff can't change `amount_awarded_cents`, `grantee_contact_id` or `proposal_id`. |
| Disbursement money | `0009`: `guard_disbursement_changes()` | Staff may insert only `scheduled` rows, edit date/method, and cancel a scheduled one. Paying, and changing amount, `paid_date` or award, is admin-only. Only a `scheduled` disbursement can become `paid`, for admins too. A unique index (`expenses_disbursement_unique`, `0005`) allows one expense per disbursement; `applyDisbursementPaid` claims the row with a conditional update and puts it back if the expense insert fails. |
| Sent letter is final | `0009`: `guard_sent_letter()` | A `sent` letter can't be deleted or changed, except recording a resend (`sent_to_email`, a later `sent_at`, `resend_message_id`). |
| Contribution lock | `0009`: `guard_acknowledged_contribution()` | Once its letter is sent, a contribution can't be deleted, and only `qbo_txn_type`, `qbo_txn_id`, `notes` can change. |
| PRI funding gate | `0009`: `guard_pri_funding()` | Leaving `committed` requires all ten memo answers, a `pri` attachment other than the generated memo PDF, and `board_approval_date` when `amount_cents` ≥ the threshold. |
| Author/creator stamping | `0009`: `stamp_current_member()` | On insert, sets `notes.author_id` and `created_by` on `tickets`, `meetings`, `note_intakes`, `contacts` to the signed-in member; they can't be changed later. |
| Notes-inbox files | `0009`: CHECK `note_intake_files_in_intake_folder`; `guard_note_attachment_path()` | A file row must live under its intake's folder; a note attachment must point at one of your own (or, for admins, any) notes-inbox files. |
| Sign-up gate | `0001`: `link_team_member()`, `link_confirmed_team_member()` | Only team emails; only invited or confirmed users are linked. |
| Keep an admin | `0001`: `keep_an_active_admin()` | The last active admin can't be demoted, deactivated or deleted. |
| Contacts | `0002` CHECKs and triggers; FKs without cascade | Person-only fields stay null on organizations; affiliations connect a person to an organization; a contact with contributions, expenses, proposals, awards or PRIs can't be deleted (archive it with `is_active`). |
| Program areas | `0001` `assert_program_areas()`, `0005` trigger | Proposal `program_areas` must be existing slugs. |

App-level only (not enforced in the database): notes are edited and deleted only by their author (`lib/actions/notes.ts`); a disbursement is paid only after `agreement_signed_date` is set (`lib/grants/disburse.ts`); a proposal is decided only with a complete memo (`recordDecision`).

## Storage

All buckets are private (`0008_storage.sql`); the app serves files through short-lived signed URLs or streaming routes.

| Bucket | Limit | Paths | Access |
|---|---|---|---|
| `documents` | 50 MB, any type | `{entity_type}/{entity_id}/{uuid}-{name}` for attachments (so `expense/...`, `pri/...`, `governance/...`); `expense-import/` for bulk invoice uploads; `contact-images/{contact_id}/` for logos and photos; `pri/{id}/mission-alignment-memo.pdf` | Team; `expense/` and `expense-import/` admins only (inline in the `documents` policies) |
| `letters` | 25 MB; PDF, PNG, JPEG | `contributions/{id}/acknowledgement-{year}.pdf`, `memoranda/{proposal_id}/grant-memorandum.pdf`, `assets/signature` | Team reads; only admins write from a session. The app writes with the service role. |
| `note-files` | 25 MB; the types in `lib/note-intake-core/formats.ts` | `{intake_id}/{uuid}-{name}` | Uploader (or admin) while in the inbox; whole team once attached to a filed note |

App-side limits are lower: 10 MB per attachment (`lib/storage/store-file.ts`), 5 MB contact images (PNG/JPEG/WebP/GIF, no SVG; `lib/contacts/crm.ts`), 20 MB invoices and notes-inbox files.

## Rich text

- Notes and meeting notes are HTML from TipTap editors.
- **On write**, `sanitizeRichText()` (`lib/security/sanitize-html.ts`, `sanitize-html` package) keeps only the tags the editors emit (paragraphs, headings, lists, links with http/https/mailto, code, quotes) and drops scripts, styles, event handlers, images and iframes. Used by `lib/actions/notes.ts`, `meetings.ts` and `note-intake.ts`.
- **On render**, `components/crm/notes/NotesTimeline.tsx` runs `DOMPurify.sanitize()` as a second layer, but **only after mount**: `dompurify` needs a browser DOM and has no working `sanitize()` on the server. Until mounted (SSR and first client render) it shows plain text, so server and client output match. `app/(app)/grants-out/new/LetterUploadForm.tsx` also sanitizes DOCX previews with DOMPurify in the browser.

## AI features (Anthropic)

All optional (`ANTHROPIC_API_KEY`); model ids in `lib/ai/models.ts` (`RESEARCH_MODEL`, `EXTRACTION_MODEL`, `FALLBACK_MODEL`, used when the primary model refuses). `lib/ai/org-context.ts` feeds the organization's name, mission, program areas and reviewers into prompts.

| Feature | Called from | Drafts | Human step | Without the key |
|---|---|---|---|---|
| Grant research | `lib/grants/research.ts` via `app/api/proposals/[id]/research` | Memo sections, sources, open questions (web search + fetch tools) into `grant_research` | "Use draft" per section, then the member saves the memo | Panel shows; the route returns 503 |
| PRI research | `lib/pris/research.ts` via `app/api/pris/[id]/research` | The ten PRI memo answers into `pri_research` | Same as above | Panel hidden |
| Decline email | `lib/grants/decline-email.ts` via `app/api/proposals/[id]/decline-email` | `draft_response_email` | Edit, copy into your own email, "Mark as sent". The app never sends it. | No draft button |
| Invoice reading | `lib/invoices/extract.ts` via `app/api/invoices/extract` | Vendor, date, amount, category... for bulk upload rows | Review each row; it becomes an expense only when saved | "Auto-reading is off"; manual entry |
| Notes inbox | `lib/note-intake-core/server.ts` via `app/api/note-intake/[id]/process` (in `after()`) | Proposed notes, links and new contacts in `note_intakes.proposal` | Review and file (`fileNoteIntake`) | Notice on the page; route returns 503. In demo mode the drop zone stages files through `stageNoteIntakeFile` (the browser client is a stub there) |

Documents you upload to these features are sent to Anthropic's API.

## Integrations

Each one is optional and turns itself off when its env var is missing.

| Integration | Env | Code | When missing |
|---|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | see above | AI features hide or explain themselves |
| Resend (email) | `RESEND_API_KEY`, `LETTER_FROM_EMAIL` | `lib/email/resend.ts`, `lib/actions/letters.ts`, `lib/email/ticket-assigned.ts` | Ticket emails are skipped. The letter panel hides its email buttons; `sendLetter` returns "Email isn't set up: add RESEND_API_KEY…" (`getResend()` throws an `ActionError`, and `isEmailConfigured()` lets pages check first). |
| Liveblocks | `LIVEBLOCKS_SECRET_KEY`, `NEXT_PUBLIC_LIVEBLOCKS_ROOM_PREFIX` | `lib/liveblocks.ts`, `lib/liveblocks-rooms.ts`, `app/api/liveblocks-auth/route.ts`, `components/meetings/CollaborativeTiptapEditor.tsx` | Meetings use a plain autosaving text area. Live mode also needs the key to start with `sk_`. |
| QuickBooks Online | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT`, `QBO_REDIRECT_URI` | `lib/quickbooks/**` | Settings → QuickBooks says "Not configured" and can't connect. Everything else keys off whether a `qbo_connection` row exists: no connection, no sync. Banking still shows for admins, with a "not connected" banner. See [quickbooks.md](quickbooks.md). |
| Financial Modeling Prep | `FMP_API_KEY` | `lib/market/security-prices.ts`, `app/api/cron/stock-prices/route.ts` | No market prices; enter stock values by hand |
| Website forms | `DONATION_INQUIRY_INGEST_SECRET`, `GRANT_PROPOSAL_INGEST_SECRET` | `app/api/public/*` | The endpoint returns 401 (fails closed) |

Cron routes (`app/api/cron/*`) check `Authorization: Bearer $CRON_SECRET` with `isAuthorizedCronRequest()` (`lib/cron/auth.ts`). Shared secrets are compared in constant time (`lib/security/secrets.ts`).

## Demo mode

- On whenever `NEXT_PUBLIC_USE_SUPABASE` isn't `true` or `NEXT_PUBLIC_SUPABASE_URL` is unset (`isDemoMode()` in `lib/supabase/demo/mock-client.ts`). `createClient()`, `createClientSnapshot()` and `createAdminClient()` all return the mock; the browser client is a stub.
- No login: `proxy.ts` skips auth and the mock's `auth.getUser()` returns a demo admin.
- Data: `lib/supabase/demo/store.ts`, a fictional literacy nonprofit. Writes live in server memory and reset on restart, on a new serverless instance, and every six hours (`DEMO_RESET_MS`), so the app can run as a public sandbox (the banner in `app/(app)/layout.tsx` says so). Files are served by `app/api/demo-files/route.ts`; the mock keeps at most 200 MB of uploads, dropping the oldest. Uploads that live installs send straight from the browser to Storage (bulk invoices, notes inbox) go through server actions instead (`stageInvoiceFile`, `stageNoteIntakeFile`; 8 MB per notes-inbox file in the demo).
- **Scripted AI.** In demo mode without `ANTHROPIC_API_KEY`, every AI feature uses the scripted provider instead of Claude (`isScriptedAi()` in `lib/ai/demo.ts`; the outputs are pure functions in `lib/ai/demo-scripts.ts`, tested in `demo-scripts.test.ts`). After a 1–2 second pause it returns sample results: an invoice reading chosen from the file name, grant and PRI memo drafts with example.org sources and open questions, a decline email using the applicant's names, and notes-inbox proposals linked to existing contacts. Nothing reads the uploaded files. Results carry the model id `DEMO_AI_MODEL` and the UI labels them "Demo: sample AI output" (`components/DemoAiBadge.tsx`). With a key, demo mode calls Claude as usual; outside demo mode, no key still hides or explains the features.
- **Integrations in demo mode.** QuickBooks can't connect: Settings, Banking and the expense page show `components/QuickBooksDemoNote.tsx` (a summary of [quickbooks.md](quickbooks.md)) instead of connect, sync and send controls, and Banking lists sample bank-feed items (`qbo_inbox` in `store.ts`) to try the review flow. Letter "email" only marks the letter sent and says so. Meetings use the plain editor, stock prices are entered by hand, and adding team members or changing passwords is refused with a message.
- **Limitations:** the mock implements only the query-builder methods the app uses (listed at the top of `mock-client.ts`, including `range()`), resolves embedded selects only when they carry an FK column hint (`alias:table!fk_column(...)`; many-to-one when the column is on the row, one-to-many otherwise, always an array), implements `rpc()` only for the functions in `lib/supabase/demo/functions.ts`, runs no RLS, constraints or triggers, only emulates the `contacts.display_name` generated column, and fills in only the column defaults listed in `COLUMN_DEFAULTS` (add one when an insert relies on a new default). Letters are marked sent without email. Keep `store.ts` in step with the schema.

## Testing

- `pnpm test` runs Vitest over `lib/**/*.test.ts` (pure domain logic, letter wording, CSV, matching, sanitizing, the action guard), `scripts/**/*.test.ts` (the setup scripts' helpers) and `supabase/tests/**/*.test.ts`.
- The database suite (`supabase/tests/db.ts`) boots PGlite (Postgres in WebAssembly) with `pgcrypto` and `pg_trgm`, applies `supabase/tests/supabase-shim.sql` (stand-ins for Supabase's `auth` and `storage` schemas and roles), then every migration in filename order. `asUser(db, userId)` and `asService(db)` switch between a signed-in session and the service role.
- `supabase/tests/setup-sql.test.ts` fails when `supabase/setup.sql` is stale (fix: `pnpm db:bundle`) and checks that applying it in one batch builds the same tables, columns, policies, functions, triggers, indexes and seed data as applying each migration.
- `supabase/tests/schema.test.ts` covers the sign-up gate, RLS, storage policies, contacts, domain triggers, every rule in the table above, the summary functions, and that policies wrap their helper calls.
- `lib/supabase/fetch-all.test.ts` checks paging past a capped response (also against the demo client); `lib/supabase/demo/mock-client.test.ts` checks hinted embeds and paged `rpc()`.

## Types

`lib/supabase/types/database.ts` is maintained by hand to match the migrations; there's no linked project to generate from. It exports row types (`Contact`, `GrantProposal`, ...) and the string unions (`ContributionMethod`, `ProposalStatus`, ...). Update it, and `lib/supabase/demo/store.ts`, with every schema change.
