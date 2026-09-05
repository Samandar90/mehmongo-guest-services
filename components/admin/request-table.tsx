'use client';

import { Fragment, useState } from 'react';
import {
  retryTelegram as retryTelegramDefault,
  type AdminRequestRow,
  type RequestFilters,
  type RetryResult,
  type TelegramStatus,
} from '@/lib/admin/requests';
import type { Hotel } from '@/lib/admin/hotels';
import type { Room } from '@/lib/admin/rooms';
import type { ServiceId } from '@/supabase/functions/_shared/contracts';

export const serviceLabels: Record<ServiceId, string> = {
  tours: 'Туры',
  transport: 'Транспорт',
  restaurants: 'Рестораны',
  tickets: 'Билеты',
};

const requestStatusLabels = { new: 'Новая' } as const;

const telegramLabels: Record<TelegramStatus | 'none', string> = {
  sent: 'Отправлено',
  failed: 'Ошибка Telegram',
  pending: 'В очереди',
  none: 'Нет доставки',
};

const retryMessages = {
  forbidden: 'Нет прав на повторную отправку. Войдите заново.',
  missing: 'Заявка не найдена. Обновите список.',
  failed: 'Не удалось выполнить повтор. Повторите попытку.',
};

/** Shows at most the first and last four characters, and only when at least four stay hidden. */
export function maskContact(contact: string): string {
  const compact = contact.trim();
  if (compact.length < 12) return `${compact.slice(0, 1)}…`;
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent',
  }).format(date);
}

function formatRequestedAt(row: AdminRequestRow): string {
  if (!row.requestedDate) return '—';
  const [year, month, day] = row.requestedDate.split('-');
  const date = `${day}.${month}.${year}`;
  return row.requestedTime ? `${date}, ${row.requestedTime}` : date;
}

function describeWhat(row: AdminRequestRow): string {
  if (row.serviceType === 'transport') return row.pickup || row.destination ? `${row.pickup} → ${row.destination}` : '—';
  return row.choice || '—';
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code as string | undefined : undefined;
}

type RequestTableProps = {
  rows: AdminRequestRow[];
  retryTelegram?: (requestId: string) => Promise<RetryResult>;
};

