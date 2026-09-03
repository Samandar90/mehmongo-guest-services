/// <reference lib="deno.ns" />

import { createClient } from '@supabase/supabase-js';
import type { ValidatedRequest } from '../_shared/validation.ts';
import { validateSubmitPayload } from '../_shared/validation.ts';
import { emptyResponse, jsonResponse } from '../_shared/http.ts';
import { createRateLimitKey, createReference } from '../_shared/security.ts';

const RATE_LIMIT_WINDOW_MS = 10 * 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5;
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

export type InsertRequest = ValidatedRequest & {
  room: ActiveRoom;
  rateKey: string;
  reference: string;
};

export type InsertResult =
  | { kind: 'inserted'; request: StoredRequest }
  | { kind: 'idempotency_conflict' }
  | { kind: 'reference_conflict' };

type InsertConflict = Exclude<InsertResult, { kind: 'inserted' }>['kind'];

export type SubmitRequestRepository = {
  findByIdempotencyKey: (idempotencyKey: string) => Promise<StoredRequest | null>;
  findActiveRoom: (roomToken: string) => Promise<ActiveRoom | null>;
  countRecent: (rateKey: string, windowMs: number) => Promise<number>;
  insertRequest: (request: InsertRequest) => Promise<InsertResult>;
};

export type SubmitRequestDependencies = {
  repository: SubmitRequestRepository;
  requestHashSecret: string;
  referenceFactory?: () => string;
};

type QueryResult = {
  data: unknown;
  error: unknown;
  count?: number | null;
};

export type SubmitRequestQuery = {
  select: (columns: string, options?: { count?: 'exact'; head?: boolean }) => SubmitRequestQuery;
  eq: (column: string, value: unknown) => SubmitRequestQuery;
  gte: (column: string, value: unknown) => SubmitRequestQuery;
  insert: (values: Record<string, unknown>) => SubmitRequestQuery;
  maybeSingle: () => Promise<QueryResult>;
  single: () => Promise<QueryResult>;
  then: Promise<QueryResult>['then'];
};

export type SubmitRequestClient = {
  from: (table: 'rooms' | 'service_requests') => SubmitRequestQuery;
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
  return {
    async findByIdempotencyKey(idempotencyKey) {
      const { data, error } = await client
        .from('service_requests')
        .select('reference')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (error) throw error;
      return readStoredRequest(data);
    },
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
    async countRecent(rateKey, windowMs) {
      const start = new Date(Date.now() - windowMs).toISOString();
      const { count, error } = await client
        .from('service_requests')
        .select('id', { count: 'exact', head: true })
        .eq('rate_limit_key', rateKey)
        .gte('created_at', start);
      if (error) throw error;
      return count ?? 0;
    },
    async insertRequest(request) {
      const { data, error } = await client
        .from('service_requests')
        .insert({
          reference: request.reference,
          idempotency_key: request.idempotencyKey,
          rate_limit_key: request.rateKey,
          hotel_id: request.room.hotelId,
          room_id: request.room.id,
          service_type: request.service,
          choice: request.choice,
          pickup: request.pickup,
          destination: request.destination,
          requested_date: request.date,
          requested_time: request.time || null,
          party_size: request.partySize,
          guest_name: request.guestName,
          guest_contact: request.contact,
          note: request.note,
        })
        .select('reference')
        .single();
      const conflict = uniqueConflict(error);
      if (conflict === 'idempotency_conflict') return { kind: conflict };
      if (conflict === 'reference_conflict') return { kind: conflict };
      if (error) throw error;

      const storedRequest = readStoredRequest(data);
      if (!storedRequest) throw new Error('Inserted request is missing a reference');
      return { kind: 'inserted', request: storedRequest };
    },
  };
}

function createProductionDependencies(): SubmitRequestDependencies {
  const requestHashSecret = Deno.env.get('REQUEST_HASH_SECRET');
  if (!requestHashSecret) throw new Error('Request hash configuration is missing');
  return { repository: createRepository(), requestHashSecret };
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
    if (await dependencies.repository.countRecent(rateKey, RATE_LIMIT_WINDOW_MS) >= RATE_LIMIT_MAX_REQUESTS) {
      return submitJson({ code: 'RATE_LIMITED' }, 429);
    }

    for (let attempt = 0; attempt < REFERENCE_INSERT_ATTEMPTS; attempt += 1) {
      const reference = dependencies.referenceFactory?.() ?? nextReference();
      const result = await dependencies.repository.insertRequest({ ...validated, room, rateKey, reference });
      if (result.kind === 'inserted') return submitJson(result.request, 201);
      if (result.kind === 'idempotency_conflict') {
        const racedRequest = await dependencies.repository.findByIdempotencyKey(validated.idempotencyKey);
        if (racedRequest) return submitJson(racedRequest, 200);
        throw new Error('Idempotency conflict did not return a request');
      }
    }

    throw new Error('Unable to allocate a request reference');
  } catch {
    return submitJson({ code: 'REQUEST_FAILED' }, 500);
  }
}

if (import.meta.main) Deno.serve(handler);
