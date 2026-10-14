# QuickBooks Online integration

Optional. When it's configured, QuickBooks Online (QBO) stays your book of record. This app is where your team records and explains each expense and gift. The integration keeps the two in step without ever double-counting money.

## How it works

**Bank feeds are the source of cash transactions.** The app never creates a QuickBooks transaction on its own, because doing so would duplicate the one the bank feed brings in. (It does create QuickBooks **Vendors** when it fills in a payee it can't find by id or name.) Instead, sync runs in two directions, and each transaction has exactly one owner:

- **Pull (QuickBooks → app).** On a schedule (daily by default; every 30 minutes if your host allows it, see below), and whenever someone clicks *Sync now*, the app reads transactions that changed in QuickBooks (purchases, deposits, transfers, journal entries). It lands each one at **Banking** for review, with a suggestion (`lib/quickbooks/match.ts`):
  - **Pay an open invoice.** Exact amount, paid between 7 days before and 180 days after the invoice date. The match is confident only when exactly one candidate's vendor matches.
  - **Link to an existing expense** (exact amount, within 3 days, same vendor or neither has one), so the same payment isn't recorded twice.
  - **Pay a scheduled grant disbursement** (exact amount). This is the *only* match that can be applied automatically. That requires the auto-apply setting to be on, the transaction to be a QuickBooks Purchase, the payee to be verified (same QuickBooks vendor id, or the same name after normalizing), exactly one verified candidate, and a signed grant agreement. Auto-applied items are not filled in afterwards (see Push).
  - **Fund a program-related investment.** Never automatic: the PRI funding checks still apply.
  - **Record a new expense**, with category and payment method prefilled from your account mappings, or a **new contribution** (a deposit to an income account), with the donor prefilled when the payer matches a contact.
  - **Dismiss**: suggested for transfers, vendor refunds and non-donation income.
- **Push (app → QuickBooks).** After an expense is saved or linked to a pulled Purchase, the app *fills in* that QuickBooks transaction (`lib/quickbooks/sync.ts`): payee, category account, 990 functional Class, line description, and any receipts not already attached. It never changes a bank-feed transaction's amount, date or bank account. Only single-line Purchases are filled in; split transactions keep their categories, and journal entries and deposits aren't touched.
- **Payments no bank feed sees,** such as a wire from an investment account or a reimbursement to a team member, can be sent with **Send to QuickBooks** on the expense page. An admin picks the paid-from account. This is the only path that creates a QuickBooks transaction. Its private note starts with a fixed marker (`lib/quickbooks/echo.ts`) so the next pull recognizes it as the app's own and files it under *Synced from this app* instead of asking for review. The app owns these transactions: editing the expense rewrites the QuickBooks copy (amount and date included, keeping the paid-from account), and deleting the expense deletes it in QuickBooks too. Unpaid invoices awaiting a bank payment can't be sent.

What happens when something changes in QuickBooks:
- If someone changes the amount, date or bank account of a transaction you already resolved (or that was auto-applied or sent from the app), the item returns to Banking as *Changed*. *Apply change* copies the new amount and date to the linked record, except a contribution whose acknowledgement letter was sent.
- If someone deletes a transaction you already resolved or that was auto-applied, it returns as *Deleted*. Items still awaiting review, and transactions sent from the app, are dismissed automatically instead.
- Changes to payee, category or description just refresh the stored copy. So do changes to items you dismissed.
- The app never deletes or rewrites your bank-feed transactions or local records on its own. The only automatic changes are auto-applied disbursements (if you turn that on) and the dismissals above.

Sync failures never block saving. The expense page shows the result with a retry button: *Details not sent* for a bank-feed match, *Sync failed* for a transaction sent from the app. For bank-feed matches an unmapped category isn't a failure: QuickBooks keeps its own category and the page shows a note. Sending a new transaction does require the category to be mapped.

## Setup (about an hour, mostly inside QuickBooks)

### 1. QuickBooks company

- **Subscription.** Class tracking, used for the 990 functional classes, needs **QuickBooks Online Plus** or higher. On a lower plan, leave the class mappings empty and everything else still works.
- **Chart of accounts.** Create one expense account for each active expense category in the app (*Expenses → Categories*). Confirm your bank and card accounts exist; connecting bank feeds usually creates them.
- **Classes** (optional). Under *Settings → Account and settings → Advanced → Categories*, turn on **Track classes**. Then create three classes: `Program`, `Management & General`, `Fundraising`.
- **Reimbursements.** Decide with your accountant how expenses fronted by team members should post, for example to an "Owed to staff" Other Current Liability account.
- **Bank rules.** Set up bank rules (*Transactions → Rules*) for recurring items. Bank-feed lines must be **accepted** in QuickBooks before the API can see them; rules accept them automatically.

### 2. Intuit developer app

At [developer.intuit.com](https://developer.intuit.com), create an app with the **Accounting** scope.

**Development (sandbox) keys:**
1. Add the redirect URI `http://localhost:3000/api/quickbooks/callback`, with your base path inserted if you set one.
2. Put the keys in `.env.local` with `QBO_ENVIRONMENT=sandbox`.

**Production keys:**
1. Complete the *Get production keys* questionnaire. For a private app, your organization's website pages for the end-user license agreement (EULA) and privacy policy are fine.
2. Add the production redirect URI `https://<your-domain><base-path>/api/quickbooks/callback`.

### 3. Environment

```
QBO_CLIENT_ID=...
QBO_CLIENT_SECRET=...
QBO_ENVIRONMENT=production          # or sandbox
# QBO_REDIRECT_URI=...              # only if it differs from <site>/<base>/api/quickbooks/callback
CRON_SECRET=...                     # protects the scheduled pull job
```

The pull job is scheduled in `vercel.json` (prefix the path with your base path if you set one). It runs daily by default because Vercel's free Hobby plan only allows daily jobs; on a paid plan, change its schedule to `*/30 * * * *` for a pull every 30 minutes. On other hosts, call `GET /api/cron/qbo-pull` daily (or up to every 30 minutes) with `Authorization: Bearer $CRON_SECRET`. While the pull is turned on, each run also refreshes the OAuth tokens, so the connection doesn't expire from inactivity. With the pull off, the job does nothing, and an unused connection eventually expires (reconnect in Settings).

### 4. Connect and map (Settings → QuickBooks, admins only)

1. Click **Connect to QuickBooks** and choose your company on Intuit's consent screen.
2. Map each item to its QuickBooks counterpart:
   - every expense category to its expense account;
   - the three functional classes to the three Classes;
   - each payment method, plus the **Default** row, to the account it draws from.
   Leave the class rows empty to skip classes.
3. Set **Pull since** to the date your books in QuickBooks start (it defaults to the day the database was created), then turn on the pull. The pull and auto-apply both start off.
4. Optionally, turn on auto-apply for exact scheduled-disbursement matches.
5. Test with a small real transaction:
   - let it arrive at Banking;
   - record it as an expense;
   - confirm the QuickBooks transaction now shows the payee, account and class.

## Notes

- Mappings are per QuickBooks company. **Disconnect** only removes the connection: the mappings, the pull cursor, existing Banking items and the QuickBooks vendor ids stored on contacts stay. If you move to a different company, review every mapping after reconnecting, and clear stale vendor ids, or the app will send the old company's ids.
- Edits made directly in the database (for example in the Supabase dashboard) don't sync. Use the app.
- Only admins can see expenses, Banking, Reports and QuickBooks settings. The QuickBooks tables are admin-only in the database too.
- Without `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET`, Settings → QuickBooks shows "Not configured" and you can't connect. If you remove the keys while still connected, token refresh fails and every expense save records a sync failure: disconnect first.
