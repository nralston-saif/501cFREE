import { NextRequest, NextResponse } from 'next/server'
import { Liveblocks } from '@liveblocks/node'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import { meetingIdFromRoom } from '@/lib/liveblocks-rooms'

// Liveblocks auth for live meeting notes. Room-scoped: it only ever grants a
// meeting's room (see lib/liveblocks-rooms.ts), only to an active team
// member, and only for a meeting that exists. Liveblocks access tokens are
// limited to the rooms granted here, so a token can't be reused elsewhere in
// the Liveblocks project. Without LIVEBLOCKS_SECRET_KEY the meetings page
// falls back to the plain editor and never calls this.

function deny(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

export async function POST(request: NextRequest) {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY
  if (!secret?.startsWith('sk_')) return deny(503, 'Live editing is not configured')

  const { userId, memberId, memberName } = await getAuthState()
  if (!userId) return deny(401, 'Not signed in')
  if (!memberId) return deny(403, 'No access')

  const body = await request.json().catch(() => null)
  const room = typeof body?.room === 'string' ? body.room : ''
  const meetingId = meetingIdFromRoom(room)
  if (!meetingId) return deny(403, 'Room not allowed')

  // RLS-scoped read: the meeting must exist and be visible to this member
  const supabase = await createClient()
  const { data: meeting } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', meetingId)
    .maybeSingle()
  if (!meeting) return deny(403, 'Room not allowed')

  const liveblocks = new Liveblocks({ secret })
  const session = liveblocks.prepareSession(memberId, {
    userInfo: { name: memberName?.trim() || 'Team member' },
  })
  session.allow(room, session.FULL_ACCESS)
  const { status, body: token } = await session.authorize()
  return new Response(token, { status, headers: { 'Content-Type': 'application/json' } })
}
