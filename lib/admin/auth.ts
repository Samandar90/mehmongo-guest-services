import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export type AdminIdentity = {
  userId: string;
  role: 'super_admin';
};

const invalidCredentialsMessage = 'Не удалось войти. Проверьте email и пароль.';

export async function getAdminIdentity(
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<AdminIdentity | null> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;

  const { data } = await client
    .from('admin_users')
    .select('user_id, role, active')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();

  return data?.role === 'super_admin'
    ? { userId: data.user_id, role: 'super_admin' }
    : null;
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
