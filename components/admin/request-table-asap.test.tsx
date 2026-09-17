import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RequestTable } from './request-table';
import type { AdminRequestRow } from '@/lib/admin/requests';

const asapRow: AdminRequestRow = {
  id: 'request-asap',
  reference: 'MG-ASAPAAAA',
  createdAt: '2026-09-10T09:15:00.000Z',
  hotelId: 'hotel-1',
  hotelName: 'Kamilovs Hotel',
  roomId: 'room-205',
  roomLabel: '205',
  serviceType: 'transport',
  status: 'new',
  choice: '',
  pickup: 'Kamilovs Hotel, Xromiy 7',
  destination: 'Airport',
  requestedDate: '2026-09-10',
  requestedTime: null,
  partySize: 2,
  guestName: 'Alex',
  contact: '+998901234567',
  note: '',
  guestLocale: 'ru',
  asap: true,
  telegramStatus: 'sent',
  telegramAttempt: 1,
  telegramErrorCode: null,
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

describe('RequestTable, as soon as possible', () => {
  it('says the guest wants the nearest time instead of showing no time', async () => {
    const user = userEvent.setup();
    render(<RequestTable rows={[asapRow]} retryTelegram={vi.fn().mockResolvedValue({ status: 'sent' })} />);

    await user.click(screen.getByRole('button', { name: 'Подробнее MG-ASAPAAAA' }));

    const details = screen.getByRole('region', { name: 'Детали заявки MG-ASAPAAAA' });
    expect(within(details).getByText('10.09.2026, ⚡ как можно скорее')).toBeInTheDocument();
    expect(within(details).getByText('русский')).toBeInTheDocument();
  });
});

describe('RequestTable, Telegram refusals', () => {
  it('says what to do when the bot was removed from the group', async () => {
    const user = userEvent.setup();
    const refused: AdminRequestRow = { ...asapRow, id: 'request-refused', reference: 'MG-REFUSEDA', telegramStatus: 'failed', telegramErrorCode: 'TELEGRAM_BOT_REMOVED' };
    render(<RequestTable rows={[refused]} retryTelegram={vi.fn().mockResolvedValue({ status: 'sent' })} />);

    await user.click(screen.getByRole('button', { name: 'Подробнее MG-REFUSEDA' }));

    const details = screen.getByRole('region', { name: 'Детали заявки MG-REFUSEDA' });
    expect(within(details).getByText('TELEGRAM_BOT_REMOVED (попытка 1)')).toBeInTheDocument();
    expect(within(details).getByText(/Добавьте бота обратно/)).toBeInTheDocument();
  });

  it('adds nothing for a code it has no advice for', async () => {
    const user = userEvent.setup();
    const refused: AdminRequestRow = { ...asapRow, id: 'request-generic', reference: 'MG-GENERICA', telegramStatus: 'failed', telegramErrorCode: 'TELEGRAM_API_ERROR' };
    render(<RequestTable rows={[refused]} retryTelegram={vi.fn().mockResolvedValue({ status: 'sent' })} />);

    await user.click(screen.getByRole('button', { name: 'Подробнее MG-GENERICA' }));

    const details = screen.getByRole('region', { name: 'Детали заявки MG-GENERICA' });
    expect(within(details).queryByText(/Добавьте бота|супергруппой|Токен бота/)).not.toBeInTheDocument();
  });
});
