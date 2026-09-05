'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  getAdminIdentity,
  onAdminAuthStateChange,
  signOutAdmin,
  type AdminIdentity,
} from '@/lib/admin/auth';

type Router = Pick<ReturnType<typeof useRouter>, 'replace'>;

const navigation = [
  { href: '/admin', label: 'Обзор' },
  { href: '/admin/hotels', label: 'Отели' },
  { href: '/admin/requests', label: 'Заявки' },
] as const;

function isCurrentSection(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

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
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const identityGeneration = useRef(0);
  const signOutInProgress = useRef(false);
  const recheckIdentity = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (isLoginRoute) {
      // Reaching the login route completes any sign-out; a later login must
      // be able to resolve identity again for protected routes.
      signOutInProgress.current = false;
      recheckIdentity.current = () => undefined;
      return;
    }

    let cancelled = false;
    const resolveIdentity = async () => {
      if (signOutInProgress.current) return;
      const currentGeneration = ++identityGeneration.current;
      setStatus('loading');
      let identity: AdminIdentity | null = null;
      try {
        identity = await getIdentity();
      } catch {
        identity = null;
      }
      if (cancelled || signOutInProgress.current || currentGeneration !== identityGeneration.current) return;

      if (identity) {
        setStatus('allowed');
        return;
      }

      setStatus('denied');
      router.replace('/admin/login');
    };

    recheckIdentity.current = () => { void resolveIdentity(); };
    void resolveIdentity();
    const unsubscribe = subscribeToAuthChanges(recheckIdentity.current);
    return () => {
      cancelled = true;
      identityGeneration.current += 1;
      recheckIdentity.current = () => undefined;
      unsubscribe();
    };
  }, [getIdentity, isLoginRoute, router, subscribeToAuthChanges]);

  if (isLoginRoute) return children;
  if (status !== 'allowed') {
    return <main className="admin-gate" aria-live="polite">{status === 'loading' ? 'Загрузка…' : 'Перенаправление…'}</main>;
  }

  const handleSignOut = async () => {
    identityGeneration.current += 1;
    signOutInProgress.current = true;
    setStatus('loading');
    setSignOutError(null);
    try {
      await signOut();
      router.replace('/admin/login');
    } catch {
      signOutInProgress.current = false;
      setSignOutError('Не удалось выйти. Повторите попытку.');
      recheckIdentity.current();
    }
  };

  return (
    <div className="admin-shell">
      <nav className="admin-nav" aria-label="Административная навигация">
        <span className="admin-nav-brand">Mehmon<span>Go</span></span>
        {navigation.map((item) => (
          <Link key={item.href} href={item.href} aria-current={isCurrentSection(pathname, item.href) ? 'page' : undefined}>
            {item.label}
          </Link>
        ))}
        <button type="button" onClick={handleSignOut}>Выйти</button>
      </nav>
      {signOutError ? (
        <div role="alert" className="admin-form-error admin-page">
          <p>{signOutError}</p>
          <button type="button" className="admin-button admin-button-secondary" onClick={handleSignOut}>Повторить выход</button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
