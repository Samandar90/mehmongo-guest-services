/// <reference lib="deno.ns" />

import { assertEquals, assertStringIncludes } from '@std/assert';
import {
  createRepository,
  handler,
  type InsertRequest,
  type InsertResult,
  type SubmitRequestClient,
  type SubmitRequestDependencies,
} from './index.ts';

const ROOM_TOKEN = '20000000-0000-4000-8000-000000000205';
const IDEMPOTENCY_KEY = '10000000-0000-4000-8000-000000000001';
const ACTIVE_ROOM = {
  id: '30000000-0000-4000-8000-000000000003',
  hotelId: '30000000-0000-4000-8000-000000000001',
};

type DependencyOptions = {
  activeRoom?: typeof ACTIVE_ROOM | null;
  existingReference?: string;
  existingTelegramStatus?: 'sent' | 'failed';
  recentMatchingRequests?: number;
  insertResults?: Array<'inserted' | 'idempotency_conflict' | 'reference_conflict'>;
  insertedReference?: string;
  insertedTelegramStatus?: 'sent' | 'failed';
  countRecentError?: Error;
};

function validSubmitRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request('http://local/submit-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      roomToken: ROOM_TOKEN,
      idempotencyKey: IDEMPOTENCY_KEY,
      service: 'transport',
      fields: {
        choice: '',
        pickup: 'Kamilovs Hotel',
        destination: 'Samarkand Airport',
        date: '2099-12-31',
        time: '14:30',
        count: '2',
        guestName: 'Alex',
        contact: '+998 90 123 45 67',
        note: '',
      },
      website: '',
      ...overrides,
    }),
  });
}

function requestDependencies(options: DependencyOptions = {}) {
  const findByIdempotencyCalls: string[] = [];
  const findActiveRoomCalls: string[] = [];
  const countRecentCalls: Array<{ rateKey: string; windowMs: number }> = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  let idempotencyReads = 0;
  let insertReads = 0;

  const repository: SubmitRequestDependencies['repository'] = {
    findByIdempotencyKey: (idempotencyKey: string) => {
      findByIdempotencyCalls.push(idempotencyKey);
      idempotencyReads += 1;
      if (!options.existingReference || idempotencyReads === 1) return Promise.resolve(null);
      return Promise.resolve({
        reference: options.existingReference,
        telegramStatus: options.existingTelegramStatus ?? 'failed',
      });
    },
    findActiveRoom: (roomToken: string) => {
      findActiveRoomCalls.push(roomToken);
      return Promise.resolve(options.activeRoom === undefined ? ACTIVE_ROOM : options.activeRoom);
    },
    countRecent: (rateKey: string, windowMs: number) => {
      countRecentCalls.push({ rateKey, windowMs });
      if (options.countRecentError) return Promise.reject(options.countRecentError);
      return Promise.resolve(options.recentMatchingRequests ?? 0);
    },
    insertRequest: (request: InsertRequest): Promise<InsertResult> => {
      insertCalls.push(request);
      const result = options.insertResults?.[insertReads] ?? 'inserted';
      insertReads += 1;
      if (result !== 'inserted') return Promise.resolve({ kind: result });
      return Promise.resolve({
        kind: 'inserted' as const,
        request: {
          reference: options.insertedReference ?? 'MG-ABCDEFGH',
          telegramStatus: options.insertedTelegramStatus ?? 'sent',
        },
      });
    },
  };

  return {
    repository,
    requestHashSecret: 'test-request-hash-secret',
    referenceFactory: (() => {
      let referenceNumber = 0;
      return () => `MG-TEST${String(referenceNumber += 1).padStart(4, '0')}`;
    })(),
    findByIdempotencyCalls,
    findActiveRoomCalls,
    countRecentCalls,
    insertCalls,
  };
}

Deno.test('stores one request and returns its reference', async () => {
  const dependencies = requestDependencies({ insertedReference: 'MG-ABCDEFGH' });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 201);
  assertEquals(await response.json(), { reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
  assertEquals(dependencies.insertCalls.length, 1);
  assertEquals(dependencies.findActiveRoomCalls, [ROOM_TOKEN]);
  assertEquals(dependencies.countRecentCalls[0].windowMs, 10 * 60_000);
  assertEquals(dependencies.insertCalls[0].reference, 'MG-TEST0001');
  assertEquals(dependencies.insertCalls[0].room, ACTIVE_ROOM);
  assertEquals(dependencies.insertCalls[0].contact, '+998 90 123 45 67');
  assertEquals(typeof dependencies.insertCalls[0].rateKey, 'string');
  assertEquals((dependencies.insertCalls[0].rateKey as string).includes('99890'), false);
});

Deno.test('returns existing request for duplicate idempotency key', async () => {
  const dependencies = requestDependencies({ existingReference: 'MG-EXISTING', existingTelegramStatus: 'failed' });
  dependencies.repository.findByIdempotencyKey = (idempotencyKey: string) => {
    dependencies.findByIdempotencyCalls.push(idempotencyKey);
    return Promise.resolve({ reference: 'MG-EXISTING', telegramStatus: 'failed' });
  };

  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { reference: 'MG-EXISTING', telegramStatus: 'failed' });
  assertEquals(dependencies.insertCalls.length, 0);
  assertEquals(dependencies.findActiveRoomCalls.length, 0);
});

Deno.test('rejects sixth matching request in ten minutes', async () => {
  const dependencies = requestDependencies({ recentMatchingRequests: 5 });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 429);
  assertEquals(await response.json(), { code: 'RATE_LIMITED' });
  assertEquals(dependencies.insertCalls.length, 0);
});

