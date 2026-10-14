import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addMember, asService, asUser, createTestDb, type Member } from './db'

let db: PGlite
let admin: Member
let staff: Member

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows
}

/** Who votes on grant proposals (org_settings.grant_review_mode); set as the service role. */
async function reviewMode(mode: 'all_members' | 'admins') {
  await asService(db)
  await db.query(`update org_settings set grant_review_mode = $1`, [mode])
}

beforeAll(async () => {
  db = await createTestDb()
  admin = await addMember(db, 'admin@example.org', 'admin')
  staff = await addMember(db, 'staff@example.org', 'staff')
}, 60_000)

// Tests that need the admins-only voting body switch to it themselves
afterEach(async () => {
  await reviewMode('all_members')
})

describe('sign-up gate', () => {
  it('links a team member to their auth user by email', async () => {
    await asService(db)
    const [m] = await rows<{ auth_user_id: string }>(
      `select auth_user_id from team_members where id = $1`,
      [admin.memberId]
    )
    expect(m.auth_user_id).toBe(admin.userId)
  })

  it('rejects an email that is not on the team', async () => {
    await asService(db)
    await expect(db.query(`insert into auth.users (email) values ('stranger@example.org')`)).rejects.toThrow(
      /not on the team/
    )
  })

  it('only links a team email once it is invited or confirmed', async () => {
    await asService(db)
    const [m] = await rows<{ id: string }>(
      `insert into team_members (email, full_name) values ('later@example.org', 'Later') returning id`
    )
    // An unconfirmed sign-up for a team email gets no access...
    const [u] = await rows<{ id: string }>(`insert into auth.users (email) values ('later@example.org') returning id`)
    let [row] = await rows<{ auth_user_id: string | null }>(`select auth_user_id from team_members where id = $1`, [m.id])
    expect(row.auth_user_id).toBeNull()
    await asUser(db, u.id)
    expect(await rows(`select * from contacts`)).toHaveLength(0)

    // ...until the address is confirmed
    await asService(db)
    await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [u.id])
    ;[row] = await rows<{ auth_user_id: string | null }>(`select auth_user_id from team_members where id = $1`, [m.id])
    expect(row.auth_user_id).toBe(u.id)

    // Already-confirmed users (e.g. created confirmed by an admin) link at once
    await db.query(`insert into team_members (email, full_name) values ('confirmed@example.org', 'C')`)
    const [c] = await rows<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at) values ('Confirmed@example.org', now()) returning id`
    )
    ;[row] = await rows<{ auth_user_id: string | null }>(
      `select auth_user_id from team_members where email = 'confirmed@example.org'`
    )
    expect(row.auth_user_id).toBe(c.id)
  })
})

describe('row-level security', () => {
  it('blocks anonymous access', async () => {
    await asUser(db, null)
    expect(await rows(`select * from contacts`)).toHaveLength(0)
    await expect(db.query(`insert into contacts (kind, name) values ('organization', 'X')`)).rejects.toThrow()
  })

  it('lets staff work with contacts but not expenses or QuickBooks', async () => {
    await asUser(db, staff.userId)
    await db.query(`insert into contacts (kind, name) values ('organization', 'Staff Org')`)
    expect(await rows(`select * from contacts where name = 'Staff Org'`)).toHaveLength(1)

    const [cat] = await rows<{ id: string }>(`select id from expense_categories limit 1`)
    await expect(
      db.query(
        `insert into expenses (expense_date, amount_cents, description, category_id) values (current_date, 100, 'x', $1)`,
        [cat.id]
      )
    ).rejects.toThrow(/row-level security/)
    expect(await rows(`select * from qbo_sync_state`)).toHaveLength(0)
  })

  it('lets admins record expenses', async () => {
    await asUser(db, admin.userId)
    const [cat] = await rows<{ id: string }>(`select id from expense_categories limit 1`)
    await db.query(
      `insert into expenses (expense_date, amount_cents, description, category_id) values (current_date, 100, 'Admin expense', $1)`,
      [cat.id]
    )
    expect(await rows(`select * from expenses`)).toHaveLength(1)
    await asUser(db, staff.userId)
    expect(await rows(`select * from expenses`)).toHaveLength(0)
  })

  it('keeps team management admin-only', async () => {
    await asUser(db, staff.userId)
    await db.query(`update team_members set role = 'admin' where id = $1`, [staff.memberId])
    await asService(db)
    const [m] = await rows<{ role: string }>(`select role from team_members where id = $1`, [staff.memberId])
    expect(m.role).toBe('staff')
  })

  it('always keeps one active admin', async () => {
    await asService(db)
    await expect(db.query(`update team_members set role = 'staff' where id = $1`, [admin.memberId])).rejects.toThrow(
      /active admin/
    )
    await expect(
      db.query(`update team_members set is_active = false where id = $1`, [admin.memberId])
    ).rejects.toThrow(/active admin/)
  })

  it('only lets admins vote on proposals (admins mode)', async () => {
    await reviewMode('admins')
    await asUser(db, admin.userId)
    const [p] = await rows<{ id: string }>(
      `insert into grant_proposals (title, applicant_email) values ('Vote', 'v@example.org') returning id`
    )
    await asUser(db, staff.userId)
    await expect(
      db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'yes')`, [
        p.id,
        staff.memberId,
      ])
    ).rejects.toThrow(/row-level security/)
  })

  it('deactivated members lose access', async () => {
    const temp = await addMember(db, 'temp@example.org', 'staff')
    await asService(db)
    await db.query(`update team_members set is_active = false where id = $1`, [temp.memberId])
    await asUser(db, temp.userId)
    expect(await rows(`select * from contacts`)).toHaveLength(0)
  })

  it('keeps notes-inbox items private to their uploader', async () => {
    await asUser(db, admin.userId)
    await db.query(`insert into note_intakes (created_by) values ($1)`, [admin.memberId])
    await asUser(db, staff.userId)
    expect(await rows(`select * from note_intakes`)).toHaveLength(0)
    await db.query(`insert into note_intakes (created_by) values ($1)`, [staff.memberId])
    expect(await rows(`select * from note_intakes`)).toHaveLength(1)
    // Claiming someone else as the uploader just records yourself
    const [spoofed] = await rows<{ created_by: string }>(
      `insert into note_intakes (created_by) values ($1) returning created_by`,
      [admin.memberId]
    )
    expect(spoofed.created_by).toBe(staff.memberId)
  })

  it('only lets people write their own reviews and comments (admins mode)', async () => {
    await reviewMode('admins')
    await asUser(db, admin.userId)
    const [p] = await rows<{ id: string }>(
      `insert into grant_proposals (title, applicant_email) values ('P', 'a@example.org') returning id`
    )
    await db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'yes')`, [
      p.id,
      admin.memberId,
    ])
    await asUser(db, staff.userId)
    await expect(
      db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'no')`, [
        p.id,
        admin.memberId,
      ])
    ).rejects.toThrow(/row-level security/)
    // Blind until revealed: staff can't see the admin's vote yet
    expect(await rows(`select * from proposal_reviews`)).toHaveLength(0)
    await asUser(db, admin.userId)
    expect(await rows(`select * from proposal_reviews where proposal_id = $1`, [p.id])).toHaveLength(1)
  })
})

