'use client';

import { useCallback, useEffect, useState } from 'react';
import { DashboardCards } from '@/components/admin/dashboard-cards';
import { OwnerPayouts } from '@/components/admin/owner-payouts';
import { SettlementReport } from '@/components/admin/settlement-report';
import { getDashboardMetrics, type DashboardMetrics } from '@/lib/admin/requests';
import { listHotels } from '@/lib/admin/hotels';
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
  | { status: 'ready'; overall: SettlementSummary; byHotel: HotelSettlement[] }
  | { status: 'error' };

export default function AdminDashboardPage() {
  const [state, setState] = useState<MetricsState>({ status: 'loading', metrics: null });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [period, setPeriod] = useState<{ dateFrom: string; dateTo: string }>({ dateFrom: '', dateTo: '' });
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
        const [rows, hotels] = await Promise.all([
          getSettlementSummary({ dateFrom: period.dateFrom || undefined, dateTo: period.dateTo || undefined }),
          listHotels(),
        ]);
        if (cancelled) return;
        setReport({
          status: 'ready',
          overall: summariseRows(rows),
          byHotel: summariseByHotel(rows, hotels),
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

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <h1>Обзор</h1>
        <p>Текущее состояние пилота MehmonGo.</p>
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

      <section className="admin-card" aria-labelledby="dashboard-report-heading">
        <h2 id="dashboard-report-heading">Итоги и начисления</h2>

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
          <button
            type="button"
            className="admin-button admin-button-secondary"
            onClick={() => setPeriod({ dateFrom: '', dateTo: '' })}
          >
            Весь период
          </button>
        </form>

        {report.status === 'loading' ? <p className="admin-empty" aria-live="polite">Загрузка итогов…</p> : null}

        {report.status === 'error' ? (
          <div role="alert" className="admin-form-error">
            <p>Не удалось загрузить итоги.</p>
            <button type="button" className="admin-button admin-button-secondary" onClick={reload}>Повторить</button>
          </div>
        ) : null}

        {report.status === 'ready' ? (
          <>
            <SettlementReport summary={report.overall} />
            <h3>По отелям</h3>
            <OwnerPayouts hotels={report.byHotel} />
            <p className="admin-hint">
              Начисления считаются по ставке, зафиксированной в момент расчёта каждой заявки.
              Суммы в разных валютах не складываются.
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
