import { describe, expect, it, vi } from 'vitest';

describe('getSupabaseBrowserClient', () => {
  it('rejects missing public configuration', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const { getSupabaseBrowserClient } = await import('./client');
    expect(() => getSupabaseBrowserClient()).toThrow('Supabase public configuration is missing');
  });
});
