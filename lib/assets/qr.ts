import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { PLAQUE_COLORS } from '@/lib/assets/room-plaque';

/** Pixel size of the QR PNG placed into the 1024px plaque slot. */
export const QR_PIXEL_SIZE = 1024;

export type QrPixels = { data: Uint8ClampedArray; width: number; height: number };
export type PngPixelDecoder = (png: Uint8Array) => Promise<QrPixels>;

const pngDataUrlPrefix = 'data:image/png;base64,';

function guestRoomUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid guest room URL');
  }
  const secure = parsed.protocol === 'https:';
  const local = parsed.protocol === 'http:' && parsed.hostname === 'localhost';
  if (!secure && !local) throw new Error('Invalid guest room URL');
  return parsed;
}

/**
 * High error-correction QR in MehmonGo navy with a four-module quiet zone,
 * encoding exactly the given guest room URL. Only https (or localhost for
 * local smoke tests) is ever encoded into a printed plaque.
 */
export async function createRoomQrDataUrl(url: string): Promise<string> {
  const parsed = guestRoomUrl(url);
  return QRCode.toDataURL(parsed.toString(), {
    errorCorrectionLevel: 'H',
    width: QR_PIXEL_SIZE,
    margin: 4,
    color: { dark: PLAQUE_COLORS.navy, light: '#FFFFFF' },
  });
}

export function pngBytesFromDataUrl(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith(pngDataUrlPrefix)) throw new Error('Invalid QR data URL');
  const base64 = dataUrl.slice(pngDataUrlPrefix.length);
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    throw new Error('Invalid QR data URL');
  }
}

/** Browser default: draw the PNG on a canvas and read back RGBA pixels. */
async function decodeWithCanvas(png: Uint8Array): Promise<QrPixels> {
  const blob = new Blob([png as BlobPart], { type: 'image/png' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('QR image failed to load'));
      element.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    return { data, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Decodes a QR PNG data URL back to its text, for explicit verification only.
 * The pixel decoder is injectable so Node tests can use sharp instead of a canvas.
 */
export async function decodeQrPng(dataUrl: string, decodePixels: PngPixelDecoder = decodeWithCanvas): Promise<string> {
  const { data, width, height } = await decodePixels(pngBytesFromDataUrl(dataUrl));
  const result = jsQR(data, width, height);
  if (!result) throw new Error('QR code could not be decoded');
  return result.data;
}
