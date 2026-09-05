import type {
  PublicRoomContext,
  RoomContextResult,
  ServiceId,
  SubmitRequestPayload,
  SubmitRequestResult,
} from '../../supabase/functions/_shared/contracts';

const serviceIds: ServiceId[] = ['tours', 'transport', 'restaurants', 'tickets'];

export class GuestApiError extends Error {}

export class RoomUnavailableError extends GuestApiError {}

function isSubmitRequestResult(value: unknown): value is SubmitRequestResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const result = value as Record<string, unknown>;
  return typeof result.reference === 'string'
    && /^MG-[A-Z2-7]{8}$/.test(result.reference)
    && (result.telegramStatus === 'pending' || result.telegramStatus === 'sent' || result.telegramStatus === 'failed');
}

function isPublicRoomContext(value: unknown): value is PublicRoomContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const context = value as Record<string, unknown>;
  return typeof context.hotelName === 'string'
    && typeof context.roomLabel === 'string'
    && Array.isArray(context.services)
    && context.services.every((service) => (
      typeof service === 'string' && serviceIds.includes(service as ServiceId)
    ));
}

function roomContextUrl(token: string): URL {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) throw new GuestApiError('Supabase public configuration is missing');

  const endpoint = new URL('/functions/v1/room-context', url);
  endpoint.searchParams.set('token', token);
  return endpoint;
}

function submitRequestUrl(): URL {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) throw new GuestApiError('REQUEST_FAILED');
  return new URL('/functions/v1/submit-request', url);
}

export async function fetchRoomContext(token: string): Promise<RoomContextResult> {
  const response = await fetch(roomContextUrl(token));
  if (response.status === 404) throw new RoomUnavailableError('This room link is unavailable');
  if (!response.ok) throw new GuestApiError('Unable to load room context');

  const context: unknown = await response.json();
  if (!isPublicRoomContext(context)) throw new GuestApiError('Invalid room context response');

  return { ...context, roomToken: token };
}

export async function submitGuestRequest(payload: SubmitRequestPayload): Promise<SubmitRequestResult> {
  let response: Response;
  try {
    response = await fetch(submitRequestUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new GuestApiError('REQUEST_FAILED');
  }

  if (response.status === 404) throw new GuestApiError('ROOM_UNAVAILABLE');
  if (response.status === 429) throw new GuestApiError('RATE_LIMITED');
  if (![200, 201, 202].includes(response.status)) throw new GuestApiError('REQUEST_FAILED');

  try {
    const result: unknown = await response.json();
    if (isSubmitRequestResult(result)) return result;
  } catch {
    // Fall through to the guest-safe error below.
  }
  throw new GuestApiError('REQUEST_FAILED');
}
