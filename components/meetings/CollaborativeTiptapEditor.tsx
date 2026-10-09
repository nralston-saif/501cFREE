'use client'

// Tiptap editor bound to the current Liveblocks room (see lib/liveblocks.ts).
// Everyone in a room must run the same extensions, or edits won't round-trip.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, Editor, type EditorEvents } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { useLiveblocksExtension } from '@liveblocks/react-tiptap'
import { useOthers, useSelf, useUpdateMyPresence } from '@/lib/liveblocks'
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list'

export type CollaborativeTiptapEditorHandle = {
  clearContent: () => void
}

type CollaborativeTiptapEditorProps = {
  /** Callback when content changes (plain text for database saving) */
  onContentChange?: (content: string) => void
  /** Callback when user starts/stops typing */
  onTypingChange?: (isTyping: boolean) => void
  /** Fires only for THIS user's own edits (typing/paste), never for
   *  collaborators' changes arriving via Yjs. Used for notes presence. */
  onLocalInput?: () => void
  /** Callback when editor loses focus */
  onBlur?: () => void
  /** Placeholder text */
  placeholder?: string
  /** Minimum height of the editor */
  minHeight?: string
  /** Additional CSS class */
  className?: string
  /** Trigger to clear the editor content */
  clearTrigger?: number
  /**
   * The content saved in the database. A room with no document yet (new
   * room, or one Liveblocks expired) is seeded from it once, and an empty
   * document is never autosaved over it unless someone here clears it.
   */
  savedContent?: string | null
}

/** The part of the Liveblocks extension's storage the seeding below reads. */
type LiveblocksYjsStorage = {
  mode?: 'yjs' | 'liveblocks'
  provider?: {
    readonly synced: boolean
    on(event: 'sync', listener: (synced: boolean) => void): void
    off(event: 'sync', listener: (synced: boolean) => void): void
  }
  doc?: {
    getMap(name: string): { get(key: string): unknown; set(key: string, value: unknown): unknown }
    transact(fn: () => void): void
  }
}

// Yjs map + key that records "this room was seeded from the database", so a
// room is seeded at most once even across reloads.
const SEED_MAP = 'app_meeting'
const SEED_KEY = 'seededFromDatabase'

function hasText(html: string | null | undefined): boolean {
  return Boolean(html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim())
}

// ============================================================================
// CUSTOM TOOLBAR
// ============================================================================

type ToolbarButtonProps = {
  onClick: () => void
  isActive?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}

