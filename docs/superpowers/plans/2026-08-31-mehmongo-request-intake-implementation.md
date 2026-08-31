# MehmonGo Request Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simulated guest submission with a durable Supabase request pipeline that resolves room QR tokens, stores requests, and posts Russian notifications to one Telegram group.

**Architecture:** The English guest UI calls two Supabase Edge Functions: `room-context` resolves an opaque room token and `submit-request` validates, rate-limits, persists, and notifies Telegram. Postgres is the source of truth; Telegram failure is recorded without losing the accepted request.

**Tech Stack:** React 19, Vinext, TypeScript 5.9, Vitest 4, Deno 2.9.6, Supabase CLI 2.116.0, `@supabase/supabase-js` 2.112.4, Supabase Postgres/Auth/Edge Functions, Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-08-31-mehmongo-request-admin-design.md`

## Global Constraints

- Guest-facing copy remains English; Telegram copy remains Russian.
- Pilot hotel is Kamilovs Hotel, but schema and contracts must support multiple hotels.
- Guests do not register or authenticate.
- Public clients receive only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- `SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `REQUEST_HASH_SECRET` remain server-only secrets.
- Telegram failure must never delete an accepted database request.
- Request references use `MG-XXXXXXXX` and are unique.
- Use opaque room tokens at `/r/<room_token>`; never derive tokens from hotel or room labels.
- Pin all added dependencies and commit `package-lock.json`.
- Every schema change has a CLI-generated migration, RLS, indexes, and database tests.

---

## File Structure

- `supabase/config.toml` — local Supabase configuration and function JWT settings.
- CLI-created `request_intake` file under `supabase/migrations/` — tables, constraints, indexes, helper functions, grants, and RLS.
- `supabase/seed.sql` — deterministic local super-admin profile, Kamilovs Hotel, and room 205 fixtures.
- `supabase/tests/database/request_intake.test.sql` — pgTAP schema, constraint, and RLS tests.
- `supabase/functions/_shared/contracts.ts` — types shared by Edge Functions and the web app.
- `supabase/functions/_shared/validation.ts` — server-side category validation and normalization.
- `supabase/functions/_shared/http.ts` — JSON responses, CORS, request size, and error mapping.
- `supabase/functions/_shared/security.ts` — reference, token, HMAC, and rate-limit helpers.
- `supabase/functions/_shared/telegram.ts` — Russian formatter and Telegram API client.
- `supabase/functions/room-context/index.ts` — public read-only room lookup.
- `supabase/functions/submit-request/index.ts` — public request transaction and Telegram delivery.
- `supabase/functions/retry-telegram/index.ts` — authenticated delivery retry.
- `lib/supabase/client.ts` — browser Supabase client using publishable configuration.
- `lib/requests/api.ts` — typed guest calls to Edge Functions.
- `app/r/[token]/page.tsx` — guest route resolved from the QR token.
- `components/request-form.tsx` — real async submission and recoverable error state.
- `components/guest-experience.tsx` — token context and server-issued reference handling.
- `.env.example` — variable names with non-secret examples only.

---

### Task 1: Pin Supabase tooling and define environment boundaries

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `.env.example`
- Create: `lib/supabase/client.ts`
- Test: `lib/supabase/client.test.ts`

**Interfaces:**
- Produces: `getSupabaseBrowserClient(): SupabaseClient`.
- Consumes: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the browser.

- [ ] **Step 1: Write a failing configuration test**

```ts
import { describe, expect, it, vi } from 'vitest';

describe('getSupabaseBrowserClient', () => {
  it('rejects missing public configuration', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const { getSupabaseBrowserClient } = await import('./client');
    expect(() => getSupabaseBrowserClient()).toThrow('Supabase public configuration is missing');
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm test -- --run lib/supabase/client.test.ts`  
Expected: FAIL because `lib/supabase/client.ts` does not exist.

- [ ] **Step 3: Install pinned packages and add scripts**

Run:

```powershell
npm install --save-exact @supabase/supabase-js@2.112.4
npm install --save-dev --save-exact supabase@2.116.0 deno@2.9.6
```

Add scripts:

