'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  getAdminIdentity,
  onAdminAuthStateChange,
  signOutAdmin,
  type AdminIdentity,
} from '@/lib/admin/auth';

type Router = Pick<ReturnType<typeof useRouter>, 'replace'>;

type AdminShellProps = {
  children: React.ReactNode;
  getIdentity?: () => Promise<AdminIdentity | null>;
  subscribeToAuthChanges?: (listener: () => void) => () => void;
  signOut?: () => Promise<void>;
  router?: Router;
};

export function AdminShell({
  children,
  getIdentity = getAdminIdentity,
  subscribeToAuthChanges = onAdminAuthStateChange,
  signOut = signOutAdmin,
  router: routerOverride,
}: AdminShellProps) {
  const pathname = usePathname();
  const appRouter = useRouter();
  const router = routerOverride ?? appRouter;
  const isLoginRoute = pathname === '/admin/login';
  const [status, setStatus] = useState<'loading' | 'allowed' | 'denied'>('loading');

  useEffect(() => {
    if (isLoginRoute) return;

    let cancelled = false;
    let requestId = 0;
    const resolveIdentity = async () => {
      const currentRequestId = ++requestId;
      setStatus('loading');
      let identity: AdminIdentity | null = null;
      try {
        identity = await getIdentity();
      } catch {
        identity = null;
      }
      if (cancelled || currentRequestId !== requestId) return;

      if (identity) {
        setStatus('allowed');
        return;
      }

      setStatus('denied');
      router.replace('/admin/login');
    };

    void resolveIdentity();
    const unsubscribe = subscribeToAuthChanges(() => { void resolveIdentity(); });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [getIdentity, isLoginRoute, router, subscribeToAuthChanges]);

  if (isLoginRoute) return children;
  if (status !== 'allowed') {
    return <main aria-live="polite">{status === 'loading' ? 'Загрузка…' : 'Перенаправление…'}</main>;
  }

  const handleSignOut = async () => {
    setStatus('loading');
    try {
      await signOut();
      router.replace('/admin/login');
    } catch {
      setStatus('denied');
    }
  };

  return (
    <div className="admin-shell">
      <nav aria-label="Административная навигация">
        <Link href="/admin">Обзор</Link>
        <Link href="/admin/hotels">Отели</Link>
        <Link href="/admin/requests">Заявки</Link>
        <button type="button" onClick={handleSignOut}>Выйти</button>
      </nav>
      {children}
    </div>
  );
}
