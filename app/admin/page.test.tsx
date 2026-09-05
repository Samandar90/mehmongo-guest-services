import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboardPage from './page';
import { getDashboardMetrics } from '@/lib/admin/requests';

vi.mock('@/lib/admin/requests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/requests')>()),
  getDashboardMetrics: vi.fn(),
}));

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    vi.mocked(getDashboardMetrics).mockReset();
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

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить показатели.');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('40')).toBeInTheDocument();
  });
});
