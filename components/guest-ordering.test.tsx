import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestExperience } from './guest-experience';
import type { RoomContextResult } from '../supabase/functions/_shared/contracts';

const server = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock('@/lib/requests/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/requests/api')>(),
  submitGuestRequest: server.submit,
}));

const context: RoomContextResult = {
  hotelName: 'Kamilovs Hotel',
  hotelAddress: 'Xromiy 7',
  roomLabel: '205',
  roomToken: '20000000-0000-4000-8000-000000000205',
  services: ['tours', 'transport', 'restaurants', 'tickets'],
  catalogId: null,
};

function acceptableDate(): string {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  return day.toISOString().slice(0, 10);
}

afterEach(() => {
  server.submit.mockReset();
});

/**
 * Ordering from the room: the pickup is the hotel, the ride can be "as soon
 * as possible", and after sending the guest can write to the team and keep
 * the page.
 */
describe('the pickup starts from the hotel', () => {
  it('fills the hotel and its address in, and lets the guest change it', async () => {
    const user = userEvent.setup();
    render(<GuestExperience context={context} />);

    await user.click(screen.getByRole('button', { name: /Transport/i }));

    const pickup = screen.getByLabelText('Pickup point');
    expect(pickup).toHaveValue('Kamilovs Hotel, Xromiy 7');
    expect(screen.getByText('Your hotel is filled in — change it if you start elsewhere.')).toBeVisible();
    await user.clear(pickup);
    await user.type(pickup, 'Chorsu bazaar');
    expect(pickup).toHaveValue('Chorsu bazaar');
  });

  it('uses the hotel name alone when the owner entered no address', async () => {
    const user = userEvent.setup();
    render(<GuestExperience context={{ ...context, hotelAddress: '' }} />);

    await user.click(screen.getByRole('button', { name: /Transport/i }));
    expect(screen.getByLabelText('Pickup point')).toHaveValue('Kamilovs Hotel');
  });
});

describe('as soon as possible', () => {
  it('sends a transfer without a date or time', async () => {
    const user = userEvent.setup();
    server.submit.mockResolvedValue({ reference: 'MG-ASAPAAAA', telegramStatus: 'sent' });
    render(<GuestExperience context={context} />);

    await user.click(screen.getByRole('button', { name: /Transport/i }));
    expect(screen.getByLabelText('Preferred date')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'As soon as possible' }));
    expect(screen.getByRole('button', { name: 'As soon as possible' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Preferred date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preferred time')).not.toBeInTheDocument();
    expect(screen.getByText('We will contact you right away and confirm the nearest pickup time.')).toBeVisible();

    await user.type(screen.getByLabelText('Destination'), 'Airport');
    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('Phone or messenger'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText('MG-ASAPAAAA')).toBeVisible();
    expect(server.submit).toHaveBeenCalledWith(expect.objectContaining({
      asap: true,
      fields: expect.objectContaining({ date: '', time: '', pickup: 'Kamilovs Hotel, Xromiy 7', destination: 'Airport' }),
    }));
  });

  it('asks for the date and time again when the guest changes their mind', async () => {
    const user = userEvent.setup();
    render(<GuestExperience context={context} />);

    await user.click(screen.getByRole('button', { name: /Transport/i }));
    await user.click(screen.getByRole('button', { name: 'As soon as possible' }));
    await user.click(screen.getByRole('button', { name: 'Choose date and time' }));

    expect(screen.getByLabelText('Preferred date')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Destination'), 'Airport');
    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('Phone or messenger'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(screen.getByText('Choose a date')).toBeVisible();
    expect(server.submit).not.toHaveBeenCalled();
  });

  it('is not offered for a table', async () => {
    const user = userEvent.setup();
    render(<GuestExperience context={context} />);

    await user.click(screen.getByRole('button', { name: /Restaurants/i }));
    expect(screen.queryByRole('button', { name: 'As soon as possible' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Preferred time')).toBeInTheDocument();
  });
});

describe('after sending', () => {
  async function sendTransfer(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Transport/i }));
    await user.type(screen.getByLabelText('Destination'), 'Airport');
    await user.type(screen.getByLabelText('Preferred date'), acceptableDate());
    await user.type(screen.getByLabelText('Preferred time'), '18:30');
    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('Phone or messenger'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByText('MG-ABCDEFGH');
  }

  it('shows ways to write to the team and to keep the page', async () => {
    const user = userEvent.setup();
    server.submit.mockResolvedValue({ reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
    render(<GuestExperience context={context} />);

    await sendTransfer(user);

    const whatsapp = screen.getByRole('link', { name: 'Write on WhatsApp' });
    expect(whatsapp).toHaveAttribute('href', expect.stringContaining('https://wa.me/998990220114?text='));
    expect(decodeURIComponent(whatsapp.getAttribute('href') ?? '')).toContain('Hello! My request is MG-ABCDEFGH (Kamilovs Hotel, Room 205).');
    expect(whatsapp).toHaveAttribute('target', '_blank');
    // No Telegram username is configured yet, so no button promises one.
    expect(screen.queryByRole('link', { name: 'Write on Telegram' })).not.toBeInTheDocument();
    expect(screen.getByText(/We usually reply within 15 minutes between 08:00 and 23:00/)).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Save this page' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Send the link to yourself and order again from anywhere.')).toBeVisible();
  });

  it('writes the first message in the language the guest is reading', async () => {
    const user = userEvent.setup();
    server.submit.mockResolvedValue({ reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
    render(<GuestExperience context={context} locale="zh" />);

    await user.click(screen.getByRole('button', { name: /交通/ }));
    await user.click(screen.getByRole('button', { name: '尽快出发' }));
    await user.type(screen.getByLabelText('目的地'), 'Airport');
    await user.type(screen.getByLabelText('您的姓名'), '李华');
    await user.type(screen.getByLabelText('电话或即时通讯'), '+86 138 0000 0000');
    await user.click(screen.getByRole('button', { name: '发送申请' }));
    await screen.findByText('MG-ABCDEFGH');

    const whatsapp = screen.getByRole('link', { name: '通过 WhatsApp 联系' });
    expect(decodeURIComponent(whatsapp.getAttribute('href') ?? '')).toContain('您好！我的申请编号是 MG-ABCDEFGH（Kamilovs Hotel，205 号房）。');
    expect(server.submit).toHaveBeenCalledWith(expect.objectContaining({ asap: true, guestLocale: 'zh' }));
  });
});
