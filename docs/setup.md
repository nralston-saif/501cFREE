# Setting up your installation

Allow about 30 minutes for the core setup. Each optional integration adds 5 to 60 minutes; QuickBooks is the longest.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). A free-tier project is enough for most small organizations.
2. Apply the migrations in `supabase/migrations/` **in filename order**. Use either method:
   - **SQL editor:** paste each file and run it.
   - **Supabase CLI:**
     ```bash
     supabase link --project-ref <your-ref>
     supabase db push
     ```
3. **Authentication → Sign In / Providers:**
   - Keep **Email** enabled.
   - Turn **off** "Allow new users to sign up". Only people you add to the team can sign in. The database rejects any other email anyway, but turn this off too.
4. **Authentication → URL Configuration:**
   - Set **Site URL** to your app's address, e.g. `https://office.example.org` (with your base path if you use one).
   - Add `https://office.example.org/auth/callback` under **Redirect URLs**, with your base path if any. Add `http://localhost:3000/auth/callback` for local development. Invite and password-reset links only work for addresses on this list.
5. **Authentication → Emails:** Supabase's built-in email service is heavily rate-limited. For real use, set up custom SMTP, for example with Resend, so invites and password resets arrive reliably.

## 2. Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_USE_SUPABASE` | `true` (anything else runs demo mode) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys: the **publishable** key (`sb_publishable_…`), not the legacy anon key |
| `SUPABASE_SECRET_KEY` | Same page: the **secret** key (`sb_secret_…`). Server-only; never expose it. |
| `NEXT_PUBLIC_SITE_URL` | Your app's public address, without a trailing slash |
| `CRON_SECRET` | Any long random string (`openssl rand -hex 32`) |

Every other variable is optional; `.env.example` explains each one. `NEXT_PUBLIC_*` values are built into the app, so rebuild after changing them. Leaving `NEXT_PUBLIC_USE_SUPABASE` unset runs demo mode: fictional sample data, no login, nothing saved permanently.

## 3. First admin

Start the app first, so the invite link has somewhere to land:

```bash
pnpm install
pnpm dev
```

Then, in a second terminal:

```bash
pnpm bootstrap-admin you@your-org.org "Your Name"
```

This adds you to the team as an admin and emails an invite. The invite link signs you in and asks you to set a password. You can add everyone else afterwards from **Settings → Team**.

Email links work **only once**. If a link says it is invalid or expired (for example, it was opened while the app wasn't running), run the same command again: for someone who already has a login it sends a fresh password-setup link instead. The **Forgot password?** link on the sign-in page does the same.

## 4. Deploy

**Vercel** (recommended):
1. Import the repository.
2. Add the same environment variables.
3. Deploy. `vercel.json` schedules the two background jobs: daily stock prices and the 30-minute QuickBooks pull.

**Other hosts:**
1. Build and start the app:
   ```bash
   pnpm build
   pnpm start
   ```
2. Schedule these calls with `Authorization: Bearer $CRON_SECRET`:
   - `GET /api/cron/stock-prices` daily
   - `GET /api/cron/qbo-pull` every 30 minutes

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

## Backups

Supabase takes daily backups on paid plans. Your financial records live in the database, and your files (receipts, letters, notes) live in Supabase Storage. Make sure your plan's backup retention meets your record-keeping obligations. The IRS generally expects records to be kept for at least 3 to 7 years.
