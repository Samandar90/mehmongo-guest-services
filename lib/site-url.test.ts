import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGuestRoomUrl, getPublicSiteUrl, guestRoomPath } from './site-url';

describe('public site URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads VITE_SITE_URL and strips a trailing slash', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://mehmongo.example/');
    expect(getPublicSiteUrl()).toBe('https://mehmongo.example');
  });

  it('throws when the site URL is missing', () => {
    vi.stubEnv('VITE_SITE_URL', '');
    expect(() => getPublicSiteUrl()).toThrow('VITE_SITE_URL');
  });

  it('rejects a site URL that is not an absolute http(s) origin', () => {
    vi.stubEnv('VITE_SITE_URL', 'mehmongo.example');
    expect(() => getPublicSiteUrl()).toThrow('VITE_SITE_URL');
    vi.stubEnv('VITE_SITE_URL', 'https://mehmongo.example/app?x=1');
    expect(() => getPublicSiteUrl()).toThrow('VITE_SITE_URL');
  });

  it('builds the guest room path and URL from the stored token', () => {
    expect(guestRoomPath('9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a')).toBe('/r/9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a');
    expect(buildGuestRoomUrl('https://mehmongo.example', '9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a'))
      .toBe('https://mehmongo.example/r/9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a');
  });
});
