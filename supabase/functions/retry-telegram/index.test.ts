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
        return Promise.resolve({ id: '50000000-0000-4000-8000-000000000005', attempt });
      },
      completeDelivery: (deliveryId: string, result: { telegramMessageId: number }) => {
        completedDeliveries.push({ deliveryId, ...result });
        return Promise.resolve();
      },
      failDelivery: () => Promise.resolve(),
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

Deno.test('retries a conflicting delivery allocation with the next attempt number', async () => {
  const insertedAttempts: number[] = [];
  let insertCalls = 0;
  const client: RetryTelegramClient = {
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    from: () => ({
      select: (columns: string) => {
        if (columns === 'attempt') {
          const attempt = insertedAttempts.length === 0 ? 2 : 3;
          const latest = {
            eq: () => latest,
            order: () => latest,
            limit: () => latest,
            maybeSingle: () => Promise.resolve({ data: { attempt }, error: null }),
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

  const delivery = await createRepository(client).createNextDelivery(REQUEST_ID);

  assertEquals(insertedAttempts, [3, 4]);
  assertEquals(delivery, { id: '50000000-0000-4000-8000-000000000005', attempt: 4 });
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
