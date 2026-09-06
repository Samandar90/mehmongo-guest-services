import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';
import type { AdminIdentity } from '@/lib/admin/auth';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

function renderLoginForm({
  signIn,
  getIdentity = vi.fn().mockResolvedValue({ userId: 'user-1', role: 'super_admin' } satisfies AdminIdentity),
}: {
  signIn: (email: string, password: string) => Promise<void>;
  getIdentity?: () => Promise<AdminIdentity | null>;
}) {
  const router = { replace: vi.fn() };
  render(<LoginForm signIn={signIn} getIdentity={getIdentity} router={router} />);
  return router;
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Пароль'), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: 'Войти' }));
}

describe('LoginForm', () => {
  it('submits email and password then redirects', async () => {
    const user = userEvent.setup();
    const signIn = vi.fn().mockResolvedValue(undefined);
    const router = renderLoginForm({ signIn });

    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Пароль'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(signIn).toHaveBeenCalledWith('owner@example.com', 'correct horse battery staple');
    expect(router.replace).toHaveBeenCalledWith('/admin');
  });
});

describe('LoginForm landing', () => {
  it('sends a hotel account straight to its own cabinet', async () => {
    const user = userEvent.setup();
    const router = renderLoginForm({
      signIn: vi.fn().mockResolvedValue(undefined),
      getIdentity: vi.fn().mockResolvedValue({ userId: 'user-2', role: 'hotel', hotelId: 'hotel-1' }),
    });

    await signInAs(user, 'reception@example.test');

    // Landing on the owner's overview would greet a hotel with a refusal.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/hotel'));
  });

  it('sends the owner to the overview', async () => {
    const user = userEvent.setup();
    const router = renderLoginForm({ signIn: vi.fn().mockResolvedValue(undefined) });

    await signInAs(user, 'owner@example.com');

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin'));
  });

  it('still leaves the admin area when the role cannot be resolved', async () => {
    const user = userEvent.setup();
    const router = renderLoginForm({
      signIn: vi.fn().mockResolvedValue(undefined),
      getIdentity: vi.fn().mockRejectedValue(new Error('offline')),
    });

    await signInAs(user, 'owner@example.com');

    // The shell re-checks and redirects; the login form must not stall here.
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin'));
  });
});
