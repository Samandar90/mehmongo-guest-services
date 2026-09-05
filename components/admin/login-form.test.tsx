import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

function renderLoginForm({ signIn }: { signIn: (email: string, password: string) => Promise<void> }) {
  const router = { replace: vi.fn() };
  render(<LoginForm signIn={signIn} router={router} />);
  return router;
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
