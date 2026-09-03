/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from '@std/assert';
import { validateSubmitPayload } from './validation.ts';

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
