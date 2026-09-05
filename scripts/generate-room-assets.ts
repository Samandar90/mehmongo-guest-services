/**
 * Generates a verifiable set of A5 room assets outside the browser, for the
 * automated verification gate (scripts/verify-room-assets.mjs). It reuses the
 * exact template, QR, PDF and ZIP modules the super admin uses; only the
 * SVG-to-PNG step differs (sharp here, canvas in the browser).
 *
 *   npm run assets:generate -- <site-url> <hotel-slug> "<hotel-name>" <label>:<token> [<label>:<token> ...]
 *
 * Output goes to outputs/a5-verification/ (git-ignored).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharpModule from 'sharp';
import { buildHotelPdf, buildRoomPdf } from '../lib/assets/pdf';
import { createRoomQrDataUrl } from '../lib/assets/qr';
import { buildGuestRoomUrl, buildRoomPlaqueSvg, roomAssetBaseName, type RoomAssetInput } from '../lib/assets/room-plaque';
import { buildHotelAssetZip, type RoomGeneratedAsset } from '../lib/assets/zip';

// See scripts/build-room-plaque.ts for why sharp is typed locally.
const sharp = sharpModule as unknown as (input: Uint8Array) => { png(): { toBuffer(): Promise<Uint8Array> } };

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(path.dirname(scriptDir), 'outputs', 'a5-verification');
const [siteUrlArgument, hotelSlug, hotelName, ...roomArguments] = process.argv.slice(2);

if (!siteUrlArgument || !hotelSlug || !hotelName || roomArguments.length === 0) {
  throw new Error('Usage: npm run assets:generate -- <site-url> <hotel-slug> "<hotel-name>" <label>:<token> [...]');
}

const siteUrl = new URL(siteUrlArgument).origin;
const rooms = roomArguments.map((argument) => {
  const separator = argument.lastIndexOf(':');
  if (separator <= 0) throw new Error(`Room argument must be <label>:<token>, received "${argument}"`);
  return { label: argument.slice(0, separator), token: argument.slice(separator + 1) };
});

await fs.mkdir(outputDir, { recursive: true });

const generated: Array<RoomGeneratedAsset & { label: string; token: string; pngBytes: Uint8Array }> = [];
for (const room of rooms) {
  const input: RoomAssetInput = { hotelSlug, hotelName, roomLabel: room.label, roomToken: room.token, siteUrl };
  const url = buildGuestRoomUrl(input);
  const qrDataUrl = await createRoomQrDataUrl(url);
  const svg = buildRoomPlaqueSvg(input, qrDataUrl);
  const pngBytes = await sharp(new TextEncoder().encode(svg)).png().toBuffer();
  const pdf = await buildRoomPdf(pngBytes, room.label);
  const baseName = roomAssetBaseName(input);
  await fs.writeFile(path.join(outputDir, `${baseName}.png`), pngBytes);
  await fs.writeFile(path.join(outputDir, `${baseName}.pdf`), pdf);
  generated.push({ baseName, png: new Blob([pngBytes as BlobPart], { type: 'image/png' }), pdf, label: room.label, token: room.token, pngBytes });
  console.log(`room ${room.label}: ${baseName}.png / .pdf (${url})`);
}

const hotelPdf = await buildHotelPdf(generated.map((asset) => ({ label: asset.label, png: asset.pngBytes })));
await fs.writeFile(path.join(outputDir, `${hotelSlug}-all-rooms-a5.pdf`), hotelPdf);

const zip = await buildHotelAssetZip(generated);
await fs.writeFile(path.join(outputDir, `${hotelSlug}-room-assets.zip`), new Uint8Array(await zip.arrayBuffer()));

const manifest = {
  siteUrl,
  hotelSlug,
  hotelName,
  generatedAt: new Date().toISOString(),
  hotelPdf: `${hotelSlug}-all-rooms-a5.pdf`,
  zip: `${hotelSlug}-room-assets.zip`,
  rooms: generated.map((asset) => ({
    label: asset.label,
    token: asset.token,
    baseName: asset.baseName,
    png: `${asset.baseName}.png`,
    pdf: `${asset.baseName}.pdf`,
  })),
};
await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`manifest: ${path.join(outputDir, 'manifest.json')}`);
