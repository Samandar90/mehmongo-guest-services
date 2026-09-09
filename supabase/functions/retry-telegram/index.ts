/// <reference lib="deno.ns" />

import { createClient } from '@supabase/supabase-js';
import { emptyResponse, jsonResponse } from '../_shared/http.ts';
import { readOfferSnapshot } from '../_shared/catalog.ts';
import { isGuestLocale } from '../_shared/contracts.ts';
import {
  formatTelegramRequest,
  sendTelegramMessage,
  TelegramDeliveryError,
  type TelegramRequest,
} from '../_shared/telegram.ts';

const POST_ALLOWED_METHODS = 'POST, OPTIONS';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type TelegramStatus = 'pending' | 'sent' | 'failed';

export type RetryRequest = TelegramRequest & {
  id: string;
};

export type RetryTelegramRepository = {
  getUserId: (bearerToken: string) => Promise<string | null>;
  isActiveSuperAdmin: (userId: string) => Promise<boolean>;
  findRequest: (requestId: string) => Promise<RetryRequest | null>;
  createNextDelivery: (requestId: string) => Promise<
    | { kind: 'pending' }
    | { kind: 'created'; delivery: { id: string; attempt: number; status: TelegramStatus } }
  >;
  completeDelivery: (deliveryId: string, result: { telegramMessageId: number }) => Promise<boolean>;
  failDelivery: (deliveryId: string, error: { code: string; message: string }) => Promise<boolean>;
};

export type RetryTelegramDependencies = {
  repository: RetryTelegramRepository;
  telegramSender: (request: TelegramRequest) => Promise<{ messageId: number }>;
};

type QueryResult = {
  data: unknown;
  error: unknown;
};

export type RetryTelegramQuery = {
  select: (columns: string) => RetryTelegramQuery;
  insert: (values: Record<string, unknown>) => RetryTelegramQuery;
  update: (values: Record<string, unknown>) => RetryTelegramQuery;
  eq: (column: string, value: unknown) => RetryTelegramQuery;
  order: (column: string, options: { ascending: boolean }) => RetryTelegramQuery;
  limit: (count: number) => RetryTelegramQuery;
  maybeSingle: () => Promise<QueryResult>;
};

