'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AttentionPanel } from '@/components/admin/attention-panel';
import { DashboardCards } from '@/components/admin/dashboard-cards';
import { OwnerPayouts } from '@/components/admin/owner-payouts';
import { ProfitReport } from '@/components/admin/profit-report';
import { RequestTimeline } from '@/components/admin/request-timeline';
import { SettlementReport } from '@/components/admin/settlement-report';
import { listHotels } from '@/lib/admin/hotels';
import {
  buildTimeline,
  getOwnerAttention,
  getRequestTimeline,
  type OwnerAttention,
  type TimelineBucket,
} from '@/lib/admin/insights';
import {
  formatDay,
  isReversedPeriod,
  periodPresets,
  previousPeriod,
  type DateBasis,
  type Period,
} from '@/lib/admin/period';
import { getProfitSummary, summariseProfit, type ProfitSummary } from '@/lib/admin/profit';
import { getDashboardMetrics, requestsHref, type DashboardMetrics } from '@/lib/admin/requests';
import {
  getSettlementSummary,
  summariseByHotel,
  summariseRows,
  type HotelSettlement,
  type SettlementSummary,
} from '@/lib/admin/summary';
import { tashkentDate } from '@/lib/guest-request';

type MetricsState =
  | { status: 'loading'; metrics: DashboardMetrics | null }
  | { status: 'ready'; metrics: DashboardMetrics }
  | { status: 'error'; metrics: DashboardMetrics | null };

type ReportData = {
  overall: SettlementSummary;
  byHotel: HotelSettlement[];
  profit: ProfitSummary;
  timeline: TimelineBucket[];
  /** The same figures for the stretch before; null when the period has no "before". */
  previous: { overall: SettlementSummary; profit: ProfitSummary } | null;
};

/** Which query it answers, so figures from the last period are never read as this one's. */
type ReportState =
  | { status: 'loading' }
  | { status: 'ready'; query: string; data: ReportData }
  | { status: 'error'; query: string };

type AttentionState = { status: 'loading' } | { status: 'ready'; attention: OwnerAttention } | { status: 'error' };

const basisOptions: { value: DateBasis; label: string }[] = [
  { value: 'created', label: 'По дате заявки' },
  { value: 'settled', label: 'По дате выполнения' },
];

