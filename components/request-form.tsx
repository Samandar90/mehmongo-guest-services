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
import { useI18n } from '@/lib/i18n/context';
import { REQUEST_FIELD_MAX_LENGTHS, type SubmitRequestResult } from '@/supabase/functions/_shared/contracts';

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RequestForm({ service, onBack, onComplete, onSubmit }: {
  service: ServiceId;
  onBack: () => void;
  onComplete: (reference: string) => void;
  onSubmit: (fields: RequestFields, idempotencyKey: string) => Promise<SubmitRequestResult>;
}) {
  const { t } = useI18n();
  const copy = t.form;
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
    const nextErrors = validateRequest(service, fields, t.validation);
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
      const code = error instanceof Error && error.message in copy.errors ? error.message as keyof typeof copy.errors : 'REQUEST_FAILED';
      setSubmitError(copy.errors[code]);
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const countLabel = service === 'tours' || service === 'restaurants' ? copy.guests : copy.passengers;

  return (
    <section className="request-panel">
      <button className="back-button" type="button" onClick={onBack}><ArrowLeft /> {t.common.backToServices}</button>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1 className="form-title" ref={headingRef} tabIndex={-1}>{copy.title[service]}</h1>
      <p className="form-intro">{copy.intro}</p>

      <form onSubmit={submit} noValidate>
        {submitError ? <p className="field-error" role="alert" aria-label={submitError} tabIndex={-1} ref={submitErrorRef}>{submitError}</p> : null}
        {service === 'transport' ? (
          <div className="form-pair"><RequestField id="pickup" label={copy.pickup} placeholder={copy.pickupPlaceholder} maxLength={REQUEST_FIELD_MAX_LENGTHS.pickup} fields={fields} errors={errors} onChange={setField} /><RequestField id="destination" label={copy.destination} placeholder={copy.destinationPlaceholder} maxLength={REQUEST_FIELD_MAX_LENGTHS.destination} fields={fields} errors={errors} onChange={setField} /></div>
        ) : (
          <RequestField id="choice" label={copy.choice[service]} placeholder={copy.choicePlaceholder} maxLength={REQUEST_FIELD_MAX_LENGTHS.choice} fields={fields} errors={errors} onChange={setField} />
        )}
        {service === 'transport' || service === 'restaurants' ? (
          <div className="form-pair"><RequestField id="date" label={copy.date} type="date" min={todayIso()} fields={fields} errors={errors} onChange={setField} /><RequestField id="time" label={copy.time} type="time" fields={fields} errors={errors} onChange={setField} /></div>
        ) : <RequestField id="date" label={copy.date} type="date" min={todayIso()} fields={fields} errors={errors} onChange={setField} />}
        <RequestField id="count" label={countLabel} type="number" min="1" max="50" fields={fields} errors={errors} onChange={setField} />
        <div className="form-divider"><span>{t.common.yourDetails}</span></div>
        <RequestField id="guestName" label={copy.name} placeholder={copy.namePlaceholder} maxLength={REQUEST_FIELD_MAX_LENGTHS.guestName} fields={fields} errors={errors} onChange={setField} />
        <RequestField id="contact" label={copy.contact} placeholder={copy.contactPlaceholder} maxLength={REQUEST_FIELD_MAX_LENGTHS.contact} fields={fields} errors={errors} onChange={setField} />
        <div className="form-field">
          <label htmlFor="note">{copy.note} <span className="optional">{t.common.optional}</span></label>
          <Textarea id="note" name="note" maxLength={REQUEST_FIELD_MAX_LENGTHS.note} value={fields.note} onChange={(event) => setField('note', event.target.value)} placeholder={copy.notePlaceholder} />
        </div>
        <Button className="submit-button" type="submit" disabled={submitting} aria-label={submitting ? copy.sending : copy.submit}>
          {submitting ? copy.sending : copy.submit}
        </Button>
      </form>
    </section>
  );
}
