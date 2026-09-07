import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettlementReport } from './settlement-report';
import type { SettlementSummary } from '@/lib/admin/summary';

const summary: SettlementSummary = {
  requests: 7,
  completed: 3,
  cancelled: 1,
  payouts: [{ currency: 'USD', payoutMinor: 1_200, requests: 3 }],
  turnover: [
    { currency: 'USD', amountMinor: 30_000, requests: 1 },
    { currency: 'UZS', amountMinor: 40_000_000, requests: 2 },
  ],
  byService: [
    { serviceType: 'tickets', requests: 3, completed: 0 },
    { serviceType: 'tours', requests: 2, completed: 1 },
    { serviceType: 'transport', requests: 2, completed: 2 },
  ],
};

const empty: SettlementSummary = { requests: 0, completed: 0, cancelled: 0, payouts: [], turnover: null, byService: [] };

describe('SettlementReport', () => {
  it('shows how many requests came in and how many were carried out', () => {
    const { container } = render(<SettlementReport summary={summary} />);
    // Scoped to the headline figures: the same numbers recur in the tables below.
    const metrics = container.querySelector('.admin-metrics') as HTMLElement;

    expect(within(metrics).getByText('Заявок').nextElementSibling).toHaveTextContent('7');
    expect(within(metrics).getByText('Выполнено').nextElementSibling).toHaveTextContent('3');
    expect(within(metrics).getByText('Отменено').nextElementSibling).toHaveTextContent('1');
  });

  it('shows the payout in its own currency, apart from the turnover', () => {
    render(<SettlementReport summary={summary} />);
    const payouts = screen.getByRole('table', { name: /начислено/i });
    const turnover = screen.getByRole('table', { name: /оборот/i });

    // Paid in dollars whatever the sale was settled in.
    expect(within(payouts).getByText('12,00 USD')).toBeVisible();
    // The turnover keeps its own currencies, each on its own line.
    expect(within(turnover).getByText('40 000 000 UZS')).toBeVisible();
    expect(within(turnover).getByText('300,00 USD')).toBeVisible();
    // Nothing anywhere claims a combined figure across currencies.
    expect(screen.queryByText(/Итого по всем валютам/i)).toBeNull();
  });

  it('shows a hotel no turnover table at all', () => {
    render(<SettlementReport summary={{ ...summary, turnover: null }} />);

    expect(screen.getByRole('table', { name: /начислено/i })).toBeVisible();
    expect(screen.queryByRole('table', { name: /оборот/i })).toBeNull();
    expect(screen.queryByText('40 000 000 UZS')).toBeNull();
  });

  it('shows what the services were worth alongside the counts', () => {
    render(<SettlementReport summary={summary} />);
    const services = screen.getByRole('table', { name: /по услугам/i });

    expect(within(services).getByText('Билеты')).toBeVisible();
    expect(within(services).getByText('Транспорт')).toBeVisible();
  });

  it('says a quiet period is quiet rather than showing empty tables', () => {
    render(<SettlementReport summary={empty} />);
    expect(screen.getByText(/За выбранный период заявок не было/i)).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says nothing was earned when requests came but none completed', () => {
    render(<SettlementReport summary={{ ...empty, requests: 4 }} />);
    expect(screen.getByText(/Пока ничего не начислено/i)).toBeVisible();
  });
});
