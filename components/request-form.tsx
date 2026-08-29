'use client';

import { ArrowLeft } from 'lucide-react';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  createRequestReference,
  emptyRequest,
  validateRequest,
  type RequestErrors,
  type RequestFields,
  type ServiceId,
} from '@/lib/guest-request';

const serviceNames: Record<ServiceId, string> = {
  tours: 'Tour', transport: 'Transport', restaurants: 'Restaurant', tickets: 'Ticket',
};

const choiceLabels: Record<Exclude<ServiceId, 'transport'>, string> = {
  tours: 'Tour or destination',
  restaurants: 'Restaurant or cuisine',
  tickets: 'Ticket type or destination',
};

type FieldProps = {
  id: keyof RequestFields;
  label: string;
  type?: string;
  placeholder?: string;
  min?: string;
  fields: RequestFields;
  errors: RequestErrors;
  onChange: (key: keyof RequestFields, value: string) => void;
};

function RequestField({ id, label, type = 'text', placeholder, min, fields, errors, onChange }: FieldProps) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <Input id={id} name={id} type={type} min={min} placeholder={placeholder} value={fields[id]} onChange={(event) => onChange(id, event.target.value)} aria-invalid={Boolean(errors[id])} aria-describedby={errors[id] ? `${id}-error` : undefined} />
      {errors[id] ? <p className="field-error" id={`${id}-error`} role="alert">{errors[id]}</p> : null}
    </div>
  );
}

export function RequestForm({ service, onBack, onComplete }: {
  service: ServiceId;
  onBack: () => void;
  onComplete: (reference: string) => void;
}) {
  const [fields, setFields] = useState<RequestFields>(emptyRequest);
  const [errors, setErrors] = useState<RequestErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { headingRef.current?.focus(); }, []);

  const setField = (key: keyof RequestFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateRequest(service, fields);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    window.setTimeout(() => onComplete(createRequestReference(Math.random())), 650);
  };

  return (
    <section className="request-panel">
      <button className="back-button" type="button" onClick={onBack}><ArrowLeft /> Back to services</button>
      <p className="eyebrow">A few details</p>
      <h1 className="form-title" ref={headingRef} tabIndex={-1}>{serviceNames[service]} request</h1>
      <p className="form-intro">Tell us what you need. Our team will confirm the details with you.</p>

      <form onSubmit={submit} noValidate>
        {service === 'transport' ? (
          <div className="form-pair"><RequestField id="pickup" label="Pickup point" placeholder="Hotel, airport or address" fields={fields} errors={errors} onChange={setField} /><RequestField id="destination" label="Destination" placeholder="Where would you like to go?" fields={fields} errors={errors} onChange={setField} /></div>
        ) : (
          <RequestField id="choice" label={choiceLabels[service]} placeholder="Type your preference" fields={fields} errors={errors} onChange={setField} />
        )}
        {service === 'transport' || service === 'restaurants' ? (
          <div className="form-pair"><RequestField id="date" label="Preferred date" type="date" fields={fields} errors={errors} onChange={setField} /><RequestField id="time" label="Preferred time" type="time" fields={fields} errors={errors} onChange={setField} /></div>
        ) : <RequestField id="date" label="Preferred date" type="date" fields={fields} errors={errors} onChange={setField} />}
        <RequestField id="count" label={service === 'tours' || service === 'restaurants' ? 'Guests' : 'Passengers'} type="number" min="1" fields={fields} errors={errors} onChange={setField} />
        <div className="form-divider"><span>Your details</span></div>
        <RequestField id="guestName" label="Your name" placeholder="How should we address you?" fields={fields} errors={errors} onChange={setField} />
        <RequestField id="contact" label="Phone or messenger" placeholder="WhatsApp, Telegram or phone" fields={fields} errors={errors} onChange={setField} />
        <div className="form-field">
          <label htmlFor="note">Anything else? <span className="optional">Optional</span></label>
          <Textarea id="note" name="note" value={fields.note} onChange={(event) => setField('note', event.target.value)} placeholder="Add any useful details" />
        </div>
        <Button className="submit-button" type="submit" disabled={submitting} aria-label={submitting ? 'Sending request…' : 'Send request'}>
          {submitting ? 'Sending request…' : 'Send request'}
        </Button>
      </form>
    </section>
  );
}