function ToolbarButton({ onClick, isActive, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        p-1.5 rounded transition-colors
        ${isActive
          ? 'bg-gray-200 text-gray-900'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
      `}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-gray-300 mx-1" />
}

// Split hard breaks (<br> from Shift+Enter) in the selection into separate paragraphs.
// This ensures each "line" becomes its own list item when toggling bullet/ordered lists.
function splitHardBreaksInSelection(editor: Editor): void {
  const { state } = editor
  const { from, to } = state.selection

  const hardBreakPositions: number[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'hardBreak') {
      hardBreakPositions.push(pos)
    }
  })

  if (hardBreakPositions.length === 0) return

  // Process from end to start so earlier positions remain valid
  const { tr } = state
  for (let i = hardBreakPositions.length - 1; i >= 0; i--) {
    const pos = hardBreakPositions[i]
    tr.delete(pos, pos + 1)
    tr.split(pos)
  }

  editor.view.dispatch(tr)
}

function EditorToolbar({ editor }: { editor: Editor | null }) {
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  if (!editor) return null

  const addLink = () => {
    if (linkUrl) {
      const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      setLinkUrl('')
      setShowLinkInput(false)
    }
  }

  const removeLink = () => {
    editor.chain().focus().unsetLink().run()
    setShowLinkInput(false)
  }

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200 flex-wrap">
      {/* Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Ctrl+Shift+Z)"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 10h-10a5 5 0 00-5 5v2M21 10l-4-4m4 4l-4 4" />
        </svg>
      </ToolbarButton>

      <ToolbarDivider />

      {/* Text formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold (Ctrl+B)"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic (Ctrl+I)"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="19" y1="4" x2="10" y2="4" />
          <line x1="14" y1="20" x2="5" y2="20" />
          <line x1="15" y1="4" x2="9" y2="20" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title="Strikethrough"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M16 4H9a3 3 0 00-3 3v.5" strokeLinecap="round" />
          <path d="M4 12h16" strokeLinecap="round" />
          <path d="M18 12a3 3 0 01-3 3H8a3 3 0 00-3 3v.5" strokeLinecap="round" />
        </svg>
      </ToolbarButton>

      <ToolbarDivider />

      {/* Lists */}
      <ToolbarButton
        onClick={() => {
          splitHardBreaksInSelection(editor)
          editor.chain().focus().toggleBulletList().run()
        }}
        isActive={editor.isActive('bulletList')}
        title="Bullet List"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="9" y1="6" x2="20" y2="6" strokeLinecap="round" />
          <line x1="9" y1="12" x2="20" y2="12" strokeLinecap="round" />
          <line x1="9" y1="18" x2="20" y2="18" strokeLinecap="round" />
          <circle cx="5" cy="6" r="1" fill="currentColor" />
          <circle cx="5" cy="12" r="1" fill="currentColor" />
          <circle cx="5" cy="18" r="1" fill="currentColor" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => {
          splitHardBreaksInSelection(editor)
          editor.chain().focus().toggleOrderedList().run()
        }}
        isActive={editor.isActive('orderedList')}
        title="Numbered List"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="10" y1="6" x2="20" y2="6" strokeLinecap="round" />
          <line x1="10" y1="12" x2="20" y2="12" strokeLinecap="round" />
          <line x1="10" y1="18" x2="20" y2="18" strokeLinecap="round" />
          <text x="4" y="8" fontSize="8" fill="currentColor" stroke="none" fontFamily="system-ui">1</text>
          <text x="4" y="14" fontSize="8" fill="currentColor" stroke="none" fontFamily="system-ui">2</text>
          <text x="4" y="20" fontSize="8" fill="currentColor" stroke="none" fontFamily="system-ui">3</text>
        </svg>
      </ToolbarButton>

      <ToolbarDivider />

      {/* Block formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive('heading', { level: 2 })}
        title="Heading"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M6 4v16M18 4v16M6 12h12" strokeLinecap="round" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        title="Quote"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive('codeBlock')}
        title="Code Block"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l-3 3 3 3m8-6l3 3-3 3" />
        </svg>
      </ToolbarButton>

      <ToolbarDivider />

      {/* Link */}
      <div className="relative">
        <ToolbarButton
          onClick={() => {
            if (editor.isActive('link')) {
              removeLink()
            } else {
              setShowLinkInput(!showLinkInput)
            }
          }}
          isActive={editor.isActive('link')}
          title={editor.isActive('link') ? 'Remove Link' : 'Add Link'}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </ToolbarButton>
        {showLinkInput && (
          <div className="absolute top-full left-0 mt-1 z-10 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex gap-2">
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="Enter URL..."
              aria-label="Link URL"
              className="px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-black w-48"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addLink()
                }
                if (e.key === 'Escape') {
                  setShowLinkInput(false)
                  setLinkUrl('')
                }
              }}
              autoFocus
            />
            <button
              onClick={addLink}
              className="px-2 py-1 text-sm bg-black text-white rounded hover:bg-gray-800"
            >
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function CollaborativeTiptapEditor({
  onLocalInput,
  onContentChange,
  onTypingChange,
  onBlur,
  placeholder = 'Start typing your notes...',
  minHeight = '300px',
  className = '',
  clearTrigger = 0,
  savedContent = null,
}: CollaborativeTiptapEditorProps) {
  const updateMyPresence = useUpdateMyPresence()
  const self = useSelf()
  const others = useOthers()

  // Latest values for the seeding effect, which must not re-run on presence changes
  const savedContentRef = useRef(savedContent)
  useEffect(() => {
    savedContentRef.current = savedContent
  }, [savedContent])
  const connectionIdsRef = useRef({ self: self.connectionId, others: others.map((o) => o.connectionId) })
  useEffect(() => {
    connectionIdsRef.current = { self: self.connectionId, others: others.map((o) => o.connectionId) }
  }, [self.connectionId, others])

  // Saving waits until the room's document has loaded and any seeding is
  // done; until then the editor is read-only, so nothing typed into a
  // not-yet-loaded (empty) document can be autosaved over the saved notes.
  const readyRef = useRef(false)
  // A local edit (typing, toolbar, clear) since the editor loaded: only then
  // may an empty document replace non-empty saved content.
  const localEditRef = useRef(false)

  // Use Liveblocks extension which handles Yjs internally
  const liveblocks = useLiveblocksExtension()

  // Content change handler - fires for all document changes (local and remote)
  // Remote changes triggering auto-save is harmless (idempotent upsert)
  // We must NOT filter by isChangeOrigin because toolbar actions (bullets, headings, etc.)
  // route through Yjs and would be incorrectly filtered out, losing formatting on save
  const handleUpdate = useCallback(({ editor, transaction }: Pick<EditorEvents['update'], 'editor' | 'transaction'>) => {
    if (!transaction.docChanged) return

    // Remote Yjs changes carry the y-sync plugin meta; local edits don't
    const isLocal = !transaction.getMeta('y-sync$')
    if (isLocal && readyRef.current) localEditRef.current = true
    if (onLocalInput && isLocal) onLocalInput()

    if (!readyRef.current) return
    // Never let an empty document overwrite saved notes unless someone here
    // actually cleared it
    if (editor.isEmpty && hasText(savedContentRef.current) && !localEditRef.current) return

    // Save HTML to preserve formatting (bullets, headings, bold, etc.)
    const html = editor.getHTML()
    onContentChange?.(html)
  }, [onContentChange, onLocalInput])

  // Handle typing status
  const handleFocus = useCallback(() => {
    onTypingChange?.(true)
    updateMyPresence({ isTyping: true })
  }, [onTypingChange, updateMyPresence])

  const handleBlurCallback = useCallback(() => {
    onTypingChange?.(false)
    updateMyPresence({ isTyping: false })
    onBlur?.()
  }, [onTypingChange, updateMyPresence, onBlur])

  const editor = useEditor({
    extensions: [
      liveblocks,
      // StarterKit v3 bundles Link; turn that copy off so the configured one
      // below is the only 'link' extension
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline hover:text-blue-800',
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
    ],
    editorProps: {
      attributes: {
        class: 'focus:outline-none prose prose-sm max-w-none',
        style: `min-height: calc(${minHeight} - 24px)`,
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Tab') {
          const { state } = view
          const { $from } = state.selection

          // Check if cursor is inside a list item
          let inList = false
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              inList = true
              break
            }
          }

          if (inList) {
            event.preventDefault()
            const listItemType = state.schema.nodes.listItem
            if (event.shiftKey) {
              liftListItem(listItemType)(state, view.dispatch)
            } else {
              sinkListItem(listItemType)(state, view.dispatch)
            }
            return true
          }

          // Outside of lists, insert a tab character
          event.preventDefault()
          view.dispatch(state.tr.insertText('\t'))
          return true
        }
        return false
      },
    },
    onUpdate: handleUpdate,
    onFocus: handleFocus,
    onBlur: handleBlurCallback,
    immediatelyRender: false,
    editable: false,
  })

  // Seed an empty room from the saved notes, once. Several people can open a
  // fresh room at the same moment, and Yjs can't lock, so: wait for the
  // room's document to load, wait a short random moment so concurrent
  // visitors see each other, let only the lowest connection id seed, and
  // mark the room seeded inside the document. Everyone else re-checks and
  // ends up with the seeded content via Yjs; if the seeder left, the next
  // client seeds on its retry.
  useEffect(() => {
    if (!editor) return
    const storage = (editor.storage as unknown as Record<string, LiveblocksYjsStorage | undefined>)
      .liveblocksExtension
    const provider = storage?.provider
    const doc = storage?.doc

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ready = () => {
      if (cancelled) return
      readyRef.current = true
      editor.setEditable(true)
    }

    if (storage?.mode !== 'yjs' || !provider || !doc) {
      ready()
      return
    }

    const seedMap = doc.getMap(SEED_MAP)
    const attempt = (tries: number) => {
      if (cancelled) return
      const saved = savedContentRef.current
      if (!hasText(saved) || !editor.isEmpty || seedMap.get(SEED_KEY)) {
        ready()
        return
      }
      const { self: me, others: ids } = connectionIdsRef.current
      const someoneElseSeeds = ids.some((id) => id < me)
      if (someoneElseSeeds && tries < 3) {
        timer = setTimeout(() => attempt(tries + 1), 1500)
        return
      }
      doc.transact(() => {
        seedMap.set(SEED_KEY, true)
      })
      editor.commands.setContent(saved!, { emitUpdate: false })
      ready()
    }
    const onLoaded = () => {
      timer = setTimeout(() => attempt(0), 250 + Math.floor(Math.random() * 750))
    }
    const onSync = (synced: boolean) => {
      if (!synced) return
      provider.off('sync', onSync)
      onLoaded()
    }

    if (provider.synced) onLoaded()
    else provider.on('sync', onSync)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      provider.off('sync', onSync)
    }
  }, [editor])

  // Clear editor content when clearTrigger changes
  useEffect(() => {
    if (clearTrigger > 0 && editor) {
      editor.commands.clearContent()
    }
  }, [clearTrigger, editor])

  return (
    <div
      className={`tiptap-editor border border-gray-300 rounded-lg bg-white overflow-hidden ${className}`}
      style={{ minHeight }}
    >
      <EditorToolbar editor={editor} />
      <EditorContent
        editor={editor}
        className="p-3 h-full"
      />
    </div>
  )
}
