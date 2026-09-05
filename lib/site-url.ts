/**
 * Public guest-site origin, shared by the room editor (copy link) and the A5
 * asset generator (QR codes). It comes from validated build-time configuration
 * only; nothing in the admin invents a deployment origin.
 */
export function getPublicSiteUrl(): string {
  const raw = import.meta.env.VITE_SITE_URL;
  if (!raw) throw new Error('VITE_SITE_URL is not configured');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('VITE_SITE_URL must be an absolute http(s) origin');
  }
  const isOrigin = (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    && (parsed.pathname === '/' || parsed.pathname === '')
    && !parsed.search
    && !parsed.hash;
  if (!isOrigin) throw new Error('VITE_SITE_URL must be an absolute http(s) origin');

  return parsed.origin;
}

export function guestRoomPath(roomToken: string): string {
  return `/r/${roomToken}`;
}

export function buildGuestRoomUrl(siteUrl: string, roomToken: string): string {
  return `${siteUrl.replace(/\/+$/, '')}${guestRoomPath(roomToken)}`;
}
