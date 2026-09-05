import { render, screen, waitFor, within } from '@testing-library/react';
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
  roomLabel: '205',
  roomToken: '20000000-0000-4000-8000-000000000205',
  services: ['tours', 'transport', 'restaurants', 'tickets'],
  catalogId: 'tashkent-v1',
};

afterEach(() => {
  server.submit.mockReset();
});

function renderCatalog(context: Partial<RoomContextResult> = {}) {
  server.submit.mockResolvedValue({ reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
  render(<GuestExperience context={{ ...catalogContext, ...context }} />);
  return userEvent.setup();
}

async function openDetails(user: ReturnType<typeof userEvent.setup>, cta: string) {
  await user.click(screen.getByRole('button', { name: cta }));
  return screen.getByRole('dialog');
}

describe('guest catalogue', () => {
  it('keeps the previous guest form when the hotel has no catalogue', () => {
    renderCatalog({ catalogId: null });

    expect(screen.getByRole('heading', { name: /Good stay/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Explore services' })).not.toBeInTheDocument();
  });

  it('shows the real hotel and room from the QR context', () => {
    renderCatalog();

    expect(screen.getByText('Kamilovs Hotel')).toBeInTheDocument();
    expect(screen.getByText('Room 205')).toBeInTheDocument();
  });

  it('lists the published offers with their starting prices and units', () => {
    renderCatalog();

    expect(screen.getByRole('heading', { name: 'See Tashkent with a local guide' })).toBeInTheDocument();
    expect(screen.getByText('From $120')).toBeInTheDocument();
    expect(screen.getAllByText('per agreed excursion').length).toBeGreaterThan(0);
    expect(screen.getByText('From $160')).toBeInTheDocument();
    expect(screen.getByText('From $30')).toBeInTheDocument();
    expect(screen.getByText('From $45')).toBeInTheDocument();
    expect(screen.getByText('From $200')).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it('asks for a ticket quote instead of a price', () => {
    renderCatalog();

    const tickets = screen.getByRole('article', { name: 'Where are you heading next?' });
    expect(within(tickets).getByText('Get a quote')).toBeInTheDocument();
    expect(within(tickets).queryByText(/From \$/)).not.toBeInTheDocument();
  });

  it('shows no invented discount, rating or availability claim', () => {
    renderCatalog();

    expect(screen.queryByText(/instant booking/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/24\/7/)).not.toBeInTheDocument();
    expect(screen.queryByText(/★|reviews?\b/i)).not.toBeInTheDocument();
  });

  it('filters the cards by category and never shows a category the hotel disabled', async () => {
    const user = renderCatalog({ services: ['transport', 'restaurants'] });

    expect(screen.queryByRole('heading', { name: 'See Tashkent with a local guide' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tours & guides' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Flights, trains & buses' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your airport ride, arranged' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Private rides' }));
    expect(screen.getByRole('heading', { name: 'Your airport ride, arranged' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Where are you heading next?' })).not.toBeInTheDocument();
  });

  it('shows the empty message when no catalogue service is enabled', () => {
    renderCatalog({ services: [] });

    expect(screen.getByText('No services are available in this category for your hotel right now.')).toBeInTheDocument();
  });

  it('opens the details of the chosen offer and only then the form', async () => {
    const user = renderCatalog();

    const details = await openDetails(user, 'Plan my mountain day');

    expect(within(details).getByRole('heading', { name: 'Trade the city for mountain views' })).toBeInTheDocument();
    expect(within(details).getByText('Private vehicle with driver for the agreed mountain route')).toBeInTheDocument();
    expect(within(details).getByText(/Cable cars, attraction tickets, guide and meals/)).toBeInTheDocument();
    expect(within(details).getByText('Exact route, stops and return arrangement')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();

    await user.click(within(details).getByRole('button', { name: 'Plan my mountain day' }));

    expect(screen.getByRole('heading', { name: "Let's arrange the details" })).toBeInTheDocument();
    expect(screen.getByText('Trade the city for mountain views')).toBeInTheDocument();
  });

  it('closes the details panel with Escape', async () => {
    const user = renderCatalog();
    await openDetails(user, 'Plan my city day');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('asks the city profile for a meeting point and no time', async () => {
    const user = renderCatalog();
    const details = await openDetails(user, 'Plan my city day');
    await user.click(within(details).getByRole('button', { name: 'Plan my city day' }));

    expect(screen.getByLabelText('Pickup point in Tashkent')).toBeInTheDocument();
    expect(screen.queryByLabelText('Preferred time')).not.toBeInTheDocument();
    expect(screen.getByText('Starting price — not a confirmed total')).toBeInTheDocument();
  });

  it('asks the ticket profile for a travel mode and a route without a price', async () => {
    const user = renderCatalog();
    const details = await openDetails(user, 'Find my ticket');
    await user.click(within(details).getByRole('button', { name: 'Find my ticket' }));

    expect(screen.getByLabelText('Travel by')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
    expect(screen.getByText('Individual quote — no payment now')).toBeInTheDocument();
    expect(screen.queryByText(/From \$/)).not.toBeInTheDocument();
  });

  it('sends the offer id with the mapped fields and shows the real reference', async () => {
    const user = renderCatalog();
    const details = await openDetails(user, 'Arrange my airport ride');
    await user.click(within(details).getByRole('button', { name: 'Arrange my airport ride' }));

    await user.selectOptions(screen.getByLabelText('Direction'), 'Hotel → airport');
    await user.type(screen.getByLabelText('Preferred date'), '2099-12-31');
    await user.type(screen.getByLabelText('Preferred time'), '05:15');
    await user.clear(screen.getByLabelText('Number of travellers'));
    await user.type(screen.getByLabelText('Number of travellers'), '2');
    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('One way to reach you'), '@amir');
    await user.type(screen.getByLabelText('Flight number (optional)'), 'HY601');
    await user.click(screen.getByRole('button', { name: 'Send my request' }));

    await waitFor(() => expect(server.submit).toHaveBeenCalledTimes(1));
    const payload = server.submit.mock.calls[0][0];
    expect(payload.offerId).toBe('tashkent-airport-sedan');
    expect(payload.service).toBe('transport');
    expect(payload.fields).toMatchObject({ choice: 'Hotel → airport', time: '05:15', count: '2', guestName: 'Amir Khan', contact: '@amir' });
    expect(payload.fields.note).toContain('Flight: HY601');
    expect(payload.fields).not.toHaveProperty('offerId');

    expect(await screen.findByText('MG-ABCDEFGH')).toBeInTheDocument();
    expect(screen.getByText('Your request is in.')).toBeInTheDocument();
  });

  it('offers an individual quote when the party is larger than the vehicle', async () => {
    const user = renderCatalog();
    const details = await openDetails(user, 'Arrange my airport ride');
    await user.click(within(details).getByRole('button', { name: 'Arrange my airport ride' }));

    await user.clear(screen.getByLabelText('Number of travellers'));
    await user.type(screen.getByLabelText('Number of travellers'), '6');

    expect(screen.getByText(/This option seats up to 3/)).toBeInTheDocument();
    expect(screen.getByText('Individual quote — no payment now')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send my request' })).toBeEnabled();
  });

  it('keeps the name and contact when the guest goes back and picks another service', async () => {
    const user = renderCatalog();
    let details = await openDetails(user, 'Plan my mountain day');
    await user.click(within(details).getByRole('button', { name: 'Plan my mountain day' }));

    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('One way to reach you'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Back to service' }));

    details = await openDetails(user, 'Plan my city day');
    await user.click(within(details).getByRole('button', { name: 'Plan my city day' }));

    expect(screen.getByLabelText('Your name')).toHaveValue('Amir Khan');
    expect(screen.getByLabelText('One way to reach you')).toHaveValue('@amir');
  });

  it('keeps the restaurant request on the existing form without an offer', async () => {
    const user = renderCatalog();

    await user.click(screen.getByRole('button', { name: 'Request a restaurant reservation' }));
    await user.type(screen.getByLabelText('Restaurant or cuisine'), 'Plov');
    await user.type(screen.getByLabelText('Preferred date'), '2099-12-31');
    await user.type(screen.getByLabelText('Preferred time'), '19:00');
    await user.clear(screen.getByLabelText('Guests'));
    await user.type(screen.getByLabelText('Guests'), '4');
    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('Phone or messenger'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(server.submit).toHaveBeenCalledTimes(1));
    expect(server.submit.mock.calls[0][0].offerId ?? null).toBeNull();
    expect(server.submit.mock.calls[0][0].service).toBe('restaurants');
  });

  it('routes a custom quote into an existing category without a price', async () => {
    const user = renderCatalog();

    await user.click(screen.getByRole('button', { name: 'Ask for a custom quote' }));
    await user.click(screen.getByRole('button', { name: /Tours: Explore with a trusted local guide/ }));

    expect(screen.getByLabelText('Tour or destination')).toBeInTheDocument();
    expect(screen.queryByText(/From \$/)).not.toBeInTheDocument();
  });

  it('links the photo credits from the footer', () => {
    renderCatalog();

    expect(screen.getByRole('link', { name: 'Photo credits' })).toHaveAttribute('href', '/photo-credits');
  });

  it('states that no payment is taken and the request is not a booking', () => {
    renderCatalog();

    expect(screen.getByText(/No payment is taken on this website/)).toBeInTheDocument();
  });
});

describe('idempotency across services', () => {
  it('reuses the key for a retry but never for another service', async () => {
    const user = renderCatalog();
    server.submit
      .mockRejectedValueOnce(new Error('REQUEST_FAILED'))
      .mockResolvedValue({ reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });

    const details = await openDetails(user, 'Plan my mountain day');
    await user.click(within(details).getByRole('button', { name: 'Plan my mountain day' }));
    await user.selectOptions(screen.getByLabelText('Where would you like to go?'), 'Charvak');
    await user.type(screen.getByLabelText('Preferred date'), '2099-12-31');
    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('One way to reach you'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Send my request' }));
    await screen.findByRole('alert');

    // The same request retried keeps its key, so the server can recognise the duplicate.
    await user.click(screen.getByRole('button', { name: 'Send my request' }));
    await waitFor(() => expect(server.submit).toHaveBeenCalledTimes(2));
    const [firstCall, retryCall] = server.submit.mock.calls;
    expect(retryCall[0].idempotencyKey).toBe(firstCall[0].idempotencyKey);
  });

  it('starts a new key and empty service fields after switching offer', async () => {
    const user = renderCatalog();
    server.submit.mockRejectedValueOnce(new Error('REQUEST_FAILED'));

    let details = await openDetails(user, 'Plan my mountain day');
    await user.click(within(details).getByRole('button', { name: 'Plan my mountain day' }));
    await user.selectOptions(screen.getByLabelText('Where would you like to go?'), 'Charvak');
    await user.type(screen.getByLabelText('Preferred date'), '2099-12-31');
    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('One way to reach you'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Send my request' }));
    await screen.findByRole('alert');
    const failedKey = server.submit.mock.calls[0][0].idempotencyKey;

    await user.click(screen.getByRole('button', { name: 'Back to service' }));
    await user.keyboard('{Escape}');
    details = await openDetails(user, 'Plan my city day');
    await user.click(within(details).getByRole('button', { name: 'Plan my city day' }));

    // The mountain preference must not travel to the city request.
    expect(screen.getByLabelText('Pickup point in Tashkent')).toHaveValue('');
    await user.type(screen.getByLabelText('Pickup point in Tashkent'), 'Hotel lobby');
    server.submit.mockResolvedValue({ reference: 'MG-SECONDAA', telegramStatus: 'sent' });
    await user.click(screen.getByRole('button', { name: 'Send my request' }));

    await waitFor(() => expect(server.submit).toHaveBeenCalledTimes(2));
    const secondCall = server.submit.mock.calls[1][0];
    expect(secondCall.offerId).toBe('tashkent-city-car');
    expect(secondCall.idempotencyKey).not.toBe(failedKey);
  });
});
