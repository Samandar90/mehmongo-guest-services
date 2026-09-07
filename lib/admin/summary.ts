import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { localMidnight } from '@/lib/admin/requests';
import type { ServiceId } from '@/supabase/functions/_shared/contracts';

/**
 * Settlement totals. The counting happens in public.settlement_summary, not
 * here: the request list is capped at one page, so folding it up in the browser
 * would stop counting past the cap and under-report what a hotel is owed.
 *
 * The function runs security invoker, so a hotel account gets its own hotel and
 * the owner gets every hotel from the same call.
 */

/**
 * One group as the database returns it.
 *
 * settled_currency and settled_amount_minor come back null for a hotel
 * account: what a request sold for is the owner's figure alone. The hotel is
 * paid a fixed rate per request, so it never needs the turnover to check what
 * it is owed.
 */
export type SummaryRow = {
  hotel_id: string;
  service_type: ServiceId;
  status: string;
  requests: number;
  settled_currency: string | null;
  settled_amount_minor: number | null;
  payout_currency: string | null;
  payout_minor: number;
};

/**
 * Payout and turnover are counted separately, not as two columns of one row.
 * The hotel is paid in dollars while the sale is often settled in som, so a
 * single per-currency total would put unrelated figures on the same line.
 */
export type PayoutTotal = { currency: string; payoutMinor: number; requests: number };
export type TurnoverTotal = { currency: string; amountMinor: number; requests: number };

export type ServiceTotal = { serviceType: ServiceId; requests: number; completed: number };

export type SettlementSummary = {
  requests: number;
  completed: number;
  cancelled: number;
  payouts: PayoutTotal[];
  /** Null when the viewer may not see turnover, which is every hotel account. */
  turnover: TurnoverTotal[] | null;
  byService: ServiceTotal[];
};

export type SummaryPeriod = { dateFrom?: string; dateTo?: string };

// The boundary itself now lives in lib/admin/requests.ts and is imported. The
// copy that used to be here looked the same but skipped the round-trip check,
// so it accepted '2026-09-31' and quietly counted a day of October into
// September. That was harmless while the payout was a percentage of each row;
// with a monthly volume step it moves money.

export async function getSettlementSummary(
  period: SummaryPeriod,
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<SummaryRow[]> {
  // Validated before the call so a bad date is a field error, not a 400.
  const fromAt = period.dateFrom ? localMidnight(period.dateFrom) : null;
  const toAt = period.dateTo ? localMidnight(period.dateTo, 1) : null;

  const { data, error } = await client.rpc('settlement_summary', { from_at: fromAt, to_at: toAt });
  if (error) throw error;
  return (data ?? []) as SummaryRow[];
}

/**
 * Folds the groups into what a screen shows. Pass a hotel id to look at one
 * hotel out of the owner's whole picture.
 */
export function summariseRows(rows: SummaryRow[], hotelId?: string): SettlementSummary {
  const scoped = hotelId ? rows.filter((row) => row.hotel_id === hotelId) : rows;

  const payouts = new Map<string, PayoutTotal>();
  const turnover = new Map<string, TurnoverTotal>();
  const services = new Map<ServiceId, ServiceTotal>();
  let requests = 0;
  let completed = 0;
  let cancelled = 0;
  // A hotel gets nulls in the turnover columns rather than a smaller number,
  // so an absent figure is told apart from a genuine zero.
  let maySeeTurnover = false;

  for (const row of scoped) {
    requests += row.requests;
    if (row.status === 'completed') completed += row.requests;
    if (row.status === 'cancelled') cancelled += row.requests;

    // Only a completed row carries money; everything else contributes nothing.
    if (row.status === 'completed' && row.payout_currency) {
      const total = payouts.get(row.payout_currency)
        ?? { currency: row.payout_currency, payoutMinor: 0, requests: 0 };
      total.payoutMinor += row.payout_minor;
      total.requests += row.requests;
      payouts.set(row.payout_currency, total);
    }

    if (row.status === 'completed' && row.settled_currency && row.settled_amount_minor !== null) {
      maySeeTurnover = true;
      const total = turnover.get(row.settled_currency)
        ?? { currency: row.settled_currency, amountMinor: 0, requests: 0 };
      total.amountMinor += row.settled_amount_minor;
      total.requests += row.requests;
      turnover.set(row.settled_currency, total);
    }

    const service = services.get(row.service_type) ?? { serviceType: row.service_type, requests: 0, completed: 0 };
    service.requests += row.requests;
    if (row.status === 'completed') service.completed += row.requests;
    services.set(row.service_type, service);
  }

  return {
    requests,
    completed,
    cancelled,
    payouts: [...payouts.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    turnover: maySeeTurnover
      ? [...turnover.values()].sort((a, b) => a.currency.localeCompare(b.currency))
      : null,
    // Busiest first, and stable by name so equal counts do not reorder between loads.
    byService: [...services.values()].sort((a, b) => b.requests - a.requests || a.serviceType.localeCompare(b.serviceType)),
  };
}

export type HotelSettlement = SettlementSummary & { hotelId: string; hotelName: string };

/**
 * The owner's view: one block per hotel that had anything in the period.
 *
 * A hotel with nothing is left out rather than shown as a row of zeroes, and
 * ordering is by what is owed, so the largest debt is read first. Comparing
 * across currencies is not meaningful, so the order uses the total number of
 * settled requests: it ranks activity without pretending som and dollars can be
 * added.
 */
export function summariseByHotel(
  rows: SummaryRow[],
  hotels: { id: string; name: string }[],
): HotelSettlement[] {
  const names = new Map(hotels.map((hotel) => [hotel.id, hotel.name]));
  const hotelIds = [...new Set(rows.map((row) => row.hotel_id))];

  return hotelIds
    .map((hotelId) => ({
      hotelId,
      // A hotel deleted or renamed out of the list still has to be identifiable.
      hotelName: names.get(hotelId) ?? hotelId,
      ...summariseRows(rows, hotelId),
    }))
    .sort((a, b) => b.completed - a.completed || b.requests - a.requests || a.hotelName.localeCompare(b.hotelName));
}
