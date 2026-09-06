'use client';

import { Fragment } from 'react';
import { formatMinorAmount } from '@/lib/admin/money';
import type { HotelSettlement } from '@/lib/admin/summary';

/**
 * What each hotel is owed for the period.
 *
 * A hotel settled in two currencies gets one line per currency: there is no
 * combined figure, because adding som to dollars would produce a number that
 * means nothing and would be paid out by someone eventually.
 */
export function OwnerPayouts({ hotels }: { hotels: HotelSettlement[] }) {
  if (hotels.length === 0) {
    return <p className="admin-empty">Ни один отель не получал заявок за выбранный период.</p>;
  }

  return (
    <table className="admin-table" aria-label="Начисления по отелям">
      <thead>
        <tr>
          <th scope="col">Отель</th>
          <th scope="col">Заявок</th>
          <th scope="col">Выполнено</th>
          <th scope="col">Оборот</th>
          <th scope="col">Начислено отелю</th>
        </tr>
      </thead>
      <tbody>
        {hotels.map((hotel) => (
          <Fragment key={hotel.hotelId}>
            {hotel.payouts.length === 0 ? (
              <tr>
                <td data-label="Отель">{hotel.hotelName}</td>
                <td data-label="Заявок">{hotel.requests}</td>
                <td data-label="Выполнено">{hotel.completed}</td>
                <td data-label="Оборот">—</td>
                <td data-label="Начислено отелю">—</td>
              </tr>
            ) : (
              hotel.payouts.map((total, index) => (
                <tr key={`${hotel.hotelId}-${total.currency}`}>
                  {/* The hotel is named once and its counts stated once, even
                      when it settled in more than one currency. */}
                  <td data-label="Отель">{index === 0 ? hotel.hotelName : ''}</td>
                  <td data-label="Заявок">{index === 0 ? hotel.requests : ''}</td>
                  <td data-label="Выполнено">{index === 0 ? hotel.completed : ''}</td>
                  <td data-label="Оборот">{formatMinorAmount(total.amountMinor, total.currency)}</td>
                  <td data-label="Начислено отелю">
                    <strong>{formatMinorAmount(total.payoutMinor, total.currency)}</strong>
                  </td>
                </tr>
              ))
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
