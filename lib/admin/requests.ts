import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { ServiceId } from '@/supabase/functions/_shared/contracts';

export type TelegramStatus = 'pending' | 'sent' | 'failed';
export type RequestStatus = 'new';

export type RequestFilters = {
  hotelId?: string;
  roomId?: string;
  serviceType?: ServiceId;
  status?: RequestStatus;
  /** Inclusive calendar date, YYYY-MM-DD (UTC day boundaries). */
  dateFrom?: string;
  /** Inclusive calendar date, YYYY-MM-DD (UTC day boundaries). */
  dateTo?: string;
};

export type AdminRequestRow = {
  id: string;
  reference: string;
  createdAt: string;
  hotelId: string;
  hotelName: string;
  roomId: string;
  roomLabel: string;
  serviceType: ServiceId;
  status: RequestStatus;
  choice: string;
  pickup: string;
  destination: string;
  requestedDate: string | null;
  requestedTime: string | null;
  partySize: number | null;
  guestName: string;
  contact: string;
  note: string;
  telegramStatus: TelegramStatus | 'none';
  telegramAttempt: number;
  telegramErrorCode: string | null;
};

export type RequestPage = { items: AdminRequestRow[]; hasMore: boolean };

export type RetryResult = { status: TelegramStatus; reason?: 'already_pending' };

export type AdminRequestErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'REQUEST_NOT_FOUND'
  | 'RETRY_FAILED';

export class AdminRequestError extends Error {
  constructor(readonly code: AdminRequestErrorCode, message: string = code) {
    super(message);
    this.name = 'AdminRequestError';
  }
}

export const requestPageSize = 100;

const requestColumns = [
  'id', 'reference', 'service_type', 'status', 'choice', 'pickup', 'destination',
  'requested_date', 'requested_time', 'party_size', 'guest_name', 'guest_contact', 'note',
  'hotel_id', 'room_id', 'created_at',
  'hotels!inner(name)', 'rooms!inner(label)',
  'telegram_deliveries(attempt, status, error_code)',
].join(', ');

type DeliveryRow = { attempt: number; status: TelegramStatus; error_code: string | null };

type RequestRow = {
  id: string;
  reference: string;
  service_type: ServiceId;
  status: RequestStatus;
  choice: string | null;
  pickup: string | null;
  destination: string | null;
  requested_date: string | null;
  requested_time: string | null;
  party_size: number | null;
  guest_name: string;
  guest_contact: string;
  note: string;
  hotel_id: string;
  room_id: string;
  created_at: string;
  hotels: { name: string } | { name: string }[] | null;
  rooms: { label: string } | { label: string }[] | null;
  telegram_deliveries: DeliveryRow[] | null;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Admin timestamps, Telegram messages and the pilot hotel all live in
 * Asia/Tashkent, which has a fixed +05:00 offset and no DST. Day filters use
 * the same boundary so a request shown as 01.08 is found by dateFrom=01.08.
 */
export const requestTimeZoneOffset = '+05:00';

function localMidnight(date: string, plusDays = 0): string {
  if (!datePattern.test(date)) throw new AdminRequestError('VALIDATION_ERROR', 'Invalid date filter');
  const parsed = new Date(`${date}T00:00:00.000${requestTimeZoneOffset}`);
  const roundTrip = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || roundTrip.toISOString().slice(0, 10) !== date) {
    throw new AdminRequestError('VALIDATION_ERROR', 'Invalid date filter');
  }
  parsed.setUTCDate(parsed.getUTCDate() + plusDays);
  return parsed.toISOString();
}

function single<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function latestDelivery(deliveries: DeliveryRow[] | null): DeliveryRow | null {
  return (deliveries ?? []).reduce<DeliveryRow | null>(
    (latest, delivery) => (latest === null || delivery.attempt > latest.attempt ? delivery : latest),
    null,
  );
}

