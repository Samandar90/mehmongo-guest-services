import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHotelsPage from './page';
import { createHotel, listHotels, type Hotel } from '@/lib/admin/hotels';

vi.mock('@/lib/admin/hotels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/hotels')>()),
  listHotels: vi.fn(),
  createHotel: vi.fn(),
  updateHotel: vi.fn(),
  setHotelActive: vi.fn(),
}));

const kamilovsHotel: Hotel = {
  id: 'hotel-1',
  name: 'Kamilovs Hotel',
  slug: 'kamilovs',
  address: 'Samarkand',
  commissionBps: 1500,
  active: true,
  guestCatalogId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

describe('AdminHotelsPage', () => {
  beforeEach(() => {
    vi.mocked(listHotels).mockReset();
    vi.mocked(createHotel).mockReset();
  });

  it('loads hotels and reloads the list after creating one', async () => {
    const user = userEvent.setup();
    vi.mocked(listHotels).mockResolvedValueOnce([]).mockResolvedValueOnce([kamilovsHotel]);
    vi.mocked(createHotel).mockResolvedValue(kamilovsHotel);
    render(<AdminHotelsPage />);

    expect(await screen.findByText('Отелей пока нет')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Название'), 'Kamilovs Hotel');
    await user.type(screen.getByLabelText('Slug'), 'kamilovs');
    await user.type(screen.getByLabelText('Процент отеля'), '15');
    await user.click(screen.getByRole('button', { name: 'Создать отель' }));

    expect(await screen.findByRole('link', { name: 'Открыть Kamilovs Hotel' })).toBeInTheDocument();
    expect(listHotels).toHaveBeenCalledTimes(2);
  });

  it('shows a loading state and then a retryable error when loading fails', async () => {
    const user = userEvent.setup();
    vi.mocked(listHotels).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([kamilovsHotel]);
    render(<AdminHotelsPage />);

    expect(screen.getByText('Загрузка отелей…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить отели.');

    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('Kamilovs Hotel')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
