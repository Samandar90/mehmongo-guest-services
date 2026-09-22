import { render, screen, waitFor } from '@testing-library/react';
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
  vi.useRealTimers();
});

function renderCatalog() {
  server.submit.mockResolvedValue({ reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
  render(<GuestExperience context={catalogContext} />);
  return userEvent.setup();
}

/** The card's button opens the form itself; there is no details step in between. */
async function openForm(user: ReturnType<typeof userEvent.setup>, cta: string) {
  await user.click(screen.getByRole('button', { name: cta }));
}

async function fillGuest(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
  await user.type(screen.getByLabelText('One way to reach you'), '@amir');
}

describe('catalogue rides ordered from the room', () => {
  it('offers as soon as possible for the airport ride and then sends no time', async () => {
    const user = renderCatalog();
    await openForm(user, 'Arrange my airport ride');

    expect(screen.getByLabelText('Preferred time')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'As soon as possible' }));
    expect(screen.queryByLabelText('Preferred date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preferred time')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Hotel → airport' }));
    await fillGuest(user);
    await user.click(screen.getByRole('button', { name: 'Send my request' }));

    expect(await screen.findByText('MG-ABCDEFGH')).toBeInTheDocument();
    expect(server.submit).toHaveBeenCalledWith(expect.objectContaining({
      asap: true,
      offerId: 'tashkent-airport-sedan',
      fields: expect.objectContaining({ choice: 'Hotel → airport', date: '', time: '' }),
    }));
  });

  it('still requires a time for a ride when a day was chosen', async () => {
    const user = renderCatalog();
    await openForm(user, 'Arrange my airport ride');

    await user.click(screen.getByRole('radio', { name: 'Hotel → airport' }));
    await user.click(screen.getByRole('radio', { name: 'Tomorrow' }));
    await fillGuest(user);
    await user.click(screen.getByRole('button', { name: 'Send my request' }));

    expect(screen.getByText('Choose a time')).toBeInTheDocument();
    expect(server.submit).not.toHaveBeenCalled();
  });

  it('asks for a day when none was chosen', async () => {
    const user = renderCatalog();
    await openForm(user, 'Request this excursion');

    await fillGuest(user);
    await user.click(screen.getByRole('button', { name: 'Send my request' }));

    expect(screen.getByText('Choose a date')).toBeInTheDocument();
    expect(server.submit).not.toHaveBeenCalled();
  });

  it('starts the Samarkand pickup from the hotel and leaves the destination to the guest', async () => {
    const user = renderCatalog();
    await openForm(user, 'Arrange my Samarkand ride');

    expect(screen.getByLabelText('Pickup address in Tashkent')).toHaveValue('Kamilovs Hotel, Xromiy 7');
    expect(screen.getByLabelText('Destination in Samarkand')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'As soon as possible' })).toBeInTheDocument();
  });

  it('does not offer as soon as possible for a guide, only the day', async () => {
    const user = renderCatalog();
    await openForm(user, 'Request this excursion');

    expect(screen.queryByRole('radio', { name: 'As soon as possible' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Which day?' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Preferred date')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Other date' }));
    expect(screen.getByLabelText('Preferred date')).toBeInTheDocument();
  });

  it('starts a ticket where the journey starts, not at the hotel', async () => {
    const user = renderCatalog();
    await openForm(user, 'Find my ticket');

    expect(screen.queryByRole('radio', { name: 'As soon as possible' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveValue('');
  });
});

describe('the short form', () => {
  it('dates today and tomorrow in Tashkent, where UTC is still on the day before', async () => {
    // 02:00 on 23 September in Tashkent is 21:00 UTC on the 22nd.
    vi.useFakeTimers({ now: new Date('2026-09-22T21:00:00Z'), toFake: ['Date'] });
    const user = renderCatalog();
    await openForm(user, 'Request this excursion');

    await user.click(screen.getByRole('radio', { name: 'Today' }));
    await fillGuest(user);
    await user.click(screen.getByRole('button', { name: 'Send my request' }));
    await waitFor(() => expect(server.submit).toHaveBeenCalledTimes(1));
    expect(server.submit.mock.calls[0][0].fields.date).toBe('2026-09-23');
  });

  it('keeps the chosen day when the guest moves to another service', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-22T21:00:00Z'), toFake: ['Date'] });
    const user = renderCatalog();
    await openForm(user, 'Request this excursion');
    await user.click(screen.getByRole('radio', { name: 'Tomorrow' }));
    await user.click(screen.getByRole('button', { name: 'Back to services' }));

    await openForm(user, 'Plan my city day');
    expect(screen.getByRole('radio', { name: 'Tomorrow' })).toBeChecked();
  });

  it('counts travellers with the stepper between 1 and 50', async () => {
    const user = renderCatalog();
    await openForm(user, 'Request this excursion');
    const count = screen.getByLabelText('Number of travellers');

    expect(count).toHaveValue(2);
    await user.click(screen.getByRole('button', { name: 'Fewer travellers' }));
    await user.click(screen.getByRole('button', { name: 'Fewer travellers' }));
    expect(count).toHaveValue(1);

    await user.clear(count);
    await user.type(count, '50');
    await user.click(screen.getByRole('button', { name: 'More travellers' }));
    expect(count).toHaveValue(50);
  });

  it('keeps the optional fields behind Add details until the guest asks', async () => {
    const user = renderCatalog();
    await openForm(user, 'Arrange my airport ride');

    expect(screen.queryByLabelText('Flight number (optional)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Anything else? (optional)')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add details' }));

    expect(screen.getByLabelText('Flight number (optional)')).toHaveFocus();
    expect(screen.getByLabelText('Luggage (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Anything else? (optional)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add details' })).not.toBeInTheDocument();
  });

  it('shows a note kept from another service instead of sending it unseen', async () => {
    const user = renderCatalog();
    await openForm(user, 'Request this excursion');
    await user.click(screen.getByRole('button', { name: 'Add details' }));
    await user.type(screen.getByLabelText('Anything else? (optional)'), 'Vegetarian lunch');
    await user.click(screen.getByRole('button', { name: 'Back to services' }));

    await openForm(user, 'Plan my city day');
    expect(screen.getByLabelText('Anything else? (optional)')).toHaveValue('Vegetarian lunch');
  });

  it('folds the note of the restaurant form the same way', async () => {
    const user = renderCatalog();
    await user.click(screen.getByRole('button', { name: 'Request a restaurant reservation' }));

    expect(screen.queryByLabelText(/Anything else\?/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add details' }));
    expect(screen.getByLabelText(/Anything else\?/)).toHaveFocus();
  });

  it('lets the phone fill in the name and number', async () => {
    const user = renderCatalog();
    await openForm(user, 'Arrange my airport ride');

    expect(screen.getByLabelText('Your name')).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByLabelText('One way to reach you')).toHaveAttribute('autocomplete', 'tel');
    // The contact is still free text: a Telegram @username or an email is welcome too.
    expect(screen.getByLabelText('One way to reach you')).toHaveProperty('type', 'text');
  });
});
