import { describe, expect, it } from 'vitest';
import { AdminRequestError } from '@/lib/admin/requests';
import {
  formatMinorAmount,
  formatMinorInput,
  parseSettledAmount,
  settlementCurrencies,
} from '@/lib/admin/money';

/**
 * The money kernel. Every rule here exists because the alternative loses money
 * silently: a hundredth invented for a currency that has none, a float that
 * rounds a payout differently from the database, a typo stored as a real sum.
 */
describe('parseSettledAmount', () => {
  it('reads a som amount as whole minor units, because the som is the minor unit', () => {
    expect(parseSettledAmount('2500000', 'UZS')).toBe(2_500_000);
  });

  it('reads a dollar amount by padding its fraction, never by multiplying', () => {
    expect(parseSettledAmount('300,50', 'USD')).toBe(30_050);
    expect(parseSettledAmount('300.5', 'USD')).toBe(30_050);
    expect(parseSettledAmount('300', 'USD')).toBe(30_000);
  });

  it('keeps the cent that floating point loses', () => {
    // 335.7 * 100 is 33569.999999999996 in binary floating point.
    expect(parseSettledAmount('335,70', 'USD')).toBe(33_570);
  });

  it('strips the spaces an owner types or pastes back from the display', () => {
    expect(parseSettledAmount('2 500 000', 'UZS')).toBe(2_500_000);
    expect(parseSettledAmount('2 500 000', 'UZS')).toBe(2_500_000);
  });

  it('refuses a fractional som instead of quietly rounding it away', () => {
    expect(() => parseSettledAmount('2500000,50', 'UZS')).toThrow(AdminRequestError);
  });

  it('refuses a third decimal on a dollar amount', () => {
    expect(() => parseSettledAmount('300,505', 'USD')).toThrow(AdminRequestError);
  });

  it('refuses an empty, non-numeric or zero amount', () => {
    for (const input of ['', '   ', 'abc', '-5', '0', '0,00']) {
      expect(() => parseSettledAmount(input, 'USD'), input).toThrow(AdminRequestError);
    }
  });

  it('refuses an amount past the ceiling that guards against an extra group of zeros', () => {
    const ceiling = settlementCurrencies.UZS.ceilingMinor;
    expect(parseSettledAmount(String(ceiling), 'UZS')).toBe(ceiling);
    expect(() => parseSettledAmount(String(ceiling + 1), 'UZS')).toThrow(AdminRequestError);
  });

  it('reports its refusals in Russian, because the owner reads them', () => {
    expect(() => parseSettledAmount('', 'UZS')).toThrow(/Введите сумму/);
    expect(() => parseSettledAmount('2500000,50', 'UZS')).toThrow(/целым числом/);
  });
});

describe('formatMinorAmount', () => {
  it('shows som without a fraction and dollars with two', () => {
    expect(formatMinorAmount(2_500_000, 'UZS')).toBe('2 500 000 UZS');
    expect(formatMinorAmount(30_050, 'USD')).toBe('300,50 USD');
  });

  it('groups thousands with a non-breaking space so an amount never wraps mid-number', () => {
    expect(formatMinorAmount(1_234_567, 'UZS')).toBe('1 234 567 UZS');
  });

  it('pads a fraction shorter than the currency demands', () => {
    expect(formatMinorAmount(5, 'USD')).toBe('0,05 USD');
    expect(formatMinorAmount(0, 'USD')).toBe('0,00 USD');
  });

  it('prints an unknown currency verbatim rather than inventing a scale for it', () => {
    expect(formatMinorAmount(1234, 'EUR')).toBe('1 234 EUR');
  });
});

describe('formatMinorInput', () => {
  it('round-trips through the parser', () => {
    for (const [minor, currency] of [[2_500_000, 'UZS'], [30_050, 'USD'], [5, 'USD']] as const) {
      expect(parseSettledAmount(formatMinorInput(minor, currency), currency)).toBe(minor);
    }
  });

  it('leaves out the grouping and the code, so the field stays editable', () => {
    expect(formatMinorInput(2_500_000, 'UZS')).toBe('2500000');
    expect(formatMinorInput(30_050, 'USD')).toBe('300,50');
  });
});

// previewPayoutMinor and its tests are gone with the percentage. The payout no
// longer derives from the settled amount at all: it is a fixed rate per
// request, frozen by settle_request from public.payout_rates, and the monthly
// volume step is applied by settlement_summary. Both are covered by pgTAP,
// which is where that arithmetic now lives.
