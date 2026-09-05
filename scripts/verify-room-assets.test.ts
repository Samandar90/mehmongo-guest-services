// @vitest-environment node
// The verifier is a Node script: pdf-lib and JSZip type-check typed arrays with
// instanceof, which fails against jsdom's realm.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXIT, VerificationError, verifyRoomAssets } from './verify-room-assets.mjs';

const SITE_URL = 'https://example.com';
const A5 = [419.527559, 595.275591] as const;

type RoomSpec = { label: string; token: string; baseName?: string; qrUrl?: string | null };

let dir: string;
let counter = 0;

async function pdfWithPages(sizes: Array<readonly [number, number]>): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const [width, height] of sizes) document.addPage([width, height]);
  return document.save();
}

async function qrPng(url: string | null): Promise<Uint8Array> {
  if (url === null) {
    // Blank white square: readable PNG, but no QR inside.
    const size = 64;
    const document = await PDFDocument.create();
    void document;
    const { default: sharp } = await import('sharp');
    const render = sharp as unknown as (options: object) => { png(): { toBuffer(): Promise<Uint8Array> } };
    return render({ create: { width: size, height: size, channels: 3, background: '#ffffff' } }).png().toBuffer();
  }
  return QRCode.toBuffer(url, { errorCorrectionLevel: 'H', width: 512, margin: 4 });
}

/** Writes a manifest plus files; `overrides` mutate the manifest after the files exist. */
async function fixture(rooms: RoomSpec[], options: {
  hotelPages?: Array<readonly [number, number]>;
  zipMembers?: string[] | null;
  mutate?: (manifest: Record<string, unknown>) => void;
} = {}): Promise<string> {
  const base = path.join(dir, `case-${counter++}`);
  await (await import('node:fs/promises')).mkdir(base, { recursive: true });

  const entries = [];
  for (const room of rooms) {
    const baseName = room.baseName ?? `kamilovs-room-${room.label}`;
    const url = room.qrUrl === undefined ? `${SITE_URL}/r/${room.token}` : room.qrUrl;
    await writeFile(path.join(base, `${baseName}.png`), await qrPng(url));
    await writeFile(path.join(base, `${baseName}.pdf`), await pdfWithPages([A5]));
    entries.push({ label: room.label, token: room.token, baseName, png: `${baseName}.png`, pdf: `${baseName}.pdf` });
  }

  await writeFile(path.join(base, 'hotel.pdf'), await pdfWithPages(options.hotelPages ?? rooms.map(() => A5)));

  const zip = new JSZip();
  const members = options.zipMembers ?? entries.flatMap((entry) => [entry.png, entry.pdf]);
  for (const member of members) zip.file(member, `content of ${member}`);
  await writeFile(path.join(base, 'assets.zip'), await zip.generateAsync({ type: 'uint8array' }));

  const manifest: Record<string, unknown> = { siteUrl: SITE_URL, hotelSlug: 'kamilovs', hotelPdf: 'hotel.pdf', zip: 'assets.zip', rooms: entries };
  options.mutate?.(manifest);
  const manifestPath = path.join(base, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

async function exitCodeOf(manifestPath: string): Promise<number> {
  try {
    await verifyRoomAssets(manifestPath);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof VerificationError) return error.code;
    throw error;
  }
}

const room205: RoomSpec = { label: '205', token: '4c5f9a10-1111-4222-8333-abcdefabcdef' };
const room206: RoomSpec = { label: '206', token: '5d6e7f80-2222-4333-8444-fedcbafedcba' };

describe('verify-room-assets', () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mehmongo-a5-'));
  });

  it('accepts a consistent set of assets', async () => {
    await expect(verifyRoomAssets(await fixture([room205, room206]))).resolves.toEqual({ rooms: 2, pages: 2, zipMembers: 4 });
  });

  it('fails with a distinct code for each defect', async () => {
    await expect(exitCodeOf(await fixture([room205, room206], { hotelPages: [A5] }))).resolves.toBe(EXIT.pageCount);
    await expect(exitCodeOf(await fixture([room205], { hotelPages: [[400, 600]] }))).resolves.toBe(EXIT.pageSize);
    await expect(exitCodeOf(await fixture([room205, room206], { zipMembers: ['kamilovs-room-205.png', 'kamilovs-room-205.pdf', 'kamilovs-room-206.png'] })))
      .resolves.toBe(EXIT.zipMember);
    await expect(exitCodeOf(await fixture([room205, { ...room206, baseName: 'kamilovs-room-205' }]))).resolves.toBe(EXIT.duplicate);
    await expect(exitCodeOf(await fixture([room205, { ...room206, qrUrl: null }]))).resolves.toBe(EXIT.qrUndecodable);
    await expect(exitCodeOf(await fixture([room205, { ...room206, qrUrl: `${SITE_URL}/r/other-token` }]))).resolves.toBe(EXIT.qrMismatch);
  });

  it('names the failing room in the error', async () => {
    await expect(verifyRoomAssets(await fixture([room205, { ...room206, qrUrl: `${SITE_URL}/r/other-token` }])))
      .rejects.toThrow(/Room 206/);
  });

  it('rejects a broken manifest', async () => {
    await expect(exitCodeOf(await fixture([room205], { mutate: (manifest) => { delete manifest.zip; } }))).resolves.toBe(EXIT.manifest);
    await expect(exitCodeOf(path.join(dir, 'missing.json'))).resolves.toBe(EXIT.manifest);
  });
});
