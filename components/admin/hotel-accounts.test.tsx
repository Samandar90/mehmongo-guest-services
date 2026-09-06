import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HotelAccounts } from './hotel-accounts';
import { HotelAccountError, type CreatedHotelAccount, type HotelAccount } from '@/lib/admin/hotel-accounts';

const account: HotelAccount = { userId: 'user-2', email: 'reception@example.test', active: true };
const created: CreatedHotelAccount = {
  account: { userId: 'user-3', email: 'new@example.test', active: true },
  password: 'Kq7mRt2vXb9pLn4sWd6h',
};

function renderAccounts({
  list = vi.fn().mockResolvedValue([account]),
  create = vi.fn().mockResolvedValue(created),
  setActive = vi.fn().mockResolvedValue({ userId: 'user-2', active: false }),
}: {
  list?: () => Promise<HotelAccount[]>;
  create?: (hotelId: string, email: string) => Promise<CreatedHotelAccount>;
  setActive?: (userId: string, active: boolean) => Promise<{ userId: string; active: boolean }>;
} = {}) {
  render(<HotelAccounts hotelId="hotel-1" listAccounts={list} createAccount={create} setAccountActive={setActive} />);
  return { list, create, setActive };
}

describe('HotelAccounts', () => {
  it('lists the sign-ins a hotel already has', async () => {
    renderAccounts();
    expect(await screen.findByText('reception@example.test')).toBeVisible();
    expect(screen.getByText('Активен')).toBeVisible();
  });

  it('says plainly when a hotel has no sign-in yet', async () => {
    renderAccounts({ list: vi.fn().mockResolvedValue([]) });
    expect(await screen.findByText(/пока нет доступа/i)).toBeVisible();
  });

  it('creates a sign-in and shows the password once, with a warning that it will not be shown again', async () => {
    const { create } = renderAccounts({ list: vi.fn().mockResolvedValue([]) });
    await screen.findByText(/пока нет доступа/i);

    await userEvent.type(screen.getByLabelText('Email отеля'), 'new@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Создать доступ' }));

    expect(create).toHaveBeenCalledWith('hotel-1', 'new@example.test');
    expect(await screen.findByText('Kq7mRt2vXb9pLn4sWd6h')).toBeVisible();
    expect(screen.getByText(/больше не будет показан/i)).toBeVisible();
  });

  it('keeps the new sign-in in the list without a reload', async () => {
    renderAccounts({ list: vi.fn().mockResolvedValue([]) });
    await screen.findByText(/пока нет доступа/i);

    await userEvent.type(screen.getByLabelText('Email отеля'), 'new@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Создать доступ' }));

    // The address also appears in the password panel; the list is what has to
    // show it, because that panel is dismissed as soon as the owner passes it on.
    const list = await screen.findByRole('list');
    expect(within(list).getByText('new@example.test')).toBeVisible();
  });

  it('names an address that is already taken instead of failing silently', async () => {
    renderAccounts({
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockRejectedValue(new HotelAccountError('EMAIL_TAKEN')),
    });
    await screen.findByText(/пока нет доступа/i);

    await userEvent.type(screen.getByLabelText('Email отеля'), 'taken@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Создать доступ' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/уже используется/i);
  });

  it('asks to confirm before taking a hotel’s access away', async () => {
    const { setActive } = renderAccounts();
    await screen.findByText('reception@example.test');

    await userEvent.click(screen.getByRole('button', { name: /Отключить reception@example.test/ }));
    expect(setActive).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Подтвердить отключение/ }));
    expect(setActive).toHaveBeenCalledWith('user-2', false);
    expect(await screen.findByText('Отключён')).toBeVisible();
  });

  it('re-enables a disabled sign-in in one step', async () => {
    const { setActive } = renderAccounts({
      list: vi.fn().mockResolvedValue([{ ...account, active: false }]),
      setActive: vi.fn().mockResolvedValue({ userId: 'user-2', active: true }),
    });
    await screen.findByText('reception@example.test');

    await userEvent.click(screen.getByRole('button', { name: /Включить reception@example.test/ }));

    expect(setActive).toHaveBeenCalledWith('user-2', true);
    expect(await screen.findByText('Активен')).toBeVisible();
  });

  it('reports a list that could not be loaded, and offers to try again', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue([account]);
    renderAccounts({ list });

    expect(await screen.findByRole('alert')).toHaveTextContent(/Не удалось загрузить/);
    await userEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    await waitFor(() => expect(screen.getByText('reception@example.test')).toBeVisible());
  });
});
