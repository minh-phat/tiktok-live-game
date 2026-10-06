export const SESSION_COOKIE = 'live_session';

export function sessionToken(cookieHeader?: string) {
  const entry = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return entry?.slice(SESSION_COOKIE.length + 1);
}
