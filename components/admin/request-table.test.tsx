import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RequestFilterBar, RequestTable, maskContact } from './request-table';
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
  guestLocale: 'en',
  telegramStatus: 'failed',
  telegramAttempt: 2,
  telegramErrorCode: 'TELEGRAM_API_ERROR',
  offerId: 'tashkent-airport-sedan',
  offerTitle: 'Your airport ride, arranged',
  offerEstimate: 'от 30 USD · per vehicle · one way',
  settledAmountMinor: null,
  settledCurrency: null,
  completedAt: null,
  costMinor: null,
  hotelRateMinor: null,
  hotelRateCurrency: null,
};

const kamilovsHotel: Hotel = {
  id: 'hotel-1', name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', commissionBps: 1500, active: true, guestCatalogId: null, createdAt: '', updatedAt: '',
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

  it('keeps every in-flight retry pending independently', async () => {
    const user = userEvent.setup();
    const resolvers: Array<(result: RetryResult) => void> = [];
    const retryTelegram = vi.fn().mockImplementation(() => new Promise<RetryResult>((resolve) => { resolvers.push(resolve); }));
    renderRequestTable({
      rows: [adminRequestFixture, { ...adminRequestFixture, id: 'request-2', reference: 'MG-SECONDSE' }],
      retryTelegram,
    });

    const [first, second] = screen.getAllByRole('button', { name: 'Повторить Telegram' });
    await user.click(first);
    await user.click(second);
    expect(screen.getAllByRole('button', { name: 'Отправка…' })).toHaveLength(2);

    resolvers[0]({ status: 'sent' });
    await screen.findByText('Отправлено');
    expect(screen.getAllByRole('button', { name: 'Отправка…' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Повторить Telegram' })).not.toBeInTheDocument();

    resolvers[1]({ status: 'sent' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отправка…' })).not.toBeInTheDocument());
  });

  it('reports the retried delivery in the details instead of the stale error', async () => {
    const user = userEvent.setup();
    renderRequestTable({ rows: [adminRequestFixture], retryTelegram: vi.fn().mockResolvedValue({ status: 'sent' }) });

    await user.click(screen.getByRole('button', { name: 'Повторить Telegram' }));
    await screen.findByText('Отправлено');
    await user.click(screen.getByRole('button', { name: 'Подробнее MG-ABCDEFGH' }));

    const details = screen.getByRole('region', { name: 'Детали заявки MG-ABCDEFGH' });
    expect(within(details).getByText('Отправлено после повтора')).toBeInTheDocument();
    expect(within(details).queryByText(/TELEGRAM_API_ERROR/)).not.toBeInTheDocument();
  });
});

describe('maskContact', () => {
  it('never reveals the whole contact', () => {
    expect(maskContact('+998901234567')).toBe('+998…4567');
    expect(maskContact('user@mail.co')).toBe('user…l.co');
    expect(maskContact('@sardor1')).toBe('@…');
    expect(maskContact('@ivanov')).toBe('@…');
    expect(maskContact('12345')).toBe('1…');
    expect(maskContact('')).toBe('…');
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

describe('catalogue offer in the request table', () => {
  it('shows the chosen offer and its reference price without calling it revenue', async () => {
    const user = userEvent.setup();
    renderRequestTable({ rows: [adminRequestFixture] });

    expect(screen.getByText('Your airport ride, arranged')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Подробнее MG-ABCDEFGH' }));
    const details = screen.getByRole('region', { name: 'Детали заявки MG-ABCDEFGH' });

    expect(within(details).getByText('Ориентировочная цена')).toBeInTheDocument();
    expect(within(details).getByText('от 30 USD · per vehicle · one way')).toBeInTheDocument();
    expect(within(details).getByText(/Не подтверждённая сумма/)).toBeInTheDocument();
    expect(screen.queryByText(/Заработан/i)).not.toBeInTheDocument();
  });

  it('shows nothing extra for a request without an offer', () => {
    renderRequestTable({ rows: [{ ...adminRequestFixture, offerId: null, offerTitle: null, offerEstimate: null }] });

    expect(screen.queryByText('Your airport ride, arranged')).not.toBeInTheDocument();
  });
});

// The formatter groups with U+00A0; testing-library normalises it to a plain space.

function settledRow(overrides: Partial<AdminRequestRow> = {}): AdminRequestRow {
  return {
    ...adminRequestFixture,
    status: 'completed',
    settledAmountMinor: 2_500_000,
    settledCurrency: 'UZS',
    completedAt: '2026-09-07T09:00:00.000Z',
    hotelRateMinor: 200,
    hotelRateCurrency: 'USD',
    ...overrides,
  };
}

describe('RequestTable settlement', () => {
  it('shows the status of every request', () => {
    render(<RequestTable rows={[adminRequestFixture]} retryTelegram={vi.fn()} settleRequest={vi.fn()} />);
    expect(screen.getByText('Новая')).toBeVisible();
  });

  it('shows what a settled request came to, without opening it', () => {
    render(<RequestTable rows={[settledRow()]} retryTelegram={vi.fn()} settleRequest={vi.fn()} />);
    expect(screen.getByText('Выполнена')).toBeVisible();
    expect(screen.getByText('2 500 000 UZS')).toBeVisible();
  });

  it('says nothing about revenue on a request that has not completed', () => {
    render(<RequestTable rows={[adminRequestFixture]} retryTelegram={vi.fn()} settleRequest={vi.fn()} />);
    expect(screen.queryByText(/UZS/)).toBeNull();
  });

  it('confirms a new request in one tap, recording no money', async () => {
    const settle = vi.fn().mockResolvedValue({
      status: 'confirmed', settledAmountMinor: null, settledCurrency: null,
      settledCommissionBps: null, hotelPayoutMinor: null,
    });
    render(<RequestTable rows={[adminRequestFixture]} retryTelegram={vi.fn()} settleRequest={settle} />);

    await userEvent.click(screen.getByRole('button', { name: /Подтвердить MG-ABCDEFGH/ }));

    expect(settle).toHaveBeenCalledWith({ requestId: 'request-1', status: 'confirmed' });
    await waitFor(() => expect(screen.getByText('Подтверждена')).toBeVisible());
  });

  it('offers the one-tap confirmation only while the request is new', () => {
    render(<RequestTable rows={[settledRow()]} retryTelegram={vi.fn()} settleRequest={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Подтвердить/ })).toBeNull();
  });

  it('asks for an amount only once the outcome is Выполнена', async () => {
    render(<RequestTable rows={[adminRequestFixture]} retryTelegram={vi.fn()} settleRequest={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Подробнее MG-ABCDEFGH/ }));

    expect(screen.queryByLabelText('Сумма')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Выполнена' }));
    expect(screen.getByLabelText('Сумма')).toBeVisible();
    expect(screen.getByLabelText('Валюта')).toBeVisible();
  });

  it('says plainly that the amount is our turnover and not the hotel base', async () => {
    render(<RequestTable rows={[adminRequestFixture]} retryTelegram={vi.fn()} settleRequest={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Подробнее MG-ABCDEFGH/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'Выполнена' }));
    await userEvent.type(screen.getByLabelText('Сумма'), '2500000');

    // The old preview showed a percentage of what was typed. There is no such
    // percentage any more, and a figure that moved with the amount would be a
    // lie about how the hotel is paid.
    expect(screen.getByText(/Сумма — наша выручка/)).toBeVisible();
    expect(screen.queryByText(/375 000 UZS/)).toBeNull();
  });

  it('saves a completed settlement and shows it on the row without a reload', async () => {
    const settle = vi.fn().mockResolvedValue({
      status: 'completed', settledAmountMinor: 2_500_000, settledCurrency: 'UZS',
      completedAt: '2026-09-07T09:00:00.000Z', costMinor: null,
      hotelRateMinor: 200, hotelRateCurrency: 'USD',
    });
    render(<RequestTable rows={[adminRequestFixture]} retryTelegram={vi.fn()} settleRequest={settle} />);
    await userEvent.click(screen.getByRole('button', { name: /Подробнее MG-ABCDEFGH/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'Выполнена' }));
    await userEvent.type(screen.getByLabelText('Сумма'), '2500000');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить итог' }));

    expect(settle).toHaveBeenCalledWith({
      // The cost field was left alone, so it goes as an empty string and the
      // routine keeps whatever it had rather than clearing it.
      requestId: 'request-1', status: 'completed', amount: '2500000', currency: 'UZS', cost: '',
    });
    // The panel stays open, so its radio label carries the same word: assert on
    // the row badge, which is what someone scanning the list actually reads.
    await waitFor(() => expect(screen.getByText('Выполнена', { selector: '.admin-badge' })).toBeVisible());
    // Once on the row and once in the open details; the row is the one that
    // makes a week of settled work legible without opening anything.
    expect(screen.getByText('2 500 000 UZS', { selector: 'td[data-label="Статус"] small' })).toBeVisible();
    expect(screen.getByText('Итог сохранён')).toBeVisible();
  });

  it('prefills the stored amount so a wrong figure is corrected, not retyped', async () => {
    render(<RequestTable rows={[settledRow()]} retryTelegram={vi.fn()} settleRequest={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Подробнее MG-ABCDEFGH/ }));
    expect(screen.getByLabelText('Сумма')).toHaveValue('2500000');
  });

  it('reports a rejected amount under the field, without calling the server', async () => {
    const settle = vi.fn();
    render(<RequestTable rows={[adminRequestFixture]} retryTelegram={vi.fn()} settleRequest={settle} />);
    await userEvent.click(screen.getByRole('button', { name: /Подробнее MG-ABCDEFGH/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'Выполнена' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить итог' }));

    expect(settle).not.toHaveBeenCalled();
    expect(await screen.findByText('Введите сумму')).toBeVisible();
  });

  it('reports a refusal from the database in the panel', async () => {
    const settle = vi.fn().mockRejectedValue({ code: '42501', message: 'refused' });
    render(<RequestTable rows={[adminRequestFixture]} retryTelegram={vi.fn()} settleRequest={settle} />);
    await userEvent.click(screen.getByRole('button', { name: /Подтвердить MG-ABCDEFGH/ }));

    // Fired from the row, where no panel is open to hold the answer.
    expect(await screen.findByRole('alert')).toHaveTextContent('MG-ABCDEFGH: Нет прав на изменение итога. Войдите заново.');
    expect(screen.getByText('Новая')).toBeVisible();
  });

  it('shows the frozen rate, and says the monthly step is added later', async () => {
    render(<RequestTable rows={[settledRow()]} retryTelegram={vi.fn()} settleRequest={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Подробнее MG-ABCDEFGH/ }));

    // The sale was 2 500 000 сум; the rate is two dollars and owes it nothing.
    expect(screen.getByText('2,00 USD')).toBeVisible();
    expect(screen.getByText(/Надбавка за объём начисляется по итогам месяца\./)).toBeVisible();
  });

  it('keeps the guest estimate marked as not revenue beside the settled amount', async () => {
    render(<RequestTable rows={[settledRow()]} retryTelegram={vi.fn()} settleRequest={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Подробнее MG-ABCDEFGH/ }));

    // The starting price the guest saw and the money actually taken are read
    // together, and only one of them carries the disclaimer.
    expect(screen.getByText(/Не подтверждённая сумма и не выручка\./)).toBeVisible();
    expect(screen.getByText('Итог')).toBeVisible();
    expect(screen.getByText('Ориентировочная цена')).toBeVisible();
  });

  it('offers every status in the filter bar', () => {
    render(
      <RequestFilterBar filters={{}} hotels={[kamilovsHotel]} rooms={[room205]} onChange={vi.fn()} />,
    );
    const status = screen.getByLabelText('Статус');
    for (const label of ['Новая', 'Подтверждена', 'Выполнена', 'Отменена']) {
      expect(within(status).getByRole('option', { name: label })).toBeInTheDocument();
    }
  });
});
