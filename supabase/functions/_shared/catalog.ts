import { catalogData } from './catalog.data.ts';
import type { ServiceId } from './contracts.ts';

/**
 * The public guest catalogue, shared by the browser and the Edge Functions.
 * Copy and starting prices come from content/catalog.en.json; purchase prices,
 * hotel payouts and commissions never enter this module.
 */

/** Catalogue ids a hotel may be attached to. Only Tashkent ships today. */
export const guestCatalogIds = ['tashkent-v1'] as const;
export type GuestCatalogId = (typeof guestCatalogIds)[number];

/** Which set of form fields an offer asks for. Not a service id. */
export type RequestProfile =
  | 'guide'
  | 'mountains'
  | 'city'
  | 'airport'
  | 'airport_arrival'
  | 'intercity'
  | 'tickets';

export type OfferPrice = {
  mode: 'from' | 'quote';
  amount: number | null;
  currency: string | null;
  unit: string;
  billingUnit: string | null;
};

export type CatalogOffer = {
  id: string;
  category: ServiceId;
  featured: boolean;
  title: string;
  eyebrow: string;
  summary: string;
  description: string;
  price: OfferPrice;
  image: string | null;
  imageAlt: string | null;
  imageFit: 'cover' | 'contain' | null;
  imageCaption: string | null;
  facts: readonly string[];
  includes: readonly string[];
  extras: readonly string[];
  confirmBeforePayment: readonly string[];
  timing: string | null;
  requestProfile: RequestProfile;
  cta: string;
  /**
   * Passengers the published vehicle option covers, mirroring the card text
   * ("Up to 3 passengers"). Larger parties get an individual quote instead of
   * the starting price. null when the offer is not capacity-bound.
   */
  maxPassengers: number | null;
};

export type GuestCatalog = {
  id: GuestCatalogId;
  version: string;
  locale: string;
  departureCity: string;
  currency: string;
  page: typeof catalogData.page;
  faq: typeof catalogData.faq;
  form: typeof catalogData.form;
  offers: readonly CatalogOffer[];
};

/**
 * Capacity is public information printed on the cards; it is kept here so the
 * server can decide when a party no longer fits the published option.
 * lib/catalog.test.ts checks it against the card text in the JSON.
 */
const offerCapacity: Record<string, number> = {
  'tashkent-airport-sedan': 3,
  'tashkent-airport-minivan': 5,
};

function toOffer(offer: (typeof catalogData.offers)[number]): CatalogOffer {
  return {
    id: offer.id,
    category: offer.category as ServiceId,
    featured: offer.featured,
    title: offer.title,
    eyebrow: offer.eyebrow,
    summary: offer.summary,
    description: offer.description,
    price: {
      mode: offer.price.mode as OfferPrice['mode'],
      amount: offer.price.amount,
      currency: offer.price.currency,
      unit: offer.price.unit,
      billingUnit: offer.price.billingUnit,
    },
    image: offer.image,
    imageAlt: offer.imageAlt,
    imageFit: offer.imageFit as CatalogOffer['imageFit'],
    imageCaption: offer.imageCaption,
    facts: offer.facts,
    includes: offer.includes,
    extras: offer.extras,
    confirmBeforePayment: offer.confirmBeforePayment,
    timing: 'timing' in offer ? offer.timing : null,
    requestProfile: offer.requestProfile as RequestProfile,
    cta: offer.cta,
    maxPassengers: offerCapacity[offer.id] ?? null,
  };
}

const tashkentCatalog: GuestCatalog = {
  id: 'tashkent-v1',
  version: catalogData.version,
  locale: catalogData.locale,
  departureCity: catalogData.departureCity,
  currency: catalogData.currency,
  page: catalogData.page,
  faq: catalogData.faq,
  form: catalogData.form,
  offers: catalogData.offers.map(toOffer),
};

const catalogues: Record<GuestCatalogId, GuestCatalog> = { 'tashkent-v1': tashkentCatalog };

export function isGuestCatalogId(value: unknown): value is GuestCatalogId {
  return typeof value === 'string' && (guestCatalogIds as readonly string[]).includes(value);
}

export function getGuestCatalog(catalogId: string | null | undefined): GuestCatalog | null {
  return isGuestCatalogId(catalogId) ? catalogues[catalogId] : null;
}

export function offersForCatalog(catalogId: string | null | undefined): readonly CatalogOffer[] {
  return getGuestCatalog(catalogId)?.offers ?? [];
}

export function findCatalogOffer(catalogId: string | null | undefined, offerId: string): CatalogOffer | null {
  return offersForCatalog(catalogId).find((offer) => offer.id === offerId) ?? null;
}

/** An offer is orderable only from a hotel on that catalogue with the category enabled. */
export function isOfferAvailable(
  offer: CatalogOffer,
  hotel: { catalogId: string | null; services: readonly ServiceId[] },
): boolean {
  const catalog = getGuestCatalog(hotel.catalogId);
  if (!catalog) return false;
  if (!catalog.offers.some((candidate) => candidate.id === offer.id)) return false;
  return hotel.services.includes(offer.category);
}

/** Immutable record of what the guest was shown, stored with the request. */
export type OfferSnapshot = {
  offerId: string;
  catalogId: GuestCatalogId;
  catalogVersion: string;
  title: string;
  category: ServiceId;
  requestProfile: RequestProfile;
  priceMode: 'from' | 'quote';
  amount: number | null;
  currency: string | null;
  unit: string;
  capacityExceeded: boolean;
};

export function exceedsOfferCapacity(offer: CatalogOffer, partySize: number): boolean {
  return offer.maxPassengers !== null && partySize > offer.maxPassengers;
}

/**
 * Builds the snapshot on the server from the catalogue. A party larger than the
 * published vehicle drops to an individual quote instead of keeping a price
 * that no longer applies.
 */
export function buildOfferSnapshot(offer: CatalogOffer, partySize: number): OfferSnapshot {
  const capacityExceeded = exceedsOfferCapacity(offer, partySize);
  const quoteOnly = capacityExceeded || offer.price.mode === 'quote';

  return {
    offerId: offer.id,
    catalogId: 'tashkent-v1',
    catalogVersion: tashkentCatalog.version,
    title: offer.title,
    category: offer.category,
    requestProfile: offer.requestProfile,
    priceMode: quoteOnly ? 'quote' : 'from',
    amount: quoteOnly ? null : offer.price.amount,
    currency: quoteOnly ? null : offer.price.currency,
    unit: offer.price.unit,
    capacityExceeded,
  };
}
