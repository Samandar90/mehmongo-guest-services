import { Check, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { GuestContext } from '@/lib/guest-request';

export function RequestSuccess({ context, reference, onRestart }: { context: GuestContext; reference: string; onRestart: () => void }) {
  return (
    <output className="success-panel" aria-live="polite">
      <div className="success-mark" aria-hidden="true"><Check /></div>
      <p className="eyebrow">All set</p>
      <h1 className="form-title">Request received</h1>
      <p className="form-intro">Our concierge team will contact you shortly to confirm the details.</p>
      <dl className="request-summary">
        <div><dt>Reference</dt><dd>{reference}</dd></div>
        <div><dt>Stay</dt><dd>{context.hotelName} · Room {context.room}</dd></div>
      </dl>
      <div className="response-note"><Clock3 aria-hidden="true" /><span><strong>Usually within 10 minutes</strong><small>We will message the contact you provided.</small></span></div>
      <Button className="submit-button" type="button" onClick={onRestart}>Request another service</Button>
    </output>
  );
}
