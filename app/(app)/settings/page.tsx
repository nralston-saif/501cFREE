import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import PageHeader from '@/components/PageHeader'
import AttachmentsPanel from '@/components/AttachmentsPanel'
import { loadProgramAreas } from '@/lib/program-areas'
import OrgSettingsForm from './OrgSettingsForm'
import ProgramAreasCard from './ProgramAreasCard'
import SignatureCard from './SignatureCard'
import { SIGNATURE_STORAGE_PATH } from '@/lib/letters/signature'
import QuickBooksCard from './QuickBooksCard'
import LetterTemplatesCard from './LetterTemplatesCard'
import { LETTER_TEMPLATE_GROUPS, resolveLetterTemplate } from '@/lib/pdf/letter-templates'
import TeamCard from './TeamCard'

const GOVERNANCE_ENTITY_ID = '00000000-0000-0000-0000-000000000000'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ qbo?: string; qbo_message?: string }>
}) {
  const { qbo, qbo_message } = await searchParams

  // Org settings, QBO, team accounts, governance docs — admins only.
  // Staff don't see the nav item either; this is the backstop.
  const { isAdmin, memberId } = await getAuthState()
  if (!isAdmin) {
    redirect('/')
  }

  const supabase = await createClient()

  const programAreasP = loadProgramAreas(supabase)
  const [settingsRes, membersRes, attachmentsRes, programAreas, usedProgramAreaSlugs, { data: signature }] = await Promise.all([
    supabase.from('org_settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('team_members').select('*').order('full_name'),
    supabase
      .from('attachments')
      .select('*')
      .eq('entity_type', 'governance')
      .eq('entity_id', GOVERNANCE_ENTITY_ID)
      .order('created_at', { ascending: false }),
    programAreasP,
    // Which areas proposals use (they can't be deleted): one head-only count
    // per area, instead of reading program_areas off every proposal
    programAreasP.then((areas) =>
      Promise.all(
        areas.map(async (a) => {
          const { count } = await supabase
            .from('grant_proposals')
            .select('id', { count: 'exact', head: true })
            .contains('program_areas', [a.slug])
          return count ? a.slug : null
        })
      ).then((slugs) => slugs.filter((s): s is string => s !== null))
    ),
    supabase.storage.from('letters').createSignedUrl(SIGNATURE_STORAGE_PATH, 300),
  ])

  const settings = settingsRes.data
  const members = membersRes.data ?? []
  const timeZones = Intl.supportedValuesOf('timeZone')

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Organization details, team, and governance documents" />

      <div className="space-y-6">
        {qbo === 'connected' && (
          <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            QuickBooks connected. Map your categories and accounts below.
          </div>
        )}
        {qbo === 'error' && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            QuickBooks connection failed{qbo_message ? `: ${qbo_message}` : '.'}
          </div>
        )}

        <OrgSettingsForm settings={settings} timeZones={timeZones} />

        <SignatureCard signatureUrl={signature?.signedUrl ?? null} />

        <LetterTemplatesCard
          templates={
            Object.fromEntries(
              LETTER_TEMPLATE_GROUPS.map((g) => [g, resolveLetterTemplate(g, settings?.letter_templates)])
            ) as Parameters<typeof LetterTemplatesCard>[0]['templates']
          }
        />

        <ProgramAreasCard areas={programAreas} usedSlugs={usedProgramAreaSlugs} />

        {/* Checks (and may refresh) the QuickBooks connection: streams in */}
        <Suspense
          fallback={
            <div className="card p-6">
              <h2 className="font-medium text-gray-900 mb-2">QuickBooks</h2>
              <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
            </div>
          }
        >
          <QuickBooksCard />
        </Suspense>

        <TeamCard members={members} currentMemberId={memberId} />

        <div className="card p-6 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-gray-900">Team activity</h2>
            <p className="text-sm text-gray-400">
              Sign-ins and changes by admins and staff
            </p>
          </div>
          <Link href="/settings/activity" className="btn btn-primary text-sm whitespace-nowrap">
            View log
          </Link>
        </div>

        <div>
          <AttachmentsPanel
            entityType="governance"
            entityId={GOVERNANCE_ENTITY_ID}
            attachments={attachmentsRes.data ?? []}
            revalidatePath="/settings"
            title="Governance documents"
          />
          <p className="text-xs text-gray-400 mt-2 px-1">
            Bylaws, IRS determination letter, COI policy, board minutes.
          </p>
        </div>
      </div>
    </div>
  )
}
