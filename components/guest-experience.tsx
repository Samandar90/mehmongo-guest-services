'use client';

import { useState } from 'react';
import { BrandLockup } from '@/components/brand-lockup';
import { RequestForm } from '@/components/request-form';
import { RequestSuccess } from '@/components/request-success';
import { ServiceGrid } from '@/components/service-grid';
import type { GuestContext, ServiceId } from '@/lib/guest-request';

export function GuestExperience({ context }: { context: GuestContext }) {
  const [service, setService] = useState<ServiceId | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const restart = () => { setService(null); setReference(null); };

  return (
    <main className="guest-shell">
      <header className="site-header"><BrandLockup /><span className="language-pill">EN</span></header>

      {reference ? <RequestSuccess context={context} reference={reference} onRestart={restart} /> : service ? (
        <RequestForm service={service} onBack={() => setService(null)} onComplete={setReference} />
      ) : (
        <>
          <section className="welcome-panel">
            <div className="stay-context"><span>{context.hotelName}</span><span aria-hidden="true">•</span><span>Room {context.room}</span></div>
            <p className="eyebrow">Guest services</p>
            <h1>Good stay,<br /><em>made simple.</em></h1>
            <p className="intro">Choose what you need. Our local team will take care of the rest.</p>
          </section>
          <section className="services-section" aria-labelledby="services-title">
            <div className="section-heading"><h2 id="services-title">How can we help?</h2><span>4 services</span></div>
            <ServiceGrid onSelect={setService} />
          </section>
          <footer><span className="status-dot" aria-hidden="true" />Local concierge team available</footer>
        </>
      )}
    </main>
  );
}
