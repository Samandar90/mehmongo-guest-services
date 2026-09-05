'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatCommissionPercent, setHotelActive as setHotelActiveDefault, type Hotel } from '@/lib/admin/hotels';

type HotelListProps = {
  hotels: Hotel[];
  setHotelActive?: (id: string, active: boolean) => Promise<unknown>;
  reload?: () => void | Promise<void>;
};

const statusErrorMessage = 'Не удалось изменить статус отеля. Повторите попытку.';

export function HotelList({ hotels, setHotelActive = setHotelActiveDefault, reload }: HotelListProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (hotels.length === 0) {
    return <p className="admin-empty">Отелей пока нет</p>;
  }

  const changeStatus = async (hotel: Hotel, active: boolean) => {
    setConfirmingId(null);
    setPendingId(hotel.id);
    setError(null);
    setNotice(null);
    let changed = false;
    try {
      await setHotelActive(hotel.id, active);
      changed = true;
    } catch {
      setError(statusErrorMessage);
    } finally {
      setPendingId(null);
    }
    if (!changed) return;

    setNotice(`Отель ${hotel.name} ${active ? 'включён' : 'отключён'}`);
    // The status change already succeeded; a failed refresh must not read as a failed mutation.
    try {
      await reload?.();
    } catch {
      // The list simply shows the pre-refresh rows until the next successful load.
    }
  };

  return (
    <div className="admin-table-wrap">
      {error ? <p role="alert" className="admin-form-error">{error}</p> : null}
      {notice ? <output className="admin-form-success">{notice}</output> : null}
      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">Отель</th>
            <th scope="col">Slug</th>
            <th scope="col">Процент</th>
            <th scope="col">Статус</th>
            <th scope="col">Действия</th>
          </tr>
        </thead>
        <tbody>
          {hotels.map((hotel) => {
            const pending = pendingId === hotel.id;
            const confirming = confirmingId === hotel.id;
            return (
              <tr key={hotel.id} data-active={hotel.active}>
                <td data-label="Отель">
                  <strong>{hotel.name}</strong>
                  {hotel.address ? <small>{hotel.address}</small> : null}
                </td>
                <td data-label="Slug"><code>{hotel.slug}</code></td>
                <td data-label="Процент">{formatCommissionPercent(hotel.commissionBps)}%</td>
                <td data-label="Статус">
                  <span className={hotel.active ? 'admin-badge admin-badge-active' : 'admin-badge admin-badge-inactive'}>
                    {hotel.active ? 'Активен' : 'Отключён'}
                  </span>
                </td>
                <td data-label="Действия" className="admin-actions">
                  <Link href={`/admin/hotels/${hotel.id}`} aria-label={`Открыть ${hotel.name}`} className="admin-button admin-button-secondary">
                    Открыть
                  </Link>
                  {pending ? (
                    <button type="button" className="admin-button admin-button-secondary" disabled>Сохранение…</button>
                  ) : confirming ? (
                    <span className="admin-confirm">
                      <button type="button" className="admin-button admin-button-danger" onClick={() => changeStatus(hotel, false)}>
                        Подтвердить отключение
                      </button>
                      <button type="button" className="admin-button admin-button-secondary" onClick={() => setConfirmingId(null)}>
                        Отмена
                      </button>
                    </span>
                  ) : hotel.active ? (
                    <button
                      type="button"
                      className="admin-button admin-button-secondary"
                      aria-label={`Отключить ${hotel.name}`}
                      onClick={() => { setError(null); setConfirmingId(hotel.id); }}
                    >
                      Отключить
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="admin-button admin-button-secondary"
                      aria-label={`Включить ${hotel.name}`}
                      onClick={() => changeStatus(hotel, true)}
                    >
                      Включить
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
