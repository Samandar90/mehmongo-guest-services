import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PeriodDelta } from './period-delta';

describe('PeriodDelta', () => {
  it('shows a rise, the percent and the previous figure', () => {
    render(<PeriodDelta current={5} previous={4} />);

    expect(screen.getByText('▲ 25% · было 4')).toHaveClass('admin-delta-good');
  });

  it('reads more cancellations as bad news', () => {
    render(<PeriodDelta current={3} previous={2} goodWhen="down" />);

    expect(screen.getByText('▲ 50% · было 2')).toHaveClass('admin-delta-bad');
  });

  it('reads fewer cancellations as good news', () => {
    render(<PeriodDelta current={1} previous={2} goodWhen="down" />);

    expect(screen.getByText('▼ 50% · было 2')).toHaveClass('admin-delta-good');
  });

  it('prints no percentage from zero, only what it was', () => {
    render(<PeriodDelta current={5} previous={0} format={(value) => `${value} USD`} />);

    expect(screen.getByText('▲ · было 0 USD')).toBeVisible();
  });

  it('says when nothing moved, and stays out of the way when both are zero', () => {
    const { container, rerender } = render(<PeriodDelta current={4} previous={4} />);
    expect(screen.getByText('= без изменений')).toHaveClass('admin-delta-flat');

    rerender(<PeriodDelta current={0} previous={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
