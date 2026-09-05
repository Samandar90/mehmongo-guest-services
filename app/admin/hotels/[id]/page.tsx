'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { HotelForm } from '@/components/admin/hotel-form';
import { RoomEditor } from '@/components/admin/room-editor';
import { getHotel, type Hotel } from '@/lib/admin/hotels';
import { listRooms, type Room } from '@/lib/admin/rooms';
import { getPublicSiteUrl } from '@/lib/site-url';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; hotel: Hotel }
  | { status: 'missing' }
  | { status: 'error' };

type RoomsState = { status: 'loading' | 'ready' | 'error'; rooms: Room[] };

function resolveSiteUrl(): string | null {
  try {
    return getPublicSiteUrl();
  } catch {
    return null;
  }
}

export default function AdminHotelPage() {
  const params = useParams<{ id: string }>();
  const hotelId = params?.id ?? '';
  const [loadState, setState] = useState<LoadState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const state: LoadState = hotelId ? loadState : { status: 'missing' };

  useEffect(() => {
    if (!hotelId) return;
    let cancelled = false;
    const run = async () => {
      try {
        const hotel = await getHotel(hotelId);
        if (!cancelled) setState(hotel ? { status: 'ready', hotel } : { status: 'missing' });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [hotelId, loadAttempt]);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  // Rooms load and refresh independently so the hotel form and editor state survive a room mutation.
  const [roomsState, setRoomsState] = useState<RoomsState>({ status: 'loading', rooms: [] });
  const [roomsAttempt, setRoomsAttempt] = useState(0);
  const [siteUrl] = useState(resolveSiteUrl);

  useEffect(() => {
    if (!hotelId) return;
    let cancelled = false;
    const run = async () => {
      try {
        const rooms = await listRooms(hotelId);
        if (!cancelled) setRoomsState({ status: 'ready', rooms });
      } catch {
        if (!cancelled) setRoomsState((current) => ({ status: 'error', rooms: current.rooms }));
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [hotelId, roomsAttempt]);

  const reloadRooms = useCallback(() => {
    setRoomsState((current) => ({ status: 'loading', rooms: current.rooms }));
    setRoomsAttempt((attempt) => attempt + 1);
  }, []);

  return (
    <main className="admin-page">
      <Link href="/admin/hotels" className="admin-back">К списку отелей</Link>

      {state.status === 'loading' ? <p className="admin-empty" aria-live="polite">Загрузка отеля…</p> : null}
      {state.status === 'missing' ? <p className="admin-empty">Отель не найден</p> : null}
      {state.status === 'error' ? (
        <div role="alert" className="admin-form-error">
          <p>Не удалось загрузить отель.</p>
          <button type="button" className="admin-button admin-button-secondary" onClick={load}>Повторить</button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <header className="admin-page-header">
            <h1>{state.hotel.name}</h1>
            <p>
              <code>{state.hotel.slug}</code>
              {' · '}
              <span className={state.hotel.active ? 'admin-badge admin-badge-active' : 'admin-badge admin-badge-inactive'}>
                {state.hotel.active ? 'Активен' : 'Отключён'}
              </span>
            </p>
          </header>

          <section className="admin-card" aria-labelledby="hotel-edit-heading">
            <h2 id="hotel-edit-heading">Данные отеля</h2>
            <HotelForm
              key={state.hotel.id}
              hotel={state.hotel}
              onSaved={(hotel) => setState({ status: 'ready', hotel })}
            />
          </section>

          <section className="admin-card" aria-labelledby="hotel-rooms-heading">
            <h2 id="hotel-rooms-heading">Комнаты</h2>
            {roomsState.status === 'error' ? (
              <div role="alert" className="admin-form-error">
                <p>Не удалось загрузить комнаты.</p>
                <button type="button" className="admin-button admin-button-secondary" onClick={reloadRooms}>
                  Повторить загрузку комнат
                </button>
              </div>
            ) : null}
            {roomsState.status === 'loading' && roomsState.rooms.length === 0 ? (
              <p className="admin-empty" aria-live="polite">Загрузка комнат…</p>
            ) : null}
            {roomsState.status === 'ready' || roomsState.rooms.length > 0 ? (
              <RoomEditor
                hotelId={state.hotel.id}
                rooms={roomsState.rooms}
                reload={reloadRooms}
                siteUrl={siteUrl}
              />
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
