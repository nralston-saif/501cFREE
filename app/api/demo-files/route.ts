import { NextResponse, type NextRequest } from 'next/server'
import { getDemoStore } from '@/lib/supabase/demo/store'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'

/** Serves demo-mode file uploads from the in-memory store */
export async function GET(request: NextRequest) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const key = request.nextUrl.searchParams.get('key')
  const file = key ? getDemoStore().files.get(key) : undefined

  if (!file) {
    return NextResponse.json(
      { error: 'File not found - demo uploads reset when the server restarts' },
      { status: 404 }
    )
  }

  return new NextResponse(Buffer.from(file.bytes), {
    headers: { 'Content-Type': file.contentType },
  })
}
