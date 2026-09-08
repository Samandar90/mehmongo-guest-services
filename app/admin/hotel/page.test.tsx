import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HotelCabinetPage from './page';
import { getAdminIdentity } from '@/lib/admin/auth';
import { getSettlementSummary } from '@/lib/admin/summary';
import { listHotelRequests } from '@/lib/admin/hotel-requests';

vi.mock('@/lib/admin/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/auth')>()),
  getAdminIdentity: vi.fn(),
}));

vi.mock('@/lib/admin/summary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/summary')>()),
  getSettlementSummary: vi.fn(),
}));

vi.mock('@/lib/admin/hotel-requests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/hotel-requests')>()),
  listHotelRequests: vi.fn(),
}));

/** What the database sends a hotel account: counts and payout, no turnover. */
const hotelRows = [
  {
    hotel_id: 'hotel-1', service_type: 'transport' as const, status: 'completed', requests: 2,
    settled_currency: null, settled_amount_minor: null, payout_currency: 'USD', payout_minor: 480,
  },
];

const hotelRequests = [
  {
    id: 'request-1', reference: 'MG-AAAAAAAA', createdAt: '2026-09-03T05:00:00.000Z',
    completedAt: '2026-09-03T09:00:00.000Z', status: 'completed', serviceType: 'transport' as const,
    roomLabel: '401', rateMinor: 200, rateCurrency: 'USD',
  },
];

describe('HotelCabinetPage', () => {
  beforeEach(() => {
    vi.mocked(getAdminIdentity).mockReset().mockResolvedValue({
      userId: 'user-1', role: 'hotel', hotelId: 'hotel-1',
    });
    vi.mocked(getSettlementSummary).mockReset().mockResolvedValue(hotelRows);
    vi.mocked(listHotelRequests).mockReset().mockResolvedValue(hotelRequests);
  });

  it('asks for a whole calendar month, because the volume step belongs to one', async () => {
    render(<HotelCabinetPage />);
    await screen.findByRole('table', { name: 'Заявки отеля' });

    const [period] = vi.mocked(getSettlementSummary).mock.calls[0];
    // First to last day inclusive; the repository turns the end into the next
    // Tashkent midnight. A part of a month could not be priced honestly.
    expect(period.dateFrom).toMatch(/^\d{4}-\d{2}-01$/);
    expect(period.dateTo).toMatch(/^\d{4}-\d{2}-(28|29|30|31)$/);
    expect(vi.mocked(listHotelRequests).mock.calls[0][0]).toEqual(period);
  });

  it('lists the hotel own requests with the room and the frozen rate', async () => {
    render(<HotelCabinetPage />);
    const table = await screen.findByRole('table', { name: 'Заявки отеля' });

    expect(within(table).getByText('MG-AAAAAAAA')).toBeVisible();
    expect(within(table).getByText('401')).toBeVisible();
    expect(within(table).getByText('Выполнена')).toBeVisible();
    expect(within(table).getByText('2,00 USD')).toBeVisible();
  });

  it('shows no money against a request that was not carried out', async () => {
    // The rate stays frozen on a request that completed and was then cancelled,
    // so re-completing it cannot re-read a newer rate card. Printing that figure
    // in the cabinet would read as a debt for work that never happened.
    vi.mocked(listHotelRequests).mockResolvedValue([
      { ...hotelRequests[0], status: 'cancelled', rateMinor: 200, rateCurrency: 'USD' },
    ]);
    render(<HotelCabinetPage />);
    const table = await screen.findByRole('table', { name: 'Заявки отеля' });

    expect(within(table).getByText('Отменена')).toBeVisible();
    expect(within(table).queryByText('2,00 USD')).toBeNull();
    expect(within(table).getByText('—')).toBeVisible();
  });

  it('shows the hotel no turnover anywhere on the page', async () => {
    render(<HotelCabinetPage />);
    await screen.findByRole('table', { name: 'Заявки отеля' });

    // The payout is there; what the services sold for is not, and there is no
    // turnover table for a hotel to read at all.
    expect(screen.getByText('4,80 USD')).toBeVisible();
    expect(screen.queryByRole('table', { name: /оборот/i })).toBeNull();
  });

  it('offers a retry rather than an empty screen when the load fails', async () => {
    vi.mocked(getSettlementSummary).mockRejectedValue(new Error('network'));
    render(<HotelCabinetPage />);

    expect(await screen.findByText('Не удалось загрузить данные кабинета.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible();
  });
});
