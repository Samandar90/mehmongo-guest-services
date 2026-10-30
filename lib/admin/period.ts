import { tashkentDate } from '@/lib/guest-request';

/**
 * Which date places a request in a report period.
 *
 * 'created' is when the guest sent it, the same date the request list filters
 * on. 'settled' is when it was first completed, which decides the month a hotel
 * is paid in. A request received on the 9th and done on the 24th belongs to
 * different days under each, so a screen has to say which one it means.
 */
export type DateBasis = 'created' | 'settled';

export type Period = { dateFrom: string; dateTo: string };

export type PeriodPreset = { label: string; value: Period };

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDay(date);
}

/** Whole days from one calendar day to another; negative when they are reversed. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

/**
 * Whole calendar months, because that is the unit the hotel payout is priced
 * in: the volume step multiplies every request of a month, so a period that
 * straddles two of them cannot report one honest payout figure.
 */
export function monthPeriod(monthsBack: number, today: string): Period {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1 - monthsBack;
  return {
    dateFrom: toDay(new Date(Date.UTC(year, month, 1))),
    dateTo: toDay(new Date(Date.UTC(year, month + 1, 0))),
  };
}

/** Tashkent days, not the browser's: the owner may be reading from another timezone. */
export function periodPresets(today: string = tashkentDate()): PeriodPreset[] {
  return [
    { label: 'Сегодня', value: { dateFrom: today, dateTo: today } },
    { label: '7 дней', value: { dateFrom: addDays(today, -6), dateTo: today } },
    { label: 'Этот месяц', value: monthPeriod(0, today) },
    { label: 'Прошлый месяц', value: monthPeriod(1, today) },
    { label: 'Весь период', value: { dateFrom: '', dateTo: '' } },
  ];
}

/** ISO dates compare correctly as text, and an open end is never reversed. */
export function isReversedPeriod(period: Period): boolean {
  return Boolean(period.dateFrom && period.dateTo && period.dateFrom > period.dateTo);
}

/**
 * The equally long stretch right before a period, for comparison, or null when
 * there is nothing to compare: an open start has no "before".
 *
 * The length runs only up to today. "This month" on the 30th is thirty days of
 * data, so comparing it with thirty-one would flatter the previous period.
 */
export function previousPeriod(period: Period, today: string = tashkentDate()): Period | null {
  if (!period.dateFrom || isReversedPeriod(period)) return null;
  const end = period.dateTo && period.dateTo < today ? period.dateTo : today;
  if (period.dateFrom > end) return null;
  const dateTo = addDays(period.dateFrom, -1);
  return { dateFrom: addDays(dateTo, -daysBetween(period.dateFrom, end)), dateTo };
}

export function formatDay(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}.${month}.${year}`;
}
