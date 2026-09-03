/// <reference lib="deno.ns" />

import { assertEquals } from '@std/assert';
import { handler, type RoomContextRepository } from './index.ts';

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
