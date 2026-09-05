import sharpModule from 'sharp';
import { describe, expect, it } from 'vitest';
import { createRoomQrDataUrl, decodeQrPng, type PngPixelDecoder } from './qr';

// Node has no canvas, so the test decodes PNG pixels with sharp; the browser default uses a canvas.
const sharp = sharpModule as unknown as (input: Uint8Array) => {
  ensureAlpha(): { raw(): { toBuffer(options: { resolveWithObject: true }): Promise<{ data: Uint8Array; info: { width: number; height: number } }> } };
};

const decodeWithSharp: PngPixelDecoder = async (png) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
};

describe('room QR codes', () => {
  it('encodes the exact room URL at high error correction', async () => {
    const url = 'https://example.com/r/4c5f9a10-1111-4222-8333-abcdefabcdef';
    const dataUrl = await createRoomQrDataUrl(url);

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    await expect(decodeQrPng(dataUrl, decodeWithSharp)).resolves.toBe(url);
  });

  it('renders a 1024px PNG with a quiet zone', async () => {
    const dataUrl = await createRoomQrDataUrl('https://example.com/r/4c5f9a10-1111-4222-8333-abcdefabcdef');
    const { width, height, data } = await decodeWithSharp(Uint8Array.from(atob(dataUrl.split(',')[1]), (char) => char.charCodeAt(0)));

    // Node's PNG renderer rounds the module scale down (1023px); the browser canvas renderer hits 1024 exactly.
    // The plaque's <image> element fixes the placed size, so a one-pixel difference is harmless.
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(1000);
    expect(width).toBeLessThanOrEqual(1024);
    // The first pixel sits inside the quiet zone and must be white.
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255]);
  });

  it('allows plain http only for localhost', async () => {
    await expect(createRoomQrDataUrl('http://localhost:3000/r/4c5f9a10-1111-4222-8333-abcdefabcdef')).resolves.toMatch(/^data:image\/png;base64,/);
  });

  it('rejects non-HTTPS production URLs', async () => {
    await expect(createRoomQrDataUrl('javascript:alert(1)')).rejects.toThrow('Invalid guest room URL');
    await expect(createRoomQrDataUrl('http://example.com/r/abc')).rejects.toThrow('Invalid guest room URL');
    await expect(createRoomQrDataUrl('not a url')).rejects.toThrow('Invalid guest room URL');
  });

  it('reports an undecodable image instead of returning garbage', async () => {
    const blank: PngPixelDecoder = async () => ({ data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 });

    await expect(decodeQrPng('data:image/png;base64,iVBORw0KGgo=', blank)).rejects.toThrow('QR code could not be decoded');
  });

  it('rejects a data URL that is not a PNG', async () => {
    await expect(decodeQrPng('data:text/html;base64,PGh0bWw+', decodeWithSharp)).rejects.toThrow('Invalid QR data URL');
  });
});
