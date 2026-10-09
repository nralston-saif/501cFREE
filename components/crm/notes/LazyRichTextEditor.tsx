'use client'

import dynamic from 'next/dynamic'

// RichTextEditor pulls in TipTap and ProseMirror (a few hundred KB). Loading
// it with next/dynamic keeps it out of the contact, proposal and PRI pages'
// first JavaScript: the notes timeline renders right away and the composer
// arrives in its own chunk. ssr: false is safe here because the editor
// already renders nothing on the server (useEditor with immediatelyRender:
// false), so the placeholder below is what both server and first client
// render show.
const LazyRichTextEditor = dynamic(() => import('./RichTextEditor'), {
  ssr: false,
  loading: () => (
    <div
      className="border border-gray-300 rounded-lg bg-white"
      style={{ minHeight: '160px' }}
      aria-busy="true"
      aria-label="Loading editor"
    >
      <div className="h-9 border-b border-gray-200 bg-gray-50" />
    </div>
  ),
})

export default LazyRichTextEditor
