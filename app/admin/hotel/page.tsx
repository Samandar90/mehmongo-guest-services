'use client';

import { useEffect, useState } from 'react';
import { SettlementReport } from '@/components/admin/settlement-report';
import { getAdminIdentity } from '@/lib/admin/auth';
import { getSettlementSummary, summariseRows, type SettlementSummary } from '@/lib/admin/summary';

type State =
  | { status: 'loading' }
  | { status: 'ready'; summary: SettlementSummary }
  | { status: 'error' };

/**
 * The hotel's own cabinet: its requests and what it has earned. Every row it
 * can see is already limited to its own hotel by row level security, so the
 * hotel id here only narrows the owner's view, never widens a hotel's.
 */
export default function HotelCabinetPage() {
  const [period, setPeriod] = useState<{ dateFrom: string; dateTo: string }>({ dateFrom: '', dateTo: '' });
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [identity, rows] = await Promise.all([
          getAdminIdentity(),
          getSettlementSummary({
            dateFrom: period.dateFrom || undefined,
            dateTo: period.dateTo || undefined,
          }),
        ]);
        if (cancelled) return;
        const hotelId = identity && identity.role === 'hotel' ? identity.hotelId : undefined;
        setState({ status: 'ready', summary: summariseRows(rows, hotelId) });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [period.dateFrom, period.dateTo, attempt]);

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <h1>Кабинет отеля</h1>
        <p>Заявки ваших гостей и начисления по ним.</p>
      </header>

      <form className="admin-filters" aria-label="Период" onSubmit={(event) => event.preventDefault()}>
        <div className="admin-field">
          <label htmlFor="cabinet-from">С даты</label>
          <input
            id="cabinet-from"
            type="date"
            value={period.dateFrom}
            onChange={(event) => setPeriod((current) => ({ ...current, dateFrom: event.target.value }))}
          />
        </div>
        <div className="admin-field">
          <label htmlFor="cabinet-to">По дату</label>
          <input
            id="cabinet-to"
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

      {state.status === 'loading' ? <p className="admin-empty" aria-live="polite">Загрузка…</p> : null}

      {state.status === 'error' ? (
        <div role="alert" className="admin-form-error">
          <p>Не удалось загрузить данные кабинета.</p>
          <button
            type="button"
            className="admin-button admin-button-secondary"
            onClick={() => setAttempt((current) => current + 1)}
          >
            Повторить
          </button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <section className="admin-card" aria-labelledby="cabinet-report-heading">
          <h2 id="cabinet-report-heading">Итоги периода</h2>
          <SettlementReport summary={state.summary} />
          <p className="admin-hint">
            Начисления считаются по ставке, зафиксированной в момент расчёта заявки.
          </p>
        </section>
      ) : null}
    </main>
  );
}
