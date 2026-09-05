import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminRequestsPage from './page';
import { listRequests, type AdminRequestRow } from '@/lib/admin/requests';
import { listHotels, type Hotel } from '@/lib/admin/hotels';
import { listRooms, type Room } from '@/lib/admin/rooms';

vi.mock('@/lib/admin/requests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/requests')>()),
  listRequests: vi.fn(),
  retryTelegram: vi.fn(),
}));

vi.mock('@/lib/admin/hotels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/hotels')>()),
  listHotels: vi.fn(),
}));

vi.mock('@/lib/admin/rooms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/rooms')>()),
  listRooms: vi.fn(),
}));

const requestRow: AdminRequestRow = {
  id: 'request-1',
  reference: 'MG-ABCDEFGH',
  createdAt: '2026-08-19T09:15:00.000Z',
  hotelId: 'hotel-1',
  hotelName: 'Kamilovs Hotel',
  roomId: 'room-205',
  roomLabel: '205',
  serviceType: 'tours',
  status: 'new',
  choice: 'Registan',
  pickup: '',
  destination: '',
  requestedDate: '2026-08-20',
  requestedTime: null,
  partySize: 2,
  guestName: 'Alex',
  contact: '+998901234567',
  note: '',
  telegramStatus: 'sent',
  telegramAttempt: 1,
  telegramErrorCode: null,
};

const kamilovsHotel: Hotel = {
  id: 'hotel-1', name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', commissionBps: 1500, active: true, createdAt: '', updatedAt: '',
};
const room205: Room = {
  id: 'room-205', hotelId: 'hotel-1', label: '205', publicToken: '9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a', active: true, createdAt: '', updatedAt: '',
};

describe('AdminRequestsPage', () => {
  beforeEach(() => {
    vi.mocked(listRequests).mockReset();
    vi.mocked(listHotels).mockReset().mockResolvedValue([kamilovsHotel]);
    vi.mocked(listRooms).mockReset().mockResolvedValue([room205]);
  });

  it('loads requests and reloads them when a filter changes', async () => {
    const user = userEvent.setup();
    vi.mocked(listRequests).mockResolvedValue({ items: [requestRow], hasMore: false });
    render(<AdminRequestsPage />);

    expect(await screen.findByText('MG-ABCDEFGH')).toBeInTheDocument();
    expect(listRequests).toHaveBeenCalledWith({});
    expect(await screen.findByRole('option', { name: 'Kamilovs Hotel' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Отель'), 'hotel-1');

    await waitFor(() => expect(listRequests).toHaveBeenLastCalledWith({ hotelId: 'hotel-1' }));
    expect(await screen.findByRole('option', { name: '205' })).toBeInTheDocument();
    expect(listRooms).toHaveBeenCalledWith('hotel-1');
  });

  it('never offers the previous hotel rooms after the hotel filter changes', async () => {
    const user = userEvent.setup();
    const silkRoad: Hotel = { ...kamilovsHotel, id: 'hotel-2', name: 'Silk Road Inn', slug: 'silk-road' };
    vi.mocked(listHotels).mockResolvedValue([kamilovsHotel, silkRoad]);
    vi.mocked(listRooms)
      .mockResolvedValueOnce([room205])
      .mockReturnValueOnce(new Promise(() => undefined));
    vi.mocked(listRequests).mockResolvedValue({ items: [], hasMore: false });
    render(<AdminRequestsPage />);

    await screen.findByRole('option', { name: 'Silk Road Inn' });
    await user.selectOptions(screen.getByLabelText('Отель'), 'hotel-1');
    expect(await screen.findByRole('option', { name: '205' })).toBeInTheDocument();
    expect(screen.getByLabelText('Комната')).toBeEnabled();

    await user.selectOptions(screen.getByLabelText('Отель'), 'hotel-2');

    expect(screen.queryByRole('option', { name: '205' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Комната')).toBeDisabled();
  });

  it('tells the admin when the page is capped at 100 rows', async () => {
    vi.mocked(listRequests).mockResolvedValue({ items: [requestRow], hasMore: true });
    render(<AdminRequestsPage />);

    expect(await screen.findByText('Показаны первые 100 заявок. Сузьте фильтры, чтобы увидеть остальные.')).toBeInTheDocument();
  });

  it('shows a retryable error when loading fails', async () => {
    const user = userEvent.setup();
    vi.mocked(listRequests)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ items: [requestRow], hasMore: false });
    render(<AdminRequestsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить заявки.');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('MG-ABCDEFGH')).toBeInTheDocument();
  });
});
