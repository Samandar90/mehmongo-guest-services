import { describe, expect, it, vi } from 'vitest';
import { createRooms, listRooms, parseRoomLabels, setRoomActive } from './rooms';

const roomRow = {
  id: 'room-205',
  hotel_id: 'hotel-1',
  label: '205',
  public_token: '9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a',
  active: true,
  created_at: '2026-09-01T10:00:00.000Z',
  updated_at: '2026-09-02T10:00:00.000Z',
};

const room205 = {
  id: 'room-205',
  hotelId: 'hotel-1',
  label: '205',
  publicToken: '9c6f6f5e-2b6d-4c0f-9a7d-1f2e3d4c5b6a',
  active: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

function createRoomsClient(result: { data: unknown; error: unknown } = { data: [roomRow], error: null }) {
  const builder = {
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  const client = { from: vi.fn().mockReturnValue(builder), rpc: vi.fn().mockResolvedValue(result) };
  return { client: client as never, from: client.from, rpc: client.rpc, builder };
}

describe('parseRoomLabels', () => {
  it('accepts arbitrary room labels and removes blank lines', () => {
    expect(parseRoomLabels('101\n102A\n\nVilla 3')).toEqual({ labels: ['101', '102A', 'Villa 3'], duplicates: [] });
  });

  it('reports duplicates case-insensitively', () => {
    expect(parseRoomLabels('Penthouse\npenthouse')).toEqual({ labels: ['Penthouse'], duplicates: ['penthouse'] });
  });

  it('trims surrounding whitespace and accepts Windows line endings', () => {
    expect(parseRoomLabels('  205 \r\n 206\r\n')).toEqual({ labels: ['205', '206'], duplicates: [] });
  });

  it('reports labels longer than 40 characters without dropping the valid ones', () => {
    const long = 'x'.repeat(41);
    expect(parseRoomLabels(`205\n${long}`)).toEqual({ labels: ['205'], duplicates: [], tooLong: [long] });
  });
});

describe('createRooms', () => {
  it('calls the atomic batch RPC and returns typed rooms', async () => {
    const { client, rpc } = createRoomsClient();

    await expect(createRooms('hotel-1', ['205'], client)).resolves.toEqual([room205]);
    expect(rpc).toHaveBeenCalledWith('create_rooms_batch', { target_hotel_id: 'hotel-1', room_labels: ['205'] });
  });

  it('rejects an empty batch before calling the database', async () => {
    const { client, rpc } = createRoomsClient();

    await expect(createRooms('hotel-1', [], client)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects more than 300 labels in one batch', async () => {
    const { client, rpc } = createRoomsClient();
    const labels = Array.from({ length: 301 }, (_, index) => `R${index}`);

    await expect(createRooms('hotel-1', labels, client)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects over-long labels and case-insensitive duplicates', async () => {
    const { client, rpc } = createRoomsClient();

    await expect(createRooms('hotel-1', ['205', 'x'.repeat(41)], client)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(createRooms('hotel-1', ['Penthouse', 'penthouse'], client)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('propagates the database error when the batch conflicts', async () => {
    const { client } = createRoomsClient({ data: null, error: { code: '23505', message: 'duplicate key value' } });

    await expect(createRooms('hotel-1', ['101'], client)).rejects.toMatchObject({ code: '23505' });
  });
});

describe('room queries', () => {
  it('lists rooms for one hotel ordered by label', async () => {
    const { client, from, builder } = createRoomsClient();

    await expect(listRooms('hotel-1', client)).resolves.toEqual([room205]);
    expect(from).toHaveBeenCalledWith('rooms');
    expect(builder.eq).toHaveBeenCalledWith('hotel_id', 'hotel-1');
    expect(builder.order).toHaveBeenCalledWith('label', { ascending: true });
  });

  it('toggles a room by id and returns the updated room', async () => {
    const { client, builder } = createRoomsClient({ data: { ...roomRow, active: false }, error: null });

    await expect(setRoomActive('room-205', false, client)).resolves.toEqual({ ...room205, active: false });
    expect(builder.update).toHaveBeenCalledWith({ active: false });
    expect(builder.eq).toHaveBeenCalledWith('id', 'room-205');
  });
});
