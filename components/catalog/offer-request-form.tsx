'use client';

import { ArrowLeft } from 'lucide-react';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { offerPriceLabel } from '@/components/catalog/offer-card';
import {
  airportDirections,
  arrivalDirection,
  exceedsOfferCapacity,
  mountainPreferences,
  ticketModes,
  type CatalogOffer,
  type GuestCatalog,
} from '@/supabase/functions/_shared/catalog';
import { REQUEST_FIELD_MAX_LENGTHS, type GuestRequestFields } from '@/supabase/functions/_shared/contracts';

/** Values the guest keeps while moving between services. */
export type CatalogDraft = {
  guestName: string;
  contact: string;
  date: string;
  count: string;
  note: string;
};

export const emptyCatalogDraft: CatalogDraft = { guestName: '', contact: '', date: '', count: '2', note: '' };

type OfferFields = {
  choice: string;
  pickup: string;
  destination: string;
  time: string;
  language: string;
  flight: string;
  luggage: string;
};

const emptyOfferFields: OfferFields = { choice: '', pickup: '', destination: '', time: '', language: '', flight: '', luggage: '' };

type Errors = Partial<Record<keyof OfferFields | keyof CatalogDraft, string>>;

const submitErrors = {
  ROOM_UNAVAILABLE: 'inactiveRoom',
  RATE_LIMITED: 'rateLimitError',
  REQUEST_FAILED: 'networkError',
} as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Optional refinements travel as labelled lines in the shared note column. */
function buildNote(offer: CatalogOffer, fields: OfferFields, note: string): string {
  const lines: string[] = [];
  if (offer.requestProfile === 'guide' && fields.language) lines.push(`Language: ${fields.language}`);
  if ((offer.requestProfile === 'airport' || offer.requestProfile === 'airport_arrival')) {
    if (fields.flight) lines.push(`Flight: ${fields.flight}`);
    if (fields.luggage) lines.push(`Luggage: ${fields.luggage}`);
  }
  if (note) lines.push(note);
  return lines.join('\n').slice(0, REQUEST_FIELD_MAX_LENGTHS.note);
}

