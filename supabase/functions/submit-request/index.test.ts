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
import { TelegramDeliveryError } from '../_shared/telegram.ts';

const ROOM_TOKEN = '20000000-0000-4000-8000-000000000205';
const IDEMPOTENCY_KEY = '10000000-0000-4000-8000-000000000001';
const ACTIVE_ROOM = {
  id: '30000000-0000-4000-8000-000000000003',
  hotelId: '30000000-0000-4000-8000-000000000001',
  catalogId: null as string | null,
};

type DependencyOptions = {
  activeRoom?: typeof ACTIVE_ROOM | null;
  existingReference?: string;
  existingTelegramStatus?: 'pending' | 'sent' | 'failed';
  atomicResults?: Array<'created' | 'existing' | 'rate_limited' | 'reference_conflict'>;
  insertedReference?: string;
  insertedTelegramStatus?: 'pending' | 'sent' | 'failed';
  atomicError?: Error;
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
  const atomicCalls: Array<Record<string, unknown>> = [];
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
    submitAtomically: (request: InsertRequest): Promise<InsertResult> => {
      atomicCalls.push(request);
      if (options.atomicError) return Promise.reject(options.atomicError);
      const result = options.atomicResults?.[insertReads] ?? 'created';
      insertReads += 1;
      if (result === 'reference_conflict' || result === 'rate_limited') return Promise.resolve({ kind: result });
      if (result === 'existing') return Promise.resolve({
        kind: result,
        request: {
          id: '40000000-0000-4000-8000-000000000004',
          reference: options.existingReference ?? 'MG-EXISTING',
        },
      });
      return Promise.resolve({
        kind: 'created' as const,
        request: {
          id: '40000000-0000-4000-8000-000000000004',
          reference: options.insertedReference ?? 'MG-ABCDEFGH',
        },
      });
    },
    findByReference: () => Promise.resolve({
      id: '40000000-0000-4000-8000-000000000004',
      ...transportDeliveryRequest(),
    }),
    findDelivery: () => Promise.resolve({ id: '50000000-0000-4000-8000-000000000005', attempt: 1, status: 'pending' as const }),
    completeDelivery: () => Promise.resolve(true),
    failDelivery: () => Promise.resolve(true),
  };

  return {
    repository,
    requestHashSecret: 'test-request-hash-secret',
    telegramSender: () => Promise.resolve({ messageId: 1 }),
    referenceFactory: (() => {
      const references = ['MG-TESTAAAA', 'MG-TESTAAAB', 'MG-TESTAAAC'];
      let index = 0;
      return () => {
        const reference = references[index];
        index += 1;
        if (!reference) throw new Error('Test reference sequence exhausted');
        return reference;
      };
    })(),
    findByIdempotencyCalls,
    findActiveRoomCalls,
    atomicCalls,
  };
}

Deno.test('stores one request and returns its reference', async () => {
  const dependencies = requestDependencies({ insertedReference: 'MG-ABCDEFGH' });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 201);
  assertEquals(await response.json(), { reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
  assertEquals(dependencies.atomicCalls.length, 1);
  assertEquals(dependencies.findActiveRoomCalls, [ROOM_TOKEN]);
  assertEquals(dependencies.atomicCalls[0].reference, 'MG-TESTAAAA');
  assertEquals(dependencies.atomicCalls[0].room, ACTIVE_ROOM);
  assertEquals(dependencies.atomicCalls[0].contact, '+998 90 123 45 67');
  assertEquals(typeof dependencies.atomicCalls[0].rateKey, 'string');
  assertEquals((dependencies.atomicCalls[0].rateKey as string).includes('99890'), false);
});

Deno.test('delegates unauthenticated acceptance to one atomic repository call', async () => {
  const atomicCalls: Array<Record<string, unknown>> = [];
  const dependencies = {
    repository: {
      findByIdempotencyKey: () => Promise.resolve(null),
      findActiveRoom: () => Promise.resolve(ACTIVE_ROOM),
      submitAtomically: (request: Record<string, unknown>) => {
        atomicCalls.push(request);
        return Promise.resolve({
          kind: 'created',
          request: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-ATOMICAB' },
        });
      },
      findByReference: () => Promise.resolve({
        id: '40000000-0000-4000-8000-000000000004',
        ...transportDeliveryRequest(),
        reference: 'MG-ATOMICAB',
      }),
      findDelivery: () => Promise.resolve({ id: '50000000-0000-4000-8000-000000000005', attempt: 1, status: 'pending' }),
      completeDelivery: () => Promise.resolve(true),
      failDelivery: () => Promise.resolve(true),
    },
    requestHashSecret: 'test-request-hash-secret',
    referenceFactory: () => 'MG-ATOMICAB',
    telegramSender: () => Promise.resolve({ messageId: 1 }),
  } as unknown as SubmitRequestDependencies;
  const request = validSubmitRequest();

  const response = await handler(request, dependencies);

  assertEquals(request.headers.has('authorization'), false);
  assertEquals(response.status, 201);
  assertEquals(await response.json(), { reference: 'MG-ATOMICAB', telegramStatus: 'sent' });
  assertEquals(atomicCalls.length, 1);
  assertEquals(atomicCalls[0].reference, 'MG-ATOMICAB');
  assertEquals((atomicCalls[0].rateKey as string).includes('99890'), false);
});

Deno.test('maps an atomic rate-limit outcome without calling separate persistence methods', async () => {
  let atomicCalls = 0;
  const dependencies = {
    repository: {
      findByIdempotencyKey: () => Promise.resolve(null),
      findActiveRoom: () => Promise.resolve(ACTIVE_ROOM),
      submitAtomically: () => {
        atomicCalls += 1;
        return Promise.resolve({ kind: 'rate_limited' });
      },
    },
    requestHashSecret: 'test-request-hash-secret',
    referenceFactory: () => 'MG-ATOMICAB',
  } as unknown as SubmitRequestDependencies;

  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 429);
  assertEquals(await response.json(), { code: 'RATE_LIMITED' });
  assertEquals(atomicCalls, 1);
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
  assertEquals(dependencies.atomicCalls.length, 0);
  assertEquals(dependencies.findActiveRoomCalls.length, 0);
});

