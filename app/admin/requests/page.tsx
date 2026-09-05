'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequestFilterBar, RequestTable } from '@/components/admin/request-table';
import { listHotels, type Hotel } from '@/lib/admin/hotels';
import { listRequests, requestPageSize, type AdminRequestRow, type RequestFilters } from '@/lib/admin/requests';
import { listRooms, type Room } from '@/lib/admin/rooms';

type RequestsState = {
  status: 'loading' | 'ready' | 'error';
  items: AdminRequestRow[];
  hasMore: boolean;
};

export default function AdminRequestsPage() {
  const [filters, setFilters] = useState<RequestFilters>({});
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [state, setState] = useState<RequestsState>({ status: 'loading', items: [], hasMore: false });
  const [hotels, setHotels] = useState<Hotel[]>([]);
  // Rooms are keyed by hotel so the room filter never offers the previous hotel's rooms.
  const [roomsFor, setRoomsFor] = useState<{ hotelId: string; rooms: Room[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const page = await listRequests(filters);
        if (!cancelled) setState({ status: 'ready', items: page.items, hasMore: page.hasMore });
      } catch {
        if (!cancelled) setState((current) => ({ ...current, status: 'error' }));
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [filters, loadAttempt]);

  // Filter options are best-effort: a failed lookup leaves the select empty but never blocks the list.
  useEffect(() => {
    let cancelled = false;
    listHotels().then((loaded) => { if (!cancelled) setHotels(loaded); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const hotelId = filters.hotelId;
  useEffect(() => {
    if (!hotelId) return;
    let cancelled = false;
    listRooms(hotelId)
      .then((loaded) => { if (!cancelled) setRoomsFor({ hotelId, rooms: loaded }); })
      .catch(() => { if (!cancelled) setRoomsFor({ hotelId, rooms: [] }); });
    return () => { cancelled = true; };
  }, [hotelId]);
  const rooms = hotelId ? (roomsFor?.hotelId === hotelId ? roomsFor.rooms : null) : [];

  const changeFilters = useCallback((next: RequestFilters) => {
    setState((current) => ({ ...current, status: 'loading' }));
    setFilters(next);
  }, []);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, status: 'loading' }));
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <h1>Заявки</h1>
        <p>Заявки гостей и состояние доставки в Telegram.</p>
      </header>

      <section className="admin-card" aria-labelledby="request-filters-heading">
        <h2 id="request-filters-heading">Фильтры</h2>
        <RequestFilterBar filters={filters} hotels={hotels} rooms={rooms} onChange={changeFilters} />
      </section>

      <section className="admin-card" aria-labelledby="request-list-heading">
        <h2 id="request-list-heading">Список заявок</h2>
        {state.status === 'error' ? (
          <div role="alert" className="admin-form-error">
            <p>Не удалось загрузить заявки.</p>
            <button type="button" className="admin-button admin-button-secondary" onClick={reload}>Повторить</button>
          </div>
        ) : null}
        {/* Always mounted so screen readers get the loading announcement when the text appears. */}
        <p className="admin-empty admin-live" aria-live="polite">{state.status === 'loading' ? 'Загрузка заявок…' : ''}</p>
        {state.hasMore ? (
          <p className="admin-hint">Показаны первые {requestPageSize} заявок. Сузьте фильтры, чтобы увидеть остальные.</p>
        ) : null}
        {state.status === 'ready' || state.items.length > 0 ? (
          <RequestTable key={`${JSON.stringify(filters)}-${loadAttempt}`} rows={state.items} />
        ) : null}
      </section>
    </main>
  );
}
