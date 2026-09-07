'use client';

import { formatMinorAmount } from '@/lib/admin/money';
import type { HotelSettlement } from '@/lib/admin/summary';

/**
 * What each hotel is owed for the period.
 *
 * One row per hotel, and each money cell lists its own currencies on their own
 * lines. Payout and turnover no longer share a currency — the hotel is paid a
 * fixed rate in dollars while a sale is usually settled in som — so pairing
 * them on one row would put two unrelated figures side by side and invite them
 * to be read as a percentage of each other.
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
          <tr key={hotel.hotelId}>
            <td data-label="Отель">{hotel.hotelName}</td>
            <td data-label="Заявок">{hotel.requests}</td>
            <td data-label="Выполнено">{hotel.completed}</td>
            <td data-label="Оборот">
              {hotel.turnover && hotel.turnover.length > 0
                ? hotel.turnover.map((total) => (
                    <div key={total.currency}>{formatMinorAmount(total.amountMinor, total.currency)}</div>
                  ))
                : '—'}
            </td>
            <td data-label="Начислено отелю">
              {hotel.payouts.length === 0
                ? '—'
                : hotel.payouts.map((total) => (
                    <div key={total.currency}>
                      <strong>{formatMinorAmount(total.payoutMinor, total.currency)}</strong>
                    </div>
                  ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