describe('storage policies', () => {
  it('keeps expense files admin-only within the documents bucket', async () => {
    await asUser(db, staff.userId)
    await db.query(`insert into storage.objects (bucket_id, name) values ('documents', 'contribution/1/a.pdf')`)
    await expect(
      db.query(`insert into storage.objects (bucket_id, name) values ('documents', 'expense/1/r.pdf')`)
    ).rejects.toThrow(/row-level security/)
    await expect(
      db.query(`insert into storage.objects (bucket_id, name) values ('documents', 'expense-import/x.pdf')`)
    ).rejects.toThrow(/row-level security/)
    await asUser(db, admin.userId)
    await db.query(`insert into storage.objects (bucket_id, name) values ('documents', 'expense/1/r.pdf')`)
  })

  it('ties note files to the uploader until they are filed', async () => {
    await asUser(db, staff.userId)
    const [intake] = await rows<{ id: string }>(
      `insert into note_intakes (created_by) values ($1) returning id`,
      [staff.memberId]
    )
    const name = `${intake.id}/u-file.pdf`
    await db.query(`insert into storage.objects (bucket_id, name) values ('note-files', $1)`, [name])
    await db.query(
      `insert into note_intake_files (intake_id, storage_path, file_name) values ($1, $2, 'file.pdf')`,
      [intake.id, name]
    )
    await asUser(db, admin.userId)
    expect(await rows(`select * from storage.objects where name = $1`, [name])).toHaveLength(1)

    const other = await addMember(db, 'other@example.org', 'staff')
    await asUser(db, other.userId)
    expect(await rows(`select * from storage.objects where name = $1`, [name])).toHaveLength(0)
    await expect(
      db.query(`insert into storage.objects (bucket_id, name) values ('note-files', $1)`, [`${intake.id}/x.pdf`])
    ).rejects.toThrow(/row-level security/)

    // Once filed on a note, the whole team can open it
    await asUser(db, staff.userId)
    const [note] = await rows<{ id: string }>(`insert into notes (content) values ('n') returning id`)
    await db.query(
      `insert into note_attachments (note_id, storage_path, file_name) values ($1, $2, 'file.pdf')`,
      [note.id, name]
    )
    await asUser(db, other.userId)
    expect(await rows(`select * from storage.objects where name = $1`, [name])).toHaveLength(1)
  })
})

describe('contacts', () => {
  it('derives display names for people and organizations', async () => {
    await asUser(db, staff.userId)
    const [p] = await rows<{ display_name: string }>(
      `insert into contacts (kind, first_name, last_name) values ('person', 'Ada', 'Lovelace') returning display_name`
    )
    expect(p.display_name).toBe('Ada Lovelace')
    const [o] = await rows<{ display_name: string }>(
      `insert into contacts (kind, name) values ('organization', 'Analytical Society') returning display_name`
    )
    expect(o.display_name).toBe('Analytical Society')
    await expect(db.query(`insert into contacts (kind) values ('person')`)).rejects.toThrow(/contacts_named/)
  })

  it('only affiliates people with organizations', async () => {
    await asUser(db, staff.userId)
    const [p] = await rows<{ id: string }>(
      `insert into contacts (kind, first_name) values ('person', 'P') returning id`
    )
    const [o] = await rows<{ id: string }>(`insert into contacts (kind, name) values ('organization', 'O') returning id`)
    await db.query(`insert into affiliations (person_id, organization_id) values ($1, $2)`, [p.id, o.id])
    await expect(
      db.query(`insert into affiliations (person_id, organization_id) values ($1, $2)`, [o.id, p.id])
    ).rejects.toThrow(/must reference a person/)
    await expect(db.query(`update contacts set kind = 'organization', first_name = null where id = $1`, [p.id])).rejects.toThrow(
      /affiliations/
    )
  })

  it('cannot delete a contact with financial history, and cleans up links otherwise', async () => {
    await asUser(db, staff.userId)
    const [donor] = await rows<{ id: string }>(
      `insert into contacts (kind, name, is_donor) values ('organization', 'Donor', true) returning id`
    )
    await db.query(
      `insert into contributions (contact_id, amount_cents, received_date, method) values ($1, 5000, current_date, 'check')`,
      [donor.id]
    )
    await expect(db.query(`delete from contacts where id = $1`, [donor.id])).rejects.toThrow(/foreign key/)

    const [c] = await rows<{ id: string }>(`insert into contacts (kind, name) values ('organization', 'Temp') returning id`)
    const [note] = await rows<{ id: string }>(`insert into notes (content) values ('hello') returning id`)
    await db.query(`insert into note_links (note_id, entity_type, entity_id) values ($1, 'contact', $2)`, [
      note.id,
      c.id,
    ])
    await db.query(`delete from contacts where id = $1`, [c.id])
    expect(await rows(`select * from note_links where entity_id = $1`, [c.id])).toHaveLength(0)
  })
})

