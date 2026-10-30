'use client';

import { PeriodDelta } from '@/components/admin/period-delta';
import { formatMinorAmount } from '@/lib/admin/money';
import { serviceLabels } from '@/components/admin/request-table';
import { marginShare, type ProfitSummary } from '@/lib/admin/profit';

/**
 * What the period actually earned: revenue, what the suppliers charged, and
 * the difference.
 *
 * Only the owner ever sees this. Every figure is per currency, because a sale
 * settled in som and one settled in dollars have no shared total — the same
 * rule the settlement figures follow.
 */
export function ProfitReport({ summary, previous }: { summary: ProfitSummary; previous?: ProfitSummary | null }) {
  if (summary.byCurrency.length === 0) {
    return <p className="admin-empty">За выбранный период нет выполненных заявок.</p>;
  }

  return (
    <div className="admin-report">
      {summary.missingCost > 0 ? (
        <p className="admin-note-warn">
          {summary.missingCost === 1
            ? 'У одной выполненной заявки не записана закупка — её маржа в расчёт не вошла.'
            : `У ${summary.missingCost} выполненных заявок не записана закупка — их маржа в расчёт не вошла.`}
        </p>
      ) : null}

      {summary.byCurrency.map((total) => {
        const share = marginShare(total.revenueMinor, total.marginMinor);
        // Compared within one currency only. A currency absent last period was
        // zero then, which is a real figure and not a gap.
        const before = previous === undefined || previous === null
          ? null
          : previous.byCurrency.find((item) => item.currency === total.currency)
            ?? { revenueMinor: 0, marginMinor: 0 };
        const money = (value: number) => formatMinorAmount(value, total.currency);
        return (
          <div key={total.currency} className="admin-profit-block">
            <h4 className="admin-profit-currency">{total.currency}</h4>
            <dl className="admin-profit-figures">
              <div className="admin-profit-margin">
                <dt>Маржа</dt>
                <dd>
                  {formatMinorAmount(total.marginMinor, total.currency)}
                  {share === null ? null : <small>{share}% от выручки</small>}
                  {before ? <PeriodDelta current={total.marginMinor} previous={before.marginMinor} format={money} /> : null}
                </dd>
              </div>
              <div>
                <dt>Выручка</dt>
                <dd>
                  {formatMinorAmount(total.revenueMinor, total.currency)}
                  {before ? <PeriodDelta current={total.revenueMinor} previous={before.revenueMinor} format={money} /> : null}
                </dd>
              </div>
              <div>
                <dt>Закупка</dt>
                <dd>{formatMinorAmount(total.costMinor, total.currency)}</dd>
              </div>
            </dl>
            <p className="admin-hint">
              {total.costed === total.requests
                ? `Закупка записана по всем ${total.requests} заявкам.`
                : `Закупка записана по ${total.costed} из ${total.requests} заявок.`}
            </p>
          </div>
        );
      })}

      <table className="admin-table" aria-label="Прибыль по услугам">
        <thead>
          <tr>
            <th scope="col">Услуга</th>
            <th scope="col">Заявок</th>
            <th scope="col">Выручка</th>
            <th scope="col">Закупка</th>
            <th scope="col">Маржа</th>
          </tr>
        </thead>
        <tbody>
          {summary.byService.map((service) => {
            const share = marginShare(service.revenueMinor, service.marginMinor);
            return (
              <tr key={`${service.serviceType}-${service.currency}`}>
                <td data-label="Услуга">
                  <strong>{serviceLabels[service.serviceType]}</strong>
                  <small>{service.currency}</small>
                </td>
                <td data-label="Заявок">
                  {service.requests}
                  {service.costed < service.requests
                    ? <small>с закупкой: {service.costed}</small>
                    : null}
                </td>
                <td data-label="Выручка">{formatMinorAmount(service.revenueMinor, service.currency)}</td>
                <td data-label="Закупка">{formatMinorAmount(service.costMinor, service.currency)}</td>
                <td data-label="Маржа">
                  <strong>{formatMinorAmount(service.marginMinor, service.currency)}</strong>
                  {share === null ? null : <small>{share}%</small>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
