import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { AdminRequestError } from '@/lib/admin/errors';
import { parseSettledAmount, type SettlementCurrency } from '@/lib/admin/money';
import { readOfferSnapshot, type OfferSnapshot } from '@/supabase/functions/_shared/catalog';
import { isGuestLocale, type GuestLocale, type ServiceId } from '@/supabase/functions/_shared/contracts';

export type TelegramStatus = 'pending' | 'sent' | 'failed';
export type RequestStatus = 'new' | 'confirmed' | 'completed' | 'cancelled';

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
  /** The language the guest was reading the site in; the one to answer in. */
  guestLocale: GuestLocale;
  /** The guest asked for the nearest possible time; requestedTime is then null. */
  asap: boolean;
  telegramStatus: TelegramStatus | 'none';
  telegramAttempt: number;
  telegramErrorCode: string | null;
  /** Catalogue offer chosen by the guest, if any. */
  offerId: string | null;
  offerTitle: string | null;
  /**
   * Starting price the guest was shown, for reference only. It is not revenue
   * and it is not a confirmed total.
   */
  offerEstimate: string | null;
  /**
   * What the request sold for, in minor units of settledCurrency. Our own
   * turnover: it is recorded on every completed request and never shown to a
   * hotel, and since the payout became a fixed rate it no longer influences it.
   */
  settledAmountMinor: number | null;
  settledCurrency: string | null;
  /** When it was first completed. This is the month the payout belongs to. */
  completedAt: string | null;
  /**
   * What the supplier charged us, in minor units of settledCurrency. The
   * owner's figure: no hotel-facing function selects it, and null means it has
   * not been entered yet rather than that the service was free.
   */
  costMinor: number | null;
  /**
   * The base rate frozen onto the request at completion — not the payout. The
   * monthly volume step is added by settlement_summary when the month is read.
   */
  hotelRateMinor: number | null;
  hotelRateCurrency: string | null;
};

export type RequestPage = { items: AdminRequestRow[]; hasMore: boolean };

export type RetryResult = { status: TelegramStatus; reason?: 'already_pending' };

export { AdminRequestError, type AdminRequestErrorCode } from '@/lib/admin/errors';

export const requestPageSize = 100;

