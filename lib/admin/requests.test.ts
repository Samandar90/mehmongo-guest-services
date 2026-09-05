import { describe, expect, it, vi } from 'vitest';
import { AdminRequestError, getDashboardMetrics, listRequests, retryTelegram } from './requests';

const requestRowFixture = {
  id: 'request-1',
  reference: 'MG-ABCDEFGH',
  service_type: 'transport',
  status: 'new',
  choice: '',
  pickup: 'Kamilovs Hotel',
  destination: 'Airport',
  requested_date: '2026-08-20',
  requested_time: '14:30:00',
  party_size: 2,
  guest_name: 'Alex',
  guest_contact: '+998901234567',
  note: 'Two suitcases',
  hotel_id: 'hotel-1',
  room_id: 'room-205',
  created_at: '2026-08-19T09:15:00.000Z',
  hotels: { name: 'Kamilovs Hotel' },
  rooms: { label: '205' },
  offer_id: 'tashkent-airport-sedan',
  offer_snapshot: {
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
  },
  telegram_deliveries: [
    { attempt: 1, status: 'failed', error_code: 'TELEGRAM_TIMEOUT' },
    { attempt: 2, status: 'failed', error_code: 'TELEGRAM_API_ERROR' },
  ],
};

type Filter = [string, string, unknown];

function requestQueryClient(rows: unknown[], error: unknown = null) {
  const filters: Filter[] = [];
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((column: string, value: unknown) => { filters.push(['eq', column, value]); return builder; }),
    gte: vi.fn((column: string, value: unknown) => { filters.push(['gte', column, value]); return builder; }),
    lt: vi.fn((column: string, value: unknown) => { filters.push(['lt', column, value]); return builder; }),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  const client = { from: vi.fn().mockReturnValue(builder) };
  return { client: client as never, filters, builder, from: client.from };
}

function functionClient(response: { status: number; body: unknown }) {
  const invoke = vi.fn().mockResolvedValue(
    response.status < 300
      ? { data: response.body, error: null }
      : {
        data: null,
        error: {
          name: 'FunctionsHttpError',
          message: 'Edge Function returned a non-2xx status code',
          context: new Response(JSON.stringify(response.body), { status: response.status, headers: { 'content-type': 'application/json' } }),
        },
      },
  );
  return { client: { functions: { invoke } } as never, invoke };
}

