import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HotelForm } from './hotel-form';
import type { Hotel, HotelInput } from '@/lib/admin/hotels';

const kamilovsHotel: Hotel = {
  id: 'hotel-1',
  name: 'Kamilovs Hotel',
  slug: 'kamilovs',
  address: 'Samarkand',
  commissionBps: 1250,
  active: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

type User = ReturnType<typeof userEvent.setup>;

function renderHotelForm({
  createHotel = vi.fn().mockResolvedValue(kamilovsHotel),
  updateHotel = vi.fn().mockResolvedValue(kamilovsHotel),
  hotel,
  onSaved,
}: {
  createHotel?: (input: HotelInput) => Promise<Hotel>;
  updateHotel?: (id: string, input: HotelInput) => Promise<Hotel>;
  hotel?: Hotel;
  onSaved?: (hotel: Hotel) => void;
} = {}) {
  render(<HotelForm hotel={hotel} createHotel={createHotel} updateHotel={updateHotel} onSaved={onSaved} />);
}

async function fillField(user: User, label: string, value: string) {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  if (value) await user.type(field, value);
}

async function fillHotelForm(
  user: User,
  { name, slug, address, percentage }: { name: string; slug: string; address: string; percentage: string },
) {
  await fillField(user, 'Название', name);
  await fillField(user, 'Slug', slug);
  await fillField(user, 'Адрес', address);
  await fillField(user, 'Процент отеля', percentage);
}

describe('HotelForm', () => {
  it('creates a hotel and resets after success', async () => {
    const user = userEvent.setup();
    const createHotel = vi.fn().mockResolvedValue(kamilovsHotel);
    const onSaved = vi.fn();
    renderHotelForm({ createHotel, onSaved });

    await fillHotelForm(user, { name: 'Kamilovs Hotel', slug: 'kamilovs', address: 'Samarkand', percentage: '15' });
    await user.click(screen.getByRole('button', { name: 'Создать отель' }));

    expect(createHotel).toHaveBeenCalledWith({ name: 'Kamilovs Hotel', slug: 'kamilovs', address: 'Samarkand', commissionPercent: '15' });
    expect(await screen.findByRole('status')).toHaveTextContent('Отель создан');
    expect(screen.getByLabelText('Название')).toHaveValue('');
    expect(screen.getByLabelText('Slug')).toHaveValue('');
    expect(screen.getByLabelText('Процент отеля')).toHaveValue('');
    expect(onSaved).toHaveBeenCalledWith(kamilovsHotel);
  });

  it('shows duplicate slug error next to slug', async () => {
    const user = userEvent.setup();
    renderHotelForm({ createHotel: vi.fn().mockRejectedValue({ code: '23505', message: 'duplicate key value' }) });

    await fillHotelForm(user, { name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', percentage: '15' });
    await user.click(screen.getByRole('button', { name: 'Создать отель' }));

    const error = await screen.findByText('Такой slug уже используется');
    expect(error).toHaveAttribute('id', 'slug-error');
    expect(screen.getByLabelText('Slug')).toHaveAttribute('aria-describedby', 'slug-error');
    expect(screen.getByLabelText('Slug')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Создать отель' })).toBeEnabled();
  });

  it('does not submit invalid percentage', async () => {
    const user = userEvent.setup();
    const createHotel = vi.fn();
    renderHotelForm({ createHotel });

    await fillHotelForm(user, { name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', percentage: '101' });
    await user.click(screen.getByRole('button', { name: 'Создать отель' }));

    expect(screen.getByText('Введите процент от 0 до 100')).toHaveAttribute('id', 'commissionPercent-error');
    expect(screen.getByLabelText('Процент отеля')).toHaveAttribute('aria-describedby', 'commissionPercent-error');
    expect(createHotel).not.toHaveBeenCalled();
  });

  it('edits an existing hotel with prefilled values and keeps them after saving', async () => {
    const user = userEvent.setup();
    const updated = { ...kamilovsHotel, name: 'Kamilovs Boutique' };
    const updateHotel = vi.fn().mockResolvedValue(updated);
    renderHotelForm({ hotel: kamilovsHotel, updateHotel });

    expect(screen.getByLabelText('Название')).toHaveValue('Kamilovs Hotel');
    expect(screen.getByLabelText('Slug')).toHaveValue('kamilovs');
    expect(screen.getByLabelText('Адрес')).toHaveValue('Samarkand');
    expect(screen.getByLabelText('Процент отеля')).toHaveValue('12.5');

    await fillField(user, 'Название', 'Kamilovs Boutique');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(updateHotel).toHaveBeenCalledWith('hotel-1', { name: 'Kamilovs Boutique', slug: 'kamilovs', address: 'Samarkand', commissionPercent: '12.5' });
    expect(await screen.findByRole('status')).toHaveTextContent('Изменения сохранены');
    expect(screen.getByLabelText('Название')).toHaveValue('Kamilovs Boutique');
  });

  it('disables submit while the mutation is pending', async () => {
    const user = userEvent.setup();
    let resolveCreate: ((hotel: Hotel) => void) | undefined;
    const createHotel = vi.fn().mockReturnValue(new Promise<Hotel>((resolve) => { resolveCreate = resolve; }));
    renderHotelForm({ createHotel });

    await fillHotelForm(user, { name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', percentage: '15' });
    await user.click(screen.getByRole('button', { name: 'Создать отель' }));

    expect(screen.getByRole('button', { name: 'Сохранение…' })).toBeDisabled();
    expect(screen.getByLabelText('Название')).toBeDisabled();
    expect(screen.getByLabelText('Процент отеля')).toBeDisabled();
    resolveCreate?.(kamilovsHotel);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Создать отель' })).toBeEnabled());
  });

  it('shows a retryable error when saving fails unexpectedly', async () => {
    const user = userEvent.setup();
    const createHotel = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(kamilovsHotel);
    renderHotelForm({ createHotel });

    await fillHotelForm(user, { name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', percentage: '15' });
    await user.click(screen.getByRole('button', { name: 'Создать отель' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить отель. Повторите попытку.');
    expect(screen.getByLabelText('Название')).toHaveValue('Kamilovs Hotel');

    await user.click(screen.getByRole('button', { name: 'Создать отель' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Отель создан');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('moves focus to the first invalid field when validation fails', async () => {
    const user = userEvent.setup();
    const createHotel = vi.fn();
    renderHotelForm({ createHotel });

    await fillHotelForm(user, { name: 'Kamilovs Hotel', slug: 'Bad Slug', address: '', percentage: '101' });
    await user.click(screen.getByRole('button', { name: 'Создать отель' }));

    expect(screen.getByLabelText('Slug')).toHaveFocus();
    expect(screen.getByText('Slug: строчные латинские буквы, цифры и дефисы')).toHaveAttribute('id', 'slug-error');
    expect(createHotel).not.toHaveBeenCalled();
  });

  it('clears the form-level error once the user edits a field', async () => {
    const user = userEvent.setup();
    renderHotelForm({ createHotel: vi.fn().mockRejectedValue(new Error('network')) });

    await fillHotelForm(user, { name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', percentage: '15' });
    await user.click(screen.getByRole('button', { name: 'Создать отель' }));
    await screen.findByRole('alert');

    await user.type(screen.getByLabelText('Адрес'), 'Samarkand');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the duplicate slug error when an edit collides with another hotel', async () => {
    const user = userEvent.setup();
    const updateHotel = vi.fn().mockRejectedValue({ code: '23505', message: 'duplicate key value' });
    renderHotelForm({ hotel: kamilovsHotel, updateHotel });

    await fillField(user, 'Slug', 'other-hotel');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Такой slug уже используется')).toHaveAttribute('id', 'slug-error');
    expect(screen.getByLabelText('Slug')).toHaveValue('other-hotel');
  });
});
