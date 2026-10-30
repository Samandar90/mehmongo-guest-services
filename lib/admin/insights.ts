import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { addDays, daysBetween, type DateBasis, type Period } from '@/lib/admin/period';
import { localMidnight } from '@/lib/admin/requests';

/**
 * The owner's overview beyond the totals: what needs a hand today, and how
 * requests moved day by day. Both are counted in the database for the reason
 * the totals are: the request list is capped at one page.
 */

export type OwnerAttention = {
  overdueOpen: number;
  dueToday: number;
  telegramFailed: number;
  missingCost: number;
};

type AttentionRow = {
  overdue_open: number;
  due_today: number;
  telegram_failed: number;
  missing_cost: number;
};

export async function getOwnerAttention(
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<OwnerAttention> {
  const { data, error } = await client.rpc('owner_attention');
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as AttentionRow | undefined;
  return {
    overdueOpen: row?.overdue_open ?? 0,
    dueToday: row?.due_today ?? 0,
    telegramFailed: row?.telegram_failed ?? 0,
    missingCost: row?.missing_cost ?? 0,
  };
}

export type TimelineRow = { day: string; status: string; requests: number };

export async function getRequestTimeline(
  period: { dateFrom?: string; dateTo?: string; basis: DateBasis },
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<TimelineRow[]> {
  const fromAt = period.dateFrom ? localMidnight(period.dateFrom) : null;
  const toAt = period.dateTo ? localMidnight(period.dateTo, 1) : null;

  const { data, error } = await client.rpc('owner_request_timeline', {
    from_at: fromAt,
    to_at: toAt,
    date_basis: period.basis,
  });
  if (error) throw error;
  return (data ?? []) as TimelineRow[];
}

export type TimelineBucket = {
  /** First and last calendar day it covers; the same day unless the range is long. */
  from: string;
  to: string;
  completed: number;
  open: number;
  cancelled: number;
  total: number;
};

/** Beyond this a bar per day is thinner than a finger on a phone. */
const dailyLimit = 62;
const weeklyLimit = 400;

function bucketDays(span: number): number {
  if (span <= dailyLimit) return 1;
  return span <= weeklyLimit ? 7 : 30;
}

/**
 * Lays the rows on a real time axis: a quiet day is an empty slot, not a missing
 * one, or the bars would read as evenly busy. An open start begins at the first
 * request, and the axis stops at today so a month in progress has no blank tail.
 */
export function buildTimeline(rows: TimelineRow[], period: Period, today: string): TimelineBucket[] {
  if (rows.length === 0) return [];

  const first = rows.reduce((earliest, row) => (row.day < earliest ? row.day : earliest), rows[0].day);
  const start = period.dateFrom || first;
  const end = period.dateTo && period.dateTo < today ? period.dateTo : today;
  if (start > end) return [];

  const span = daysBetween(start, end) + 1;
  const size = bucketDays(span);
  const buckets: TimelineBucket[] = [];
  for (let offset = 0; offset < span; offset += size) {
    const from = addDays(start, offset);
    const last = addDays(from, size - 1);
    buckets.push({ from, to: last < end ? last : end, completed: 0, open: 0, cancelled: 0, total: 0 });
  }

  for (const row of rows) {
    const bucket = buckets[Math.floor(daysBetween(start, row.day) / size)];
    if (!bucket) continue;
    if (row.status === 'completed') bucket.completed += row.requests;
    else if (row.status === 'cancelled') bucket.cancelled += row.requests;
    else bucket.open += row.requests;
    bucket.total += row.requests;
  }
  return buckets;
}

/** The smallest of 1, 2 or 5 times a power of ten that holds the value. */
export function niceCeiling(value: number): number {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

/**
 * Change against the previous period as a whole percent, or null when the
 * previous figure is zero: "+∞%" says nothing that "было 0" does not.
 */
export function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
