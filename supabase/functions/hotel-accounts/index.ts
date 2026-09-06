/// <reference lib="deno.ns" />

import { createClient } from '@supabase/supabase-js';
import { emptyResponse, jsonResponse } from '../_shared/http.ts';

/**
 * Hotel sign-ins, created by the owner.
 *
 * Creating an Auth user needs the server key, which must never reach a
 * browser, so this runs as an Edge Function rather than a database routine.
 * The key bypasses RLS entirely, which makes the super-admin check below the
 * only barrier: it runs before anything else and nothing may be placed above it.
 */

const POST_ALLOWED_METHODS = 'POST, OPTIONS';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** No 0/O/1/l/I: the owner copies this into a chat by hand. */
const passwordAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const passwordLength = 20;

export type HotelAccount = { userId: string; email: string; active: boolean };

export type HotelAccountsRepository = {
  getUserId: (bearerToken: string) => Promise<string | null>;
  isActiveSuperAdmin: (userId: string) => Promise<boolean>;
  hotelExists: (hotelId: string) => Promise<boolean>;
  listAccounts: (hotelId: string) => Promise<HotelAccount[]>;
  createAccount: (
    email: string,
    password: string,
    hotelId: string,
  ) => Promise<{ kind: 'created'; userId: string } | { kind: 'email_taken' }>;
  deleteUser: (userId: string) => Promise<void>;
  setActive: (userId: string, active: boolean) => Promise<boolean>;
};

export type HotelAccountsDependencies = { repository: HotelAccountsRepository };

type HandlerContext = HotelAccountsDependencies | Deno.ServeHandlerInfo;

function accountsJson(body: unknown, status = 200): Response {
  return jsonResponse(body, status, POST_ALLOWED_METHODS);
}

/**
 * Cryptographically random, and rejection-sampled so every character of the
 * alphabet is equally likely: a plain modulo would quietly favour its first
 * few characters and shrink the real search space.
 */
export function generatePassword(): string {
  const limit = 256 - (256 % passwordAlphabet.length);
  let password = '';
  while (password.length < passwordLength) {
    const bytes = crypto.getRandomValues(new Uint8Array(passwordLength));
    for (const byte of bytes) {
      if (byte >= limit || password.length >= passwordLength) continue;
      password += passwordAlphabet[byte % passwordAlphabet.length];
    }
  }
  return password;
}

function getServerSecretKey(): string | undefined {
  const configuredSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!configuredSecretKeys) {
    return Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  }
  try {
    const secretKeys = JSON.parse(configuredSecretKeys) as Record<string, unknown>;
    return typeof secretKeys.default === 'string' ? secretKeys.default : undefined;
  } catch {
    return undefined;
  }
}

function isEmailTaken(error: unknown): boolean {
  const message = error && typeof error === 'object' ? String((error as { message?: unknown }).message ?? '') : '';
  return /already (been )?registered|already exists|duplicate/i.test(message);
}

