/// <reference lib="deno.ns" />

import { assertEquals } from '@std/assert';
import { parse } from '@std/toml';

Deno.test('submit-request is configured for unauthenticated guests', async () => {
  const configUrl = new URL('../../config.toml', import.meta.url);
  const config = parse(await Deno.readTextFile(configUrl)) as {
    functions?: Record<string, { verify_jwt?: unknown }>;
  };

  assertEquals(config.functions?.['submit-request']?.verify_jwt, false);
});
