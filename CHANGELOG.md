# Changelog

Notable changes to 501(c)(FREE). Each release lists any new database migrations: run them in order on an existing installation (see [docs/setup.md](docs/setup.md#upgrading)).

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
