// Accept a specific broadcast so reconnects always target the same live session.
export function youtubeLiveId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const input = value.trim();
  const validId = (id: string) => /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  if (validId(input)) return input;
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') return validId(url.pathname.replace(/^\//, '').replace(/\/$/, ''));
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) return '';
    if (url.pathname === '/watch') return validId(url.searchParams.get('v') ?? '');
    const match = url.pathname.match(/^\/(?:live|embed)\/([A-Za-z0-9_-]{11})\/?$/);
    return match?.[1] ?? '';
  } catch {
    return '';
  }
}
