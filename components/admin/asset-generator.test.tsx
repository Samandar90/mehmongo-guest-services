import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssetGenerator, type GeneratedRoomAsset, type RoomAssetGenerator } from './asset-generator';
import type { Hotel } from '@/lib/admin/hotels';
import type { Room } from '@/lib/admin/rooms';
import type { RoomAssetInput } from '@/lib/assets/room-plaque';

// 1×1 white PNG so pdf-lib can embed it in the combined document.
const PNG_BYTES = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='),
  (char) => char.charCodeAt(0),
);
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

const kamilovs: Hotel = {
  id: 'hotel-1', name: 'Kamilovs Hotel', slug: 'kamilovs', address: '', commissionBps: 1500, active: true, guestCatalogId: null, createdAt: '', updatedAt: '',
};

const room205: Room = {
  id: 'room-205', hotelId: 'hotel-1', label: '205', publicToken: '4c5f9a10-1111-4222-8333-abcdefabcdef', active: true, createdAt: '', updatedAt: '',
};
const room206: Room = { ...room205, id: 'room-206', label: '206', publicToken: '5d6e7f80-2222-4333-8444-fedcbafedcba' };

function generatedAsset(room: Room): GeneratedRoomAsset {
  return {
    roomId: room.id,
    label: room.label,
    baseName: `kamilovs-room-${room.label}`,
    url: `https://example.com/r/${room.publicToken}`,
    qrDataUrl: PNG_DATA_URL,
    png: new Blob([PNG_BYTES as BlobPart], { type: 'image/png' }),
    pdf: PNG_BYTES,
  };
}

const asset205 = generatedAsset(room205);
const asset206 = generatedAsset(room206);

function controlledRoomGenerator() {
  const resolvers: Array<(asset: GeneratedRoomAsset) => void> = [];
  const generate = vi.fn((_input: RoomAssetInput) => new Promise<GeneratedRoomAsset>((resolve) => { resolvers.push(resolve); }));
  return Object.assign(generate, {
    resolveNext: (asset: GeneratedRoomAsset) => { resolvers.shift()?.(asset); },
  });
}

function rejectingRoomGenerator(failingLabel: string): RoomAssetGenerator {
  return vi.fn(async (input: RoomAssetInput) => {
    if (input.roomLabel === failingLabel) throw new Error('canvas exploded');
    return generatedAsset(input.roomLabel === '205' ? room205 : room206);
  });
}

function renderAssetGenerator({
  rooms,
  generateRoom = vi.fn(async (input: RoomAssetInput) => generatedAsset(input.roomLabel === '205' ? room205 : room206)),
  generated,
  downloadBlob = vi.fn(),
  verifyQr = vi.fn(async () => 'https://example.com/r/4c5f9a10-1111-4222-8333-abcdefabcdef'),
  siteUrl = 'https://example.com',
}: {
  rooms: Room[];
  generateRoom?: RoomAssetGenerator;
  generated?: GeneratedRoomAsset[];
  downloadBlob?: (blob: Blob, filename: string) => void;
  verifyQr?: (dataUrl: string) => Promise<string>;
  siteUrl?: string | null;
}) {
  const objectUrls = { create: vi.fn(() => 'blob:preview'), revoke: vi.fn() };
  render(
    <AssetGenerator
      hotel={kamilovs}
      rooms={rooms}
      siteUrl={siteUrl}
      generateRoom={generateRoom}
      initialGenerated={generated}
      downloadBlob={downloadBlob}
      verifyQr={verifyQr}
      objectUrls={objectUrls}
    />,
  );
  return { objectUrls };
}

