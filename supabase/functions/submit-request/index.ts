/// <reference lib="deno.ns" />

import { createClient } from '@supabase/supabase-js';
import type { ValidatedRequest } from '../_shared/validation.ts';
import { validateSubmitPayload } from '../_shared/validation.ts';
import { emptyResponse, jsonResponse } from '../_shared/http.ts';
import { createRateLimitKey, createReference } from '../_shared/security.ts';
import {
  formatTelegramRequest,
  sendTelegramMessage,
  TelegramDeliveryError,
  type TelegramRequest,
} from '../_shared/telegram.ts';

const REFERENCE_INSERT_ATTEMPTS = 3;
const POST_ALLOWED_METHODS = 'POST, OPTIONS';

export type ActiveRoom = {
  id: string;
  hotelId: string;
};

export type StoredRequest = {
  reference: string;
  telegramStatus: 'sent' | 'failed';
};

export type DeliveryRequest = TelegramRequest & {
  id: string;
};

export type TelegramDelivery = {
  id: string;
};

export type InsertRequest = ValidatedRequest & {
  room: ActiveRoom;
  rateKey: string;
  reference: string;
};

export type InsertResult =
  | { kind: 'created'; request: StoredRequest }
  | { kind: 'existing'; request: StoredRequest }
  | { kind: 'rate_limited' }
  | { kind: 'reference_conflict' };

type InsertConflict = 'idempotency_conflict' | 'reference_conflict';

export type SubmitRequestRepository = {
  findByIdempotencyKey: (idempotencyKey: string) => Promise<StoredRequest | null>;
  findActiveRoom: (roomToken: string) => Promise<ActiveRoom | null>;
  submitAtomically: (request: InsertRequest) => Promise<InsertResult>;
  findByReference: (reference: string) => Promise<DeliveryRequest | null>;
  createDelivery: (requestId: string, attempt: number) => Promise<TelegramDelivery>;
  completeDelivery: (deliveryId: string, result: { telegramMessageId: number }) => Promise<void>;
  failDelivery: (deliveryId: string, error: { code: string; message: string }) => Promise<void>;
};

export type SubmitRequestDependencies = {
  repository: SubmitRequestRepository;
  requestHashSecret: string;
  telegramSender: (request: TelegramRequest) => Promise<{ messageId: number }>;
  referenceFactory?: () => string;
};

type QueryResult = {
  data: unknown;
  error: unknown;
};

export type SubmitRequestQuery = {
  select: (columns: string) => SubmitRequestQuery;
  eq: (column: string, value: unknown) => SubmitRequestQuery;
  order: (column: string, options: { ascending: boolean }) => SubmitRequestQuery;
  limit: (count: number) => SubmitRequestQuery;
  insert: (values: Record<string, unknown>) => SubmitRequestQuery;
  update: (values: Record<string, unknown>) => SubmitRequestQuery;
  maybeSingle: () => Promise<QueryResult>;
};

export type SubmitRequestClient = {
  from: (table: 'rooms' | 'service_requests' | 'telegram_deliveries') => SubmitRequestQuery;
  rpc: (functionName: 'submit_guest_request', arguments_: Record<string, unknown>) => Promise<QueryResult>;
};

type HandlerContext = SubmitRequestDependencies | Deno.ServeHandlerInfo;

function submitJson(body: unknown, status = 200): Response {
  return jsonResponse(body, status, POST_ALLOWED_METHODS);
}

function readActiveRoom(data: unknown): ActiveRoom | null {
  if (!data || typeof data !== 'object') return null;
  const room = data as { id?: unknown; hotel_id?: unknown };
  if (typeof room.id !== 'string' || typeof room.hotel_id !== 'string') return null;
  return { id: room.id, hotelId: room.hotel_id };
}

function readStoredRequest(data: unknown): StoredRequest | null {
  if (!data || typeof data !== 'object') return null;
  const reference = (data as { reference?: unknown }).reference;
  if (typeof reference !== 'string') return null;
  return { reference, telegramStatus: 'failed' };
}

