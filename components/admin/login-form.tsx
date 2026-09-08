'use client';

import { useState, type SubmitEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BrandLockup } from '@/components/brand-lockup';
import { adminHome, getAdminIdentity, signInAdmin, type AdminIdentity } from '@/lib/admin/auth';

type Router = Pick<ReturnType<typeof useRouter>, 'replace'>;

export function LoginForm({
  signIn = signInAdmin,
  getIdentity = getAdminIdentity,
  router: routerOverride,
}: {
  signIn?: (email: string, password: string) => Promise<void>;
  getIdentity?: () => Promise<AdminIdentity | null>;
  router?: Router;
}) {
  const appRouter = useRouter();
  const router = routerOverride ?? appRouter;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
      // Resolved here so the first screen after a password is the one this
      // account can actually use. If it cannot be read, the shell re-checks and
      // redirects anyway, so the overview is a safe fallback rather than a stall.
      let identity: AdminIdentity | null = null;
      try {
        identity = await getIdentity();
      } catch {
        identity = null;
      }
      router.replace(adminHome(identity?.role));
    } catch {
      setError('Не удалось войти. Проверьте email и пароль.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="admin-login">
      {/* The card gives the form edges. Two labelled fields floating on an
          empty page read as a page that failed to finish loading, and this is
          the first screen a partner hotel ever sees of the product. */}
      <div className="admin-login-card">
        <BrandLockup />
        <div className="admin-login-head">
          <h1>Вход в админку</h1>
          <p>Для владельца и подключённых отелей</p>
        </div>
        <form onSubmit={submit}>
          <div className="admin-field">
            <label htmlFor="admin-email">Email</label>
            <input id="admin-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          <div className="admin-field">
            <label htmlFor="admin-password">Пароль</label>
            <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          {error ? <p role="alert" className="admin-form-error">{error}</p> : null}
          <button type="submit" disabled={submitting}>{submitting ? 'Вход…' : 'Войти'}</button>
        </form>
      </div>
    </main>
  );
}
