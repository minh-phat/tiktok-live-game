function youtubeHandle(value: string): string {
  const handle = value.startsWith('@') ? value : `@${value}`;
  return /^@[\p{L}\p{N}_.-]{3,30}$/u.test(handle) ? handle : '';
}

// Accept either a specific broadcast or a stable channel handle. Handles let
// reconnects discover the channel's current broadcast automatically.
export function youtubeLiveId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const input = value.trim();
  const validId = (id: string) => /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  if (validId(input)) return input;
  if (input.startsWith('@')) return youtubeHandle(input);
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') return validId(url.pathname.replace(/^\//, '').replace(/\/$/, ''));
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) return '';
    if (url.pathname === '/watch') return validId(url.searchParams.get('v') ?? '');
    const match = url.pathname.match(/^\/(?:live|embed)\/([A-Za-z0-9_-]{11})\/?$/);
    if (match) return match[1];
    const handleMatch = decodeURIComponent(url.pathname).match(/^\/(@[^/]+)(?:\/live)?\/?$/u);
    return handleMatch ? youtubeHandle(handleMatch[1]) : '';
  } catch {
    return '';
  }
}
