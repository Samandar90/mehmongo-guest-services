'use client';

import { useI18n } from '@/lib/i18n/context';
import type { CatalogOffer } from '@/supabase/functions/_shared/catalog';

/**
 * What is included, what is extra and what we confirm before payment, folded
 * into the request form. Closed by default: the guest who already knows what
 * they want goes straight to the fields, and the terms are one tap away.
 */
export function OfferDetails({ offer }: { offer: CatalogOffer }) {
  const { t } = useI18n();
  return (
    <details className="offer-details">
      <summary>{t.catalog.detailsToggle}</summary>
      <div className="offer-details-body">
        <p className="offer-description">{offer.description}</p>
        {offer.imageCaption ? <p className="offer-caption">{offer.imageCaption}</p> : null}

        <h2>{t.catalog.included}</h2>
        <ul>{offer.includes.map((item) => <li key={item}>{item}</li>)}</ul>

        <h2>{t.catalog.extras}</h2>
        <ul>{offer.extras.map((item) => <li key={item}>{item}</li>)}</ul>

        <h2>{t.catalog.confirmBefore}</h2>
        <ul>{offer.confirmBeforePayment.map((item) => <li key={item}>{item}</li>)}</ul>

        {offer.timing ? <p className="offer-timing">{offer.timing}</p> : null}
      </div>
    </details>
  );
}
