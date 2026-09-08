import { describe, expect, it, vi } from 'vitest';
import { AdminRequestError } from '@/lib/admin/errors';
import { getProfitSummary, marginShare, summariseProfit, type ProfitRow } from '@/lib/admin/profit';

function rpcClient(rows: ProfitRow[] | null, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error });
  return { client: { rpc } as never, rpc };
}

const rows: ProfitRow[] = [
  // Som: two transfers sold for 600 000, bought for 400 000.
  { service_type: 'transport', currency: 'UZS', requests: 2, costed_requests: 2, revenue_minor: 600_000, cost_minor: 400_000, margin_minor: 200_000 },
  // A tour sold in dollars, cost not entered yet.
  { service_type: 'tours', currency: 'USD', requests: 1, costed_requests: 0, revenue_minor: 12_000, cost_minor: 0, margin_minor: 0 },
  { service_type: 'tickets', currency: 'UZS', requests: 3, costed_requests: 2, revenue_minor: 900_000, cost_minor: 500_000, margin_minor: 250_000 },
];

describe('getProfitSummary', () => {
  it('asks the database for the margin, rather than deriving it in the browser', async () => {
    const { client, rpc } = rpcClient([]);
    await getProfitSummary({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, client);
    expect(rpc).toHaveBeenCalledWith('owner_profit_summary', {
      from_at: expect.any(String),
      to_at: expect.any(String),
    });
  });

  it('bounds the period on Tashkent days, half open', async () => {
    const { client, rpc } = rpcClient([]);
    await getProfitSummary({ dateFrom: '2026-09-03', dateTo: '2026-09-03' }, client);
    const [, args] = rpc.mock.calls[0];
    expect(args.from_at).toBe('2026-09-02T19:00:00.000Z');
    expect(args.to_at).toBe('2026-09-03T19:00:00.000Z');
  });

  it('refuses a day that does not exist before touching the network', async () => {
    const { client, rpc } = rpcClient([]);
    await expect(getProfitSummary({ dateFrom: '2026-09-31' }, client)).rejects.toBeInstanceOf(AdminRequestError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes a database refusal through', async () => {
    const refusal = { code: '42501' };
    const { client } = rpcClient(null, refusal);
    await expect(getProfitSummary({}, client)).rejects.toBe(refusal);
  });
});

describe('summariseProfit', () => {
  it('totals each currency on its own, never across them', () => {
    expect(summariseProfit(rows).byCurrency).toEqual([
      { currency: 'USD', requests: 1, costed: 0, revenueMinor: 12_000, costMinor: 0, marginMinor: 0 },
      { currency: 'UZS', requests: 5, costed: 4, revenueMinor: 1_500_000, costMinor: 900_000, marginMinor: 450_000 },
    ]);
  });

  it('counts how many completed requests still have no cost', () => {
    // One tour and one of the three ticket sales.
    expect(summariseProfit(rows).missingCost).toBe(2);
  });

  it('orders services by what they earned, because that is the question', () => {
    expect(summariseProfit(rows).byService.map((s) => s.serviceType)).toEqual(['tickets', 'transport', 'tours']);
  });

  it('reports an empty period as empty rather than as zero profit', () => {
    expect(summariseProfit([])).toEqual({ byCurrency: [], byService: [], missingCost: 0 });
  });
});

describe('marginShare', () => {
  it('states margin as a share of revenue, to one decimal', () => {
    expect(marginShare(600_000, 200_000)).toBe(33.3);
    expect(marginShare(1_000, 250)).toBe(25);
  });

  it('has no answer when nothing was sold', () => {
    // Zero revenue with a margin is not 0% and not infinite: there is no share
    // to state, and printing one would invent a figure.
    expect(marginShare(0, 0)).toBeNull();
  });
});
