import { AdminRequestError } from '@/lib/admin/errors';

/**
 * The money kernel for owner-recorded settlements. It has no Supabase
 * dependency so the analytics screens can reuse the arithmetic, and so the rule
 * that no floating point touches money lives in one auditable place.
 */

/** Currencies a settlement may be recorded in. Mirrors public.settle_request. */
export type SettlementCurrency = 'UZS' | 'USD';

/**
 * How many digits of minor units one major unit holds, per currency.
 *
 * UZS is 0 deliberately: tiyin left circulation and every price in Tashkent is
 * quoted and paid in whole som, so the som is the minor unit. A hard-coded
 * hundredth would store two zeros carrying no information and show the owner a
 * figure they cannot check against a receipt.
 *
 * ceilingMinor is mistype protection, not a business limit: an extra group of
 * zeros is the likeliest slip on a phone. The same ceilings are enforced again
 * in public.settle_request and the two must move together.
 */
export const settlementCurrencies: Record<
  SettlementCurrency,
  { minorDigits: 0 | 2; label: string; ceilingMinor: number }
> = {
  UZS: { minorDigits: 0, label: 'Сум (UZS)', ceilingMinor: 1_000_000_000 },
  USD: { minorDigits: 2, label: 'Доллары (USD)', ceilingMinor: 10_000_000 },
};

export function isSettlementCurrency(value: unknown): value is SettlementCurrency {
  return typeof value === 'string' && value in settlementCurrencies;
}

export const settlementAmountMessages = {
  empty: 'Введите сумму',
  format: 'Только цифры, до двух знаков после запятой',
  fraction: 'Сумма в сумах вводится целым числом',
  range: 'Сумма выходит за допустимые пределы',
} as const;

const groupSeparator = ' ';
/** Every space an owner might type or paste back from the grouped display. */
const spacePattern = /[\s  ]/g;

function reject(message: string): never {
  throw new AdminRequestError('VALIDATION_ERROR', message);
}

function minorDigitsFor(currency: string): number {
  return isSettlementCurrency(currency) ? settlementCurrencies[currency].minorDigits : 0;
}

/**
 * Turns what the owner typed into integer minor units by assembling the digits
 * as text and reading them once. Nothing is multiplied or divided, so no
 * floating-point value ever holds money: `335.7 * 100` is 33569.999999999996,
 * and that lost cent is the whole reason this function exists.
 */
export function parseSettledAmount(input: string, currency: SettlementCurrency): number {
  const cleaned = input.replace(spacePattern, '').replace(',', '.');
  if (!cleaned) reject(settlementAmountMessages.empty);
  if (!/^\d+(\.\d+)?$/.test(cleaned)) reject(settlementAmountMessages.format);

  const { minorDigits, ceilingMinor } = settlementCurrencies[currency];
  const [whole, fraction = ''] = cleaned.split('.');
  if (fraction.length > minorDigits) {
    reject(minorDigits === 0 ? settlementAmountMessages.fraction : settlementAmountMessages.format);
  }

  const minor = Number(whole + fraction.padEnd(minorDigits, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > ceilingMinor) {
    reject(settlementAmountMessages.range);
  }
  return minor;
}

function splitMinor(minor: number, minorDigits: number): { whole: string; fraction: string } {
  const digits = String(Math.trunc(Math.abs(minor))).padStart(minorDigits + 1, '0');
  return minorDigits === 0
    ? { whole: digits, fraction: '' }
    : { whole: digits.slice(0, -minorDigits), fraction: digits.slice(-minorDigits) };
}

/**
 * Display form: `2 500 000 UZS`, `300,50 USD`.
 *
 * Hand-rolled on purpose. `Intl.NumberFormat('ru-RU', {style: 'currency',
 * currency: 'UZS'})` renders 2500000 as "2 500 000,00 UZS" because CLDR carries
 * no zero-digit override for the som, so switching to Intl would silently add a
 * hundredth to every som figure on the screen. An unknown currency is printed
 * at face value rather than given an invented scale.
 */
export function formatMinorAmount(minor: number, currency: string): string {
  const { whole, fraction } = splitMinor(minor, minorDigitsFor(currency));
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
  return `${grouped}${fraction ? `,${fraction}` : ''} ${currency}`;
}

/** Editable form, ungrouped and without the code, so it parses back unchanged. */
export function formatMinorInput(minor: number, currency: string): string {
  const { whole, fraction } = splitMinor(minor, minorDigitsFor(currency));
  return `${whole}${fraction ? `,${fraction}` : ''}`;
}