```json
{
  "supabase:start": "supabase start",
  "supabase:stop": "supabase stop",
  "supabase:test": "supabase test db",
  "supabase:functions": "supabase functions serve --env-file supabase/.env.local",
  "functions:test": "deno test"
}
```

- [ ] **Step 4: Implement the browser client and environment template**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

export function getSupabaseBrowserClient(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase public configuration is missing');
  return (client ??= createClient(url, key));
}
```

`.env.example` must contain only:

```dotenv
VITE_SUPABASE_URL=https://example.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example
SITE_URL=http://localhost:3000
```

Keep `.env*` ignored and add `!.env.example`.

- [ ] **Step 5: Run focused verification**

Run: `npm test -- --run lib/supabase/client.test.ts && npm run lint`  
Expected: 1 test passes; lint exits 0.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json .gitignore .env.example lib/supabase
git commit -m "chore: add Supabase client foundation"
```

---

### Task 2: Create the normalized database schema and RLS

**Files:**
- Create via CLI: the `request_intake` migration path printed by `supabase migration new request_intake`
- Create: `supabase/tests/database/request_intake.test.sql`
- Create: `supabase/seed.sql`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces tables: `admin_users`, `hotels`, `rooms`, `service_requests`, `telegram_deliveries`.
- Produces database function: `private.is_super_admin() returns boolean`.
- Produces database function: `private.next_request_reference() returns text`.

- [ ] **Step 1: Initialize Supabase and create the migration through the CLI**

```powershell
npx supabase@2.116.0 init
npx supabase@2.116.0 migration new request_intake
```

Use the exact migration path printed by the CLI for every following schema edit.

- [ ] **Step 2: Write failing pgTAP tests**

```sql
begin;
select plan(13);
select has_table('public', 'admin_users');
select has_table('public', 'hotels');
select has_table('public', 'rooms');
select has_table('public', 'service_requests');
select has_table('public', 'telegram_deliveries');
select has_column('public', 'hotels', 'commission_bps');
select col_is_unique('public', 'rooms', 'public_token');
select col_is_unique('public', 'service_requests', 'reference');
select col_is_unique('public', 'service_requests', 'idempotency_key');
select has_index('public', 'service_requests', 'service_requests_hotel_created_idx');
select has_index('public', 'service_requests', 'service_requests_rate_limit_idx');
select policies_are('public', 'hotels', array['super admins manage hotels']);
select policies_are('public', 'service_requests', array['super admins read requests']);
select * from finish();
rollback;
```

- [ ] **Step 3: Start local Supabase and confirm RED**

Run: `npm run supabase:start && npm run supabase:test`  
Expected: pgTAP fails because the tables are absent.

- [ ] **Step 4: Implement tables, constraints, indexes, grants, and RLS**

The migration must implement the spec exactly. Core definitions include `admin_users` before the hotel tables so the authorization model is explicit:

```sql
create extension if not exists pgcrypto;
create schema if not exists private;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hotels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  address text not null default '',
  commission_bps integer not null default 0 check (commission_bps between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete restrict,
  label text not null check (char_length(label) between 1 and 40),
  public_token uuid not null unique default gen_random_uuid(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_id, label)
);
```

Define request category and status checks as explicit `check (... in (...))` constraints. Add the five spec indexes with these exact names:

```sql
create index service_requests_hotel_created_idx on public.service_requests (hotel_id, created_at desc);
create index service_requests_service_created_idx on public.service_requests (service_type, created_at desc);
create index service_requests_status_created_idx on public.service_requests (status, created_at desc);
create index service_requests_room_created_idx on public.service_requests (room_id, created_at desc);
create index service_requests_rate_limit_idx on public.service_requests (rate_limit_key, created_at desc);
```

Enable RLS on every public table. Revoke table access from `anon`; grant the authenticated role only the operations required by admin screens. Policies must call `private.is_super_admin()` and never rely on user metadata.

- [ ] **Step 5: Add deterministic local fixtures**

`supabase/seed.sql` inserts Kamilovs Hotel and room 205 with fixed UUIDs and a fixed local-only room token. It must not contain a real email, password, Telegram ID, or production secret.

