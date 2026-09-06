import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { AdminRequestError } from '@/lib/admin/errors';

/**
 * Hotel sign-ins. Creating one needs the server key, so every call goes to the
 * hotel-accounts Edge Function, which re-checks that the caller is an active
 * owner before touching anything.
 */

export type HotelAccount = { userId: string; email: string; active: boolean };

/** The password exists only in this response; it is never stored or shown again. */
export type CreatedHotelAccount = { account: HotelAccount; password: string };

export class HotelAccountError extends Error {
  constructor(readonly code: string, message: string = code) {
    super(message);
    this.name = 'HotelAccountError';
  }
}

async function functionErrorBody(error: unknown): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const context = typeof error === 'object' && error !== null ? (error as { context?: unknown }).context : undefined;
  if (!(context instanceof Response)) return null;
  try {
    const body = await context.clone().json();
    return { status: context.status, body: body && typeof body === 'object' ? body as Record<string, unknown> : {} };
  } catch {
    return { status: context.status, body: {} };
  }
}

async function callAccounts(
  client: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await client.functions.invoke('hotel-accounts', { body });
  if (!error) return (data ?? {}) as Record<string, unknown>;

  const failure = await functionErrorBody(error);
  if (!failure) throw new AdminRequestError('RETRY_FAILED', 'hotel-accounts is unreachable');
  // Losing the session is a different problem from a taken address: it is
  // checked first, so an authorization failure never arrives dressed as one
  // the owner could fix by editing the form.
  if (failure.status === 401) throw new AdminRequestError('UNAUTHORIZED');
  if (failure.status === 403) throw new AdminRequestError('FORBIDDEN');
  // Otherwise the function's own code is carried through, so the screen can
  // name what the owner has to change.
  if (typeof failure.body.code === 'string') throw new HotelAccountError(failure.body.code);
  throw new AdminRequestError('RETRY_FAILED', `hotel-accounts answered ${failure.status}`);
}

function readAccount(value: unknown): HotelAccount | null {
  if (!value || typeof value !== 'object') return null;
  const account = value as Record<string, unknown>;
  if (typeof account.userId !== 'string' || typeof account.email !== 'string') return null;
  return { userId: account.userId, email: account.email, active: account.active === true };
}

export async function listHotelAccounts(
  hotelId: string,
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<HotelAccount[]> {
  const body = await callAccounts(client, { action: 'list', hotelId });
  const accounts = Array.isArray(body.accounts) ? body.accounts : [];
  return accounts.map(readAccount).filter((account): account is HotelAccount => account !== null);
}

export async function createHotelAccount(
  hotelId: string,
  email: string,
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<CreatedHotelAccount> {
  const body = await callAccounts(client, { action: 'create', hotelId, email });
  const account = readAccount(body.account);
  // Without the password the owner has nothing to hand over, and it cannot be
  // fetched later: say so rather than showing a half-created account.
  if (!account || typeof body.password !== 'string' || !body.password) {
    throw new AdminRequestError('RETRY_FAILED', 'hotel-accounts returned no password');
  }
  return { account, password: body.password };
}

export async function setHotelAccountActive(
  userId: string,
  active: boolean,
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<{ userId: string; active: boolean }> {
  const body = await callAccounts(client, { action: 'setActive', userId, active });
  return {
    userId: typeof body.userId === 'string' ? body.userId : userId,
    active: body.active === true,
  };
}
