import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ServiceGrid } from './service-grid';

describe('ServiceGrid', () => {
  it('shows the four approved guest services', () => {
    render(<ServiceGrid onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Tours/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /Transport/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /Restaurants/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /Tickets/i })).toBeVisible();
  });
});
