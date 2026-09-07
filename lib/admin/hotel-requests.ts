import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { localMidnight } from '@/lib/admin/requests';
import type { ServiceId } from '@/supabase/functions/_shared/contracts';

/**
 * The hotel's own list of requests.
 *
 * It does not read service_requests. The hotel has no policy on that table —
 * a row policy cannot hide a column, and PostgREST filters on a column a role
 * may select even when it is not requested, so the settled amount would still
 * be reachable by a binary search. public.hotel_requests names its columns
 * instead, and the settled amount is not among them.
 */

export type HotelRequestRow = {
  id: string;
  reference: string;
  created_at: string;
  settled_at: string | null;
  status: string;
  service_type: ServiceId;
  room_label: string;
  payout_minor: number | null;
  payout_currency: string | null;
};

export type HotelRequest = {
  id: string;
  reference: string;
  createdAt: string;
  completedAt: string | null;
  status: string;
  serviceType: ServiceId;
  roomLabel: string;
  /** The base rate frozen onto the request; the monthly step is in the totals. */
  rateMinor: number | null;
  rateCurrency: string | null;
};

export async function listHotelRequests(
  period: { dateFrom?: string; dateTo?: string; limit?: number },
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<HotelRequest[]> {
  const fromAt = period.dateFrom ? localMidnight(period.dateFrom) : null;
  const toAt = period.dateTo ? localMidnight(period.dateTo, 1) : null;

  const { data, error } = await client.rpc('hotel_requests', {
    from_at: fromAt,
    to_at: toAt,
    max_rows: period.limit ?? 200,
  });
  if (error) throw error;

  return ((data ?? []) as HotelRequestRow[]).map((row) => ({
    id: row.id,
    reference: row.reference,
    createdAt: row.created_at,
    completedAt: row.settled_at,
    status: row.status,
    serviceType: row.service_type,
    roomLabel: row.room_label,
    rateMinor: row.payout_minor,
    rateCurrency: row.payout_currency,
  }));
}
