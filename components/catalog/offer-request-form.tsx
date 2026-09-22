'use client';

import { ArrowLeft, Minus, Plus, Zap } from 'lucide-react';
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { OfferDetails } from '@/components/catalog/offer-details';
import { offerPriceLabel } from '@/components/catalog/offer-card';
import { guestContact } from '@/lib/contact';
import { tashkentDate } from '@/lib/guest-request';
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

/** The chips of the "when" row. */
type When = 'asap' | 'today' | 'tomorrow' | 'other';

const submitErrors = {
  ROOM_UNAVAILABLE: 'inactiveRoom',
  RATE_LIMITED: 'rateLimitError',
  REQUEST_FAILED: 'networkError',
} as const;

/** Rides, where "as soon as possible" is something a driver can act on. The server holds the same list. */
const asapProfiles: ReadonlySet<RequestProfile> = new Set(['airport', 'airport_arrival', 'intercity']);

/** Profiles whose pickup is, nine times out of ten, the hotel the guest is standing in. */
const hotelPickupProfiles: ReadonlySet<RequestProfile> = new Set(['city', 'intercity']);

const MIN_TRAVELLERS = 1;
const MAX_TRAVELLERS = 50;

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

type ChoiceOption<V extends string> = { value: V; label: ReactNode };

/**
 * One choice as a row of buttons, one tap each instead of a list to open.
 * They are native radios under a visible face, so the arrow keys and screen
 * readers treat them as the single choice they are.
 */
