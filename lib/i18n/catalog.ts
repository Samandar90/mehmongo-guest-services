import {
  getGuestCatalog,
  type CatalogOffer,
  type CatalogSource,
  type CatalogSourceOffer,
  type GuestCatalog,
} from '../../supabase/functions/_shared/catalog';
import { catalogTranslations } from './catalog-translations';
import type { Locale } from './locale';

/**
 * Lays the translated text over an English offer. Everything that is not
 * text — the id, the price, the capacity, the request profile, the image —
 * stays as the English catalogue has it, so a translation can change what a
 * guest reads but never what they are quoted or what the server validates.
 */
export function localiseOffer(offer: CatalogOffer, source: CatalogSourceOffer | undefined): CatalogOffer {
  if (!source) return offer;
  return {
    ...offer,
    title: source.title,
    eyebrow: source.eyebrow,
    summary: source.summary,
    description: source.description,
    price: { ...offer.price, unit: source.price.unit },
    imageAlt: source.imageAlt,
    imageCaption: source.imageCaption,
    facts: source.facts,
    includes: source.includes,
    extras: source.extras,
    confirmBeforePayment: source.confirmBeforePayment,
    timing: source.timing ?? null,
    cta: source.cta,
  };
}

export function localiseCatalog(catalog: GuestCatalog, source: CatalogSource): GuestCatalog {
  const byId = new Map(source.offers.map((offer) => [offer.id, offer]));
  return {
    ...catalog,
    locale: source.locale,
    departureCity: source.departureCity,
    page: source.page,
    form: source.form,
    faq: source.faq,
    offers: catalog.offers.map((offer) => localiseOffer(offer, byId.get(offer.id))),
  };
}

/** The hotel's catalogue in the guest's language; English is the catalogue itself. */
export function getLocalisedCatalog(catalogId: string | null | undefined, locale: Locale): GuestCatalog | null {
  const catalog = getGuestCatalog(catalogId);
  if (!catalog || locale === 'en') return catalog;
  return localiseCatalog(catalog, catalogTranslations[locale]);
}
