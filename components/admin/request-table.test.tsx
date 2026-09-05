import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RequestFilterBar, RequestTable } from './request-table';
import type { AdminRequestRow, RequestFilters, RetryResult } from '@/lib/admin/requests';
import type { Hotel } from '@/lib/admin/hotels';
import type { Room } from '@/lib/admin/rooms';

const adminRequestFixture: AdminRequestRow = {
  id: 'request-1',
  reference: 'MG-ABCDEFGH',
  createdAt: '2026-08-19T09:15:00.000Z',
  hotelId: 'hotel-1',
  hotelName: 'Kamilovs Hotel',
  roomId: 'room-205',
  roomLabel: '205',
  serviceType: 'transport',
  status: 'new',
  choice: '',
  pickup: 'Kamilovs Hotel',
  destination: 'Airport',
  requestedDate: '2026-08-20',
  requestedTime: '14:30',
  partySize: 2,
  guestName: 'Alex',
  contact: '+998901234567',
  note: 'Two suitcases',
  telegramStatus: 'failed',
  telegramAttempt: 2,
  telegramErrorCode: 'TELEGRAM_API_ERROR',
};

const kamilovsHotel: Hotel = {
  id: 'hotel-1', name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', commissionBps: 1500, active: true, createdAt: '', updatedAt: '',
};
const room205: Room = {
  id: 'room-205', hotelId: 'hotel-1', label: '205', publicToken: '9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a', active: true, createdAt: '', updatedAt: '',
};

function renderRequestTable({
  rows,
  retryTelegram = vi.fn().mockResolvedValue({ status: 'sent' }),
}: {
  rows: AdminRequestRow[];
  retryTelegram?: (requestId: string) => Promise<RetryResult>;
}) {
  render(<RequestTable rows={rows} retryTelegram={retryTelegram} />);
}

