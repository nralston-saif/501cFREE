# 501(c)(FREE)

501(c)(FREE) is a free, open-source back office for small US nonprofits and grantmakers: donations and acknowledgement letters, expenses by Form 990 functional class, a full grantmaking pipeline, program-related investments, and a lightweight CRM (organizations, people, notes, meetings and tickets). Built with Next.js and Supabase. It's designed to be self-hosted by one organization per installation.

Built by [SAIF](https://saif.vc) for its nonprofit, SAIFbio, and open-sourced so other organizations can use it.

> **Status: early release (October 2026).** It's adapted from the system SAIFbio uses day to day, but expect rough edges. Bug reports, setup problems and ideas are welcome in [GitHub Issues](https://github.com/nralston-saif/501cFREE/issues).

> **Try it in one minute:** `git clone https://github.com/nralston-saif/501cFREE.git && cd 501cFREE && pnpm install && pnpm dev`, then open http://localhost:3000. With no database configured, the app runs in **demo mode** with fictional sample data and no login.

## What it does

**Fundraising**
- Record contributions: cash, check, wire, card, stock, crypto and in-kind. Each can carry donor restrictions, a quid-pro-quo disclosure, and a gift vehicle (donor-advised fund, IRA qualified charitable distribution, employer match and more).
- Generate and email **acknowledgement letters built around IRS Pub 1771 requirements**. They include the no-goods-or-services statement, quid-pro-quo estimates and in-kind descriptions without valuation. A frozen snapshot of each sent letter is kept, and a gift can't be edited once its letter is sent.
- Track stock gifts: security, shares, fair-market value and sale proceeds, with optional daily market prices.
- Receive donation inquiries from your website's donate form.

**Expenses and reporting**
- Categorize expenses by **Form 990 functional class** (program, management & general, fundraising). Attach receipts and track 1099 vendors.
- **Bulk invoice upload:** drop in PDFs, Word documents or photos. Claude reads each one and files it as a pending expense for review.
- Reports and CSV exports:
  - a 990-style functional expense summary
  - donor summaries
  - grants paid, shaped like Schedule I
  - calendar-year 1099 totals

**Grantmaking**
- A proposal pipeline. Proposals start as an intake inbox, fed by your website's form or entered by the team.
- **Blind review:** reviewers score and vote, with recusal for conflicts of interest. Votes stay hidden until everyone has voted. Who reviews is a setting: everyone on the team (default) or admins only.
- A collaborative **grant memorandum** during diligence. An optional AI research assistant can draft its sections.
- Decision, award, disbursements and grantee reports. Paying a disbursement records the matching expense automatically.
- A drafted decline email when a proposal is turned down.

**Program-related investments (PRIs)**
- SAFE, note, equity or loan investments in mission-aligned organizations, carried as balance-sheet assets (not as grants).
- Funding requires a completed mission-alignment memo, an attached executed instrument, and board approval above a threshold you set.

**CRM**
- **Organizations** and **People** in one directory, with affiliations between them (founder, executive, staff, board member, advisor, contact) and roles: donor, grantee, funder, vendor, lead. Logos and photos, documents, tags, and each record's giving and funding history.
- **Global search** (⌘K / Ctrl+K) across people, organizations, notes and meetings.
- Notes with attachments on any organization, person, proposal or PRI. A note can be linked to several records, and it autosaves as you type.
- A **notes inbox**: drop in documents, handwritten pages or spreadsheets. Claude proposes notes and new contacts, and a person reviews them before anything is saved.
- Meetings with optional live co-editing, plus team tickets with tags and assignment emails.

**Integrations** (all optional)
- **QuickBooks Online** two-way sync. Your bank feeds stay the source of truth; see [docs/quickbooks.md](docs/quickbooks.md).
- **Claude (Anthropic)** for invoice extraction, the notes inbox, research memos and decline emails.
- **Resend** for email.
- **Liveblocks** for real-time meeting notes.
- **Financial Modeling Prep** for stock prices.

## Getting started

You need [Node.js](https://nodejs.org) 20.11 or newer and [pnpm](https://pnpm.io/installation).

1. Create a free project at [supabase.com](https://supabase.com).
2. Get the code:
   ```bash
   git clone https://github.com/nralston-saif/501cFREE.git && cd 501cFREE && pnpm install
   ```
3. In Supabase, open **SQL Editor**, paste the whole of `supabase/setup.sql`, and click **Run**.
4. Run `pnpm onboard`. It asks for your Supabase keys, writes `.env.local`, checks your database and sign-in settings, and creates your admin login.
5. Run `pnpm dev`, open http://localhost:3000 and sign in.

Then open **Settings** to enter your organization's legal name, EIN, address and mission, and invite your team from **Settings → Team**. [docs/setup.md](docs/setup.md) has the details, deploying, optional integrations and troubleshooting.

## Who can see what

Only people on your team list can sign in. There are no public sign-ups. There are two roles:

- **Admin:** everything, including expenses, banking and QuickBooks, reports and exports, team management, settings, the audit log, making grant awards and paying them.
- **Staff:** everything else, including organizations, people, notes, meetings, tickets, donations, proposals, awards paperwork and PRIs.

Voting on, advancing and deciding grant proposals is for everyone on the team by default; **Settings → Organization → Grant review** can limit it to admins.

These rules are enforced in the database with row-level security and triggers, not only in the app: blind voting, admin-only payments, locked letters and the PRI funding checks hold even for someone calling the Supabase API directly. Every change made by a team member is recorded in an audit log that admins can read.

## Development

```bash
pnpm install
pnpm dev          # demo mode unless .env.local configures Supabase
pnpm typecheck
pnpm lint
pnpm test         # unit tests + database tests
pnpm build
pnpm db:bundle    # regenerate supabase/setup.sql after changing a migration
```

`pnpm test` includes `supabase/tests`. Those tests apply every migration to an embedded Postgres (PGlite) and check sign-up restrictions, row-level security, storage policies and the database's business rules, so schema changes are tested without a Supabase project.

Using a coding agent? Point it at [AGENTS.md](AGENTS.md) first.

## Documentation

| Doc | What's in it |
|---|---|
| [AGENTS.md](AGENTS.md) | Conventions, gotchas and checklists for contributors and coding agents |
| [docs/setup.md](docs/setup.md) | Installing, environment variables, deploying, website forms |
| [docs/architecture.md](docs/architecture.md) | How the code is organized: data flow, auth, data model, database rules, storage, AI, demo mode, tests |
| [docs/features.md](docs/features.md) | Every feature area: routes, components, actions, tables and rules |
| [docs/glossary.md](docs/glossary.md) | Nonprofit and tax terms (Pub 1771, Form 990, PRI, DAF...) and where they appear |
| [docs/README.md](docs/README.md) | Index of the docs folder |
| [docs/quickbooks.md](docs/quickbooks.md) | The optional QuickBooks Online integration |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [SECURITY.md](SECURITY.md) | Reporting vulnerabilities; running an installation safely |

## Important notes

- **US-specific.** Letters, 990 categories, 1099 rules and PRI treatment follow US tax rules for 501(c)(3) public charities. The software isn't tax or legal advice. The acknowledgement-letter wording (`lib/pdf/letter-data.ts`) is a starting point based on IRS publications (Pub 1771, 526, 590-B); have your own accountant or counsel review it, and your setup, before use.
- **One organization per installation.** There's no multi-tenancy. Each organization runs its own Supabase project and deployment.

## License

[MIT](LICENSE)
