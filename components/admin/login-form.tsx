'use client';

import { useState, type SubmitEvent } from 'react';
import { useRouter } from 'next/navigation';
import { signInAdmin } from '@/lib/admin/auth';

type Router = Pick<ReturnType<typeof useRouter>, 'replace'>;

export function LoginForm({
  signIn = signInAdmin,
  router: routerOverride,
}: {
  signIn?: (email: string, password: string) => Promise<void>;
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
      router.replace('/admin');
    } catch {
      setError('Не удалось войти. Проверьте email и пароль.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="admin-login">
      <h1>Вход в админку</h1>
      <form onSubmit={submit}>
        <div className="admin-field">
          <label htmlFor="admin-email">Email</label>
          <input id="admin-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
        <div className="admin-field">
          <label htmlFor="admin-password">Пароль</label>
          <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </div>
        {error ? <p role="alert" className="admin-form-error">{error}</p> : null}
        <button type="submit" disabled={submitting}>{submitting ? 'Вход…' : 'Войти'}</button>
      </form>
    </main>
  );
}
