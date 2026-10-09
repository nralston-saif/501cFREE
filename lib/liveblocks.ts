import { createClient } from '@liveblocks/client'
import { createRoomContext } from '@liveblocks/react'
import { withBasePath } from '@/lib/basePath'

// Live meeting notes. Auth goes through /api/liveblocks-auth, which grants a
// token for one meeting's room at a time (room ids: lib/liveblocks-rooms.ts).

export { meetingRoomId } from './liveblocks-rooms'

const client = createClient({
  authEndpoint: async (room) => {
    const response = await fetch(withBasePath('/api/liveblocks-auth'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room }),
    })
    if (!response.ok) {
      throw new Error(`Auth failed: ${response.status}`)
    }
    return await response.json()
  },
  throttle: 100,
})

type Presence = {
  cursor: { x: number; y: number } | null
  name: string
  isTyping: boolean
}

type Storage = {
  draft: string
  sharedNoteId: string | null
  meetingDate: string
  creatingNoteBy: string | null
  noteLinks: { entityType: string; entityId: string; label: string }[] | null
}

type UserMeta = {
  id: string
  info: {
    name: string
    color: string
  }
}

const roomContext = createRoomContext<Presence, Storage, UserMeta>(client)

export const {
  suspense: { RoomProvider, useOthers, useSelf, useUpdateMyPresence },
} = roomContext

export { ClientSideSuspense } from '@liveblocks/react'
