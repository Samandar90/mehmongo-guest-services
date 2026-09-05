import Link from 'next/link';
import type { DashboardMetrics } from '@/lib/admin/requests';

type DashboardCardsProps = {
  /** null when no metrics have been loaded yet (first load or a failed first load). */
  metrics: DashboardMetrics | null;
  /** true while a load or refresh is in flight, independent of whether stale metrics are shown. */
  busy?: boolean;
};

const cards: Array<{ key: keyof DashboardMetrics; title: string; href: string; linkLabel: string }> = [
  { key: 'activeHotels', title: 'Активные отели', href: '/admin/hotels', linkLabel: 'Открыть отели' },
  { key: 'activeRooms', title: 'Активные комнаты', href: '/admin/hotels', linkLabel: 'Открыть отели' },
  { key: 'newRequests', title: 'Новые заявки', href: '/admin/requests', linkLabel: 'Открыть заявки' },
];

export function DashboardCards({ metrics, busy = false }: DashboardCardsProps) {
  return (
    <div className="admin-metrics">
      {cards.map((card) => (
        <article key={card.key} className="admin-card admin-metric" aria-label={card.title} aria-busy={busy || undefined}>
          <h2>{card.title}</h2>
          <p className="admin-metric-value">{metrics ? metrics[card.key] : busy ? '…' : '—'}</p>
          <Link href={card.href} className="admin-button admin-button-secondary">{card.linkLabel}</Link>
        </article>
      ))}
    </div>
  );
}
