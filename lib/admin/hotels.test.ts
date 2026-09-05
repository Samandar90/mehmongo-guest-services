import { describe, expect, it, vi } from 'vitest';
import {
  createHotel,
  formatCommissionPercent,
  getHotel,
  listHotels,
  setHotelActive,
  updateHotel,
  validateHotelInput,
  type HotelInput,
} from './hotels';

const hotelRow = {
  id: 'hotel-1',
  name: 'Kamilovs Hotel',
  slug: 'kamilovs',
  address: 'Samarkand',
  commission_bps: 1500,
  active: true,
  created_at: '2026-09-01T10:00:00.000Z',
  updated_at: '2026-09-02T10:00:00.000Z',
};

const kamilovsHotel = {
  id: 'hotel-1',
  name: 'Kamilovs Hotel',
  slug: 'kamilovs',
  address: 'Samarkand',
  commissionBps: 1500,
  active: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

const validInput: HotelInput = {
  name: 'Kamilovs Hotel',
  slug: 'kamilovs',
  address: 'Samarkand',
  commissionPercent: '15',
};

function createHotelsClient(result: { data: unknown; error: unknown } = { data: hotelRow, error: null }) {
  const builder = {
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  const client = { from: vi.fn().mockReturnValue(builder) };
  return { client: client as never, from: client.from, builder };
}

describe('hotel input validation', () => {
  it('normalizes slug to lowercase and trims text fields', () => {
    const result = validateHotelInput({
      name: '  Kamilovs Hotel ',
      slug: ' Kamilovs-Hotel ',
      address: ' Samarkand ',
      commissionPercent: ' 15 ',
    });

    expect(result).toEqual({
      ok: true,
      value: { name: 'Kamilovs Hotel', slug: 'kamilovs-hotel', address: 'Samarkand', commissionBps: 1500 },
    });
  });

  it('accepts a comma or dot decimal percent with up to two decimals', () => {
    expect(validateHotelInput({ ...validInput, commissionPercent: '12,5' })).toMatchObject({ ok: true, value: { commissionBps: 1250 } });
    expect(validateHotelInput({ ...validInput, commissionPercent: '0.33' })).toMatchObject({ ok: true, value: { commissionBps: 33 } });
    expect(validateHotelInput({ ...validInput, commissionPercent: '100' })).toMatchObject({ ok: true, value: { commissionBps: 10000 } });
  });

  it('rejects malformed fields with per-field messages', () => {
    const result = validateHotelInput({
      name: 'X',
      slug: 'Bad Slug',
      address: 'a'.repeat(241),
      commissionPercent: '101',
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'Введите название от 2 до 120 символов',
        slug: 'Slug: строчные латинские буквы, цифры и дефисы',
        address: 'Адрес не длиннее 240 символов',
        commissionPercent: 'Введите процент от 0 до 100',
      },
    });
  });

  it('rejects a percent with more than two decimals or a negative value', () => {
    expect(validateHotelInput({ ...validInput, commissionPercent: '15.555' })).toMatchObject({
      ok: false,
      errors: { commissionPercent: 'Введите процент от 0 до 100' },
    });
    expect(validateHotelInput({ ...validInput, commissionPercent: '-1' })).toMatchObject({
      ok: false,
      errors: { commissionPercent: 'Введите процент от 0 до 100' },
    });
  });

  it('formats basis points as a display percent', () => {
    expect(formatCommissionPercent(1500)).toBe('15');
    expect(formatCommissionPercent(1250)).toBe('12.5');
    expect(formatCommissionPercent(33)).toBe('0.33');
    expect(formatCommissionPercent(0)).toBe('0');
  });
});

describe('hotel repository', () => {
  it('converts display percent to basis points and returns the created hotel', async () => {
    const { client, from, builder } = createHotelsClient();

    await expect(createHotel(validInput, client)).resolves.toEqual(kamilovsHotel);

    expect(from).toHaveBeenCalledWith('hotels');
    expect(builder.insert).toHaveBeenCalledWith({ name: 'Kamilovs Hotel', slug: 'kamilovs', address: 'Samarkand', commission_bps: 1500 });
    expect(builder.select).toHaveBeenCalled();
    expect(builder.single).toHaveBeenCalled();
  });

  it('rejects malformed slug and commission before touching the database', async () => {
    const { client, from } = createHotelsClient();

    await expect(createHotel({ name: 'X', slug: 'Bad Slug', address: '', commissionPercent: '101' }, client))
      .rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        fields: { slug: 'Slug: строчные латинские буквы, цифры и дефисы', commissionPercent: 'Введите процент от 0 до 100' },
      });
    expect(from).not.toHaveBeenCalled();
  });

  it('propagates the database error when insert fails', async () => {
    const { client } = createHotelsClient({ data: null, error: { code: '23505', message: 'duplicate key value' } });

    await expect(createHotel(validInput, client)).rejects.toMatchObject({ code: '23505' });
  });

  it('lists hotels ordered by name', async () => {
    const { client, builder } = createHotelsClient({ data: [hotelRow], error: null });

    await expect(listHotels(client)).resolves.toEqual([kamilovsHotel]);
    expect(builder.order).toHaveBeenCalledWith('name', { ascending: true });
  });

  it('returns null for a missing hotel', async () => {
    const { client, builder } = createHotelsClient({ data: null, error: null });

    await expect(getHotel('missing', client)).resolves.toBeNull();
    expect(builder.eq).toHaveBeenCalledWith('id', 'missing');
    expect(builder.maybeSingle).toHaveBeenCalled();
  });

  it('updates hotel fields by id and returns the updated hotel', async () => {
    const { client, builder } = createHotelsClient();

    await expect(updateHotel('hotel-1', { ...validInput, commissionPercent: '12.5' }, client)).resolves.toEqual(kamilovsHotel);
    expect(builder.update).toHaveBeenCalledWith({ name: 'Kamilovs Hotel', slug: 'kamilovs', address: 'Samarkand', commission_bps: 1250 });
    expect(builder.eq).toHaveBeenCalledWith('id', 'hotel-1');
  });

  it('toggles the active flag by id', async () => {
    const { client, builder } = createHotelsClient({ data: { ...hotelRow, active: false }, error: null });

    await expect(setHotelActive('hotel-1', false, client)).resolves.toEqual({ ...kamilovsHotel, active: false });
    expect(builder.update).toHaveBeenCalledWith({ active: false });
    expect(builder.eq).toHaveBeenCalledWith('id', 'hotel-1');
  });
});
