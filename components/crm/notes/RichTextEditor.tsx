'use client'

// Standalone rich-text editor for notes (no live collaboration): the same
// toolbar and keyboard behavior as the meetings editor, emitting HTML.

import { useState } from 'react'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list'

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

export default function RichTextEditor({
  initialContent = '',
  onChange,
  placeholder = 'Start typing…',
  minHeight = '160px',
  ariaLabel = 'Note',
}: {
  /** HTML loaded once on mount; remount (change `key`) to reset */
  initialContent?: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: string
  ariaLabel?: string
}) {
  const editor = useEditor({
    extensions: [
      // StarterKit v3 bundles Link; turn that copy off so the configured one
      // below is the only 'link' extension
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-blue-600 underline hover:text-blue-800' },
      }),
      Placeholder.configure({ placeholder, emptyEditorClass: 'is-editor-empty' }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'focus:outline-none prose prose-sm max-w-none',
        style: `min-height: calc(${minHeight} - 24px)`,
        'aria-label': ariaLabel,
        role: 'textbox',
        'aria-multiline': 'true',
      },
      handleKeyDown: (view, event) => {
        if (event.key !== 'Tab') return false
        const { state } = view
        const { $from } = state.selection
        let inList = false
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'listItem') {
            inList = true
            break
          }
        }
        event.preventDefault()
        if (inList) {
          const listItemType = state.schema.nodes.listItem
          if (event.shiftKey) liftListItem(listItemType)(state, view.dispatch)
          else sinkListItem(listItemType)(state, view.dispatch)
          return true
        }
        // Outside of lists, insert a tab character
        view.dispatch(state.tr.insertText('\t'))
        return true
      },
    },
    onUpdate: ({ editor }) => {
      // An empty document is '<p></p>'; report it as empty
      onChange(editor.isEmpty ? '' : editor.getHTML())
    },
    immediatelyRender: false,
  })

  return (
    <div className="tiptap-editor border border-gray-300 rounded-lg bg-white overflow-hidden" style={{ minHeight }}>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} className="p-3 h-full" />
    </div>
  )
}