- [ ] **Step 6: Run schema verification**

Run:

```powershell
npx supabase@2.116.0 db reset
npm run supabase:test
npx supabase@2.116.0 migration list --local
```

Expected: all 13 pgTAP assertions pass and the migration appears as applied locally.

- [ ] **Step 7: Commit**

```powershell
git add supabase
git commit -m "feat: add request intake database schema"
```

---

### Task 3: Define shared contracts and category validation

**Files:**
- Create: `supabase/functions/_shared/contracts.ts`
- Create: `supabase/functions/_shared/validation.ts`
- Test: `supabase/functions/_shared/validation.test.ts`
- Modify: `lib/guest-request.ts`

**Interfaces:**
- Produces: `ServiceId`, `GuestRequestFields`, `SubmitRequestPayload`, `SubmitRequestResult`, `RoomContextResult`.
- Produces: `validateSubmitPayload(input: unknown): ValidatedRequest`.
- Consumes from web app: the same `ServiceId` and request field names already rendered by `RequestForm`.

- [ ] **Step 1: Write failing validation tests**

```ts
import { assertEquals, assertThrows } from 'jsr:@std/assert';
import { validateSubmitPayload } from './validation.ts';

Deno.test('transport requires pickup and destination', () => {
  assertThrows(() => validateSubmitPayload({
    roomToken: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    service: 'transport',
    fields: { pickup: '', destination: '', date: '2026-09-02', time: '14:30', count: '2', guestName: 'Alex', contact: '+998901234567', choice: '', note: '' },
    website: '',
  }));
});

Deno.test('normalizes a valid transport request', () => {
  const request = validateSubmitPayload({
    roomToken: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), service: 'transport', website: '',
    fields: { pickup: ' Hotel ', destination: ' Airport ', date: '2026-09-02', time: '14:30', count: '2', guestName: ' Alex ', contact: ' +998 90 123 45 67 ', choice: '', note: '' },
  });
  assertEquals(request.partySize, 2);
  assertEquals(request.guestName, 'Alex');
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm run functions:test -- supabase/functions/_shared/validation.test.ts`.  
Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement contracts and exhaustive validation**

```ts
export type ServiceId = 'tours' | 'transport' | 'restaurants' | 'tickets';

export type SubmitRequestPayload = {
  roomToken: string;
  idempotencyKey: string;
  service: ServiceId;
  fields: GuestRequestFields;
  website: string;
};

export type SubmitRequestResult = {
  reference: string;
  telegramStatus: 'sent' | 'failed';
};

export type RoomContextResult = {
  hotelName: string;
  roomLabel: string;
  roomToken: string;
  services: ServiceId[];
};

export type PublicRoomContext = Omit<RoomContextResult, 'roomToken'>;
```

Reject unknown keys, malformed UUIDs, future/past invalid dates, counts outside 1–50, strings over their schema limits, and any non-empty `website` honeypot. Return trimmed values and `partySize: number`.

- [ ] **Step 4: Replace duplicate frontend types**

Import `ServiceId`, `GuestRequestFields`, and `RoomContextResult` from the shared contracts in `lib/guest-request.ts`; retain frontend-only validation messages there. Replace the old query-string `GuestContext` with `type GuestContext = RoomContextResult` and remove `readGuestContext`, the hard-coded hotel map, and the fallback room.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm run functions:test -- supabase/functions/_shared/validation.test.ts
npm test -- --run lib/guest-request.test.ts
npm run lint
```

Expected: all focused tests and lint pass.

- [ ] **Step 6: Commit**

```powershell
git add supabase/functions/_shared lib/guest-request.ts lib/guest-request.test.ts
git commit -m "feat: define guest request contracts"
```

---

### Task 4: Build the public room-context function and QR route

**Files:**
- Create: `supabase/functions/_shared/http.ts`
- Create: `supabase/functions/room-context/index.ts`
- Test: `supabase/functions/room-context/index.test.ts`
- Create: `lib/requests/api.ts`
- Create: `lib/requests/api.test.ts`
- Create: `app/r/[token]/page.tsx`
- Modify: `lib/guest-request.ts`
- Modify: `components/guest-experience.tsx`

**Interfaces:**
- Produces Edge endpoint: `GET /functions/v1/room-context?token=<uuid>`.
- Produces: `fetchRoomContext(token: string): Promise<RoomContextResult>`.
- `RoomContextResult = { hotelName: string; roomLabel: string; roomToken: string; services: ServiceId[] }`.

- [ ] **Step 1: Write failing function tests**

```ts
Deno.test('returns only public room context', async () => {
  const response = await handler(new Request(`http://local/?token=${ACTIVE_ROOM_TOKEN}`));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body, { hotelName: 'Kamilovs Hotel', roomLabel: '205', services: ['tours', 'transport', 'restaurants', 'tickets'] });
});

