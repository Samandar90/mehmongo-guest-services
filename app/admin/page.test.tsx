import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboardPage from './page';
import { getDashboardMetrics } from '@/lib/admin/requests';
import { listHotels } from '@/lib/admin/hotels';
import { getSettlementSummary } from '@/lib/admin/summary';
import { getProfitSummary } from '@/lib/admin/profit';

vi.mock('@/lib/admin/requests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/requests')>()),
  getDashboardMetrics: vi.fn(),
}));

// The page runs two independent loads. Leaving these real made the counters'
// own error test flaky: the browser client threw, and a second alert appeared
// beside the one under test.
vi.mock('@/lib/admin/hotels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/hotels')>()),
  listHotels: vi.fn(),
}));

vi.mock('@/lib/admin/summary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/summary')>()),
  getSettlementSummary: vi.fn(),
}));

// The margin report loads beside the settlement totals. Left real, its browser
// client throws and a second alert appears next to the one under test.
vi.mock('@/lib/admin/profit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/profit')>()),
  getProfitSummary: vi.fn(),
}));

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    vi.mocked(getDashboardMetrics).mockReset();
    vi.mocked(listHotels).mockReset().mockResolvedValue([]);
    vi.mocked(getSettlementSummary).mockReset().mockResolvedValue([]);
    vi.mocked(getProfitSummary).mockReset().mockResolvedValue([]);
  });

  it('loads and renders the metrics', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 24, newRequests: 7 });
    render(<AdminDashboardPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Обзор' })).toBeInTheDocument();
    expect(await screen.findByText('24')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows a retryable error when metrics fail to load', async () => {
    const user = userEvent.setup();
    vi.mocked(getDashboardMetrics)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ activeHotels: 2, activeRooms: 40, newRequests: 0 });
    render(<AdminDashboardPage />);

    // Named by its text: the totals below load separately and can raise their own.
    expect(await screen.findByText('Не удалось загрузить показатели.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Новые заявки' })).not.toHaveAttribute('aria-busy');
    // Scoped to the three counters, which are links now: the totals section
    // below has its own em dashes for a hotel that earned nothing.
    const counters = ['Активные отели', 'Активные комнаты', 'Новые заявки']
      .map((name) => screen.getByRole('link', { name }));
    expect(counters.filter((card) => within(card).queryByText('—'))).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('40')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Новые заявки' })).not.toHaveAttribute('aria-busy');
  });

  it('announces loading through a persistent live region', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 24, newRequests: 7 });
    render(<AdminDashboardPage />);

    const live = screen.getByText('Загрузка показателей…');
    expect(live).toHaveAttribute('aria-live', 'polite');
    await screen.findByText('24');
    expect(live).toBeEmptyDOMElement();
  });

  it('shows the settlement totals alongside the counters', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 9, newRequests: 3 });
    vi.mocked(listHotels).mockResolvedValue([
      { id: 'hotel-1', name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', commissionBps: 1500, active: true, guestCatalogId: null, createdAt: '', updatedAt: '' },
    ]);
    vi.mocked(getSettlementSummary).mockResolvedValue([
      { hotel_id: 'hotel-1', service_type: 'transport', status: 'completed', requests: 1, settled_currency: 'UZS', settled_amount_minor: 25_000_000, payout_currency: 'USD', payout_minor: 200 },
    ]);

    render(<AdminDashboardPage />);

    const payouts = await screen.findByRole('table', { name: /по отелям/i });
    expect(within(payouts).getByText('Kamilovs Hotel')).toBeVisible();
    // The payout is the frozen rate card price, not a share of the sale: this
    // transfer sold for 25 000 000 сум and pays the hotel two dollars.
    expect(within(payouts).getByText('2,00 USD')).toBeVisible();
  });

  it('keeps a failed total from hiding the counters', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 9, newRequests: 3 });
    vi.mocked(getSettlementSummary).mockRejectedValue(new Error('network'));

    render(<AdminDashboardPage />);

    expect(await screen.findByText('Не удалось загрузить итоги.')).toBeVisible();
    expect(screen.getByText('9')).toBeVisible();
  });
});
