'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { InstallApp } from '@/components/admin/install-app';
import {
  adminHome,
  getAdminIdentity,
  onAdminAuthStateChange,
  signOutAdmin,
  type AdminIdentity,
} from '@/lib/admin/auth';

type Router = Pick<ReturnType<typeof useRouter>, 'replace'>;

/**
 * Which role may open which section. A hotel account has no section yet — its
 * cabinet is still to be built — so it sees an empty navigation and a refusal
 * on anything owner-only, rather than a half-rendered owner screen.
 */
const navigation: { href: string; label: string; roles: AdminIdentity['role'][] }[] = [
  { href: '/admin', label: 'Обзор', roles: ['super_admin'] },
  { href: '/admin/hotels', label: 'Отели', roles: ['super_admin'] },
  { href: '/admin/requests', label: 'Заявки', roles: ['super_admin'] },
  { href: '/admin/hotel', label: 'Мой отель', roles: ['hotel'] },
];

function mayOpen(pathname: string | null, role: AdminIdentity['role']): boolean {
  const section = navigation.find((item) => isCurrentSection(pathname, item.href));
  // An unlisted route is owner-only by default: a section added later is
  // closed to a hotel account until someone opens it deliberately.
  return section ? section.roles.includes(role) : role === 'super_admin';
}

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
  const [role, setRole] = useState<AdminIdentity['role'] | null>(null);
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
        setRole(identity.role);
        setStatus('allowed');
        return;
      }

      setRole(null);
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

  // Signed in, but not for this section. A redirect would bounce a hotel
  // account between the login page and a section it can never open, so the
  // refusal is stated instead, with the way out.
  const sectionAllowed = role !== null && mayOpen(pathname, role);

  return (
    <div className="admin-shell">
      <nav className="admin-nav" aria-label="Административная навигация">
        <span className="admin-nav-brand">Mehmon<span>Go</span></span>
        {navigation.filter((item) => role !== null && item.roles.includes(role)).map((item) => (
          <Link key={item.href} href={item.href} aria-current={isCurrentSection(pathname, item.href) ? 'page' : undefined}>
            {item.label}
          </Link>
        ))}
        <InstallApp />
        <button type="button" onClick={handleSignOut}>Выйти</button>
      </nav>
      {signOutError ? (
        <div role="alert" className="admin-form-error admin-page">
          <p>{signOutError}</p>
          <button type="button" className="admin-button admin-button-secondary" onClick={handleSignOut}>Повторить выход</button>
        </div>
      ) : null}
      {sectionAllowed ? children : (
        <main className="admin-page admin-gate" aria-live="polite">
          {/* Told from the reader's side: an owner refused the hotel cabinet is
              not being told the section is owner-only. */}
          <p>{role === 'hotel'
            ? 'Этот раздел доступен только владельцу MehmonGo.'
            : 'Этот раздел — кабинет отеля, он открывается под учётной записью отеля.'}</p>
          {/* A refusal must never be a dead end: the way on is stated, not left
              to be found in the navigation. */}
          <p>
            <Link href={adminHome(role)}>
              {role === 'hotel' ? 'Перейти в кабинет отеля' : 'Перейти в обзор'}
            </Link>
          </p>
        </main>
      )}
    </div>
  );
}
