'use client';

import { ArrowLeft } from 'lucide-react';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  emptyRequest,
  validateRequest,
  type RequestErrors,
  type RequestFields,
  type ServiceId,
} from '@/lib/guest-request';
import { REQUEST_FIELD_MAX_LENGTHS, type SubmitRequestResult } from '@/supabase/functions/_shared/contracts';

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
  max?: string;
  maxLength?: number;
  fields: RequestFields;
  errors: RequestErrors;
  onChange: (key: keyof RequestFields, value: string) => void;
};

function RequestField({ id, label, type = 'text', placeholder, min, max, maxLength, fields, errors, onChange }: FieldProps) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <Input id={id} name={id} type={type} min={min} max={max} maxLength={maxLength} placeholder={placeholder} value={fields[id]} onChange={(event) => onChange(id, event.target.value)} aria-invalid={Boolean(errors[id])} aria-describedby={errors[id] ? `${id}-error` : undefined} />
      {errors[id] ? <p className="field-error" id={`${id}-error`} role="alert">{errors[id]}</p> : null}
    </div>
  );
}

const guestErrorMessages = {
  ROOM_UNAVAILABLE: 'This room link is unavailable.',
  RATE_LIMITED: 'Too many requests were sent. Please contact the hotel reception.',
  REQUEST_FAILED: 'We could not send your request. Please try again.',
} as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RequestForm({ service, onBack, onComplete, onSubmit }: {
  service: ServiceId;
  onBack: () => void;
  onComplete: (reference: string) => void;
  onSubmit: (fields: RequestFields, idempotencyKey: string) => Promise<SubmitRequestResult>;
}) {
  const [fields, setFields] = useState<RequestFields>(emptyRequest);
  const [errors, setErrors] = useState<RequestErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitErrorRef = useRef<HTMLParagraphElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const isSubmittingRef = useRef(false);

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => { if (submitError) submitErrorRef.current?.focus(); }, [submitError]);

  const setField = (key: keyof RequestFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    idempotencyKeyRef.current = null;
    setSubmitError(null);
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    const nextErrors = validateRequest(service, fields);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    isSubmittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    try {
      const result = await onSubmit(fields, idempotencyKey);
      idempotencyKeyRef.current = null;
      onComplete(result.reference);
    } catch (error) {
      const code = error instanceof Error && error.message in guestErrorMessages ? error.message as keyof typeof guestErrorMessages : 'REQUEST_FAILED';
      setSubmitError(guestErrorMessages[code]);
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <section className="request-panel">
      <button className="back-button" type="button" onClick={onBack}><ArrowLeft /> Back to services</button>
      <p className="eyebrow">A few details</p>
      <h1 className="form-title" ref={headingRef} tabIndex={-1}>{serviceNames[service]} request</h1>
      <p className="form-intro">Tell us what you need. Our team will confirm the details with you.</p>

      <form onSubmit={submit} noValidate>
        {submitError ? <p className="field-error" role="alert" aria-label={submitError} tabIndex={-1} ref={submitErrorRef}>{submitError}</p> : null}
        {service === 'transport' ? (
          <div className="form-pair"><RequestField id="pickup" label="Pickup point" placeholder="Hotel, airport or address" maxLength={REQUEST_FIELD_MAX_LENGTHS.pickup} fields={fields} errors={errors} onChange={setField} /><RequestField id="destination" label="Destination" placeholder="Where would you like to go?" maxLength={REQUEST_FIELD_MAX_LENGTHS.destination} fields={fields} errors={errors} onChange={setField} /></div>
        ) : (
          <RequestField id="choice" label={choiceLabels[service]} placeholder="Type your preference" maxLength={REQUEST_FIELD_MAX_LENGTHS.choice} fields={fields} errors={errors} onChange={setField} />
        )}
        {service === 'transport' || service === 'restaurants' ? (
          <div className="form-pair"><RequestField id="date" label="Preferred date" type="date" min={todayIso()} fields={fields} errors={errors} onChange={setField} /><RequestField id="time" label="Preferred time" type="time" fields={fields} errors={errors} onChange={setField} /></div>
        ) : <RequestField id="date" label="Preferred date" type="date" min={todayIso()} fields={fields} errors={errors} onChange={setField} />}
        <RequestField id="count" label={service === 'tours' || service === 'restaurants' ? 'Guests' : 'Passengers'} type="number" min="1" max="50" fields={fields} errors={errors} onChange={setField} />
        <div className="form-divider"><span>Your details</span></div>
        <RequestField id="guestName" label="Your name" placeholder="How should we address you?" maxLength={REQUEST_FIELD_MAX_LENGTHS.guestName} fields={fields} errors={errors} onChange={setField} />
        <RequestField id="contact" label="Phone or messenger" placeholder="WhatsApp, Telegram or phone" maxLength={REQUEST_FIELD_MAX_LENGTHS.contact} fields={fields} errors={errors} onChange={setField} />
        <div className="form-field">
          <label htmlFor="note">Anything else? <span className="optional">Optional</span></label>
          <Textarea id="note" name="note" maxLength={REQUEST_FIELD_MAX_LENGTHS.note} value={fields.note} onChange={(event) => setField('note', event.target.value)} placeholder="Add any useful details" />
        </div>
        <Button className="submit-button" type="submit" disabled={submitting} aria-label={submitting ? 'Sending request…' : 'Send request'}>
          {submitting ? 'Sending request…' : 'Send request'}
        </Button>
      </form>
    </section>
  );
}
