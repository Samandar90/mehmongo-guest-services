import {
  isGuestLocale,
  REQUEST_FIELD_MAX_LENGTHS,
  type GuestLocale,
  type GuestRequestFields,
  type ServiceId,
} from './contracts.ts';
import {
  findOfferInAnyCatalog,
  offerIdPattern,
  profileRules,
  type CatalogOffer,
  type ProfileRules,
  type RequestProfile,
} from './catalog.ts';

export type ValidatedRequest = {
  roomToken: string;
  idempotencyKey: string;
  service: ServiceId;
  choice: string;
  pickup: string;
  destination: string;
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  contact: string;
  note: string;
  /** Catalogue offer the guest chose, or null for restaurant/custom/legacy requests. */
  offerId: string | null;
  /** Language the guest read the site in; English for a client that did not say. */
  guestLocale: GuestLocale;
  /** The nearest possible time instead of a named one; the date is then today in Tashkent. */
  asap: boolean;
};

const payloadKeys = ['roomToken', 'idempotencyKey', 'service', 'fields', 'website', 'offerId', 'guestLocale', 'asap'] as const;

/** Offer profiles that are a ride, where "as soon as possible" means something to a driver. */
const asapProfiles: ReadonlySet<RequestProfile> = new Set(['airport', 'airport_arrival', 'intercity']);
const fieldKeys = ['choice', 'pickup', 'destination', 'date', 'time', 'count', 'guestName', 'contact', 'note'] as const;
const services = new Set<ServiceId>(['tours', 'transport', 'restaurants', 'tickets']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const countPattern = /^(?:[1-9]|[1-4]\d|50)$/;

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[], name: string) {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) fail(`${name} contains an unknown field`);
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string') fail(`${name} must be a string`);
  return value;
}

function trimmed(value: unknown, name: string, maximum?: number): string {
  const normalized = string(value, name).trim();
  if (maximum !== undefined && normalized.length > maximum) fail(`${name} is too long`);
  return normalized;
}

function required(value: string, name: string) {
  if (!value) fail(`${name} is required`);
}

function validDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateFields(input: unknown): GuestRequestFields {
  const fields = record(input, 'fields');
  hasOnlyKeys(fields, fieldKeys, 'fields');

  return {
    choice: trimmed(fields.choice, 'fields.choice', REQUEST_FIELD_MAX_LENGTHS.choice),
    pickup: trimmed(fields.pickup, 'fields.pickup', REQUEST_FIELD_MAX_LENGTHS.pickup),
    destination: trimmed(fields.destination, 'fields.destination', REQUEST_FIELD_MAX_LENGTHS.destination),
    date: string(fields.date, 'fields.date'),
    time: string(fields.time, 'fields.time'),
    count: string(fields.count, 'fields.count'),
    guestName: trimmed(fields.guestName, 'fields.guestName', REQUEST_FIELD_MAX_LENGTHS.guestName),
    contact: trimmed(fields.contact, 'fields.contact', REQUEST_FIELD_MAX_LENGTHS.contact),
    note: trimmed(fields.note, 'fields.note', REQUEST_FIELD_MAX_LENGTHS.note),
  };
}

/**
 * Applies one profile field rule, returning the value to store. Fields a
 * profile does not use are cleared instead of carrying stray text.
 */
function applyRule(rule: ProfileRules[keyof ProfileRules], value: string, name: string): string {
  if (rule.use === 'unused') return '';
  if (rule.use === 'fixed') {
    if (value && value !== rule.value) fail(`${name} does not match this service`);
    return rule.value;
  }
  if (rule.use === 'optional') return value;
  required(value, name);
  if ('oneOf' in rule && !rule.oneOf.includes(value)) fail(`${name} is not one of the offered choices`);
  return value;
}

