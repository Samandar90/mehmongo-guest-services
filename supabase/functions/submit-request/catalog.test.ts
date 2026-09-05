/// <reference lib="deno.ns" />

import { assertEquals } from '@std/assert';
import { handler, type InsertRequest, type SubmitRequestDependencies } from './index.ts';
import { formatTelegramRequest, type TelegramRequest } from '../_shared/telegram.ts';

const ROOM_TOKEN = '20000000-0000-4000-8000-000000000205';

function catalogRequest(offerId: string | null, fields: Record<string, string> = {}) {
  return new Request('http://local/submit-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      roomToken: ROOM_TOKEN,
      idempotencyKey: crypto.randomUUID(),
      service: 'transport',
      fields: {
        choice: 'Airport → hotel',
        pickup: '',
        destination: '',
        date: '2099-12-31',
        time: '09:30',
        count: '2',
        guestName: 'Alex',
        contact: '+998901234567',
        note: '',
        ...fields,
      },
      website: '',
      offerId,
    }),
  });
}

function dependencies(catalogId: string | null) {
  const atomicCalls: InsertRequest[] = [];
  const telegramMessages: TelegramRequest[] = [];

  return {
    atomicCalls,
    telegramMessages,
    dependencies: {
      repository: {
        findByIdempotencyKey: () => Promise.resolve(null),
        findActiveRoom: () => Promise.resolve({
          id: '30000000-0000-4000-8000-000000000003',
          hotelId: '30000000-0000-4000-8000-000000000001',
          catalogId,
        }),
        submitAtomically: (request: InsertRequest) => {
          atomicCalls.push(request);
          return Promise.resolve({
            kind: 'created' as const,
            request: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-CATALOG2' },
          });
        },
        findByReference: () => Promise.resolve({
          id: '40000000-0000-4000-8000-000000000004',
          reference: 'MG-CATALOG2',
          hotelName: 'Kamilovs Hotel',
          roomLabel: '205',
          service: 'transport' as const,
          choice: 'Airport → hotel',
          pickup: '',
          destination: '',
          requestedDate: '2099-12-31',
          requestedTime: '09:30',
          partySize: 2,
          guestName: 'Alex',
          contact: '+998901234567',
          note: '',
          offer: atomicCalls[0]?.offerSnapshot ?? null,
        }),
        findDelivery: () => Promise.resolve({ id: '50000000-0000-4000-8000-000000000005', attempt: 1, status: 'pending' as const }),
        completeDelivery: () => Promise.resolve(true),
        failDelivery: () => Promise.resolve(true),
      },
      requestHashSecret: 'test-request-hash-secret',
      referenceFactory: () => 'MG-CATALOG2',
      telegramSender: (request: TelegramRequest) => {
        telegramMessages.push(request);
        return Promise.resolve({ messageId: 1 });
      },
    } as unknown as SubmitRequestDependencies,
  };
}

Deno.test('the server builds the offer snapshot from its own catalogue', async () => {
  const context = dependencies('tashkent-v1');

  const response = await handler(catalogRequest('tashkent-airport-sedan'), context.dependencies);

  assertEquals(response.status, 201);
  assertEquals(context.atomicCalls[0].offerId, 'tashkent-airport-sedan');
  assertEquals(context.atomicCalls[0].offerSnapshot, {
    offerId: 'tashkent-airport-sedan',
    catalogId: 'tashkent-v1',
    catalogVersion: 'mehmongo-tashkent-2026-09-05-final',
    title: 'Your airport ride, arranged',
    category: 'transport',
    requestProfile: 'airport',
    priceMode: 'from',
    amount: 30,
    currency: 'USD',
    unit: 'per vehicle · one way',
    capacityExceeded: false,
  });
});

Deno.test('a party larger than the vehicle is stored as an individual quote', async () => {
  const context = dependencies('tashkent-v1');

  await handler(catalogRequest('tashkent-airport-sedan', { count: '5' }), context.dependencies);

  assertEquals(context.atomicCalls[0].offerSnapshot?.priceMode, 'quote');
  assertEquals(context.atomicCalls[0].offerSnapshot?.amount, null);
  assertEquals(context.atomicCalls[0].offerSnapshot?.capacityExceeded, true);
});

Deno.test('an offer is refused when the hotel is not on the catalogue', async () => {
  const context = dependencies(null);

  const response = await handler(catalogRequest('tashkent-airport-sedan'), context.dependencies);

  assertEquals(response.status, 409);
  assertEquals(await response.json(), { code: 'OFFER_UNAVAILABLE' });
  assertEquals(context.atomicCalls.length, 0);
});

Deno.test('the Telegram message carries the offer title and the starting price', async () => {
  const context = dependencies('tashkent-v1');
  await handler(catalogRequest('tashkent-airport-sedan'), context.dependencies);

  const text = formatTelegramRequest(context.telegramMessages[0], 'Asia/Tashkent');

  assertEquals(text.includes('🧾 Предложение: Your airport ride, arranged'), true);
  assertEquals(text.includes('💵 Ориентир: от 30 USD (per vehicle · one way). Цена не подтверждена'), true);
  assertEquals(text.includes('🔎 Выбор: Airport → hotel'), true);
});

Deno.test('a request without an offer sends no estimate line', async () => {
  const context = dependencies('tashkent-v1');
  await handler(
    new Request('http://local/submit-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        roomToken: ROOM_TOKEN,
        idempotencyKey: crypto.randomUUID(),
        service: 'restaurants',
        fields: {
          choice: 'Plov for four', pickup: '', destination: '', date: '2099-12-31', time: '19:00',
          count: '4', guestName: 'Alex', contact: '+998901234567', note: '',
        },
        website: '',
      }),
    }),
    context.dependencies,
  );

  assertEquals(context.atomicCalls[0].offerId, null);
  assertEquals(context.atomicCalls[0].offerSnapshot, null);
  assertEquals(formatTelegramRequest(context.telegramMessages[0], 'Asia/Tashkent').includes('💵 Ориентир'), false);
});
