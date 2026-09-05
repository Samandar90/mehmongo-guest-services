import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export type Hotel = {
  id: string;
  name: string;
  slug: string;
  address: string;
  commissionBps: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HotelInput = {
  name: string;
  slug: string;
  address: string;
  commissionPercent: string;
};

export type HotelFieldErrors = Partial<Record<keyof HotelInput, string>>;

type NormalizedHotelInput = {
  name: string;
  slug: string;
  address: string;
  commissionBps: number;
};

export type HotelValidationResult =
  | { ok: true; value: NormalizedHotelInput }
  | { ok: false; errors: HotelFieldErrors };

export class HotelValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(readonly fields: HotelFieldErrors) {
    super('Hotel input is invalid');
    this.name = 'HotelValidationError';
  }
}

export const hotelValidationMessages = {
  name: 'Введите название от 2 до 120 символов',
  slug: 'Slug: строчные латинские буквы, цифры и дефисы',
  address: 'Адрес не длиннее 240 символов',
  commissionPercent: 'Введите процент от 0 до 100',
} as const;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const percentPattern = /^\d{1,3}(?:[.,]\d{1,2})?$/;

type HotelRow = {
  id: string;
  name: string;
  slug: string;
  address: string;
  commission_bps: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

const hotelColumns = 'id, name, slug, address, commission_bps, active, created_at, updated_at';

export function validateHotelInput(input: HotelInput): HotelValidationResult {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const address = input.address.trim();
  const percent = input.commissionPercent.trim().replace(',', '.');
  const errors: HotelFieldErrors = {};

  if (name.length < 2 || name.length > 120) errors.name = hotelValidationMessages.name;
  if (!slugPattern.test(slug)) errors.slug = hotelValidationMessages.slug;
  if (address.length > 240) errors.address = hotelValidationMessages.address;

  const commissionBps = percentPattern.test(percent) ? Math.round(Number(percent) * 100) : Number.NaN;
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10000) {
    errors.commissionPercent = hotelValidationMessages.commissionPercent;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, slug, address, commissionBps } };
}

/** Postgres unique_violation on hotels.slug (the only unique text column). */
export function isDuplicateSlugError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

export function formatCommissionPercent(commissionBps: number): string {
  return (commissionBps / 100).toFixed(2).replace(/\.?0+$/, '');
}

function toHotel(row: HotelRow): Hotel {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    address: row.address,
    commissionBps: row.commission_bps,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeOrThrow(input: HotelInput): NormalizedHotelInput {
  const result = validateHotelInput(input);
  if (!result.ok) throw new HotelValidationError(result.errors);
  return result.value;
}

function toRowPayload(value: NormalizedHotelInput) {
  return { name: value.name, slug: value.slug, address: value.address, commission_bps: value.commissionBps };
}

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T | null {
  if (error) throw error;
  return data;
}

export async function listHotels(client: SupabaseClient = getSupabaseBrowserClient()): Promise<Hotel[]> {
  const rows = unwrap<HotelRow[]>(await client.from('hotels').select(hotelColumns).order('name', { ascending: true }));
  return (rows ?? []).map(toHotel);
}

export async function getHotel(id: string, client: SupabaseClient = getSupabaseBrowserClient()): Promise<Hotel | null> {
  const row = unwrap<HotelRow>(await client.from('hotels').select(hotelColumns).eq('id', id).maybeSingle());
  return row ? toHotel(row) : null;
}

export async function createHotel(input: HotelInput, client: SupabaseClient = getSupabaseBrowserClient()): Promise<Hotel> {
  const payload = toRowPayload(normalizeOrThrow(input));
  const row = unwrap<HotelRow>(await client.from('hotels').insert(payload).select(hotelColumns).single());
  if (!row) throw new Error('Hotel was not returned after insert');
  return toHotel(row);
}

export async function updateHotel(id: string, input: HotelInput, client: SupabaseClient = getSupabaseBrowserClient()): Promise<Hotel> {
  const payload = toRowPayload(normalizeOrThrow(input));
  const row = unwrap<HotelRow>(await client.from('hotels').update(payload).eq('id', id).select(hotelColumns).single());
  if (!row) throw new Error('Hotel was not returned after update');
  return toHotel(row);
}

export async function setHotelActive(id: string, active: boolean, client: SupabaseClient = getSupabaseBrowserClient()): Promise<Hotel> {
  const row = unwrap<HotelRow>(await client.from('hotels').update({ active }).eq('id', id).select(hotelColumns).single());
  if (!row) throw new Error('Hotel was not returned after update');
  return toHotel(row);
}
