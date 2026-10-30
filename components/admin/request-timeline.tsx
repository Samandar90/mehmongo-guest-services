import Link from 'next/link';
import { niceCeiling, type TimelineBucket } from '@/lib/admin/insights';
import { formatDay, type DateBasis } from '@/lib/admin/period';
import { requestsHref } from '@/lib/admin/requests';

type SeriesKey = 'completed' | 'open' | 'cancelled';

const series: { key: SeriesKey; label: string }[] = [
  { key: 'completed', label: 'Выполнено' },
  { key: 'open', label: 'В работе' },
  { key: 'cancelled', label: 'Отменено' },
];

function bucketLabel(bucket: TimelineBucket): string {
  return bucket.from === bucket.to ? formatDay(bucket.from) : `${formatDay(bucket.from)} – ${formatDay(bucket.to)}`;
}

function bucketSummary(bucket: TimelineBucket): string {
  return series
    .filter(({ key }) => bucket[key] > 0)
    .map(({ key, label }) => `${label}: ${bucket[key]}`)
    .join(', ');
}

/**
 * Requests per day, stacked by how they ended. Every bar with anything in it
 * opens those requests in the list, so a spike is one click from its rows.
 *
 * Plain elements rather than a chart library: stacked bars are a dozen lines of
 * layout, and a real link per bar is what a library makes hard.
 */
export function RequestTimeline({ buckets, basis }: { buckets: TimelineBucket[]; basis: DateBasis }) {
  const peak = niceCeiling(Math.max(...buckets.map((bucket) => bucket.total)));
  const middle = peak >= 2 && peak % 2 === 0 ? peak / 2 : null;
  const middleBucket = buckets[Math.floor(buckets.length / 2)];

  return (
    <figure className="admin-chart">
      <ul className="admin-chart-legend">
        {series.map(({ key, label }) => (
          <li key={key}><span className={`admin-chart-swatch admin-chart-${key}`} aria-hidden="true" />{label}</li>
        ))}
      </ul>

      <div className="admin-chart-plot">
        <div className="admin-chart-grid" aria-hidden="true">
          <span style={{ bottom: '100%' }}>{peak}</span>
          {middle === null ? null : <span style={{ bottom: '50%' }}>{middle}</span>}
          <span style={{ bottom: '0%' }}>0</span>
        </div>
        <ol className="admin-chart-bars" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
          {buckets.map((bucket, index) => (
            <li key={bucket.from}>
              {bucket.total === 0 ? (
                <span className="admin-chart-column" title={`${bucketLabel(bucket)}: заявок нет`} />
              ) : (
                <Link
                  className="admin-chart-column"
                  href={requestsHref({ dateFrom: bucket.from, dateTo: bucket.to, dateBasis: basis === 'settled' ? 'settled' : undefined })}
                  aria-label={`${bucketLabel(bucket)}: ${bucket.total}. ${bucketSummary(bucket)}. Открыть заявки`}
                >
                  <span className="admin-chart-stack" style={{ height: `${(bucket.total / peak) * 100}%` }}>
                    {series.map(({ key }) => (bucket[key] > 0 ? (
                      <span key={key} className={`admin-chart-${key}`} style={{ flexGrow: bucket[key] }} />
                    ) : null))}
                  </span>
                  <span
                    className={index < buckets.length / 2 ? 'admin-chart-tip' : 'admin-chart-tip admin-chart-tip-left'}
                    aria-hidden="true"
                  >
                    <strong>{bucketLabel(bucket)}</strong>
                    {bucketSummary(bucket)}
                  </span>
                </Link>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="admin-chart-axis" aria-hidden="true">
        <span>{formatDay(buckets[0].from)}</span>
        {buckets.length > 4 ? <span>{formatDay(middleBucket.from)}</span> : null}
        {buckets.length > 1 ? <span>{formatDay(buckets[buckets.length - 1].from)}</span> : null}
      </div>

      <details className="admin-chart-table">
        <summary>Таблица по дням</summary>
        <table className="admin-table" aria-label="Заявки по дням">
          <thead>
            <tr>
              <th scope="col">Дата</th>
              <th scope="col">Заявок</th>
              {series.map(({ key, label }) => <th key={key} scope="col">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {buckets.filter((bucket) => bucket.total > 0).map((bucket) => (
              <tr key={bucket.from}>
                <td data-label="Дата">{bucketLabel(bucket)}</td>
                <td data-label="Заявок">{bucket.total}</td>
                {series.map(({ key, label }) => <td key={key} data-label={label}>{bucket[key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
