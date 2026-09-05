'use client';

import { useCallback, useEffect, useState } from 'react';
import { HotelForm } from '@/components/admin/hotel-form';
import { HotelList } from '@/components/admin/hotel-list';
import { listHotels, type Hotel } from '@/lib/admin/hotels';

type LoadState =
  | { status: 'loading'; hotels: Hotel[] }
  | { status: 'ready'; hotels: Hotel[] }
  | { status: 'error'; hotels: Hotel[] };

export default function AdminHotelsPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading', hotels: [] });

  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const hotels = await listHotels();
        if (!cancelled) setState({ status: 'ready', hotels });
      } catch {
        if (!cancelled) setState((current) => ({ status: 'error', hotels: current.hotels }));
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [loadAttempt]);

  const load = useCallback(() => {
    setState((current) => ({ status: 'loading', hotels: current.hotels }));
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <h1>Отели</h1>
        <p>Партнёрские отели, их процент и статус.</p>
      </header>

      <section className="admin-card" aria-labelledby="create-hotel-heading">
        <h2 id="create-hotel-heading">Новый отель</h2>
        <HotelForm onSaved={load} />
      </section>

      <section className="admin-card" aria-labelledby="hotel-list-heading">
        <h2 id="hotel-list-heading">Список отелей</h2>
        {state.status === 'error' ? (
          <div role="alert" className="admin-form-error">
            <p>Не удалось загрузить отели.</p>
            <button type="button" className="admin-button admin-button-secondary" onClick={load}>Повторить</button>
          </div>
        ) : null}
        {state.status === 'loading' && state.hotels.length === 0 ? (
          <p className="admin-empty" aria-live="polite">Загрузка отелей…</p>
        ) : null}
        {state.status === 'ready' || state.hotels.length > 0 ? (
          <HotelList hotels={state.hotels} reload={load} />
        ) : null}
      </section>
    </main>
  );
}
