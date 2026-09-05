'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { OfferImage, offerPriceLabel } from '@/components/catalog/offer-card';
import type { CatalogOffer } from '@/supabase/functions/_shared/catalog';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Details of one offer in a modal dialog: what is included, what is extra and
 * what we confirm before payment. The primary action opens the request form.
 */
export function OfferDetails({ offer, onClose, onRequest }: {
  offer: CatalogOffer;
  onClose: () => void;
  onRequest: (offer: CatalogOffer) => void;
}) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    headingRef.current?.focus();
    const opener = openerRef.current;
    return () => { if (opener instanceof HTMLElement) opener.focus(); };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="offer-overlay" onKeyDown={onKeyDown} role="presentation">
      <button className="offer-overlay-close" type="button" aria-label="Close details" onClick={onClose} />
      <dialog className="offer-dialog" open aria-modal="true" aria-labelledby="offer-details-title" ref={panelRef}>
        <button className="offer-dialog-dismiss" type="button" onClick={onClose} aria-label="Close details">
          <X aria-hidden="true" />
        </button>
        <OfferImage offer={offer} eager />
        <div className="offer-dialog-body">
          <p className="offer-eyebrow">{offer.eyebrow}</p>
          <h2 id="offer-details-title" ref={headingRef} tabIndex={-1}>{offer.title}</h2>
          <p className="offer-price">
            <strong>{offerPriceLabel(offer)}</strong>
            <span>{offer.price.unit}</span>
          </p>
          <p className="offer-description">{offer.description}</p>
          {offer.imageCaption ? <p className="offer-caption">{offer.imageCaption}</p> : null}

          <h3>What is included</h3>
          <ul>{offer.includes.map((item) => <li key={item}>{item}</li>)}</ul>

          <h3>Quoted separately</h3>
          <ul>{offer.extras.map((item) => <li key={item}>{item}</li>)}</ul>

          <h3>We confirm before payment</h3>
          <ul>{offer.confirmBeforePayment.map((item) => <li key={item}>{item}</li>)}</ul>

          {offer.timing ? <p className="offer-timing">{offer.timing}</p> : null}

          <button className="offer-dialog-cta" type="button" onClick={() => onRequest(offer)}>{offer.cta}</button>
        </div>
      </dialog>
    </div>
  );
}
