import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export type Room = {
  id: string;
  hotelId: string;
  label: string;
  publicToken: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ParsedRoomLabels = {
  labels: string[];
  duplicates: string[];
  /** Present only when some lines exceed the 40-character limit. */
  tooLong?: string[];
};

export const roomLabelMaxLength = 40;
export const roomBatchMaxSize = 300;

export class RoomValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'RoomValidationError';
  }
}

type RoomRow = {
  id: string;
  hotel_id: string;
  label: string;
  public_token: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

const roomColumns = 'id, hotel_id, label, public_token, active, created_at, updated_at';

/**
 * Splits free text into room labels: one per line, trimmed, blank lines dropped,
 * display case preserved. Later case-insensitive repeats are reported, never
 * silently discarded, so the editor can show them before anything is submitted.
 */
export function parseRoomLabels(input: string): ParsedRoomLabels {
  const labels: string[] = [];
  const duplicates: string[] = [];
  const tooLong: string[] = [];
  const seen = new Set<string>();

  for (const line of input.split(/\r?\n/)) {
    const label = line.trim();
    if (!label) continue;
    if (label.length > roomLabelMaxLength) {
      tooLong.push(label);
      continue;
    }
    const key = label.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(label);
      continue;
    }
    seen.add(key);
    labels.push(label);
  }

  return tooLong.length > 0 ? { labels, duplicates, tooLong } : { labels, duplicates };
}

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    hotelId: row.hotel_id,
    label: row.label,
    publicToken: row.public_token,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function unwrap<T>({ data, error }: { data: T | null; error: unknown }): T | null {
  if (error) throw error;
  return data;
}

function assertBatch(labels: string[]): void {
  if (labels.length === 0) throw new RoomValidationError('Добавьте хотя бы одну комнату');
  if (labels.length > roomBatchMaxSize) {
    throw new RoomValidationError(`За один раз можно добавить не больше ${roomBatchMaxSize} комнат`);
  }
  const parsed = parseRoomLabels(labels.join('\n'));
  if (parsed.tooLong) throw new RoomValidationError(`Название комнаты не длиннее ${roomLabelMaxLength} символов`);
  if (parsed.duplicates.length > 0) throw new RoomValidationError(`Повторяется: ${parsed.duplicates.join(', ')}`);
  if (parsed.labels.length !== labels.length) throw new RoomValidationError('Пустые названия комнат недопустимы');
}

export async function createRooms(
  hotelId: string,
  labels: string[],
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<Room[]> {
  assertBatch(labels);
  const rows = unwrap<RoomRow[]>(
    await client.rpc('create_rooms_batch', { target_hotel_id: hotelId, room_labels: labels.map((label) => label.trim()) }),
  );
  return (rows ?? []).map(toRoom);
}

export async function listRooms(hotelId: string, client: SupabaseClient = getSupabaseBrowserClient()): Promise<Room[]> {
  const rows = unwrap<RoomRow[]>(
    await client.from('rooms').select(roomColumns).eq('hotel_id', hotelId).order('label', { ascending: true }),
  );
  return (rows ?? []).map(toRoom);
}

export async function setRoomActive(
  roomId: string,
  active: boolean,
  client: SupabaseClient = getSupabaseBrowserClient(),
): Promise<Room> {
  const row = unwrap<RoomRow>(await client.from('rooms').update({ active }).eq('id', roomId).select(roomColumns).single());
  if (!row) throw new Error('Room was not returned after update');
  return toRoom(row);
}
