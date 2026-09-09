'use client';

import { Check, Clock3, MessageCircle, Send } from 'lucide-react';
import { SavePageButton } from '@/components/save-page-button';
import { Button } from '@/components/ui/button';
import { guestContact, telegramLink, whatsappLink } from '@/lib/contact';
import type { GuestContext } from '@/lib/guest-request';
import { useI18n } from '@/lib/i18n/context';
import type { GuestCatalog } from '@/supabase/functions/_shared/catalog';

export function RequestSuccess({ context, reference, onRestart, catalog }: {
  context: GuestContext;
  reference: string;
  onRestart: () => void;
  /** When the hotel is on a catalogue, the confirmation copy comes from it. */
  catalog?: GuestCatalog | null;
}) {
  const { t } = useI18n();
  const title = catalog?.form.successTitle ?? t.success.title;
  const text = catalog?.form.successText ?? t.success.text;
  const room = t.common.room(context.roomLabel);
  // The guest's own first message, in their language, so the team sees the
  // reference before anything else and knows which language to answer in.
  const message = t.success.contactMessage(reference, context.hotelName, room);
  const whatsapp = whatsappLink(message);
  const telegram = telegramLink(message);

  return (
    <output className="success-panel" aria-live="polite">
      <div className="success-mark" aria-hidden="true"><Check /></div>
      <p className="eyebrow">{t.success.eyebrow}</p>
      <h1 className="form-title">{title}</h1>
      <p className="form-intro">{text}</p>
      <dl className="request-summary">
        <div><dt>{t.success.reference}</dt><dd>{reference}</dd></div>
        <div><dt>{t.success.stay}</dt><dd>{`${context.hotelName} · ${room}`}</dd></div>
      </dl>
      <div className="response-note">
        <Clock3 aria-hidden="true" />
        <span>
          <strong>{t.success.willMessage}</strong>
          <small>{catalog?.form.helpHint ?? t.success.hint}</small>
          <small>{t.common.replyPromise(guestContact.replyMinutes, guestContact.hoursFrom, guestContact.hoursTo)}</small>
        </span>
      </div>

      {whatsapp || telegram ? (
        <section className="contact-block" aria-labelledby="contact-title">
          <h2 id="contact-title" className="contact-title">{t.success.writeUs}</h2>
          <div className="contact-buttons">
            {whatsapp ? (
              <a className="contact-button" href={whatsapp} target="_blank" rel="noreferrer">
                <MessageCircle aria-hidden="true" />{t.success.whatsapp}
              </a>
            ) : null}
            {telegram ? (
              <a className="contact-button" href={telegram} target="_blank" rel="noreferrer">
                <Send aria-hidden="true" />{t.success.telegram}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="save-block">
        <SavePageButton title={`MehmonGo · ${context.hotelName}`} variant="button" />
        <p className="form-hint">{t.common.saveHint}</p>
      </div>

      <Button className="submit-button" type="button" onClick={onRestart}>{t.success.another}</Button>
    </output>
  );
}
