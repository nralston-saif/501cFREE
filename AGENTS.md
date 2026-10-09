# AGENTS.md

Instructions for coding agents (Claude, GPT, Copilot and others) and human contributors. `CLAUDE.md` just includes this file.

## What this is

501(c)(FREE) is an open-source, self-hosted back office for one small US nonprofit per installation: donations and IRS acknowledgement letters, expenses by Form 990 functional class, grantmaking, program-related investments (PRIs), and a small CRM.
Stack: Next.js 16 App Router, TypeScript (strict), Tailwind 4, one Supabase project (Postgres, Auth, Storage). Optional: Anthropic, Resend, Liveblocks, QuickBooks Online, Financial Modeling Prep.
With no database configured it runs in **demo mode** (in-memory sample data, no login).

## Read these docs

| Doc | Read it when |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Before any change: layout, data flow, auth, data model, database rules, storage, AI, demo mode, tests |
| [docs/features.md](docs/features.md) | You're changing a feature: routes, components, actions and tables per area |
| [docs/glossary.md](docs/glossary.md) | A tax or nonprofit term is unfamiliar (Pub 1771, 990 Part IX, PRI, DAF...) |
| [docs/setup.md](docs/setup.md) | Installing, env vars, deploying |
| [docs/quickbooks.md](docs/quickbooks.md) | Touching `lib/quickbooks/**`, Banking or expense sync |
| [SECURITY.md](SECURITY.md) | Touching auth, RLS, storage or the public endpoints |

## Commands and definition of done

```bash
pnpm install
pnpm dev          # http://localhost:3000; demo mode unless .env.local sets NEXT_PUBLIC_USE_SUPABASE=true
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint .
pnpm test         # vitest: lib/**/*.test.ts + scripts/**/*.test.ts + supabase/tests (all migrations on embedded Postgres)
pnpm test:db      # only the database suite
pnpm build        # next build
pnpm db:bundle    # regenerate supabase/setup.sql from the migrations
pnpm onboard      # guided first-time setup against a real Supabase project (writes .env.local)
```

A change is done when `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` all pass (CI in `.github/workflows/ci.yml` runs the first three). Schema changes also need types, demo data, policies and a test (see the checklist below).

## Conventions (non-negotiable)

**Server actions return errors; they never throw to the client.**
- Next.js replaces the message of any error thrown out of a server action with a generic digest in production builds. `pnpm dev` shows the real message, so a thrown error looks fine locally and becomes "Something went wrong" in production.
- Default pattern (`lib/actions/result.ts`): inside the action, `throw new ActionError('message for the user')`, and wrap the whole exported body in `return runAction(async () => { ... })`. The caller gets `ActionResult<T>` = `{ ok: true, data } | { ok: false, error }`. `runAction` rethrows `redirect()`/`notFound()` via `unstable_rethrow`, and turns any other error into a logged, generic message.
- Forms: use `components/ActionForm.tsx` instead of `<form action={serverAction}>`. It toasts the error, keeps the input, resets on success, and drives `components/SubmitButton.tsx`'s pending label.
- Buttons and client code: `unwrap(await someAction(...))` returns the data or throws a plain `Error` carrying the message, for existing `try/catch` + toast code. Action-to-action calls on the server use `unwrapAction()`.
- Some action files return their own `{ ok, error }` shapes, built in `try/catch` with `actionErrorMessage(err, fallback)`: `contacts.ts`, `crm-create.ts`, `notes.ts`, `meetings.ts`, `tickets.ts`, `note-intake.ts`, `invoice-uploads.ts`, `documents.ts` (`{ html } | { error }`). `settings.ts`, `team.ts` and `account.ts` return `{ error, ok }` state for React's `useActionState` (`settings.ts` via its local `asState()` wrapper). Match the file you're in.
- `lib/actions/server-actions-guard.test.ts` fails if a `throw`, `requireMemberId()`, `requireAdminId()` or `requiredString()` in an exported `'use server'` function isn't inside `runAction(...)`, `asState(...)` or a `try` block.

**Access control lives in the database.**
- Row-level security (RLS) plus triggers are the real gate: every table needs an active team member; expenses, QuickBooks tables and the audit log need an admin. Triggers in `supabase/migrations/0009_business_rules.sql` enforce blind voting, money rules, letter locks and the PRI funding gate even if app code is bypassed.
- Every action starts with `requireMemberId()` or `requireAdminId()` (`lib/actions/helpers.ts`). App checks are for a clear message; keep them consistent with RLS.
- Use the RLS client (`createClient()` from `lib/supabase/server.ts`) for user work. The service-role client (`createAdminClient()` in `lib/supabase/admin.ts`) is only for cron, public intake, PDF/letter storage writes, signed URLs a session can't make, and auth admin (invites). Service-role sessions have no `auth.uid()` and skip most of the triggers' user rules (the PRI funding gate and the contribution lock still apply).

