import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRoomContext,
  GuestApiError,
  RoomUnavailableError,
} from './api';

const ACTIVE_ROOM_TOKEN = '20000000-0000-4000-8000-000000000205';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('fetchRoomContext', () => {
  it('adds the route token to the public room-context response', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      hotelName: 'Kamilovs Hotel',
      roomLabel: '205',
      services: ['transport'],
    }), { status: 200 })));

    await expect(fetchRoomContext(ACTIVE_ROOM_TOKEN)).resolves.toEqual({
      hotelName: 'Kamilovs Hotel',
      roomLabel: '205',
      roomToken: ACTIVE_ROOM_TOKEN,
      services: ['transport'],
    });
  });

  it('reports a missing room link without exposing an API failure', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(fetchRoomContext(ACTIVE_ROOM_TOKEN)).rejects.toBeInstanceOf(RoomUnavailableError);
  });

  it('reports other endpoint failures as guest API errors', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(fetchRoomContext(ACTIVE_ROOM_TOKEN)).rejects.toBeInstanceOf(GuestApiError);
  });
});
