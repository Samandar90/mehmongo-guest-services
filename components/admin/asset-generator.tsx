'use client';

import { useEffect, useRef, useState } from 'react';
import type { Hotel } from '@/lib/admin/hotels';
import type { Room } from '@/lib/admin/rooms';
import { downloadBlob as downloadBlobDefault } from '@/lib/assets/download';
import { buildHotelPdf as buildHotelPdfDefault, buildRoomPdf } from '@/lib/assets/pdf';
import { createRoomQrDataUrl, decodeQrPng } from '@/lib/assets/qr';
import { svgToPngBlob } from '@/lib/assets/rasterize';
import { buildGuestRoomUrl, buildRoomPlaqueSvg, roomAssetBaseName, type RoomAssetInput } from '@/lib/assets/room-plaque';
import { buildHotelAssetZip as buildHotelAssetZipDefault, type RoomGeneratedAsset } from '@/lib/assets/zip';

export type GeneratedRoomAsset = RoomGeneratedAsset & {
  roomId: string;
  label: string;
  url: string;
  qrDataUrl: string;
};

export type RoomAssetGenerator = (input: RoomAssetInput) => Promise<GeneratedRoomAsset>;

/** Default browser pipeline: URL → QR → SVG → PNG → single-page PDF. */
export function createRoomAssetGenerator(roomId: string): RoomAssetGenerator {
  return async (input) => {
    const url = buildGuestRoomUrl(input);
    const qrDataUrl = await createRoomQrDataUrl(url);
    const svg = buildRoomPlaqueSvg(input, qrDataUrl);
    const png = await svgToPngBlob(svg);
    const pdf = await buildRoomPdf(new Uint8Array(await png.arrayBuffer()), input.roomLabel);
    return { roomId, label: input.roomLabel, baseName: roomAssetBaseName(input), url, qrDataUrl, png, pdf };
  };
}

type ObjectUrls = { create: (blob: Blob) => string; revoke: (url: string) => void };

type AssetGeneratorProps = {
  hotel: Hotel;
  /** Selected active rooms, as owned by the room editor. */
  rooms: Room[];
  siteUrl: string | null;
  generateRoom?: RoomAssetGenerator;
  initialGenerated?: GeneratedRoomAsset[];
  downloadBlob?: (blob: Blob, filename: string) => void;
  buildHotelPdf?: typeof buildHotelPdfDefault;
  buildHotelAssetZip?: typeof buildHotelAssetZipDefault;
  verifyQr?: (dataUrl: string) => Promise<string>;
  objectUrls?: ObjectUrls;
};

type Progress = { done: number; total: number } | null;

const messages = {
  noRooms: 'Выберите активные комнаты в списке выше',
  noSiteUrl: 'Гостевой адрес сайта не настроен (VITE_SITE_URL)',
  combinedFailed: 'Не удалось собрать общий файл. Повторите попытку.',
  downloadFailed: 'Не удалось начать скачивание. Повторите попытку.',
};

function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

