import { describe, expect, it, vi } from 'vitest';
import { buildTimeline, changePercent, getOwnerAttention, getRequestTimeline, niceCeiling } from './insights';

describe('getOwnerAttention', () => {
  it('reads the single row the database returns', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ overdue_open: 2, due_today: 1, telegram_failed: 3, missing_cost: 4 }],
      error: null,
    });
    await expect(getOwnerAttention({ rpc } as never)).resolves.toEqual({
      overdueOpen: 2, dueToday: 1, telegramFailed: 3, missingCost: 4,
    });
  });

  it('passes a refusal through rather than reporting that all is well', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('denied') });
    await expect(getOwnerAttention({ rpc } as never)).rejects.toThrow('denied');
  });
});

describe('getRequestTimeline', () => {
  it('bounds on Tashkent days and names the basis', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await getRequestTimeline({ dateFrom: '2026-10-12', dateTo: '2026-10-12', basis: 'created' }, { rpc } as never);
    expect(rpc).toHaveBeenCalledWith('owner_request_timeline', {
      from_at: '2026-10-11T19:00:00.000Z',
      to_at: '2026-10-12T19:00:00.000Z',
      date_basis: 'created',
    });
  });
});

describe('buildTimeline', () => {
  const period = { dateFrom: '2026-10-01', dateTo: '2026-10-31' };

  it('keeps a quiet day as an empty slot and stops at today', () => {
    const buckets = buildTimeline([
      { day: '2026-10-01', status: 'completed', requests: 2 },
      { day: '2026-10-03', status: 'cancelled', requests: 1 },
      { day: '2026-10-03', status: 'confirmed', requests: 1 },
    ], period, '2026-10-04');

    expect(buckets.map((bucket) => bucket.from)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(buckets[0]).toMatchObject({ completed: 2, total: 2 });
    expect(buckets[1].total).toBe(0);
    expect(buckets[2]).toMatchObject({ cancelled: 1, open: 1, total: 2 });
  });

  it('starts an open period at the first request', () => {
    const buckets = buildTimeline([{ day: '2026-10-28', status: 'new', requests: 1 }], { dateFrom: '', dateTo: '' }, '2026-10-30');
    expect(buckets.map((bucket) => bucket.from)).toEqual(['2026-10-28', '2026-10-29', '2026-10-30']);
  });

  it('groups a long range into weeks without losing a request', () => {
    const buckets = buildTimeline([
      { day: '2026-01-01', status: 'completed', requests: 1 },
      { day: '2026-01-07', status: 'completed', requests: 1 },
      { day: '2026-01-08', status: 'completed', requests: 1 },
      { day: '2026-04-30', status: 'new', requests: 1 },
    ], { dateFrom: '2026-01-01', dateTo: '2026-04-30' }, '2026-10-30');

    expect(buckets[0]).toMatchObject({ from: '2026-01-01', to: '2026-01-07', completed: 2 });
    expect(buckets[1].completed).toBe(1);
    expect(buckets.at(-1)?.to).toBe('2026-04-30');
    expect(buckets.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(4);
  });

  it('draws nothing for an empty or a future period', () => {
    expect(buildTimeline([], period, '2026-10-30')).toEqual([]);
    expect(buildTimeline([{ day: '2026-10-28', status: 'new', requests: 1 }], { dateFrom: '2026-11-01', dateTo: '' }, '2026-10-30')).toEqual([]);
  });
});

describe('niceCeiling', () => {
  it('rounds up to a readable axis top', () => {
    expect([0, 1, 3, 5, 7, 12, 60].map(niceCeiling)).toEqual([1, 1, 5, 5, 10, 20, 100]);
  });
});

describe('changePercent', () => {
  it('rounds to a whole percent, in both directions', () => {
    expect(changePercent(5, 4)).toBe(25);
    expect(changePercent(1, 3)).toBe(-67);
    expect(changePercent(4, 4)).toBe(0);
  });

  it('has no percentage from zero', () => {
    expect(changePercent(5, 0)).toBeNull();
  });
});
