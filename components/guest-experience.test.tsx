import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestExperience } from './guest-experience';
import type { RoomContextResult } from '../supabase/functions/_shared/contracts';
import { GuestApiError } from '@/lib/requests/api';

const server = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock('@/lib/requests/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/requests/api')>(),
  submitGuestRequest: server.submit,
}));

const context: RoomContextResult = {
  hotelName: 'Kamilovs Hotel',
  roomLabel: '205',
  roomToken: '20000000-0000-4000-8000-000000000205',
  services: ['tours', 'transport', 'restaurants', 'tickets'],
  catalogId: null,
};

afterEach(() => {
  vi.useRealTimers();
  server.submit.mockReset();
});

/**
 * A date the form will accept, worked out when the test runs.
 *
 * The field carries min={todayIso()}, so a hard-coded date silently becomes a
 * past date and every submission in this file starts failing on validation.
 * That is exactly what happened once the calendar moved past the literal that
 * used to be here.
 */
function acceptableDate(): string {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  return day.toISOString().slice(0, 10);
}

async function completeTransportForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Transport/i }));
  await user.type(screen.getByLabelText('Pickup point'), 'Kamilovs Hotel');
  await user.type(screen.getByLabelText('Destination'), 'Airport');
  await user.type(screen.getByLabelText('Preferred date'), acceptableDate());
  await user.type(screen.getByLabelText('Preferred time'), '18:30');
  await user.clear(screen.getByLabelText('Passengers'));
  await user.type(screen.getByLabelText('Passengers'), '2');
  await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
  await user.type(screen.getByLabelText('Phone or messenger'), '@amir');
}

