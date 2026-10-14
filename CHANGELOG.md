# Changelog

Notable changes to 501(c)(FREE). Each release lists any new database migrations: run them in order on an existing installation (see [docs/setup.md](docs/setup.md#upgrading)).

## Unreleased
- AI routes are capped at 300 seconds (Vercel Hobby's limit) so the app deploys on the free plan; on a paid plan raise the research routes to 800 seconds for full-length research (see docs/setup.md).
- The QuickBooks pull now runs daily by default, so the app deploys on Vercel's free Hobby plan (which only allows daily jobs). On a paid plan, set its schedule in `vercel.json` to `*/30 * * * *`; **Sync now** pulls immediately either way.
- Demo mode works as a public demo: QuickBooks shows how the integration works instead of connecting, and Banking has sample items to review.
- Demo mode without an API key shows the AI features' pre-written samples entirely in the browser (grant and PRI research, decline email, notes inbox, bulk invoice upload), so they work on the hosted demo where server memory isn't shared between requests; nothing is saved. The demo banner now says the demo doesn't save changes and links to the code on GitHub (`NEXT_PUBLIC_REPO_URL` points it at a fork).

- Removed the activity log (Settings → Activity). The app no longer records team members' sign-ins, sign-outs or record changes; the `audit_log` table, its triggers and its trigger functions are dropped, along with any events already recorded.

Database: run `0100_remove_activity_log.sql` on an existing installation (fresh installs: `supabase/setup.sql` already includes it).

## 0.1.0 (2026-10-14)

First public release.

- Fundraising: contributions (cash, stock, in-kind, DAF, IRA QCD and more), acknowledgement letters built around IRS Pub 1771 with editable per-vehicle templates, donation inquiries.
- Expenses by Form 990 functional class, receipts, bulk invoice upload with AI extraction, 990/1099/Schedule I-style reports and CSV exports.
- Grantmaking: intake, blind review (everyone or admins only), diligence memorandum with optional AI research, decisions, awards, disbursements, grantee reports.
- Program-related investments with a mission-alignment memo and funding gate.
- CRM: organizations, people, affiliations, notes (with a notes inbox), meetings, tickets, global search.
- Optional integrations: QuickBooks Online, Claude, Resend, Liveblocks, Financial Modeling Prep.
- Setup: one-paste `supabase/setup.sql` and a guided `pnpm onboard`.

Database: baseline migrations `0001`–`0091` (fresh installs: `supabase/setup.sql`).
