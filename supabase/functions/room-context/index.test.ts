/// <reference lib="deno.ns" />

import { assertEquals } from '@std/assert';
import {
  createRepository,
  handler,
  type RoomContextClient,
  type RoomContextRepository,
} from './index.ts';

const ACTIVE_ROOM_TOKEN = '20000000-0000-4000-8000-000000000205';
const INACTIVE_ROOM_TOKEN = '20000000-0000-4000-8000-000000000206';

const activeRoomRepository: RoomContextRepository = {
  findActiveRoom: (token) => Promise.resolve(token === ACTIVE_ROOM_TOKEN
    ? { hotelName: 'Kamilovs Hotel', roomLabel: '205' }
    : null),
};

Deno.test('returns only public room context for an active room', async () => {
  const response = await handler(
    new Request(`http://local/?token=${ACTIVE_ROOM_TOKEN}`),
    { repository: activeRoomRepository },
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    hotelName: 'Kamilovs Hotel',
    roomLabel: '205',
    services: ['tours', 'transport', 'restaurants', 'tickets'],
  });
});

Deno.test('returns 404 when the room or its hotel is inactive', async () => {
  const response = await handler(
    new Request(`http://local/?token=${INACTIVE_ROOM_TOKEN}`),
    { repository: activeRoomRepository },
  );

  assertEquals(response.status, 404);
});

Deno.test('returns 404 without querying for a malformed token', async () => {
  let queries = 0;
  const repository: RoomContextRepository = {
    findActiveRoom: () => {
      queries += 1;
      return Promise.resolve(null);
    },
  };

  const response = await handler(
    new Request('http://local/?token=not-a-uuid'),
    { repository },
  );

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { error: 'Room not found' });
  assertEquals(queries, 0);
});

Deno.test('production repository requires active room and hotel records', async () => {
  const predicates: Array<[string, unknown]> = [];
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      predicates.push([column, value]);
      return query;
    },
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  const client: RoomContextClient = { from: () => query };

  await createRepository(client).findActiveRoom(ACTIVE_ROOM_TOKEN);

  assertEquals(predicates, [
    ['public_token', ACTIVE_ROOM_TOKEN],
    ['active', true],
    ['hotels.active', true],
  ]);
});
