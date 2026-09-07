'use client';

import { formatMinorAmount } from '@/lib/admin/money';
import { serviceLabels } from '@/components/admin/request-table';
import type { SettlementSummary } from '@/lib/admin/summary';

/**
 * What a period came to. Every money figure is per currency: som and dollars
 * are not addable, so there is deliberately no combined total anywhere, however
 * much a single number would look tidier.
 */
export function SettlementReport({ summary }: { summary: SettlementSummary }) {
  if (summary.requests === 0) {
    return <p className="admin-empty">За выбранный период заявок не было.</p>;
  }

  return (
    <div className="admin-report">
      <dl className="admin-metrics">
        <div className="admin-metric"><dt>Заявок</dt><dd>{summary.requests}</dd></div>
        <div className="admin-metric"><dt>Выполнено</dt><dd>{summary.completed}</dd></div>
        <div className="admin-metric"><dt>Отменено</dt><dd>{summary.cancelled}</dd></div>
      </dl>

      {summary.payouts.length === 0 ? (
        <p className="admin-empty">Пока ничего не начислено: ни одна заявка не выполнена.</p>
      ) : (
        <table className="admin-table" aria-label="Начислено отелю">
          <thead>
            <tr>
              <th scope="col">Валюта</th>
              <th scope="col">Выполнено</th>
              <th scope="col">Начислено отелю</th>
            </tr>
          </thead>
          <tbody>
            {summary.payouts.map((total) => (
              <tr key={total.currency}>
                <td data-label="Валюта">{total.currency}</td>
                <td data-label="Выполнено">{total.requests}</td>
                <td data-label="Начислено отелю"><strong>{formatMinorAmount(total.payoutMinor, total.currency)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/*
        Turnover is a separate table, not another column, for two reasons: the
        hotel is paid in dollars while a sale is often settled in som, so the
        two never belong on one row; and the database returns no turnover at all
        to a hotel account, so there is nothing to render for one.
      */}
      {summary.turnover && summary.turnover.length > 0 ? (
        <table className="admin-table" aria-label="Оборот">
          <thead>
            <tr>
              <th scope="col">Валюта</th>
              <th scope="col">Заявок</th>
              <th scope="col">Оборот</th>
            </tr>
          </thead>
          <tbody>
            {summary.turnover.map((total) => (
              <tr key={total.currency}>
                <td data-label="Валюта">{total.currency}</td>
                <td data-label="Заявок">{total.requests}</td>
                <td data-label="Оборот">{formatMinorAmount(total.amountMinor, total.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <table className="admin-table" aria-label="Заявки по услугам">
        <thead>
          <tr>
            <th scope="col">Услуга</th>
            <th scope="col">Заявок</th>
            <th scope="col">Выполнено</th>
          </tr>
        </thead>
        <tbody>
          {summary.byService.map((service) => (
            <tr key={service.serviceType}>
              <td data-label="Услуга">{serviceLabels[service.serviceType]}</td>
              <td data-label="Заявок">{service.requests}</td>
              <td data-label="Выполнено">{service.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
