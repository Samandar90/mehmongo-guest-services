'use client';

import { useCallback, useEffect, useState } from 'react';
import { DashboardCards } from '@/components/admin/dashboard-cards';
import { OwnerPayouts } from '@/components/admin/owner-payouts';
import { ProfitReport } from '@/components/admin/profit-report';
import { SettlementReport } from '@/components/admin/settlement-report';
import { getDashboardMetrics, type DashboardMetrics } from '@/lib/admin/requests';
import { listHotels } from '@/lib/admin/hotels';
import { getProfitSummary, summariseProfit, type ProfitSummary } from '@/lib/admin/profit';
import {
  getSettlementSummary,
  summariseByHotel,
  summariseRows,
  type HotelSettlement,
  type SettlementSummary,
} from '@/lib/admin/summary';

type MetricsState =
  | { status: 'loading'; metrics: DashboardMetrics | null }
  | { status: 'ready'; metrics: DashboardMetrics }
  | { status: 'error'; metrics: DashboardMetrics | null };

type ReportState =
  | { status: 'loading' }
  | { status: 'ready'; overall: SettlementSummary; byHotel: HotelSettlement[]; profit: ProfitSummary }
  | { status: 'error' };

type Period = { dateFrom: string; dateTo: string };

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Whole calendar months, because that is the unit the hotel payout is priced
 * in: the volume step multiplies every request of a month, so a period that
 * straddles two of them cannot report one honest payout figure.
 */
function monthPeriod(monthsBack: number): Period {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const last = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0);
  return { dateFrom: isoDay(first), dateTo: isoDay(last) };
}

export default function AdminDashboardPage() {
  const [state, setState] = useState<MetricsState>({ status: 'loading', metrics: null });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [period, setPeriod] = useState<Period>(() => monthPeriod(0));
  const [report, setReport] = useState<ReportState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const metrics = await getDashboardMetrics();
        if (!cancelled) setState({ status: 'ready', metrics });
      } catch {
        if (!cancelled) setState((current) => ({ status: 'error', metrics: current.metrics }));
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [loadAttempt]);

  // Totals are their own load: a slow aggregate must not hold up the counters,
  // and changing the period must not re-fetch them.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const window = { dateFrom: period.dateFrom || undefined, dateTo: period.dateTo || undefined };
        const [rows, hotels, profit] = await Promise.all([
          getSettlementSummary(window),
          listHotels(),
          getProfitSummary(window),
        ]);
        if (cancelled) return;
        setReport({
          status: 'ready',
          overall: summariseRows(rows),
          byHotel: summariseByHotel(rows, hotels),
          profit: summariseProfit(profit),
        });
      } catch {
        if (!cancelled) setReport({ status: 'error' });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [period.dateFrom, period.dateTo, loadAttempt]);

  const reload = useCallback(() => {
    setState((current) => ({ status: 'loading', metrics: current.metrics }));
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  const presets: { label: string; value: Period }[] = [
    { label: 'Этот месяц', value: monthPeriod(0) },
    { label: 'Прошлый месяц', value: monthPeriod(1) },
    { label: 'Весь период', value: { dateFrom: '', dateTo: '' } },
  ];
  const activePreset = presets.find((p) => p.value.dateFrom === period.dateFrom && p.value.dateTo === period.dateTo);

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <h1>Обзор</h1>
        <p>Текущее состояние MehmonGo.</p>
      </header>

      {state.status === 'error' ? (
        <div role="alert" className="admin-form-error">
          <p>Не удалось загрузить показатели.</p>
          <button type="button" className="admin-button admin-button-secondary" onClick={reload}>Повторить</button>
        </div>
      ) : null}

      {/* Always mounted so screen readers get the loading announcement when the text appears. */}
      <p className="admin-empty admin-live" aria-live="polite">{state.status === 'loading' ? 'Загрузка показателей…' : ''}</p>

      <DashboardCards metrics={state.metrics} busy={state.status === 'loading'} />

      <section className="admin-card" aria-labelledby="dashboard-period-heading">
        <h2 id="dashboard-period-heading">Период</h2>

        <fieldset className="admin-presets">
          <legend className="admin-sr-only">Быстрый выбор периода</legend>
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="admin-preset"
              aria-pressed={activePreset?.label === preset.label}
              onClick={() => setPeriod(preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </fieldset>

        <form className="admin-filters" aria-label="Период итогов" onSubmit={(event) => event.preventDefault()}>
          <div className="admin-field">
            <label htmlFor="report-from">С даты</label>
            <input
              id="report-from"
              type="date"
              value={period.dateFrom}
              onChange={(event) => setPeriod((current) => ({ ...current, dateFrom: event.target.value }))}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="report-to">По дату</label>
            <input
              id="report-to"
              type="date"
              value={period.dateTo}
              onChange={(event) => setPeriod((current) => ({ ...current, dateTo: event.target.value }))}
            />
          </div>
        </form>
      </section>

      {report.status === 'loading' ? <p className="admin-empty" aria-live="polite">Загрузка итогов…</p> : null}

      {report.status === 'error' ? (
        <div role="alert" className="admin-form-error">
          <p>Не удалось загрузить итоги.</p>
          <button type="button" className="admin-button admin-button-secondary" onClick={reload}>Повторить</button>
        </div>
      ) : null}

      {report.status === 'ready' ? (
        <>
          <section className="admin-card admin-card-owner" aria-labelledby="dashboard-profit-heading">
            <div className="admin-card-head">
              <h2 id="dashboard-profit-heading">Деньги</h2>
              <span className="admin-owner-tag">Видите только вы</span>
            </div>
            <ProfitReport summary={report.profit} />
          </section>

          <section className="admin-card" aria-labelledby="dashboard-report-heading">
            <h2 id="dashboard-report-heading">Заявки и начисления отелям</h2>
            <SettlementReport summary={report.overall} />
            <h3>По отелям</h3>
            <OwnerPayouts hotels={report.byHotel} />
            <p className="admin-hint">
              Начисляются только выполненные заявки, по ставке, зафиксированной в момент расчёта.
              Суммы в разных валютах не складываются.
            </p>
          </section>
        </>
      ) : null}
    </main>
  );
}
