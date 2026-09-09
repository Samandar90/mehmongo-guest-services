'use client';

import { ArrowUpRight } from 'lucide-react';
import { catalogImages } from '@/lib/catalog-images';
import { useI18n } from '@/lib/i18n/context';
import type { Messages } from '@/lib/i18n/messages';
import type { CatalogOffer } from '@/supabase/functions/_shared/catalog';

type PriceLabels = Pick<Messages['catalog'], 'fromPrice' | 'getQuote'>;

/** "From $120" for a published option, "Get a quote" when the price is individual. */
export function offerPriceLabel(offer: Pick<CatalogOffer, 'price'>, labels: PriceLabels): string {
  if (offer.price.mode === 'quote' || offer.price.amount === null) return labels.getQuote;
  const currency = offer.price.currency === 'USD' ? '$' : `${offer.price.currency ?? ''} `;
  return labels.fromPrice(`${currency}${offer.price.amount}`);
}

function imageName(image: string | null): string | null {
  if (!image) return null;
  const file = image.split('/').pop() ?? '';
  const name = file.replace(/\.[a-z]+$/i, '');
  return name in catalogImages ? name : null;
}

export function OfferImage({ offer, eager }: { offer: CatalogOffer; eager: boolean }) {
  const name = imageName(offer.image);
  if (!name) return null;

  const variant = catalogImages[name];
  const widths = variant.widths.filter((width) => width <= variant.width);
  const srcSet = widths.map((width) => `/catalog/${name}-${width}.webp ${width === variant.widths[0] ? width : variant.width}w`).join(', ');

  return (
    <picture className="offer-media" data-fit={variant.fit}>
      <source type="image/webp" srcSet={srcSet} sizes="(min-width: 720px) 360px, 100vw" />
      <img
        src={`/catalog/${name}-${widths[widths.length - 1]}.jpg`}
        alt={offer.imageAlt ?? ''}
        width={variant.width}
        height={variant.height}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    </picture>
  );
}

export function OfferCard({ offer, eager, onOpen }: { offer: CatalogOffer; eager: boolean; onOpen: (offer: CatalogOffer) => void }) {
  const { t } = useI18n();
  return (
    <article className="offer-card" aria-label={offer.title}>
      <OfferImage offer={offer} eager={eager} />
      <div className="offer-body">
        <p className="offer-eyebrow">{offer.eyebrow}</p>
        <h3>{offer.title}</h3>
        <p className="offer-summary">{offer.summary}</p>
        <p className="offer-price">
          <strong>{offerPriceLabel(offer, t.catalog)}</strong>
          {offer.price.mode === 'from' ? <span>{offer.price.unit}</span> : null}
        </p>
        <button className="offer-cta" type="button" onClick={() => onOpen(offer)}>
          {offer.cta}
          <ArrowUpRight aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
