/// <reference lib="deno.ns" />

import { assert, assertEquals, assertMatch } from '@std/assert';
import { createRateLimitKey, createReference } from './security.ts';

Deno.test('reference has the public format', () => {
  assertMatch(createReference(new Uint8Array([1, 2, 3, 4, 5])), /^MG-[A-Z2-7]{8}$/);
});

Deno.test('reference uses the database RFC 4648 Base32 encoding', () => {
  assertEquals(createReference(new Uint8Array([1, 2, 3, 4, 5])), 'MG-AEBAGBAF');
});

Deno.test('rate key is stable but hides contact', async () => {
  const key = await createRateLimitKey('secret', 'room-id', '+998 90 123 45 67');

  assertEquals(key, await createRateLimitKey('secret', 'room-id', '+998901234567'));
  assert(!key.includes('99890'));
});

Deno.test('rate key combines room and normalized contact', async () => {
  const first = await createRateLimitKey('secret', 'room-a', 'Alex.Example');
  const second = await createRateLimitKey('secret', 'room-b', 'alexexample');

  assert(first !== second);
});