describe('domain rules', () => {
  it('validates program areas on proposals', async () => {
    await asUser(db, admin.userId)
    await db.query(`insert into program_areas (slug, label) values ('education', 'Education')`)
    await db.query(
      `insert into grant_proposals (title, applicant_email, program_areas) values ('Ok', 'a@example.org', '{education}')`
    )
    await expect(
      db.query(
        `insert into grant_proposals (title, applicant_email, program_areas) values ('Bad', 'a@example.org', '{nope}')`
      )
    ).rejects.toThrow(/Unknown program area/)
  })

  it('stamps closed_at when a ticket closes', async () => {
    await asUser(db, staff.userId)
    const [t] = await rows<{ id: string }>(`insert into tickets (title) values ('T') returning id`)
    const [closed] = await rows<{ closed_at: string | null }>(
      `update tickets set status = 'closed' where id = $1 returning closed_at`,
      [t.id]
    )
    expect(closed.closed_at).not.toBeNull()
    const [reopened] = await rows<{ closed_at: string | null }>(
      `update tickets set status = 'open' where id = $1 returning closed_at`,
      [t.id]
    )
    expect(reopened.closed_at).toBeNull()
  })

  it('maintains updated_at', async () => {
    await asUser(db, admin.userId)
    const [before] = await rows<{ updated_at: string }>(`select updated_at from org_settings`)
    await new Promise((r) => setTimeout(r, 5))
    await db.query(`update org_settings set org_display_name = 'Acme'`)
    const [after] = await rows<{ updated_at: string }>(`select updated_at from org_settings`)
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime())
  })

  it('stores the IRS classification for letters, unset by default', async () => {
    await asUser(db, admin.userId)
    const [row] = await rows<{ public_charity_status: string | null }>(
      `select public_charity_status from org_settings`
    )
    expect(row.public_charity_status).toBeNull()
    await db.query(`update org_settings set public_charity_status = '509a2'`)
    await expect(db.query(`update org_settings set public_charity_status = '509a9'`)).rejects.toThrow(/check/)
    await db.query(`update org_settings set public_charity_status = null`)
  })

  it('stores letter wording overrides as a JSON object, empty by default', async () => {
    await asUser(db, admin.userId)
    const [row] = await rows<{ letter_templates: unknown }>(`select letter_templates from org_settings`)
    expect(row.letter_templates).toEqual({})
    await db.query(`update org_settings set letter_templates = '{"daf": {"tax": ""}}'`)
    await expect(db.query(`update org_settings set letter_templates = '[]'`)).rejects.toThrow(/check/)
    await db.query(`update org_settings set letter_templates = '{}'`)
    // Staff can't change it (admins-only settings policy)
    await asUser(db, staff.userId)
    expect(await rows(`update org_settings set letter_templates = '{"x": 1}' returning id`)).toHaveLength(0)
  })

  it('seeds the grants-paid category by key', async () => {
    await asService(db)
    expect(await rows(`select * from expense_categories where system_key = 'grants_paid'`)).toHaveLength(1)
  })
})

describe('grant review mode', () => {
  async function inReview(): Promise<string> {
    await asUser(db, admin.userId)
    const [p] = await rows<{ id: string }>(
      `insert into grant_proposals (title, applicant_email, status) values ('Mode', 'm@example.org', 'in_review') returning id`
    )
    return p.id
  }
  const revealed = async (id: string) =>
    (await rows<{ votes_revealed: boolean }>(`select votes_revealed from grant_proposals where id = $1`, [id]))[0]
      .votes_revealed

  /** Recuse, as the service role, every active member other than the two test users */
  async function recuseOthers(id: string) {
    await asService(db)
    await db.query(
      `insert into proposal_reviews (proposal_id, reviewer_id, recused)
       select $1, id, true from team_members where is_active and id <> all($2::uuid[])`,
      [id, [admin.memberId, staff.memberId]]
    )
  }

  it('defaults to everyone on the team', async () => {
    await asService(db)
    const [row] = await rows<{ grant_review_mode: string }>(`select grant_review_mode from org_settings`)
    expect(row.grant_review_mode).toBe('all_members')
    await expect(db.query(`update org_settings set grant_review_mode = 'board'`)).rejects.toThrow(/check/)
  })

  it('all_members: staff vote, the reveal waits for every active member, and staff advance', async () => {
    const id = await inReview()
    await recuseOthers(id)
    await asUser(db, staff.userId)
    await db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'yes')`, [
      id,
      staff.memberId,
    ])
    expect(await revealed(id)).toBe(false) // the admin hasn't weighed in
    await asUser(db, admin.userId)
    await db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'no')`, [
      id,
      admin.memberId,
    ])
    expect(await revealed(id)).toBe(true)

    // Any member decides; making the award is still admin-only
    await asUser(db, staff.userId)
    await db.query(`update grant_proposals set status = 'diligence' where id = $1`, [id])
    await db.query(`update grant_proposals set status = 'decided', decision = 'approved' where id = $1`, [id])
    const [c] = await rows<{ id: string }>(`insert into contacts (kind, name) values ('organization', 'Mode grantee') returning id`)
    await expect(
      db.query(`insert into grants_out (proposal_id, grantee_contact_id, amount_awarded_cents) values ($1, $2, 100)`, [
        id,
        c.id,
      ])
    ).rejects.toThrow(/row-level security/)
  })

  it('admins: staff are blocked and the reveal counts admins only', async () => {
    await reviewMode('admins')
    const id = await inReview()
    await asUser(db, staff.userId)
    await expect(
      db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'yes')`, [
        id,
        staff.memberId,
      ])
    ).rejects.toThrow(/row-level security/)
    await expect(db.query(`update grant_proposals set status = 'withdrawn', decision = 'declined' where id = $1`, [id])).rejects.toThrow(
      /Only grant reviewers/
    )
    // Every other active admin recuses; the last admin's vote reveals
    await asService(db)
    await db.query(
      `insert into proposal_reviews (proposal_id, reviewer_id, recused)
       select $1, id, true from team_members where is_active and role = 'admin' and id <> $2`,
      [id, admin.memberId]
    )
    expect(await revealed(id)).toBe(false)
    await asUser(db, admin.userId)
    await db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'yes')`, [
      id,
      admin.memberId,
    ])
    expect(await revealed(id)).toBe(true)
  })

  it('reveals at once when narrowing the voters completes a vote', async () => {
    const id = await inReview()
    await asService(db)
    await db.query(
      `insert into proposal_reviews (proposal_id, reviewer_id, recused)
       select $1, id, true from team_members where is_active and role = 'admin'`,
      [id]
    )
    expect(await revealed(id)).toBe(false) // staff still to vote
    await asUser(db, admin.userId)
    await db.query(`update org_settings set grant_review_mode = 'admins'`)
    expect(await revealed(id)).toBe(true)
  })

  it('only admins can change the mode', async () => {
    await asUser(db, staff.userId)
    const updated = await rows(`update org_settings set grant_review_mode = 'admins' returning id`)
    expect(updated).toHaveLength(0)
    await asService(db)
    const [row] = await rows<{ grant_review_mode: string }>(`select grant_review_mode from org_settings`)
    expect(row.grant_review_mode).toBe('all_members')
  })
})

