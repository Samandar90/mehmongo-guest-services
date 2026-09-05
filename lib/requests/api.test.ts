import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRoomContext,
  GuestApiError,
  RoomUnavailableError,
  submitGuestRequest,
} from './api';
import type { SubmitRequestPayload } from '../../supabase/functions/_shared/contracts';

const ACTIVE_ROOM_TOKEN = '20000000-0000-4000-8000-000000000205';
const submitPayload: SubmitRequestPayload = {
  roomToken: ACTIVE_ROOM_TOKEN,
  idempotencyKey: '20000000-0000-4000-8000-000000000206',
  service: 'transport',
  fields: {
    choice: '', pickup: 'Hotel', destination: 'Airport', date: '2026-09-06', time: '10:00',
    count: '2', guestName: 'Amir Khan', contact: '@amir', note: '',
  },
  website: '',
};

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

describe('submitGuestRequest', () => {
  it.each([200, 201, 202])('accepts a durable request response with status %i', async (status) => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      reference: 'MG-ABCDEFGH', telegramStatus: 'pending',
    }), { status }));
    vi.stubGlobal('fetch', request);

    await expect(submitGuestRequest(submitPayload)).resolves.toEqual({
      reference: 'MG-ABCDEFGH', telegramStatus: 'pending',
    });
    expect(String(request.mock.calls[0]?.[0])).toBe('https://example.supabase.co/functions/v1/submit-request');
    expect(request.mock.calls[0]?.[1]).toEqual({
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submitPayload),
    });
  });

  it('maps unavailable rooms, rate limits, and malformed responses to safe errors', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reference: 'bad', telegramStatus: 'sent' }), { status: 201 }))
      .mockRejectedValueOnce(new TypeError('Network error'));
    vi.stubGlobal('fetch', request);

    await expect(submitGuestRequest(submitPayload)).rejects.toMatchObject({ message: 'ROOM_UNAVAILABLE' });
    await expect(submitGuestRequest(submitPayload)).rejects.toMatchObject({ message: 'RATE_LIMITED' });
    await expect(submitGuestRequest(submitPayload)).rejects.toMatchObject({ message: 'REQUEST_FAILED' });
    await expect(submitGuestRequest(submitPayload)).rejects.toMatchObject({ message: 'REQUEST_FAILED' });
  });
});
