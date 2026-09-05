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

async function completeTransportForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Transport/i }));
  await user.type(screen.getByLabelText('Pickup point'), 'Kamilovs Hotel');
  await user.type(screen.getByLabelText('Destination'), 'Airport');
  await user.type(screen.getByLabelText('Preferred date'), '2026-09-06');
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
