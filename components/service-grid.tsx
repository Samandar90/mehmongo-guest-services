'use client';

import { ArrowUpRight, BusFront, Compass, Ticket, Utensils } from 'lucide-react';
import type { ServiceId } from '@/lib/guest-request';
import { useI18n } from '@/lib/i18n/context';

const services = [
  { id: 'tours' as const, icon: Compass, tone: 'gold' },
  { id: 'transport' as const, icon: BusFront, tone: 'blue' },
  { id: 'restaurants' as const, icon: Utensils, tone: 'plum' },
  { id: 'tickets' as const, icon: Ticket, tone: 'teal' },
];

export function ServiceGrid({
  onSelect,
  allowedServices = services.map(({ id }) => id),
}: {
  onSelect: (id: ServiceId) => void;
  allowedServices?: ServiceId[];
}) {
  const { t } = useI18n();
  return (
    <div className="service-grid" aria-label={t.services.listLabel}>
      {services.filter(({ id }) => allowedServices.includes(id)).map(({ id, icon: Icon, tone }) => {
        const { title, description } = t.services[id];
        return (
          <button className="service-card" data-tone={tone} key={id} onClick={() => onSelect(id)} type="button" aria-label={`${title}: ${description}`}>
            <span className="service-icon" aria-hidden="true"><Icon /></span>
            <span className="service-copy"><strong>{title}</strong><small>{description}</small></span>
            <ArrowUpRight className="service-arrow" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
