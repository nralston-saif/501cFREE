import { describe, expect, it } from 'vitest'
import { sanitizeRichText } from './sanitize-html'

describe('sanitizeRichText', () => {
  it('leaves normal editor output unchanged', () => {
    const html = [
      '<h1>Title</h1><h2>Sub</h2><h3>Section</h3>',
      '<p>Plain <strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s> <code>x = 1</code><br>next line</p>',
      '<ul><li><p>one</p></li></ul><ol start="3"><li><p>three</p></li></ol>',
      '<blockquote><p>quoted</p></blockquote>',
      '<pre><code class="language-js">const a = 1</code></pre><hr>',
      '<p><a target="_blank" rel="noopener noreferrer nofollow" class="text-blue-600 underline hover:text-blue-800" href="https://example.org">link</a></p>',
      '<p><a href="mailto:info@example.org">mail</a></p>',
    ].join('')
    expect(sanitizeRichText(html)).toBe(html)
  })

  it('returns plain text untouched', () => {
    expect(sanitizeRichText('Revenue up & costs down\nsecond line')).toBe('Revenue up & costs down\nsecond line')
  })

  it('strips script tags and their contents', () => {
    expect(sanitizeRichText('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>')
    expect(sanitizeRichText('<script>alert(1)</script>')).toBe('')
  })

  it('strips event handlers and disallowed elements', () => {
    expect(sanitizeRichText('<p onclick="x()">a<img src=x onerror="alert(1)"></p>')).toBe('<p>a</p>')
    expect(sanitizeRichText('<p>a</p><iframe src="https://example.org"></iframe>')).toBe('<p>a</p>')
  })

  it('removes javascript: and data: hrefs', () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeRichText('<a href="JaVaScRiPt:alert(1)">x</a>')).toBe('<a>x</a>')
    expect(sanitizeRichText('<a href="data:text/html,hi">x</a>')).toBe('<a>x</a>')
  })

  it('strips style attributes and unknown classes', () => {
    expect(sanitizeRichText('<p style="position:fixed">a</p>')).toBe('<p>a</p>')
    expect(sanitizeRichText('<a class="fixed inset-0" href="https://example.org">a</a>')).toBe(
      '<a href="https://example.org">a</a>'
    )
  })

  it('keeps stray angle brackets readable once tags are gone', () => {
    expect(sanitizeRichText('a < b')).toBe('<p>a &lt; b</p>')
  })
})
