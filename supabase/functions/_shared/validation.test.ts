/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from '@std/assert';
import { tashkentToday, validateSubmitPayload } from './validation.ts';

const validFields = {
  choice: '',
  pickup: 'Hotel',
  destination: 'Airport',
  date: new Date().toISOString().slice(0, 10),
  time: '14:30',
  count: '2',
  guestName: 'Alex',
  contact: '+998901234567',
  note: '',
};

function validTransportPayload() {
  return {
    roomToken: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    service: 'transport',
    fields: { ...validFields },
    website: '',
  };
}

Deno.test('transport requires pickup and destination', () => {
  assertThrows(() => validateSubmitPayload({
    ...validTransportPayload(),
    fields: { ...validFields, pickup: '', destination: '' },
  }));
});

Deno.test('normalizes a valid transport request', () => {
  const request = validateSubmitPayload({
    ...validTransportPayload(),
    fields: {
      ...validFields,
      pickup: ' Hotel ',
      destination: ' Airport ',
      guestName: ' Alex ',
      contact: ' +998 90 123 45 67 ',
    },
  });

  assertEquals(request.partySize, 2);
  assertEquals(request.pickup, 'Hotel');
  assertEquals(request.destination, 'Airport');
  assertEquals(request.guestName, 'Alex');
  assertEquals(request.contact, '+998 90 123 45 67');
});

Deno.test('rejects unrecognized payload and field properties', () => {
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), extra: 'nope' }));
  assertThrows(() => validateSubmitPayload({
    ...validTransportPayload(),
    fields: { ...validFields, extra: 'nope' },
  }));
});

Deno.test('rejects malformed identifiers and non-empty honeypot content', () => {
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), roomToken: 'not-a-uuid' }));
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), idempotencyKey: 'not-a-uuid' }));
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), website: ' ' }));
});

Deno.test('requires strict current-or-future ISO dates and 24-hour times', () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), fields: { ...validFields, date: yesterday } }));
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), fields: { ...validFields, date: '2026-9-2' } }));
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), fields: { ...validFields, date: '2026-02-30' } }));
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), fields: { ...validFields, time: '4:30' } }));
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), fields: { ...validFields, time: '24:00' } }));
});

Deno.test('requires a whole party size from one to fifty', () => {
  for (const count of ['0', '51', '2.5', '1e1', '+2', '-2', ' 2', '2 ']) {
    assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), fields: { ...validFields, count } }));
  }
});

Deno.test('enforces category requirements and configured field lengths after trimming', () => {
  const restaurant = validateSubmitPayload({
    ...validTransportPayload(),
    service: 'restaurants',
    fields: { ...validFields, choice: ' Table ', pickup: '', destination: '' },
  });
  assertEquals(restaurant.choice, 'Table');
  assertThrows(() => validateSubmitPayload({
    ...validTransportPayload(),
    service: 'restaurants',
    fields: { ...validFields, choice: 'Table', time: '', pickup: '', destination: '' },
  }));
  assertThrows(() => validateSubmitPayload({
    ...validTransportPayload(),
    fields: { ...validFields, pickup: 'x'.repeat(201) },
  }));
  assertThrows(() => validateSubmitPayload({
    ...validTransportPayload(),
    fields: { ...validFields, guestName: 'x'.repeat(121) },
  }));
  assertThrows(() => validateSubmitPayload({
    ...validTransportPayload(),
    fields: { ...validFields, note: 'x'.repeat(1001) },
  }));
});

Deno.test('a client that does not say its language is English', () => {
  assertEquals(validateSubmitPayload(validTransportPayload()).guestLocale, 'en');
  assertEquals(validateSubmitPayload({ ...validTransportPayload(), guestLocale: null }).guestLocale, 'en');
});

Deno.test('keeps the language the guest was reading', () => {
  assertEquals(validateSubmitPayload({ ...validTransportPayload(), guestLocale: 'zh' }).guestLocale, 'zh');
  assertEquals(validateSubmitPayload({ ...validTransportPayload(), guestLocale: 'uz' }).guestLocale, 'uz');
});

Deno.test('refuses a language the site does not speak', () => {
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), guestLocale: 'de' }));
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), guestLocale: 'EN' }));
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), guestLocale: 7 }));
});

Deno.test('an as-soon-as-possible transfer needs no time and is dated today in Tashkent', () => {
  const request = validateSubmitPayload({
    ...validTransportPayload(),
    fields: { ...validFields, date: '', time: '' },
    asap: true,
  });
  assertEquals(request.asap, true);
  assertEquals(request.time, '');
  assertEquals(request.date, tashkentToday());
});

Deno.test('an as-soon-as-possible request may not also name a time', () => {
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), asap: true }));
});

Deno.test('as soon as possible is offered for rides only', () => {
  assertThrows(() => validateSubmitPayload({
    ...validTransportPayload(),
    service: 'tours',
    fields: { ...validFields, choice: 'Old city', time: '' },
    asap: true,
  }));
  assertThrows(() => validateSubmitPayload({
    ...validTransportPayload(),
    service: 'tours',
    offerId: 'tashkent-private-guide',
    fields: { ...validFields, pickup: '', destination: '', time: '' },
    asap: true,
  }));
  const airport = validateSubmitPayload({
    ...validTransportPayload(),
    offerId: 'tashkent-airport-sedan',
    fields: { ...validFields, choice: 'Airport → hotel', pickup: '', destination: '', time: '' },
    asap: true,
  });
  assertEquals(airport.asap, true);
  assertEquals(airport.time, '');
});

Deno.test('asap must be a boolean when present, and defaults to false', () => {
  assertEquals(validateSubmitPayload(validTransportPayload()).asap, false);
  assertThrows(() => validateSubmitPayload({ ...validTransportPayload(), asap: 'yes' }));
});

Deno.test('tashkentToday follows the +05:00 calendar', () => {
  assertEquals(tashkentToday(new Date('2026-09-10T20:30:00.000Z')), '2026-09-11');
  assertEquals(tashkentToday(new Date('2026-09-10T18:30:00.000Z')), '2026-09-10');
});
