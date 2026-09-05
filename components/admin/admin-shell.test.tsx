import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminShell } from './admin-shell';
import type { AdminIdentity } from '@/lib/admin/auth';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ replace: vi.fn() }),
}));

function renderAdminShell({
  identity,
  getIdentity = vi.fn().mockResolvedValue(identity),
  subscribeToAuthChanges = () => () => undefined,
  signOut,
}: {
  identity: AdminIdentity | null;
  getIdentity?: () => Promise<AdminIdentity | null>;
  subscribeToAuthChanges?: (listener: () => void) => () => void;
  signOut?: () => Promise<void>;
}) {
  const router = { replace: vi.fn() };
  render(
    <AdminShell
      getIdentity={getIdentity}
      subscribeToAuthChanges={subscribeToAuthChanges}
      signOut={signOut}
      router={router}
    >
      <h1>Защищённая страница</h1>
    </AdminShell>,
  );
  return router;
}

describe('AdminShell', () => {
  it('redirects anonymous users to admin login without rendering protected content', async () => {
    const router = renderAdminShell({ identity: null });

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/login'));
    expect(screen.queryByText('Защищённая страница')).not.toBeInTheDocument();
    expect(screen.queryByText('Отели')).not.toBeInTheDocument();
  });

  it('renders navigation for a super admin', async () => {
    renderAdminShell({ identity: { userId: 'user-1', role: 'super_admin' } });

    expect(await screen.findByRole('link', { name: 'Отели' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Заявки' })).toBeInTheDocument();
  });

  it('rechecks access and offers a retry when sign-out fails', async () => {
    const user = userEvent.setup();
    const identity = { userId: 'user-1', role: 'super_admin' } as const;
    const getIdentity = vi.fn().mockResolvedValue(identity);
    renderAdminShell({
      identity,
      getIdentity,
      signOut: vi.fn().mockRejectedValue(new Error('network unavailable')),
    });

    await screen.findByRole('button', { name: 'Выйти' });
    await user.click(screen.getByRole('button', { name: 'Выйти' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось выйти. Повторите попытку.');
    expect(screen.getByRole('button', { name: 'Повторить выход' })).toBeInTheDocument();
    expect(screen.getByText('Защищённая страница')).toBeInTheDocument();
    expect(getIdentity).toHaveBeenCalledTimes(2);
  });

  it('keeps protected content hidden when a stale identity check resolves during sign-out', async () => {
    const user = userEvent.setup();
    const identity = { userId: 'user-1', role: 'super_admin' } as const;
    let onAuthChange: (() => void) | undefined;
    let resolveSignOut: (() => void) | undefined;
    const signOut = vi.fn().mockReturnValue(new Promise<void>((resolve) => { resolveSignOut = resolve; }));
    const subscribeToAuthChanges = vi.fn((listener: () => void) => {
      onAuthChange = listener;
      return () => undefined;
    });

    renderAdminShell({
      identity,
      getIdentity: vi.fn().mockResolvedValue(identity),
      signOut,
      subscribeToAuthChanges,
    });

    await screen.findByRole('button', { name: 'Выйти' });
    await user.click(screen.getByRole('button', { name: 'Выйти' }));
    onAuthChange?.();

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(screen.queryByText('Защищённая страница')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Отели' })).not.toBeInTheDocument();
    resolveSignOut?.();
  });
});
