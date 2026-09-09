'use client';

import { Check, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

  return (
    <output className="success-panel" aria-live="polite">
      <div className="success-mark" aria-hidden="true"><Check /></div>
      <p className="eyebrow">{t.success.eyebrow}</p>
      <h1 className="form-title">{title}</h1>
      <p className="form-intro">{text}</p>
      <dl className="request-summary">
        <div><dt>{t.success.reference}</dt><dd>{reference}</dd></div>
        <div><dt>{t.success.stay}</dt><dd>{`${context.hotelName} · ${t.common.room(context.roomLabel)}`}</dd></div>
      </dl>
      <div className="response-note">
        <Clock3 aria-hidden="true" />
        <span>
          <strong>{t.success.willMessage}</strong>
          <small>{catalog?.form.helpHint ?? t.success.hint}</small>
        </span>
      </div>
      <Button className="submit-button" type="button" onClick={onRestart}>{t.success.another}</Button>
    </output>
  );
}
