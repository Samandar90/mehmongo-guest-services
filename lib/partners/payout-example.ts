/**
 * The hotel payout rules as a hotel is told them: a fixed sum per completed
 * request, and a monthly volume step on transfers and tours.
 *
 * This mirrors public.payout_rates and public.payout_tiers, seeded in
 * supabase/migrations/20260907170000_payout_rates.sql, which is what actually
 * pays. It exists so a printed example can be computed rather than typed, and
 * the test beside it pins the figures, so a change to the rates has to be made
 * in both places deliberately.
 */
export type PayoutService = 'transport' | 'tours' | 'tickets';

export const PAYOUT_RATES_USD: Record<PayoutService, number> = { transport: 2, tours: 8, tickets: 2 };

/** Tickets are flat: the fee on a ticket is too small to carry a +40% step. */
export const VOLUME_BONUS_APPLIES: Record<PayoutService, boolean> = { transport: true, tours: true, tickets: false };

/** Highest threshold first. Every completed request of the month counts toward it. */
export const VOLUME_TIERS = [
  { from: 40, bonus: 0.4 },
  { from: 15, bonus: 0.2 },
] as const;

export type MonthCounts = Record<PayoutService, number>;

export type MonthPayout = {
  completed: number;
  /** 0, 0.2 or 0.4. */
  bonus: number;
  lines: { service: PayoutService; count: number; rate: number; base: number }[];
  base: number;
  bonusAmount: number;
  total: number;
};

export function volumeBonus(completed: number): number {
  return VOLUME_TIERS.find((tier) => completed >= tier.from)?.bonus ?? 0;
}

/** Amounts in dollars; the step multiplies every eligible request of the month, not only those past the threshold. */
export function monthPayout(counts: MonthCounts): MonthPayout {
  const services: PayoutService[] = ['transport', 'tours', 'tickets'];
  const completed = services.reduce((sum, service) => sum + counts[service], 0);
  const bonus = volumeBonus(completed);
  const lines = services.map((service) => ({
    service,
    count: counts[service],
    rate: PAYOUT_RATES_USD[service],
    base: counts[service] * PAYOUT_RATES_USD[service],
  }));
  const base = lines.reduce((sum, line) => sum + line.base, 0);
  const eligible = lines.filter((line) => VOLUME_BONUS_APPLIES[line.service]).reduce((sum, line) => sum + line.base, 0);
  const bonusAmount = eligible * bonus;
  return { completed, bonus, lines, base, bonusAmount, total: base + bonusAmount };
}
