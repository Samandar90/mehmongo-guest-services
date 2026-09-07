import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OwnerPayouts } from './owner-payouts';
import type { HotelSettlement } from '@/lib/admin/summary';

const hotels: HotelSettlement[] = [
  {
    hotelId: 'hotel-1',
    hotelName: 'Kamilovs Hotel',
    requests: 7,
    completed: 3,
    cancelled: 1,
    payouts: [{ currency: 'USD', payoutMinor: 1_200, requests: 3 }],
    turnover: [
      { currency: 'USD', amountMinor: 30_000, requests: 1 },
      { currency: 'UZS', amountMinor: 40_000_000, requests: 2 },
    ],
    byService: [{ serviceType: 'transport', requests: 2, completed: 2 }],
  },
  {
    hotelId: 'hotel-2',
    hotelName: 'Second Hotel',
    requests: 1,
    completed: 1,
    cancelled: 0,
    payouts: [{ currency: 'USD', payoutMinor: 200, requests: 1 }],
    turnover: [{ currency: 'UZS', amountMinor: 50_000_000, requests: 1 }],
    byService: [{ serviceType: 'tickets', requests: 1, completed: 1 }],
  },
];

describe('OwnerPayouts', () => {
  it('names every hotel that had requests in the period', () => {
    render(<OwnerPayouts hotels={hotels} />);
    expect(screen.getByText('Kamilovs Hotel')).toBeVisible();
    expect(screen.getByText('Second Hotel')).toBeVisible();
  });

  it('lists a hotel turnover currencies on their own lines, apart from the payout', () => {
    render(<OwnerPayouts hotels={hotels} />);
    const table = screen.getByRole('table', { name: /по отелям/i });

    // Paid in dollars; the sales behind it were settled in two currencies.
    expect(within(table).getByText('12,00 USD')).toBeVisible();
    expect(within(table).getByText('40 000 000 UZS')).toBeVisible();
    expect(within(table).getByText('300,00 USD')).toBeVisible();
  });

  it('says a hotel that earned nothing earned nothing, instead of leaving a blank', () => {
    render(<OwnerPayouts hotels={[{ ...hotels[1], completed: 0, payouts: [], turnover: [] }]} />);
    // Both money columns say so explicitly rather than sitting empty.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('says the period was quiet when no hotel had anything', () => {
    render(<OwnerPayouts hotels={[]} />);
    expect(screen.getByText(/Ни один отель/i)).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
