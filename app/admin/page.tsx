'use client';

import { useCallback, useEffect, useState } from 'react';
import { DashboardCards } from '@/components/admin/dashboard-cards';
import { getDashboardMetrics, type DashboardMetrics } from '@/lib/admin/requests';

type MetricsState =
  | { status: 'loading'; metrics: DashboardMetrics | null }
  | { status: 'ready'; metrics: DashboardMetrics }
  | { status: 'error'; metrics: DashboardMetrics | null };

export default function AdminDashboardPage() {
  const [state, setState] = useState<MetricsState>({ status: 'loading', metrics: null });
  const [loadAttempt, setLoadAttempt] = useState(0);

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

      <DashboardCards metrics={state.metrics} />
    </main>
  );
}
