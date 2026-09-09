'use client';

import { ArrowLeft, CalendarClock, Zap } from 'lucide-react';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { offerPriceLabel } from '@/components/catalog/offer-card';
import { guestContact } from '@/lib/contact';
import { useI18n } from '@/lib/i18n/context';
import {
  airportDirections,
  arrivalDirection,
  exceedsOfferCapacity,
  mountainPreferences,
  ticketModes,
  type CatalogOffer,
  type GuestCatalog,
  type RequestProfile,
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

/** Rides, where "as soon as possible" is something a driver can act on. The server holds the same list. */
const asapProfiles: ReadonlySet<RequestProfile> = new Set(['airport', 'airport_arrival', 'intercity']);

/** Profiles whose pickup is, nine times out of ten, the hotel the guest is standing in. */
const hotelPickupProfiles: ReadonlySet<RequestProfile> = new Set(['city', 'intercity']);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Optional refinements travel as labelled lines in the shared note column.
 * The labels stay English: they are read by the team, not by the guest.
 */
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

export function OfferRequestForm({ offer, catalog, draft, hotelPickup = '', onDraftChange, onBack, onSubmit }: {
  offer: CatalogOffer;
  catalog: GuestCatalog;
  draft: CatalogDraft;
  /** "Hotel name, address" to start the pickup field with; the guest can change it. */
  hotelPickup?: string;
  onDraftChange: (draft: CatalogDraft) => void;
  onBack: () => void;
  onSubmit: (fields: GuestRequestFields, offerId: string, idempotencyKey: string, asap: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const copy = catalog.form;
  const labels = t.offerForm;
  const profile = offer.requestProfile;
  const asapOffered = asapProfiles.has(profile);
  const pickupFromHotel = hotelPickupProfiles.has(profile) && hotelPickup !== '';
  const [fields, setFields] = useState<OfferFields>(() => ({
    ...emptyOfferFields,
    pickup: pickupFromHotel ? hotelPickup : '',
  }));
  const [asap, setAsap] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => { if (submitError) errorRef.current?.focus(); }, [submitError]);

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

  const chooseAsap = (value: boolean) => {
    setAsap(value);
    idempotencyKeyRef.current = null;
    setSubmitError(null);
    setErrors((current) => ({ ...current, date: undefined, time: undefined }));
  };

  const validate = (): Errors => {
    const messages = labels.validation;
    const next: Errors = {};
    if (!asap) {
      if (!draft.date) next.date = messages.date;
      else if (draft.date < todayIso()) next.date = messages.futureDate;
    }
    const count = Number(draft.count);
    if (!Number.isInteger(count) || count < 1 || count > 50) next.count = messages.travellers;
    if (!draft.guestName.trim()) next.guestName = messages.name;
    if (!draft.contact.trim()) next.contact = messages.contact;

    if (profile === 'mountains' && !fields.choice) next.choice = messages.direction;
    if (profile === 'airport' && !fields.choice) next.choice = messages.direction;
    if (profile === 'tickets') {
      if (!fields.choice) next.choice = messages.travelMode;
      if (!fields.pickup.trim()) next.pickup = messages.start;
      if (!fields.destination.trim()) next.destination = messages.going;
    }
    if (profile === 'city' && !fields.pickup.trim()) next.pickup = messages.pickup;
    if (profile === 'intercity') {
      if (!fields.pickup.trim()) next.pickup = messages.tashkentPickup;
      if (!fields.destination.trim()) next.destination = messages.samarkandDestination;
    }
    if (asapOffered && !asap && !fields.time) next.time = messages.time;
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
      // An asap request carries no date or time: the server dates it in
      // Tashkent, where the guest is, rather than trusting a phone on home time.
      await onSubmit({
        choice: profile === 'airport_arrival' ? arrivalDirection : fields.choice,
        pickup: fields.pickup.trim(),
        destination: fields.destination.trim(),
        date: asap ? '' : draft.date,
        time: asap ? '' : fields.time,
        count: draft.count,
        guestName: draft.guestName.trim(),
        contact: draft.contact.trim(),
        note: buildNote(offer, fields, draft.note.trim()),
      }, offer.id, idempotencyKey, asap);
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

  const textField = (
    key: keyof OfferFields,
    label: string,
    options: { placeholder?: string; maxLength?: number; hint?: string } = {},
  ) => (
    <div className="form-field">
      <label htmlFor={key}>{label}</label>
      <Input
        id={key}
        name={key}
        value={fields[key]}
        placeholder={options.placeholder}
        maxLength={options.maxLength ?? REQUEST_FIELD_MAX_LENGTHS.choice}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `${key}-error` : options.hint ? `${key}-hint` : undefined}
        onChange={(event) => setOfferField(key, event.target.value)}
      />
      {fieldError(key)}
      {options.hint && !errors[key] ? <p className="form-hint" id={`${key}-hint`}>{options.hint}</p> : null}
    </div>
  );

  // The option text is the guest's language; the value sent is the English
  // one the server validates and the team reads.
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
        {choices.map((choice) => <option key={choice} value={choice}>{t.choices[choice] ?? choice}</option>)}
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

  const pickupHint = pickupFromHotel ? t.timing.pickupPrefilled : undefined;

  return (
    <section className="request-panel offer-form">
      <button className="back-button" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" /> {copy.back}</button>
      <p className="eyebrow">{offer.eyebrow}</p>
      <h1 className="form-title" ref={headingRef} tabIndex={-1}>{copy.title}</h1>
      <p className="offer-chosen">{offer.title}</p>
      <p className="offer-price-note">
        <strong>{overCapacity ? t.catalog.getQuote : offerPriceLabel(offer, t.catalog)}</strong>
        <span>{overCapacity || offer.price.mode === 'quote' ? copy.quoteLabel : copy.priceLabel}</span>
      </p>
      {overCapacity && offer.maxPassengers !== null ? (
        <output className="offer-capacity">{labels.seatsUpTo(offer.maxPassengers)}</output>
      ) : null}
      <p className="form-intro">{copy.intro}</p>

      <form onSubmit={submit} noValidate>
        {submitError ? <p className="field-error" role="alert" tabIndex={-1} ref={errorRef}>{submitError}</p> : null}

        {profile === 'mountains' ? selectField('choice', labels.whereTo, mountainPreferences, labels.chooseDirection) : null}
        {profile === 'airport' ? selectField('choice', labels.direction, airportDirections, labels.chooseDirection) : null}
        {profile === 'airport_arrival' ? (
          <p className="offer-fixed-field"><span>{labels.direction}</span><strong>{t.choices[arrivalDirection] ?? arrivalDirection}</strong></p>
        ) : null}
        {profile === 'tickets' ? selectField('choice', labels.travelBy, ticketModes, labels.chooseTravel) : null}
        {profile === 'tickets' ? (
          <div className="form-pair">
            {textField('pickup', labels.from, { placeholder: labels.cityOrStation, maxLength: REQUEST_FIELD_MAX_LENGTHS.pickup })}
            {textField('destination', labels.to, { placeholder: labels.cityOrStation, maxLength: REQUEST_FIELD_MAX_LENGTHS.destination })}
          </div>
        ) : null}
        {profile === 'city' ? textField('pickup', labels.cityPickup, { placeholder: labels.cityPickupPlaceholder, maxLength: REQUEST_FIELD_MAX_LENGTHS.pickup, hint: pickupHint }) : null}
        {profile === 'city' ? textField('choice', labels.cityPlaces, { placeholder: labels.cityPlacesPlaceholder }) : null}
        {profile === 'intercity' ? (
          <div className="form-pair">
            {textField('pickup', labels.intercityPickup, { placeholder: labels.hotelOrAddress, maxLength: REQUEST_FIELD_MAX_LENGTHS.pickup, hint: pickupHint })}
            {textField('destination', labels.intercityDestination, { placeholder: labels.hotelOrAddress, maxLength: REQUEST_FIELD_MAX_LENGTHS.destination })}
          </div>
        ) : null}
        {profile === 'guide' ? textField('choice', labels.interests, { placeholder: labels.interestsPlaceholder }) : null}
        {profile === 'guide' ? textField('language', labels.guideLanguage, { placeholder: labels.guideLanguagePlaceholder, maxLength: 60 }) : null}

        {asapOffered ? (
          <fieldset className="timing-choice">
            <legend>{t.timing.legend}</legend>
            <div className="timing-options">
              <button type="button" className="timing-option" aria-pressed={asap} onClick={() => chooseAsap(true)}>
                <Zap aria-hidden="true" />{t.timing.asap}
              </button>
              <button type="button" className="timing-option" aria-pressed={!asap} onClick={() => chooseAsap(false)}>
                <CalendarClock aria-hidden="true" />{t.timing.pickTime}
              </button>
            </div>
            {asap ? <p className="form-hint">{t.timing.asapHint}</p> : null}
          </fieldset>
        ) : null}

        {asap ? null : (
          <div className="form-pair">
            <div className="form-field">
              <label htmlFor="date">{copy.dateLabel}</label>
              <Input id="date" name="date" type="date" min={todayIso()} value={draft.date} aria-invalid={Boolean(errors.date)}
                aria-describedby={errors.date ? 'date-error' : undefined} onChange={(event) => setDraftField('date', event.target.value)} />
              {fieldError('date')}
            </div>
            {asapOffered ? timeField : null}
          </div>
        )}

        <div className="form-field">
          <label htmlFor="count">{copy.countLabel}</label>
          <Input id="count" name="count" type="number" min="1" max="50" value={draft.count} aria-invalid={Boolean(errors.count)}
            aria-describedby={errors.count ? 'count-error' : undefined} onChange={(event) => setDraftField('count', event.target.value)} />
          {fieldError('count')}
        </div>

        {profile === 'airport' || profile === 'airport_arrival' ? (
          <div className="form-pair">
            {textField('flight', labels.flight, { placeholder: 'HY601', maxLength: 40 })}
            {textField('luggage', labels.luggage, { placeholder: labels.luggagePlaceholder, maxLength: 80 })}
          </div>
        ) : null}

        <div className="form-divider"><span>{t.common.yourDetails}</span></div>

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
        <p className="form-legal">{t.common.replyPromise(guestContact.replyMinutes, guestContact.hoursFrom, guestContact.hoursTo)}</p>

        <Button className="submit-button" type="submit" disabled={submitting}>
          {submitting ? copy.sending : copy.submit}
        </Button>
      </form>
    </section>
  );
}
