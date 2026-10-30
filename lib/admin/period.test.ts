import { describe, expect, it } from 'vitest';
import { addDays, isReversedPeriod, monthPeriod, periodPresets, previousPeriod } from './period';

describe('monthPeriod', () => {
  it('covers the whole calendar month', () => {
    expect(monthPeriod(0, '2026-10-30')).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });
  });

  it('crosses a year going back', () => {
    expect(monthPeriod(1, '2026-01-15')).toEqual({ dateFrom: '2025-12-01', dateTo: '2025-12-31' });
  });
});

describe('periodPresets', () => {
  it('counts seven days including today', () => {
    const week = periodPresets('2026-10-30').find((preset) => preset.label === '7 дней');
    expect(week?.value).toEqual({ dateFrom: '2026-10-24', dateTo: '2026-10-30' });
  });
});

describe('isReversedPeriod', () => {
  it('flags only a start after the end', () => {
    expect(isReversedPeriod({ dateFrom: '2026-10-12', dateTo: '2026-10-09' })).toBe(true);
    expect(isReversedPeriod({ dateFrom: '2026-10-12', dateTo: '2026-10-12' })).toBe(false);
    expect(isReversedPeriod({ dateFrom: '2026-10-12', dateTo: '' })).toBe(false);
  });
});

describe('previousPeriod', () => {
  it('compares a month in progress only as far as today', () => {
    expect(previousPeriod({ dateFrom: '2026-10-01', dateTo: '2026-10-31' }, '2026-10-30'))
      .toEqual({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  });

  it('takes the same length right before a finished period', () => {
    expect(previousPeriod({ dateFrom: '2026-10-05', dateTo: '2026-10-11' }, '2026-10-30'))
      .toEqual({ dateFrom: '2026-09-28', dateTo: '2026-10-04' });
  });

  it('compares one day with the day before', () => {
    expect(previousPeriod({ dateFrom: '2026-10-30', dateTo: '2026-10-30' }, '2026-10-30'))
      .toEqual({ dateFrom: '2026-10-29', dateTo: '2026-10-29' });
  });

  it('has nothing to compare for an open start, a reversed or a future period', () => {
    expect(previousPeriod({ dateFrom: '', dateTo: '' }, '2026-10-30')).toBeNull();
    expect(previousPeriod({ dateFrom: '2026-10-12', dateTo: '2026-10-01' }, '2026-10-30')).toBeNull();
    expect(previousPeriod({ dateFrom: '2026-11-01', dateTo: '2026-11-30' }, '2026-10-30')).toBeNull();
  });
});

describe('addDays', () => {
  it('crosses a month end', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });
});