function validateOfferFields(offer: CatalogOffer, fields: GuestRequestFields, asap: boolean) {
  const rules = profileRules[offer.requestProfile];
  if (asap && !asapProfiles.has(offer.requestProfile)) fail('asap is not offered for this service');
  // An asap request names no time; the rule that would demand one is answered by the flag.
  const time = asap ? '' : applyRule(rules.time, fields.time, 'fields.time');
  if (time && !timePattern.test(time)) fail('fields.time must use 24-hour time');

  return {
    choice: applyRule(rules.choice, fields.choice, 'fields.choice'),
    pickup: applyRule(rules.pickup, fields.pickup, 'fields.pickup'),
    destination: applyRule(rules.destination, fields.destination, 'fields.destination'),
    time,
  };
}

function validateLegacyFields(service: ServiceId, fields: GuestRequestFields, asap: boolean) {
  if (asap && service !== 'transport') fail('asap is not offered for this service');
  if (fields.time && !timePattern.test(fields.time)) fail('fields.time must use 24-hour time');
  if (service === 'transport') {
    required(fields.pickup, 'fields.pickup');
    required(fields.destination, 'fields.destination');
  } else {
    required(fields.choice, 'fields.choice');
  }
  if ((service === 'transport' || service === 'restaurants') && !fields.time && !asap) fail('fields.time is required');

  return { choice: fields.choice, pickup: fields.pickup, destination: fields.destination, time: fields.time };
}

function validateAsap(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') fail('asap must be a boolean');
  return value;
}

/**
 * The date an asap request is for, decided here rather than on the phone: a
 * guest whose phone still runs on home time can be a day out at night.
 */
export function tashkentToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function validateOfferId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const offerId = string(value, 'offerId');
  if (!offerIdPattern.test(offerId)) fail('offerId is invalid');
  return offerId;
}

/** Older clients never sent a language; they were English. Anything unknown is refused, not guessed. */
function validateGuestLocale(value: unknown): GuestLocale {
  if (value === undefined || value === null) return 'en';
  if (!isGuestLocale(value)) fail('guestLocale is invalid');
  return value;
}

export function validateSubmitPayload(input: unknown): ValidatedRequest {
  const payload = record(input, 'payload');
  hasOnlyKeys(payload, payloadKeys, 'payload');

  const roomToken = string(payload.roomToken, 'roomToken');
  const idempotencyKey = string(payload.idempotencyKey, 'idempotencyKey');
  const service = string(payload.service, 'service');
  const website = string(payload.website, 'website');
  if (!uuidPattern.test(roomToken)) fail('roomToken must be a UUID');
  if (!uuidPattern.test(idempotencyKey)) fail('idempotencyKey must be a UUID');
  if (!services.has(service as ServiceId)) fail('service is invalid');
  if (website !== '') fail('website must be empty');

  const offerId = validateOfferId(payload.offerId);
  const guestLocale = validateGuestLocale(payload.guestLocale);
  const offer = offerId ? findOfferInAnyCatalog(offerId) : null;
  if (offerId && !offer) fail('offerId is not part of the catalogue');
  if (offer && offer.category !== service) fail('service does not match the offer');

  const asap = validateAsap(payload.asap);
  const fields = validateFields(payload.fields);
  if (asap) {
    if (fields.time) fail('fields.time must be empty for an asap request');
  } else {
    if (!validDate(fields.date)) fail('fields.date must be an ISO date');
    if (fields.date < new Date().toISOString().slice(0, 10)) fail('fields.date cannot be in the past');
  }
  if (!countPattern.test(fields.count)) fail('fields.count must be an integer from 1 to 50');
  required(fields.guestName, 'fields.guestName');
  required(fields.contact, 'fields.contact');

  const routed = offer
    ? validateOfferFields(offer, fields, asap)
    : validateLegacyFields(service as ServiceId, fields, asap);

  return {
    roomToken,
    idempotencyKey,
    service: service as ServiceId,
    choice: routed.choice,
    pickup: routed.pickup,
    destination: routed.destination,
    date: asap ? tashkentToday() : fields.date,
    time: routed.time,
    partySize: Number(fields.count),
    guestName: fields.guestName,
    contact: fields.contact,
    note: fields.note,
    offerId,
    guestLocale,
    asap,
  };
}
