'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BrandLockup } from '@/components/brand-lockup';
import { OfferDetails } from '@/components/catalog/offer-details';
import { OfferRequestForm, emptyCatalogDraft, type CatalogDraft } from '@/components/catalog/offer-request-form';
import { ServiceCatalog } from '@/components/catalog/service-catalog';
import { RequestForm } from '@/components/request-form';
import { RequestSuccess } from '@/components/request-success';
import { ServiceGrid } from '@/components/service-grid';
import type { GuestContext, ServiceId } from '@/lib/guest-request';
import { submitGuestRequest } from '@/lib/requests/api';
import { getGuestCatalog, type CatalogOffer } from '@/supabase/functions/_shared/catalog';

type CatalogView =
  | { step: 'catalog' }
  | { step: 'details'; offer: CatalogOffer }
  | { step: 'offer-form'; offer: CatalogOffer }
  | { step: 'custom-category' };

export function GuestExperience({ context }: { context: GuestContext }) {
  const catalog = getGuestCatalog(context.catalogId);
  const [service, setService] = useState<ServiceId | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [view, setView] = useState<CatalogView>({ step: 'catalog' });
  const [draft, setDraft] = useState<CatalogDraft>(emptyCatalogDraft);

  const restart = () => {
    setService(null);
    setReference(null);
    setView({ step: 'catalog' });
  };

  const submitLegacy = (chosen: ServiceId) => (fields: Parameters<typeof submitGuestRequest>[0]['fields'], idempotencyKey: string) =>
    submitGuestRequest({ roomToken: context.roomToken, idempotencyKey, service: chosen, fields, website: '' });

  if (reference) {
    return (
      <main className="guest-shell">
        <header className="site-header"><BrandLockup /><span className="language-pill">EN</span></header>
        <RequestSuccess context={context} reference={reference} onRestart={restart} catalog={catalog} />
        <GuestFooter />
      </main>
    );
  }

  if (service) {
    return (
      <main className="guest-shell">
        <header className="site-header"><BrandLockup /><span className="language-pill">EN</span></header>
        <RequestForm
          service={service}
          onBack={() => { setService(null); setView({ step: 'catalog' }); }}
          onComplete={setReference}
          onSubmit={submitLegacy(service)}
        />
        <GuestFooter />
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="guest-shell">
        <header className="site-header"><BrandLockup /><span className="language-pill">EN</span></header>
        <section className="welcome-panel">
          <div className="stay-context"><span>{context.hotelName}</span><span aria-hidden="true">•</span><span>Room {context.roomLabel}</span></div>
          <p className="eyebrow">Guest services</p>
          <h1>Good stay,<br /><em>made simple.</em></h1>
          <p className="intro">Choose what you need. Our local team will take care of the rest.</p>
        </section>
        <section className="services-section" aria-labelledby="services-title">
          <div className="section-heading"><h2 id="services-title">How can we help?</h2><span>{context.services.length} services</span></div>
          <ServiceGrid onSelect={setService} allowedServices={context.services} />
        </section>
        <footer><span className="status-dot" aria-hidden="true" />Local concierge team available</footer>
      </main>
    );
  }

  return (
    <main className="guest-shell catalog-shell">
      <header className="site-header"><BrandLockup /><span className="language-pill">EN</span></header>

      {view.step === 'offer-form' ? (
        <OfferRequestForm
          offer={view.offer}
          catalog={catalog}
          draft={draft}
          onDraftChange={setDraft}
          onBack={() => setView({ step: 'details', offer: view.offer })}
          onSubmit={async (fields, offerId, idempotencyKey) => {
            const result = await submitGuestRequest({
              roomToken: context.roomToken,
              idempotencyKey,
              service: view.offer.category,
              fields,
              website: '',
              offerId,
            });
            setReference(result.reference);
          }}
        />
      ) : view.step === 'custom-category' ? (
        <section className="request-panel">
          <button className="back-button" type="button" onClick={() => setView({ step: 'catalog' })}>Back to services</button>
          <p className="eyebrow">{catalog.page.customTitle}</p>
          <h1 className="form-title">{catalog.page.customCta}</h1>
          <p className="form-intro">{catalog.page.customText}</p>
          <ServiceGrid onSelect={setService} allowedServices={context.services} />
        </section>
      ) : (
        <ServiceCatalog
          catalog={catalog}
          services={context.services}
          hotelName={context.hotelName}
          roomLabel={context.roomLabel}
          onOpenOffer={(offer) => setView({ step: 'details', offer })}
          onRestaurant={() => setService('restaurants')}
          onCustomQuote={() => setView({ step: 'custom-category' })}
        />
      )}

      {view.step === 'details' ? (
        <OfferDetails
          offer={view.offer}
          onClose={() => setView({ step: 'catalog' })}
          onRequest={(offer) => setView({ step: 'offer-form', offer })}
        />
      ) : null}

      <GuestFooter />
    </main>
  );
}

function GuestFooter() {
  return (
    <footer className="guest-footer">
      <span className="status-dot" aria-hidden="true" />
      <span>Local concierge team available</span>
      <Link href="/photo-credits">Photo credits</Link>
    </footer>
  );
}
