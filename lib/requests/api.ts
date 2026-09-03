import type {
  PublicRoomContext,
  RoomContextResult,
  ServiceId,
} from '../../supabase/functions/_shared/contracts';

const serviceIds: ServiceId[] = ['tours', 'transport', 'restaurants', 'tickets'];

export class GuestApiError extends Error {}

export class RoomUnavailableError extends GuestApiError {}

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

export async function fetchRoomContext(token: string): Promise<RoomContextResult> {
  const response = await fetch(roomContextUrl(token));
  if (response.status === 404) throw new RoomUnavailableError('This room link is unavailable');
  if (!response.ok) throw new GuestApiError('Unable to load room context');

  const context: unknown = await response.json();
  if (!isPublicRoomContext(context)) throw new GuestApiError('Invalid room context response');

  return { ...context, roomToken: token };
}