export function OfferRequestForm({ offer, catalog, draft, onDraftChange, onBack, onSubmit }: {
  offer: CatalogOffer;
  catalog: GuestCatalog;
  draft: CatalogDraft;
  onDraftChange: (draft: CatalogDraft) => void;
  onBack: () => void;
  onSubmit: (fields: GuestRequestFields, offerId: string, idempotencyKey: string) => Promise<void>;
}) {
  const copy = catalog.form;
  const [fields, setFields] = useState<OfferFields>(emptyOfferFields);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => { if (submitError) errorRef.current?.focus(); }, [submitError]);

  const profile = offer.requestProfile;
  const partySize = Number(draft.count);
  const overCapacity = Number.isFinite(partySize) && exceedsOfferCapacity(offer, partySize);

  const setOfferField = (key: keyof OfferFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    idempotencyKeyRef.current = null;
    setSubmitError(null);
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const setDraftField = (key: keyof CatalogDraft, value: string) => {
    onDraftChange({ ...draft, [key]: value });
    idempotencyKeyRef.current = null;
    setSubmitError(null);
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = (): Errors => {
    const next: Errors = {};
    if (!draft.date) next.date = 'Choose a date';
    else if (draft.date < todayIso()) next.date = 'Choose today or a future date';
    const count = Number(draft.count);
    if (!Number.isInteger(count) || count < 1 || count > 50) next.count = 'Enter 1 to 50 travellers';
    if (!draft.guestName.trim()) next.guestName = 'Enter your name';
    if (!draft.contact.trim()) next.contact = 'Enter one way to reach you';

    if (profile === 'mountains' && !fields.choice) next.choice = 'Choose a direction';
    if (profile === 'airport' && !fields.choice) next.choice = 'Choose a direction';
    if (profile === 'tickets') {
      if (!fields.choice) next.choice = 'Choose how you travel';
      if (!fields.pickup.trim()) next.pickup = 'Enter where you start';
      if (!fields.destination.trim()) next.destination = 'Enter where you are going';
    }
    if (profile === 'city' && !fields.pickup.trim()) next.pickup = 'Enter a pickup point';
    if (profile === 'intercity') {
      if (!fields.pickup.trim()) next.pickup = 'Enter your Tashkent pickup address';
      if (!fields.destination.trim()) next.destination = 'Enter your Samarkand destination';
    }
    if ((profile === 'airport' || profile === 'airport_arrival' || profile === 'intercity') && !fields.time) {
      next.time = 'Choose a time';
    }
    return next;
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    try {
      await onSubmit({
        choice: profile === 'airport_arrival' ? arrivalDirection : fields.choice,
        pickup: fields.pickup.trim(),
        destination: fields.destination.trim(),
        date: draft.date,
        time: fields.time,
        count: draft.count,
        guestName: draft.guestName.trim(),
        contact: draft.contact.trim(),
        note: buildNote(offer, fields, draft.note.trim()),
      }, offer.id, idempotencyKey);
      idempotencyKeyRef.current = null;
    } catch (error) {
      const code = error instanceof Error && error.message in submitErrors
        ? submitErrors[error.message as keyof typeof submitErrors]
        : 'networkError';
      setSubmitError(copy[code]);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const fieldError = (key: keyof Errors) => (errors[key]
    ? <p className="field-error" id={`${key}-error`} role="alert">{errors[key]}</p>
    : null);

  const textField = (key: keyof OfferFields, label: string, options: { placeholder?: string; maxLength?: number } = {}) => (
    <div className="form-field">
      <label htmlFor={key}>{label}</label>
      <Input
        id={key}
        name={key}
        value={fields[key]}
        placeholder={options.placeholder}
        maxLength={options.maxLength ?? REQUEST_FIELD_MAX_LENGTHS.choice}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `${key}-error` : undefined}
        onChange={(event) => setOfferField(key, event.target.value)}
      />
      {fieldError(key)}
    </div>
  );

  const selectField = (key: keyof OfferFields, label: string, choices: readonly string[], placeholder: string) => (
    <div className="form-field">
      <label htmlFor={key}>{label}</label>
      <select
        id={key}
        name={key}
        className="form-select"
        value={fields[key]}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `${key}-error` : undefined}
        onChange={(event) => setOfferField(key, event.target.value)}
      >
        <option value="">{placeholder}</option>
        {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
      </select>
      {fieldError(key)}
    </div>
  );

  const timeField = (
    <div className="form-field">
      <label htmlFor="time">{copy.timeLabel}</label>
      <Input id="time" name="time" type="time" value={fields.time} aria-invalid={Boolean(errors.time)}
        aria-describedby={errors.time ? 'time-error' : undefined} onChange={(event) => setOfferField('time', event.target.value)} />
      {fieldError('time')}
    </div>
  );

  return (
    <section className="request-panel offer-form">
      <button className="back-button" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" /> {copy.back}</button>
      <p className="eyebrow">{offer.eyebrow}</p>
      <h1 className="form-title" ref={headingRef} tabIndex={-1}>{copy.title}</h1>
      <p className="offer-chosen">{offer.title}</p>
      <p className="offer-price-note">
        <strong>{overCapacity ? 'Get a quote' : offerPriceLabel(offer)}</strong>
        <span>{overCapacity || offer.price.mode === 'quote' ? copy.quoteLabel : copy.priceLabel}</span>
      </p>
      {overCapacity && offer.maxPassengers !== null ? (
        <output className="offer-capacity">
          This option seats up to {offer.maxPassengers}. We will prepare an individual quote for your group.
        </output>
      ) : null}
      <p className="form-intro">{copy.intro}</p>

      <form onSubmit={submit} noValidate>
        {submitError ? <p className="field-error" role="alert" tabIndex={-1} ref={errorRef}>{submitError}</p> : null}

        {profile === 'mountains' ? selectField('choice', 'Where would you like to go?', mountainPreferences, 'Choose a direction') : null}
        {profile === 'airport' ? selectField('choice', 'Direction', airportDirections, 'Choose a direction') : null}
        {profile === 'airport_arrival' ? (
          <p className="offer-fixed-field"><span>Direction</span><strong>{arrivalDirection}</strong></p>
        ) : null}
        {profile === 'tickets' ? selectField('choice', 'Travel by', ticketModes, 'Choose how you travel') : null}
        {profile === 'tickets' ? (
          <div className="form-pair">
            {textField('pickup', 'From', { placeholder: 'City or station', maxLength: REQUEST_FIELD_MAX_LENGTHS.pickup })}
            {textField('destination', 'To', { placeholder: 'City or station', maxLength: REQUEST_FIELD_MAX_LENGTHS.destination })}
          </div>
        ) : null}
        {profile === 'city' ? textField('pickup', 'Pickup point in Tashkent', { placeholder: 'Hotel lobby or address', maxLength: REQUEST_FIELD_MAX_LENGTHS.pickup }) : null}
        {profile === 'city' ? textField('choice', 'Places you would like to include (optional)', { placeholder: 'Old city, museums, bazaar' }) : null}
        {profile === 'intercity' ? (
          <div className="form-pair">
            {textField('pickup', 'Pickup address in Tashkent', { placeholder: 'Hotel or address', maxLength: REQUEST_FIELD_MAX_LENGTHS.pickup })}
            {textField('destination', 'Destination in Samarkand', { placeholder: 'Hotel or address', maxLength: REQUEST_FIELD_MAX_LENGTHS.destination })}
          </div>
        ) : null}
        {profile === 'guide' ? textField('choice', 'What interests you? (optional)', { placeholder: 'Old city, food, history' }) : null}
        {profile === 'guide' ? textField('language', 'Preferred language (optional)', { placeholder: 'English, Russian…', maxLength: 60 }) : null}

        <div className="form-pair">
          <div className="form-field">
            <label htmlFor="date">{copy.dateLabel}</label>
            <Input id="date" name="date" type="date" min={todayIso()} value={draft.date} aria-invalid={Boolean(errors.date)}
              aria-describedby={errors.date ? 'date-error' : undefined} onChange={(event) => setDraftField('date', event.target.value)} />
            {fieldError('date')}
          </div>
          {profile === 'airport' || profile === 'airport_arrival' || profile === 'intercity' ? timeField : null}
        </div>

        <div className="form-field">
          <label htmlFor="count">{copy.countLabel}</label>
          <Input id="count" name="count" type="number" min="1" max="50" value={draft.count} aria-invalid={Boolean(errors.count)}
            aria-describedby={errors.count ? 'count-error' : undefined} onChange={(event) => setDraftField('count', event.target.value)} />
          {fieldError('count')}
        </div>

        {profile === 'airport' || profile === 'airport_arrival' ? (
          <div className="form-pair">
            {textField('flight', 'Flight number (optional)', { placeholder: 'HY601', maxLength: 40 })}
            {textField('luggage', 'Luggage (optional)', { placeholder: '2 large bags', maxLength: 80 })}
          </div>
        ) : null}

        <div className="form-divider"><span>Your details</span></div>

        <div className="form-field">
          <label htmlFor="guestName">{copy.nameLabel}</label>
          <Input id="guestName" name="guestName" value={draft.guestName} maxLength={REQUEST_FIELD_MAX_LENGTHS.guestName}
            aria-invalid={Boolean(errors.guestName)} aria-describedby={errors.guestName ? 'guestName-error' : undefined}
            onChange={(event) => setDraftField('guestName', event.target.value)} />
          {fieldError('guestName')}
        </div>

        <div className="form-field">
          <label htmlFor="contact">{copy.contactLabel}</label>
          <Input id="contact" name="contact" value={draft.contact} placeholder={copy.contactPlaceholder}
            maxLength={REQUEST_FIELD_MAX_LENGTHS.contact} aria-invalid={Boolean(errors.contact)}
            aria-describedby={errors.contact ? 'contact-error' : undefined}
            onChange={(event) => setDraftField('contact', event.target.value)} />
          {fieldError('contact')}
        </div>

        <div className="form-field">
          <label htmlFor="note">{copy.noteLabel}</label>
          <Textarea id="note" name="note" value={draft.note} maxLength={REQUEST_FIELD_MAX_LENGTHS.note}
            onChange={(event) => setDraftField('note', event.target.value)} />
        </div>

        <p className="form-legal">{copy.privacy}</p>
        <p className="form-legal">{copy.payment}</p>

        <Button className="submit-button" type="submit" disabled={submitting}>
          {submitting ? copy.sending : copy.submit}
        </Button>
      </form>
    </section>
  );
}
