// Allow-list HTML sanitiser for the rich-text fields staff write with Quill
// (OOC / meeting notes). Runs on write (server actions) and again on render
// (dangerouslySetInnerHTML call sites), so a note stored before this existed
// is still rendered safely. Plain module: imported by 'use server' files and
// client components alike. No dependencies.
//
// Keeps the tags Quill emits; drops every attribute except a safe href/target
// on links and the few class/style hooks Quill uses for alignment, lists and
// code blocks. script/style/iframe bodies are removed entirely.

const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'span', 'div']);
const DROP_WITH_BODY = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript']);
const SAFE_CLASS = /^(ql-[a-z0-9-]+|quill-[a-z0-9-]+)$/i;
const SAFE_STYLE = /^(text-align|font-weight|font-style|text-decoration|color|background-color)\s*:\s*[#a-z0-9(),.%\s-]+;?$/i;

function attr(raw, name) {
  const m = raw.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function escapeAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function safeHref(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^(https?:|mailto:|\/(?!\/))/i.test(s)) return s;
  return null;
}

/** HTML string → sanitised HTML string. Non-strings become ''. */
export function sanitizeHtml(input) {
  if (input == null) return '';
  let html = String(input);
  if (!html.includes('<')) return html;
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const t of DROP_WITH_BODY) {
    html = html.replace(new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}\\s*>`, 'gi'), '').replace(new RegExp(`<\\/?${t}\\b[^>]*>`, 'gi'), '');
  }
  return html.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (whole, slash, tag, rest) => {
    const t = tag.toLowerCase();
    if (!ALLOWED.has(t)) return '';
    if (slash) return `</${t}>`;
    let attrs = '';
    if (t === 'a') {
      const href = safeHref(attr(rest, 'href'));
      if (href) attrs += ` href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"`;
    }
    const cls = attr(rest, 'class');
    if (cls) {
      const keep = cls.split(/\s+/).filter(c => SAFE_CLASS.test(c));
      if (keep.length) attrs += ` class="${escapeAttr(keep.join(' '))}"`;
    }
    const style = attr(rest, 'style');
    if (style) {
      const keep = style.split(';').map(s => s.trim()).filter(s => s && SAFE_STYLE.test(s + ';'));
      if (keep.length) attrs += ` style="${escapeAttr(keep.join('; '))}"`;
    }
    const selfClose = (t === 'br' || t === 'hr') ? ' /' : '';
    return `<${t}${attrs}${selfClose}>`;
  });
}

/** Visible text of an HTML fragment (for "is this note empty?" checks and previews). */
export function htmlToText(input) {
  return String(input ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
