/// <reference lib="deno.ns" />

import { assertEquals } from '@std/assert';
import { createRepository, handler, type RetryTelegramClient } from './index.ts';

const REQUEST_ID = '40000000-0000-4000-8000-000000000004';

function retryRequest(token?: string, requestId = REQUEST_ID): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('http://local/retry-telegram', {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId }),
  });
}

function retryDependencies(options: {
  userId?: string | null;
  isAdmin?: boolean;
  request?: ReturnType<typeof deliveryRequest> | null;
  telegramResult?: { messageId: number } | Error;
} = {}) {
  const createdDeliveries: Array<{ requestId: string; attempt: number }> = [];
  const completedDeliveries: Array<{ deliveryId: string; telegramMessageId: number }> = [];

  return {
    repository: {
      getUserId: () => Promise.resolve(options.userId === undefined ? 'user-1' : options.userId),
      isActiveSuperAdmin: () => Promise.resolve(options.isAdmin ?? true),
      findRequest: () => Promise.resolve(options.request === undefined ? deliveryRequest() : options.request),
      createNextDelivery: (requestId: string) => {
        const attempt = 3;
        createdDeliveries.push({ requestId, attempt });
        return Promise.resolve({
          kind: 'created' as const,
          delivery: { id: '50000000-0000-4000-8000-000000000005', attempt, status: 'pending' as const },
        });
      },
      completeDelivery: (deliveryId: string, result: { telegramMessageId: number }) => {
        completedDeliveries.push({ deliveryId, ...result });
        return Promise.resolve(true);
      },
      failDelivery: () => Promise.resolve(true),
    },
    telegramSender: () => options.telegramResult instanceof Error
      ? Promise.reject(options.telegramResult)
      : Promise.resolve(options.telegramResult ?? { messageId: 77 }),
    createdDeliveries,
    completedDeliveries,
  };
}

Deno.test('rejects a Telegram retry without a bearer token', async () => {
  const response = await handler(retryRequest(), retryDependencies());

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { code: 'UNAUTHORIZED' });
});

Deno.test('rejects an invalid Telegram retry bearer token', async () => {
  const response = await handler(retryRequest('invalid-token'), retryDependencies({ userId: null }));

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { code: 'UNAUTHORIZED' });
});

Deno.test('rejects a Telegram retry from a non-admin user', async () => {
  const response = await handler(retryRequest('valid-user-token'), retryDependencies({ isAdmin: false }));

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { code: 'FORBIDDEN' });
});

Deno.test('returns 404 for an unknown retry request', async () => {
  const response = await handler(retryRequest('valid-admin-token'), retryDependencies({ request: null }));

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { code: 'REQUEST_NOT_FOUND' });
});

Deno.test('creates the next delivery attempt and stores its Telegram message id', async () => {
  const dependencies = retryDependencies();
  const response = await handler(retryRequest('valid-admin-token'), dependencies);

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { telegramStatus: 'sent' });
  assertEquals(dependencies.createdDeliveries, [{ requestId: REQUEST_ID, attempt: 3 }]);
  assertEquals(dependencies.completedDeliveries, [{
    deliveryId: '50000000-0000-4000-8000-000000000005',
    telegramMessageId: 77,
  }]);
});

Deno.test('refuses a retry while the latest delivery attempt is pending', async () => {
  let sends = 0;
  const dependencies = {
    repository: {
      getUserId: () => Promise.resolve('user-1'),
      isActiveSuperAdmin: () => Promise.resolve(true),
      findRequest: () => Promise.resolve(deliveryRequest()),
      createNextDelivery: () => Promise.resolve({ kind: 'pending' }),
      completeDelivery: () => Promise.resolve(true),
      failDelivery: () => Promise.resolve(true),
    },
    telegramSender: () => {
      sends += 1;
      return Promise.resolve({ messageId: 77 });
    },
  };

  const response = await handler(retryRequest('valid-admin-token'), dependencies as never);

  assertEquals(response.status, 409);
  assertEquals(await response.json(), { code: 'TELEGRAM_DELIVERY_PENDING' });
  assertEquals(sends, 0);
});

Deno.test('refuses a retry when the latest delivery attempt was sent', async () => {
  let inserts = 0;
  const latest = {
    eq: () => latest,
    order: () => latest,
    limit: () => latest,
    maybeSingle: () => Promise.resolve({ data: { attempt: 3, status: 'sent' }, error: null }),
  };
  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    from: () => ({
      select: () => latest,
      insert: () => {
        inserts += 1;
        throw new Error('A sent delivery must not allocate another attempt');
      },
    }),
  } as unknown as RetryTelegramClient;

  const allocation = await createRepository(client).createNextDelivery(REQUEST_ID);

  assertEquals(allocation, { kind: 'pending' });
  assertEquals(inserts, 0);
});

