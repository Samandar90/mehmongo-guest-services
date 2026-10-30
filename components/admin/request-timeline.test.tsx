import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RequestTimeline } from './request-timeline';
import type { TimelineBucket } from '@/lib/admin/insights';

const buckets: TimelineBucket[] = [
  { from: '2026-10-09', to: '2026-10-09', completed: 1, open: 0, cancelled: 1, total: 2 },
  { from: '2026-10-10', to: '2026-10-10', completed: 0, open: 0, cancelled: 0, total: 0 },
];

describe('RequestTimeline', () => {
  it('links a busy day to exactly its requests', () => {
    render(<RequestTimeline buckets={buckets} basis="created" />);

    expect(screen.getByRole('link', { name: /09\.10\.2026: 2/ }))
      .toHaveAttribute('href', '/admin/requests?dateFrom=2026-10-09&dateTo=2026-10-09');
  });

  it('keeps the chosen date basis in the link', () => {
    render(<RequestTimeline buckets={buckets} basis="settled" />);

    expect(screen.getByRole('link', { name: /09\.10\.2026/ }).getAttribute('href')).toContain('dateBasis=settled');
  });

  it('gives a quiet day no link, and leaves it out of the table', () => {
    render(<RequestTimeline buckets={buckets} basis="created" />);

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('cell', { name: '10.10.2026' })).not.toBeInTheDocument();
  });
});
