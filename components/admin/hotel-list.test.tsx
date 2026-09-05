import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HotelList } from './hotel-list';
import type { Hotel } from '@/lib/admin/hotels';

const kamilovsFixture: Hotel = {
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

function renderHotelList({
  hotels,
  setHotelActive = vi.fn().mockResolvedValue(undefined),
  reload = vi.fn(),
}: {
  hotels: Hotel[];
  setHotelActive?: (id: string, active: boolean) => Promise<unknown>;
  reload?: () => void;
}) {
  render(<HotelList hotels={hotels} setHotelActive={setHotelActive} reload={reload} />);
}

describe('HotelList', () => {
  it('renders hotel name, commission, status and room link', () => {
    renderHotelList({ hotels: [kamilovsFixture] });

    expect(screen.getByText('Kamilovs Hotel')).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.getByText('Активен')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть Kamilovs Hotel' })).toHaveAttribute('href', '/admin/hotels/hotel-1');
  });

  it('labels every cell so the mobile card layout can show headings', () => {
    renderHotelList({ hotels: [kamilovsFixture] });

    const labels = screen.getAllByRole('cell').map((cell) => cell.getAttribute('data-label'));
    expect(labels).toEqual(['Отель', 'Slug', 'Процент', 'Статус', 'Действия']);
  });

  it('confirms a successful status change in a live region', async () => {
    const user = userEvent.setup();
    renderHotelList({ hotels: [kamilovsFixture], setHotelActive: vi.fn().mockResolvedValue(undefined) });

    await user.click(screen.getByRole('button', { name: 'Отключить Kamilovs Hotel' }));
    await user.click(screen.getByRole('button', { name: 'Подтвердить отключение' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Отель Kamilovs Hotel отключён');
  });

  it('does not report a status error when only the reload fails', async () => {
    const user = userEvent.setup();
    const setActive = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockRejectedValue(new Error('network'));
    renderHotelList({ hotels: [{ ...kamilovsFixture, active: false }], setHotelActive: setActive, reload });

    await user.click(screen.getByRole('button', { name: 'Включить Kamilovs Hotel' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Отель Kamilovs Hotel включён');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no hotels', () => {
    renderHotelList({ hotels: [] });

    expect(screen.getByText('Отелей пока нет')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('requires confirmation before disabling a hotel', async () => {
    const user = userEvent.setup();
    const setActive = vi.fn().mockResolvedValue(undefined);
    renderHotelList({ hotels: [kamilovsFixture], setHotelActive: setActive });

    await user.click(screen.getByRole('button', { name: 'Отключить Kamilovs Hotel' }));
    expect(setActive).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Подтвердить отключение' }));
    expect(setActive).toHaveBeenCalledWith('hotel-1', false);
  });

  it('cancels a pending disable confirmation', async () => {
    const user = userEvent.setup();
    const setActive = vi.fn();
    renderHotelList({ hotels: [kamilovsFixture], setHotelActive: setActive });

    await user.click(screen.getByRole('button', { name: 'Отключить Kamilovs Hotel' }));
    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('button', { name: 'Подтвердить отключение' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отключить Kamilovs Hotel' })).toBeInTheDocument();
    expect(setActive).not.toHaveBeenCalled();
  });

  it('refreshes the list after activation changes', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    renderHotelList({ hotels: [kamilovsFixture], setHotelActive: vi.fn().mockResolvedValue(undefined), reload });

    await user.click(screen.getByRole('button', { name: 'Отключить Kamilovs Hotel' }));
    await user.click(screen.getByRole('button', { name: 'Подтвердить отключение' }));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('re-enables a disabled hotel without confirmation', async () => {
    const user = userEvent.setup();
    const setActive = vi.fn().mockResolvedValue(undefined);
    renderHotelList({ hotels: [{ ...kamilovsFixture, active: false }], setHotelActive: setActive });

    expect(screen.getByText('Отключён')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Включить Kamilovs Hotel' }));

    expect(setActive).toHaveBeenCalledWith('hotel-1', true);
  });

  it('shows a pending state while the status change is in flight', async () => {
    const user = userEvent.setup();
    let resolveChange: (() => void) | undefined;
    const setActive = vi.fn().mockReturnValue(new Promise<void>((resolve) => { resolveChange = resolve; }));
    renderHotelList({ hotels: [kamilovsFixture], setHotelActive: setActive });

    await user.click(screen.getByRole('button', { name: 'Отключить Kamilovs Hotel' }));
    await user.click(screen.getByRole('button', { name: 'Подтвердить отключение' }));

    expect(screen.getByRole('button', { name: 'Сохранение…' })).toBeDisabled();
    resolveChange?.();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сохранение…' })).not.toBeInTheDocument());
  });

  it('shows an actionable error when the status change fails', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    const setActive = vi.fn().mockRejectedValue(new Error('network'));
    renderHotelList({ hotels: [kamilovsFixture], setHotelActive: setActive, reload });

    await user.click(screen.getByRole('button', { name: 'Отключить Kamilovs Hotel' }));
    await user.click(screen.getByRole('button', { name: 'Подтвердить отключение' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось изменить статус отеля. Повторите попытку.');
    expect(screen.getByRole('button', { name: 'Отключить Kamilovs Hotel' })).toBeEnabled();
    expect(reload).not.toHaveBeenCalled();
  });
});
