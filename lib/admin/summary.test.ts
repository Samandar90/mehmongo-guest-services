import { describe, expect, it, vi } from 'vitest';
import { AdminRequestError } from '@/lib/admin/errors';
import { getSettlementSummary, summariseByHotel, summariseRows, type SummaryRow } from '@/lib/admin/summary';

function rpcClient(rows: SummaryRow[] | null, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error });
  return { client: { rpc } as never, rpc };
}

const rows: SummaryRow[] = [
  { hotel_id: 'hotel-1', service_type: 'transport', status: 'completed', settled_currency: 'UZS', requests: 2, settled_amount_minor: 40_000_000, hotel_payout_minor: 6_000_000 },
  { hotel_id: 'hotel-1', service_type: 'tours', status: 'completed', settled_currency: 'USD', requests: 1, settled_amount_minor: 30_000, hotel_payout_minor: 4_500 },
  { hotel_id: 'hotel-1', service_type: 'tours', status: 'cancelled', settled_currency: null, requests: 1, settled_amount_minor: 0, hotel_payout_minor: 0 },
  { hotel_id: 'hotel-1', service_type: 'tickets', status: 'new', settled_currency: null, requests: 3, settled_amount_minor: 0, hotel_payout_minor: 0 },
];

describe('getSettlementSummary', () => {
  it('asks the database to count, rather than counting a page in the browser', async () => {
    const { client, rpc } = rpcClient([]);

    await getSettlementSummary({ dateFrom: '2026-09-01', dateTo: '2026-09-03' }, client);

    expect(rpc).toHaveBeenCalledWith('settlement_summary', {
      from_at: expect.any(String),
      to_at: expect.any(String),
    });
  });

  it('bounds the period on Tashkent days, half open', async () => {
    const { client, rpc } = rpcClient([]);

    await getSettlementSummary({ dateFrom: '2026-09-03', dateTo: '2026-09-03' }, client);

    const [, args] = rpc.mock.calls[0];
    expect(args.from_at).toBe('2026-09-02T19:00:00.000Z');
    // Inclusive day, exclusive next midnight: a request is never counted twice.
    expect(args.to_at).toBe('2026-09-03T19:00:00.000Z');
  });

  it('passes no bounds when no period is asked for', async () => {
    const { client, rpc } = rpcClient([]);
    await getSettlementSummary({}, client);
    expect(rpc.mock.calls[0][1]).toEqual({ from_at: null, to_at: null });
  });

  it('refuses a malformed date before touching the network', async () => {
    const { client, rpc } = rpcClient([]);
    await expect(getSettlementSummary({ dateFrom: '03.09.2026' }, client)).rejects.toBeInstanceOf(AdminRequestError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes a database refusal through', async () => {
    const refusal = { code: '42501' };
    const { client } = rpcClient(null, refusal);
    await expect(getSettlementSummary({}, client)).rejects.toBe(refusal);
  });
});

describe('summariseRows', () => {
  it('counts every request in the period', () => {
    expect(summariseRows(rows).requests).toBe(7);
  });

  it('separates what completed from what was called off', () => {
    const summary = summariseRows(rows);
    expect(summary.completed).toBe(3);
    expect(summary.cancelled).toBe(1);
  });

  it('totals payouts per currency and never adds som to dollars', () => {
    expect(summariseRows(rows).payouts).toEqual([
      { currency: 'USD', amountMinor: 30_000, payoutMinor: 4_500, requests: 1 },
      { currency: 'UZS', amountMinor: 40_000_000, payoutMinor: 6_000_000, requests: 2 },
    ]);
  });

  it('breaks the count down by service, busiest first', () => {
    expect(summariseRows(rows).byService).toEqual([
      { serviceType: 'tickets', requests: 3, completed: 0 },
      { serviceType: 'tours', requests: 2, completed: 1 },
      { serviceType: 'transport', requests: 2, completed: 2 },
    ]);
  });

  it('reports an empty period as zero rather than as nothing at all', () => {
    expect(summariseRows([])).toEqual({ requests: 0, completed: 0, cancelled: 0, payouts: [], byService: [] });
  });

  it('keeps hotels apart when the owner asks across all of them', () => {
    const both: SummaryRow[] = [
      ...rows,
      { hotel_id: 'hotel-2', service_type: 'tickets', status: 'completed', settled_currency: 'UZS', requests: 1, settled_amount_minor: 50_000_000, hotel_payout_minor: 5_000_000 },
    ];
    expect(summariseRows(both, 'hotel-1').requests).toBe(7);
    expect(summariseRows(both, 'hotel-2').requests).toBe(1);
    expect(summariseRows(both).requests).toBe(8);
  });
});

describe('summariseByHotel', () => {
  const both: SummaryRow[] = [
    ...rows,
    { hotel_id: 'hotel-2', service_type: 'tickets', status: 'completed', settled_currency: 'UZS', requests: 1, settled_amount_minor: 50_000_000, hotel_payout_minor: 5_000_000 },
  ];
  const names = [
    { id: 'hotel-1', name: 'Kamilovs Hotel' },
    { id: 'hotel-2', name: 'Second Hotel' },
    { id: 'hotel-3', name: 'Quiet Hotel' },
  ];

  it('gives each hotel its own totals, per currency', () => {
    const [first, second] = summariseByHotel(both, names);

    expect(first.hotelName).toBe('Kamilovs Hotel');
    expect(first.requests).toBe(7);
    expect(first.payouts).toEqual([
      { currency: 'USD', amountMinor: 30_000, payoutMinor: 4_500, requests: 1 },
      { currency: 'UZS', amountMinor: 40_000_000, payoutMinor: 6_000_000, requests: 2 },
    ]);
    expect(second.payouts).toEqual([
      { currency: 'UZS', amountMinor: 50_000_000, payoutMinor: 5_000_000, requests: 1 },
    ]);
  });

  it('leaves out a hotel with nothing in the period rather than showing a row of zeroes', () => {
    expect(summariseByHotel(both, names).map((hotel) => hotel.hotelId)).toEqual(['hotel-1', 'hotel-2']);
  });

  it('still names a hotel that is no longer in the list', () => {
    const [only] = summariseByHotel(
      [{ hotel_id: 'hotel-9', service_type: 'tours', status: 'new', settled_currency: null, requests: 1, settled_amount_minor: 0, hotel_payout_minor: 0 }],
      names,
    );
    expect(only.hotelName).toBe('hotel-9');
  });

  it('orders by what is owed, so the biggest debt is read first', () => {
    const ordered = summariseByHotel(both, names);
    expect(ordered.map((hotel) => hotel.hotelId)).toEqual(['hotel-1', 'hotel-2']);
  });
});
