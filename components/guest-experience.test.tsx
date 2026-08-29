import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestExperience } from './guest-experience';

const context = { hotelId: 'kamilovs', hotelName: 'Kamilovs Hotel', room: '205' };

afterEach(() => vi.useRealTimers());

describe('GuestExperience', () => {
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

  it('submits a valid transport request and shows its reference', async () => {
    const user = userEvent.setup();
    render(<GuestExperience context={context} />);

    await user.click(screen.getByRole('button', { name: /Transport/i }));
    await user.type(screen.getByLabelText('Pickup point'), 'Kamilovs Hotel');
    await user.type(screen.getByLabelText('Destination'), 'Samarkand railway station');
    await user.type(screen.getByLabelText('Preferred date'), '2026-09-02');
    await user.type(screen.getByLabelText('Preferred time'), '18:30');
    await user.clear(screen.getByLabelText('Passengers'));
    await user.type(screen.getByLabelText('Passengers'), '2');
    await user.type(screen.getByLabelText('Your name'), 'Amir Khan');
    await user.type(screen.getByLabelText('Phone or messenger'), '@amir');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(screen.getByRole('button', { name: 'Sending request…' })).toBeDisabled();
    expect(await screen.findByRole('heading', { name: 'Request received' }, { timeout: 2000 })).toBeVisible();
    expect(screen.getByText(/MG-\d{4}/)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Request received');
  });
});