Deno.test('rejects inactive room before insert', async () => {
  const dependencies = requestDependencies({ activeRoom: null });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { code: 'ROOM_UNAVAILABLE' });
  assertEquals(dependencies.insertCalls.length, 0);
  assertEquals(dependencies.countRecentCalls.length, 0);
});

Deno.test('returns the raced idempotent request after a unique conflict', async () => {
  const dependencies = requestDependencies({
    existingReference: 'MG-RACED123',
    insertResults: ['idempotency_conflict'],
  });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { reference: 'MG-RACED123', telegramStatus: 'failed' });
  assertEquals(dependencies.findByIdempotencyCalls, [IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
  assertEquals(dependencies.insertCalls.length, 1);
});

Deno.test('retries a unique reference collision with a new reference', async () => {
  const dependencies = requestDependencies({ insertResults: ['reference_conflict', 'inserted'] });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 201);
  assertEquals(dependencies.insertCalls.length, 2);
  assertEquals(dependencies.insertCalls.map((call) => call.reference), ['MG-TEST0001', 'MG-TEST0002']);
});

Deno.test('fails safely after bounded reference collisions', async () => {
  const dependencies = requestDependencies({
    insertResults: ['reference_conflict', 'reference_conflict', 'reference_conflict'],
  });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { code: 'REQUEST_FAILED' });
  assertEquals(dependencies.insertCalls.length, 3);
});

Deno.test('accepts only POST JSON requests and supports POST preflight', async () => {
  const dependencies = requestDependencies();
  const optionsResponse = await handler(new Request('http://local/submit-request', { method: 'OPTIONS' }), dependencies);
  const getResponse = await handler(new Request('http://local/submit-request'), dependencies);
  const textResponse = await handler(new Request('http://local/submit-request', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  }), dependencies);

  assertEquals(optionsResponse.status, 204);
  assertStringIncludes(optionsResponse.headers.get('access-control-allow-methods') ?? '', 'POST');
  assertEquals(getResponse.status, 405);
  assertEquals(textResponse.status, 400);
  assertEquals(dependencies.findByIdempotencyCalls.length, 0);
});

Deno.test('rejects media types that only contain the JSON token', async () => {
  const dependencies = requestDependencies();
  const request = validSubmitRequest();
  request.headers.set('content-type', 'application/jsonp');

  const response = await handler(request, dependencies);

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { code: 'INVALID_REQUEST' });
  assertEquals(dependencies.findByIdempotencyCalls.length, 0);
});

Deno.test('does not leak database errors', async () => {
  const dependencies = requestDependencies({ countRecentError: new Error('database password: secret') });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { code: 'REQUEST_FAILED' });
});

Deno.test('production persistence reports failed until Telegram delivery exists', async () => {
  let insertedValues: Record<string, unknown> | undefined;
  const query = {
    insert: (values: Record<string, unknown>) => {
      insertedValues = values;
      return query;
    },
    select: () => query,
    single: () => Promise.resolve({ data: { reference: 'MG-DURABLE1' }, error: null }),
  };
  const client = {
    from: (table: string) => {
      assertEquals(table, 'service_requests');
      return query;
    },
  } as unknown as SubmitRequestClient;

  const result = await createRepository(client).insertRequest({
    roomToken: ROOM_TOKEN,
    idempotencyKey: IDEMPOTENCY_KEY,
    service: 'transport',
    choice: '',
    pickup: 'Kamilovs Hotel',
    destination: 'Samarkand Airport',
    date: '2099-12-31',
    time: '14:30',
    partySize: 2,
    guestName: 'Alex',
    contact: '+998901234567',
    note: '',
    room: ACTIVE_ROOM,
    rateKey: 'hashed-rate-key',
    reference: 'MG-DURABLE1',
  });

  assertEquals(result, {
    kind: 'inserted',
    request: { reference: 'MG-DURABLE1', telegramStatus: 'failed' },
  });
  assertEquals(insertedValues, {
    reference: 'MG-DURABLE1',
    idempotency_key: IDEMPOTENCY_KEY,
    rate_limit_key: 'hashed-rate-key',
    hotel_id: ACTIVE_ROOM.hotelId,
    room_id: ACTIVE_ROOM.id,
    service_type: 'transport',
    choice: '',
    pickup: 'Kamilovs Hotel',
    destination: 'Samarkand Airport',
    requested_date: '2099-12-31',
    requested_time: '14:30',
    party_size: 2,
    guest_name: 'Alex',
    guest_contact: '+998901234567',
    note: '',
  });
});

Deno.test('production persistence classifies unique constraint collisions', async () => {
  for (const [constraint, expected] of [
    ['service_requests_reference_key', 'reference_conflict'],
    ['service_requests_idempotency_key_key', 'idempotency_conflict'],
  ] as const) {
    const query = {
      insert: () => query,
      select: () => query,
      single: () => Promise.resolve({ data: null, error: { code: '23505', constraint } }),
    };
    const client = { from: () => query } as unknown as SubmitRequestClient;
    const result = await createRepository(client).insertRequest({
      roomToken: ROOM_TOKEN,
      idempotencyKey: IDEMPOTENCY_KEY,
      service: 'transport',
      choice: '',
      pickup: 'Kamilovs Hotel',
      destination: 'Samarkand Airport',
      date: '2099-12-31',
      time: '14:30',
      partySize: 2,
      guestName: 'Alex',
      contact: '+998901234567',
      note: '',
      room: ACTIVE_ROOM,
      rateKey: 'hashed-rate-key',
      reference: 'MG-DURABLE1',
    });

    assertEquals(result, { kind: expected });
  }
});
