# Feature map

One block per area: what it does, who can use it, where the code is, and the rules that apply. Paths under `app/(app)/` are signed-in pages; the URL is the folder path (for example `app/(app)/grants-out/new/` is `/grants-out/new`). Actions are in `lib/actions/`.

"Member" means any active team member (admin or staff). See [architecture.md](architecture.md) for the database rules referenced here and [glossary.md](glossary.md) for the terms.

## Contents

[Dashboard](#dashboard) · [Contributions](#contributions-letters-and-stock-gifts) · [Inquiries](#inquiries) · [Expenses](#expenses-categories-and-bulk-invoice-upload) · [Banking](#banking-quickbooks-inbox) · [Reports](#reports-and-csv-exports) · [Grant proposals](#grantmaking-proposals-review-memo-decision) · [Awards](#grantmaking-awards-disbursements-grantee-reports) · [PRIs](#program-related-investments-pris) · [Portfolio](#portfolio) · [Organizations](#organizations) · [People](#people) · [Notes](#notes) · [Notes inbox](#notes-inbox) · [Meetings](#meetings) · [Tickets](#tickets) · [Settings](#settings) · [Account and sign-in](#account-and-sign-in) · [Search](#search) · [Public intake](#public-intake-endpoints) · [Cron jobs](#cron-jobs)

## Dashboard

| | |
|---|---|
| Does | Fiscal-year totals (contributions, expenses, grants paid, active grants); proposals awaiting your vote (shown only to grant reviewers, per `grant_review_mode`); disbursements and grantee reports due in the next 30 days; recent contributions and expenses; a QuickBooks banner when Banking has pending items or the pull is stale; a "create ticket" button. |
| Who | Members. Expense and QuickBooks figures are empty for staff because RLS hides those tables. |
| Route | `app/(app)/page.tsx` |
| Tables | `contributions`, `expenses`, `disbursements`, `grants_out`, `grant_proposals`, `proposal_reviews`, `grantee_reports`, `qbo_inbox`, `qbo_sync_state`, `contacts` |
| Rules | Fiscal year from `org_settings.fiscal_year_start_month` and `timezone` (`lib/utils/fiscal-year.ts`). |

## Contributions, letters and stock gifts

| | |
|---|---|
| Does | Record gifts (check, ACH, wire, card, stock, crypto, in-kind) with vehicle (direct, DAF, private foundation, IRA QCD, employer match, charitable trust, other), donor restriction and quid pro quo details. Generate the Pub 1771 acknowledgement letter PDF, email it, resend it. Stock gifts carry shares, valuation and sale proceeds, with an estimated current value from cached prices. |
| Who | Members |
| Routes | `app/(app)/contributions/` (list), `contributions/new/`, `contributions/[id]/` |
| Components | `contributions/new/ContributionForm.tsx`, `contributions/[id]/LetterPanel.tsx`, `contributions/methods.ts` (labels, `vehicleForbidsQuidProQuo()`), `components/AttachmentsPanel.tsx` |
| Actions | `contributions.ts`: `createContribution`, `updateContribution`. `letters.ts`: `generateLetter`, `sendLetter` (also used for resend). |
| Other code | `lib/pdf/letter-data.ts` (wording), `lib/pdf/AcknowledgementLetter.tsx`, `lib/pdf/principal-contact.ts` ("Attention:" line for organization donors), `lib/letters/signature.ts`, `lib/market/security-prices.ts`, `app/api/letters/[contributionId]/route.ts` (PDF preview) |
| Tables | `contributions`, `stock_contribution_details`, `acknowledgement_letters`, `security_prices`, `attachments`; storage `letters` |
| Rules | Letters need `org_legal_name`, `ein` and `letter_signatory_name` in Settings. From-address is `org_settings.letter_from_email`, else `LETTER_FROM_EMAIL`; sending needs `RESEND_API_KEY`. The PDF is written with the service role to `letters/contributions/{id}/acknowledgement-{year}.pdf`; `body_snapshot` freezes the letter data. Once sent: the letter is final except for resends, and the contribution is locked (database triggers). DAF and QCD gifts can't be quid pro quo (CHECK). Letter wording: the opening and tax paragraphs come from `org_settings.letter_templates` per vehicle group (direct, DAF, IRA QCD, and employer match / private foundation / charitable trust / other), else the defaults in `lib/pdf/letter-templates.ts`; the 501(c)(3) status sentence (plus `public_charity_status` when set) and the goods-or-services statement are always added. Read at generation time; `body_snapshot` keeps a generated letter's wording. The defaults are a starting point based on IRS publications, not legal advice, so have your own advisors review them. Without `RESEND_API_KEY` the email buttons are hidden and sending returns "Email isn't set up". In-kind gifts need a description and get no value on the letter. In demo mode "send" marks the letter sent without emailing. |

## Inquiries

| | |
|---|---|
| Does | Lists gift intentions from your website's donate form; set status (new, contacted, archived); convert one into a donor contact (matched by email, organization linked by name). |
| Who | Members |
| Route | `app/(app)/inquiries/` (`InquiryStatusSelect.tsx`) |
| Actions | `inquiries.ts`: `setInquiryStatus`, `convertInquiryToContact` |
| Tables | `donation_inquiries`, `contacts`, `affiliations` |
| Intake | `POST /api/public/donation-inquiry` (see [Public intake](#public-intake-endpoints)) |

## Expenses, categories and bulk invoice upload

| | |
|---|---|
| Does | Record expenses with a category (which sets the Form 990 functional class), vendor, payment method, status (pending, paid, reimbursed), "paid by" team member and 1099 flag; attach receipts. Manage categories. Bulk upload: drop invoices (PDF, DOCX, images), Claude reads each one, you review the rows and create pending expenses. |
| Who | **Admins only** (`expenses/layout.tsx`; RLS) |
| Routes | `app/(app)/expenses/`, `expenses/new/`, `expenses/[id]/`, `expenses/categories/`, `expenses/upload/`; `expenses/import/` redirects to `upload/` |
| Components | `ExpenseFormFields.tsx`, `functional-class.ts`, `[id]/DeleteExpenseButton.tsx`, `[id]/QboSyncPanel.tsx`, `categories/CategoryRowActions.tsx`, `upload/BulkInvoiceUpload.tsx`, `components/VendorSelect.tsx` |
| Actions | `expenses.ts`: `createExpense`, `updateExpense`, `deleteExpense`, `upsertCategory`, `setCategoryActive`. `invoice-uploads.ts`: `createInvoiceUploadUrl`, `stageInvoiceFile`, `createExpenseFromUpload`, `createVendorForUpload`, `discardInvoiceUpload`. `attachments.ts`: `uploadAttachment`, `deleteAttachment`, `getSignedFileUrl`. `contacts.ts`: `createVendorInline`. |
| Other code | `app/api/invoices/extract/route.ts`, `lib/invoices/*` (`extract.ts`, `formats.ts`, `normalize.ts`, `vendor-groups.ts`), `lib/expenses/table.ts`, `lib/expenses/payment.ts` |
| Tables | `expenses`, `expense_categories`, `attachments`, `contacts`; storage `documents` (`expense/`, `expense-import/`) |
| Rules | Invoices upload straight to `documents/expense-import/` with a signed URL (20 MB limit) and stay there as the expense's attachment. Duplicates are flagged three ways: identical file in the batch, identical file already attached to an expense (SHA-256), and same amount with same vendor or within 7 days. Saving an expense queues a QuickBooks fill-in with `after()`. Expenses created by paying a disbursement show no delete button. Category `system_key = 'grants_paid'` must stay. |

## Banking (QuickBooks inbox)

| | |
|---|---|
| Does | Review transactions pulled from QuickBooks with a suggested action: pay a scheduled disbursement, pay an open invoice, link an existing expense, fund a PRI, record a new expense or contribution, or dismiss. Tabs: to review, auto-applied, done, and "synced from this app" (echoes). |
| Who | **Admins only** (`banking/layout.tsx`; RLS) |
| Route | `app/(app)/banking/` (`InboxRow.tsx`, `InboxItemDetail.tsx`, `SuggestionActions.tsx`, `SyncNowButton.tsx`) |
| Actions | `qbo-inbox.ts`: `syncNow`, `acceptDisbursementMatch`, `acceptExpenseLink`, `acceptInvoicePayment`, `approveAsExpense`, `approveAsContribution`, `acceptPriFunding`, `dismissItem`, `acknowledgeItem`, `applyQboChange`, `reopenItem`. `quickbooks.ts`: `disconnectQuickBooks`, `saveQboMappings`, `saveQboPullSettings`, `retryExpenseSync`, `sendExpenseToQuickBooks`. |
| Other code | `lib/quickbooks/*`, `app/api/quickbooks/connect/route.ts`, `app/api/quickbooks/callback/route.ts`, `app/api/cron/qbo-pull/route.ts` |
| Tables | `qbo_connection`, `qbo_mappings`, `qbo_sync_state`, `qbo_inbox`, plus the records they resolve to |
| Rules | See [quickbooks.md](quickbooks.md). Inbox actions only act on `pending` items. `acceptPriFunding` runs the full PRI funding gate. `applyQboChange` refuses to change a contribution whose letter was sent. |

## Reports and CSV exports

| | |
|---|---|
| Does | For a chosen fiscal year: functional expenses by class and category (990 Part IX style), contributions (cash, stock, restricted vs unrestricted, by donor), grants paid (Schedule I style), PRIs held. 1099 vendor totals have their own calendar-year selector (`?cy=`). CSV downloads. |
| Who | **Admins only**: the page (`reports/layout.tsx`) and every export (the route returns 403 for staff). |
| Route | `app/(app)/reports/page.tsx`; `GET /api/exports/{report}?fy=YYYY` (or `?cy=YYYY` for `1099-vendors`) with `report` = `expenses`, `contributions`, `grants-paid`, `1099-vendors` (`app/api/exports/[report]/route.ts`) |
| Other code | `lib/exports/csv.ts` (quotes every cell, neutralizes spreadsheet formulas), `lib/utils/fiscal-year.ts` (a fiscal year is named by the calendar year it ends in) |
| Rules | 1099 totals: `is_1099_eligible`, not card payments, not pending. |

## Grantmaking: proposals, review, memo, decision

| | |
|---|---|
| Does | Pipeline tabs: Review (new submissions, needs your vote, waiting on others, votes revealed), Diligence, Decided, Awards; filter by program area. External proposals (website) go received → in review (blind vote) → diligence or declined at review. Internal proposals (entered by the team, optionally with an uploaded letter) start in diligence. In diligence the team writes the ten-section memorandum, optionally with an AI research draft, and renders it as a PDF. A reviewer records the decision; when an admin approves, the award is created with it, and a proposal approved by a non-admin reviewer waits on the proposal page for an admin to create its award. A decline email is drafted for the team to send themselves. |
| Who | Members create, start review, comment, write memos, withdraw. **Reviewers** vote, advance, decline at review and decide: everyone on the team by default, or admins only (`org_settings.grant_review_mode`, Settings → Organization → Grant review). Creating the award is admin-only either way. |
| Routes | `app/(app)/grants-out/` (tabs, `ProposalCard.tsx`), `grants-out/new/` (manual or `LetterUploadForm.tsx`), `grants-out/proposals/[id]/` |
| Components | `proposals/[id]/`: `MyReviewForm.tsx`, `AdvanceDeclinePanel.tsx`, `MemoCard.tsx` (autosave via `lib/hooks/useAutosave.ts`), `MemoResearchPanel.tsx`, `MemorandumPanel.tsx`, `DecisionForm.tsx`, `ResponseEmailPanel.tsx`; `components/GrantTabs.tsx`, `components/ApplicantSelect.tsx`, `components/ProgramAreaCheckboxes.tsx`, `components/ContactNotes.tsx` |
| Actions | `grants-out.ts`: `createProposal`, `createProposalWithLetter`, `updateProposal`, `setProposalStatus` (withdraw only), `startReview`, `submitReview`, `advanceToDiligence`, `declineAtReview`, `linkApplicantContact`, `addComment`, `startMemo`, `updateMemo`, `revalidateProposal`, `recordDecision`, `saveResponseEmailDraft`, `markResponseEmailSent`. `memoranda.ts`: `generateGrantMemorandum`. `documents.ts`: `previewDocx`. `contacts.ts`: `createApplicantInline`. |
| API | `app/api/proposals/[id]/research/route.ts` (GET status, POST run; waits up to 800 s), `app/api/proposals/[id]/memorandum/route.ts` (PDF), `app/api/proposals/[id]/decline-email/route.ts` |
| Other code | `lib/grants/voting.ts`, `review-progress.ts` (calls `proposal_review_progress`), `memo.ts` (sections, `isMemoComplete`), `research.ts`, `decline-email.ts`, `intake.ts`; `lib/pdf/GrantMemorandum.tsx`, `lib/pdf/memo-data.ts` |
| Tables | `grant_proposals`, `proposal_reviews`, `proposal_comments`, `proposal_memos`, `grant_research`, `grant_memo_pdfs`, `grants_out`, `attachments`; storage `letters` (`memoranda/{id}/grant-memorandum.pdf`), `documents` (`grant_proposal/{id}/`) |
| Rules | Blind voting, reveal, frozen reviews and status transitions are database-enforced. Advancing needs revealed votes and a linked applicant contact; deciding needs `diligence`, a linked contact and all ten memo sections. Research needs a linked contact; one run at a time (15-minute window). AI drafts never write the memo; "Use draft" plus the member's save does. |

## Grantmaking: awards, disbursements, grantee reports

| | |
|---|---|
| Does | Award page: amount, agreement signed date, status (awarded, active, completed, terminated); schedule disbursements and mark them paid; track grantee reports (progress, final, financial) with uploaded files. An award can also be recorded directly without a proposal. |
| Who | Members record the agreement date and status, schedule and cancel disbursements, manage reports. **Admins** create awards and mark disbursements paid. |
| Routes | `app/(app)/grants-out/awards/new/`, `grants-out/awards/[id]/` |
| Components | `awards/[id]/`: `AwardStatusSelect.tsx`, `AddDisbursementForm.tsx`, `DisbursementActions.tsx`, `ReportActions.tsx`, `ReportFileChips.tsx` |
| Actions | `grants-out.ts`: `createAward`, `setAwardAgreementDate`, `setAwardStatus`, `addDisbursement`, `markDisbursementPaid`, `cancelDisbursement`, `addGranteeReport`, `markReportReceived`, `setGranteeReportStatus`, `deleteGranteeReport` |
| Other code | `lib/grants/disburse.ts` (`applyDisbursementPaid`) |
| Tables | `grants_out`, `disbursements`, `grantee_reports`, `expenses`, `attachments` (`grantee_report/{id}/`) |
| Rules | Paying needs `agreement_signed_date` (app check) and creates a paid expense in the `grants_paid` category linked by `disbursement_id`. Money fields and paying are admin-only in the database. |

## Program-related investments (PRIs)

| | |
|---|---|
| Does | Record a PRI (SAFE, convertible note, equity, loan, other) for a recipient; write the ten-question mission-alignment memo (with optional AI research draft); attach the executed instrument; record board approval; mark funded; then track status (funded, converted, repaid, exited, written off). A memo PDF is filed as an attachment. |
| Who | Members (no admin-only PRI actions) |
| Routes | `app/(app)/pris/`, `pris/new/`, `pris/[id]/` |
| Components | `pris/[id]/`: `PriMemoCard.tsx`, `PriResearchPanel.tsx`, `PriMemoPdfPanel.tsx`, `MarkFundedForm.tsx`, `PriStatusSelect.tsx`; `pris/instruments.ts` |
| Actions | `pris.ts`: `createPri`, `setPriInvestmentDate`, `setPriBoardApprovalDate`, `startPriMemo`, `updatePriMemo`, `revalidatePri`, `markPriFunded`, `setPriStatus`. `memoranda.ts`: `generatePriMemorandum`. |
| API | `app/api/pris/[id]/research/route.ts`, `app/api/pris/[id]/memorandum/route.ts` |
| Other code | `lib/pris/policy.ts` (`requiresBoardApproval`), `memo.ts`, `research.ts`, `instruments.ts`; `lib/pdf/pri-memo-data.ts` |
| Tables | `pris`, `pri_memos`, `pri_research`, `pri_memo_pdfs`, `attachments`; storage `documents` (`pri/{id}/`) |
| Rules | Funding gate (app and `guard_pri_funding` trigger): complete memo, an attachment other than the memo PDF, and board approval at or above `org_settings.pri_board_approval_threshold_cents`. Funding never creates an expense: a PRI is an asset. |

## Portfolio

| | |
|---|---|
| Does | Read-only overview: total granted, disbursed to date, PRI capital (committed + funded + converted), organizations funded; a card per grantee (awards, disbursed vs awarded, overdue reports, program areas) and per PRI. |
| Who | Members |
| Route | `app/(app)/portfolio/page.tsx` |
| Tables | `grants_out`, `disbursements`, `grantee_reports`, `grant_proposals`, `pris`, `contacts` |

## Organizations

| | |
|---|---|
| Does | Card grid of organizations with filter pills (All, Donors, Grantees, Funders, Vendors, Leads, Archived), search and sort. Detail page: logo, profile, role flags, entity type, tax and W-9 fields, tags, Leadership (founders and executives) and Team (everyone else), current and former; Funding (grants, proposals, PRIs, contributions, and expenses paid to them for admins); documents; notes timeline. Edit, archive or delete. |
| Who | Members |
| Routes | `app/(app)/organizations/` (`OrganizationGrid.tsx`, `AddOrganizationModal.tsx`; `?add=1` opens the modal), `organizations/[id]/` (`OrganizationView.tsx`, `OrganizationEditForm.tsx`; `?edit=1`) |
| Components | `components/crm/`: `Avatar.tsx`, `AddPersonModal.tsx`, `EditAffiliationModal.tsx`, `FundingSection.tsx`, `ContactDocuments.tsx`, `ProfileFields.tsx` (`ImageEditor`, `RoleCheckboxes`, `DeleteContactSection`...), `Modal.tsx`, `DetailSkeleton.tsx`, `load.ts` (`loadFunding`, image signing), `types.ts`; `components/TicketTagSelector.tsx` |
| Actions | `crm-create.ts`: `createOrganization`, `createTag`. `contacts.ts`: `updateOrganization`, `uploadContactImage`, `removeContactImage`, `deleteContact`, `createPersonAtOrganization`, `addAffiliation`, `updateAffiliation`, `setAffiliationEnded`, `removeAffiliation` |
| Other code | `lib/contacts/crm.ts` (role flags, `RELATIONSHIP_LABELS`, `LEADERSHIP_RELATIONSHIPS` = founder + executive, entity types, image rules), `lib/contacts/images.ts`, `lib/contacts/lookup.ts` |
| Tables | `contacts` (`kind = 'organization'`), `affiliations`, `attachments`, `tags`; storage `documents` (`contact-images/{id}/`, `contact/{id}/`) |
| Rules | Archive = `is_active = false`. A contact with financial records can't be deleted (archive it). Emails must be unique across contacts (primary and alternative). One primary contact per organization. Images: PNG, JPEG, WebP or GIF, 5 MB, never SVG. The filter pill is remembered in `localStorage` (read with `useSyncExternalStore`). |

## People

| | |
|---|---|
| Does | List of people with an active/archived switch, filter pills (All, Leadership, Staff, Board, Advisors, Donors, Leads; relationship pills use current affiliations), search and sort. Add a person with a duplicate check, optionally creating or linking an organization. Detail page: photo, profile, affiliations, relationship history (introduced by, first met, how we met), giving history, documents, notes. |
| Who | Members |
| Routes | `app/(app)/people/` (`PeopleClient.tsx`, `AddPersonModal.tsx`; `?add=1`, `?search=`), `people/[id]/` (`PersonView.tsx`, `PersonEditForm.tsx`, `IntroducerPicker.tsx`, `RelationshipModal.tsx`) |
| Actions | `crm-create.ts`: `createPerson`, `findPossibleDuplicates`, `createTag`. `contacts.ts`: `updatePerson`, `uploadContactImage`, `removeContactImage`, `deleteContact`, `addAffiliation`, `updateAffiliation`, `setAffiliationEnded`, `removeAffiliation`, `searchContacts` |
| Tables | `contacts` (`kind = 'person'`), `affiliations`, `note_links`, `tags` |
| Rules | A person's name comes from `first_name`/`last_name`; `display_name` is generated. Someone can't introduce themselves. |

`app/(app)/contacts/` holds redirects only: `/contacts` → `/organizations`, `/contacts/new?kind=…` → the right add modal, `/contacts/{id}` → the person or organization page.

## Notes

| | |
|---|---|
| Does | A notes timeline on organizations, people, grant proposals and PRIs. A note has one primary link (the record it was written on) and optional extra links, so it shows on each linked record; proposals and PRIs pre-link their applicant or recipient. A contact's timeline also lists meetings it attended. The composer autosaves 2 seconds after typing stops (creating the note on first save), flushes when the page is hidden or closed, and warns before leaving with unsaved text. |
| Who | Members. Only the author edits or deletes a note (app check). |
| Components | `components/ContactNotes.tsx` (server loader), `components/ContactNotesClient.tsx`, `components/crm/notes/`: `NoteComposer.tsx`, `NotesTimeline.tsx`, `RichTextEditor.tsx` (TipTap), `EditNoteModal.tsx`, `DeleteNoteModal.tsx`, `types.ts` |
| Actions | `notes.ts`: `createNote`, `updateNote`, `setNoteLinks`, `deleteNote`, `noteFileUrl` |
| Tables | `notes`, `note_links`, `note_attachments`, `meetings`, `meeting_attendees` |
| Rules | Content is sanitized on write (`sanitizeRichText`) and with DOMPurify after mount. `author_id` is stamped by trigger. An emptied note is never saved empty; the composer offers to delete it. |

## Notes inbox

| | |
|---|---|
| Does | Drop up to 10 files (PDF, images, text, Markdown, CSV, DOCX, XLSX/XLS; 20 MB each). Claude reads them, searches your contacts, and proposes notes with links and any new contacts. You edit the proposal (autosaved), choose which contacts to create, and file it. |
| Who | Members; each drop is private to its uploader (admins see all) until filed |
| Routes | `app/(app)/notes-inbox/` (`DropZone.tsx`, `IntakeStatusBadge.tsx`), `notes-inbox/[id]/` (`ReviewClient.tsx`) |
| Actions | `note-intake.ts`: `createNoteIntake`, `saveNoteIntakeDraft`, `fileNoteIntake`, `discardNoteIntake`, `searchLinkTargets`, `createContactsFromNote` |
| API | `app/api/note-intake/[id]/process/route.ts` (returns 202, works in `after()`, page polls) |
| Other code | `lib/note-intake-core/*` (`formats.ts`, `proposal.ts`, `review.ts`, `render.ts`, `server.ts`), `lib/note-intake/context.ts` |
| Tables | `note_intakes`, `note_intake_files`, `notes`, `note_links`, `note_attachments`, `contacts`, `affiliations`; storage `note-files` (`{intake_id}/...`) |
| Rules | Status: uploading → processing → ready → filed (or failed). Filing is all-or-nothing; each note needs at least one link; filed notes point at the same stored files. File paths must be in the intake's folder (CHECK). Needs `ANTHROPIC_API_KEY`. |

## Meetings

| | |
|---|---|
| Does | List of meetings with title, date, attendees (contacts) and a notes body. With Liveblocks the body is co-edited live in TipTap; otherwise it's a plain text area. Both autosave about 2 seconds after the last change. |
| Who | Members; delete: creator or admin |
| Route | `app/(app)/meetings/` (`MeetingsClient.tsx`; `?id=` selects a meeting) |
| Components | `components/meetings/CollaborativeTiptapEditor.tsx`, `lib/liveblocks.ts`, `lib/liveblocks-rooms.ts` |
| Actions | `meetings.ts`: `listMeetings`, `createMeeting`, `updateMeetingTitle`, `updateMeetingDate`, `saveMeetingContent`, `deleteMeeting`, `listAttendees`, `addAttendee`, `removeAttendee`, `searchContactsForAttendees` |
| API | `app/api/liveblocks-auth/route.ts` (grants one meeting room to an active member) |
| Tables | `meetings`, `meeting_attendees` |
| Rules | Content sanitized on save. Room ids are `{NEXT_PUBLIC_LIVEBLOCKS_ROOM_PREFIX}meeting-{id}`. If the room doesn't connect within 15 seconds the plain editor is used. |

## Tickets

| | |
|---|---|
| Does | Team to-dos: title, description, status (open, in progress, review, closed), priority, due date, assignee, related contact, tags, flag; comments, and a resolution comment on close. Tabs: Active, Closed, Unassigned, All. "Create ticket" buttons appear on other pages. |
| Who | Members; delete: creator or admin; comments: author edits their own |
| Route | `app/(app)/tickets/` (`TicketsClient.tsx`) |
| Components | `components/CreateTicketButton.tsx`, `components/CreateTicketButtonClient.tsx`, `components/TicketTagSelector.tsx` |
| Actions | `tickets.ts`: `createTicket`, `updateTicket`, `closeTicket`, `deleteTicket`, `listTicketComments`, `addTicketComment`, `updateTicketComment`, `deleteTicketComment`, `listTags`, `createTag`, `searchTicketContacts` |
| Other code | `lib/email/ticket-assigned.ts` |
| Tables | `tickets`, `ticket_comments`, `tags`, `contacts` |
| Rules | `closed_at` set by trigger; `created_by` stamped by trigger. Assignment emails go out when someone else is assigned, only if `RESEND_API_KEY` and a from-address in Settings are set. |

## Settings

| | |
|---|---|
| Does | Organization identity, address, mission, time zone, fiscal year, PRI threshold, IRS classification, grant review mode, letter signatory and from-address, letter wording per vehicle (`LetterTemplatesCard.tsx`); signature image; program areas (add, rename, reorder, deactivate, delete if unused); QuickBooks connection and mappings; team (invite, role, deactivate); governance documents. |
| Who | **Admins only** (`settings/layout.tsx`) |
| Routes | `app/(app)/settings/` (`OrgSettingsForm.tsx`, `SignatureCard.tsx`, `ProgramAreasCard.tsx`, `QuickBooksCard.tsx`, `TeamCard.tsx`, `TeamMemberRow.tsx`, `AddTeamMemberForm.tsx`) |
| Actions | `settings.ts`: `updateSettingsAction`, `updateLetterTemplatesAction`, `createProgramArea`, `updateProgramArea`, `setProgramAreaActive`, `moveProgramArea`, `deleteProgramArea`, `uploadSignatureAction`, `removeSignatureAction`. `team.ts`: `addTeamMemberAction`, `setTeamMemberActiveAction`, `setTeamMemberRoleAction`. Governance files use `attachments.ts` with `entity_type = 'governance'` and the nil UUID. |
| Tables | `org_settings`, `program_areas`, `team_members`, `attachments`; storage `letters` (`assets/signature`) |
| Rules | These forms use `useActionState` with `{ error, ok }` results. Inviting adds the `team_members` row, then sends a Supabase invite (an existing login is linked instead). Deactivating sets `is_active = false` and bans the login; at least one active admin must remain. You can't deactivate yourself. |

## Account and sign-in

| | |
|---|---|
| Does | Email + password sign-in, "Forgot password?", invite and reset links, set-password page, change password, sign out. No self sign-up and no magic-link login. |
| Who | Anyone on the team list |
| Routes | `app/login/page.tsx`, `app/auth/callback/route.ts`, `app/auth/confirm/page.tsx`, `app/auth/set-password/`, `app/auth/signout/route.ts`, `app/access-denied/page.tsx`, `app/(app)/account/` |
| Actions | `account.ts`: `changePasswordAction` (checks the current password), `setPasswordAction` (only within an hour of an email-link sign-in) |
| Other code | `lib/site-url.ts` (`authCallbackUrl`, `safeNextPath`), `scripts/onboard.mjs` (first admin with a password), `scripts/bootstrap-admin.mjs` (admin by invite email) |

## Search

| | |
|---|---|
| Does | ⌘K / Ctrl+K or the header button: searches contact names and emails, note text and meeting titles (2+ characters). Contact results open `/contacts/{id}` (which redirects); notes open the record they're filed under. |
| Who | Members |
| Code | `components/SearchModal.tsx`, `app/api/search/route.ts` |
| Tables | `contacts`, `notes`, `note_links`, `meetings`, `grant_proposals`, `pris` |

## Public intake endpoints

Called server-to-server from your website. Both use the service role, compare the secret in constant time (`lib/security/secrets.ts`), fail closed when the secret env var is unset, and return `201 {"ok": true}`, `400` (bad JSON), `401` (wrong secret), `422 {"error": ...}` (invalid input) or `500`.

| Endpoint | Header | Creates | Notes |
|---|---|---|---|
| `POST /api/public/donation-inquiry` (`app/api/public/donation-inquiry/route.ts`) | `x-inquiry-secret` | `donation_inquiries` row, status `new` | Needs `name` and a valid `email` |
| `POST /api/public/grant-proposal` (`app/api/public/grant-proposal/route.ts`, parsing in `lib/grants/intake.ts`) | `x-proposal-secret` | `grant_proposals` row, `origin = 'external'`, status `received` | Needs `applicant_name`, `applicant_email`, `title`. Unknown or inactive program-area slugs are dropped. No contact is linked; a member links one later. |

Body fields: [setup.md](setup.md#website-forms).

## Cron jobs

Scheduled in `vercel.json`; each checks `Authorization: Bearer $CRON_SECRET` (`lib/cron/auth.ts`) and uses the service role.

| Job | Schedule | Does |
|---|---|---|
| `GET /api/cron/stock-prices` (`app/api/cron/stock-prices/route.ts`) | daily, 03:00 UTC | Refreshes the latest price for each ticker still held (unsold stock gifts) into `security_prices`. Needs `FMP_API_KEY`. |
| `GET /api/cron/qbo-pull` (`app/api/cron/qbo-pull/route.ts`) | every 30 minutes | Pulls changed QuickBooks transactions into `qbo_inbox` (`lib/quickbooks/pull.ts`), refreshing the OAuth token as it goes. Skips (and so doesn't refresh the token) until QuickBooks is connected and the pull is turned on. |
