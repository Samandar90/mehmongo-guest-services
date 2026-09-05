/**
 * Regenerates the room-205 reference plaque in artifacts/ from the shared A5
 * template. Usage: npm run plaque -- <site-url> [room-token]
 *
 * The token defaults to a sample value: this script has no database access,
 * and the artifact is a visual reference, not a printable hotel asset.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharpModule from 'sharp';
import jsQR from 'jsqr';
import { createRoomQrDataUrl, pngBytesFromDataUrl } from '../lib/assets/qr';
import { buildGuestRoomUrl, buildRoomPlaqueSvg, type RoomAssetInput } from '../lib/assets/room-plaque';

// The root tsconfig mixes DOM, Cloudflare Workers and Node globals; under it
// sharp's default export resolves to `unknown` (its ESM types do not line up with
// moduleResolution "bundler"). This script only needs a tiny slice of sharp, so
// it is typed explicitly here instead of weakening the app config.
type SharpPipeline = {
  ensureAlpha(): SharpPipeline;
  raw(): SharpPipeline;
  png(): SharpPipeline;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Uint8Array; info: { width: number; height: number } }>;
  toFile(path: string): Promise<unknown>;
};
const sharp = sharpModule as unknown as (input: Uint8Array) => SharpPipeline;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(scriptDir);
const artifactsDir = path.join(projectDir, 'artifacts');
const [siteUrlArgument, tokenArgument] = process.argv.slice(2);

if (!siteUrlArgument) {
  throw new Error('Pass the deployed site URL, for example: npm run plaque -- https://example.com');
}

const SAMPLE_ROOM_TOKEN = '4c5f9a10-1111-4222-8333-abcdefabcdef';

let siteUrl: string;
try {
  siteUrl = new URL(siteUrlArgument).origin;
} catch {
  throw new Error(`The site URL must be absolute, received "${siteUrlArgument}"`);
}

const input: RoomAssetInput = {
  hotelSlug: 'kamilovs',
  hotelName: 'Kamilovs Hotel',
  roomLabel: '205',
  roomToken: tokenArgument ?? SAMPLE_ROOM_TOKEN,
  siteUrl,
};
const targetUrl = buildGuestRoomUrl(input);

await fs.mkdir(artifactsDir, { recursive: true });

// Same QR module as the admin, so the reference cannot drift from production output.
const qrDataUrl = await createRoomQrDataUrl(targetUrl);
const qrBuffer = pngBytesFromDataUrl(qrDataUrl);
await fs.writeFile(path.join(artifactsDir, 'mehmongo-room-205-qr.png'), qrBuffer);

const { data, info } = await sharp(qrBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
if (!decoded || decoded.data !== targetUrl) {
  throw new Error(`QR verification failed. Expected ${targetUrl}, received ${decoded?.data ?? 'nothing'}`);
}

const plaqueSvg = buildRoomPlaqueSvg(input, qrDataUrl);
const svgPath = path.join(artifactsDir, 'mehmongo-room-205-plaque.svg');
const pngPath = path.join(artifactsDir, 'mehmongo-room-205-plaque.png');
await fs.writeFile(svgPath, plaqueSvg, 'utf8');
await sharp(new TextEncoder().encode(plaqueSvg)).png().toFile(pngPath);

console.log(`QR verified: ${targetUrl}${tokenArgument ? '' : ' (sample token)'}`);
console.log(`Plaque: ${pngPath}`);
