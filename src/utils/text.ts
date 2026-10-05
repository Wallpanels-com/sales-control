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

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
