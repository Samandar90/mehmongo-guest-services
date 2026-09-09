import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getGuestCatalog, type CatalogSource } from '@/supabase/functions/_shared/catalog';
import { catalogData } from '@/supabase/functions/_shared/catalog.data';
import { catalogTranslations } from './catalog-translations';
import { getLocalisedCatalog, localiseCatalog } from './catalog';

const translatedLocales = ['ru', 'uz', 'zh'] as const;
const english: CatalogSource = catalogData;

function readSource(locale: string): CatalogSource {
  return JSON.parse(readFileSync(resolve(process.cwd(), `content/catalog.${locale}.json`), 'utf8'));
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('catalogue translations', () => {
  it('match their JSON sources exactly', () => {
    for (const locale of translatedLocales) {
      expect(JSON.parse(JSON.stringify(catalogTranslations[locale]))).toEqual(readSource(locale));
    }
  });

  // The translations repeat the prices only so each file reads whole. The
  // English file is the source, and a translated figure that differs from it
  // is a mistake in the translation, never a second price.
  it.each(translatedLocales)('%s keeps every offer, price and profile of the English catalogue', (locale) => {
    const source = catalogTranslations[locale];
    expect(source.version).toBe(english.version);
    expect(source.locale).toBe(locale);
    expect(source.currency).toBe(english.currency);
    expect(source.offers.map((offer) => offer.id)).toEqual(english.offers.map((offer) => offer.id));

    for (const [index, offer] of english.offers.entries()) {
      const translated = source.offers[index];
      expect(translated.category, offer.id).toBe(offer.category);
      expect(translated.featured, offer.id).toBe(offer.featured);
      expect(translated.price.mode, offer.id).toBe(offer.price.mode);
      expect(translated.price.amount, offer.id).toBe(offer.price.amount);
      expect(translated.price.currency, offer.id).toBe(offer.price.currency);
      expect(translated.price.billingUnit, offer.id).toBe(offer.price.billingUnit);
      expect(translated.image, offer.id).toBe(offer.image);
      expect(translated.imageFit, offer.id).toBe(offer.imageFit);
      expect(translated.requestProfile, offer.id).toBe(offer.requestProfile);
      expect(translated.facts.length, offer.id).toBe(offer.facts.length);
      expect(translated.includes.length, offer.id).toBe(offer.includes.length);
      expect(translated.extras.length, offer.id).toBe(offer.extras.length);
      expect(translated.confirmBeforePayment.length, offer.id).toBe(offer.confirmBeforePayment.length);
      expect(typeof translated.timing, offer.id).toBe(typeof offer.timing);
      expect(translated.imageAlt === null, offer.id).toBe(offer.imageAlt === null);
      expect(translated.imageCaption === null, offer.id).toBe(offer.imageCaption === null);
    }

    expect(source.page.filters.map((filter) => filter.id)).toEqual(english.page.filters.map((filter) => filter.id));
    expect(source.page.steps).toHaveLength(english.page.steps.length);
    expect(source.page.trustItems).toHaveLength(english.page.trustItems.length);
    expect(source.faq).toHaveLength(english.faq.length);
    expect(Object.keys(source.form).sort()).toEqual(Object.keys(english.form).sort());
    expect(Object.keys(source.page).sort()).toEqual(Object.keys(english.page).sort());
  });

  it.each(translatedLocales)('%s leaves no string blank', (locale) => {
    for (const text of strings(catalogTranslations[locale])) {
      expect(text.trim()).not.toBe('');
    }
  });

  it.each(translatedLocales)('%s still states the vehicle capacity the server enforces', (locale) => {
    const catalog = getLocalisedCatalog('tashkent-v1', locale);
    const sedan = catalog?.offers.find((offer) => offer.id === 'tashkent-airport-sedan');
    const minivan = catalog?.offers.find((offer) => offer.id === 'tashkent-airport-minivan');
    expect(sedan?.maxPassengers).toBe(3);
    expect(sedan?.facts.join(' ')).toContain('3');
    expect(minivan?.maxPassengers).toBe(5);
    expect(minivan?.facts.join(' ')).toContain('5');
  });

  it('carries no internal financial fields in any language', () => {
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
    collect(catalogTranslations);
    for (const forbidden of ['purchase', 'cost', 'margin', 'commission', 'bonus', 'payout', 'hotelshare', 'supplier', 'net', 'profit']) {
      expect([...keys]).not.toContain(forbidden);
    }
  });
});

describe('getLocalisedCatalog', () => {
  it('returns the English catalogue itself for English', () => {
    expect(getLocalisedCatalog('tashkent-v1', 'en')).toBe(getGuestCatalog('tashkent-v1'));
  });

  it('returns nothing for a hotel without a catalogue', () => {
    expect(getLocalisedCatalog(null, 'ru')).toBeNull();
    expect(getLocalisedCatalog('unknown', 'zh')).toBeNull();
  });

  it('translates the text and keeps the English prices and ids', () => {
    const russian = getLocalisedCatalog('tashkent-v1', 'ru');
    const guide = russian?.offers.find((offer) => offer.id === 'tashkent-private-guide');
    expect(guide?.title).toBe('Ташкент с местным гидом');
    expect(guide?.price).toEqual({ mode: 'from', amount: 120, currency: 'USD', unit: 'за согласованную экскурсию', billingUnit: 'excursion' });
    expect(guide?.requestProfile).toBe('guide');
    expect(russian?.page.title).toBe('Немного планов. Намного больше Ташкента.');
    expect(russian?.form.submit).toBe('Отправить заявку');
    expect(russian?.faq[0].question).toBe('Оплата происходит на этом сайте?');
    expect(russian?.locale).toBe('ru');
    expect(russian?.id).toBe('tashkent-v1');
    expect(russian?.version).toBe(getGuestCatalog('tashkent-v1')?.version);
  });

  it('keeps the English offer when a translation has no entry for it', () => {
    const english = getGuestCatalog('tashkent-v1')!;
    const partial: CatalogSource = { ...catalogTranslations.zh, offers: catalogTranslations.zh.offers.slice(0, 1) };
    const localised = localiseCatalog(english, partial);
    expect(localised.offers[0].title).toBe(catalogTranslations.zh.offers[0].title);
    expect(localised.offers[1].title).toBe(english.offers[1].title);
    expect(localised.offers).toHaveLength(english.offers.length);
  });
});
