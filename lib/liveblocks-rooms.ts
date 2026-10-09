// Liveblocks room naming, shared by the browser client (lib/liveblocks.ts)
// and the auth route (app/api/liveblocks-auth). One room per meeting:
// `<prefix>meeting-<meeting id>`. Set NEXT_PUBLIC_LIVEBLOCKS_ROOM_PREFIX
// (e.g. "acme-") when several deployments share one Liveblocks project so
// their room ids can't collide.

const PREFIX = (process.env.NEXT_PUBLIC_LIVEBLOCKS_ROOM_PREFIX ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '')

export const MEETING_ROOM_PREFIX = `${PREFIX}meeting-`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Room id for a meeting's live notes. */
export function meetingRoomId(meetingId: string): string {
  return `${MEETING_ROOM_PREFIX}${meetingId}`
}

/** The meeting id inside a room id, or null if it isn't a meeting room of this deployment. */
export function meetingIdFromRoom(room: string): string | null {
  if (!room.startsWith(MEETING_ROOM_PREFIX)) return null
  const id = room.slice(MEETING_ROOM_PREFIX.length)
  return UUID.test(id) ? id : null
}
