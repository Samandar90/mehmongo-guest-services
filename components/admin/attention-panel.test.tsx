import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AttentionPanel } from './attention-panel';

describe('AttentionPanel', () => {
  it('links each problem to its own rows and hides the absent ones', () => {
    render(<AttentionPanel attention={{ overdueOpen: 2, dueToday: 0, telegramFailed: 1, missingCost: 0 }} />);

    expect(screen.getByRole('link', { name: /Дата прошла/ })).toHaveAttribute('href', '/admin/requests?attention=overdue');
    expect(screen.getByRole('link', { name: /Telegram/ })).toHaveAttribute('href', '/admin/requests?attention=telegram');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('says so when there is nothing to do', () => {
    render(<AttentionPanel attention={{ overdueOpen: 0, dueToday: 0, telegramFailed: 0, missingCost: 0 }} />);

    expect(screen.getByText(/Всё в порядке/)).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