Deno.test('rejects sixth matching request in ten minutes', async () => {
  const dependencies = requestDependencies({ atomicResults: ['rate_limited'] });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 429);
  assertEquals(await response.json(), { code: 'RATE_LIMITED' });
  assertEquals(dependencies.atomicCalls.length, 1);
});

Deno.test('rejects inactive room before insert', async () => {
  const dependencies = requestDependencies({ activeRoom: null });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { code: 'ROOM_UNAVAILABLE' });
  assertEquals(dependencies.atomicCalls.length, 0);
});

Deno.test('returns the raced idempotent request after a unique conflict', async () => {
  const dependencies = requestDependencies({
    existingReference: 'MG-RACEDABC',
    atomicResults: ['existing'],
  });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { reference: 'MG-RACEDABC', telegramStatus: 'failed' });
  assertEquals(dependencies.findByIdempotencyCalls, [IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
  assertEquals(dependencies.atomicCalls.length, 1);
});

Deno.test('retries a unique reference collision with a new reference', async () => {
  const dependencies = requestDependencies({ atomicResults: ['reference_conflict', 'created'] });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 201);
  assertEquals(dependencies.atomicCalls.length, 2);
  assertEquals(dependencies.atomicCalls.map((call) => call.reference), ['MG-TESTAAAA', 'MG-TESTAAAB']);
});

Deno.test('fails safely after bounded reference collisions', async () => {
  const dependencies = requestDependencies({
    atomicResults: ['reference_conflict', 'reference_conflict', 'reference_conflict'],
  });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { code: 'REQUEST_FAILED' });
  assertEquals(dependencies.atomicCalls.length, 3);
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
  const dependencies = requestDependencies({ atomicError: new Error('database password: secret') });
  const response = await handler(validSubmitRequest(), dependencies);

  assertEquals(response.status, 500);
  assertEquals(await response.json(), { code: 'REQUEST_FAILED' });
});

Deno.test('production persistence reports failed until Telegram delivery exists', async () => {
  let rpcArguments: Record<string, unknown> | undefined;
  const client = {
    rpc: (functionName: string, arguments_: Record<string, unknown>) => {
      assertEquals(functionName, 'submit_guest_request');
      rpcArguments = arguments_;
      return Promise.resolve({
      data: [{
        outcome: 'created',
        request_id: '40000000-0000-4000-8000-000000000004',
        reference: 'MG-DURABLEA',
      }],
        error: null,
      });
    },
  } as unknown as SubmitRequestClient;

  const result = await createRepository(client).submitAtomically({
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
    offerId: null,
    guestLocale: 'en',
    offerSnapshot: null,
    rateKey: 'hashed-rate-key',
    reference: 'MG-DURABLEA',
  });

  assertEquals(result as unknown, {
    kind: 'created',
    request: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-DURABLEA' },
  });
  assertEquals(rpcArguments, {
    p_reference: 'MG-DURABLEA',
    p_idempotency_key: IDEMPOTENCY_KEY,
    p_rate_limit_key: 'hashed-rate-key',
    p_hotel_id: ACTIVE_ROOM.hotelId,
    p_room_id: ACTIVE_ROOM.id,
    p_service_type: 'transport',
    p_choice: '',
    p_pickup: 'Kamilovs Hotel',
    p_destination: 'Samarkand Airport',
    p_requested_date: '2099-12-31',
    p_requested_time: '14:30',
    p_party_size: 2,
    p_guest_name: 'Alex',
    p_guest_contact: '+998901234567',
    p_note: '',
    p_offer_id: null,
    p_offer_snapshot: null,
    p_guest_locale: 'en',
  });
});

