# Glossary

Plain-English definitions of the US nonprofit, tax and finance terms used in this codebase, and where each one shows up in the app.

> **Not tax or legal advice.** These summaries help you read the code. They are simplified and may be out of date. Before relying on any of them, check the IRS source and have your accountant or lawyer review your setup.

## Organizations and tax status

| Term | What it is | Where it shows up |
|---|---|---|
| **501(c)(3)** | The section of the US Internal Revenue Code for charities: organizations with religious, educational, scientific or other charitable purposes. They don't pay federal income tax, and gifts to them are usually tax-deductible for the donor. | The project's name. The acknowledgement letter states the organization's 501(c)(3) status (`lib/pdf/letter-data.ts`). Contacts carry a `tax_status` (`lib/utils/tax-status.ts`). |
| **Public charity vs private foundation** | Two kinds of 501(c)(3). A *public charity* gets broad public support (many donors, government grants, program revenue). A *private foundation* is usually funded by one family or company, files Form 990-PF, and has stricter rules (for example on self-dealing and minimum payouts). | Your own classification is `org_settings.public_charity_status` (Settings → Organization → IRS classification); letters name it, or mention only 501(c)(3) when it's unset (`lib/pdf/letter-data.ts`). Contacts can be tagged `501c3_public_charity` or `501c3_private_foundation`. A gift can come through a private foundation (`contributions.vehicle = 'private_foundation'`). |
| **EIN** | Employer Identification Number: the 9-digit federal tax ID (`12-3456789`) for an organization. | Your own EIN is `org_settings.ein` (Settings → Organization) and is printed on letters. A grantee's or vendor's EIN is `contacts.tax_id`; it appears in the grants-paid and 1099 exports. |
| **Fiscal year** | The 12-month accounting year an organization reports on. It doesn't have to start in January. | `org_settings.fiscal_year_start_month`. `lib/utils/fiscal-year.ts` works out fiscal-year ranges for Reports and the CSV exports. 1099 totals always use the calendar year. |

## Donations

| Term | What it is | Where it shows up |
|---|---|---|
| **Acknowledgement letter (IRS Pub 1771)** | A donor needs a written acknowledgement from the charity to deduct any single gift of $250 or more. IRS Publication 1771 says what it must contain: the organization's name, the amount of cash (or a *description*, not a value, of non-cash property), and a statement of whether the organization gave any goods or services in return. The letter must arrive before the donor files their return. | `lib/pdf/letter-data.ts` (wording, covered by `letter-data.test.ts`; a starting point based on IRS publications, not legal advice: have your own accountant or counsel review it), `lib/pdf/AcknowledgementLetter.tsx` (PDF), `lib/actions/letters.ts` (generate and send). The panel is on the contribution page (`app/(app)/contributions/[id]/LetterPanel.tsx`). |
| **Quid pro quo contribution** | A payment that is partly a gift and partly a purchase, for example a $200 gala ticket that includes a $60 dinner. If the payment is over $75, the charity must tell the donor in writing that only the amount above the value of the goods or services is deductible, and give a good-faith estimate of that value. | `contributions.quid_pro_quo`, `goods_services_description`, `goods_services_value_cents`. The database requires both details when the flag is on. The letter switches to the quid pro quo paragraph. |
| **In-kind gift** | A gift of property or goods instead of money, such as equipment or books. (Donated time and services are generally not deductible.) The charity describes the property but does **not** state its value; valuing it is the donor's job. | `contributions.method = 'in_kind'`, `in_kind_description` (required). `amount_cents` may be null only for in-kind gifts. The letter adds a note saying no value is assigned. |
| **Stock gift** | A gift of shares. The donor's deduction is usually the fair-market value on the transfer date; the charity often sells the shares soon after. | `contributions.method = 'stock'` plus a `stock_contribution_details` row (shares, valuation date, fair-market value, sale proceeds). Optional daily prices come from Financial Modeling Prep into `security_prices` (`lib/market/security-prices.ts`, `app/api/cron/stock-prices/route.ts`). The letter describes the shares without a value. |
| **DAF (donor-advised fund)** | An account at a sponsoring charity (often run by a brokerage). The donor already took the deduction when they put money into the DAF, so a grant from it gives the donor no new deduction and can't carry benefits back to the donor. | `contributions.vehicle = 'daf'`, `vehicle_sponsor_name`. The database blocks quid pro quo on DAF gifts (`vehicle_no_quid_pro_quo` in `supabase/migrations/0003_fundraising.sql`). By default the letter thanks the sponsor for a grant recommended by the donor, says it isn't separately deductible, and states no goods or services went to anyone. |
| **IRA QCD (qualified charitable distribution)** | A transfer from a donor aged 70½ or older straight from their IRA to a charity. It counts toward their required distribution and isn't taxable income. It can't come with benefits back to the donor. | `contributions.vehicle = 'ira_qcd'`; quid pro quo is blocked like DAFs. By default the letter says a QCD is excluded from income rather than deducted, and states no goods or services were provided. |
| **Employer match** | A company matching an employee's gift. The company is the donor of the matched amount. | `contributions.vehicle = 'employer_match'`. By default the letter thanks the paying organization (`vehicle_sponsor_name`, else the donor on record) and makes no deductibility claim; the same goes for private foundation, charitable trust and other vehicles. |
| **Donor restriction** | A condition the donor puts on how or when a gift may be used (for example "for the reading program only"). Restricted gifts are tracked separately in the books (net assets with donor restrictions). | `contributions.restriction` (`unrestricted` or `donor_restricted`) and `restriction_purpose`. |

