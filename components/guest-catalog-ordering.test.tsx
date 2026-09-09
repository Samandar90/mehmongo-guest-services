import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestExperience } from './guest-experience';
import type { RoomContextResult } from '../supabase/functions/_shared/contracts';

const server = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock('@/lib/requests/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/requests/api')>(),
  submitGuestRequest: server.submit,
}));

const catalogContext: RoomContextResult = {
  hotelName: 'Kamilovs Hotel',
  hotelAddress: 'Xromiy 7',
  roomLabel: '205',
  roomToken: '20000000-0000-4000-8000-000000000205',
  services: ['tours', 'transport', 'restaurants', 'tickets'],
  catalogId: 'tashkent-v1',
};

afterEach(() => {
  server.submit.mockReset();
});

function renderCatalog() {
  server.submit.mockResolvedValue({ reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
  render(<GuestExperience context={catalogContext} />);
  return userEvent.setup();
}

async function openForm(user: ReturnType<typeof userEvent.setup>, cta: string) {
  await user.click(screen.getByRole('button', { name: cta }));
  const details = screen.getByRole('dialog');
  await user.click(within(details).getByRole('button', { name: cta }));
}

describe('catalogue rides ordered from the room', () => {
  it('offers as soon as possible for the airport ride and then sends no time', async () => {
    const user = renderCatalog();
    await openForm(user, 'Arrange my airport ride');

    expect(screen.getByLabelText('Preferred time')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'As soon as possible' }));
    expect(screen.queryByLabelText('Preferred date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preferred time')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Direction'), 'Hotel → airport');
    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('One way to reach you'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Send my request' }));

    expect(await screen.findByText('MG-ABCDEFGH')).toBeInTheDocument();
    expect(server.submit).toHaveBeenCalledWith(expect.objectContaining({
      asap: true,
      offerId: 'tashkent-airport-sedan',
      fields: expect.objectContaining({ choice: 'Hotel → airport', date: '', time: '' }),
    }));
  });

  it('still requires a time for a ride when a time was chosen', async () => {
    const user = renderCatalog();
    await openForm(user, 'Arrange my airport ride');

    await user.selectOptions(screen.getByLabelText('Direction'), 'Hotel → airport');
    await user.type(screen.getByLabelText('Preferred date'), '2099-12-31');
    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('One way to reach you'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Send my request' }));

    expect(screen.getByText('Choose a time')).toBeInTheDocument();
    expect(server.submit).not.toHaveBeenCalled();
  });

  it('starts the Samarkand pickup from the hotel and leaves the destination to the guest', async () => {
    const user = renderCatalog();
    await openForm(user, 'Arrange my Samarkand ride');

    expect(screen.getByLabelText('Pickup address in Tashkent')).toHaveValue('Kamilovs Hotel, Xromiy 7');
    expect(screen.getByLabelText('Destination in Samarkand')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'As soon as possible' })).toBeInTheDocument();
  });

  it('does not offer as soon as possible for a guide', async () => {
    const user = renderCatalog();
    await openForm(user, 'Request this excursion');

    expect(screen.queryByRole('button', { name: 'As soon as possible' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Preferred date')).toBeInTheDocument();
  });

  it('starts a ticket where the journey starts, not at the hotel', async () => {
    const user = renderCatalog();
    await openForm(user, 'Find my ticket');

    expect(screen.queryByRole('button', { name: 'As soon as possible' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveValue('');
  });
});
