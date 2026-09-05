import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildHotelAssetZip, type RoomGeneratedAsset } from './zip';

function asset(baseName: string): RoomGeneratedAsset {
  return { baseName, png: new Blob([`png:${baseName}`], { type: 'image/png' }), pdf: new TextEncoder().encode(`pdf:${baseName}`) };
}

const room205 = asset('kamilovs-room-205');
const room206 = asset('kamilovs-room-206');

describe('buildHotelAssetZip', () => {
  it('contains one PNG and PDF per room', async () => {
    const blob = await buildHotelAssetZip([room206, room205]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(Object.keys(zip.files).sort()).toEqual([
      'kamilovs-room-205.pdf', 'kamilovs-room-205.png',
      'kamilovs-room-206.pdf', 'kamilovs-room-206.png',
    ]);
    expect(blob.type).toBe('application/zip');
    await expect(zip.file('kamilovs-room-205.png')!.async('string')).resolves.toBe('png:kamilovs-room-205');
    await expect(zip.file('kamilovs-room-206.pdf')!.async('string')).resolves.toBe('pdf:kamilovs-room-206');
  });

  it('stores members in basename order regardless of input order', async () => {
    const blob = await buildHotelAssetZip([room206, room205]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(Object.keys(zip.files)).toEqual([
      'kamilovs-room-205.png', 'kamilovs-room-205.pdf',
      'kamilovs-room-206.png', 'kamilovs-room-206.pdf',
    ]);
  });

  it('rejects duplicate basenames and empty input', async () => {
    await expect(buildHotelAssetZip([room205, asset('kamilovs-room-205')])).rejects.toThrow('kamilovs-room-205');
    await expect(buildHotelAssetZip([])).rejects.toThrow('No rooms selected');
  });
});
