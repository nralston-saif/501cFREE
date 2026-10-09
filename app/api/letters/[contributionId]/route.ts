import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Stream the generated acknowledgement letter PDF for inline preview */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contributionId: string }> }
) {
  const { contributionId } = await params
  const supabase = await createClient()

  // RLS-scoped read doubles as the auth check: non-members see no rows
  const { data: letter } = await supabase
    .from('acknowledgement_letters')
    .select('pdf_storage_path')
    .eq('contribution_id', contributionId)
    .maybeSingle()

  if (!letter?.pdf_storage_path) {
    return NextResponse.json({ error: 'Letter not found' }, { status: 404 })
  }

  // Download as the user so storage policies apply to the stored path
  const { data: pdfBlob, error } = await supabase.storage
    .from('letters')
    .download(letter.pdf_storage_path)

  if (error || !pdfBlob) {
    return NextResponse.json({ error: 'Could not load PDF' }, { status: 500 })
  }

  return new NextResponse(pdfBlob.stream(), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="contribution-acknowledgement.pdf"',
      // Never cache the preview — the letter is re-rendered on every regenerate,
      // so a cached copy would show a stale (e.g. old-signature) version.
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