describe('business rules', () => {
  async function inReviewProposal(): Promise<string> {
    await asUser(db, admin.userId)
    const [p] = await rows<{ id: string }>(
      `insert into grant_proposals (title, applicant_email, status) values ('Rules', 'r@example.org', 'in_review') returning id`
    )
    return p.id
  }

  it('reveals votes only when every admin has weighed in (admins mode)', async () => {
    await reviewMode('admins')
    const proposalId = await inReviewProposal()
    await expect(
      db.query(`update grant_proposals set votes_revealed = true where id = $1`, [proposalId])
    ).rejects.toThrow(/revealed automatically/)

    const second = await addMember(db, 'admin2@example.org', 'admin')
    await asUser(db, admin.userId)
    await db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'yes')`, [
      proposalId,
      admin.memberId,
    ])
    // Progress shows who voted, never how
    await asUser(db, staff.userId)
    expect(await rows(`select * from proposal_review_progress(array[$1]::uuid[])`, [proposalId])).toHaveLength(1)
    let [p] = await rows<{ votes_revealed: boolean }>(`select votes_revealed from grant_proposals where id = $1`, [proposalId])
    expect(p.votes_revealed).toBe(false)

    // A saved comment without a vote or recusal doesn't count
    await asUser(db, second.userId)
    await db.query(`insert into proposal_reviews (proposal_id, reviewer_id, comments) values ($1, $2, 'thinking')`, [
      proposalId,
      second.memberId,
    ])
    ;[p] = await rows<{ votes_revealed: boolean }>(`select votes_revealed from grant_proposals where id = $1`, [proposalId])
    expect(p.votes_revealed).toBe(false)

    await db.query(`update proposal_reviews set recused = true, comments = null where reviewer_id = $1`, [
      second.memberId,
    ])
    ;[p] = await rows<{ votes_revealed: boolean }>(`select votes_revealed from grant_proposals where id = $1`, [proposalId])
    expect(p.votes_revealed).toBe(true)
    await asUser(db, staff.userId)
    expect(await rows(`select * from proposal_reviews where proposal_id = $1`, [proposalId])).toHaveLength(2)

    await asService(db)
    await db.query(`update team_members set is_active = false where id = $1`, [second.memberId])
  })

  it('only lets admins advance or decide proposals (admins mode)', async () => {
    await reviewMode('admins')
    await asUser(db, admin.userId)
    const [p] = await rows<{ id: string }>(
      `insert into grant_proposals (title, applicant_email, status) values ('Decide', 'd@example.org', 'diligence') returning id`
    )
    await asUser(db, staff.userId)
    await expect(
      db.query(`update grant_proposals set status = 'decided', decision = 'approved' where id = $1`, [p.id])
    ).rejects.toThrow(/Only grant reviewers/)
    await asUser(db, admin.userId)
    await db.query(`update grant_proposals set status = 'decided', decision = 'approved' where id = $1`, [p.id])
  })

  it('gates PRI funding on the memo, the instrument and board approval', async () => {
    await asUser(db, admin.userId)
    await db.query(`update org_settings set pri_board_approval_threshold_cents = 100000`)
    const [c] = await rows<{ id: string }>(`insert into contacts (kind, name) values ('organization', 'Investee') returning id`)
    const [pri] = await rows<{ id: string }>(
      `insert into pris (recipient_contact_id, instrument, amount_cents) values ($1, 'safe', 500000) returning id`,
      [c.id]
    )
    const fund = () =>
      db.query(`update pris set status = 'funded', funded_date = current_date where id = $1`, [pri.id])

    await expect(fund()).rejects.toThrow(/Board approval/)
    await db.query(`update pris set board_approval_date = current_date where id = $1`, [pri.id])
    await expect(fund()).rejects.toThrow(/memo must be complete/)
    await db.query(
      `insert into pri_memos (pri_id, q_exempt_purpose, q_why_investment, q_income_not_significant, q_use_of_funds,
         q_key_terms, q_success_outcomes, q_risks, q_exit_plan, q_conflicts, q_monitoring)
       values ($1, 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a')`,
      [pri.id]
    )
    await expect(fund()).rejects.toThrow(/executed instrument/)
    await db.query(
      `insert into attachments (entity_type, entity_id, storage_path, file_name) values ('pri', $1, 'pri/x/safe.pdf', 'safe.pdf')`,
      [pri.id]
    )
    await fund()
  })

  it('freezes a contribution once its letter is sent', async () => {
    await asUser(db, staff.userId)
    const [c] = await rows<{ id: string }>(`insert into contacts (kind, name) values ('organization', 'Giver') returning id`)
    const [gift] = await rows<{ id: string }>(
      `insert into contributions (contact_id, amount_cents, received_date, method) values ($1, 1000, current_date, 'check') returning id`,
      [c.id]
    )
    await db.query(`insert into acknowledgement_letters (contribution_id, status) values ($1, 'sent')`, [gift.id])
    await expect(db.query(`update contributions set amount_cents = 2000 where id = $1`, [gift.id])).rejects.toThrow(
      /can no longer be edited/
    )
    await db.query(`update contributions set qbo_txn_id = 'Q1', notes = 'reconciled' where id = $1`, [gift.id])
    await expect(db.query(`delete from contributions where id = $1`, [gift.id])).rejects.toThrow(/can't be deleted/)
  })

  it('only lets admins write to the letters bucket', async () => {
    await asUser(db, staff.userId)
    await expect(
      db.query(`insert into storage.objects (bucket_id, name) values ('letters', 'assets/signature')`)
    ).rejects.toThrow(/row-level security/)
    await asUser(db, admin.userId)
    await db.query(`insert into storage.objects (bucket_id, name) values ('letters', 'assets/signature')`)
  })

  it('rejects note attachments pointing at someone else\'s inbox files', async () => {
    await asUser(db, admin.userId)
    const [intake] = await rows<{ id: string }>(`insert into note_intakes (created_by) values ($1) returning id`, [
      admin.memberId,
    ])
    const path = `${intake.id}/private.pdf`
    await db.query(`insert into note_intake_files (intake_id, storage_path, file_name) values ($1, $2, 'p.pdf')`, [
      intake.id,
      path,
    ])
    await asUser(db, staff.userId)
    const [note] = await rows<{ id: string }>(`insert into notes (content) values ('x') returning id`)
    await expect(
      db.query(`insert into note_attachments (note_id, storage_path, file_name) values ($1, $2, 'p.pdf')`, [
        note.id,
        path,
      ])
    ).rejects.toThrow(/your own notes inbox/)
  })
})

