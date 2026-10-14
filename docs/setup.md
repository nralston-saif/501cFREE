# Setting up your installation

Allow about 15 minutes for the core setup. Each optional integration adds 5 to 60 minutes; QuickBooks is the longest.

You need [Node.js](https://nodejs.org) 20.11 or newer and [pnpm](https://pnpm.io/installation).

## 1. Get the code

```bash
git clone https://github.com/nralston-saif/501cFREE.git
cd 501cFREE
pnpm install
```

Run every command below from this folder.

## 2. Create the database

1. Create a project at [supabase.com](https://supabase.com). A free-tier project is enough for most small organizations.
2. Open **SQL Editor** in your project, paste the whole of `supabase/setup.sql`, and click **Run**.

`supabase/setup.sql` is every file in `supabase/migrations/`, in filename order, in one script. It's for a new, empty project, and it runs as one transaction: if anything fails, nothing is applied.

**Alternatives:**
- **One file at a time:** paste each file in `supabase/migrations/` into the SQL editor, in filename order. Use this for upgrades: run only the new files.
- **Supabase CLI:**
  ```bash
  supabase link --project-ref <your-ref>
  supabase db push
  ```

## 3. Run `pnpm onboard`

```bash
pnpm onboard
```

It walks you through the rest and checks each step:

1. **Keys.** Asks for your project URL (the dashboard address from your browser works too), the **publishable** key (`sb_publishable_…`) and the **secret** key (`sb_secret_…`), both under Project Settings → API Keys, and your site URL (default `http://localhost:3000`). It tests each key, generates a `CRON_SECRET`, and writes `.env.local`.
2. **Database.** Checks that `supabase/setup.sql` has been run, and links you to the SQL editor if not.
3. **Sign-in settings.** Checks that public sign-ups are off (Authentication → Sign In / Providers → "Allow new users to sign up"), and shows what to enter under Authentication → URL Configuration: **Site URL** = your site URL, and `<site URL>/auth/callback` under **Redirect URLs**. Password-reset and invite links only work for addresses on that list.
4. **Your admin login.** Asks for your name, email and a password, adds you to the team as an admin and creates your login. No email is sent.

Then start the app and sign in:

```bash
pnpm dev
```

Run `pnpm onboard` again whenever you like: press Enter to keep each current value. It's also how to reset your own password if you're locked out.

**Before you invite your team:** Supabase's built-in email service is heavily rate-limited. Set up custom SMTP under **Authentication → Emails**, for example with Resend, so invites and password resets arrive reliably.

### Environment variables

`pnpm onboard` writes these to `.env.local`. To set them by hand instead, copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_USE_SUPABASE` | `true` (anything else runs demo mode) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys: the **publishable** key (`sb_publishable_…`), not the legacy anon key |
| `SUPABASE_SECRET_KEY` | Same page: the **secret** key (`sb_secret_…`). Server-only; never expose it. |
| `NEXT_PUBLIC_SITE_URL` | Your app's public address, without a trailing slash |
| `CRON_SECRET` | Any long random string (`openssl rand -hex 32`) |

Every other variable is optional; `.env.example` explains each one. `NEXT_PUBLIC_*` values are built into the app, so rebuild after changing them. Leaving `NEXT_PUBLIC_USE_SUPABASE` unset runs demo mode: fictional sample data, no login, nothing saved permanently.

### Alternative: an invite email instead of a password

`pnpm bootstrap-admin` adds an admin and emails them an invite link instead of setting a password. It reads `.env.local`, so set that up first (by hand or with `pnpm onboard`). Start the app, so the link has somewhere to land, then in a second terminal:

```bash
pnpm bootstrap-admin you@your-org.org "Your Name"
```

Email links work **only once**. If a link says it is invalid or expired (for example, it was opened while the app wasn't running), run the same command again: for someone who already has a login it sends a fresh password-setup link instead. The **Forgot password?** link on the sign-in page does the same.

## 4. Deploy

**Vercel** (recommended):
1. Import the repository.
2. Add the same environment variables, with `NEXT_PUBLIC_SITE_URL` set to your production address.
3. In Supabase, Authentication → URL Configuration: set **Site URL** to the production address and add `<production address>/auth/callback` under **Redirect URLs**.
4. Deploy. `vercel.json` schedules the two background jobs: daily stock prices and a daily QuickBooks pull. Vercel's free Hobby plan only allows daily jobs; on a paid plan you can make the QuickBooks pull more frequent by changing its schedule in `vercel.json` to `*/30 * * * *` (every 30 minutes). Either way, **Sync now** on the Banking page pulls immediately.

   **Function time limit.** Vercel's free plan stops a server function after 300 seconds, so the AI routes are capped at 300 (`maxDuration` in `app/api/proposals/[id]/research/route.ts`, `app/api/pris/[id]/research/route.ts` and `app/api/note-intake/[id]/process/route.ts`). The grant and PRI research assistant can take 4–7 minutes, so on the free plan a long run may be cut off; it's marked failed after 15 minutes and you can run it again or draft the memo yourself. On a paid plan, raise those values to `800` for full-length research.

**Other hosts:**
1. Build and start the app:
   ```bash
   pnpm build
   pnpm start
   ```
2. Schedule these calls with `Authorization: Bearer $CRON_SECRET`:
   - `GET /api/cron/stock-prices` daily
   - `GET /api/cron/qbo-pull` daily, or as often as every 30 minutes

**Serving under a sub-path** (e.g. `https://example.org/office`): set `NEXT_PUBLIC_BASE_PATH=/office` before building. Add the prefix to the cron paths in `vercel.json` and to every redirect URL above.

## 5. Configure the organization

Sign in and open **Settings** (admins only):

- **Organization:**
  - Legal name, EIN, address and country. Letters and memoranda can't be generated until the legal name is set; acknowledgement letters also need the EIN and a signatory name.
  - Display name and other spellings (used to recognize your organization on invoices).
  - Website and **mission statement**. The AI research features measure fit against the mission.
  - Time zone and fiscal-year start month.
  - The PRI board-approval threshold.
  - IRS classification (optional): 509(a)(1), 509(a)(2), 509(a)(3) or private foundation. Letters always state your 501(c)(3) status and add this only when it's set.
  - **Grant review:** who votes on and advances grant proposals, everyone on the team (default) or admins only. Awards and payments stay admin-only.
- **Acknowledgement letters:** signatory name and title, from-address and closing line. You can upload a signature image (PNG or JPEG, up to 1 MB). The from-address is also the sender for ticket-assignment emails. The **letter wording** card holds the opening and tax paragraphs for each kind of gift (direct, donor-advised fund, IRA QCD, employer match / foundation / trust / other), prefilled with defaults, with placeholders such as `{donor}` and `{gift}` and a "Reset to default" button. The defaults are a starting point based on IRS publications, not legal advice: have your accountant or counsel review them. Letters already sent keep their wording.
- **Program areas:** your grantmaking focus areas, e.g. "Early literacy". Proposals and awards are tagged with them.
- **Team:** invite members as admin or staff.
- **Governance documents:** bylaws, IRS determination letter, board minutes.

Also review **Expenses → Categories**. They come preloaded with common Form 990 Part IX lines.

## 6. Optional integrations

| Feature | Set | Notes |
|---|---|---|
| Emailing letters and ticket notices | `RESEND_API_KEY` | Verify your sending domain in Resend and set the from-address in Settings. `LETTER_FROM_EMAIL` is a fallback for letters only. |
| AI: invoice reading, notes inbox, research memos, decline emails | `ANTHROPIC_API_KEY` | Documents you upload are sent to Anthropic's API for processing |
| Live co-editing of meeting notes | `LIVEBLOCKS_SECRET_KEY` (`sk_…`) | Without it, meeting notes are a plain autosaving text area. Set `NEXT_PUBLIC_LIVEBLOCKS_ROOM_PREFIX` only if several installations share one Liveblocks project. |
| Stock gift valuation | `FMP_API_KEY` | Financial Modeling Prep; prices are cached daily. Without it, enter stock values by hand. |
| QuickBooks Online | `QBO_*` | See [quickbooks.md](quickbooks.md) |
| Website donate form | `DONATION_INQUIRY_INGEST_SECRET` | See below |
| Website grant-proposal form | `GRANT_PROPOSAL_INGEST_SECRET` | See below |

### Website forms

Your public website can send submissions straight into the app. Each endpoint takes JSON. Call it **from your website's server**, never from the browser, because the secret header must stay private.

**`POST /api/public/donation-inquiry`**, header `x-inquiry-secret: <DONATION_INQUIRY_INGEST_SECRET>`:

```json
{
  "name": "Jane Donor",
  "email": "jane@example.org",
  "phone": "optional",
  "organization": "optional",
  "gift_method": "check | wire_ach | daf | stock_crypto | other",
  "amount": "$5,000",
  "message": "optional"
}
```

**`POST /api/public/grant-proposal`**, header `x-proposal-secret: <GRANT_PROPOSAL_INGEST_SECRET>`:

```json
{
  "applicant_name": "Sam Applicant",
  "applicant_email": "sam@example.org",
  "organization_name": "optional",
  "title": "Reading tutors for grade 1",
  "summary": "optional",
  "program_areas": ["early-literacy"],
  "amount_requested": "$50,000"
}
```

Both endpoints return `201 {"ok": true}` on success, `400` for a body that isn't JSON, `401` for a wrong or unset secret, and `422 {"error": "..."}` for invalid input. Required fields: `name` and `email` for inquiries; `applicant_name`, `applicant_email` and `title` for proposals. `program_areas` takes the slugs from Settings → Program areas; unknown or inactive slugs are dropped. Proposal submissions appear in the grant pipeline as *Received*, with no contact linked until a team member links one. Inquiries appear under **Donations → Inquiries**.

> **Add people from the app, not from Supabase.** Don't use Supabase's own *Invite user* or *Add user* buttons (Authentication → Users): the database only allows logins for people on the team list, so those fail with "Email … is not on the team". `pnpm onboard` creates your own admin login; invite everyone else from **Settings → Team** in the app.

## Upgrading

1. `git pull` (or merge the new release into your fork) and `pnpm install`.
2. Check [CHANGELOG.md](../CHANGELOG.md) for new database migrations since your version, and apply each new file in `supabase/migrations/` in filename order: paste it into the SQL editor and run it, or use `supabase db push` if you set up with the CLI. Don't re-run `supabase/setup.sql` on an existing database; it is for fresh installs only.
3. Redeploy (or restart `pnpm dev`).

## Troubleshooting

| Problem | Fix |
|---|---|
| `No .env.local found` | Run `pnpm onboard` from the project folder. It creates the file. |
| "Supabase rejected the publishable key" or "secret key" | Copy the key again from Project Settings → API Keys. The publishable key starts with `sb_publishable_`, the secret key with `sb_secret_`; check both are from the same project as the URL. Then run `pnpm onboard` again. |
| `Email … is not on the team` (or Supabase says "Database error creating new user") | Only emails in the team list can have a login. Add the person from **Settings → Team** (or run `pnpm onboard` for yourself) instead of creating users in the Supabase dashboard. |
| A sign-in, invite or reset link says it is invalid or expired | Email links work once and expire. Request a new one with **Forgot password?** on the sign-in page, or ask an admin to re-send the invite. Make sure `<site URL>/auth/callback` is under Authentication → URL Configuration → Redirect URLs, and open the link while the app is running. As the first admin, `pnpm onboard` sets a new password without any email. |
| `pnpm onboard` says sign-ups are still on | Authentication → Sign In / Providers: turn off "Allow new users to sign up" and click **Save**. It can take a few seconds to apply. |
| The app shows the demo data and no login | `NEXT_PUBLIC_USE_SUPABASE` isn't `true` in `.env.local` (or your host's environment). Set it and restart `pnpm dev`; on a host, rebuild, since `NEXT_PUBLIC_*` values are built in. |
| `pnpm onboard` says the database is missing or only partly set up | Paste the whole of `supabase/setup.sql` into the SQL editor and run it. On a project that already has some of the tables, run the missing files from `supabase/migrations/` instead. |

## Backups

Supabase takes daily backups on paid plans. Your financial records live in the database, and your files (receipts, letters, notes) live in Supabase Storage. Make sure your plan's backup retention meets your record-keeping obligations. The IRS generally expects records to be kept for at least 3 to 7 years.
