/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from '@std/assert';
import { validateSubmitPayload } from './validation.ts';

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const emptyFields = {
  choice: '',
  pickup: '',
  destination: '',
  date: tomorrow,
  time: '',
  count: '2',
  guestName: 'Alex',
  contact: '+998901234567',
  note: '',
};

function payload(offerId: string | null, service: string, fields: Partial<typeof emptyFields> = {}) {
  return {
    roomToken: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    service,
    fields: { ...emptyFields, ...fields },
    website: '',
    offerId,
  };
}

Deno.test('a catalogue request keeps the offer id', () => {
  const request = validateSubmitPayload(payload('tashkent-airport-sedan', 'transport', {
    choice: 'Airport → hotel',
    time: '09:30',
  }));

  assertEquals(request.offerId, 'tashkent-airport-sedan');
  assertEquals(request.service, 'transport');
});

Deno.test('a request without an offer stays supported', () => {
  const request = validateSubmitPayload({
    roomToken: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    service: 'restaurants',
    fields: { ...emptyFields, choice: 'Plov', time: '19:00' },
    website: '',
  });

  assertEquals(request.offerId, null);
});

Deno.test('an unknown offer id is rejected', () => {
  assertThrows(() => validateSubmitPayload(payload('made-up-offer', 'transport', { choice: 'Airport → hotel', time: '09:30' })));
});

Deno.test('the service must match the category of the offer', () => {
  assertThrows(() => validateSubmitPayload(payload('tashkent-airport-sedan', 'tours', { choice: 'Airport → hotel', time: '09:30' })));
});

Deno.test('the guide profile asks for a date and a party size, not a free-text choice', () => {
  const request = validateSubmitPayload(payload('tashkent-private-guide', 'tours'));
  assertEquals(request.choice, '');
  assertEquals(request.partySize, 2);

  assertThrows(() => validateSubmitPayload(payload('tashkent-private-guide', 'tours', { guestName: '' })));
});

Deno.test('the city profile asks for a meeting point and no time', () => {
  const request = validateSubmitPayload(payload('tashkent-city-car', 'tours', { pickup: 'Hotel lobby' }));
  assertEquals(request.pickup, 'Hotel lobby');
  assertEquals(request.time, '');

  assertThrows(() => validateSubmitPayload(payload('tashkent-city-car', 'tours')));
});

Deno.test('the mountains profile asks for a route preference', () => {
  const request = validateSubmitPayload(payload('tashkent-mountains-base', 'tours', { choice: 'Charvak' }));
  assertEquals(request.choice, 'Charvak');

  assertThrows(() => validateSubmitPayload(payload('tashkent-mountains-base', 'tours')));
  assertThrows(() => validateSubmitPayload(payload('tashkent-mountains-base', 'tours', { choice: 'Everest base camp' })));
});

Deno.test('the airport profile asks for a direction and a time', () => {
  const request = validateSubmitPayload(payload('tashkent-airport-minivan', 'transport', {
    choice: 'Hotel → airport',
    time: '05:15',
  }));
  assertEquals(request.choice, 'Hotel → airport');

  assertThrows(() => validateSubmitPayload(payload('tashkent-airport-minivan', 'transport', { choice: 'Hotel → airport' })));
  assertThrows(() => validateSubmitPayload(payload('tashkent-airport-minivan', 'transport', { time: '05:15' })));
  assertThrows(() => validateSubmitPayload(payload('tashkent-airport-minivan', 'transport', { choice: 'Somewhere else', time: '05:15' })));
});

Deno.test('the arrival package fixes the direction to airport pickup', () => {
  const request = validateSubmitPayload(payload('tashkent-airport-welcome', 'transport', { time: '23:40' }));
  assertEquals(request.choice, 'Airport → hotel');
});

Deno.test('the intercity profile asks for both addresses and a time', () => {
  const request = validateSubmitPayload(payload('tashkent-samarkand-one-way', 'tours', {
    pickup: 'Hotel Uzbekistan',
    destination: 'Registan area hotel',
    time: '08:00',
  }));
  assertEquals(request.destination, 'Registan area hotel');

  assertThrows(() => validateSubmitPayload(payload('tashkent-samarkand-one-way', 'tours', { pickup: 'Hotel', time: '08:00' })));
});

Deno.test('the ticket profile asks for a travel mode and a route without a time', () => {
  const request = validateSubmitPayload(payload('ticket-assistance', 'tickets', {
    choice: 'Flight',
    pickup: 'Tashkent',
    destination: 'Istanbul',
  }));
  assertEquals(request.choice, 'Flight');
  assertEquals(request.destination, 'Istanbul');

  assertThrows(() => validateSubmitPayload(payload('ticket-assistance', 'tickets', { pickup: 'Tashkent', destination: 'Istanbul' })));
  assertThrows(() => validateSubmitPayload(payload('ticket-assistance', 'tickets', { choice: 'Rocket', pickup: 'Tashkent', destination: 'Istanbul' })));
  assertThrows(() => validateSubmitPayload(payload('ticket-assistance', 'tickets', { choice: 'Flight', pickup: 'Tashkent' })));
});

Deno.test('a party larger than the vehicle is still accepted for an individual quote', () => {
  const request = validateSubmitPayload(payload('tashkent-airport-sedan', 'transport', {
    choice: 'Airport → hotel',
    time: '09:30',
    count: '6',
  }));

  assertEquals(request.partySize, 6);
});

Deno.test('an offer id of the wrong shape is rejected', () => {
  assertThrows(() => validateSubmitPayload(payload('../../etc/passwd', 'transport', { choice: 'Airport → hotel', time: '09:30' })));
  assertThrows(() => validateSubmitPayload({ ...payload(null, 'transport', { pickup: 'A', destination: 'B', time: '09:30' }), offerId: 42 }));
});
