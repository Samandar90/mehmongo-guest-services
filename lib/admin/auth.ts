import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * A hotel identity always names its hotel: the union makes the scope
 * unrepresentable without it, so no screen can accidentally read "a hotel
 * account with no hotel" as "every hotel". The database enforces the same
 * pairing with a CHECK.
 */
export type AdminIdentity =
  | { userId: string; role: 'super_admin' }
  | { userId: string; role: 'hotel'; hotelId: string };

const invalidCredentialsMessage = 'Не удалось войти. Проверьте email и пароль.';

/**
 * The section a role starts in. A hotel signing in used to land on the owner's
 * overview and be greeted by a refusal, with only a navigation link out of it.
 */
export function adminHome(role: AdminIdentity['role'] | null | undefined): string {
  return role === 'hotel' ? '/admin/hotel' : '/admin';
}

export async function getAdminIdentity(
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<AdminIdentity | null> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;

  const { data } = await client
    .from('admin_users')
    .select('user_id, role, active, hotel_id')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (!data) return null;
  if (data.role === 'super_admin') return { userId: data.user_id, role: 'super_admin' };
  if (data.role === 'hotel' && typeof data.hotel_id === 'string') {
    return { userId: data.user_id, role: 'hotel', hotelId: data.hotel_id };
  }
  // Anything else — an unknown role, or a hotel row with no hotel — is no
  // identity at all rather than a weaker one.
  return null;
}

export async function signInAdmin(
  email: string,
  password: string,
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<void> {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(invalidCredentialsMessage);
}

export async function signOutAdmin(
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export function onAdminAuthStateChange(
  listener: () => void,
  client: SupabaseClient = getSupabaseBrowserClient(),
): () => void {
  const { data: { subscription } } = client.auth.onAuthStateChange(listener);
  return () => subscription.unsubscribe();
}