function toRow(row: RequestRow): AdminRequestRow {
  const delivery = latestDelivery(row.telegram_deliveries);
  return {
    id: row.id,
    reference: row.reference,
    createdAt: row.created_at,
    hotelId: row.hotel_id,
    hotelName: single(row.hotels)?.name ?? '',
    roomId: row.room_id,
    roomLabel: single(row.rooms)?.label ?? '',
    serviceType: row.service_type,
    status: row.status,
    choice: row.choice ?? '',
    pickup: row.pickup ?? '',
    destination: row.destination ?? '',
    requestedDate: row.requested_date,
    requestedTime: row.requested_time ? row.requested_time.slice(0, 5) : null,
    partySize: row.party_size,
    guestName: row.guest_name,
    contact: row.guest_contact,
    note: row.note,
    telegramStatus: delivery?.status ?? 'none',
    telegramAttempt: delivery?.attempt ?? 0,
    telegramErrorCode: delivery?.error_code ?? null,
  };
}

export async function listRequests(
  filters: RequestFilters,
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<RequestPage> {
  // Validate before touching the network so a bad filter never becomes a 400 from PostgREST.
  const from = filters.dateFrom ? localMidnight(filters.dateFrom) : null;
  const to = filters.dateTo ? localMidnight(filters.dateTo, 1) : null;

  let query = client.from('service_requests').select(requestColumns);
  if (filters.hotelId) query = query.eq('hotel_id', filters.hotelId);
  if (filters.roomId) query = query.eq('room_id', filters.roomId);
  if (filters.serviceType) query = query.eq('service_type', filters.serviceType);
  if (filters.status) query = query.eq('status', filters.status);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lt('created_at', to);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(requestPageSize + 1);
  if (error) throw error;

  // The untyped client cannot infer the embedded relations; the mapper below tolerates array or object shapes.
  const rows = (data ?? []) as unknown as RequestRow[];
  return {
    items: rows.slice(0, requestPageSize).map(toRow),
    hasMore: rows.length > requestPageSize,
  };
}

async function functionErrorBody(error: unknown): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const context = typeof error === 'object' && error !== null ? (error as { context?: unknown }).context : undefined;
  if (!(context instanceof Response)) return null;
  try {
    const body = await context.clone().json();
    return { status: context.status, body: body && typeof body === 'object' ? body as Record<string, unknown> : {} };
  } catch {
    return { status: context.status, body: {} };
  }
}

function isTelegramStatus(value: unknown): value is TelegramStatus {
  return value === 'pending' || value === 'sent' || value === 'failed';
}

/**
 * Asks the retry-telegram Edge Function to allocate the next delivery attempt.
 * pending/failed/sent are all legitimate outcomes; only auth, lookup and
 * transport failures throw.
 */
export async function retryTelegram(
  requestId: string,
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<RetryResult> {
  const { data, error } = await client.functions.invoke('retry-telegram', { body: { requestId } });

  if (!error) {
    const status = data && typeof data === 'object' ? (data as { telegramStatus?: unknown }).telegramStatus : undefined;
    if (isTelegramStatus(status)) return { status };
    throw new AdminRequestError('RETRY_FAILED', 'Unexpected retry-telegram response');
  }

  const failure = await functionErrorBody(error);
  if (!failure) throw new AdminRequestError('RETRY_FAILED', 'retry-telegram is unreachable');

  if (isTelegramStatus(failure.body.telegramStatus)) return { status: failure.body.telegramStatus };
  if (failure.body.code === 'TELEGRAM_DELIVERY_PENDING') return { status: 'pending', reason: 'already_pending' };
  if (failure.status === 401) throw new AdminRequestError('UNAUTHORIZED');
  if (failure.status === 403) throw new AdminRequestError('FORBIDDEN');
  if (failure.status === 404) throw new AdminRequestError('REQUEST_NOT_FOUND');
  throw new AdminRequestError('RETRY_FAILED', `retry-telegram answered ${failure.status}`);
}
