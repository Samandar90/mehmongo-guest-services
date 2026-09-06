import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminShell } from './admin-shell';
import type { AdminIdentity } from '@/lib/admin/auth';

const pathnameState = vi.hoisted(() => ({ current: '/admin' }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameState.current,
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
  // A fresh element on every render: reusing one element reference lets React
  // bail out of re-rendering, which would hide pathname changes from the shell.
  const element = () => (
    <AdminShell
      getIdentity={getIdentity}
      subscribeToAuthChanges={subscribeToAuthChanges}
      signOut={signOut}
      router={router}
    >
      <h1>Защищённая страница</h1>
    </AdminShell>
  );
  const { rerender } = render(element());
  return Object.assign(router, { rerender: () => rerender(element()) });
}

describe('AdminShell', () => {
  beforeEach(() => {
    pathnameState.current = '/admin';
  });

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

  it('marks the current section in the navigation', async () => {
    pathnameState.current = '/admin/hotels/hotel-1';
    renderAdminShell({ identity: { userId: 'user-1', role: 'super_admin' } });

    expect(await screen.findByRole('link', { name: 'Отели' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Обзор' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('navigation', { name: 'Административная навигация' })).toHaveClass('admin-nav');
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
  it('protects the admin again after a completed sign-out and a new login', async () => {
    const user = userEvent.setup();
    const identity = { userId: 'user-1', role: 'super_admin' } as const;
    const getIdentity = vi.fn().mockResolvedValue(identity);
    const router = renderAdminShell({ identity, getIdentity, signOut: vi.fn().mockResolvedValue(undefined) });

    await user.click(await screen.findByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/login'));

    pathnameState.current = '/admin/login';
    router.rerender();
    pathnameState.current = '/admin';
    router.rerender();

    expect(await screen.findByText('Защищённая страница')).toBeInTheDocument();
    expect(getIdentity).toHaveBeenCalledTimes(2);
  });
});

const hotelIdentity: AdminIdentity = { userId: 'user-2', role: 'hotel', hotelId: 'hotel-1' };
const ownerIdentity: AdminIdentity = { userId: 'user-1', role: 'super_admin' };

describe('AdminShell roles', () => {
  beforeEach(() => {
    pathnameState.current = '/admin';
  });

  it('shows the owner every section', async () => {
    renderAdminShell({ identity: ownerIdentity });

    expect(await screen.findByRole('link', { name: 'Обзор' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Отели' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Заявки' })).toBeVisible();
  });

  it('refuses a hotel account an owner-only section instead of rendering it', async () => {
    pathnameState.current = '/admin/requests';
    renderAdminShell({ identity: hotelIdentity });

    expect(await screen.findByText(/Этот раздел доступен только владельцу/)).toBeVisible();
    expect(screen.queryByText('Защищённая страница')).toBeNull();
  });

  it('offers a hotel account no owner-only link to follow', async () => {
    renderAdminShell({ identity: hotelIdentity });

    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    expect(screen.queryByRole('link', { name: 'Отели' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Заявки' })).toBeNull();
  });

  it('lets a hotel account sign out from the refusal, so it is never stuck', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const router = renderAdminShell({ identity: hotelIdentity, signOut });

    await userEvent.click(await screen.findByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/login'));
    expect(signOut).toHaveBeenCalled();
  });

  it('does not send a refused hotel account back to the login page', async () => {
    pathnameState.current = '/admin/hotels';
    const router = renderAdminShell({ identity: hotelIdentity });

    await screen.findByText(/Этот раздел доступен только владельцу/);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('AdminShell hotel cabinet', () => {
  beforeEach(() => {
    pathnameState.current = '/admin/hotel';
  });

  it('lets a hotel account open its own cabinet', async () => {
    renderAdminShell({ identity: hotelIdentity });

    expect(await screen.findByText('Защищённая страница')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Мой отель' })).toBeVisible();
  });

  it('does not offer the owner a cabinet that is not theirs', async () => {
    renderAdminShell({ identity: ownerIdentity });

    await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
    expect(screen.queryByRole('link', { name: 'Мой отель' })).toBeNull();
    // Refused, but told why from their own side rather than the hotel's.
    expect(screen.getByText(/кабинет отеля/)).toBeVisible();
    expect(screen.queryByText(/доступен только владельцу/)).toBeNull();
  });
});

describe('AdminShell refusal is not a dead end', () => {
  beforeEach(() => {
    pathnameState.current = '/admin';
  });

  it('points a refused hotel account at the section it can open', async () => {
    renderAdminShell({ identity: hotelIdentity });

    const link = await screen.findByRole('link', { name: /Перейти в кабинет отеля/ });
    expect(link).toHaveAttribute('href', '/admin/hotel');
  });

  it('offers the owner their own overview when they land in the hotel cabinet', async () => {
    pathnameState.current = '/admin/hotel';
    renderAdminShell({ identity: ownerIdentity });

    const link = await screen.findByRole('link', { name: /Перейти в обзор/ });
    expect(link).toHaveAttribute('href', '/admin');
  });
});
