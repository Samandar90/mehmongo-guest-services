import Link from 'next/link';
import type { DashboardMetrics } from '@/lib/admin/requests';

type DashboardCardsProps = {
  /** null when no metrics have been loaded yet (first load or a failed first load). */
  metrics: DashboardMetrics | null;
  /** true while a load or refresh is in flight, independent of whether stale metrics are shown. */
  busy?: boolean;
};

const cards: Array<{ key: keyof DashboardMetrics; title: string; href: string }> = [
  { key: 'activeHotels', title: 'Активные отели', href: '/admin/hotels' },
  { key: 'activeRooms', title: 'Активные комнаты', href: '/admin/hotels' },
  { key: 'newRequests', title: 'Новые заявки', href: '/admin/requests' },
];

/**
 * Three counters, and each one is the link.
 *
 * They used to carry a button underneath, which made every card twice as tall
 * for a second target to the same page — two of the three said «Открыть отели».
 * The card is the target now, so the strip states the numbers and stops.
 */
export function DashboardCards({ metrics, busy = false }: DashboardCardsProps) {
  return (
    <div className="admin-metrics">
      {cards.map((card) => (
        <Link
          key={card.key}
          href={card.href}
          className="admin-metric"
          aria-label={card.title}
          aria-busy={busy || undefined}
        >
          <span className="admin-metric-title">{card.title}</span>
          <span className="admin-metric-value">{metrics ? metrics[card.key] : busy ? '…' : '—'}</span>
        </Link>
      ))}
    </div>
  );
}