function relation(value: unknown): Record<string, unknown> | null {
  const related = Array.isArray(value) ? value[0] : value;
  return related && typeof related === 'object' ? related as Record<string, unknown> : null;
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readDeliveryRequest(data: unknown): DeliveryRequest | null {
  if (!data || typeof data !== 'object') return null;
  const request = data as Record<string, unknown>;
  const room = relation(request.rooms);
  const hotel = room ? relation(room.hotels) : null;
  const service = request.service_type;
  const partySize = request.party_size;
  const requestedDate = request.requested_date;
  const requestedTime = request.requested_time;

  if (!room || !hotel || typeof request.id !== 'string' || typeof request.reference !== 'string' ||
    typeof hotel.name !== 'string' || typeof room.label !== 'string' || typeof request.guest_name !== 'string' ||
    typeof request.guest_contact !== 'string' || typeof request.note !== 'string' ||
    !['tours', 'transport', 'restaurants', 'tickets'].includes(String(service)) ||
    !(typeof partySize === 'number' || partySize === null) ||
    !(typeof requestedDate === 'string' || requestedDate === null) ||
    !(typeof requestedTime === 'string' || requestedTime === null)) {
    return null;
  }

  return {
    id: request.id,
    reference: request.reference,
    hotelName: hotel.name,
    roomLabel: room.label,
    service: service as DeliveryRequest['service'],
    choice: optionalText(request.choice),
    pickup: optionalText(request.pickup),
    destination: optionalText(request.destination),
    requestedDate,
    requestedTime: requestedTime?.slice(0, 5) ?? null,
    partySize,
    guestName: request.guest_name,
    contact: request.guest_contact,
    note: request.note,
  };
}

function uniqueConflict(error: unknown): InsertConflict | null {
  if (!error || typeof error !== 'object' || (error as { code?: unknown }).code !== '23505') return null;
  const details = ['constraint', 'details', 'message']
    .map((key) => (error as Record<string, unknown>)[key])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (details.includes('idempotency')) return 'idempotency_conflict';
  if (details.includes('reference')) return 'reference_conflict';
  return null;
}

function readAtomicResult(data: unknown): InsertResult {
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') {
    throw new Error('Atomic request response is invalid');
  }

  const result = data[0] as { outcome?: unknown; reference?: unknown };
  if (result.outcome === 'rate_limited') return { kind: 'rate_limited' };
  if ((result.outcome === 'created' || result.outcome === 'existing') && typeof result.reference === 'string') {
    return {
      kind: result.outcome,
      request: { reference: result.reference, telegramStatus: 'failed' },
    };
  }
  throw new Error('Atomic request response has an unknown outcome');
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

export function createRepository(client?: SubmitRequestClient): SubmitRequestRepository {
  if (client) return repositoryFor(client);

  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = getServerSecretKey();
  if (!url || !secretKey) throw new Error('Supabase server configuration is missing');

  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as SubmitRequestClient;
  return repositoryFor(supabase);
}

function repositoryFor(client: SubmitRequestClient): SubmitRequestRepository {
  const findByIdempotencyKey: SubmitRequestRepository['findByIdempotencyKey'] = async (idempotencyKey) => {
    const { data, error } = await client
      .from('service_requests')
      .select('id, reference')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (error) throw error;
    const stored = readStoredRequest(data);
    if (!stored) return null;
    const requestId = data && typeof data === 'object' ? (data as { id?: unknown }).id : null;
    if (typeof requestId !== 'string') return stored;
    const { data: delivery, error: deliveryError } = await client
      .from('telegram_deliveries')
      .select('status')
      .eq('request_id', requestId)
      .order('attempt', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (deliveryError) throw deliveryError;
    const status = delivery && typeof delivery === 'object' ? (delivery as { status?: unknown }).status : null;
    return { ...stored, telegramStatus: status === 'sent' ? 'sent' : 'failed' };
  };

  return {
    findByIdempotencyKey,
    async findActiveRoom(roomToken) {
      const { data, error } = await client
        .from('rooms')
        .select('id, hotel_id, hotels!inner(id)')
        .eq('public_token', roomToken)
        .eq('active', true)
        .eq('hotels.active', true)
        .maybeSingle();
      if (error) throw error;
      return readActiveRoom(data);
    },
    async submitAtomically(request) {
      const { data, error } = await client.rpc('submit_guest_request', {
        p_reference: request.reference,
        p_idempotency_key: request.idempotencyKey,
        p_rate_limit_key: request.rateKey,
        p_hotel_id: request.room.hotelId,
        p_room_id: request.room.id,
        p_service_type: request.service,
        p_choice: request.choice,
        p_pickup: request.pickup,
        p_destination: request.destination,
        p_requested_date: request.date,
        p_requested_time: request.time || null,
        p_party_size: request.partySize,
        p_guest_name: request.guestName,
        p_guest_contact: request.contact,
        p_note: request.note,
      });
      const conflict = uniqueConflict(error);
      if (conflict === 'reference_conflict') return { kind: conflict };
      if (conflict === 'idempotency_conflict') {
        const existingRequest = await findByIdempotencyKey(request.idempotencyKey);
        if (existingRequest) return { kind: 'existing', request: existingRequest };
      }
      if (error) throw error;
      return readAtomicResult(data);
    },
    async findByReference(reference) {
      const { data, error } = await client
        .from('service_requests')
        .select('id, reference, service_type, choice, pickup, destination, requested_date, requested_time, party_size, guest_name, guest_contact, note, rooms!inner(label, hotels!inner(name))')
        .eq('reference', reference)
        .maybeSingle();
      if (error) throw error;
      return readDeliveryRequest(data);
    },
    async createDelivery(requestId, attempt) {
      const { data, error } = await client
        .from('telegram_deliveries')
        .insert({ request_id: requestId, attempt, status: 'pending' })
        .select('id')
        .maybeSingle();
      if (error) throw error;
      const id = data && typeof data === 'object' ? (data as { id?: unknown }).id : null;
      if (typeof id !== 'string') throw new Error('Telegram delivery response is invalid');
      return { id };
    },
    async completeDelivery(deliveryId, result) {
      const { error } = await client
        .from('telegram_deliveries')
        .update({
          status: 'sent',
          telegram_message_id: result.telegramMessageId,
          error_code: null,
          error_message: null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', deliveryId)
        .maybeSingle();
      if (error) throw error;
    },
    async failDelivery(deliveryId, failure) {
      const { error } = await client
        .from('telegram_deliveries')
        .update({
          status: 'failed',
          error_code: failure.code,
          error_message: failure.message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', deliveryId)
        .maybeSingle();
      if (error) throw error;
    },
  };
}

function createProductionDependencies(): SubmitRequestDependencies {
  const requestHashSecret = Deno.env.get('REQUEST_HASH_SECRET');
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!requestHashSecret || !botToken || !chatId) throw new Error('Server configuration is missing');
  return {
    repository: createRepository(),
    requestHashSecret,
    telegramSender: (request) => sendTelegramMessage(
      (input, init) => fetch(input, init),
      botToken,
      chatId,
      formatTelegramRequest(request, 'Asia/Tashkent'),
    ),
  };
}

function dependenciesFor(context?: HandlerContext): SubmitRequestDependencies {
  return context && 'repository' in context ? context : createProductionDependencies();
}

function nextReference(): string {
  return createReference(crypto.getRandomValues(new Uint8Array(5)));
}

async function parsePayload(request: Request): Promise<ValidatedRequest | null> {
  const mediaType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return null;

  try {
    return validateSubmitPayload(await request.json());
  } catch {
    return null;
  }
}

function safeDeliveryFailure(reason: unknown): { code: string; message: string } {
  if (reason instanceof TelegramDeliveryError) {
    if (reason.code === 'TELEGRAM_TIMEOUT') {
      return { code: 'TELEGRAM_TIMEOUT', message: 'Telegram request timed out' };
    }
    if (reason.code === 'TELEGRAM_NETWORK_ERROR') {
      return { code: 'TELEGRAM_NETWORK_ERROR', message: 'Telegram network request failed' };
    }
    if (reason.code === 'TELEGRAM_API_ERROR') {
      return { code: 'TELEGRAM_API_ERROR', message: 'Telegram API request failed' };
    }
    if (reason.code === 'TELEGRAM_RESPONSE_INVALID') {
      return { code: 'TELEGRAM_RESPONSE_INVALID', message: 'Telegram response was invalid' };
    }
  }
  return { code: 'TELEGRAM_DELIVERY_FAILED', message: 'Telegram delivery failed' };
}

async function deliverNewRequest(
  repository: SubmitRequestRepository,
  telegramSender: SubmitRequestDependencies['telegramSender'],
  request: DeliveryRequest,
): Promise<'sent' | 'failed'> {
  const delivery = await repository.createDelivery(request.id, 1);
  let failure = { code: 'TELEGRAM_DELIVERY_FAILED', message: 'Telegram delivery failed' };

  for (let sendAttempt = 0; sendAttempt < 2; sendAttempt += 1) {
    let result: { messageId: number };
    try {
      result = await telegramSender(request);
    } catch (reason) {
      failure = safeDeliveryFailure(reason);
      continue;
    }
    await repository.completeDelivery(delivery.id, { telegramMessageId: result.messageId });
    return 'sent';
  }

  await repository.failDelivery(delivery.id, failure);
  return 'failed';
}

export async function handler(request: Request, context?: HandlerContext): Promise<Response> {
  if (request.method === 'OPTIONS') return emptyResponse(204, POST_ALLOWED_METHODS);
  if (request.method !== 'POST') return submitJson({ code: 'METHOD_NOT_ALLOWED' }, 405);

  const validated = await parsePayload(request);
  if (!validated) return submitJson({ code: 'INVALID_REQUEST' }, 400);

  try {
    const dependencies = dependenciesFor(context);
    const existing = await dependencies.repository.findByIdempotencyKey(validated.idempotencyKey);
    if (existing) return submitJson(existing, 200);

    const room = await dependencies.repository.findActiveRoom(validated.roomToken);
    if (!room) return submitJson({ code: 'ROOM_UNAVAILABLE' }, 404);

    const rateKey = await createRateLimitKey(dependencies.requestHashSecret, room.id, validated.contact);

    for (let attempt = 0; attempt < REFERENCE_INSERT_ATTEMPTS; attempt += 1) {
      const reference = dependencies.referenceFactory?.() ?? nextReference();
      const result = await dependencies.repository.submitAtomically({ ...validated, room, rateKey, reference });
      if (result.kind === 'created') {
        const stored = await dependencies.repository.findByReference(result.request.reference);
        if (!stored) throw new Error('Created request is unavailable for delivery');
        const telegramStatus = await deliverNewRequest(dependencies.repository, dependencies.telegramSender, stored);
        return submitJson({ reference: stored.reference, telegramStatus }, telegramStatus === 'sent' ? 201 : 202);
      }
      if (result.kind === 'existing') {
        const existingRequest = await dependencies.repository.findByIdempotencyKey(validated.idempotencyKey);
        return submitJson(existingRequest ?? result.request, 200);
      }
      if (result.kind === 'rate_limited') return submitJson({ code: 'RATE_LIMITED' }, 429);
    }

    throw new Error('Unable to allocate a request reference');
  } catch {
    return submitJson({ code: 'REQUEST_FAILED' }, 500);
  }
}

if (import.meta.main) Deno.serve(handler);