export function RequestTable({ rows, retryTelegram = retryTelegramDefault }: RequestTableProps) {
  const [overrides, setOverrides] = useState<Record<string, TelegramStatus>>({});
  const [retrying, setRetrying] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="admin-empty">Заявок не найдено</p>;
  }

  const retry = async (row: AdminRequestRow) => {
    setRetrying((current) => [...current, row.id]);
    setNotice(null);
    setError(null);
    try {
      const result = await retryTelegram(row.id);
      setOverrides((current) => ({ ...current, [row.id]: result.status }));
      if (result.status === 'sent') {
        setNotice(`${row.reference}: сообщение отправлено в Telegram`);
      } else if (result.status === 'pending') {
        setNotice(result.reason === 'already_pending'
          ? `${row.reference}: доставка уже выполняется, обновите список позже`
          : `${row.reference}: доставка поставлена в очередь, обновите список позже`);
      } else {
        setError(`${row.reference}: Telegram снова не принял сообщение. Повторите попытку позже.`);
      }
    } catch (caught) {
      const code = errorCode(caught);
      setError(`${row.reference}: ${
        code === 'FORBIDDEN' || code === 'UNAUTHORIZED'
          ? retryMessages.forbidden
          : code === 'REQUEST_NOT_FOUND'
            ? retryMessages.missing
            : retryMessages.failed
      }`);
    } finally {
      setRetrying((current) => current.filter((id) => id !== row.id));
    }
  };

  return (
    <div className="admin-table-wrap">
      {error ? <p role="alert" className="admin-form-error">{error}</p> : null}
      {notice ? <output className="admin-form-success">{notice}</output> : null}
      <table className="admin-table admin-requests">
        <thead>
          <tr>
            <th scope="col">Заявка</th>
            <th scope="col">Отель / комната</th>
            <th scope="col">Категория</th>
            <th scope="col">Гость</th>
            <th scope="col">Telegram</th>
            <th scope="col">Действия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const override = overrides[row.id];
            const telegramStatus = override ?? row.telegramStatus;
            const inFlight = retrying.includes(row.id);
            const expanded = expandedId === row.id;
            const detailsId = `request-details-${row.id}`;
            return (
              <Fragment key={row.id}>
                <tr>
                  <td data-label="Заявка">
                    <strong>{row.reference}</strong>
                    <small>{formatDateTime(row.createdAt)}</small>
                  </td>
                  <td data-label="Отель / комната">
                    <span>{row.hotelName}</span>
                    <small>Комната <span>{row.roomLabel}</span></small>
                  </td>
                  <td data-label="Категория">
                    <span>{serviceLabels[row.serviceType]}</span>
                    <small>{row.offerTitle ?? requestStatusLabels[row.status]}</small>
                  </td>
                  <td data-label="Гость">
                    <span>{row.guestName}</span>
                    <small>{maskContact(row.contact)}</small>
                  </td>
                  <td data-label="Telegram">
                    <span className={`admin-badge admin-badge-${telegramStatus}`}>{telegramLabels[telegramStatus]}</span>
                  </td>
                  <td data-label="Действия" className="admin-actions">
                    <button
                      type="button"
                      className="admin-button admin-button-secondary"
                      aria-expanded={expanded}
                      aria-controls={expanded ? detailsId : undefined}
                      aria-label={`${expanded ? 'Скрыть' : 'Подробнее'} ${row.reference}`}
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                    >
                      {expanded ? 'Скрыть' : 'Подробнее'}
                    </button>
                    {telegramStatus === 'failed' ? (
                      inFlight ? (
                        <button type="button" className="admin-button admin-button-secondary" disabled>Отправка…</button>
                      ) : (
                        <button type="button" className="admin-button" onClick={() => { void retry(row); }}>
                          Повторить Telegram
                        </button>
                      )
                    ) : null}
                  </td>
                </tr>
                {expanded ? (
                  <tr className="admin-request-details-row">
                    <td colSpan={6}>
                      <section id={detailsId} className="admin-request-details" aria-label={`Детали заявки ${row.reference}`}>
                        <dl>
                          <div><dt>Что</dt><dd>{describeWhat(row)}</dd></div>
                          <div><dt>Когда</dt><dd>{formatRequestedAt(row)}</dd></div>
                          <div><dt>Гостей</dt><dd>{row.partySize ?? '—'}</dd></div>
                          <div><dt>Контакт</dt><dd>{row.contact}</dd></div>
                          <div><dt>Комментарий</dt><dd>{row.note || '—'}</dd></div>
                          {row.offerTitle ? (
                            <div>
                              <dt>Предложение</dt>
                              <dd>{row.offerTitle}</dd>
                            </div>
                          ) : null}
                          {row.offerEstimate ? (
                            <div>
                              <dt>Ориентировочная цена</dt>
                              <dd>
                                {row.offerEstimate}
                                <small className="admin-hint"> Не подтверждённая сумма и не выручка.</small>
                              </dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>Telegram</dt>
                            <dd>
                              {override
                                ? `${telegramLabels[override]} после повтора`
                                : row.telegramErrorCode
                                  ? `${row.telegramErrorCode} (попытка ${row.telegramAttempt})`
                                  : row.telegramAttempt > 0 ? `попытка ${row.telegramAttempt}` : '—'}
                            </dd>
                          </div>
                        </dl>
                      </section>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type RequestFilterBarProps = {
  filters: RequestFilters;
  hotels: Hotel[];
  /** Rooms of the currently selected hotel; pass null while they are still loading. */
  rooms: Room[] | null;
  onChange: (filters: RequestFilters) => void;
  disabled?: boolean;
};

function withoutEmpty(filters: RequestFilters): RequestFilters {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) as RequestFilters;
}

export function RequestFilterBar({ filters, hotels, rooms, onChange, disabled = false }: RequestFilterBarProps) {
  const update = (patch: Partial<RequestFilters>) => onChange(withoutEmpty({ ...filters, ...patch }));

  return (
    <form className="admin-filters" onSubmit={(event) => event.preventDefault()} aria-label="Фильтры заявок">
      <div className="admin-field">
        <label htmlFor="filter-hotel">Отель</label>
        <select
          id="filter-hotel"
          value={filters.hotelId ?? ''}
          disabled={disabled}
          onChange={(event) => update({ hotelId: event.target.value || undefined, roomId: undefined })}
        >
          <option value="">Все отели</option>
          {hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}
        </select>
      </div>
      <div className="admin-field">
        <label htmlFor="filter-room">Комната</label>
        <select
          id="filter-room"
          value={filters.roomId ?? ''}
          disabled={disabled || !filters.hotelId || rooms === null}
          onChange={(event) => update({ roomId: event.target.value || undefined })}
        >
          <option value="">Все комнаты</option>
          {(rooms ?? []).map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}
        </select>
      </div>
      <div className="admin-field">
        <label htmlFor="filter-service">Категория</label>
        <select
          id="filter-service"
          value={filters.serviceType ?? ''}
          disabled={disabled}
          onChange={(event) => update({ serviceType: (event.target.value || undefined) as ServiceId | undefined })}
        >
          <option value="">Все категории</option>
          {(Object.keys(serviceLabels) as ServiceId[]).map((service) => (
            <option key={service} value={service}>{serviceLabels[service]}</option>
          ))}
        </select>
      </div>
      <div className="admin-field">
        <label htmlFor="filter-status">Статус</label>
        <select
          id="filter-status"
          value={filters.status ?? ''}
          disabled={disabled}
          onChange={(event) => update({ status: (event.target.value || undefined) as RequestFilters['status'] })}
        >
          <option value="">Все статусы</option>
          <option value="new">{requestStatusLabels.new}</option>
        </select>
      </div>
      <div className="admin-field">
        <label htmlFor="filter-from">С даты</label>
        <input
          id="filter-from"
          type="date"
          value={filters.dateFrom ?? ''}
          disabled={disabled}
          onChange={(event) => update({ dateFrom: event.target.value || undefined })}
        />
      </div>
      <div className="admin-field">
        <label htmlFor="filter-to">По дату</label>
        <input
          id="filter-to"
          type="date"
          value={filters.dateTo ?? ''}
          disabled={disabled}
          onChange={(event) => update({ dateTo: event.target.value || undefined })}
        />
      </div>
      <button type="button" className="admin-button admin-button-secondary" disabled={disabled} onClick={() => onChange({})}>
        Сбросить фильтры
      </button>
    </form>
  );
}
