export const SESSION_COOKIE = 'lms_session';

export function hasSessionCookie(cookieHeader) {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((part) => part.trim().startsWith(SESSION_COOKIE + '='));
}