**Data rules.**
- Money is integer cents (`bigint`, `*_cents`). Use `formatCents` / `parseDollarsToCents` in `lib/utils/money.ts`. Never floats.
- "Today" for the organization is `orgToday()` from `lib/settings.ts` (uses `org_settings.timezone`). Don't use `new Date()` for dates you store.
- Organization-specific values (name, EIN, mission, thresholds, letter signatory, program areas) come from `org_settings` and `program_areas`. Never hardcode them.
- Generic code only: no real organization names, people, domains or policies. Sample data uses `example.org` and invented names.

**Reading data at scale.** PostgREST returns at most `max_rows` rows (1000 on Supabase) and a capped response looks complete: no error, just fewer rows. Details in [docs/architecture.md](docs/architecture.md#loading-data).
- Never load a whole table to count, total or look up names. Filter in SQL, count with `{ count: 'exact', head: true }`, total with a summary function (`supabase/migrations/0010_summaries.sql`, called with `rpc()`), and get names with a hinted FK embed (`contact:contacts!contact_id(display_name)`).
- When the whole list is genuinely needed (reports, CSV exports, pickers, lists filtered on the client), use `fetchAll()` from `lib/supabase/fetch-all.ts`, ordered by a unique key last. Reports and exports must be complete at any size. Look ids up with `fetchByKeys()`, not one long `.in()`.
- Select only the columns the page uses. Start independent queries together (`Promise.all`, or chain a dependent query off its input's promise) instead of awaiting them one by one.
- An async server component inside a page (like `CreateTicketButton`, `ContactNotes`) renders behind its own `<Suspense>`, so it doesn't wait for the page's data and then hold the page. Heavy sections get a `loading.tsx` (shared `components/PageSkeleton.tsx`).
- Heavy libraries stay out of pages: client editors (TipTap) load with `next/dynamic` (`components/crm/notes/LazyRichTextEditor.tsx`), and server-only pipelines (sharp, mammoth, xlsx, the Anthropic SDK) are imported only by the route that does the work, dynamically when they're needed after the response. Keep cheap checks in a separate module (e.g. `lib/note-intake-core/config.ts`).

**AI drafts, humans approve.** Model output never becomes a final record by itself: research fills drafts a person saves, invoice extractions become pending expenses a person reviews, notes-inbox proposals are filed only after review, decline emails are drafts. Model ids are in `lib/ai/models.ts`.

**Letter wording** in `lib/pdf/letter-data.ts` implements IRS Pub 1771. Change it only with a cited source, and keep `letter-data.test.ts` green.

**Types and demo data are hand-maintained.** `lib/supabase/types/database.ts` mirrors the migrations (no generator). `lib/supabase/demo/store.ts` is the demo dataset. Update both with every schema change.

**Migrations.** The project is unreleased. Until the first public release, the baseline migrations `supabase/migrations/0001_core.sql` through `0091_default_data.sql` may be edited in place (that keeps a fresh install to one clean baseline). After the first public release, never edit a shipped migration: add a new numbered file instead. Indexes go with their table; add one for any new hot filter + sort pair (e.g. `(status, txn_date desc)`).

## Gotchas

- **Production hides thrown action errors.** See above. Test error paths with `pnpm build && pnpm start` if in doubt.
- **DOMPurify crashes on the server.** `dompurify` has no `sanitize()` without a browser DOM, so calling it during SSR throws. `components/crm/notes/NotesTimeline.tsx` renders notes as plain text on the server and first client render, then as `DOMPurify.sanitize(html)` after mount (`useSyncExternalStore`). Server-side sanitizing uses `sanitizeRichText()` in `lib/security/sanitize-html.ts` (the `sanitize-html` package), applied on write by the notes, meetings and notes-inbox actions.
- **Demo mode is a mock.** `lib/supabase/demo/mock-client.ts` implements only the query methods the app uses (including `range()`). It resolves an embedded select only when it names the FK column (`contact:contacts!contact_id(...)`, `items:disbursements!grant_out_id(...)`), runs no RLS and no triggers, and only emulates the `contacts.display_name` generated column. Every `rpc()` function needs a JavaScript twin in `lib/supabase/demo/functions.ts`. A query that works in demo mode can fail on Postgres, and the other way round.
- **`contacts.display_name` is generated.** Never write it. Organizations use `name`; people use `first_name`/`last_name` (with `name` as fallback).
- **`contacts_person_fields` CHECK**: an organization must have `first_name`, `last_name`, `title` and `linkedin_url` all null. Clear them before switching a contact to an organization. A contact with affiliations can't change `kind` at all.
- **Hydration.** Server and first client render must match. Pass "today" from the server (`todayInTimeZone(timezone)`), format dates with the fixed `en-US` helpers in `lib/utils/dates.ts`, and read `localStorage` or browser-only APIs after mount.
- **`window.confirm`.** Many delete and pay flows call `confirm()` (for example `DisbursementActions.tsx`, `LetterPanel.tsx`, `DeleteExpenseButton.tsx`, `NoteComposer.tsx`). Browser automation tools may auto-dismiss it, which silently cancels the action.
- **QuickBooks echo marker.** `lib/quickbooks/echo.ts` writes `Expense <uuid> (sent from back office)` into a QuickBooks Purchase's private note to recognize the app's own transactions when they're pulled back. Never change this string: Purchases already in QuickBooks carry it.
- **Notes: author-only edits are an app rule.** RLS lets any member update `notes`; `lib/actions/notes.ts` checks authorship. `author_id`/`created_by` columns are stamped by the `stamp_current_member` trigger and can't be reassigned from a user session.
- **`app/(app)/contacts/**` are redirects only.** Link to `/contacts/{id}` when you only know an id; it forwards to `/people/{id}` or `/organizations/{id}`.
- **Base path.** `next/link` adds `NEXT_PUBLIC_BASE_PATH` for you; plain `<a href>` and `fetch('/api/...')` need `withBasePath()` from `lib/basePath.ts`.

## Checklists

**Add a table or column**
1. Pre-release: edit the baseline migration for that domain (`0002`–`0007`). Post-release: add a new numbered migration.
2. Enable RLS and add policies (`is_team_member()`, `is_admin()`, `current_member_id()` from `0001_core.sql`). **Always wrap helper calls in `(select …)` in policies**: `using ((select is_team_member()))`, `created_by = (select current_member_id())`. Postgres then evaluates them once per statement instead of once per row; the meaning is identical. `supabase/tests/schema.test.ts` ("policy performance") fails on a bare call. Helpers that take a row value (`note_file_owned(name)`) can't be hoisted and stay as they are.
3. New table: add it to the audit list in `0090_triggers.sql` (the `updated_at` loop there picks it up automatically). A post-release migration must create both triggers itself, since `0090` has already run.
4. Any business rule that must hold for every client goes in a trigger (see `0009_business_rules.sql`); let `auth.uid() is null` (service role) through.
5. Update `lib/supabase/types/database.ts` and `lib/supabase/demo/store.ts`.
6. Add a test to `supabase/tests/schema.test.ts` (use `asUser` / `asService` from `supabase/tests/db.ts`).
7. Run `pnpm db:bundle` to regenerate `supabase/setup.sql` (the one-paste install script). `supabase/tests/setup-sql.test.ts` fails while it's out of date. Never edit `setup.sql` by hand.

**Add a server action**
1. Put it in the domain's file in `lib/actions/` (`'use server'`).
2. `return runAction(async () => { const memberId = await requireMemberId(); ... })` (or `requireAdminId()`).
3. Use `createClient()`; throw `ActionError` with a message a user can act on; `revalidatePath()` what changed.
4. Call it from `ActionForm` or with `unwrap()`. Run `pnpm test` (the guard test).

**Add a page**
1. Signed-in pages go in `app/(app)/<area>/`; the group layout already requires an active member.
2. Admin-only areas: add a `layout.tsx` gate like `app/(app)/expenses/layout.tsx`, and mark the nav item `adminOnly` in `components/NavShell.tsx`.
3. Read data in the server component with `createClient()`, in one `Promise.all` wave; pass plain props to client components. Follow "Reading data at scale" above: no whole-table loads for totals or names.
4. A data-heavy section gets a `loading.tsx` using `components/PageSkeleton.tsx` (`app/(app)/loading.tsx` is the fallback).
5. Check it in demo mode, and add demo rows if the page would be empty.

**Add a total or count**
1. A count: `.select('id', { count: 'exact', head: true })` with the filters in SQL.
2. A sum or per-record aggregate: a `language sql stable` function (security invoker, so RLS applies) in `0010_summaries.sql`, with `revoke … from public, anon` / `grant … to authenticated`, its type under `Functions` in `lib/supabase/types/database.ts`, its demo twin in `lib/supabase/demo/functions.ts`, and a test in `supabase/tests/schema.test.ts`. Set-returning functions page like tables: `fetchAll(() => supabase.rpc('fn').order('key'))`.

**Add an integration**
1. Read its key from `process.env` on the server only, and document it in `.env.example` and `docs/setup.md`.
2. When the key is missing the feature must hide or explain itself, never crash (see how `ANTHROPIC_API_KEY` and `LIVEBLOCKS_SECRET_KEY` are handled in `docs/architecture.md`).
3. Add its origin to the CSP in `proxy.ts` if the browser talks to it.
4. Scheduled work goes in `app/api/cron/<job>/route.ts`, checked with `isAuthorizedCronRequest()` (`lib/cron/auth.ts`), and listed in `vercel.json`.
