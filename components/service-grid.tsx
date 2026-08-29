'use client';

import { ArrowUpRight, BusFront, Compass, Ticket, Utensils } from 'lucide-react';
import type { ServiceId } from '@/lib/guest-request';

const services = [
  { id: 'tours' as const, title: 'Tours', description: 'Explore with a trusted local guide', icon: Compass, tone: 'gold' },
  { id: 'transport' as const, title: 'Transport', description: 'Airport, station and city rides', icon: BusFront, tone: 'blue' },
  { id: 'restaurants' as const, title: 'Restaurants', description: 'Recommendations and table bookings', icon: Utensils, tone: 'plum' },
  { id: 'tickets' as const, title: 'Tickets', description: 'Train, flight and event assistance', icon: Ticket, tone: 'teal' },
];

export function ServiceGrid({ onSelect }: { onSelect: (id: ServiceId) => void }) {
  return (
    <div className="service-grid" aria-label="Available services">
      {services.map(({ id, title, description, icon: Icon, tone }) => (
        <button className="service-card" data-tone={tone} key={id} onClick={() => onSelect(id)} type="button" aria-label={`${title}: ${description}`}>
          <span className="service-icon" aria-hidden="true"><Icon /></span>
          <span className="service-copy"><strong>{title}</strong><small>{description}</small></span>
          <ArrowUpRight className="service-arrow" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
