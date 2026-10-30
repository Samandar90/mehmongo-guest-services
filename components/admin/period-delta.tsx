import { changePercent } from '@/lib/admin/insights';

type PeriodDeltaProps = {
  current: number;
  previous: number;
  /** Whether a rise is good news: more cancellations are not. */
  goodWhen?: 'up' | 'down';
  /** Prints the previous figure; plain numbers by default. */
  format?: (value: number) => string;
};

/**
 * A figure against the previous period. The arrow and the words carry the
 * direction, so the colour is never the only signal.
 */
export function PeriodDelta({ current, previous, goodWhen = 'up', format = String }: PeriodDeltaProps) {
  if (current === 0 && previous === 0) return null;

  if (current === previous) return <small className="admin-delta admin-delta-flat">= без изменений</small>;

  const percent = changePercent(current, previous);
  const up = current > previous;

  return (
    <small className={`admin-delta admin-delta-${up === (goodWhen === 'up') ? 'good' : 'bad'}`}>
      {up ? '▲' : '▼'}{percent === null || percent === 0 ? '' : ` ${Math.abs(percent)}%`} · было {format(previous)}
    </small>
  );
}
