/// <reference lib="deno.ns" />

import { createClient } from '@supabase/supabase-js';
import type { PublicRoomContext, ServiceId } from '../_shared/contracts.ts';
import { emptyResponse, jsonResponse } from '../_shared/http.ts';

const services: ServiceId[] = ['tours', 'transport', 'restaurants', 'tickets'];

type ActiveRoomContext = Pick<PublicRoomContext, 'hotelName' | 'roomLabel'>;

export type RoomContextRepository = {
  findActiveRoom: (token: string) => Promise<ActiveRoomContext | null>;
};

export type RoomContextDependencies = {
  repository: RoomContextRepository;
};

type IncomingRequest = {
  method: string;
  url: string;
};

type HandlerContext = RoomContextDependencies | Deno.ServeHandlerInfo;

function readRoomContext(data: unknown): ActiveRoomContext | null {
  if (!data || typeof data !== 'object') return null;

  const room = data as { label?: unknown; hotels?: unknown };
  const hotel = Array.isArray(room.hotels) ? room.hotels[0] : room.hotels;
  if (!hotel || typeof hotel !== 'object') return null;

  const hotelName = (hotel as { name?: unknown }).name;
  if (typeof room.label !== 'string' || typeof hotelName !== 'string') return null;
  return { hotelName, roomLabel: room.label };
}

function getServerSecretKey(): string | undefined {
  const configuredSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!configuredSecretKeys) {
    return Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  }

  try {
    const secretKeys = JSON.parse(configuredSecretKeys) as Record<string, unknown>;
    return typeof secretKeys.default === 'string' ? secretKeys.default : undefined;
  } catch {
    return undefined;
  }
}

function createRepository(): RoomContextRepository {
  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = getServerSecretKey();
  if (!url || !secretKey) throw new Error('Supabase server configuration is missing');

  const client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    async findActiveRoom(token) {
      const { data, error } = await client
        .from('rooms')
        .select('label, hotels!inner(name)')
        .eq('public_token', token)
        .eq('active', true)
        .eq('hotels.active', true)
        .maybeSingle();

      if (error) throw error;
      return readRoomContext(data);
    },
  };
}

export async function handler(
  request: IncomingRequest,
  context?: HandlerContext,
): Promise<Response> {
  if (request.method === 'OPTIONS') return emptyResponse(204);
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);

  const token = new URL(request.url).searchParams.get('token');
  if (!token) return jsonResponse({ error: 'Room not found' }, 404);

  try {
    const repository = context && 'repository' in context
      ? context.repository
      : createRepository();
    const room = await repository.findActiveRoom(token);
    if (!room) return jsonResponse({ error: 'Room not found' }, 404);

    return jsonResponse({ ...room, services });
  } catch {
    return jsonResponse({ error: 'Unable to resolve room context' }, 500);
  }
}

if (import.meta.main) Deno.serve(handler);
