import sanitizeHtml from 'sanitize-html'

/**
 * Server-side cleanup for rich-text bodies (notes, meeting notes) before they
 * are stored. The allowlist matches what the editors emit (TipTap starter kit
 * + link), so normal editor output passes through unchanged; anything else
 * (scripts, event handlers, styles, javascript: links, images, iframes) is
 * dropped. The timeline also runs DOMPurify in the browser as a second layer.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
    'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr', 'a',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'class'],
    ol: ['start'],
    code: ['class'],
  },
  // Only the classes the editors add (link styling, code block language)
  allowedClasses: {
    a: ['text-blue-600', 'underline', 'hover:text-blue-800'],
    code: ['language-*'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
}

/**
 * Sanitize a note or meeting body. Plain text (no `<`) is returned as is: it
 * renders as text, never as HTML. If the result has no tags left, it's wrapped
 * in a paragraph so entities like `&lt;` still display as `<`.
 */
export function sanitizeRichText(content: string): string {
  if (!content.includes('<')) return content
  // sanitize-html writes void tags as `<br />`; match the editor's `<br>`
  const clean = sanitizeHtml(content, OPTIONS).replace(/<(br|hr) \/>/g, '<$1>').trim()
  if (!clean || clean.includes('<')) return clean
  return `<p>${clean.replace(/\n/g, '<br>')}</p>`
}