## Expenses and the Form 990

| Term | What it is | Where it shows up |
|---|---|---|
| **Form 990** | The annual information return most tax-exempt organizations file with the IRS. Small organizations may file the shorter 990-EZ or the 990-N postcard instead. | The Reports page (`app/(app)/reports/page.tsx`) and CSV exports (`app/api/exports/[report]/route.ts`) are shaped to help fill it in. |
| **Functional expense classes** | The 990 splits every expense into three classes: **program services** (the mission work itself), **management & general** (administration, accounting, legal, insurance) and **fundraising** (raising money). | `expense_categories.functional_class` (`program`, `management_general`, `fundraising`); labels in `app/(app)/expenses/functional-class.ts`. Each expense takes the class of its category. In QuickBooks they map to three Classes. |
| **Part IX** | The 990's *Statement of Functional Expenses*: expense lines (grants, salaries, fees, travel...) by functional class. | Default categories in `supabase/migrations/0091_default_data.sql` carry their Part IX line in `form_990_line`. The Reports page shows a 990-style functional expense summary. |
| **Schedule I** | The 990 schedule listing grants to US organizations and individuals (recipient, EIN, amount, purpose). | The `grants-paid` CSV export. Paid disbursements create expenses in the category with `system_key = 'grants_paid'` (Part IX line 1). |
| **1099-NEC** | The form a payer files to report payments for services to a non-employee (contractors, freelancers) above an IRS dollar threshold per calendar year. Card payments are reported by the card processor on Form 1099-K instead. | `expenses.is_1099_eligible`. The `1099-vendors` export totals eligible, non-card, non-pending expenses per vendor for a calendar year. It lists totals; you apply the current IRS threshold. |
| **W-9** | The IRS form a vendor gives you with their legal name and tax ID, so you can file their 1099. | `contacts.w9_on_file`, shown on organization pages and in the 1099 export. |

## Grantmaking

| Term | What it is | Where it shows up |
|---|---|---|
| **Grant proposal** | A request for funding from an applicant. | `grant_proposals`; the pipeline at `app/(app)/grants-out/page.tsx`. Website submissions arrive through `POST /api/public/grant-proposal`. |
| **Blind review / recusal** | Each reviewer scores and votes without seeing the others' votes, so early votes don't sway later ones. A reviewer with a conflict of interest *recuses* (steps aside) instead of voting. | `proposal_reviews` (`score`, `vote`, `recused`). Votes stay hidden until every reviewer (every active member, or only active admins, per `org_settings.grant_review_mode`) has voted or recused, enforced in `supabase/migrations/0009_business_rules.sql` via `is_grant_voter()` (`0005`). UI: `app/(app)/grants-out/proposals/[id]/MyReviewForm.tsx`. |
| **Grant memorandum** | The written case for (or against) a grant, prepared during diligence. | `proposal_memos` (ten sections, registry in `lib/grants/memo.ts`); PDF in `lib/pdf/GrantMemorandum.tsx`. |
| **Grant agreement** | The signed contract with the grantee: amount, purpose, reporting duties, conditions. | `grants_out.agreement_signed_date`. The app refuses to mark a disbursement paid until it's set (`lib/grants/disburse.ts`), which also covers QuickBooks matches. |
| **Award** | The decision to give a specific amount to a grantee. | `grants_out` (`app/(app)/grants-out/awards/[id]/page.tsx`). |
| **Disbursement** | One payment of an award. An award can be paid in installments. | `disbursements` (`scheduled`, `paid`, `cancelled`). Paying one creates the matching *Grants paid* expense (`lib/grants/disburse.ts`). |
| **Grantee report** | A progress, final or financial report the grantee owes you by a due date. | `grantee_reports`, managed on the award page. |
| **Program area** | Your own grantmaking focus areas (for example "Early literacy"). | `program_areas`, edited in Settings. Proposals and awards are tagged by slug; the database rejects unknown slugs. |

## Program-related investments

| Term | What it is | Where it shows up |
|---|---|---|
| **PRI (program-related investment)** | An investment (loan, equity, SAFE...) made mainly to further the charitable mission, not to earn income. Because the organization expects the money back, a PRI is carried as an **asset** on the balance sheet, not recorded as a grant or an expense. | `pris`, `app/(app)/pris/**`. Funding never creates an expense. The funding gate (memo, executed instrument, board approval) is in `lib/actions/pris.ts` and the `guard_pri_funding` trigger. |
| **Mission-alignment memo** | The written record of why an investment is program-related: exempt purpose, why an investment rather than a grant, why income isn't a significant purpose, and so on. | `pri_memos` (ten questions, registry in `lib/pris/memo.ts`). All ten must be answered before funding. |
| **SAFE** | Simple Agreement for Future Equity: money now in exchange for shares later, usually at the next priced funding round. | `pris.instrument = 'safe'` (labels in `lib/pris/instruments.ts`). |
| **Convertible note** | A loan that can convert into shares later instead of being repaid in cash. | `pris.instrument = 'convertible_note'`. |
