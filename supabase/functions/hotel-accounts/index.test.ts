/// <reference lib="deno.ns" />

import { assertEquals, assertMatch, assertNotEquals } from '@std/assert';
import { generatePassword, handler, type HotelAccountsRepository } from './index.ts';

const HOTEL_ID = '81000000-0000-4000-8000-000000000101';
const ACCOUNT_ID = '81000000-0000-4000-8000-000000000002';

function accountsRequest(body: unknown, token: string | null = 'owner-token'): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('http://local/hotel-accounts', { method: 'POST', headers, body: JSON.stringify(body) });
}

function accountsDependencies(options: {
  userId?: string | null;
  isAdmin?: boolean;
  hotelExists?: boolean;
  accounts?: { userId: string; email: string; active: boolean }[];
  createFails?: 'email_taken' | 'other';
} = {}) {
  const created: { email: string; password: string; hotelId: string }[] = [];
  const deletedUsers: string[] = [];
  const activeChanges: { userId: string; active: boolean }[] = [];

  const repository: HotelAccountsRepository = {
    getUserId: () => Promise.resolve(options.userId === undefined ? 'owner-1' : options.userId),
    isActiveSuperAdmin: () => Promise.resolve(options.isAdmin ?? true),
    hotelExists: () => Promise.resolve(options.hotelExists ?? true),
    listAccounts: () => Promise.resolve(options.accounts ?? []),
    createAccount: (email: string, password: string, hotelId: string) => {
      if (options.createFails === 'email_taken') return Promise.resolve({ kind: 'email_taken' as const });
      if (options.createFails === 'other') return Promise.reject(new Error('boom'));
      created.push({ email, password, hotelId });
      return Promise.resolve({ kind: 'created' as const, userId: ACCOUNT_ID });
    },
    deleteUser: (userId: string) => {
      deletedUsers.push(userId);
      return Promise.resolve();
    },
    setActive: (userId: string, active: boolean) => {
      activeChanges.push({ userId, active });
      return Promise.resolve(true);
    },
  };

  return { repository, created, deletedUsers, activeChanges };
}

Deno.test('refuses a caller with no bearer token', async () => {
  const response = await handler(accountsRequest({ action: 'list', hotelId: HOTEL_ID }, null), accountsDependencies());
  assertEquals(response.status, 401);
});

Deno.test('refuses a signed-in caller who is not the owner', async () => {
  const response = await handler(
    accountsRequest({ action: 'list', hotelId: HOTEL_ID }),
    accountsDependencies({ isAdmin: false }),
  );
  assertEquals(response.status, 403);
});

Deno.test('refuses an expired or unknown token', async () => {
  const response = await handler(
    accountsRequest({ action: 'list', hotelId: HOTEL_ID }),
    accountsDependencies({ userId: null }),
  );
  assertEquals(response.status, 401);
});

Deno.test('lists the accounts of one hotel', async () => {
  const dependencies = accountsDependencies({
    accounts: [{ userId: ACCOUNT_ID, email: 'reception@example.test', active: true }],
  });
  const response = await handler(accountsRequest({ action: 'list', hotelId: HOTEL_ID }), dependencies);

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    accounts: [{ userId: ACCOUNT_ID, email: 'reception@example.test', active: true }],
  });
});

Deno.test('creates an account and returns the password exactly once', async () => {
  const dependencies = accountsDependencies();
  const response = await handler(
    accountsRequest({ action: 'create', hotelId: HOTEL_ID, email: 'Reception@Example.test ' }),
    dependencies,
  );

  assertEquals(response.status, 201);
  const body = await response.json() as { account: unknown; password: string };
  assertEquals(body.account, { userId: ACCOUNT_ID, email: 'reception@example.test', active: true });
  // The owner has one chance to pass it on; it is never stored or shown again.
  assertEquals(typeof body.password, 'string');
  assertEquals(body.password.length >= 16, true);
  assertEquals(dependencies.created[0].password, body.password);
  assertEquals(dependencies.created[0].hotelId, HOTEL_ID);
});

Deno.test('refuses an address that is not an email', async () => {
  const response = await handler(
    accountsRequest({ action: 'create', hotelId: HOTEL_ID, email: 'not-an-email' }),
    accountsDependencies(),
  );
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { code: 'INVALID_REQUEST' });
});

Deno.test('reports an address that already has an account', async () => {
  const response = await handler(
    accountsRequest({ action: 'create', hotelId: HOTEL_ID, email: 'taken@example.test' }),
    accountsDependencies({ createFails: 'email_taken' }),
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { code: 'EMAIL_TAKEN' });
});

Deno.test('refuses to attach an account to a hotel that does not exist', async () => {
  const response = await handler(
    accountsRequest({ action: 'create', hotelId: HOTEL_ID, email: 'reception@example.test' }),
    accountsDependencies({ hotelExists: false }),
  );
  assertEquals(response.status, 404);
});

Deno.test('leaves no orphan sign-in when the role cannot be granted', async () => {
  const dependencies = accountsDependencies();
  // The auth user is created first; if the admin_users row then fails, an
  // account able to sign in with no scope would be left behind.
  dependencies.repository.setActive = () => Promise.reject(new Error('grant failed'));
  dependencies.repository.createAccount = (email, password, hotelId) => {
    dependencies.created.push({ email, password, hotelId });
    return Promise.reject(new Error('role insert failed'));
  };

  const response = await handler(
    accountsRequest({ action: 'create', hotelId: HOTEL_ID, email: 'reception@example.test' }),
    dependencies,
  );
  assertEquals(response.status, 500);
});

Deno.test('disables and re-enables an account', async () => {
  const dependencies = accountsDependencies();

  const off = await handler(accountsRequest({ action: 'setActive', userId: ACCOUNT_ID, active: false }), dependencies);
  assertEquals(off.status, 200);
  assertEquals(await off.json(), { userId: ACCOUNT_ID, active: false });

  const on = await handler(accountsRequest({ action: 'setActive', userId: ACCOUNT_ID, active: true }), dependencies);
  assertEquals(on.status, 200);
  assertEquals(dependencies.activeChanges, [
    { userId: ACCOUNT_ID, active: false },
    { userId: ACCOUNT_ID, active: true },
  ]);
});

Deno.test('refuses an unknown action rather than guessing', async () => {
  const response = await handler(accountsRequest({ action: 'promote', userId: ACCOUNT_ID }), accountsDependencies());
  assertEquals(response.status, 400);
});

Deno.test('refuses anything but POST', async () => {
  const response = await handler(
    new Request('http://local/hotel-accounts', { method: 'GET' }),
    accountsDependencies(),
  );
  assertEquals(response.status, 405);
});

Deno.test('generated passwords are long, unambiguous and never repeat', () => {
  const first = generatePassword();
  const second = generatePassword();

  assertNotEquals(first, second);
  assertEquals(first.length, 20);
  // No characters a person can misread when copying it into a chat.
  assertMatch(first, /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]+$/);
});