export type RetryTelegramClient = {
  auth: {
    getUser: (bearerToken: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  from: (table: 'admin_users' | 'service_requests' | 'telegram_deliveries') => RetryTelegramQuery;
};

type HandlerContext = RetryTelegramDependencies | Deno.ServeHandlerInfo;

function retryJson(body: unknown, status = 200): Response {
  return jsonResponse(body, status, POST_ALLOWED_METHODS);
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

function relation(value: unknown): Record<string, unknown> | null {
  const related = Array.isArray(value) ? value[0] : value;
  return related && typeof related === 'object' ? related as Record<string, unknown> : null;
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readRequest(data: unknown): RetryRequest | null {
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
    service: service as RetryRequest['service'],
    choice: optionalText(request.choice),
    pickup: optionalText(request.pickup),
    destination: optionalText(request.destination),
    requestedDate,
    requestedTime: requestedTime?.slice(0, 5) ?? null,
    partySize,
    guestName: request.guest_name,
    contact: request.guest_contact,
    note: request.note,
    // The stored snapshot, not today's catalogue price.
    offer: readOfferSnapshot(request.offer_snapshot),
    guestLocale: isGuestLocale(request.guest_locale) ? request.guest_locale : 'en',
    asap: request.asap === true,
  };
}

function isAttemptConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object' || (error as { code?: unknown }).code !== '23505') return false;
  const details = ['constraint', 'details', 'message']
    .map((key) => (error as Record<string, unknown>)[key])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return details.includes('telegram_deliveries') && details.includes('attempt');
}

export function createRepository(client?: RetryTelegramClient): RetryTelegramRepository {
  if (client) return repositoryFor(client);

  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = getServerSecretKey();
  if (!url || !secretKey) throw new Error('Supabase server configuration is missing');

  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as RetryTelegramClient;
  return repositoryFor(supabase);
}

function repositoryFor(client: RetryTelegramClient): RetryTelegramRepository {
  return {
    async getUserId(bearerToken) {
      const { data, error } = await client.auth.getUser(bearerToken);
      return error || !data.user || typeof data.user.id !== 'string' ? null : data.user.id;
    },
    async isActiveSuperAdmin(userId) {
      const { data, error } = await client
        .from('admin_users')
        .select('user_id')
        .eq('user_id', userId)
        .eq('role', 'super_admin')
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async findRequest(requestId) {
      const { data, error } = await client
        .from('service_requests')
        .select('id, reference, service_type, choice, pickup, destination, requested_date, requested_time, party_size, guest_name, guest_contact, note, offer_snapshot, guest_locale, asap, rooms!inner(label, hotels!inner(name))')
        .eq('id', requestId)
        .maybeSingle();
      if (error) throw error;
      return readRequest(data);
    },
    async createNextDelivery(requestId) {
      const { data: latest, error: latestError } = await client
        .from('telegram_deliveries')
        .select('attempt, status')
        .eq('request_id', requestId)
        .order('attempt', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw latestError;
      const previousAttempt = latest && typeof latest === 'object' ? (latest as { attempt?: unknown }).attempt : 0;
      if (typeof previousAttempt !== 'number' || !Number.isInteger(previousAttempt) || previousAttempt < 0) {
        throw new Error('Telegram delivery attempt response is invalid');
      }
      const latestStatus = latest && typeof latest === 'object' ? (latest as { status?: unknown }).status : null;
      if (latestStatus === 'pending' || latestStatus === 'sent') return { kind: 'pending' };
      const attempt = previousAttempt + 1;
      const { data, error } = await client
        .from('telegram_deliveries')
        .insert({ request_id: requestId, attempt, status: 'pending' })
        .select('id')
        .maybeSingle();
      if (error) {
        if (isAttemptConflict(error)) return { kind: 'pending' };
        throw error;
      }
      const id = data && typeof data === 'object' ? (data as { id?: unknown }).id : null;
      if (typeof id !== 'string') throw new Error('Telegram delivery response is invalid');
      return { kind: 'created', delivery: { id, attempt, status: 'pending' } };
    },
    async completeDelivery(deliveryId, result) {
      const { data, error } = await client
        .from('telegram_deliveries')
        .update({
          status: 'sent',
          telegram_message_id: result.telegramMessageId,
          error_code: null,
          error_message: null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', deliveryId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async failDelivery(deliveryId, failure) {
      const { data, error } = await client
        .from('telegram_deliveries')
        .update({
          status: 'failed',
          error_code: failure.code,
          error_message: failure.message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', deliveryId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
  };
}

function createProductionDependencies(): RetryTelegramDependencies {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!botToken || !chatId) throw new Error('Telegram server configuration is missing');
  return {
    repository: createRepository(),
    telegramSender: (request) => sendTelegramMessage(
      (input, init) => fetch(input, init),
      botToken,
      chatId,
      formatTelegramRequest(request, 'Asia/Tashkent'),
    ),
  };
}

function dependenciesFor(context?: HandlerContext): RetryTelegramDependencies {
  return context && 'repository' in context ? context : createProductionDependencies();
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1] ?? null;
}

async function requestIdFrom(request: Request): Promise<string | null> {
  const mediaType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return null;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body as Record<string, unknown>).length !== 1) return null;
    const requestId = (body as { requestId?: unknown }).requestId;
    return typeof requestId === 'string' && uuidPattern.test(requestId) ? requestId : null;
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

export async function handler(request: Request, context?: HandlerContext): Promise<Response> {
  if (request.method === 'OPTIONS') return emptyResponse(204, POST_ALLOWED_METHODS);
  if (request.method !== 'POST') return retryJson({ code: 'METHOD_NOT_ALLOWED' }, 405);

  const token = bearerToken(request);
  if (!token) return retryJson({ code: 'UNAUTHORIZED' }, 401);

  try {
    const dependencies = dependenciesFor(context);
    const userId = await dependencies.repository.getUserId(token);
    if (!userId) return retryJson({ code: 'UNAUTHORIZED' }, 401);
    if (!await dependencies.repository.isActiveSuperAdmin(userId)) return retryJson({ code: 'FORBIDDEN' }, 403);

    const requestId = await requestIdFrom(request);
    if (!requestId) return retryJson({ code: 'INVALID_REQUEST' }, 400);
    const storedRequest = await dependencies.repository.findRequest(requestId);
    if (!storedRequest) return retryJson({ code: 'REQUEST_NOT_FOUND' }, 404);

    const allocation = await dependencies.repository.createNextDelivery(storedRequest.id);
    if (allocation.kind === 'pending') return retryJson({ code: 'TELEGRAM_DELIVERY_PENDING' }, 409);
    const delivery = allocation.delivery;
    let result: { messageId: number };
    try {
      result = await dependencies.telegramSender(storedRequest);
    } catch (reason) {
      try {
        return await dependencies.repository.failDelivery(delivery.id, safeDeliveryFailure(reason))
          ? retryJson({ telegramStatus: 'failed' }, 502)
          : retryJson({ telegramStatus: 'pending' }, 503);
      } catch {
        return retryJson({ telegramStatus: 'pending' }, 503);
      }
    }
    try {
      return await dependencies.repository.completeDelivery(delivery.id, { telegramMessageId: result.messageId })
        ? retryJson({ telegramStatus: 'sent' })
        : retryJson({ telegramStatus: 'pending' }, 503);
    } catch {
      return retryJson({ telegramStatus: 'pending' }, 503);
    }
  } catch {
    return retryJson({ code: 'RETRY_FAILED' }, 500);
  }
}

if (import.meta.main) Deno.serve(handler);