Deno.test('leaves a retry delivery pending when sent-state persistence fails', async () => {
  let sends = 0;
  let failedUpdates = 0;
  const dependencies = {
    repository: {
      getUserId: () => Promise.resolve('user-1'),
      isActiveSuperAdmin: () => Promise.resolve(true),
      findRequest: () => Promise.resolve(deliveryRequest()),
      createNextDelivery: () => Promise.resolve({
        kind: 'created',
        delivery: { id: '50000000-0000-4000-8000-000000000005', attempt: 3, status: 'pending' },
      }),
      completeDelivery: () => Promise.reject(new Error('database write failed')),
      failDelivery: () => {
        failedUpdates += 1;
        return Promise.resolve(true);
      },
    },
    telegramSender: () => {
      sends += 1;
      return Promise.resolve({ messageId: 77 });
    },
  };

  const response = await handler(retryRequest('valid-admin-token'), dependencies as never);

  assertEquals(response.status, 503);
  assertEquals(await response.json(), { telegramStatus: 'pending' });
  assertEquals(sends, 1);
  assertEquals(failedUpdates, 0);
});

Deno.test('does not allocate or send another delivery when a completed contender wins allocation', async () => {
  const insertedAttempts: number[] = [];
  let insertCalls = 0;
  const client: RetryTelegramClient = {
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    from: () => ({
      select: (columns: string) => {
        if (columns === 'attempt, status') {
          const latest = {
            eq: () => latest,
            order: () => latest,
            limit: () => latest,
            maybeSingle: () => Promise.resolve({
              data: insertedAttempts.length === 0
                ? { attempt: 2, status: 'failed' }
                : { attempt: 3, status: 'sent' },
              error: null,
            }),
          };
          return latest;
        }
        const inserted = {
          maybeSingle: () => Promise.resolve({
            data: { id: '50000000-0000-4000-8000-000000000005' },
            error: null,
          }),
        };
        return inserted;
      },
      insert: (values: Record<string, unknown>) => {
        insertedAttempts.push(values.attempt as number);
        insertCalls += 1;
        const shouldConflict = insertCalls === 1;
        const result = {
          select: () => result,
          maybeSingle: () => Promise.resolve({
            data: shouldConflict ? null : { id: '50000000-0000-4000-8000-000000000005' },
            error: shouldConflict ? { code: '23505', constraint: 'telegram_deliveries_request_id_attempt_key' } : null,
          }),
        };
        return result;
      },
      eq: () => { throw new Error('Unexpected query'); },
      order: () => { throw new Error('Unexpected query'); },
      limit: () => { throw new Error('Unexpected query'); },
      update: () => { throw new Error('Unexpected query'); },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    }) as unknown as ReturnType<RetryTelegramClient['from']>,
  };
  let sends = 0;
  const repository = {
    ...createRepository(client),
    getUserId: () => Promise.resolve('user-1'),
    isActiveSuperAdmin: () => Promise.resolve(true),
    findRequest: () => Promise.resolve(deliveryRequest()),
  };

  const response = await handler(retryRequest('valid-admin-token'), {
    repository,
    telegramSender: () => {
      sends += 1;
      return Promise.resolve({ messageId: 77 });
    },
  });

  assertEquals(response.status, 409);
  assertEquals(await response.json(), { code: 'TELEGRAM_DELIVERY_PENDING' });
  assertEquals(insertedAttempts, [3]);
  assertEquals(sends, 0);
});

Deno.test('production persistence fails only a pending retry delivery', async () => {
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
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    from: () => query,
  } as unknown as RetryTelegramClient;

  const failed = await createRepository(client).failDelivery(
    '50000000-0000-4000-8000-000000000005',
    { code: 'TELEGRAM_TIMEOUT', message: 'Telegram request timed out' },
  );

  assertEquals(failed, false);
  assertEquals(predicates, [
    ['id', '50000000-0000-4000-8000-000000000005'],
    ['status', 'pending'],
  ]);
  const recordedUpdate = update as Record<string, unknown> | null;
  assertEquals(recordedUpdate?.status, 'failed');
  assertEquals(recordedUpdate?.error_code, 'TELEGRAM_TIMEOUT');
});

function deliveryRequest() {
  return {
    id: REQUEST_ID,
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
