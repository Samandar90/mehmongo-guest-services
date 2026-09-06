'use client';

import { useEffect, useState } from 'react';
import {
  createHotelAccount as createHotelAccountDefault,
  listHotelAccounts as listHotelAccountsDefault,
  setHotelAccountActive as setHotelAccountActiveDefault,
  type CreatedHotelAccount,
  type HotelAccount,
} from '@/lib/admin/hotel-accounts';

const messages = {
  loadFailed: 'Не удалось загрузить доступы отеля.',
  emailRequired: 'Укажите email отеля',
  emailTaken: 'Этот email уже используется другим аккаунтом.',
  hotelMissing: 'Отель не найден. Обновите страницу.',
  forbidden: 'Нет прав на управление доступами. Войдите заново.',
  failed: 'Не удалось выполнить действие. Повторите попытку.',
};

function failureMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code as string | undefined
    : undefined;
  if (code === 'EMAIL_TAKEN') return messages.emailTaken;
  if (code === 'HOTEL_NOT_FOUND') return messages.hotelMissing;
  if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED') return messages.forbidden;
  return messages.failed;
}

type HotelAccountsProps = {
  hotelId: string;
  listAccounts?: (hotelId: string) => Promise<HotelAccount[]>;
  createAccount?: (hotelId: string, email: string) => Promise<CreatedHotelAccount>;
  setAccountActive?: (userId: string, active: boolean) => Promise<{ userId: string; active: boolean }>;
};

/**
 * The owner creates one sign-in per hotel and can take it away again.
 *
 * The password appears once, here, and is never stored or shown again: losing
 * it means creating a new account, which is stated on screen rather than
 * discovered later.
 */
export function HotelAccounts({
  hotelId,
  listAccounts = listHotelAccountsDefault,
  createAccount = createHotelAccountDefault,
  setAccountActive = setHotelAccountActiveDefault,
}: HotelAccountsProps) {
  const [accounts, setAccounts] = useState<HotelAccount[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<CreatedHotelAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const [loadAttempt, setLoadAttempt] = useState(0);

  // The loader lives inside the effect and reloading is a counter, matching the
  // hotel page: a useCallback that sets state, called from an effect body,
  // trips the react-compiler cascading-render rule.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const rows = await listAccounts(hotelId);
        if (cancelled) return;
        setAccounts(rows);
        setLoadError(false);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [hotelId, listAccounts, loadAttempt]);

  const create = async () => {
    const address = email.trim();
    if (!address) {
      setEmailError(messages.emailRequired);
      return;
    }
    setBusy(true);
    setEmailError(null);
    setFormError(null);
    try {
      const result = await createAccount(hotelId, address);
      setIssued(result);
      setAccounts((current) => [...(current ?? []), result.account]);
      setEmail('');
    } catch (caught) {
      setFormError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const changeActive = async (target: HotelAccount, active: boolean) => {
    setBusy(true);
    setFormError(null);
    setConfirmingId(null);
    try {
      const result = await setAccountActive(target.userId, active);
      setAccounts((current) => (current ?? []).map((row) => (
        row.userId === target.userId ? { ...row, active: result.active } : row
      )));
    } catch (caught) {
      setFormError(failureMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-hotel-accounts">
      {loadError ? (
        <div role="alert" className="admin-form-error">
          <p>{messages.loadFailed}</p>
          <button type="button" className="admin-button admin-button-secondary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Повторить загрузку
          </button>
        </div>
      ) : null}

      {accounts !== null && accounts.length === 0 ? (
        <p className="admin-empty">У отеля пока нет доступа в кабинет.</p>
      ) : null}

      {accounts !== null && accounts.length > 0 ? (
        <ul className="admin-account-list">
          {accounts.map((row) => (
            <li key={row.userId}>
              <span>{row.email}</span>
              <span className={row.active ? 'admin-badge admin-badge-active' : 'admin-badge admin-badge-inactive'}>
                {row.active ? 'Активен' : 'Отключён'}
              </span>
              {row.active ? (
                confirmingId === row.userId ? (
                  <span className="admin-confirm">
                    <button
                      type="button"
                      className="admin-button admin-button-danger"
                      disabled={busy}
                      aria-label={`Подтвердить отключение ${row.email}`}
                      onClick={() => { void changeActive(row, false); }}
                    >
                      Подтвердить отключение
                    </button>
                    <button
                      type="button"
                      className="admin-button admin-button-secondary"
                      onClick={() => setConfirmingId(null)}
                    >
                      Отмена
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="admin-button admin-button-secondary"
                    disabled={busy}
                    aria-label={`Отключить ${row.email}`}
                    onClick={() => setConfirmingId(row.userId)}
                  >
                    Отключить
                  </button>
                )
              ) : (
                // Restoring access is one step: it grants nothing that was not
                // granted before, and the two-step guard is for taking away.
                <button
                  type="button"
                  className="admin-button admin-button-secondary"
                  disabled={busy}
                  aria-label={`Включить ${row.email}`}
                  onClick={() => { void changeActive(row, true); }}
                >
                  Включить
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {issued ? (
        <div className="admin-form-success admin-issued-password">
          <p>Доступ для <strong>{issued.account.email}</strong> создан.</p>
          <p>Пароль: <code>{issued.password}</code></p>
          <p className="admin-hint">
            Передайте его отелю сейчас: пароль больше не будет показан и не хранится.
            Если он потеряется, создайте новый доступ.
          </p>
          <button type="button" className="admin-button admin-button-secondary" onClick={() => setIssued(null)}>
            Я передал пароль
          </button>
        </div>
      ) : null}

      <form
        className="admin-form"
        aria-label="Новый доступ отеля"
        onSubmit={(event) => { event.preventDefault(); void create(); }}
      >
        <div className="admin-field">
          <label htmlFor="hotel-account-email">Email отеля</label>
          <input
            id="hotel-account-email"
            type="email"
            value={email}
            disabled={busy}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? 'hotel-account-email-error' : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          {emailError ? <p id="hotel-account-email-error" className="field-error">{emailError}</p> : null}
        </div>
        {formError ? <p role="alert" className="admin-form-error">{formError}</p> : null}
        <button type="submit" disabled={busy}>{busy ? 'Создание…' : 'Создать доступ'}</button>
      </form>
    </div>
  );
}