Deno.test('production persistence classifies a unique reference collision', async () => {
  const client = {
    rpc: () => Promise.resolve({
      data: null,
      error: { code: '23505', constraint: 'service_requests_reference_key' },
    }),
  };
  const result = await createRepository(client as unknown as SubmitRequestClient).submitAtomically({
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
    offerId: null,
    guestLocale: 'en',
    offerSnapshot: null,
    rateKey: 'hashed-rate-key',
    reference: 'MG-DURABLEA',
  });

  assertEquals(result, { kind: 'reference_conflict' });
});

Deno.test('production persistence resolves an atomic response without a request id by its unique reference', async () => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({
      data: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-DURABLEA' },
      error: null,
    }),
  };
  const client = {
    from: () => query,
    rpc: () => Promise.resolve({
      data: [{ outcome: 'created', reference: 'MG-DURABLEA' }],
      error: null,
    }),
  } as unknown as SubmitRequestClient;

  const result = await createRepository(client).submitAtomically({
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
    offerId: null,
    guestLocale: 'en',
    offerSnapshot: null,
    rateKey: 'hashed-rate-key',
    reference: 'MG-DURABLEA',
  });

  assertEquals(result, {
    kind: 'created',
    request: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-DURABLEA' },
  });
});

Deno.test('production persistence fetches the winner of an idempotency unique race', async () => {
  const requestQuery = {
    select: () => requestQuery,
    eq: () => requestQuery,
    maybeSingle: () => Promise.resolve({
      data: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-RACEDABC' },
      error: null,
    }),
  };
  const deliveryQuery = {
    select: () => deliveryQuery,
    eq: () => deliveryQuery,
    order: () => deliveryQuery,
    limit: () => deliveryQuery,
    maybeSingle: () => Promise.resolve({ data: { status: 'failed' }, error: null }),
  };
  const client = {
    from: (table: string) => table === 'telegram_deliveries' ? deliveryQuery : requestQuery,
    rpc: () => Promise.resolve({
      data: null,
      error: { code: '23505', constraint: 'service_requests_idempotency_key_key' },
    }),
  } as unknown as SubmitRequestClient;
  const result = await createRepository(client).submitAtomically({
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
    offerId: null,
    guestLocale: 'en',
    offerSnapshot: null,
    rateKey: 'hashed-rate-key',
    reference: 'MG-DURABLEA',
  });

  assertEquals(result, {
    kind: 'existing',
    request: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-RACEDABC' },
  });
});

Deno.test('production persistence returns the latest Telegram delivery status for an idempotent request', async () => {
  const deliveryPredicates: Array<[string, unknown]> = [];
  const requestQuery = {
    select: () => requestQuery,
    eq: () => requestQuery,
    maybeSingle: () => Promise.resolve({
      data: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-DELIVERY' },
      error: null,
    }),
  };
  const deliveryQuery = {
    select: () => deliveryQuery,
    eq: (column: string, value: unknown) => {
      deliveryPredicates.push([column, value]);
      return deliveryQuery;
    },
    order: () => deliveryQuery,
    limit: () => deliveryQuery,
    maybeSingle: () => Promise.resolve({ data: { status: 'sent' }, error: null }),
  };
  const client = {
    from: (table: string) => table === 'service_requests' ? requestQuery : deliveryQuery,
  } as unknown as SubmitRequestClient;

  const result = await createRepository(client).findByIdempotencyKey(IDEMPOTENCY_KEY);

  assertEquals(result, { reference: 'MG-DELIVERY', telegramStatus: 'sent' });
  assertEquals(deliveryPredicates, [['request_id', '40000000-0000-4000-8000-000000000004']]);
});

