import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboardPage from './page';
import { getDashboardMetrics } from '@/lib/admin/requests';
import { listHotels } from '@/lib/admin/hotels';
import { getSettlementSummary } from '@/lib/admin/summary';
import { getOwnerAttention, getRequestTimeline } from '@/lib/admin/insights';
import { periodPresets, previousPeriod } from '@/lib/admin/period';
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

// The chart and the attention panel load beside the totals, for the same reason.
vi.mock('@/lib/admin/insights', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/insights')>()),
  getOwnerAttention: vi.fn(),
  getRequestTimeline: vi.fn(),
}));

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    vi.mocked(getOwnerAttention).mockReset().mockResolvedValue({ overdueOpen: 0, dueToday: 0, telegramFailed: 0, missingCost: 0 });
    vi.mocked(getRequestTimeline).mockReset().mockResolvedValue([]);
    vi.mocked(getDashboardMetrics).mockReset();
    vi.mocked(listHotels).mockReset().mockResolvedValue([]);
    vi.mocked(getSettlementSummary).mockReset().mockResolvedValue([]);
    vi.mocked(getProfitSummary).mockReset().mockResolvedValue([]);
  });

  it('loads and renders the metrics', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 24, openRequests: 7 });
    render(<AdminDashboardPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Обзор' })).toBeInTheDocument();
    expect(await screen.findByText('24')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows a retryable error when metrics fail to load', async () => {
    const user = userEvent.setup();
    vi.mocked(getDashboardMetrics)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ activeHotels: 2, activeRooms: 40, openRequests: 0 });
    render(<AdminDashboardPage />);

    // Named by its text: the totals below load separately and can raise their own.
    expect(await screen.findByText('Не удалось загрузить показатели.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Заявки в работе' })).not.toHaveAttribute('aria-busy');
    // Scoped to the three counters, which are links now: the totals section
    // below has its own em dashes for a hotel that earned nothing.
    const counters = ['Активные отели', 'Активные комнаты', 'Заявки в работе']
      .map((name) => screen.getByRole('link', { name }));
    expect(counters.filter((card) => within(card).queryByText('—'))).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('40')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Заявки в работе' })).not.toHaveAttribute('aria-busy');
  });

  it('announces loading through a persistent live region', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 24, openRequests: 7 });
    render(<AdminDashboardPage />);

    const live = screen.getByText('Загрузка показателей…');
    expect(live).toHaveAttribute('aria-live', 'polite');
    await screen.findByText('24');
    expect(live).toBeEmptyDOMElement();
  });

  it('shows the settlement totals alongside the counters', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 9, openRequests: 3 });
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

  // The owner's bug report: a request received on the 9th and completed on the
  // 24th showed up in a period starting the 12th.
  it('reads the period by the date of the request unless told otherwise', async () => {
    const user = userEvent.setup();
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 9, openRequests: 3 });
    render(<AdminDashboardPage />);

    await screen.findByRole('heading', { name: 'Заявки по дням' });
    expect(vi.mocked(getSettlementSummary).mock.calls[0][0]).toMatchObject({ basis: 'created' });
    expect(vi.mocked(getProfitSummary).mock.calls[0][0]).toMatchObject({ basis: 'created' });
    expect(vi.mocked(getRequestTimeline).mock.calls[0][0]).toMatchObject({ basis: 'created' });

    vi.mocked(getSettlementSummary).mockClear();
    await user.click(screen.getByRole('button', { name: 'По дате выполнения' }));

    await waitFor(() => expect(getSettlementSummary).toHaveBeenCalled());
    expect(vi.mocked(getSettlementSummary).mock.calls[0][0]).toMatchObject({ basis: 'settled' });
  });

  it('applies a typed date to every report', async () => {
    const user = userEvent.setup();
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 9, openRequests: 3 });
    render(<AdminDashboardPage />);
    await screen.findByRole('heading', { name: 'Заявки по дням' });

    vi.mocked(getSettlementSummary).mockClear();
    vi.mocked(getRequestTimeline).mockClear();
    fireEvent.change(screen.getByLabelText('С даты'), { target: { value: '2026-10-12' } });
    fireEvent.change(screen.getByLabelText('По дату'), { target: { value: '2026-10-31' } });

    // Not the last call: the period before is asked for right after it.
    await waitFor(() => expect(getSettlementSummary).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: '2026-10-12', dateTo: '2026-10-31' })));
    await waitFor(() => expect(vi.mocked(getRequestTimeline).mock.calls.at(-1)?.[0])
      .toMatchObject({ dateFrom: '2026-10-12', dateTo: '2026-10-31' }));
    await user.click(screen.getByRole('button', { name: 'Весь период' }));
    await waitFor(() => expect(vi.mocked(getSettlementSummary).mock.calls.at(-1)?.[0]).toMatchObject({ dateFrom: undefined }));
  });

  it('refuses a reversed period instead of reporting a quiet one', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 9, openRequests: 3 });
    render(<AdminDashboardPage />);
    await screen.findByRole('heading', { name: 'Заявки по дням' });

    vi.mocked(getSettlementSummary).mockClear();
    fireEvent.change(screen.getByLabelText('С даты'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('По дату'), { target: { value: '2026-10-01' } });

    expect(await screen.findByText(/Дата начала позже/)).toBeVisible();
    expect(getSettlementSummary).not.toHaveBeenCalledWith(expect.objectContaining({ dateFrom: '2026-10-20', dateTo: '2026-10-01' }));
  });

  it('compares with the period before, and says which', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 9, openRequests: 3 });
    vi.mocked(getSettlementSummary).mockImplementation(async (period) => [
      {
        hotel_id: 'hotel-1', service_type: 'transport', status: 'completed',
        // The period that starts earlier is the one before.
        requests: period.dateFrom && period.dateFrom < previousPeriod(periodPresets()[2].value)!.dateTo ? 4 : 5,
        settled_currency: 'UZS', settled_amount_minor: 1000, payout_currency: 'USD', payout_minor: 200,
      },
    ]);

    render(<AdminDashboardPage />);

    expect(await screen.findByText(/Сравнение с/)).toBeVisible();
    expect((await screen.findAllByText('▲ 25% · было 4')).length).toBeGreaterThan(0);
  });

  it('says plainly when the attention check failed', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 9, openRequests: 3 });
    vi.mocked(getOwnerAttention).mockRejectedValue(new Error('network'));

    render(<AdminDashboardPage />);

    expect(await screen.findByText(/Не удалось проверить/)).toBeVisible();
  });

  it('keeps a failed total from hiding the counters', async () => {
    vi.mocked(getDashboardMetrics).mockResolvedValue({ activeHotels: 1, activeRooms: 9, openRequests: 3 });
    vi.mocked(getSettlementSummary).mockRejectedValue(new Error('network'));

    render(<AdminDashboardPage />);

    expect(await screen.findByText('Не удалось загрузить итоги.')).toBeVisible();
    expect(screen.getByText('9')).toBeVisible();
  });
});
