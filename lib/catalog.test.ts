import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildOfferSnapshot,
  findCatalogOffer,
  getGuestCatalog,
  guestCatalogIds,
  isOfferAvailable,
  offersForCatalog,
  type CatalogOffer,
} from '@/supabase/functions/_shared/catalog';
import { catalogData } from '@/supabase/functions/_shared/catalog.data';

const sourceJson = JSON.parse(readFileSync(resolve(process.cwd(), 'content/catalog.en.json'), 'utf8'));

describe('catalog data', () => {
  it('matches content/catalog.en.json exactly', () => {
    expect(JSON.parse(JSON.stringify(catalogData))).toEqual(sourceJson);
  });

  it('exposes only the Tashkent catalog', () => {
    expect(guestCatalogIds).toEqual(['tashkent-v1']);
    expect(getGuestCatalog('tashkent-v1')?.version).toBe('mehmongo-tashkent-2026-09-05-final');
    expect(getGuestCatalog('unknown-catalog')).toBeNull();
  });

  it('carries the published prices and units', () => {
    const priced = offersForCatalog('tashkent-v1')
      .filter((offer) => offer.price.mode === 'from')
      .map((offer) => [offer.id, offer.price.amount, offer.price.currency] as const);

    expect(priced).toEqual([
      ['tashkent-private-guide', 120, 'USD'],
      ['tashkent-mountains-base', 160, 'USD'],
      ['tashkent-city-car', 140, 'USD'],
      ['tashkent-airport-sedan', 30, 'USD'],
      ['tashkent-airport-minivan', 40, 'USD'],
      ['tashkent-samarkand-one-way', 200, 'USD'],
      ['tashkent-airport-welcome', 45, 'USD'],
    ]);
  });

  it('keeps ticket assistance as a quote without an amount', () => {
    const tickets = findCatalogOffer('tashkent-v1', 'ticket-assistance');
    expect(tickets?.price).toEqual({ mode: 'quote', amount: null, currency: null, unit: 'Full price confirmed before payment', billingUnit: null });
    expect(tickets?.category).toBe('tickets');
  });

  it('carries no internal financial fields and no internal Russian notes', () => {
    const keys = new Set<string>();
    const collect = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
          keys.add(key.toLowerCase());
          collect(nested);
        }
      }
    };
    collect(catalogData);

    for (const forbidden of ['purchase', 'cost', 'margin', 'commission', 'bonus', 'payout', 'hotelshare', 'supplier', 'net', 'profit']) {
      expect([...keys]).not.toContain(forbidden);
    }
    // The internal economics document is Russian; the guest catalogue is English only.
    expect(JSON.stringify(catalogData)).not.toMatch(/[Ѐ-ӿ]/);
  });

  it('states vehicle capacity that matches the published card text', () => {
    const sedan = findCatalogOffer('tashkent-v1', 'tashkent-airport-sedan');
    const minivan = findCatalogOffer('tashkent-v1', 'tashkent-airport-minivan');
    expect(sedan?.maxPassengers).toBe(3);
    expect(minivan?.maxPassengers).toBe(5);
    expect(sedan?.facts.join(' ')).toContain('Up to 3 passengers');
    expect(minivan?.facts.join(' ')).toContain('Up to 5 passengers');
    expect(findCatalogOffer('tashkent-v1', 'ticket-assistance')?.maxPassengers).toBeNull();
  });

  it('finds an offer only inside its own catalog', () => {
    expect(findCatalogOffer('tashkent-v1', 'tashkent-city-car')?.category).toBe('transport');
    expect(findCatalogOffer('tashkent-v1', 'made-up-offer')).toBeNull();
    expect(findCatalogOffer('unknown-catalog', 'tashkent-city-car')).toBeNull();
  });
});

describe('isOfferAvailable', () => {
  const offer = findCatalogOffer('tashkent-v1', 'tashkent-city-car') as CatalogOffer;

  it('requires the hotel catalog and the enabled category', () => {
    expect(isOfferAvailable(offer, { catalogId: 'tashkent-v1', services: ['transport', 'tours'] })).toBe(true);
    expect(isOfferAvailable(offer, { catalogId: 'tashkent-v1', services: ['tours'] })).toBe(false);
    expect(isOfferAvailable(offer, { catalogId: null, services: ['transport'] })).toBe(false);
    expect(isOfferAvailable(offer, { catalogId: 'other-catalog', services: ['transport'] })).toBe(false);
  });
});

describe('buildOfferSnapshot', () => {
  it('records the public offer identity and starting price', () => {
    const offer = findCatalogOffer('tashkent-v1', 'tashkent-mountains-base') as CatalogOffer;

    expect(buildOfferSnapshot(offer, 4)).toEqual({
      offerId: 'tashkent-mountains-base',
      catalogId: 'tashkent-v1',
      catalogVersion: 'mehmongo-tashkent-2026-09-05-final',
      title: 'Trade the city for mountain views',
      category: 'tours',
      requestProfile: 'mountains',
      priceMode: 'from',
      amount: 160,
      currency: 'USD',
      unit: 'per vehicle · agreed day-trip route',
      capacityExceeded: false,
    });
  });

  it('never invents an amount for a quote offer', () => {
    const offer = findCatalogOffer('tashkent-v1', 'ticket-assistance') as CatalogOffer;

    expect(buildOfferSnapshot(offer, 2)).toMatchObject({ priceMode: 'quote', amount: null, currency: null, capacityExceeded: false });
  });

  it('drops the fixed price when the party exceeds the vehicle capacity', () => {
    const offer = findCatalogOffer('tashkent-v1', 'tashkent-airport-sedan') as CatalogOffer;

    expect(buildOfferSnapshot(offer, 3)).toMatchObject({ priceMode: 'from', amount: 30, capacityExceeded: false });
    expect(buildOfferSnapshot(offer, 4)).toMatchObject({ priceMode: 'quote', amount: null, currency: null, capacityExceeded: true });
  });

  it('never multiplies a vehicle price by the number of passengers', () => {
    const offer = findCatalogOffer('tashkent-v1', 'tashkent-airport-sedan') as CatalogOffer;

    expect(buildOfferSnapshot(offer, 1).amount).toBe(30);
    expect(buildOfferSnapshot(offer, 3).amount).toBe(30);
  });
});
