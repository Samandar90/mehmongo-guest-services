import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardCards } from './dashboard-cards';

describe('DashboardCards', () => {
  it('renders the three counters with links to their screens', () => {
    render(<DashboardCards metrics={{ activeHotels: 1, activeRooms: 24, newRequests: 7 }} />);

    const hotels = screen.getByRole('article', { name: 'Активные отели' });
    expect(within(hotels).getByText('1')).toBeInTheDocument();
    expect(within(hotels).getByRole('link', { name: 'Открыть отели' })).toHaveAttribute('href', '/admin/hotels');

    const rooms = screen.getByRole('article', { name: 'Активные комнаты' });
    expect(within(rooms).getByText('24')).toBeInTheDocument();
    expect(within(rooms).getByRole('link', { name: 'Открыть отели' })).toHaveAttribute('href', '/admin/hotels');

    const requests = screen.getByRole('article', { name: 'Новые заявки' });
    expect(within(requests).getByText('7')).toBeInTheDocument();
    expect(within(requests).getByRole('link', { name: 'Открыть заявки' })).toHaveAttribute('href', '/admin/requests');
  });

  it('shows placeholders while metrics are loading', () => {
    render(<DashboardCards metrics={null} busy />);

    expect(screen.getAllByText('…')).toHaveLength(3);
    expect(screen.getByRole('article', { name: 'Новые заявки' })).toHaveAttribute('aria-busy', 'true');
  });

  it('marks cards busy during a refresh even when stale metrics are shown', () => {
    render(<DashboardCards metrics={{ activeHotels: 1, activeRooms: 24, newRequests: 7 }} busy />);

    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Активные комнаты' })).toHaveAttribute('aria-busy', 'true');
  });

  it('is not busy and shows dashes when loading finished without metrics', () => {
    render(<DashboardCards metrics={null} busy={false} />);

    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByRole('article', { name: 'Новые заявки' })).not.toHaveAttribute('aria-busy');
  });
});
