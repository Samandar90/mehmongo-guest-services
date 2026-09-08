'use client';

import { useEffect, useState } from 'react';
import { SettlementReport } from '@/components/admin/settlement-report';
import { serviceLabels } from '@/components/admin/request-table';
import { getAdminIdentity } from '@/lib/admin/auth';
import { formatMinorAmount } from '@/lib/admin/money';
import { getSettlementSummary, summariseRows, type SettlementSummary } from '@/lib/admin/summary';
import { listHotelRequests, type HotelRequest } from '@/lib/admin/hotel-requests';

type State =
  | { status: 'loading' }
  | { status: 'ready'; summary: SettlementSummary; requests: HotelRequest[] }
  | { status: 'error' };

const statusLabels: Record<string, string> = {
  new: 'Новая',
  confirmed: 'Подтверждена',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

/** The month the cabinet opens on, as an <input type="month"> value. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * A month, not a free date range.
 *
 * The volume step is a property of a whole calendar month and multiplies every
 * request in it. For any window that is not exactly a month, a payout figure
 * would not be the figure that gets paid — so the cabinet does not offer one.
 */
function monthBounds(month: string): { dateFrom: string; dateTo: string } {
  const [year, index] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { dateFrom: `${month}-01`, dateTo: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  const names = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
  ];
  return `${names[index - 1]} ${year}`;
}

export default function HotelCabinetPage() {
  const [month, setMonth] = useState<string>(currentMonth());
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const period = monthBounds(month);
        const [identity, rows, requests] = await Promise.all([
          getAdminIdentity(),
          getSettlementSummary(period),
          listHotelRequests(period),
        ]);
        if (cancelled) return;
        const hotelId = identity && identity.role === 'hotel' ? identity.hotelId : undefined;
        setState({ status: 'ready', summary: summariseRows(rows, hotelId), requests });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [month, attempt]);

  return (
    <main className="admin-page">
      <header className="admin-page-header">
        <h1>Кабинет отеля</h1>
        <p>Заявки ваших гостей. Начисляем только за выполненные.</p>
      </header>

      <form className="admin-filters" aria-label="Месяц" onSubmit={(event) => event.preventDefault()}>
        <div className="admin-field">
          <label htmlFor="cabinet-month">Месяц</label>
          <input
            id="cabinet-month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value || currentMonth())}
          />
        </div>
        <p className="admin-hint">
          Начисляется только то, что доведено до конца: если гость передумал или
          заказ не состоялся, заявка не оплачивается. Надбавка за объём считается
          за календарный месяц целиком — от числа выполненных заявок за весь месяц.
        </p>
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
        <>
          <section className="admin-card" aria-labelledby="cabinet-report-heading">
            <h2 id="cabinet-report-heading">Итоги за {monthLabel(month)}</h2>
            <SettlementReport summary={state.summary} />
          </section>

          <section className="admin-card" aria-labelledby="cabinet-requests-heading">
            <h2 id="cabinet-requests-heading">Заявки за {monthLabel(month)}</h2>
            {state.requests.length === 0 ? (
              <p className="admin-empty">За этот месяц заявок не было.</p>
            ) : (
              <table className="admin-table" aria-label="Заявки отеля">
                <thead>
                  <tr>
                    <th scope="col">Заявка</th>
                    <th scope="col">Комната</th>
                    <th scope="col">Услуга</th>
                    <th scope="col">Статус</th>
                    <th scope="col">Начислено</th>
                  </tr>
                </thead>
                <tbody>
                  {state.requests.map((request) => (
                    <tr key={request.id}>
                      <td data-label="Заявка">{request.reference}</td>
                      <td data-label="Комната">{request.roomLabel}</td>
                      <td data-label="Услуга">{serviceLabels[request.serviceType]}</td>
                      <td data-label="Статус">{statusLabels[request.status] ?? request.status}</td>
                      {/*
                        A rate stays frozen on a request that was completed and
                        later cancelled, so that re-completing it cannot re-read
                        a newer rate card. Showing that figure here would read as
                        a debt: nothing is owed unless the request is completed.
                      */}
                      <td data-label="Начислено">
                        {request.status === 'completed' && request.rateMinor !== null
                          ? formatMinorAmount(request.rateMinor, request.rateCurrency ?? 'USD')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="admin-hint">
              Прочерк означает, что заявка ещё не выполнена или не состоялась —
              за такие мы не платим. У выполненных показана базовая ставка;
              надбавка за объём начисляется на весь месяц и учтена в итогах выше.
            </p>
          </section>
        </>
      ) : null}
    </main>
  );
}