describe('security rules', () => {
  // Active admins at this point: just `admin` (the second admin added above
  // was deactivated), so one admin vote completes a review
  // A proposal created by the service role (skipping the user-session rules)
  async function proposal(status: string, fields: { votes_revealed?: boolean; decision?: string } = {}): Promise<string> {
    await asService(db)
    const [p] = await rows<{ id: string }>(
      `insert into grant_proposals (title, applicant_email, status, votes_revealed, decision)
       values ('Sec', 's@example.org', $1, $2, $3) returning id`,
      [status, fields.votes_revealed ?? false, fields.decision ?? null]
    )
    return p.id
  }
  const proposalRow = async (id: string) =>
    (await asService(db),
    (await rows<{ status: string; votes_revealed: boolean }>(`select status, votes_revealed from grant_proposals where id = $1`, [id]))[0])
  async function contactId(): Promise<string> {
    await asService(db)
    const [c] = await rows<{ id: string }>(`insert into contacts (kind, name) values ('organization', 'Grantee') returning id`)
    return c.id
  }

  describe('blind voting', () => {
    it('blocks the withdraw-and-reveal trick', async () => {
      const id = await proposal('in_review')
      await asUser(db, staff.userId)
      await expect(
        db.query(`update grant_proposals set status = 'withdrawn', votes_revealed = true where id = $1`, [id])
      ).rejects.toThrow(/revealed automatically/)
      // Withdrawing alone is fine, but it can't come back into review
      await db.query(`update grant_proposals set status = 'withdrawn' where id = $1`, [id])
      await expect(db.query(`update grant_proposals set status = 'in_review' where id = $1`, [id])).rejects.toThrow(
        /moved into review/
      )
      await asUser(db, admin.userId)
      await expect(db.query(`update grant_proposals set status = 'in_review' where id = $1`, [id])).rejects.toThrow(
        /moved into review/
      )
      expect(await proposalRow(id)).toEqual({ status: 'withdrawn', votes_revealed: false })
    })

    it('never lets a user session flip votes_revealed, at any status or direction', async () => {
      for (const status of ['received', 'in_review', 'diligence', 'withdrawn']) {
        const id = await proposal(status)
        for (const who of [staff, admin]) {
          await asUser(db, who.userId)
          await expect(
            db.query(`update grant_proposals set votes_revealed = true where id = $1`, [id])
          ).rejects.toThrow(/revealed automatically/)
        }
      }
      const revealed = await proposal('diligence', { votes_revealed: true })
      await asUser(db, admin.userId)
      await expect(
        db.query(`update grant_proposals set votes_revealed = false where id = $1`, [revealed])
      ).rejects.toThrow(/revealed automatically/)
      // New proposals can't start revealed while review is still ahead
      await expect(
        db.query(
          `insert into grant_proposals (title, applicant_email, status, votes_revealed) values ('x', 'x@example.org', 'in_review', true)`
        )
      ).rejects.toThrow(/revealed automatically/)
      // Service-role sessions are trusted
      await asService(db)
      await db.query(`update grant_proposals set votes_revealed = false where id = $1`, [revealed])
    })

    it('ignores a hand-set reveal flag unless every admin has voted', async () => {
      const id = await proposal('in_review')
      await asUser(db, admin.userId)
      await db.exec(`begin`)
      try {
        await db.query(`select set_config('app.revealing_votes', 'on', true)`)
        await expect(
          db.query(`update grant_proposals set votes_revealed = true where id = $1`, [id])
        ).rejects.toThrow(/revealed automatically/)
      } finally {
        await db.exec(`rollback`)
      }
    })

    it('still reveals automatically when the last admin votes (admins mode)', async () => {
      await reviewMode('admins')
      const id = await proposal('in_review')
      await asUser(db, admin.userId)
      await db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'yes')`, [
        id,
        admin.memberId,
      ])
      expect(await proposalRow(id)).toEqual({ status: 'in_review', votes_revealed: true })
      // ...and the flag doesn't linger for the rest of the transaction
      expect((await rows<{ v: string }>(`select current_setting('app.revealing_votes', true) as v`))[0].v).not.toBe('on')
    })

    it('freezes reviews once the votes are revealed (admins mode)', async () => {
      await reviewMode('admins')
      const id = await proposal('in_review')
      await asUser(db, admin.userId)
      await db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'no')`, [
        id,
        admin.memberId,
      ])
      expect((await proposalRow(id)).votes_revealed).toBe(true)
      await asUser(db, admin.userId)
      await expect(
        db.query(`update proposal_reviews set vote = 'yes' where proposal_id = $1`, [id])
      ).rejects.toThrow(/can no longer be changed/)
      await expect(db.query(`delete from proposal_reviews where proposal_id = $1`, [id])).rejects.toThrow(
        /can no longer be changed/
      )
      const late = await addMember(db, 'late-admin@example.org', 'admin')
      await asUser(db, late.userId)
      await expect(
        db.query(`insert into proposal_reviews (proposal_id, reviewer_id, vote) values ($1, $2, 'yes')`, [
          id,
          late.memberId,
        ])
      ).rejects.toThrow(/can no longer be changed/)
      await asService(db)
      await db.query(`update team_members set is_active = false where id = $1`, [late.memberId])

      // Deleting the whole proposal still cascades to its reviews
      await asUser(db, admin.userId)
      await db.query(`delete from grant_proposals where id = $1`, [id])
      await asService(db)
      expect(await rows(`select * from proposal_reviews where proposal_id = $1`, [id])).toHaveLength(0)
    })
  })

  describe('proposal pipeline', () => {
    it('lets staff start a review, withdraw, and create internal proposals', async () => {
      const id = await proposal('received')
      await asUser(db, staff.userId)
      await db.query(`update grant_proposals set status = 'in_review' where id = $1`, [id])
      await db.query(`update grant_proposals set title = 'Renamed' where id = $1`, [id])
      await db.query(`update grant_proposals set status = 'withdrawn' where id = $1`, [id])
      // createProposal: internal proposals skip review, already revealed
      await db.query(
        `insert into grant_proposals (title, applicant_email, origin, status, votes_revealed)
         values ('Internal', 'i@example.org', 'internal', 'diligence', true)`
      )
    })

    it('keeps advancing, deciding and skipping review for admins (admins mode)', async () => {
      await reviewMode('admins')
      const received = await proposal('received')
      const inReview = await proposal('in_review')
      const decided = await proposal('decided', { decision: 'declined' })
      await asUser(db, staff.userId)
      const blocked = [
        [`update grant_proposals set status = 'diligence' where id = $1`, received],
        [`update grant_proposals set status = 'diligence' where id = $1`, inReview],
        [`update grant_proposals set status = 'decided', decision = 'declined' where id = $1`, inReview],
        [`update grant_proposals set status = 'withdrawn' where id = $1`, decided],
        [`update grant_proposals set decision = 'approved' where id = $1`, decided],
      ]
      for (const [sql, id] of blocked) {
        await expect(db.query(sql, [id])).rejects.toThrow(/Only grant reviewers/)
      }
      await expect(
        db.query(
          `insert into grant_proposals (title, applicant_email, status, decision) values ('x', 'x@example.org', 'decided', 'approved')`
        )
      ).rejects.toThrow(/Only grant reviewers/)
      await asUser(db, admin.userId)
      await db.query(`update grant_proposals set status = 'diligence' where id = $1`, [received])
      await db.query(`update grant_proposals set decision = 'approved' where id = $1`, [decided])
    })
  })

  describe('grant money', () => {
    it('keeps making awards and changing their amount admin-only', async () => {
      const grantee = await contactId()
      await asUser(db, staff.userId)
      await expect(
        db.query(`insert into grants_out (grantee_contact_id, amount_awarded_cents) values ($1, 100)`, [grantee])
      ).rejects.toThrow(/row-level security/)
      await asUser(db, admin.userId)
      const [award] = await rows<{ id: string }>(
        `insert into grants_out (grantee_contact_id, amount_awarded_cents) values ($1, 100) returning id`,
        [grantee]
      )
      await asUser(db, staff.userId)
      // Paperwork is open to the team
      await db.query(`update grants_out set agreement_signed_date = current_date, status = 'active' where id = $1`, [
        award.id,
      ])
      await expect(
        db.query(`update grants_out set amount_awarded_cents = 999999 where id = $1`, [award.id])
      ).rejects.toThrow(/Only admins/)
      expect(await rows(`delete from grants_out where id = $1 returning id`, [award.id])).toHaveLength(0)
      await asUser(db, admin.userId)
      await db.query(`update grants_out set amount_awarded_cents = 200 where id = $1`, [award.id])
    })

    it('lets staff schedule and cancel disbursements, but only admins pay them', async () => {
      const grantee = await contactId()
      await asService(db)
      const [award] = await rows<{ id: string }>(
        `insert into grants_out (grantee_contact_id, amount_awarded_cents, agreement_signed_date) values ($1, 1000, current_date) returning id`,
        [grantee]
      )
      await asUser(db, staff.userId)
      await expect(
        db.query(
          `insert into disbursements (grant_out_id, amount_cents, status, paid_date) values ($1, 100, 'paid', current_date)`,
          [award.id]
        )
      ).rejects.toThrow(/Only admins/)
      const [d1] = await rows<{ id: string }>(
        `insert into disbursements (grant_out_id, amount_cents) values ($1, 100) returning id`,
        [award.id]
      )
      const [d2] = await rows<{ id: string }>(
        `insert into disbursements (grant_out_id, amount_cents) values ($1, 100) returning id`,
        [award.id]
      )
      await db.query(`update disbursements set scheduled_date = current_date, method = 'ach' where id = $1`, [d1.id])
      await expect(
        db.query(`update disbursements set status = 'paid', paid_date = current_date where id = $1`, [d1.id])
      ).rejects.toThrow(/Only admins/)
      await expect(db.query(`update disbursements set status = 'paid' where id = $1`, [d1.id])).rejects.toThrow(
        /Only admins/
      )
      await expect(db.query(`update disbursements set amount_cents = 5 where id = $1`, [d1.id])).rejects.toThrow(
        /Only admins/
      )
      expect(await rows(`delete from disbursements where id = $1 returning id`, [d1.id])).toHaveLength(0)
      await db.query(`update disbursements set status = 'cancelled' where id = $1`, [d2.id])
      await expect(db.query(`update disbursements set status = 'scheduled' where id = $1`, [d2.id])).rejects.toThrow(
        /Only admins/
      )

      await asUser(db, admin.userId)
      await db.query(`update disbursements set status = 'paid', paid_date = current_date where id = $1`, [d1.id])

      // Only scheduled -> paid, even for an admin
      await expect(
        db.query(`update disbursements set status = 'paid', paid_date = current_date where id = $1`, [d2.id])
      ).rejects.toThrow(/Only a scheduled disbursement/)

      // One grants-paid expense per disbursement
      const [cat] = await rows<{ id: string }>(`select id from expense_categories where system_key = 'grants_paid'`)
      await db.query(
        `insert into expenses (expense_date, amount_cents, description, category_id, disbursement_id) values (current_date, 100, 'Grant', $1, $2)`,
        [cat.id, d1.id]
      )
      await expect(
        db.query(
          `insert into expenses (expense_date, amount_cents, description, category_id, disbursement_id) values (current_date, 100, 'Grant', $1, $2)`,
          [cat.id, d1.id]
        )
      ).rejects.toThrow(/expenses_disbursement_unique/)
    })
  })

  describe('acknowledgement letters', () => {
    it('keeps a sent letter final so the contribution lock holds', async () => {
      await asUser(db, staff.userId)
      const [c] = await rows<{ id: string }>(`insert into contacts (kind, name) values ('organization', 'Donor2') returning id`)
      const [gift] = await rows<{ id: string }>(
        `insert into contributions (contact_id, amount_cents, received_date, method) values ($1, 1000, current_date, 'check') returning id`,
        [c.id]
      )
      const [letter] = await rows<{ id: string }>(
        `insert into acknowledgement_letters (contribution_id, status, pdf_storage_path, body_snapshot)
         values ($1, 'generated', 'contributions/x/a.pdf', '{}') returning id`,
        [gift.id]
      )
      // generated -> sent is the normal send
      await db.query(
        `update acknowledgement_letters set status = 'sent', sent_to_email = 'd@example.org', sent_at = now() - interval '1 day' where id = $1`,
        [letter.id]
      )
      for (const sql of [
        `update acknowledgement_letters set status = 'generated' where id = $1`,
        `update acknowledgement_letters set pdf_storage_path = 'other.pdf' where id = $1`,
        `update acknowledgement_letters set body_snapshot = '{"amount": 1}' where id = $1`,
        `update acknowledgement_letters set sent_to_email = 'x@example.org' where id = $1`,
        `update acknowledgement_letters set sent_at = now() - interval '2 days' where id = $1`,
        `delete from acknowledgement_letters where id = $1`,
      ]) {
        await expect(db.query(sql, [letter.id])).rejects.toThrow(/was sent/)
      }
      // Resending records a newer send
      await db.query(
        `update acknowledgement_letters set sent_to_email = 'new@example.org', sent_at = now(), resend_message_id = 'm2' where id = $1`,
        [letter.id]
      )
      await expect(db.query(`update contributions set amount_cents = 1 where id = $1`, [gift.id])).rejects.toThrow(
        /can no longer be edited/
      )
      // Admins are held to it too; the service role is trusted
      await asUser(db, admin.userId)
      await expect(
        db.query(`update acknowledgement_letters set status = 'draft' where id = $1`, [letter.id])
      ).rejects.toThrow(/was sent/)
      await asService(db)
      await db.query(`update acknowledgement_letters set resend_message_id = 'fixed' where id = $1`, [letter.id])
    })
  })

  describe('authorship', () => {
    it('records the signed-in member as author or creator', async () => {
      await asUser(db, staff.userId)
      const [note] = await rows<{ id: string; author_id: string }>(
        `insert into notes (content, author_id) values ('spoof', $1) returning id, author_id`,
        [admin.memberId]
      )
      expect(note.author_id).toBe(staff.memberId)
      const [unset] = await rows<{ author_id: string }>(`insert into notes (content) values ('n') returning author_id`)
      expect(unset.author_id).toBe(staff.memberId)
      const [ticket] = await rows<{ created_by: string }>(
        `insert into tickets (title, created_by) values ('T', $1) returning created_by`,
        [admin.memberId]
      )
      expect(ticket.created_by).toBe(staff.memberId)
      const [meeting] = await rows<{ created_by: string }>(
        `insert into meetings (title, meeting_date, created_by) values ('M', now(), $1) returning created_by`,
        [admin.memberId]
      )
      expect(meeting.created_by).toBe(staff.memberId)
      const [contact] = await rows<{ created_by: string }>(
        `insert into contacts (kind, name, created_by) values ('organization', 'Spoof', $1) returning created_by`,
        [admin.memberId]
      )
      expect(contact.created_by).toBe(staff.memberId)

      // ...and it can't be reassigned afterwards
      await expect(db.query(`update notes set author_id = $1 where id = $2`, [admin.memberId, note.id])).rejects.toThrow(
        /can't be changed/
      )
      await db.query(`update notes set content = 'edited' where id = $1`, [note.id])

      // Service-role writes keep the author they were given
      await asService(db)
      const [svc] = await rows<{ author_id: string }>(
        `insert into notes (content, author_id) values ('svc', $1) returning author_id`,
        [admin.memberId]
      )
      expect(svc.author_id).toBe(admin.memberId)
    })
  })

  describe('notes inbox files', () => {
    it('must live under their own intake folder', async () => {
      await asUser(db, staff.userId)
      const [mine] = await rows<{ id: string }>(`insert into note_intakes (created_by) values ($1) returning id`, [
        staff.memberId,
      ])
      await asUser(db, admin.userId)
      const [theirs] = await rows<{ id: string }>(`insert into note_intakes (created_by) values ($1) returning id`, [
        admin.memberId,
      ])
      await asUser(db, staff.userId)
      await expect(
        db.query(`insert into note_intake_files (intake_id, storage_path, file_name) values ($1, $2, 'f.pdf')`, [
          mine.id,
          `${theirs.id}/u-f.pdf`,
        ])
      ).rejects.toThrow(/note_intake_files_in_intake_folder/)
      await expect(
        db.query(`insert into note_intake_files (intake_id, storage_path, file_name) values ($1, 'f.pdf', 'f.pdf')`, [
          mine.id,
        ])
      ).rejects.toThrow(/note_intake_files_in_intake_folder/)
      await db.query(`insert into note_intake_files (intake_id, storage_path, file_name) values ($1, $2, 'f.pdf')`, [
        mine.id,
        `${mine.id}/u-f.pdf`,
      ])
    })
  })

  describe('storage buckets', () => {
    it('limits file sizes and letter/notes file types', async () => {
      await asService(db)
      const buckets = await rows<{ id: string; file_size_limit: number; allowed_mime_types: string[] | null }>(
        `select id, file_size_limit, allowed_mime_types from storage.buckets order by id`
      )
      const byId = Object.fromEntries(buckets.map((b) => [b.id, b]))
      expect(Number(byId.documents.file_size_limit)).toBe(50 * 1024 * 1024)
      expect(Number(byId.letters.file_size_limit)).toBe(25 * 1024 * 1024)
      expect(Number(byId['note-files'].file_size_limit)).toBe(25 * 1024 * 1024)
      expect(byId.letters.allowed_mime_types).toEqual(['application/pdf', 'image/png', 'image/jpeg'])
      for (const b of buckets) {
        expect(b.allowed_mime_types ?? []).not.toContain('image/svg+xml')
        expect(b.allowed_mime_types ?? []).not.toContain('text/html')
      }
    })
  })
})