describe('listRequests', () => {
  it('applies hotel, category and inclusive date filters', async () => {
    const { client, filters } = requestQueryClient([requestRowFixture]);

    await listRequests({ hotelId: 'hotel-1', serviceType: 'transport', dateFrom: '2026-08-01', dateTo: '2026-08-31' }, client);

    // Day boundaries follow Asia/Tashkent (+05:00, no DST), the zone every admin timestamp is shown in.
    expect(filters).toEqual(expect.arrayContaining([
      ['eq', 'hotel_id', 'hotel-1'],
      ['eq', 'service_type', 'transport'],
      ['gte', 'created_at', '2026-07-31T19:00:00.000Z'],
      ['lt', 'created_at', '2026-08-31T19:00:00.000Z'],
    ]));
    expect(filters.some(([, column]) => column === 'room_id' || column === 'status')).toBe(false);
  });

  it('applies room and status filters when given', async () => {
    const { client, filters } = requestQueryClient([]);

    await listRequests({ roomId: 'room-205', status: 'new' }, client);

    expect(filters).toEqual(expect.arrayContaining([['eq', 'room_id', 'room-205'], ['eq', 'status', 'new']]));
  });

  it('joins hotel, room and latest Telegram delivery', async () => {
    const result = await listRequests({}, requestQueryClient([requestRowFixture]).client);

    expect(result.items[0]).toMatchObject({
      id: 'request-1',
      reference: 'MG-ABCDEFGH',
      hotelName: 'Kamilovs Hotel',
      roomLabel: '205',
      serviceType: 'transport',
      status: 'new',
      guestName: 'Alex',
      contact: '+998901234567',
      requestedDate: '2026-08-20',
      requestedTime: '14:30',
      partySize: 2,
      telegramStatus: 'failed',
      telegramAttempt: 2,
      telegramErrorCode: 'TELEGRAM_API_ERROR',
    });
    expect(result.hasMore).toBe(false);
  });

  it('reports no delivery when the request has none yet', async () => {
    const result = await listRequests({}, requestQueryClient([{ ...requestRowFixture, telegram_deliveries: [] }]).client);

    expect(result.items[0]).toMatchObject({ telegramStatus: 'none', telegramAttempt: 0, telegramErrorCode: null });
  });

  it('orders newest first and pages at 100 rows', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ ...requestRowFixture, id: `request-${index}` }));
    const { client, builder } = requestQueryClient(rows);

    const result = await listRequests({}, client);

    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(101);
    expect(result.items).toHaveLength(100);
    expect(result.hasMore).toBe(true);
  });

  it('rejects a malformed date filter before querying', async () => {
    const { client, from } = requestQueryClient([]);

    await expect(listRequests({ dateFrom: '2026-13-40' }, client)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(from).not.toHaveBeenCalled();
  });

  it('propagates database errors', async () => {
    const { client } = requestQueryClient([], { code: '42501', message: 'permission denied' });

    await expect(listRequests({}, client)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('getDashboardMetrics', () => {
  type CountCall = { table: string; filter: [string, unknown] | null; head: boolean };

  function countClient(counts: Record<string, number | null>, error: unknown = null) {
    const calls: CountCall[] = [];
    const client = {
      from: vi.fn((table: string) => {
        const call: CountCall = { table, filter: null, head: false };
        calls.push(call);
        const result = Promise.resolve({ count: counts[table] ?? null, error, data: null });
        const builder = {
          select: vi.fn((_columns: string, options?: { count?: string; head?: boolean }) => {
            call.head = options?.head === true && options.count === 'exact';
            return builder;
          }),
          eq: vi.fn((column: string, value: unknown) => { call.filter = [column, value]; return result; }),
        };
        return builder;
      }),
    };
    return { client: client as never, calls };
  }

  it('counts only active hotels and rooms and new requests', async () => {
    const { client, calls } = countClient({ hotels: 1, rooms: 24, service_requests: 7 });

    await expect(getDashboardMetrics(client)).resolves.toEqual({ activeHotels: 1, activeRooms: 24, newRequests: 7 });

    expect(calls).toEqual(expect.arrayContaining([
      { table: 'hotels', filter: ['active', true], head: true },
      { table: 'rooms', filter: ['active', true], head: true },
      { table: 'service_requests', filter: ['status', 'new'], head: true },
    ]));
  });

  it('treats a missing count as zero and propagates database errors', async () => {
    await expect(getDashboardMetrics(countClient({ hotels: null, rooms: null, service_requests: null }).client))
      .resolves.toEqual({ activeHotels: 0, activeRooms: 0, newRequests: 0 });
    await expect(getDashboardMetrics(countClient({}, { code: '42501', message: 'permission denied' }).client))
      .rejects.toMatchObject({ code: '42501' });
  });
});

describe('retryTelegram', () => {
  it('calls retry-telegram with authenticated invocation and returns sent', async () => {
    const { client, invoke } = functionClient({ status: 200, body: { telegramStatus: 'sent' } });

    await expect(retryTelegram('request-1', client)).resolves.toEqual({ status: 'sent' });
    expect(invoke).toHaveBeenCalledWith('retry-telegram', { body: { requestId: 'request-1' } });
  });

  it('reports a failed delivery from the 502 body without throwing', async () => {
    const { client } = functionClient({ status: 502, body: { telegramStatus: 'failed' } });

    await expect(retryTelegram('request-1', client)).resolves.toEqual({ status: 'failed' });
  });

  it('keeps a pending delivery pending, including an already-pending refusal', async () => {
    await expect(retryTelegram('request-1', functionClient({ status: 503, body: { telegramStatus: 'pending' } }).client))
      .resolves.toEqual({ status: 'pending' });
    await expect(retryTelegram('request-1', functionClient({ status: 409, body: { code: 'TELEGRAM_DELIVERY_PENDING' } }).client))
      .resolves.toEqual({ status: 'pending', reason: 'already_pending' });
  });

  it('throws typed errors for authorization and missing requests', async () => {
    await expect(retryTelegram('request-1', functionClient({ status: 403, body: { code: 'FORBIDDEN' } }).client))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(retryTelegram('request-1', functionClient({ status: 401, body: { code: 'UNAUTHORIZED' } }).client))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(retryTelegram('request-1', functionClient({ status: 404, body: { code: 'REQUEST_NOT_FOUND' } }).client))
      .rejects.toMatchObject({ code: 'REQUEST_NOT_FOUND' });
  });

  it('throws a generic error when the function is unreachable or answers nonsense', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError', message: 'fetch failed' } });
    await expect(retryTelegram('request-1', { functions: { invoke } } as never)).rejects.toBeInstanceOf(AdminRequestError);

    const { client } = functionClient({ status: 200, body: { nope: true } });
    await expect(retryTelegram('request-1', client)).rejects.toMatchObject({ code: 'RETRY_FAILED' });
  });
});

describe('catalogue offers in the admin list', () => {
  it('reads the stored offer and its starting price', async () => {
    const result = await listRequests({}, requestQueryClient([requestRowFixture]).client);

    expect(result.items[0].offerId).toBe('tashkent-airport-sedan');
    expect(result.items[0].offerTitle).toBe('Your airport ride, arranged');
    expect(result.items[0].offerEstimate).toBe('от 30 USD · per vehicle · one way');
  });

  it('reports an individual quote instead of an amount', async () => {
    const quoted = {
      ...requestRowFixture,
      offer_snapshot: { ...requestRowFixture.offer_snapshot, priceMode: 'quote', amount: null, currency: null, capacityExceeded: true },
    };

    const result = await listRequests({}, requestQueryClient([quoted]).client);

    expect(result.items[0].offerEstimate).toBe('индивидуальный расчёт');
  });

  it('leaves a request without an offer empty', async () => {
    const legacy = { ...requestRowFixture, offer_id: null, offer_snapshot: null };

    const result = await listRequests({}, requestQueryClient([legacy]).client);

    expect(result.items[0].offerId).toBeNull();
    expect(result.items[0].offerTitle).toBeNull();
    expect(result.items[0].offerEstimate).toBeNull();
  });
});