Deno.test('production persistence returns a pending idempotent delivery status exactly', async () => {
  const requestQuery = {
    select: () => requestQuery,
    eq: () => requestQuery,
    maybeSingle: () => Promise.resolve({
      data: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-PENDINGA' },
      error: null,
    }),
  };
  const deliveryQuery = {
    select: () => deliveryQuery,
    eq: () => deliveryQuery,
    order: () => deliveryQuery,
    limit: () => deliveryQuery,
    maybeSingle: () => Promise.resolve({ data: { status: 'pending' }, error: null }),
  };
  const client = {
    from: (table: string) => table === 'service_requests' ? requestQuery : deliveryQuery,
  } as unknown as SubmitRequestClient;

  const result = await createRepository(client).findByIdempotencyKey(IDEMPOTENCY_KEY);

  assertEquals(result, { reference: 'MG-PENDINGA', telegramStatus: 'pending' });
});

Deno.test('production persistence completes only a pending delivery', async () => {
  const predicates: Array<[string, unknown]> = [];
  let update: Record<string, unknown> | null = null;
  const query = {
    update: (values: Record<string, unknown>) => {
      update = values;
      return query;
    },
    eq: (column: string, value: unknown) => {
      predicates.push([column, value]);
      return query;
    },
    select: () => query,
    maybeSingle: () => Promise.resolve({ data: { id: '50000000-0000-4000-8000-000000000005' }, error: null }),
  };
  const client = { from: () => query } as unknown as SubmitRequestClient;

  const completed = await createRepository(client).completeDelivery(
    '50000000-0000-4000-8000-000000000005',
    { telegramMessageId: 42 },
  );

  assertEquals(completed, true);
  assertEquals(predicates, [
    ['id', '50000000-0000-4000-8000-000000000005'],
    ['status', 'pending'],
  ]);
  const recordedUpdate = update as Record<string, unknown> | null;
  assertEquals(recordedUpdate?.status, 'sent');
  assertEquals(recordedUpdate?.telegram_message_id, 42);
});

Deno.test('uses the atomic first pending delivery instead of creating another delivery row', async () => {
  let createDeliveryCalls = 0;
  const dependencies = {
    repository: {
      findByIdempotencyKey: () => Promise.resolve(null),
      findActiveRoom: () => Promise.resolve(ACTIVE_ROOM),
      submitAtomically: () => Promise.resolve({
        kind: 'created',
        request: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-ABCDEFGH' },
      }),
      findByReference: () => Promise.resolve({ id: '40000000-0000-4000-8000-000000000004', ...transportDeliveryRequest() }),
      findDelivery: () => Promise.resolve({ id: '50000000-0000-4000-8000-000000000005', attempt: 1, status: 'pending' }),
      createDelivery: () => {
        createDeliveryCalls += 1;
        return Promise.reject(new Error('attempt one must be atomic'));
      },
      completeDelivery: () => Promise.resolve(true),
      failDelivery: () => Promise.resolve(true),
    },
    requestHashSecret: 'test-request-hash-secret',
    referenceFactory: () => 'MG-ABCDEFGH',
    telegramSender: () => Promise.resolve({ messageId: 42 }),
  };

  const response = await handler(validSubmitRequest(), dependencies as unknown as SubmitRequestDependencies);

  assertEquals(response.status, 201);
  assertEquals(createDeliveryCalls, 0);
});

Deno.test('leaves an accepted request pending when sent-state persistence fails', async () => {
  let sends = 0;
  let failedUpdates = 0;
  const dependencies = {
    repository: {
      findByIdempotencyKey: () => Promise.resolve(null),
      findActiveRoom: () => Promise.resolve(ACTIVE_ROOM),
      submitAtomically: () => Promise.resolve({
        kind: 'created',
        request: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-ABCDEFGH' },
      }),
      findByReference: () => Promise.resolve({ id: '40000000-0000-4000-8000-000000000004', ...transportDeliveryRequest() }),
      findDelivery: () => Promise.resolve({ id: '50000000-0000-4000-8000-000000000005', attempt: 1, status: 'pending' }),
      createDelivery: () => Promise.reject(new Error('should not create')),
      completeDelivery: () => Promise.reject(new Error('database write failed')),
      failDelivery: () => {
        failedUpdates += 1;
        return Promise.resolve(true);
      },
    },
    requestHashSecret: 'test-request-hash-secret',
    referenceFactory: () => 'MG-ABCDEFGH',
    telegramSender: () => {
      sends += 1;
      return Promise.resolve({ messageId: 42 });
    },
  };

  const response = await handler(validSubmitRequest(), dependencies as unknown as SubmitRequestDependencies);

  assertEquals(response.status, 202);
  assertEquals(await response.json(), { reference: 'MG-ABCDEFGH', telegramStatus: 'pending' });
  assertEquals(sends, 1);
  assertEquals(failedUpdates, 0);
});

