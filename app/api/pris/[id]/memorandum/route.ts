import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Stream the generated Mission-Alignment Memorandum PDF for inline preview */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  // RLS-scoped read doubles as the auth check: non-members see no rows
  const { data: memoPdf } = await supabase
    .from('pri_memo_pdfs')
    .select('pdf_storage_path')
    .eq('pri_id', id)
    .maybeSingle()

  if (!memoPdf?.pdf_storage_path) {
    return NextResponse.json({ error: 'Memo PDF not found' }, { status: 404 })
  }

  // Download as the user so storage policies apply to the stored path
  const { data: pdfBlob, error } = await supabase.storage
    .from('documents')
    .download(memoPdf.pdf_storage_path)

  if (error || !pdfBlob) {
    return NextResponse.json({ error: 'Could not load PDF' }, { status: 500 })
  }

  return new NextResponse(pdfBlob.stream(), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="mission-alignment-memo.pdf"',
      // Never cache the preview — the memo is re-rendered on every
      // regenerate, so a cached copy would show a stale version.
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