describe('GuestExperience', () => {
  it('shows the server-provided hotel and room context', () => {
    render(<GuestExperience context={context} />);

    expect(screen.getByText('Kamilovs Hotel')).toBeVisible();
    expect(screen.getByText('Room 205')).toBeVisible();
  });

  it('shows only the services allowed by the resolved room context', () => {
    render(<GuestExperience context={{ ...context, services: ['transport'] }} />);

    expect(screen.getByRole('button', { name: /Transport/i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Tours/i })).not.toBeInTheDocument();
  });

  it('does not ask for a time when the service only needs a date', async () => {
    const user = userEvent.setup();
    render(<GuestExperience context={context} />);

    await user.click(screen.getByRole('button', { name: /Tours/i }));
    expect(screen.getByLabelText('Preferred date')).toBeVisible();
    expect(screen.queryByLabelText('Preferred time')).not.toBeInTheDocument();
  });

  it('opens transport and explains missing required fields', async () => {
    const user = userEvent.setup();
    render(<GuestExperience context={context} />);

    await user.click(screen.getByRole('button', { name: /Transport/i }));
    expect(screen.getByRole('heading', { name: 'Transport request' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByText('Enter a pickup point')).toBeVisible();
    expect(screen.getByText('Enter a destination')).toBeVisible();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(1);
  });

  it('submits the room token and shows the server reference', async () => {
    const user = userEvent.setup();
    server.submit.mockResolvedValue({ reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
    render(<GuestExperience context={context} />);

    await completeTransportForm(user);
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText('MG-ABCDEFGH')).toBeVisible();
    expect(server.submit).toHaveBeenCalledWith(expect.objectContaining({ roomToken: context.roomToken, service: 'transport' }));
  });

  it('keeps entered values and focuses a safe error when the API fails', async () => {
    const user = userEvent.setup();
    server.submit.mockRejectedValue(new GuestApiError('REQUEST_FAILED'));
    render(<GuestExperience context={context} />);

    await completeTransportForm(user);
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    const alert = await screen.findByRole('alert', { name: 'We could not send your request. Please try again.' });
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Destination')).toHaveValue('Airport');
  });

  it('reuses the idempotency key when an unchanged request is retried', async () => {
    const user = userEvent.setup();
    server.submit
      .mockRejectedValueOnce(new GuestApiError('REQUEST_FAILED'))
      .mockResolvedValueOnce({ reference: 'MG-RETRY123', telegramStatus: 'failed' });
    render(<GuestExperience context={context} />);

    await completeTransportForm(user);
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('alert', { name: 'We could not send your request. Please try again.' });
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText('MG-RETRY123')).toBeVisible();
    expect(server.submit.mock.calls[1]?.[0].idempotencyKey).toBe(server.submit.mock.calls[0]?.[0].idempotencyKey);
  });

  it('creates a new idempotency key when the request payload changes after failure', async () => {
    const user = userEvent.setup();
    server.submit.mockRejectedValue(new GuestApiError('REQUEST_FAILED'));
    render(<GuestExperience context={context} />);

    await completeTransportForm(user);
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('alert', { name: 'We could not send your request. Please try again.' });
    await user.clear(screen.getByLabelText('Destination'));
    await user.type(screen.getByLabelText('Destination'), 'Railway station');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('alert', { name: 'We could not send your request. Please try again.' });

    expect(server.submit.mock.calls[1]?.[0].idempotencyKey).not.toBe(server.submit.mock.calls[0]?.[0].idempotencyKey);
  });

  it('submits only once while the request is pending, even if the form submits twice synchronously', async () => {
    const user = userEvent.setup();
    let resolveRequest: ((value: { reference: string; telegramStatus: 'pending' }) => void) | undefined;
    server.submit.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    render(<GuestExperience context={context} />);

    await completeTransportForm(user);
    const form = screen.getByRole('button', { name: 'Send request' }).closest('form');
    if (!form) throw new Error('Request form is missing');
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(server.submit).toHaveBeenCalledTimes(1);
    resolveRequest?.({ reference: 'MG-PENDING1', telegramStatus: 'pending' });
    expect(await screen.findByText('MG-PENDING1')).toBeVisible();
  });
});

describe('GuestExperience languages', () => {
  it('renders in the language the server resolved', () => {
    render(<GuestExperience context={context} locale="ru" />);

    expect(screen.getByText('Комната 205')).toBeVisible();
    expect(screen.getByRole('button', { name: /Транспорт/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Язык: Русский' })).toBeVisible();
    expect(screen.getByRole('main')).toHaveAttribute('lang', 'ru');
  });

  it('switches language in place and keeps what the guest typed', async () => {
    const user = userEvent.setup();
    render(<GuestExperience context={context} />);

    await user.click(screen.getByRole('button', { name: /Transport/i }));
    await user.type(screen.getByLabelText('Destination'), 'Airport');

    await user.click(screen.getByRole('button', { name: 'Language: English' }));
    await user.click(screen.getByRole('menuitemradio', { name: /中文/ }));

    expect(screen.getByRole('heading', { name: '交通申请' })).toBeInTheDocument();
    expect(screen.getByLabelText('目的地')).toHaveValue('Airport');
    expect(screen.getByRole('main')).toHaveAttribute('lang', 'zh-Hans');
    expect(document.documentElement.lang).toBe('zh-Hans');
    expect(document.cookie).toContain('mg_lang=zh');
  });

  it('validates in the language the guest is reading', async () => {
    const user = userEvent.setup();
    render(<GuestExperience context={context} locale="uz" />);

    await user.click(screen.getByRole('button', { name: /Transport/i }));
    await user.click(screen.getByRole('button', { name: 'Soʻrov yuborish' }));

    expect(screen.getByText('Qayerdan olib ketishimizni kiriting')).toBeVisible();
    expect(screen.getByText('Ismingizni kiriting')).toBeVisible();
  });

  it('sends the language the guest was reading with the request', async () => {
    const user = userEvent.setup();
    server.submit.mockResolvedValue({ reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
    render(<GuestExperience context={context} locale="uz" />);

    await user.click(screen.getByRole('button', { name: /Transport/i }));
    await user.type(screen.getByLabelText('Qayerdan olib ketamiz'), 'Kamilovs Hotel');
    await user.type(screen.getByLabelText('Qayerga'), 'Airport');
    await user.type(screen.getByLabelText('Qulay sana'), acceptableDate());
    await user.type(screen.getByLabelText('Qulay vaqt'), '18:30');
    await user.type(screen.getByLabelText('Ismingiz'), 'Amir Khan');
    await user.type(screen.getByLabelText('Telefon yoki messenjer'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Soʻrov yuborish' }));

    expect(await screen.findByText('MG-ABCDEFGH')).toBeVisible();
    expect(screen.getByText('Soʻrov qabul qilindi')).toBeVisible();
    expect(screen.getByText('Kamilovs Hotel · 205-xona')).toBeVisible();
    expect(server.submit).toHaveBeenCalledWith(expect.objectContaining({ guestLocale: 'uz', service: 'transport' }));
  });
});
