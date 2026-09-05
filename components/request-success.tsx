import { Check, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { GuestContext } from '@/lib/guest-request';
import type { GuestCatalog } from '@/supabase/functions/_shared/catalog';

export function RequestSuccess({ context, reference, onRestart, catalog }: {
  context: GuestContext;
  reference: string;
  onRestart: () => void;
  /** When the hotel is on a catalogue, the confirmation copy comes from it. */
  catalog?: GuestCatalog | null;
}) {
  const title = catalog?.form.successTitle ?? 'Request received';
  const text = catalog?.form.successText ?? 'Our concierge team will contact you shortly to confirm the details.';

  return (
    <output className="success-panel" aria-live="polite">
      <div className="success-mark" aria-hidden="true"><Check /></div>
      <p className="eyebrow">All set</p>
      <h1 className="form-title">{title}</h1>
      <p className="form-intro">{text}</p>
      <dl className="request-summary">
        <div><dt>Reference</dt><dd>{reference}</dd></div>
        <div><dt>Stay</dt><dd>{context.hotelName} · Room {context.roomLabel}</dd></div>
      </dl>
      <div className="response-note">
        <Clock3 aria-hidden="true" />
        <span>
          <strong>We will message the contact you provided</strong>
          <small>{catalog?.form.helpHint ?? 'Our team will confirm availability and the full price.'}</small>
        </span>
      </div>
      <Button className="submit-button" type="button" onClick={onRestart}>Request another service</Button>
    </output>
  );
}