export function AssetGenerator({
  hotel,
  rooms,
  siteUrl,
  generateRoom,
  initialGenerated = [],
  downloadBlob = downloadBlobDefault,
  buildHotelPdf = buildHotelPdfDefault,
  buildHotelAssetZip = buildHotelAssetZipDefault,
  verifyQr = (dataUrl) => decodeQrPng(dataUrl),
  objectUrls = { create: (blob) => URL.createObjectURL(blob), revoke: (url) => URL.revokeObjectURL(url) },
}: AssetGeneratorProps) {
  const [generated, setGenerated] = useState<GeneratedRoomAsset[]>(initialGenerated);
  const [progress, setProgress] = useState<Progress>(null);
  const [generating, setGenerating] = useState(false);
  const [failedLabel, setFailedLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ roomId: string; label: string; url: string } | null>(null);
  const previewUrl = useRef<string | null>(null);

  const setPreviewUrl = (next: { roomId: string; label: string; url: string } | null) => {
    if (previewUrl.current) objectUrls.revoke(previewUrl.current);
    previewUrl.current = next?.url ?? null;
    setPreview(next);
  };

  // Revoke the last preview URL on unmount only.
  useEffect(() => () => { if (previewUrl.current) objectUrls.revoke(previewUrl.current); }, [objectUrls]);

  const generatedById = new Map(generated.map((asset) => [asset.roomId, asset]));
  const selectionReady = rooms.length > 0 && rooms.every((room) => generatedById.has(room.id));
  const combinedReady = selectionReady && failedLabel === null && !generating;
  const canGenerate = rooms.length > 0 && Boolean(siteUrl) && !generating;

  const generateAll = async () => {
    if (!siteUrl) return;
    setError(null);
    setNotice(null);
    setFailedLabel(null);
    setPreviewUrl(null);
    setGenerated([]);
    setGenerating(true);
    setProgress({ done: 0, total: rooms.length });

    const results: GeneratedRoomAsset[] = [];
    for (const [index, room] of rooms.entries()) {
      const input: RoomAssetInput = {
        hotelSlug: hotel.slug,
        hotelName: hotel.name,
        roomLabel: room.label,
        roomToken: room.publicToken,
        siteUrl,
      };
      try {
        const generate = generateRoom ?? createRoomAssetGenerator(room.id);
        const asset = await generate(input);
        results.push({ ...asset, roomId: room.id, label: room.label });
        setGenerated([...results]);
        setProgress({ done: index + 1, total: rooms.length });
      } catch {
        setFailedLabel(room.label);
        setError(`Не удалось создать материалы для комнаты ${room.label}. Проверьте выбор и попробуйте снова.`);
        setGenerating(false);
        return;
      }
    }
    setGenerating(false);
    setNotice(`Материалы готовы: ${results.length} комнат`);
  };

  const download = (blob: Blob, filename: string) => {
    setError(null);
    try {
      downloadBlob(blob, filename);
    } catch {
      setError(messages.downloadFailed);
    }
  };

  const downloadCombinedPdf = async () => {
    setBusy('pdf');
    setError(null);
    try {
      const pages = [];
      for (const room of rooms) {
        const asset = generatedById.get(room.id);
        if (!asset) throw new Error('Selection changed');
        pages.push({ label: asset.label, png: new Uint8Array(await asset.png.arrayBuffer()) });
      }
      download(pdfBlob(await buildHotelPdf(pages)), `${hotel.slug}-all-rooms-a5.pdf`);
    } catch {
      setError(messages.combinedFailed);
    } finally {
      setBusy(null);
    }
  };

  const downloadZip = async () => {
    setBusy('zip');
    setError(null);
    try {
      const assets = rooms.map((room) => generatedById.get(room.id)).filter((asset): asset is GeneratedRoomAsset => Boolean(asset));
      download(await buildHotelAssetZip(assets), `${hotel.slug}-room-assets.zip`);
    } catch {
      setError(messages.combinedFailed);
    } finally {
      setBusy(null);
    }
  };

  const verify = async (asset: GeneratedRoomAsset) => {
    setBusy(`qr-${asset.roomId}`);
    setError(null);
    setNotice(null);
    try {
      const decoded = await verifyQr(asset.qrDataUrl);
      if (decoded === asset.url) {
        setNotice(`QR комнаты ${asset.label} совпадает с гостевой ссылкой`);
      } else {
        setError(`QR комнаты ${asset.label} не совпадает с гостевой ссылкой. Пересоздайте материалы.`);
      }
    } catch {
      setError(`QR комнаты ${asset.label} не удалось прочитать. Пересоздайте материалы.`);
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setPreviewUrl(null);
    setGenerated([]);
    setProgress(null);
    setFailedLabel(null);
    setNotice(null);
    setError(null);
  };

  const hint = rooms.length === 0 ? messages.noRooms : !siteUrl ? messages.noSiteUrl : null;

  return (
    <div className="admin-asset-generator">
      <div className="admin-asset-toolbar">
        <p className="admin-asset-count">Выбрано комнат: {rooms.length}</p>
        {hint ? <p className="admin-hint">{hint}</p> : null}
        <div className="admin-actions">
          <button type="button" className="admin-button" disabled={!canGenerate} onClick={() => { void generateAll(); }}>
            {generating ? 'Создание…' : 'Создать материалы'}
          </button>
          <button type="button" className="admin-button admin-button-secondary" disabled={!combinedReady || busy !== null} onClick={() => { void downloadCombinedPdf(); }}>
            {busy === 'pdf' ? 'Сборка PDF…' : 'Общий PDF'}
          </button>
          <button type="button" className="admin-button admin-button-secondary" disabled={!combinedReady || busy !== null} onClick={() => { void downloadZip(); }}>
            {busy === 'zip' ? 'Сборка ZIP…' : 'Скачать ZIP'}
          </button>
          {generated.length > 0 ? (
            <button type="button" className="admin-button admin-button-secondary" disabled={generating} onClick={reset}>
              Сбросить материалы
            </button>
          ) : null}
        </div>
      </div>

      {progress ? (
        <p className="admin-asset-progress" aria-live="polite">
          <progress value={progress.done} max={progress.total} aria-label="Готовность материалов" />
          <span>{progress.done} из {progress.total}</span>
        </p>
      ) : null}
      {error ? <p role="alert" className="admin-form-error">{error}</p> : null}
      {notice ? <output className="admin-form-success">{notice}</output> : null}

      {generated.length > 0 ? (
        <ul className="admin-asset-list">
          {generated.map((asset) => (
            <li key={asset.roomId} className="admin-asset-row">
              <strong>Комната {asset.label}</strong>
              <span className="admin-actions">
                <button type="button" className="admin-button admin-button-secondary" aria-label={`Предпросмотр ${asset.label}`}
                  onClick={() => setPreviewUrl({ roomId: asset.roomId, label: asset.label, url: objectUrls.create(asset.png) })}>
                  Предпросмотр
                </button>
                <button type="button" className="admin-button admin-button-secondary" aria-label={`Скачать PNG ${asset.label}`}
                  onClick={() => download(asset.png, `${asset.baseName}.png`)}>
                  Скачать PNG
                </button>
                <button type="button" className="admin-button admin-button-secondary" aria-label={`Скачать PDF ${asset.label}`}
                  onClick={() => download(pdfBlob(asset.pdf), `${asset.baseName}.pdf`)}>
                  Скачать PDF
                </button>
                <button type="button" className="admin-button admin-button-secondary" aria-label={`Проверить QR ${asset.label}`}
                  disabled={busy !== null} onClick={() => { void verify(asset); }}>
                  {busy === `qr-${asset.roomId}` ? 'Проверка…' : 'Проверить QR'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {preview ? (
        <figure className="admin-asset-preview">
          {/* oxlint-disable-next-line nextjs/no-img-element -- in-memory blob URL, never served by the image optimizer */}
          <img src={preview.url} alt={`Плакет комнаты ${preview.label}`} />
          <figcaption>Комната {preview.label} · A5, 300 DPI</figcaption>
        </figure>
      ) : null}
    </div>
  );
}
