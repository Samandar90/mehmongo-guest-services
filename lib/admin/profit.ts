import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { localMidnight } from '@/lib/admin/requests';
import type { ServiceId } from '@/supabase/functions/_shared/contracts';

/**
 * Revenue, supplier cost and margin — the owner's view and nobody else's.
 *
 * public.owner_profit_summary returns no rows to an account that is not an
 * active super admin, so a hotel calling it gets an empty report rather than a
 * refusal it could learn anything from.
 */

export type ProfitRow = {
  service_type: ServiceId;
  currency: string;
  requests: number;
  costed_requests: number;
  revenue_minor: number;
  cost_minor: number;
  margin_minor: number;
};

export type ServiceProfit = {
  serviceType: ServiceId;
  currency: string;
  requests: number;
  /** How many of those have a supplier cost entered. */
  costed: number;
  revenueMinor: number;
  costMinor: number;
  marginMinor: number;
};

export type CurrencyProfit = {
  currency: string;
  requests: number;
  costed: number;
  revenueMinor: number;
  costMinor: number;
  marginMinor: number;
};

export type ProfitSummary = {
  byCurrency: CurrencyProfit[];
  byService: ServiceProfit[];
  /** Completed requests still missing a cost, across every currency. */
  missingCost: number;
};

export async function getProfitSummary(
  period: { dateFrom?: string; dateTo?: string },
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<ProfitRow[]> {
  const fromAt = period.dateFrom ? localMidnight(period.dateFrom) : null;
  const toAt = period.dateTo ? localMidnight(period.dateTo, 1) : null;

  const { data, error } = await client.rpc('owner_profit_summary', { from_at: fromAt, to_at: toAt });
  if (error) throw error;
  return (data ?? []) as ProfitRow[];
}

/**
 * Folds the rows into what the screen shows.
 *
 * Nothing is ever added across currencies: som and dollars each total on their
 * own, exactly as the settlement figures do.
 */
export function summariseProfit(rows: ProfitRow[]): ProfitSummary {
  const byCurrency = new Map<string, CurrencyProfit>();
  const byService: ServiceProfit[] = [];
  let missingCost = 0;

  for (const row of rows) {
    missingCost += row.requests - row.costed_requests;

    byService.push({
      serviceType: row.service_type,
      currency: row.currency,
      requests: row.requests,
      costed: row.costed_requests,
      revenueMinor: row.revenue_minor,
      costMinor: row.cost_minor,
      marginMinor: row.margin_minor,
    });

    const total = byCurrency.get(row.currency)
      ?? { currency: row.currency, requests: 0, costed: 0, revenueMinor: 0, costMinor: 0, marginMinor: 0 };
    total.requests += row.requests;
    total.costed += row.costed_requests;
    total.revenueMinor += row.revenue_minor;
    total.costMinor += row.cost_minor;
    total.marginMinor += row.margin_minor;
    byCurrency.set(row.currency, total);
  }

  return {
    byCurrency: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    // Biggest margin first: the point of the screen is which service earns.
    byService: byService.sort((a, b) => b.marginMinor - a.marginMinor
      || a.serviceType.localeCompare(b.serviceType)),
    missingCost,
  };
}

/** Margin as a share of revenue, or null when there is nothing to divide by. */
export function marginShare(revenueMinor: number, marginMinor: number): number | null {
  if (revenueMinor <= 0) return null;
  return Math.round((marginMinor / revenueMinor) * 1000) / 10;
}
