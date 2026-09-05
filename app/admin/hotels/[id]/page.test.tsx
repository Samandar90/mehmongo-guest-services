import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHotelPage from './page';
import { getHotel, updateHotel, type Hotel } from '@/lib/admin/hotels';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'hotel-1' }),
}));

vi.mock('@/lib/admin/hotels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/hotels')>()),
  getHotel: vi.fn(),
  updateHotel: vi.fn(),
}));

const kamilovsHotel: Hotel = {
  id: 'hotel-1',
  name: 'Kamilovs Hotel',
  slug: 'kamilovs',
  address: 'Samarkand',
  commissionBps: 1250,
  active: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

describe('AdminHotelPage', () => {
  beforeEach(() => {
    vi.mocked(getHotel).mockReset();
    vi.mocked(updateHotel).mockReset();
  });

  it('loads the hotel into an edit form and reserves the rooms section', async () => {
    const user = userEvent.setup();
    vi.mocked(getHotel).mockResolvedValue(kamilovsHotel);
    vi.mocked(updateHotel).mockResolvedValue({ ...kamilovsHotel, name: 'Kamilovs Boutique' });
    render(<AdminHotelPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Kamilovs Hotel' })).toBeInTheDocument();
    expect(getHotel).toHaveBeenCalledWith('hotel-1');
    expect(screen.getByLabelText('Процент отеля')).toHaveValue('12.5');
    expect(screen.getByRole('heading', { level: 2, name: 'Комнаты' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'К списку отелей' })).toHaveAttribute('href', '/admin/hotels');

    await user.clear(screen.getByLabelText('Название'));
    await user.type(screen.getByLabelText('Название'), 'Kamilovs Boutique');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(updateHotel).toHaveBeenCalledWith('hotel-1', expect.objectContaining({ name: 'Kamilovs Boutique' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Kamilovs Boutique' })).toBeInTheDocument();
  });

  it('reports a missing hotel', async () => {
    vi.mocked(getHotel).mockResolvedValue(null);
    render(<AdminHotelPage />);

    expect(await screen.findByText('Отель не найден')).toBeInTheDocument();
    expect(screen.queryByLabelText('Название')).not.toBeInTheDocument();
  });

  it('shows a retryable error when loading fails', async () => {
    const user = userEvent.setup();
    vi.mocked(getHotel).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(kamilovsHotel);
    render(<AdminHotelPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить отель.');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Kamilovs Hotel' })).toBeInTheDocument();
  });
});