Deno.test('returns 404 for inactive room', async () => {
  const response = await handler(new Request(`http://local/?token=${INACTIVE_ROOM_TOKEN}`));
  assertEquals(response.status, 404);
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm run functions:test -- supabase/functions/room-context/index.test.ts`  
Expected: FAIL because the handler is absent.

- [ ] **Step 3: Implement minimal public lookup**

Query `rooms` joined to `hotels`, requiring both `active = true`. The production repository must create its Supabase client from the server-only secret key in the Edge Function environment. Select only hotel name and room label; do not return the token, secret, or internal UUIDs. Export `handler(request, dependencies)` so tests inject a repository without network calls; call `Deno.serve(handler)` only when the module is the main entry point.

- [ ] **Step 4: Write and implement the web API test**

```ts
it('maps room-context response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ hotelName: 'Kamilovs Hotel', roomLabel: '205', services: ['transport'] }), { status: 200 })));
  await expect(fetchRoomContext(ACTIVE_ROOM_TOKEN)).resolves.toMatchObject({ roomLabel: '205' });
});
```

`fetchRoomContext` must merge its input token into the returned `RoomContextResult`, throw `RoomUnavailableError` on 404, and throw `GuestApiError` for other non-2xx responses.

- [ ] **Step 5: Add `/r/[token]` route**

The route reads `params.token`, fetches room context, and renders `GuestExperience` with `{ hotelName, roomLabel, roomToken }`. Render the exact English unavailable state `This room link is unavailable` for 404.

- [ ] **Step 6: Run focused verification**

Run:

```powershell
npm run functions:test -- supabase/functions/room-context/index.test.ts
npm test -- --run lib/requests/api.test.ts components/guest-experience.test.tsx
npm run build
```

Expected: function tests, web tests, and production build pass.

- [ ] **Step 7: Commit**

```powershell
git add supabase/functions/room-context supabase/functions/_shared/http.ts lib/requests app/r components/guest-experience.tsx components/guest-experience.test.tsx
git commit -m "feat: resolve guest rooms from QR tokens"
```

---

### Task 5: Implement secure persistence, idempotency, and rate limiting

**Files:**
- Create: `supabase/functions/_shared/security.ts`
- Test: `supabase/functions/_shared/security.test.ts`
- Create: `supabase/functions/submit-request/index.ts`
- Test: `supabase/functions/submit-request/index.test.ts`

**Interfaces:**
- Produces: `createReference(randomBytes): string`.
- Produces: `createRateLimitKey(secret, roomId, contact): Promise<string>`.
- Produces endpoint: `POST /functions/v1/submit-request`.
- Consumes: `validateSubmitPayload` and database repository injected into `handler`.

- [ ] **Step 1: Write failing security helper tests**

```ts
Deno.test('reference has the public format', () => {
  assertMatch(createReference(new Uint8Array([1,2,3,4,5])), /^MG-[A-Z2-7]{8}$/);
});

Deno.test('rate key is stable but hides contact', async () => {
  const key = await createRateLimitKey('secret', 'room-id', '+998 90 123 45 67');
  assertEquals(key, await createRateLimitKey('secret', 'room-id', '+998901234567'));
  assert(!key.includes('99890'));
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm run functions:test -- supabase/functions/_shared/security.test.ts`  
Expected: FAIL because helpers are absent.

- [ ] **Step 3: Implement helpers**

Use Web Crypto HMAC-SHA-256 for `rate_limit_key`. Normalize contacts to lowercase alphanumeric plus leading `+`. Encode references with a fixed RFC 4648 Base32 alphabet and retry insertion on unique reference collision.

- [ ] **Step 4: Write failing request handler tests**

Cover these exact outcomes:

```ts
Deno.test('stores one request and returns its reference', async () => {
  const dependencies = requestDependencies({ insertedReference: 'MG-ABCDEFGH' });
  const response = await handler(validSubmitRequest(), dependencies);
  assertEquals(response.status, 201);
  assertEquals(await response.json(), { reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
  assertEquals(dependencies.repository.insertCalls.length, 1);
});

Deno.test('returns existing request for duplicate idempotency key', async () => {
  const dependencies = requestDependencies({ existingReference: 'MG-EXISTING' });
  const response = await handler(validSubmitRequest(), dependencies);
  assertEquals(response.status, 200);
  assertEquals((await response.json()).reference, 'MG-EXISTING');
  assertEquals(dependencies.repository.insertCalls.length, 0);
});

Deno.test('rejects sixth matching request in ten minutes', async () => {
  const dependencies = requestDependencies({ recentMatchingRequests: 5 });
  const response = await handler(validSubmitRequest(), dependencies);
  assertEquals(response.status, 429);
  assertEquals((await response.json()).code, 'RATE_LIMITED');
});

Deno.test('rejects inactive room before insert', async () => {
  const dependencies = requestDependencies({ activeRoom: null });
  const response = await handler(validSubmitRequest(), dependencies);
  assertEquals(response.status, 404);
  assertEquals((await response.json()).code, 'ROOM_UNAVAILABLE');
});
```

Define `requestDependencies` and `validSubmitRequest` as local deterministic test helpers in the same test file; they expose repository call arrays so every side effect is asserted.

- [ ] **Step 5: Implement the transaction boundary**

The handler must:

```ts
const existing = await repository.findByIdempotencyKey(payload.idempotencyKey);
if (existing) return json({ reference: existing.reference, telegramStatus: existing.telegramStatus }, 200);
const room = await repository.findActiveRoom(payload.roomToken);
if (!room) return json({ code: 'ROOM_UNAVAILABLE' }, 404);
const rateKey = await createRateLimitKey(env.REQUEST_HASH_SECRET, room.id, validated.contact);
if (await repository.countRecent(rateKey, 10 * 60_000) >= 5) return json({ code: 'RATE_LIMITED' }, 429);
const request = await repository.insertRequest({ ...validated, room, rateKey });
```

The repository uses the server-only secret key; never expose it through the response.

- [ ] **Step 6: Run focused tests**

Run: `npm run functions:test -- supabase/functions/_shared/security.test.ts supabase/functions/submit-request/index.test.ts`  
Expected: all helper and handler tests pass.

- [ ] **Step 7: Commit**

```powershell
git add supabase/functions/_shared/security.ts supabase/functions/_shared/security.test.ts supabase/functions/submit-request
git commit -m "feat: persist rate-limited guest requests"
```

---

### Task 6: Add Russian Telegram delivery and authenticated retry

**Files:**
- Create: `supabase/functions/_shared/telegram.ts`
- Test: `supabase/functions/_shared/telegram.test.ts`
- Modify: `supabase/functions/submit-request/index.ts`
- Modify: `supabase/functions/submit-request/index.test.ts`
- Create: `supabase/functions/retry-telegram/index.ts`
- Test: `supabase/functions/retry-telegram/index.test.ts`

**Interfaces:**
- Produces: `formatTelegramRequest(request, timeZone): string`.
- Produces: `sendTelegramMessage(fetcher, token, chatId, text): Promise<{ messageId: number }>`.
- Produces authenticated endpoint: `POST /functions/v1/retry-telegram` with `{ requestId: string }`.

- [ ] **Step 1: Write failing formatter tests**

```ts
Deno.test('formats transport request in Russian', () => {
  const text = formatTelegramRequest(transportFixture, 'Asia/Tashkent');
  assertStringIncludes(text, '🆕 Новая заявка MG-ABCDEFGH');
  assertStringIncludes(text, '🏨 Отель: Kamilovs Hotel');
  assertStringIncludes(text, '🚪 Комната: 205');
  assertStringIncludes(text, '🧭 Услуга: Транспорт');
  assertStringIncludes(text, '➡️ Куда: Samarkand Airport');
  assert(!text.includes('Комментарий: undefined'));
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm run functions:test -- supabase/functions/_shared/telegram.test.ts`  
Expected: FAIL because formatter is absent.

- [ ] **Step 3: Implement formatter and Bot API client**

Use Telegram `sendMessage` with JSON, a single declared parse mode, escaped guest text, and an abort timeout. Return only `message_id`; errors expose safe status/code text but never the bot token or full response body.

- [ ] **Step 4: Extend submit-request tests for delivery semantics**

```ts
Deno.test('records sent delivery and returns sent', async () => {
  const dependencies = requestDependencies({ telegramResults: [{ messageId: 42 }] });
  const response = await handler(validSubmitRequest(), dependencies);
  assertEquals(response.status, 201);
  assertEquals((await response.json()).telegramStatus, 'sent');
  assertEquals(dependencies.repository.completedDeliveries[0].telegramMessageId, 42);
});

Deno.test('keeps request when both Telegram attempts fail', async () => {
  const dependencies = requestDependencies({ telegramResults: [new Error('timeout'), new Error('timeout')] });
  const response = await handler(validSubmitRequest(), dependencies);
  assertEquals(response.status, 202);
  assertEquals((await response.json()).telegramStatus, 'failed');
  assertEquals(dependencies.repository.insertCalls.length, 1);
  assertEquals(dependencies.repository.failedDeliveries.length, 1);
});
```

Create `telegram_deliveries` attempt 1 as pending, retry once in the same invocation, and finish it as sent or failed. Do not insert a second request.

- [ ] **Step 5: Implement authenticated retry tests and handler**

Tests must prove 401 without JWT, 403 for a non-admin JWT, 404 for unknown request, and 200 for a successful retry. A retry creates the next `attempt` number and stores the new Telegram message ID.

- [ ] **Step 6: Run Edge Function tests**

Run:

```powershell
npm run functions:test -- supabase/functions/_shared/telegram.test.ts
npm run functions:test -- supabase/functions/submit-request/index.test.ts
npm run functions:test -- supabase/functions/retry-telegram/index.test.ts
```

Expected: all tests pass with mocked network and repository dependencies.

- [ ] **Step 7: Commit**

```powershell
git add supabase/functions/_shared/telegram* supabase/functions/submit-request supabase/functions/retry-telegram
git commit -m "feat: deliver guest requests to Telegram"
```

---

### Task 7: Connect the guest form to the real API

**Files:**
- Modify: `lib/requests/api.ts`
- Modify: `lib/requests/api.test.ts`
- Modify: `components/request-form.tsx`
- Modify: `components/guest-experience.tsx`
- Modify: `components/request-success.tsx`
- Modify: `components/guest-experience.test.tsx`

**Interfaces:**
- Consumes: `submitGuestRequest(payload): Promise<SubmitRequestResult>`.
- Produces: guest-visible success reference from the server; no client-generated reference remains.

- [ ] **Step 1: Write failing UI tests**

```ts
it('submits room token and shows server reference', async () => {
  server.submit.mockResolvedValue({ reference: 'MG-ABCDEFGH', telegramStatus: 'sent' });
  await completeTransportForm(user);
  await user.click(screen.getByRole('button', { name: 'Send request' }));
  expect(await screen.findByText('MG-ABCDEFGH')).toBeInTheDocument();
  expect(server.submit).toHaveBeenCalledWith(expect.objectContaining({ roomToken: ROOM_TOKEN, service: 'transport' }));
});

it('keeps entered values when the API fails', async () => {
  server.submit.mockRejectedValue(new GuestApiError('REQUEST_FAILED'));
  await completeTransportForm(user);
  await user.click(screen.getByRole('button', { name: 'Send request' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('We could not send your request');
  expect(screen.getByLabelText('Destination')).toHaveValue('Airport');
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run components/guest-experience.test.tsx`  
Expected: FAIL because submission is still simulated.

- [ ] **Step 3: Implement typed submission**

Remove `window.setTimeout` and `createRequestReference(Math.random())`. `RequestForm` awaits `onSubmit(fields, idempotencyKey)`, disables duplicate clicks during the request, and focuses an ARIA alert on failure. Reuse the same idempotency key when the guest retries unchanged failed submission; create a new key after success or form reset.

- [ ] **Step 4: Map API failures to exact English copy**

```ts
const guestErrorMessages = {
  ROOM_UNAVAILABLE: 'This room link is unavailable.',
  RATE_LIMITED: 'Too many requests were sent. Please contact the hotel reception.',
  REQUEST_FAILED: 'We could not send your request. Please try again.',
} as const;
```

- [ ] **Step 5: Run focused and regression tests**

Run:

```powershell
npm test -- --run components/guest-experience.test.tsx lib/requests/api.test.ts lib/guest-request.test.ts
npm run lint
npm run build
```

Expected: UI/API/domain tests pass, lint exits 0, and build completes.

- [ ] **Step 6: Commit**

```powershell
git add lib/requests components/request-form.tsx components/guest-experience.tsx components/request-success.tsx components/guest-experience.test.tsx
git commit -m "feat: submit real guest service requests"
```

---

### Task 8: Provision the pilot, deploy functions, and run the end-to-end gate

**Files:**
- Create: `docs/operations/supabase-pilot-runbook.md`
- Modify: `.openai/hosting.json` only if Sites environment metadata changes.
- No secret files are committed.

**Interfaces:**
- Consumes production Supabase project, Telegram bot token, and group chat ID.
- Produces production Kamilovs room token and live request pipeline.

- [ ] **Step 1: Write the operations runbook before provisioning**

The runbook must list exact commands for linking, applying migrations, setting secrets, deploying functions, creating the first Auth user, inserting `admin_users`, creating Kamilovs Hotel/room 205, rollback, and secret rotation. Use variable names, never real secret values.

- [ ] **Step 2: Verify current Supabase docs and changelog**

Check `https://supabase.com/changelog.md` for relevant breaking changes and use Supabase `search_docs` for CLI linking, function secrets, deploy, and Auth admin creation. Update commands in the runbook before executing them.

- [ ] **Step 3: Link and apply the reviewed migration**

Discover exact flags with:

```powershell
npx supabase@2.116.0 link --help
npx supabase@2.116.0 db push --help
npx supabase@2.116.0 functions deploy --help
npx supabase@2.116.0 secrets set --help
```

Then link the selected project, run advisors, push the migration, and verify migration state. Do not create or select a paid project without the user's action-time approval.

- [ ] **Step 4: Set server secrets and deploy the three functions**

Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `REQUEST_HASH_SECRET`, and `SITE_URL` through Supabase secrets. Deploy `room-context`, `submit-request`, and `retry-telegram` with JWT behavior matching `supabase/config.toml`.

- [ ] **Step 5: Configure the Sites public environment**

Set only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the Sites production environment. Save and deploy a new Sites version using the exact pushed commit.

- [ ] **Step 6: Run the production smoke test**

Use a Kamilovs room 205 token to verify:

```text
GET room-context → 200 and Kamilovs Hotel / 205
POST transport request → 201 or 202 with MG-XXXXXXXX
Database → one service_requests row and one telegram_deliveries row
Telegram → Russian message contains the same reference, hotel, and room
Repeated idempotency key → same reference, no duplicate row
```

Use test guest data and delete it only with explicit approval after verification.

- [ ] **Step 7: Run the complete verification suite**

Run:

```powershell
npm test -- --run
npm run lint
npm run build
npm audit --omit=dev
npm run supabase:test
npm run functions:test -- supabase/functions
git status --short
```

Expected: all tests pass, lint/build exit 0, audit reports 0 production vulnerabilities, database tests pass, Edge Function tests pass, and the working tree is clean.

- [ ] **Step 8: Commit runbook updates and tag the checkpoint**

```powershell
git add docs/operations .openai/hosting.json
git commit -m "docs: add request intake pilot runbook"
git tag request-intake-v1
git push origin main --follow-tags
```
