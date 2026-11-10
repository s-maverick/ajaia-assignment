import sanitizeHtml from 'sanitize-html';

/**
 * Documents are stored as HTML produced by the TipTap editor. Because documents
 * are shared between users, every write (and every import) is sanitized against
 * an allowlist that mirrors what the editor can actually render. This keeps
 * stored content safe (no <script>, event handlers, javascript: URLs) and
 * predictable (imports can't smuggle in markup the editor would mangle).
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr', 'a'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    ol: ['start'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    b: 'strong',
    i: 'em',
    strike: 's',
    del: 's',
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
    // Tables aren't supported by the editor; keep their text as paragraphs.
    td: 'p',
    th: 'p',
  },
};

export function sanitizeDocHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text -> paragraphs. Blank lines separate paragraphs; single newlines become <br>. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block.trim().length > 0)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
