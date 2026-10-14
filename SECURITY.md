# Security

Please report vulnerabilities privately. Use GitHub's **Report a vulnerability** button (Security → Advisories) on this repository rather than opening a public issue. We aim to acknowledge reports within a few days.

This app stores donor, grantee and financial records, so we're especially interested in:
- bypasses of row-level security, storage policies or the database's business rules (see below);
- authentication or invite flaws, such as claiming a team member's seat;
- ways to reach the public intake endpoints without the shared secret;
- stored cross-site scripting through notes, meeting notes or uploaded documents;
- leaks of signed URLs or of the secret key to the browser.

## How access is enforced

- **Sign-in is a whitelist.** Only emails in `team_members` can sign in. The `link_team_member` trigger rejects any other new auth user, and only links an invited or email-confirmed user to their team row.
- **Row-level security** on every table requires an active team member. Expenses, QuickBooks data and team management also require an admin.
- **Triggers enforce the business rules** for every signed-in session, even one that calls the Supabase API directly instead of using the app (`supabase/migrations/0009_business_rules.sql`): blind grant voting, admin-only award amounts and disbursement payments, final sent acknowledgement letters and locked contributions, the PRI funding gate, author stamping, and notes-inbox file ownership.
- **Service-role sessions are trusted.** Code that uses `SUPABASE_SECRET_KEY` (`lib/supabase/admin.ts`: cron jobs, public intake, letter and memo PDFs, invites) has no `auth.uid()` and bypasses these rules, so it runs only on the server.
- **Files** live in private buckets and are served through short-lived signed URLs.
- **Browser hardening** (`proxy.ts`, `next.config.ts`): a per-request nonce Content Security Policy, HSTS, `X-Frame-Options`, and rich text sanitized on save (`lib/security/sanitize-html.ts`) and again in the browser.

Details: [docs/architecture.md](docs/architecture.md).

## If you run an installation

- Keep `SUPABASE_SECRET_KEY` (`sb_secret_…`), `CRON_SECRET` and the intake secrets (`DONATION_INQUIRY_INGEST_SECRET`, `GRANT_PROPOSAL_INGEST_SECRET`) server-side only, and rotate them if they're exposed. Only `NEXT_PUBLIC_*` values (including the `sb_publishable_…` key) reach the browser.
- Call the public intake endpoints from your website's server, never from browser code.
- Leave public sign-ups disabled in Supabase Auth. The team list is the only way in.
- Deactivate departing team members promptly, from Settings → Team. That cuts their database access immediately.
