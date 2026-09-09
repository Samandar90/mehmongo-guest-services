'use client';

import { Fragment, useState } from 'react';
import {
  retryTelegram as retryTelegramDefault,
  settleRequest as settleRequestDefault,
  type AdminRequestRow,
  type RequestFilters,
  type RequestStatus,
  type RetryResult,
  type SettlementInput,
  type SettlementResult,
  type TelegramStatus,
} from '@/lib/admin/requests';
import {
  formatMinorAmount,
  formatMinorInput,
  parseSettledAmount,
  settlementCurrencies,
  type SettlementCurrency,
} from '@/lib/admin/money';
import type { Hotel } from '@/lib/admin/hotels';
import type { Room } from '@/lib/admin/rooms';
import type { GuestLocale, ServiceId } from '@/supabase/functions/_shared/contracts';

export const serviceLabels: Record<ServiceId, string> = {
  tours: 'Туры',
  transport: 'Транспорт',
  restaurants: 'Рестораны',
  tickets: 'Билеты',
};

/**
 * Typed rather than `as const`: with a bare literal, widening RequestStatus
 * left the compiler silent and the three new statuses rendered as undefined.
 * Feminine throughout, agreeing with «заявка».
 */
export const requestStatusLabels: Record<RequestStatus, string> = {
  new: 'Новая',
  confirmed: 'Подтверждена',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

/** The language the guest read the site in — the one to call them back in. */
export const guestLocaleLabels: Record<GuestLocale, string> = {
  en: 'английский',
  ru: 'русский',
  uz: 'узбекский',
  zh: 'китайский',
};

const settleMessages = {
  forbidden: 'Нет прав на изменение итога. Войдите заново.',
  missing: 'Заявка не найдена. Обновите список.',
  invalid: 'Проверьте сумму и валюту.',
  failed: 'Не удалось сохранить итог. Повторите попытку.',
};

/** The codes public.settle_request raises, in the owner's words. */
function settleErrorMessage(code: string | undefined): string {
  if (code === '42501') return settleMessages.forbidden;
  if (code === 'P0002') return settleMessages.missing;
  if (code === '22023' || code === '23514') return settleMessages.invalid;
  return settleMessages.failed;
}

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

/**
 * The amount is our turnover, and nothing else reads it: the hotel is paid a
 * fixed rate per request. Saying so under the field is worth more than the old
 * percentage preview, which invited the amount to be read as the hotel's base.
 */
function TurnoverHint() {
  return (
    <p className="admin-hint">
      Сумма — наша выручка. Отелю она не показывается и на его выплату не влияет:
      ставка фиксированная за заявку.
    </p>
  );
}

type RequestTableProps = {
  rows: AdminRequestRow[];
  retryTelegram?: (requestId: string) => Promise<RetryResult>;
  settleRequest?: (input: SettlementInput) => Promise<SettlementResult>;
};

/** What a row shows once it has been settled in this session, without a reload. */
type Settlement = SettlementResult;

function settledView(row: AdminRequestRow, settlement: Settlement | undefined) {
  const status = settlement?.status ?? row.status;
  const amount = settlement ? settlement.settledAmountMinor : row.settledAmountMinor;
  const currency = settlement ? settlement.settledCurrency : row.settledCurrency;
  const rateMinor = settlement ? settlement.hotelRateMinor : row.hotelRateMinor;
  const rateCurrency = settlement ? settlement.hotelRateCurrency : row.hotelRateCurrency;
  const costMinor = settlement ? settlement.costMinor : row.costMinor;
  return { status, amount, currency, rateMinor, rateCurrency, costMinor };
}

export function RequestTable({
  rows,
  retryTelegram = retryTelegramDefault,
  settleRequest = settleRequestDefault,
}: RequestTableProps) {
  const [overrides, setOverrides] = useState<Record<string, TelegramStatus>>({});
  const [retrying, setRetrying] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settlements, setSettlements] = useState<Record<string, Settlement>>({});
  const [settling, setSettling] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { status: RequestStatus; amount: string; currency: SettlementCurrency; cost: string }>>({});
  const [panelError, setPanelError] = useState<Record<string, string>>({});
  const [panelNotice, setPanelNotice] = useState<Record<string, string>>({});
  const [amountError, setAmountError] = useState<Record<string, string>>({});

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

  const draftFor = (row: AdminRequestRow) => {
    const view = settledView(row, settlements[row.id]);
    return drafts[row.id] ?? {
      status: view.status,
      amount: view.amount === null ? '' : formatMinorInput(view.amount, view.currency ?? 'UZS'),
      // Som by default: the payable amount is agreed in som, so the daily case costs no taps.
      currency: (view.currency === 'USD' ? 'USD' : 'UZS') as SettlementCurrency,
      cost: view.costMinor === null ? '' : formatMinorInput(view.costMinor, view.currency ?? 'UZS'),
    };
  };

  /**
   * Messages stay per row: the table's shared pair is cleared by every Telegram
   * retry, so sharing it would let a settlement wipe a retry message and back.
   */
  const settle = async (row: AdminRequestRow, input: SettlementInput) => {
    // Parsed here, not only in the repository: the owner sees a bad figure
    // named under the field itself, before anything reaches the network.
    if (input.status === 'completed') {
      try {
        parseSettledAmount(input.amount, input.currency);
      } catch (caught) {
        setAmountError((current) => ({ ...current, [row.id]: (caught as Error).message }));
        return;
      }
    }

    setSettling((current) => [...current, row.id]);
    setPanelError((current) => ({ ...current, [row.id]: '' }));
    setPanelNotice((current) => ({ ...current, [row.id]: '' }));
    setAmountError((current) => ({ ...current, [row.id]: '' }));
    try {
      const result = await settleRequest(input);
      setSettlements((current) => ({ ...current, [row.id]: result }));
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setPanelNotice((current) => ({ ...current, [row.id]: 'Итог сохранён' }));
    } catch (caught) {
      const code = errorCode(caught);
      if (code === 'VALIDATION_ERROR') {
        setAmountError((current) => ({ ...current, [row.id]: (caught as Error).message }));
        return;
      }
      // The one-tap confirmation is fired from the row, where no panel is open
      // to hold the answer; that failure belongs in the table's own message.
      // Everything derived from the rejection is read inside the updaters: the
      // react-compiler rule rejects a catch-scoped const captured by a closure,
      // and functional updates keep two rows settling at once independent.
      setPanelError((current) => (expandedId === row.id
        ? { ...current, [row.id]: settleErrorMessage(errorCode(caught)) }
        : current));
      setError((current) => (expandedId === row.id
        ? current
        : `${row.reference}: ${settleErrorMessage(errorCode(caught))}`));
    } finally {
      setSettling((current) => current.filter((id) => id !== row.id));
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
            <th scope="col">Статус</th>
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
            const view = settledView(row, settlements[row.id]);
            const draft = draftFor(row);
            const savingSettlement = settling.includes(row.id);
            const settledLabel = view.amount === null ? null : formatMinorAmount(view.amount, view.currency ?? 'UZS');
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
                    <small>{row.offerTitle ?? '—'}</small>
                  </td>
                  <td data-label="Гость">
                    <span>{row.guestName}</span>
                    <small>{maskContact(row.contact)}</small>
                    <small>{guestLocaleLabels[row.guestLocale]}</small>
                  </td>
                  <td data-label="Статус">
                    <span className={`admin-badge admin-status-${view.status}`}>{requestStatusLabels[view.status]}</span>
                    {settledLabel ? <small>{settledLabel}</small> : null}
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
                    {view.status === 'new' ? (
                      <button
                        type="button"
                        className="admin-button admin-button-secondary"
                        disabled={savingSettlement}
                        aria-label={`Подтвердить ${row.reference}`}
                        onClick={() => { void settle(row, { requestId: row.id, status: 'confirmed' }); }}
                      >
                        Подтвердить
                      </button>
                    ) : null}
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
                    <td colSpan={7}>
                      <section id={detailsId} className="admin-request-details" aria-label={`Детали заявки ${row.reference}`}>
                        <dl>
                          <div><dt>Что</dt><dd>{describeWhat(row)}</dd></div>
                          <div><dt>Когда</dt><dd>{formatRequestedAt(row)}</dd></div>
                          <div><dt>Гостей</dt><dd>{row.partySize ?? '—'}</dd></div>
                          <div><dt>Контакт</dt><dd>{row.contact}</dd></div>
                          <div><dt>Язык гостя</dt><dd>{guestLocaleLabels[row.guestLocale]}</dd></div>
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
                          {settledLabel ? (
                            <>
                              <div><dt>Итог</dt><dd>{settledLabel}</dd></div>
                              <div>
                                <dt>Закупка</dt>
                                <dd>
                                  {view.costMinor === null
                                    ? <span className="admin-hint">не записана</span>
                                    : formatMinorAmount(view.costMinor, view.currency ?? 'UZS')}
                                </dd>
                              </div>
                              <div>
                                <dt>Маржа</dt>
                                <dd>
                                  {view.costMinor === null || view.amount === null
                                    ? <span className="admin-hint">появится, когда впишете закупку</span>
                                    : <strong>{formatMinorAmount(view.amount - view.costMinor, view.currency ?? 'UZS')}</strong>}
                                </dd>
                              </div>
                              <div>
                                <dt>Ставка отелю</dt>
                                <dd>
                                  {view.rateMinor === null
                                    ? '—'
                                    : formatMinorAmount(view.rateMinor, view.rateCurrency ?? 'USD')}
                                  {view.rateMinor !== null ? (
                                    <small className="admin-hint"> Базовая ставка, зафиксирована при расчёте. Надбавка за объём начисляется по итогам месяца.</small>
                                  ) : null}
                                </dd>
                              </div>
                            </>
                          ) : null}
                        </dl>

                        <form
                          className="admin-form admin-settlement"
                          aria-label={`Итог заявки ${row.reference}`}
                          onSubmit={(event) => {
                            event.preventDefault();
                            void settle(row, draft.status === 'completed'
                              ? { requestId: row.id, status: 'completed', amount: draft.amount, currency: draft.currency, cost: draft.cost }
                              : { requestId: row.id, status: draft.status });
                          }}
                        >
                          <fieldset className="admin-mode">
                            <legend>Изменить итог</legend>
                            {(Object.keys(requestStatusLabels) as RequestStatus[]).map((status) => (
                              <label key={status} htmlFor={`settle-${status}-${row.id}`}>
                                <input
                                  id={`settle-${status}-${row.id}`}
                                  type="radio"
                                  name={`settle-status-${row.id}`}
                                  value={status}
                                  checked={draft.status === status}
                                  disabled={savingSettlement}
                                  onChange={() => setDrafts((current) => ({ ...current, [row.id]: { ...draft, status } }))}
                                />
                                {requestStatusLabels[status]}
                              </label>
                            ))}
                          </fieldset>

                          {draft.status === 'completed' ? (
                            <>
                              <div className="admin-field">
                                <label htmlFor={`settle-amount-${row.id}`}>Сумма</label>
                                <input
                                  id={`settle-amount-${row.id}`}
                                  inputMode="decimal"
                                  placeholder="2 500 000"
                                  value={draft.amount}
                                  disabled={savingSettlement}
                                  aria-invalid={amountError[row.id] ? true : undefined}
                                  aria-describedby={amountError[row.id] ? `settle-amount-${row.id}-error` : undefined}
                                  onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, amount: event.target.value } }))}
                                />
                                {amountError[row.id] ? (
                                  <p id={`settle-amount-${row.id}-error`} className="field-error">{amountError[row.id]}</p>
                                ) : null}
                              </div>
                              <div className="admin-field">
                                <label htmlFor={`settle-cost-${row.id}`}>Закупка</label>
                                <input
                                  id={`settle-cost-${row.id}`}
                                  inputMode="decimal"
                                  placeholder="не обязательно"
                                  value={draft.cost}
                                  disabled={savingSettlement}
                                  onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, cost: event.target.value } }))}
                                />
                                <p className="admin-hint">Сколько отдали поставщику. Можно вписать позже — пустое поле не стирает то, что уже записано.</p>
                              </div>
                              <div className="admin-field">
                                <label htmlFor={`settle-currency-${row.id}`}>Валюта</label>
                                <select
                                  id={`settle-currency-${row.id}`}
                                  value={draft.currency}
                                  disabled={savingSettlement}
                                  onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, currency: event.target.value as SettlementCurrency } }))}
                                >
                                  {(Object.keys(settlementCurrencies) as SettlementCurrency[]).map((code) => (
                                    <option key={code} value={code}>{settlementCurrencies[code].label}</option>
                                  ))}
                                </select>
                              </div>
                              <TurnoverHint />
                            </>
                          ) : null}

                          {panelError[row.id] ? <p role="alert" className="admin-form-error">{panelError[row.id]}</p> : null}
                          {panelNotice[row.id] ? <output className="admin-form-success">{panelNotice[row.id]}</output> : null}
                          <button type="submit" disabled={savingSettlement}>
                            {savingSettlement ? 'Сохранение…' : 'Сохранить итог'}
                          </button>
                        </form>
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
          {(Object.keys(requestStatusLabels) as RequestStatus[]).map((status) => (
            <option key={status} value={status}>{requestStatusLabels[status]}</option>
          ))}
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