describe('summaries (0010)', () => {
  // A year no other test writes to, so totals are exact
  const start = '2031-01-01'
  const end = '2032-01-01'
  let donor: string
  let org: string
  let category: string

  beforeAll(async () => {
    await asService(db)
    ;[{ id: donor }] = await rows<{ id: string }>(
      `insert into contacts (kind, first_name, last_name) values ('person', 'Sum', 'Donor') returning id`
    )
    ;[{ id: org }] = await rows<{ id: string }>(
      `insert into contacts (kind, name) values ('organization', 'Summary Org') returning id`
    )
    ;[{ id: category }] = await rows<{ id: string }>(
      `select id from expense_categories where functional_class = 'program' order by name limit 1`
    )
    await db.query(
      `insert into contributions (contact_id, received_date, method, amount_cents, in_kind_description) values
         ($1, '2031-02-01', 'check', 10000, null),
         ($1, '2031-03-01', 'stock', 25000, null),
         ($1, '2031-04-01', 'in_kind', null, 'Books'),
         ($2, '2031-05-01', 'wire', 5000, null),
         ($1, '2030-12-31', 'check', 99900, null)`,
      [donor, org]
    )
    await db.query(
      `insert into expenses (expense_date, amount_cents, description, category_id, status) values
         ('2031-06-01', 1200, 'Paper', $1, 'paid'),
         ('2031-07-01', 800, 'Ink', $1, 'pending'),
         ('2029-01-01', 300, 'Old', $1, 'pending')`,
      [category]
    )
    const [grant] = await rows<{ id: string }>(
      `insert into grants_out (grantee_contact_id, amount_awarded_cents) values ($1, 70000) returning id`,
      [org]
    )
    await db.query(
      `insert into disbursements (grant_out_id, amount_cents, status, scheduled_date, paid_date) values
         ($1, 30000, 'paid', '2031-08-01', '2031-08-01'),
         ($1, 40000, 'scheduled', '2031-09-01', null)`,
      [grant.id]
    )
    await db.query(
      `insert into pris (recipient_contact_id, instrument, amount_cents) values ($1, 'loan', 50000)`,
      [org]
    )
  })

  it('totals a fiscal year in SQL, under the caller’s RLS', async () => {
    await asUser(db, admin.userId)
    const [a] = await rows<Record<string, string>>(`select * from fiscal_year_totals($1, $2)`, [start, end])
    // check + stock + wire; in-kind and the earlier gift are left out
    expect(Number(a.contributions_cents)).toBe(40000)
    expect(Number(a.expenses_cents)).toBe(2000)
    expect(Number(a.grants_paid_cents)).toBe(30000)

    // Staff can't read expenses, so they don't count toward staff totals either
    await asUser(db, staff.userId)
    const [s] = await rows<Record<string, string>>(`select * from fiscal_year_totals($1, $2)`, [start, end])
    expect(Number(s.contributions_cents)).toBe(40000)
    expect(Number(s.expenses_cents)).toBe(0)
  })

  it('summarizes contributions and expenses for a period', async () => {
    await asUser(db, admin.userId)
    const [c] = await rows<Record<string, string>>(`select * from contribution_summary($1, $2)`, [start, end])
    expect([Number(c.cash_cents), Number(c.cash_count), Number(c.stock_cents), Number(c.stock_count)]).toEqual([
      15000, 2, 25000, 1,
    ])
    const [e] = await rows<Record<string, string>>(`select * from expense_summary($1, $2)`, [start, end])
    expect(Number(e.total_cents)).toBe(2000)
    expect(Number(e.program_cents)).toBe(2000)
    expect(Number(e.fundraising_cents)).toBe(0)
    // Unpaid counts every pending expense, whatever its date
    const [{ n, cents }] = await rows<{ n: string; cents: string }>(
      `select count(*) n, coalesce(sum(amount_cents), 0) cents from expenses where status = 'pending'`
    )
    expect(Number(e.unpaid_count)).toBe(Number(n))
    expect(Number(e.unpaid_cents)).toBe(Number(cents))
  })

  it('totals money per contact, optionally by kind', async () => {
    await asUser(db, staff.userId)
    const all = await rows<Record<string, string>>(`select * from contact_money_totals() where contact_id = any($1)`, [
      [donor, org],
    ])
    const byId = Object.fromEntries(all.map((r) => [r.contact_id, r]))
    expect(Number(byId[donor].donated_cents)).toBe(10000 + 25000 + 99900)
    expect(Number(byId[org].donated_cents)).toBe(5000)
    expect(Number(byId[org].granted_cents)).toBe(70000)
    expect(Number(byId[org].pri_cents)).toBe(50000)
    const orgs = await rows<{ contact_id: string }>(
      `select contact_id from contact_money_totals('organization') where contact_id = any($1)`,
      [[donor, org]]
    )
    expect(orgs.map((r) => r.contact_id)).toEqual([org])
  })

  it('counts distinct notes per contact and answered memo sections', async () => {
    await asUser(db, staff.userId)
    const [n1] = await rows<{ id: string }>(`insert into notes (content) values ('<p>a</p>') returning id`)
    const [n2] = await rows<{ id: string }>(`insert into notes (content) values ('<p>b</p>') returning id`)
    await db.query(
      `insert into note_links (note_id, entity_type, entity_id, is_primary) values
         ($1, 'contact', $3, true), ($2, 'contact', $3, true), ($2, 'contact', $4, false)`,
      [n1.id, n2.id, donor, org]
    )
    const counts = await rows<{ contact_id: string; note_count: string }>(
      `select * from contact_note_counts() where contact_id = any($1) order by note_count desc`,
      [[donor, org]]
    )
    expect(counts.map((c) => [c.contact_id, Number(c.note_count)])).toEqual([
      [donor, 2],
      [org, 1],
    ])

    const [p] = await rows<{ id: string }>(
      `insert into grant_proposals (title, status, applicant_email) values ('Memo progress', 'diligence', 'm@example.org') returning id`
    )
    await db.query(
      `insert into proposal_memos (proposal_id, q_summary_recommendation, q_org_background, q_counterfactual)
       values ($1, 'Yes', '   ', E'\\nSee notes')`,
      [p.id]
    )
    const progress = await rows<{ proposal_id: string; answered: number }>(
      `select * from proposal_memo_progress($1)`,
      [[p.id]]
    )
    // Whitespace-only answers don't count, matching memoAnsweredCount()
    expect(progress).toEqual([{ proposal_id: p.id, answered: 2 }])
  })

  it('cannot be called anonymously', async () => {
    await asUser(db, null)
    await expect(db.query(`select * from fiscal_year_totals('2031-01-01', '2032-01-01')`)).rejects.toThrow(
      /permission denied/
    )
  })
})

describe('policy performance', () => {
  it('wraps every argument-less helper call in (select ...) so it runs once per statement', async () => {
    await asService(db)
    const policies = await rows<{ schemaname: string; tablename: string; policyname: string; expr: string }>(
      `select schemaname, tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
       from pg_policies where schemaname in ('public', 'storage')`
    )
    expect(policies.length).toBeGreaterThan(50)
    const bare = policies.filter((p) =>
      /(?<!SELECT )\b(is_team_member|is_admin|current_member_id|is_grant_voter|auth\.uid)\(\)/.test(p.expr)
    )
    expect(bare.map((p) => `${p.schemaname}.${p.tablename}: ${p.policyname}`)).toEqual([])
  })
})