const requestColumns = [
  'id', 'reference', 'service_type', 'status', 'choice', 'pickup', 'destination',
  'requested_date', 'requested_time', 'party_size', 'guest_name', 'guest_contact', 'note',
  'hotel_id', 'room_id', 'created_at', 'offer_id', 'offer_snapshot', 'guest_locale', 'asap',
  'settled_amount_minor', 'settled_currency', 'settled_at', 'cost_amount_minor',
  'hotel_rate_minor', 'hotel_rate_currency',
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
  offer_id: string | null;
  offer_snapshot: unknown;
  guest_locale: string | null;
  asap: boolean | null;
  settled_amount_minor: number | null;
  settled_currency: string | null;
  settled_at: string | null;
  cost_amount_minor: number | null;
  hotel_rate_minor: number | null;
  hotel_rate_currency: string | null;
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

/**
 * Exported so the totals and the hotel's list use this boundary and not a
 * copy. There were two copies, and only this one rejected a day that does not
 * exist: '2026-09-31' parses as 1 October and silently widened the period by a
 * day. Under monthly payouts that boundary decides money.
 */
export function localMidnight(date: string, plusDays = 0): string {
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

/** Russian, reference-only wording for the price the guest saw. */
export function formatOfferEstimate(snapshot: OfferSnapshot): string {
  if (snapshot.priceMode === 'quote' || snapshot.amount === null) return 'индивидуальный расчёт';
  const currency = snapshot.currency ? ` ${snapshot.currency}` : '';
  const unit = snapshot.unit ? ` · ${snapshot.unit}` : '';
  return `от ${snapshot.amount}${currency}${unit}`;
}

function toRow(row: RequestRow): AdminRequestRow {
  const delivery = latestDelivery(row.telegram_deliveries);
  const offer = readOfferSnapshot(row.offer_snapshot);
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
    guestLocale: isGuestLocale(row.guest_locale) ? row.guest_locale : 'en',
    asap: row.asap === true,
    telegramStatus: delivery?.status ?? 'none',
    telegramAttempt: delivery?.attempt ?? 0,
    telegramErrorCode: delivery?.error_code ?? null,
    offerId: row.offer_id ?? null,
    offerTitle: offer?.title ?? null,
    offerEstimate: offer ? formatOfferEstimate(offer) : null,
    settledAmountMinor: row.settled_amount_minor ?? null,
    settledCurrency: row.settled_currency ?? null,
    completedAt: row.settled_at ?? null,
    costMinor: row.cost_amount_minor ?? null,
    hotelRateMinor: row.hotel_rate_minor ?? null,
    hotelRateCurrency: row.hotel_rate_currency ?? null,
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

export type DashboardMetrics = { activeHotels: number; activeRooms: number; newRequests: number };

async function exactCount(
  client: SupabaseClient,
  table: 'hotels' | 'rooms' | 'service_requests',
  column: string,
  value: unknown,
): Promise<number> {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true }).eq(column, value);
  if (error) throw error;
  return count ?? 0;
}

/** Three exact-count queries under RLS; no financial figures by design. */
export async function getDashboardMetrics(client: SupabaseClient = getSupabaseBrowserClient()): Promise<DashboardMetrics> {
  const [activeHotels, activeRooms, newRequests] = await Promise.all([
    exactCount(client, 'hotels', 'active', true),
    exactCount(client, 'rooms', 'active', true),
    exactCount(client, 'service_requests', 'status', 'new'),
  ]);
  return { activeHotels, activeRooms, newRequests };
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

/**
 * A completed settlement cannot be expressed without an amount and a currency,
 * so the shape the database CHECK enforces is unrepresentable here too. The
 * amount stays the raw typed text: parsing lives in one place, below.
 */
export type SettlementInput =
  | { requestId: string; status: 'new' | 'confirmed' | 'cancelled' }
  | {
      requestId: string;
      status: 'completed';
      amount: string;
      currency: SettlementCurrency;
      /**
       * What the supplier charged us. Optional: it is often known a day after
       * the sale, and leaving it blank keeps whatever was recorded before
       * rather than erasing it.
       */
      cost?: string;
    };

export type SettlementResult = {
  status: RequestStatus;
  settledAmountMinor: number | null;
  settledCurrency: string | null;
  completedAt: string | null;
  /** What we paid the supplier, in minor units of the settlement currency. */
  costMinor: number | null;
  /**
   * The base rate frozen onto the request. Not the payout: the monthly volume
   * step is a property of the whole month and is added when the month is read,
   * so no single request can carry a final figure.
   */
  hotelRateMinor: number | null;
  hotelRateCurrency: string | null;
};

type SettlementRpcRow = {
  request_status: RequestStatus;
  amount_minor: number | null;
  currency_code: string | null;
  cost_minor: number | null;
  completed_at: string | null;
  rate_minor: number | null;
  rate_currency_code: string | null;
};

/**
 * Records what a request became, through the owner-checked
 * public.settle_request. service_requests has no update grant, so this is the
 * only door; a hotel account calling it is refused by the routine itself.
 *
 * The amount is parsed before the call, so a mistyped figure is a field error
 * rather than a database exception. The commission is never sent: the routine
 * reads it from the hotel and freezes it. Database refusals are rethrown
 * untouched so the panel can read their code, as the rooms repository does.
 */
export async function settleRequest(
  input: SettlementInput,
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<SettlementResult> {
  const completed = input.status === 'completed';
  // A blank cost is "not known yet", not "zero": it is left out so the routine
  // keeps whatever was recorded before instead of overwriting it.
  const typedCost = completed ? (input.cost ?? '').trim() : '';
  const { data, error } = await client.rpc('settle_request', {
    target_request_id: input.requestId,
    new_status: input.status,
    new_amount_minor: completed ? parseSettledAmount(input.amount, input.currency) : null,
    new_currency: completed ? input.currency : null,
    new_cost_minor: typedCost ? parseSettledAmount(typedCost, (input as { currency: SettlementCurrency }).currency) : null,
  });
  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as SettlementRpcRow | undefined;
  if (!row) throw new AdminRequestError('RETRY_FAILED', 'settle_request returned no settlement');

  return {
    status: row.request_status,
    settledAmountMinor: row.amount_minor ?? null,
    settledCurrency: row.currency_code ?? null,
    completedAt: row.completed_at ?? null,
    costMinor: row.cost_minor ?? null,
    hotelRateMinor: row.rate_minor ?? null,
    hotelRateCurrency: row.rate_currency_code ?? null,
  };
}