function ChoiceGroup<V extends string>({ name, legend, options, value, describedBy, onChoose, children }: {
  name: string;
  legend: string;
  options: readonly ChoiceOption<V>[];
  value: V | null;
  describedBy?: string;
  onChoose: (value: V) => void;
  /** A hint or an error under the options. */
  children?: ReactNode;
}) {
  return (
    <fieldset className="choice-group" aria-describedby={describedBy}>
      <legend>{legend}</legend>
      <div className="choice-options" data-columns={options.length === 3 ? 3 : 2}>
        {options.map((option) => (
          <label key={option.value} className="choice-option">
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChoose(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {children}
    </fieldset>
  );
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
  // "Other date" stays chosen even when the date typed under it is today's.
  const [otherDate, setOtherDate] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => { if (submitError) errorRef.current?.focus(); }, [submitError]);

  const today = tashkentDate(0);
  const tomorrow = tashkentDate(1);
  // A date kept from another service shows under the chip it matches.
  const when: When | null = asap ? 'asap'
    : otherDate ? 'other'
    : draft.date === today ? 'today'
    : draft.date === tomorrow ? 'tomorrow'
    : draft.date ? 'other'
    : null;

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

  const chooseWhen = (next: When) => {
    setAsap(next === 'asap');
    setOtherDate(next === 'other');
    if (next === 'today' || next === 'tomorrow') onDraftChange({ ...draft, date: next === 'today' ? today : tomorrow });
    idempotencyKeyRef.current = null;
    setSubmitError(null);
    setErrors((current) => ({ ...current, date: undefined, ...(next === 'asap' ? { time: undefined } : {}) }));
  };

  const stepTravellers = (delta: number) => {
    const current = Number.parseInt(draft.count, 10);
    const next = (Number.isInteger(current) ? current : MIN_TRAVELLERS) + delta;
    setDraftField('count', String(Math.min(MAX_TRAVELLERS, Math.max(MIN_TRAVELLERS, next))));
  };

  const validate = (): Errors => {
    const messages = labels.validation;
    const next: Errors = {};
    if (!asap) {
      if (!draft.date) next.date = messages.date;
      else if (draft.date < today) next.date = messages.futureDate;
    }
    const count = Number(draft.count);
    if (!Number.isInteger(count) || count < MIN_TRAVELLERS || count > MAX_TRAVELLERS) next.count = messages.travellers;
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
    options: { placeholder?: string; maxLength?: number; hint?: string; autoComplete?: string } = {},
  ) => (
    <div className="form-field">
      <label htmlFor={key}>{label}</label>
      <Input
        id={key}
        name={key}
        value={fields[key]}
        placeholder={options.placeholder}
        maxLength={options.maxLength ?? REQUEST_FIELD_MAX_LENGTHS.choice}
        autoComplete={options.autoComplete}
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
  const choiceField = (label: string, choices: readonly string[]) => (
    <ChoiceGroup
      name="choice"
      legend={label}
      options={choices.map((choice) => ({ value: choice, label: t.choices[choice] ?? choice }))}
      value={fields.choice}
      describedBy={errors.choice ? 'choice-error' : undefined}
      onChoose={(choice) => setOfferField('choice', choice)}
    >
      {fieldError('choice')}
    </ChoiceGroup>
  );

  const whenOptions: ChoiceOption<When>[] = [
    ...(asapOffered ? [{ value: 'asap' as const, label: <><Zap aria-hidden="true" />{t.timing.asap}</> }] : []),
    { value: 'today', label: labels.today },
    { value: 'tomorrow', label: labels.tomorrow },
    { value: 'other', label: labels.otherDate },
  ];

  const whenField = (
    <ChoiceGroup
      name="when"
      legend={asapOffered ? t.timing.legend : labels.whichDay}
      options={whenOptions}
      value={when}
      describedBy={errors.date && when !== 'other' ? 'date-error' : undefined}
      onChoose={chooseWhen}
    >
      {asap ? <p className="form-hint">{t.timing.asapHint}</p> : null}
      {when === 'other' ? null : fieldError('date')}
    </ChoiceGroup>
  );

  const dateField = (
    <div className="form-field">
      <label htmlFor="date">{copy.dateLabel}</label>
      <Input id="date" name="date" type="date" min={today} value={draft.date} aria-invalid={Boolean(errors.date)}
        aria-describedby={errors.date ? 'date-error' : undefined} onChange={(event) => setDraftField('date', event.target.value)} />
      {fieldError('date')}
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
  const showDate = !asap && when === 'other';
  const showTime = !asap && asapOffered;

  return (
    <section className="request-panel offer-form">
      <button className="back-button" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" /> {t.common.backToServices}</button>
      <p className="eyebrow">{offer.eyebrow}</p>
      <h1 className="form-title" ref={headingRef} tabIndex={-1}>{offer.title}</h1>
      <p className="offer-price-note">
        <strong>{overCapacity ? t.catalog.getQuote : offerPriceLabel(offer, t.catalog)}</strong>
        <span>{overCapacity || offer.price.mode === 'quote' ? copy.quoteLabel : copy.priceLabel}</span>
      </p>
      {overCapacity && offer.maxPassengers !== null ? (
        <output className="offer-capacity">{labels.seatsUpTo(offer.maxPassengers)}</output>
      ) : null}
      <OfferDetails offer={offer} />

      <form onSubmit={submit} noValidate>
        {submitError ? <p className="field-error" role="alert" tabIndex={-1} ref={errorRef}>{submitError}</p> : null}

        {profile === 'mountains' ? choiceField(labels.whereTo, mountainPreferences) : null}
        {profile === 'airport' ? choiceField(labels.direction, airportDirections) : null}
        {profile === 'airport_arrival' ? (
          <p className="offer-fixed-field"><span>{labels.direction}</span><strong>{t.choices[arrivalDirection] ?? arrivalDirection}</strong></p>
        ) : null}
        {profile === 'tickets' ? choiceField(labels.travelBy, ticketModes) : null}
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

        {whenField}
        {showDate || showTime ? (
          <div className="form-pair">
            {showDate ? dateField : null}
            {showTime ? timeField : null}
          </div>
        ) : null}

        <div className="form-field">
          <label htmlFor="count">{copy.countLabel}</label>
          <div className="stepper">
            <button className="stepper-button" type="button" aria-label={labels.fewerTravellers} aria-controls="count" onClick={() => stepTravellers(-1)}>
              <Minus aria-hidden="true" />
            </button>
            <Input id="count" name="count" type="number" inputMode="numeric" min={MIN_TRAVELLERS} max={MAX_TRAVELLERS} value={draft.count}
              aria-invalid={Boolean(errors.count)} aria-describedby={errors.count ? 'count-error' : undefined}
              onChange={(event) => setDraftField('count', event.target.value)} />
            <button className="stepper-button" type="button" aria-label={labels.moreTravellers} aria-controls="count" onClick={() => stepTravellers(1)}>
              <Plus aria-hidden="true" />
            </button>
          </div>
          {fieldError('count')}
        </div>

        {profile === 'airport' || profile === 'airport_arrival' ? (
          <div className="form-pair">
            {textField('flight', labels.flight, { placeholder: 'HY601', maxLength: 40, autoComplete: 'off' })}
            {textField('luggage', labels.luggage, { placeholder: labels.luggagePlaceholder, maxLength: 80 })}
          </div>
        ) : null}

        <div className="form-divider"><span>{t.common.yourDetails}</span></div>

        <div className="form-field">
          <label htmlFor="guestName">{copy.nameLabel}</label>
          <Input id="guestName" name="guestName" autoComplete="name" value={draft.guestName} maxLength={REQUEST_FIELD_MAX_LENGTHS.guestName}
            aria-invalid={Boolean(errors.guestName)} aria-describedby={errors.guestName ? 'guestName-error' : undefined}
            onChange={(event) => setDraftField('guestName', event.target.value)} />
          {fieldError('guestName')}
        </div>

        {/* The phone offers the guest's number; the field still takes a Telegram @username or an email. */}
        <div className="form-field">
          <label htmlFor="contact">{copy.contactLabel}</label>
          <Input id="contact" name="contact" autoComplete="tel" value={draft.contact} placeholder={copy.contactPlaceholder}
            maxLength={REQUEST_FIELD_MAX_LENGTHS.contact} aria-invalid={Boolean(errors.contact)}
            aria-describedby={errors.contact ? 'contact-error' : 'contact-hint'}
            onChange={(event) => setDraftField('contact', event.target.value)} />
          {fieldError('contact')}
          {errors.contact ? null : <p className="form-hint" id="contact-hint">{copy.privacy}</p>}
        </div>

        <div className="form-field">
          <label htmlFor="note">{copy.noteLabel}</label>
          <Textarea id="note" name="note" value={draft.note} maxLength={REQUEST_FIELD_MAX_LENGTHS.note}
            onChange={(event) => setDraftField('note', event.target.value)} />
        </div>

        <Button className="submit-button" type="submit" disabled={submitting}>
          {submitting ? copy.sending : copy.submit}
        </Button>
        <p className="form-legal">
          {copy.payment} {t.common.replyPromise(guestContact.replyMinutes, guestContact.hoursFrom, guestContact.hoursTo)}
        </p>
      </form>
    </section>
  );
}
