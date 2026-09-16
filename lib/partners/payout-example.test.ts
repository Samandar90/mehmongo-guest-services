import { describe, expect, it } from 'vitest';
import { monthPayout, volumeBonus } from './payout-example';

describe('volumeBonus', () => {
  it('steps at 15 and 40 completed requests', () => {
    expect(volumeBonus(14)).toBe(0);
    expect(volumeBonus(15)).toBe(0.2);
    expect(volumeBonus(39)).toBe(0.2);
    expect(volumeBonus(40)).toBe(0.4);
    expect(volumeBonus(400)).toBe(0.4);
  });
});

describe('monthPayout', () => {
  // The three months printed in the hotel presentation. If a rate or a step
  // changes, these fail, and the printed example has to be rebuilt with it.
  it('pays a quiet month at the first step', () => {
    const month = monthPayout({ transport: 10, tours: 4, tickets: 3 });
    expect(month.completed).toBe(17);
    expect(month.bonus).toBe(0.2);
    expect(month.base).toBe(58);
    expect(month.bonusAmount).toBeCloseTo(10.4);
    expect(month.total).toBeCloseTo(68.4);
  });

  it('pays a typical month at the top step', () => {
    const month = monthPayout({ transport: 25, tours: 10, tickets: 8 });
    expect(month.completed).toBe(43);
    expect(month.bonus).toBe(0.4);
    expect(month.base).toBe(146);
    expect(month.bonusAmount).toBeCloseTo(52);
    expect(month.total).toBeCloseTo(198);
  });

  it('pays high season at the top step', () => {
    const month = monthPayout({ transport: 60, tours: 25, tickets: 20 });
    expect(month.completed).toBe(105);
    expect(month.total).toBeCloseTo(488);
  });

  it('never puts the step on tickets, though tickets count toward it', () => {
    const month = monthPayout({ transport: 0, tours: 0, tickets: 40 });
    expect(month.bonus).toBe(0.4);
    expect(month.bonusAmount).toBe(0);
    expect(month.total).toBe(80);
  });

  it('applies the step to every request of the month, not only those past the threshold', () => {
    const month = monthPayout({ transport: 15, tours: 0, tickets: 0 });
    expect(month.total).toBeCloseTo(36);
  });
});
