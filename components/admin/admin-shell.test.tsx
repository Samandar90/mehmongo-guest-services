import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminShell } from './admin-shell';
import type { AdminIdentity } from '@/lib/admin/auth';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ replace: vi.fn() }),
}));

function renderAdminShell({ identity }: { identity: AdminIdentity | null }) {
  const router = { replace: vi.fn() };
  render(
    <AdminShell
      getIdentity={vi.fn().mockResolvedValue(identity)}
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
});