export function createRepository(): HotelAccountsRepository {
  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = getServerSecretKey();
  if (!url || !secretKey) throw new Error('Supabase server configuration is missing');
  const supabase = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

  return {
    async getUserId(bearerToken) {
      const { data, error } = await supabase.auth.getUser(bearerToken);
      return error || !data.user ? null : data.user.id;
    },
    async isActiveSuperAdmin(userId) {
      const { data, error } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('user_id', userId)
        .eq('role', 'super_admin')
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async hotelExists(hotelId) {
      const { data, error } = await supabase.from('hotels').select('id').eq('id', hotelId).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async listAccounts(hotelId) {
      const { data, error } = await supabase
        .from('admin_users')
        .select('user_id, active')
        .eq('role', 'hotel')
        .eq('hotel_id', hotelId);
      if (error) throw error;

      // The address lives in auth.users, which no view exposes to the API.
      const { data: page, error: usersError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      if (usersError) throw usersError;
      const emails = new Map(page.users.map((user) => [user.id, user.email ?? '']));

      return (data ?? []).map((row) => ({
        userId: row.user_id as string,
        email: emails.get(row.user_id as string) ?? '',
        active: row.active as boolean,
      }));
    },
    async createAccount(email, password, hotelId) {
      const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) {
        if (isEmailTaken(error)) return { kind: 'email_taken' };
        throw error;
      }
      const userId = data.user.id;

      const { error: roleError } = await supabase
        .from('admin_users')
        .insert({ user_id: userId, role: 'hotel', active: true, hotel_id: hotelId });
      if (roleError) {
        // A sign-in with no scope is worse than no account: undo it.
        await supabase.auth.admin.deleteUser(userId).catch(() => undefined);
        throw roleError;
      }
      return { kind: 'created', userId };
    },
    async deleteUser(userId) {
      await supabase.auth.admin.deleteUser(userId);
    },
    async setActive(userId, active) {
      const { data, error } = await supabase
        .from('admin_users')
        .update({ active })
        .eq('user_id', userId)
        .eq('role', 'hotel')
        .select('user_id')
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
  };
}

function dependenciesFor(context?: HandlerContext): HotelAccountsDependencies {
  return context && 'repository' in context ? context : { repository: createRepository() };
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1] ?? null;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const mediaType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return null;
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function handler(request: Request, context?: HandlerContext): Promise<Response> {
  if (request.method === 'OPTIONS') return emptyResponse(204, POST_ALLOWED_METHODS);
  if (request.method !== 'POST') return accountsJson({ code: 'METHOD_NOT_ALLOWED' }, 405);

  const token = bearerToken(request);
  if (!token) return accountsJson({ code: 'UNAUTHORIZED' }, 401);

  try {
    const { repository } = dependenciesFor(context);
    const userId = await repository.getUserId(token);
    if (!userId) return accountsJson({ code: 'UNAUTHORIZED' }, 401);
    if (!await repository.isActiveSuperAdmin(userId)) return accountsJson({ code: 'FORBIDDEN' }, 403);

    const body = await readBody(request);
    if (!body) return accountsJson({ code: 'INVALID_REQUEST' }, 400);

    if (body.action === 'list') {
      if (typeof body.hotelId !== 'string' || !uuidPattern.test(body.hotelId)) {
        return accountsJson({ code: 'INVALID_REQUEST' }, 400);
      }
      return accountsJson({ accounts: await repository.listAccounts(body.hotelId) });
    }

    if (body.action === 'create') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (typeof body.hotelId !== 'string' || !uuidPattern.test(body.hotelId) || !emailPattern.test(email)) {
        return accountsJson({ code: 'INVALID_REQUEST' }, 400);
      }
      if (!await repository.hotelExists(body.hotelId)) return accountsJson({ code: 'HOTEL_NOT_FOUND' }, 404);

      const password = generatePassword();
      const result = await repository.createAccount(email, password, body.hotelId);
      if (result.kind === 'email_taken') return accountsJson({ code: 'EMAIL_TAKEN' }, 409);

      // The only time this password is ever returned. It is not stored here and
      // cannot be read back; a lost one is replaced by a new account.
      return accountsJson({ account: { userId: result.userId, email, active: true }, password }, 201);
    }

    if (body.action === 'setActive') {
      if (typeof body.userId !== 'string' || !uuidPattern.test(body.userId) || typeof body.active !== 'boolean') {
        return accountsJson({ code: 'INVALID_REQUEST' }, 400);
      }
      if (!await repository.setActive(body.userId, body.active)) {
        return accountsJson({ code: 'ACCOUNT_NOT_FOUND' }, 404);
      }
      return accountsJson({ userId: body.userId, active: body.active });
    }

    return accountsJson({ code: 'INVALID_REQUEST' }, 400);
  } catch {
    return accountsJson({ code: 'ACCOUNTS_FAILED' }, 500);
  }
}

if (import.meta.main) Deno.serve(handler);
