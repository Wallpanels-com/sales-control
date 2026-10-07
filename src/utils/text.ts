export function normalizeUsername(value?: string | null): string {
  return (value || '').replace(/^@/, '').trim().toLowerCase();
}

export function normalizeName(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function truncate(value: string | undefined | null, max = 220): string {
  const s = (value || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
    ensp: ' ', emsp: ' ', ndash: '–', mdash: '—', hellip: '…',
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“'
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try { return String.fromCodePoint(codePoint); } catch { return match; }
      }
      return match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

/**
 * Converts HighLevel email HTML into a short, readable Telegram preview.
 * Quoted email history is deliberately removed so the alert shows the new
 * customer reply instead of Gmail/Outlook markup and the previous thread.
 */
export function messagePreview(value?: string | null, channel?: string | null): string {
  const original = value || '';
  if (!original.trim()) return '';

  const isEmail = channel?.toLowerCase() === 'email';
  const looksLikeHtml = /<\/?(?:html|body|div|p|br|table|blockquote|span|style|head)\b/i.test(original);
  if (!isEmail && !looksLikeHtml) return truncate(original, 260);

  let text = original
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(?:script|style|title)\b[^>]*>[\s\S]*?<\/(?:script|style|title)>/gi, ' ')
    // Gmail puts the previous thread in gmail_quote; everything after it is old mail.
    .replace(/<(?:div|section)\b[^>]*class=["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*$/i, ' ')
    // Outlook mobile and desktop reply separators begin the quoted history.
    .replace(/<div\b[^>]*id=["'](?:divRplyFwdMsg|ms-outlook-mobile-body-separator-line)["'][^>]*>[\s\S]*$/i, ' ')
    .replace(/<blockquote\b[^>]*>[\s\S]*$/i, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');

  text = decodeHtmlEntities(text)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  // Plain-text email replies can still include the previous thread.
  text = text.split(/\n(?:On .{1,300} wrote:|From:\s.{1,300}|-{2,}\s*Original Message\s*-{2,})/i, 1)[0].trim();
  return truncate(text, 260);
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
