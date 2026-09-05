import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHotelPage from './page';
import { getHotel, updateHotel, type Hotel } from '@/lib/admin/hotels';
import { createRooms, listRooms, type Room } from '@/lib/admin/rooms';

const paramsState = vi.hoisted(() => ({ current: { id: 'hotel-1' } as { id?: string } }));

vi.mock('next/navigation', () => ({
  useParams: () => paramsState.current,
}));

vi.mock('@/lib/admin/hotels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/hotels')>()),
  getHotel: vi.fn(),
  updateHotel: vi.fn(),
}));

vi.mock('@/lib/admin/rooms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/rooms')>()),
  listRooms: vi.fn(),
  createRooms: vi.fn(),
  setRoomActive: vi.fn(),
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

const room205: Room = {
  id: 'room-205',
  hotelId: 'hotel-1',
  label: '205',
  publicToken: '9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a',
  active: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

describe('AdminHotelPage', () => {
  beforeEach(() => {
    paramsState.current = { id: 'hotel-1' };
    vi.mocked(getHotel).mockReset();
    vi.mocked(updateHotel).mockReset();
    vi.mocked(listRooms).mockReset().mockResolvedValue([]);
    vi.mocked(createRooms).mockReset();
  });

  it('loads the rooms of the hotel into the editor and refreshes them after adding', async () => {
    const user = userEvent.setup();
    vi.mocked(getHotel).mockResolvedValue(kamilovsHotel);
    vi.mocked(listRooms).mockResolvedValueOnce([]).mockResolvedValueOnce([room205]);
    vi.mocked(createRooms).mockResolvedValue([room205]);
    render(<AdminHotelPage />);

    expect(await screen.findByRole('heading', { level: 2, name: 'Комнаты' })).toBeInTheDocument();
    expect(await screen.findByText('Комнат пока нет')).toBeInTheDocument();
    expect(listRooms).toHaveBeenCalledWith('hotel-1');

    await user.type(screen.getByLabelText('Список комнат'), '205');
    await user.click(screen.getByRole('button', { name: 'Добавить комнаты' }));

    expect(createRooms).toHaveBeenCalledWith('hotel-1', ['205']);
    expect(await screen.findByRole('checkbox', { name: 'Выбрать комнату 205' })).toBeInTheDocument();
    expect(listRooms).toHaveBeenCalledTimes(2);
  });

  it('never shows the previous hotel rooms while a different hotel loads', async () => {
    vi.mocked(getHotel).mockResolvedValue(kamilovsHotel);
    vi.mocked(listRooms).mockResolvedValueOnce([room205]).mockReturnValueOnce(new Promise(() => undefined));
    const view = render(<AdminHotelPage />);
    expect(await screen.findByRole('checkbox', { name: 'Выбрать комнату 205' })).toBeInTheDocument();

    paramsState.current = { id: 'hotel-2' };
    vi.mocked(getHotel).mockResolvedValue({ ...kamilovsHotel, id: 'hotel-2', name: 'Silk Road Inn', slug: 'silk-road' });
    view.rerender(<AdminHotelPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Silk Road Inn' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Выбрать комнату 205' })).not.toBeInTheDocument();
    expect(screen.getByText('Загрузка комнат…')).toBeInTheDocument();
    expect(listRooms).toHaveBeenLastCalledWith('hotel-2');
  });

  it('reports a rooms loading failure without hiding the hotel form', async () => {
    const user = userEvent.setup();
    vi.mocked(getHotel).mockResolvedValue(kamilovsHotel);
    vi.mocked(listRooms).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([room205]);
    render(<AdminHotelPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить комнаты.');
    expect(screen.getByLabelText('Название')).toHaveValue('Kamilovs Hotel');

    await user.click(screen.getByRole('button', { name: 'Повторить загрузку комнат' }));

    expect(await screen.findByRole('checkbox', { name: 'Выбрать комнату 205' })).toBeInTheDocument();
  });

  it('treats a missing route id as a missing hotel without querying', async () => {
    paramsState.current = {};
    render(<AdminHotelPage />);

    expect(await screen.findByText('Отель не найден')).toBeInTheDocument();
    expect(getHotel).not.toHaveBeenCalled();
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