Deno.test('records a sent first delivery and returns sent', async () => {
  const createdDeliveries: Array<{ requestId: string; attempt: number }> = [];
  const completedDeliveries: Array<{ deliveryId: string; telegramMessageId: number }> = [];
  const dependencies = {
    repository: {
      findByIdempotencyKey: () => Promise.resolve(null),
      findActiveRoom: () => Promise.resolve(ACTIVE_ROOM),
      submitAtomically: () => Promise.resolve({
        kind: 'created',
        request: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-ABCDEFGH' },
      }),
      findByReference: () => Promise.resolve({
        id: '40000000-0000-4000-8000-000000000004',
        ...transportDeliveryRequest(),
      }),
      findDelivery: () => Promise.resolve({ id: '50000000-0000-4000-8000-000000000005', attempt: 1, status: 'pending' }),
      completeDelivery: (deliveryId: string, result: { telegramMessageId: number }) => {
        completedDeliveries.push({ deliveryId, ...result });
        return Promise.resolve(true);
      },
      failDelivery: () => Promise.resolve(true),
    },
    requestHashSecret: 'test-request-hash-secret',
    referenceFactory: () => 'MG-ABCDEFGH',
    telegramSender: () => Promise.resolve({ messageId: 42 }),
  };

  const response = await handler(validSubmitRequest(), dependencies as unknown as SubmitRequestDependencies);

  assertEquals(response.status, 201);
  assertEquals(await response.json(), { reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
  assertEquals(createdDeliveries, []);
  assertEquals(completedDeliveries, [{ deliveryId: '50000000-0000-4000-8000-000000000005', telegramMessageId: 42 }]);
});

Deno.test('keeps a newly accepted request after both Telegram sends fail', async () => {
  const createdDeliveries: Array<{ requestId: string; attempt: number }> = [];
  const failedDeliveries: Array<{ deliveryId: string; errorCode: string; errorMessage: string }> = [];
  let sends = 0;
  const dependencies = {
    repository: {
      findByIdempotencyKey: () => Promise.resolve(null),
      findActiveRoom: () => Promise.resolve(ACTIVE_ROOM),
      submitAtomically: () => Promise.resolve({
        kind: 'created',
        request: { id: '40000000-0000-4000-8000-000000000004', reference: 'MG-ABCDEFGH' },
      }),
      findByReference: () => Promise.resolve({
        id: '40000000-0000-4000-8000-000000000004',
        ...transportDeliveryRequest(),
      }),
      findDelivery: () => Promise.resolve({ id: '50000000-0000-4000-8000-000000000005', attempt: 1, status: 'pending' }),
      completeDelivery: () => Promise.resolve(true),
      failDelivery: (deliveryId: string, error: { code: string; message: string }) => {
        failedDeliveries.push({ deliveryId, errorCode: error.code, errorMessage: error.message });
        return Promise.resolve(true);
      },
    },
    requestHashSecret: 'test-request-hash-secret',
    referenceFactory: () => 'MG-ABCDEFGH',
    telegramSender: () => {
      sends += 1;
      return Promise.reject(new TelegramDeliveryError(
        'TELEGRAM_API_ERROR',
        'Telegram rejected guest contact +998 90 123 45 67',
      ));
    },
  };

  const response = await handler(validSubmitRequest(), dependencies as unknown as SubmitRequestDependencies);

  assertEquals(response.status, 202);
  assertEquals(await response.json(), { reference: 'MG-ABCDEFGH', telegramStatus: 'failed' });
  assertEquals(sends, 2);
  assertEquals(createdDeliveries, []);
  assertEquals(failedDeliveries.length, 1);
  assertEquals(failedDeliveries[0].errorMessage.includes('+998'), false);
});

function transportDeliveryRequest() {
  return {
    reference: 'MG-ABCDEFGH',
    hotelName: 'Kamilovs Hotel',
    roomLabel: '205',
    service: 'transport' as const,
    choice: '',
    pickup: 'Kamilovs Hotel',
    destination: 'Samarkand Airport',
    requestedDate: '2099-12-31',
    requestedTime: '14:30',
    partySize: 2,
    guestName: 'Alex',
    contact: '+998 90 123 45 67',
    note: '',
  };
}