export default function AdminDashboardPage() {
  const [state, setState] = useState<MetricsState>({ status: 'loading', metrics: null });
  const [attention, setAttention] = useState<AttentionState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const presets = useMemo(() => periodPresets(), []);
  const [period, setPeriod] = useState<Period>(() => presets.find((p) => p.label === 'Этот месяц')!.value);
  const [basis, setBasis] = useState<DateBasis>('created');
  const [report, setReport] = useState<ReportState>({ status: 'loading' });

  const reversed = isReversedPeriod(period);
  const compareWith = useMemo(() => previousPeriod(period), [period]);
  const query = `${period.dateFrom}|${period.dateTo}|${basis}|${loadAttempt}`;

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

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const loaded = await getOwnerAttention();
        if (!cancelled) setAttention({ status: 'ready', attention: loaded });
      } catch {
        if (!cancelled) setAttention({ status: 'error' });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [loadAttempt]);

  // Totals are their own load: a slow aggregate must not hold up the counters,
  // and changing the period must not re-fetch them. A reversed period asks
  // nothing: it would answer with honest zeroes that read as a quiet month.
  useEffect(() => {
    if (reversed) return undefined;
    let cancelled = false;
    const run = async () => {
      try {
        const window = { dateFrom: period.dateFrom || undefined, dateTo: period.dateTo || undefined, basis };
        const before = compareWith ? { ...compareWith, basis } : null;
        const [rows, hotels, profit, timeline, previousRows, previousProfit] = await Promise.all([
          getSettlementSummary(window),
          listHotels(),
          getProfitSummary(window),
          getRequestTimeline(window),
          before ? getSettlementSummary(before) : null,
          before ? getProfitSummary(before) : null,
        ]);
        if (cancelled) return;
        setReport({
          status: 'ready',
          query,
          data: {
            overall: summariseRows(rows),
            byHotel: summariseByHotel(rows, hotels),
            profit: summariseProfit(profit),
            timeline: buildTimeline(timeline, period, tashkentDate()),
            previous: previousRows && previousProfit
              ? { overall: summariseRows(previousRows), profit: summariseProfit(previousProfit) }
              : null,
          },
        });
      } catch {
        if (!cancelled) setReport({ status: 'error', query });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [basis, compareWith, period, query, reversed]);

  const reload = useCallback(() => {
    setState((current) => ({ status: 'loading', metrics: current.metrics }));
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  const activePreset = presets.find((p) => p.value.dateFrom === period.dateFrom && p.value.dateTo === period.dateTo);
  // Derived rather than set from the effect: new figures replace the old ones
  // only when they arrive, and until then the old ones are visibly not current.
  const refreshing = !reversed && report.status !== 'loading' && report.query !== query;
  const reportData = report.status === 'ready' ? report.data : null;

  const hotelHref = (hotelId: string) => requestsHref({
    hotelId,
    dateFrom: period.dateFrom || undefined,
    dateTo: period.dateTo || undefined,
    dateBasis: basis === 'settled' ? 'settled' : undefined,
  });

  return (
    <main className="admin-page">
      {/* The period belongs beside the title, not in a card of its own: it is a
          control for everything below, and as a card it pushed the figures
          another screenful down. */}
      <header className="admin-page-header admin-head-row">
        <div>
          <h1>Обзор</h1>
          <p>Текущее состояние MehmonGo.</p>
        </div>
        <div className="admin-period">
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
          <form className="admin-period-dates" aria-label="Период итогов" onSubmit={(event) => event.preventDefault()}>
            <div className="admin-field">
              <label htmlFor="report-from">С даты</label>
              <input
                id="report-from"
                type="date"
                value={period.dateFrom}
                aria-invalid={reversed || undefined}
                onChange={(event) => setPeriod((current) => ({ ...current, dateFrom: event.target.value }))}
              />
            </div>
            <div className="admin-field">
              <label htmlFor="report-to">По дату</label>
              <input
                id="report-to"
                type="date"
                value={period.dateTo}
                aria-invalid={reversed || undefined}
                onChange={(event) => setPeriod((current) => ({ ...current, dateTo: event.target.value }))}
              />
            </div>
          </form>
          <div className="admin-period-basis">
            <fieldset className="admin-segmented">
              <legend className="admin-sr-only">По какой дате считать период</legend>
              {basisOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={basis === option.value}
                  onClick={() => setBasis(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>
            {compareWith ? (
              <p className="admin-hint">Сравнение с {formatDay(compareWith.dateFrom)} – {formatDay(compareWith.dateTo)}</p>
            ) : null}
          </div>
        </div>
      </header>

      {reversed ? (
        <p role="alert" className="admin-note-warn">Дата начала позже даты конца. Исправьте период, чтобы обновить итоги.</p>
      ) : null}

      {state.status === 'error' ? (
        <div role="alert" className="admin-form-error">
          <p>Не удалось загрузить показатели.</p>
          <button type="button" className="admin-button admin-button-secondary" onClick={reload}>Повторить</button>
        </div>
      ) : null}

      {/* Always mounted so screen readers get the loading announcement when the text appears. */}
      <p className="admin-empty admin-live" aria-live="polite">{state.status === 'loading' ? 'Загрузка показателей…' : ''}</p>

      <DashboardCards metrics={state.metrics} busy={state.status === 'loading'} />

      {attention.status === 'ready' ? <AttentionPanel attention={attention.attention} /> : null}
      {attention.status === 'error' ? (
        <p role="alert" className="admin-note-warn">Не удалось проверить, что требует внимания. Это не значит, что проблем нет.</p>
      ) : null}

      {report.status === 'loading' ? <p className="admin-empty" aria-live="polite">Загрузка итогов…</p> : null}

      {report.status === 'error' && !refreshing ? (
        <div role="alert" className="admin-form-error">
          <p>Не удалось загрузить итоги.</p>
          <button type="button" className="admin-button admin-button-secondary" onClick={reload}>Повторить</button>
        </div>
      ) : null}

      {reportData ? (
        <div className="admin-report-area" aria-busy={refreshing || reversed || undefined} data-stale={refreshing || reversed || undefined}>
          <section className="admin-card" aria-labelledby="dashboard-timeline-heading">
            <h2 id="dashboard-timeline-heading">Заявки по дням</h2>
            {reportData.timeline.length > 0
              ? <RequestTimeline buckets={reportData.timeline} basis={basis} />
              : <p className="admin-empty">За выбранный период заявок не было.</p>}
          </section>

          <div className="admin-columns">
            <section className="admin-card admin-card-owner" aria-labelledby="dashboard-profit-heading">
              <div className="admin-card-head">
                <h2 id="dashboard-profit-heading">Деньги</h2>
                <span className="admin-owner-tag">Видите только вы</span>
              </div>
              <ProfitReport summary={reportData.profit} previous={reportData.previous?.profit ?? null} />
            </section>

            <section className="admin-card" aria-labelledby="dashboard-report-heading">
              <h2 id="dashboard-report-heading">Заявки и начисления отелям</h2>
              <SettlementReport summary={reportData.overall} previous={reportData.previous?.overall ?? null} />
            </section>
          </div>

          <section className="admin-card" aria-labelledby="dashboard-hotels-heading">
            <h2 id="dashboard-hotels-heading">По отелям</h2>
            <OwnerPayouts hotels={reportData.byHotel} hrefFor={hotelHref} />
            <p className="admin-hint">
              Начисляются только выполненные заявки, по ставке, зафиксированной в момент расчёта.
              Суммы в разных валютах не складываются.
              {basis === 'created'
                ? ' Выплата отелю за месяц считается по дате выполнения: для сверки выплат переключите период на неё.'
                : ' Заявки в работе и отменённые считаются по дате заявки: даты выполнения у них нет.'}
            </p>
          </section>
        </div>
      ) : null}
    </main>
  );
}
