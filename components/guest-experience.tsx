'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BrandLockup } from '@/components/brand-lockup';
import { OfferDetails } from '@/components/catalog/offer-details';
import { OfferRequestForm, emptyCatalogDraft, type CatalogDraft } from '@/components/catalog/offer-request-form';
import { ServiceCatalog } from '@/components/catalog/service-catalog';
import { LanguageMenu, rememberLocale } from '@/components/language-menu';
import { RequestForm } from '@/components/request-form';
import { RequestSuccess } from '@/components/request-success';
import { SavePageButton } from '@/components/save-page-button';
import { ServiceGrid } from '@/components/service-grid';
import { hotelPickupLine, type GuestContext, type ServiceId } from '@/lib/guest-request';
import { getLocalisedCatalog } from '@/lib/i18n/catalog';
import { I18nProvider, useI18n } from '@/lib/i18n/context';
import { defaultLocale, localeInfo, LOCALE_PARAM, type Locale } from '@/lib/i18n/locale';
import { submitGuestRequest } from '@/lib/requests/api';
import type { CatalogOffer } from '@/supabase/functions/_shared/catalog';

type CatalogView =
  | { step: 'catalog' }
  | { step: 'details'; offer: CatalogOffer }
  | { step: 'offer-form'; offer: CatalogOffer }
  | { step: 'custom-category' };

/**
 * The guest site for one room. The language starts as the server resolved it
 * — from the link, the cookie or the browser — and a change here is instant:
 * the same screen re-renders in the new language with everything the guest
 * has typed still in place.
 */
export function GuestExperience({ context, locale: initialLocale = defaultLocale }: {
  context: GuestContext;
  locale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    rememberLocale(next);
    // A ?lang= the owner put in a demo link follows the guest's choice; a
    // plain room link stays plain.
    const url = new URL(window.location.href);
    if (url.searchParams.has(LOCALE_PARAM)) {
      url.searchParams.set(LOCALE_PARAM, next);
      window.history.replaceState(window.history.state, '', url);
    }
  };

  // The document follows the choice too, so the browser picks the right glyph
  // forms and a screen reader the right voice beyond this component's root.
  useEffect(() => {
    document.documentElement.lang = localeInfo[locale].tag;
  }, [locale]);

  return (
    <I18nProvider locale={locale} setLocale={setLocale}>
      <GuestScreens context={context} />
    </I18nProvider>
  );
}

function GuestScreens({ context }: { context: GuestContext }) {
  const { locale, t } = useI18n();
  const catalog = getLocalisedCatalog(context.catalogId, locale);
  const [service, setService] = useState<ServiceId | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [view, setView] = useState<CatalogView>({ step: 'catalog' });
  const [draft, setDraft] = useState<CatalogDraft>(emptyCatalogDraft);
  const lang = localeInfo[locale].tag;
  const hotelPickup = hotelPickupLine(context);
  const shareTitle = `MehmonGo · ${context.hotelName}`;

  const restart = () => {
    setService(null);
    setReference(null);
    setView({ step: 'catalog' });
  };

  const submitLegacy = (chosen: ServiceId) => (
    fields: Parameters<typeof submitGuestRequest>[0]['fields'],
    idempotencyKey: string,
    asap: boolean,
  ) => submitGuestRequest({ roomToken: context.roomToken, idempotencyKey, service: chosen, fields, website: '', guestLocale: locale, asap });

  if (reference) {
    return (
      <main className="guest-shell" lang={lang}>
        <GuestHeader />
        <RequestSuccess context={context} reference={reference} onRestart={restart} catalog={catalog} />
        <GuestFooter shareTitle={shareTitle} />
      </main>
    );
  }

  if (service) {
    return (
      <main className="guest-shell" lang={lang}>
        <GuestHeader />
        <RequestForm
          service={service}
          hotelPickup={hotelPickup}
          onBack={() => { setService(null); setView({ step: 'catalog' }); }}
          onComplete={setReference}
          onSubmit={submitLegacy(service)}
        />
        <GuestFooter shareTitle={shareTitle} />
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="guest-shell" lang={lang}>
        <GuestHeader />
        <section className="welcome-panel">
          <div className="stay-context"><span>{context.hotelName}</span><span aria-hidden="true">•</span><span>{t.common.room(context.roomLabel)}</span></div>
          <p className="eyebrow">{t.welcome.eyebrow}</p>
          <h1>{t.welcome.title[0]}<br /><em>{t.welcome.title[1]}</em></h1>
          <p className="intro">{t.welcome.intro}</p>
        </section>
        <section className="services-section" aria-labelledby="services-title">
          <div className="section-heading"><h2 id="services-title">{t.welcome.heading}</h2><span>{t.welcome.count(context.services.length)}</span></div>
          <ServiceGrid onSelect={setService} allowedServices={context.services} />
        </section>
        <GuestFooter shareTitle={shareTitle} />
      </main>
    );
  }

  return (
    <main className="guest-shell catalog-shell" lang={lang}>
      <GuestHeader />

      {view.step === 'offer-form' ? (
        <OfferRequestForm
          offer={view.offer}
          catalog={catalog}
          draft={draft}
          hotelPickup={hotelPickup}
          onDraftChange={setDraft}
          onBack={() => setView({ step: 'details', offer: view.offer })}
          onSubmit={async (fields, offerId, idempotencyKey, asap) => {
            const result = await submitGuestRequest({
              roomToken: context.roomToken,
              idempotencyKey,
              service: view.offer.category,
              fields,
              website: '',
              offerId,
              guestLocale: locale,
              asap,
            });
            setReference(result.reference);
          }}
        />
      ) : view.step === 'custom-category' ? (
        <section className="request-panel">
          <button className="back-button" type="button" onClick={() => setView({ step: 'catalog' })}>{t.common.backToServices}</button>
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

      <GuestFooter shareTitle={shareTitle} />
    </main>
  );
}

function GuestHeader() {
  const { locale, setLocale } = useI18n();
  return (
    <header className="site-header">
      <BrandLockup />
      <LanguageMenu locale={locale} onChange={setLocale} />
    </header>
  );
}

function GuestFooter({ shareTitle }: { shareTitle: string }) {
  const { t } = useI18n();
  return (
    <footer className="guest-footer">
      <span className="status-dot" aria-hidden="true" />
      <span>{t.common.concierge}</span>
      <SavePageButton title={shareTitle} />
      <Link href="/photo-credits">{t.common.photoCredits}</Link>
    </footer>
  );
}