describe('AssetGenerator', () => {
  it('disables generation when no active rooms are selected', () => {
    renderAssetGenerator({ rooms: [] });

    expect(screen.getByRole('button', { name: 'Создать материалы' })).toBeDisabled();
    expect(screen.getByText('Выберите активные комнаты в списке выше')).toBeInTheDocument();
  });

  it('explains when the site origin is missing', () => {
    renderAssetGenerator({ rooms: [room205], siteUrl: null });

    expect(screen.getByRole('button', { name: 'Создать материалы' })).toBeDisabled();
    expect(screen.getByText('Гостевой адрес сайта не настроен (VITE_SITE_URL)')).toBeInTheDocument();
  });

  it('shows room-by-room progress', async () => {
    const user = userEvent.setup();
    const generateRoom = controlledRoomGenerator();
    renderAssetGenerator({ rooms: [room205, room206], generateRoom });

    await user.click(screen.getByRole('button', { name: 'Создать материалы' }));
    expect(screen.getByText('0 из 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создание…' })).toBeDisabled();

    generateRoom.resolveNext(asset205);
    expect(await screen.findByText('1 из 2')).toBeInTheDocument();
    generateRoom.resolveNext(asset206);
    expect(await screen.findByText('2 из 2')).toBeInTheDocument();

    expect(generateRoom).toHaveBeenNthCalledWith(1, {
      hotelSlug: 'kamilovs', hotelName: 'Kamilovs Hotel', roomLabel: '205', roomToken: room205.publicToken, siteUrl: 'https://example.com',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Материалы готовы: 2 комнат');
  });

  it('downloads an individual PNG and PDF', async () => {
    const user = userEvent.setup();
    const downloadBlob = vi.fn();
    renderAssetGenerator({ rooms: [room205], generated: [asset205], downloadBlob });

    await user.click(screen.getByRole('button', { name: 'Скачать PNG 205' }));
    await user.click(screen.getByRole('button', { name: 'Скачать PDF 205' }));

    expect(downloadBlob).toHaveBeenNthCalledWith(1, asset205.png, 'kamilovs-room-205.png');
    expect(downloadBlob).toHaveBeenNthCalledWith(2, expect.any(Blob), 'kamilovs-room-205.pdf');
  });

  it('downloads combined PDF and ZIP for selected rooms', async () => {
    const user = userEvent.setup();
    const downloadBlob = vi.fn();
    renderAssetGenerator({ rooms: [room205, room206], generated: [asset205, asset206], downloadBlob });

    await user.click(screen.getByRole('button', { name: 'Общий PDF' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'kamilovs-all-rooms-a5.pdf'));
    await user.click(screen.getByRole('button', { name: 'Скачать ZIP' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'kamilovs-room-assets.zip'));
  });

  it('reports the failing room and produces no partial combined download', async () => {
    const user = userEvent.setup();
    const downloadBlob = vi.fn();
    renderAssetGenerator({ rooms: [room205, room206], generateRoom: rejectingRoomGenerator('206'), downloadBlob });

    await user.click(screen.getByRole('button', { name: 'Создать материалы' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать материалы для комнаты 206');
    expect(screen.getByRole('button', { name: 'Общий PDF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Скачать ZIP' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Создать материалы' })).toBeEnabled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('disables combined downloads when the selection no longer matches the generated set', () => {
    renderAssetGenerator({ rooms: [room205, room206], generated: [asset205] });

    expect(screen.getByRole('button', { name: 'Общий PDF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Скачать PNG 205' })).toBeEnabled();
  });

  it('previews a room through a revocable object URL', async () => {
    const user = userEvent.setup();
    const { objectUrls } = renderAssetGenerator({ rooms: [room205, room206], generated: [asset205, asset206] });

    await user.click(screen.getByRole('button', { name: 'Предпросмотр 205' }));
    expect(screen.getByRole('img', { name: 'Плакет комнаты 205' })).toHaveAttribute('src', 'blob:preview');
    expect(objectUrls.create).toHaveBeenCalledWith(asset205.png);

    await user.click(screen.getByRole('button', { name: 'Предпросмотр 206' }));
    expect(objectUrls.revoke).toHaveBeenCalledWith('blob:preview');
    expect(screen.getByRole('img', { name: 'Плакет комнаты 206' })).toBeInTheDocument();
  });

  it('verifies a QR only on request and reports a mismatch', async () => {
    const user = userEvent.setup();
    const verifyQr = vi.fn()
      .mockResolvedValueOnce('https://example.com/r/4c5f9a10-1111-4222-8333-abcdefabcdef')
      .mockResolvedValueOnce('https://evil.example/r/other');
    renderAssetGenerator({ rooms: [room205, room206], generated: [asset205, asset206], verifyQr });

    expect(verifyQr).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Проверить QR 205' }));
    expect(await screen.findByRole('status')).toHaveTextContent('QR комнаты 205 совпадает с гостевой ссылкой');

    await user.click(screen.getByRole('button', { name: 'Проверить QR 206' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('QR комнаты 206 не совпадает с гостевой ссылкой');
  });

  it('keeps the preview URL alive across re-renders and revokes it only on unmount (production adapter)', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:live');
    const revokeObjectURL = vi.fn();
    // jsdom has no object URLs; install fakes on the global for the production adapter.
    const hadObjectUrls = 'createObjectURL' in URL;
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    try {
      const verifyQr = vi.fn(async () => asset205.url);
      const view = render(
        <AssetGenerator hotel={kamilovs} rooms={[room205]} siteUrl="https://example.com" initialGenerated={[asset205]} downloadBlob={vi.fn()} verifyQr={verifyQr} />,
      );

      await user.click(screen.getByRole('button', { name: 'Предпросмотр 205' }));
      // A state change unrelated to the preview must not revoke it.
      await user.click(screen.getByRole('button', { name: 'Проверить QR 205' }));
      await screen.findByRole('status');

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      expect(screen.getByRole('img', { name: 'Плакет комнаты 205' })).toHaveAttribute('src', 'blob:live');

      view.unmount();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:live');
    } finally {
      if (!hadObjectUrls) {
        Reflect.deleteProperty(URL, 'createObjectURL');
        Reflect.deleteProperty(URL, 'revokeObjectURL');
      }
    }
  });

  it('bounds one generation run and explains the limit', () => {
    const rooms = Array.from({ length: 51 }, (_, index) => ({ ...room205, id: `room-${index}`, label: `${100 + index}` }));
    renderAssetGenerator({ rooms });

    expect(screen.getByRole('button', { name: 'Создать материалы' })).toBeDisabled();
    expect(screen.getByText('За один раз можно создать материалы не больше чем для 50 комнат')).toBeInTheDocument();
  });

  it('names colliding file names when the ZIP cannot be built', async () => {
    const user = userEvent.setup();
    const clash = { ...asset206, baseName: 'kamilovs-room-205' };
    renderAssetGenerator({ rooms: [room205, room206], generated: [asset205, clash], downloadBlob: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Скачать ZIP' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Имена файлов совпадают: kamilovs-room-205. Переименуйте комнаты.');
  });

  it('keeps a live region mounted and locks per-room downloads while verifying', async () => {
    const user = userEvent.setup();
    let resolveVerify: ((url: string) => void) | undefined;
    const verifyQr = vi.fn(() => new Promise<string>((resolve) => { resolveVerify = resolve; }));
    renderAssetGenerator({ rooms: [room205], generated: [asset205], verifyQr });

    expect(document.querySelector('.admin-asset-generator [aria-live="polite"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Проверить QR 205' }));
    expect(screen.getByRole('button', { name: 'Скачать PNG 205' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Скачать PDF 205' })).toBeDisabled();

    resolveVerify?.(asset205.url);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скачать PNG 205' })).toBeEnabled());
  });

  it('resets generated assets and revokes the preview', async () => {
    const user = userEvent.setup();
    const { objectUrls } = renderAssetGenerator({ rooms: [room205], generated: [asset205] });

    await user.click(screen.getByRole('button', { name: 'Предпросмотр 205' }));
    await user.click(screen.getByRole('button', { name: 'Сбросить материалы' }));

    expect(objectUrls.revoke).toHaveBeenCalledWith('blob:preview');
    expect(screen.queryByRole('button', { name: 'Скачать PNG 205' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Общий PDF' })).toBeDisabled();
  });
});