describe('RequestTable', () => {
  it('renders request identity and delivery state', () => {
    renderRequestTable({ rows: [adminRequestFixture] });

    expect(screen.getByText('MG-ABCDEFGH')).toBeInTheDocument();
    expect(screen.getByText('Kamilovs Hotel')).toBeInTheDocument();
    expect(screen.getByText('205')).toBeInTheDocument();
    expect(screen.getByText('Транспорт')).toBeInTheDocument();
    expect(screen.getByText('Ошибка Telegram')).toBeInTheDocument();
  });

  it('shows retry only for failed delivery', () => {
    renderRequestTable({
      rows: [
        adminRequestFixture,
        { ...adminRequestFixture, id: 'request-2', reference: 'MG-SENTSENT', telegramStatus: 'sent' },
        { ...adminRequestFixture, id: 'request-3', reference: 'MG-PENDPEND', telegramStatus: 'pending' },
      ],
    });

    expect(screen.getAllByRole('button', { name: 'Повторить Telegram' })).toHaveLength(1);
    expect(screen.getByText('Отправлено')).toBeInTheDocument();
    expect(screen.getByText('В очереди')).toBeInTheDocument();
  });

  it('updates one row after successful retry', async () => {
    const user = userEvent.setup();
    const retryTelegram = vi.fn().mockResolvedValue({ status: 'sent' });
    renderRequestTable({
      rows: [adminRequestFixture, { ...adminRequestFixture, id: 'request-2', reference: 'MG-OTHEROTH' }],
      retryTelegram,
    });

    await user.click(screen.getAllByRole('button', { name: 'Повторить Telegram' })[0]);

    expect(await screen.findByText('Отправлено')).toBeInTheDocument();
    expect(retryTelegram).toHaveBeenCalledWith('request-1');
    expect(screen.getAllByRole('button', { name: 'Повторить Telegram' })).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('MG-ABCDEFGH: сообщение отправлено в Telegram');
  });

  it('shows a pending state while the retry is in flight', async () => {
    const user = userEvent.setup();
    let resolveRetry: ((result: RetryResult) => void) | undefined;
    const retryTelegram = vi.fn().mockReturnValue(new Promise<RetryResult>((resolve) => { resolveRetry = resolve; }));
    renderRequestTable({ rows: [adminRequestFixture], retryTelegram });

    await user.click(screen.getByRole('button', { name: 'Повторить Telegram' }));

    expect(screen.getByRole('button', { name: 'Отправка…' })).toBeDisabled();
    resolveRetry?.({ status: 'sent' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отправка…' })).not.toBeInTheDocument());
  });

  it('keeps a pending delivery pending and explains an already-running retry', async () => {
    const user = userEvent.setup();
    const retryTelegram = vi.fn().mockResolvedValue({ status: 'pending', reason: 'already_pending' });
    renderRequestTable({ rows: [adminRequestFixture], retryTelegram });

    await user.click(screen.getByRole('button', { name: 'Повторить Telegram' }));

    expect(await screen.findByText('В очереди')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('MG-ABCDEFGH: доставка уже выполняется, обновите список позже');
    expect(screen.queryByRole('button', { name: 'Повторить Telegram' })).not.toBeInTheDocument();
  });

  it('reports a retry that Telegram rejected again and keeps the retry available', async () => {
    const user = userEvent.setup();
    const retryTelegram = vi.fn().mockResolvedValue({ status: 'failed' });
    renderRequestTable({ rows: [adminRequestFixture], retryTelegram });

    await user.click(screen.getByRole('button', { name: 'Повторить Telegram' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('MG-ABCDEFGH: Telegram снова не принял сообщение');
    expect(screen.getByRole('button', { name: 'Повторить Telegram' })).toBeEnabled();
  });

  it('explains authorization failures and transport errors', async () => {
    const user = userEvent.setup();
    const retryTelegram = vi.fn()
      .mockRejectedValueOnce({ code: 'FORBIDDEN' })
      .mockRejectedValueOnce(new Error('network'));
    renderRequestTable({ rows: [adminRequestFixture], retryTelegram });

    await user.click(screen.getByRole('button', { name: 'Повторить Telegram' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет прав на повторную отправку. Войдите заново.');

    await user.click(screen.getByRole('button', { name: 'Повторить Telegram' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось выполнить повтор. Повторите попытку.');
  });

  it('masks the contact in the collapsed row and reveals it in the details', async () => {
    const user = userEvent.setup();
    renderRequestTable({ rows: [adminRequestFixture] });

    expect(screen.queryByText('+998901234567')).not.toBeInTheDocument();
    expect(screen.getByText('+998…4567')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Подробнее MG-ABCDEFGH' }));

    const details = screen.getByRole('region', { name: 'Детали заявки MG-ABCDEFGH' });
    expect(within(details).getByText('+998901234567')).toBeInTheDocument();
    expect(within(details).getByText('Two suitcases')).toBeInTheDocument();
    expect(within(details).getByText('Kamilovs Hotel → Airport')).toBeInTheDocument();
    expect(within(details).getByText('20.08.2026, 14:30')).toBeInTheDocument();
    expect(within(details).getByText('TELEGRAM_API_ERROR (попытка 2)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Скрыть MG-ABCDEFGH' }));
    expect(screen.queryByRole('region', { name: 'Детали заявки MG-ABCDEFGH' })).not.toBeInTheDocument();
  });

  it('shows an empty state', () => {
    renderRequestTable({ rows: [] });

    expect(screen.getByText('Заявок не найдено')).toBeInTheDocument();
  });
});

describe('RequestFilterBar', () => {
  function renderFilterBar(filters: RequestFilters = {}, onChange = vi.fn()) {
    render(<RequestFilterBar filters={filters} hotels={[kamilovsHotel]} rooms={[room205]} onChange={onChange} />);
    return onChange;
  }

  it('changes the hotel and drops the room filter of the previous hotel', async () => {
    const user = userEvent.setup();
    const onChange = renderFilterBar({ hotelId: 'hotel-1', roomId: 'room-205' });

    await user.selectOptions(screen.getByLabelText('Отель'), '');

    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('applies room, category, status and period filters', async () => {
    const user = userEvent.setup();
    const onChange = renderFilterBar({ hotelId: 'hotel-1' });

    await user.selectOptions(screen.getByLabelText('Комната'), 'room-205');
    expect(onChange).toHaveBeenLastCalledWith({ hotelId: 'hotel-1', roomId: 'room-205' });

    await user.selectOptions(screen.getByLabelText('Категория'), 'transport');
    expect(onChange).toHaveBeenLastCalledWith({ hotelId: 'hotel-1', serviceType: 'transport' });

    await user.selectOptions(screen.getByLabelText('Статус'), 'new');
    expect(onChange).toHaveBeenLastCalledWith({ hotelId: 'hotel-1', status: 'new' });

    await user.type(screen.getByLabelText('С даты'), '2026-08-01');
    expect(onChange).toHaveBeenLastCalledWith({ hotelId: 'hotel-1', dateFrom: '2026-08-01' });

    await user.type(screen.getByLabelText('По дату'), '2026-08-31');
    expect(onChange).toHaveBeenLastCalledWith({ hotelId: 'hotel-1', dateTo: '2026-08-31' });
  });

  it('disables the room filter until a hotel is chosen and resets everything', async () => {
    const user = userEvent.setup();
    const onChange = renderFilterBar({ serviceType: 'tours', dateFrom: '2026-08-01' });

    expect(screen.getByLabelText('Комната')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));

    expect(onChange).toHaveBeenLastCalledWith({});
  });
});
