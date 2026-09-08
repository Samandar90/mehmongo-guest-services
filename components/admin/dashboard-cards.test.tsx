import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardCards } from './dashboard-cards';

describe('DashboardCards', () => {
  // Each counter is itself the link now. It used to be an article with a button
  // underneath, which doubled the height of the strip for a second target to a
  // page the number already points at.
  it('renders the three counters, each linking to its own screen', () => {
    render(<DashboardCards metrics={{ activeHotels: 1, activeRooms: 24, newRequests: 7 }} />);

    const hotels = screen.getByRole('link', { name: 'Активные отели' });
    expect(within(hotels).getByText('1')).toBeInTheDocument();
    expect(hotels).toHaveAttribute('href', '/admin/hotels');

    const rooms = screen.getByRole('link', { name: 'Активные комнаты' });
    expect(within(rooms).getByText('24')).toBeInTheDocument();
    expect(rooms).toHaveAttribute('href', '/admin/hotels');

    const requests = screen.getByRole('link', { name: 'Новые заявки' });
    expect(within(requests).getByText('7')).toBeInTheDocument();
    expect(requests).toHaveAttribute('href', '/admin/requests');
  });

  it('shows placeholders while metrics are loading', () => {
    render(<DashboardCards metrics={null} busy />);

    expect(screen.getAllByText('…')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Новые заявки' })).toHaveAttribute('aria-busy', 'true');
  });

  it('marks cards busy during a refresh even when stale metrics are shown', () => {
    render(<DashboardCards metrics={{ activeHotels: 1, activeRooms: 24, newRequests: 7 }} busy />);

    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Активные комнаты' })).toHaveAttribute('aria-busy', 'true');
  });

  it('is not busy and shows dashes when loading finished without metrics', () => {
    render(<DashboardCards metrics={null} busy={false} />);

    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Новые заявки' })).not.toHaveAttribute('aria-busy');
  });
});
