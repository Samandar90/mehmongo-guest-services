import { describe, expect, it, vi } from 'vitest';
import { getAdminIdentity, signInAdmin, signOutAdmin } from './auth';

function queryReturning(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function createClient() {
  return {
    auth: {
      getUser: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(),
  };
}

describe('admin authentication', () => {
  it('rejects an authenticated user without an active admin profile', async () => {
    const supabase = createClient();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    supabase.from.mockReturnValue(queryReturning(null));

    await expect(getAdminIdentity(supabase as never)).resolves.toBeNull();
  });

  it('returns an active super-admin identity', async () => {
    const supabase = createClient();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    supabase.from.mockReturnValue(queryReturning({ user_id: 'user-1', role: 'super_admin', active: true }));

    await expect(getAdminIdentity(supabase as never)).resolves.toEqual({ userId: 'user-1', role: 'super_admin' });
  });

  it('does not disclose whether a failed sign-in email exists', async () => {
    const supabase = createClient();
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: new Error('Invalid login credentials') });

    await expect(signInAdmin('owner@example.com', 'wrong password', supabase as never))
      .rejects.toThrow('Не удалось войти. Проверьте email и пароль.');
  });

  it('clears the browser session when an admin signs out', async () => {
    const supabase = createClient();
    supabase.auth.signOut.mockResolvedValue({ error: null });

    await expect(signOutAdmin(supabase as never)).resolves.toBeUndefined();
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
  });
});

describe('hotel accounts', () => {
  it('returns a hotel identity carrying the hotel it may read', async () => {
    const supabase = createClient();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null });
    supabase.from.mockReturnValue(queryReturning({
      user_id: 'user-2', role: 'hotel', active: true, hotel_id: 'hotel-1',
    }));

    await expect(getAdminIdentity(supabase as never)).resolves.toEqual({
      userId: 'user-2', role: 'hotel', hotelId: 'hotel-1',
    });
  });

  it('rejects a hotel row that names no hotel, rather than granting a blank scope', async () => {
    const supabase = createClient();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null });
    supabase.from.mockReturnValue(queryReturning({
      user_id: 'user-2', role: 'hotel', active: true, hotel_id: null,
    }));

    await expect(getAdminIdentity(supabase as never)).resolves.toBeNull();
  });

  it('rejects a role it does not know', async () => {
    const supabase = createClient();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-3' } }, error: null });
    supabase.from.mockReturnValue(queryReturning({ user_id: 'user-3', role: 'accountant', active: true }));

    await expect(getAdminIdentity(supabase as never)).resolves.toBeNull();
  });
});
