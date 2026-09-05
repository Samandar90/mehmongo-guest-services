'use client';

import { ArrowUpRight, Ticket, Utensils } from 'lucide-react';
import { useState } from 'react';
import { OfferCard } from '@/components/catalog/offer-card';
import type { CatalogOffer, GuestCatalog } from '@/supabase/functions/_shared/catalog';
import type { ServiceId } from '@/supabase/functions/_shared/contracts';

type FilterId = 'all' | ServiceId;

/**
 * The guest catalogue: what the hotel offers, how a request works and what we
 * confirm before payment. Only categories enabled for this hotel are shown.
 */
export function ServiceCatalog({ catalog, services, hotelName, roomLabel, onOpenOffer, onRestaurant, onCustomQuote }: {
  catalog: GuestCatalog;
  services: readonly ServiceId[];
  hotelName: string;
  roomLabel: string;
  onOpenOffer: (offer: CatalogOffer) => void;
  onRestaurant: () => void;
  onCustomQuote: () => void;
}) {
  const [filter, setFilter] = useState<FilterId>('all');
  const page = catalog.page;

  const availableOffers = catalog.offers.filter((offer) => services.includes(offer.category));
  const filters = page.filters.filter((entry) => (
    entry.id === 'all'
      ? availableOffers.length > 0
      : availableOffers.some((offer) => offer.category === entry.id)
  ));
  const activeFilter = filters.some((entry) => entry.id === filter) ? filter : 'all';

  const shown = availableOffers.filter((offer) => activeFilter === 'all' || offer.category === activeFilter);
  const cards = shown.filter((offer) => offer.category !== 'tickets');
  const ticketOffer = shown.find((offer) => offer.category === 'tickets') ?? null;
  const showRestaurants = services.includes('restaurants') && activeFilter === 'all';

  return (
    <>
      <section className="catalog-hero">
        <div className="stay-context">
          <span>{hotelName}</span><span aria-hidden="true">•</span><span>Room {roomLabel}</span>
        </div>
        <p className="eyebrow">{page.eyebrow}</p>
        <h1>{page.title}</h1>
        <p className="intro">{page.intro}</p>
        <button
          className="catalog-primary-cta"
          type="button"
          onClick={() => document.getElementById('catalog-services')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          {page.primaryCta}
        </button>
        <ul className="catalog-trust">
          {page.trustItems.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="catalog-services" id="catalog-services" aria-labelledby="catalog-services-title">
        <div className="section-heading">
          <h2 id="catalog-services-title">{page.sectionTitle}</h2>
          <span>{page.sectionIntro}</span>
        </div>

        {filters.length > 1 ? (
          <fieldset className="catalog-filters">
            <legend className="visually-hidden">Filter services</legend>
            {filters.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="catalog-filter"
                aria-pressed={activeFilter === entry.id}
                onClick={() => setFilter(entry.id as FilterId)}
              >
                {entry.label}
              </button>
            ))}
          </fieldset>
        ) : null}

        {shown.length === 0 && !showRestaurants ? <p className="catalog-empty">{page.emptyCategory}</p> : null}

        {cards.length > 0 ? (
          <div className="offer-grid">
            {cards.map((offer, index) => (
              <OfferCard key={offer.id} offer={offer} eager={index < 2} onOpen={onOpenOffer} />
            ))}
          </div>
        ) : null}

        {ticketOffer ? (
          <article className="ticket-block" aria-label={ticketOffer.title}>
            <span className="ticket-icon" aria-hidden="true"><Ticket /></span>
            <div>
              <p className="offer-eyebrow">{ticketOffer.eyebrow}</p>
              <h3>{ticketOffer.title}</h3>
              <p className="offer-summary">{ticketOffer.summary}</p>
              <ul className="ticket-facts">{ticketOffer.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
              <p className="offer-price"><strong>Get a quote</strong><span>{ticketOffer.price.unit}</span></p>
            </div>
            <button className="offer-cta" type="button" onClick={() => onOpenOffer(ticketOffer)}>
              {ticketOffer.cta}
              <ArrowUpRight aria-hidden="true" />
            </button>
          </article>
        ) : null}

        {showRestaurants ? (
          <article className="side-card" aria-label={page.restaurantTitle}>
            <span className="side-icon" aria-hidden="true"><Utensils /></span>
            <div>
              <h3>{page.restaurantTitle}</h3>
              <p>{page.restaurantText}</p>
            </div>
            <button className="offer-cta" type="button" onClick={onRestaurant}>
              {page.restaurantCta}
              <ArrowUpRight aria-hidden="true" />
            </button>
          </article>
        ) : null}

        {activeFilter === 'all' ? (
          <article className="side-card" aria-label={page.customTitle}>
            <div>
              <h3>{page.customTitle}</h3>
              <p>{page.customText}</p>
            </div>
            <button className="offer-cta" type="button" onClick={onCustomQuote}>
              {page.customCta}
              <ArrowUpRight aria-hidden="true" />
            </button>
          </article>
        ) : null}

        <p className="catalog-note">{page.priceNote}</p>
        <p className="catalog-note">{page.paymentNote}</p>
      </section>

      <section className="catalog-steps" aria-labelledby="catalog-steps-title">
        <h2 id="catalog-steps-title">{page.stepsTitle}</h2>
        <ol>
          {page.steps.map((step) => (
            <li key={step.title}><strong>{step.title}</strong><span>{step.text}</span></li>
          ))}
        </ol>
      </section>

      <section className="catalog-faq" aria-labelledby="catalog-faq-title">
        <h2 id="catalog-faq-title">Good to know</h2>
        <dl>
          {catalog.faq.map((entry) => (
            <div key={entry.question}>
              <dt>{entry.question}</dt>
              <dd>{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
