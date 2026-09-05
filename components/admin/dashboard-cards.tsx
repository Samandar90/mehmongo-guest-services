import Link from 'next/link';
import type { DashboardMetrics } from '@/lib/admin/requests';

type DashboardCardsProps = {
  /** null while loading. */
  metrics: DashboardMetrics | null;
};

const cards: Array<{ key: keyof DashboardMetrics; title: string; href: string; linkLabel: string }> = [
  { key: 'activeHotels', title: 'Активные отели', href: '/admin/hotels', linkLabel: 'Открыть отели' },
  { key: 'activeRooms', title: 'Активные комнаты', href: '/admin/hotels', linkLabel: 'Открыть отели' },
  { key: 'newRequests', title: 'Новые заявки', href: '/admin/requests', linkLabel: 'Открыть заявки' },
];

export function DashboardCards({ metrics }: DashboardCardsProps) {
  return (
    <div className="admin-metrics">
      {cards.map((card) => (
        <article key={card.key} className="admin-card admin-metric" aria-label={card.title} aria-busy={metrics ? undefined : true}>
          <h2>{card.title}</h2>
          <p className="admin-metric-value">{metrics ? metrics[card.key] : '…'}</p>
          <Link href={card.href} className="admin-button admin-button-secondary" aria-label={card.linkLabel}>
            {card.linkLabel}
          </Link>
        </article>
      ))}
    </div>
  );
}
