#!/usr/bin/env node
/**
 * Verifies a generated set of MehmonGo A5 room assets against its manifest.
 *
 *   node scripts/verify-room-assets.mjs outputs/a5-verification/manifest.json
 *
 * Manifest shape (paths relative to the manifest file):
 *   {
 *     "siteUrl": "https://example.com",
 *     "hotelSlug": "kamilovs",
 *     "hotelPdf": "kamilovs-all-rooms-a5.pdf",
 *     "zip": "kamilovs-room-assets.zip",
 *     "rooms": [{ "label": "205", "token": "<uuid>", "baseName": "kamilovs-room-205", "png": "kamilovs-room-205.png", "pdf": "kamilovs-room-205.pdf" }]
 *   }
 *
 * Exit codes: 0 ok · 1 usage/manifest · 2 PDF page count · 3 page size ·
 * 4 missing ZIP member · 5 duplicate filename · 6 undecodable QR · 7 decoded URL mismatch.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import jsQR from 'jsqr';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

export const EXIT = {
  ok: 0,
  manifest: 1,
  pageCount: 2,
  pageSize: 3,
  zipMember: 4,
  duplicate: 5,
  qrUndecodable: 6,
  qrMismatch: 7,
};

const A5_WIDTH_PT = 419.527559;
const A5_HEIGHT_PT = 595.275591;
const SIZE_TOLERANCE_PT = 0.01;
// QR slot inside the 1748x2480 plaque (see lib/assets/room-plaque.ts).
const QR_REGION = { left: 362, top: 1008, width: 1024, height: 1024 };

export class VerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new VerificationError(code, message);
}

async function loadManifest(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    fail(EXIT.manifest, `Cannot read manifest ${manifestPath}: ${error.message}`);
  }
  if (!manifest || typeof manifest.siteUrl !== 'string' || !Array.isArray(manifest.rooms) || manifest.rooms.length === 0
    || typeof manifest.hotelPdf !== 'string' || typeof manifest.zip !== 'string') {
    fail(EXIT.manifest, 'Manifest must contain siteUrl, hotelPdf, zip and a non-empty rooms array');
  }
  for (const room of manifest.rooms) {
    for (const key of ['label', 'token', 'baseName', 'png', 'pdf']) {
      if (typeof room[key] !== 'string' || !room[key]) fail(EXIT.manifest, `Room entry is missing "${key}"`);
    }
  }
  return manifest;
}

function assertA5Pages(document, what) {
  document.getPages().forEach((page, index) => {
    const { width, height } = page.getSize();
    if (Math.abs(width - A5_WIDTH_PT) > SIZE_TOLERANCE_PT || Math.abs(height - A5_HEIGHT_PT) > SIZE_TOLERANCE_PT) {
      fail(EXIT.pageSize, `${what}: page ${index + 1} is ${width.toFixed(3)}x${height.toFixed(3)} pt, expected A5 portrait ${A5_WIDTH_PT}x${A5_HEIGHT_PT} pt`);
    }
  });
}

async function verifyPdfs(dir, manifest) {
  const hotelPdf = await PDFDocument.load(await fs.readFile(path.join(dir, manifest.hotelPdf)));
  if (hotelPdf.getPageCount() !== manifest.rooms.length) {
    fail(EXIT.pageCount, `Hotel PDF has ${hotelPdf.getPageCount()} pages, expected ${manifest.rooms.length} (one per room: ${manifest.rooms.map((room) => room.label).join(', ')})`);
  }
  assertA5Pages(hotelPdf, 'Hotel PDF');

  for (const room of manifest.rooms) {
    const roomPdf = await PDFDocument.load(await fs.readFile(path.join(dir, room.pdf)));
    if (roomPdf.getPageCount() !== 1) fail(EXIT.pageCount, `Room ${room.label}: PDF has ${roomPdf.getPageCount()} pages, expected 1`);
    assertA5Pages(roomPdf, `Room ${room.label} PDF`);
  }
}

function assertUniqueFilenames(manifest) {
  const seen = new Set();
  for (const room of manifest.rooms) {
    for (const name of [room.baseName, room.png, room.pdf]) {
      const key = name.toLowerCase();
      if (seen.has(key)) fail(EXIT.duplicate, `Room ${room.label}: duplicate filename in manifest: ${name}`);
      seen.add(key);
    }
  }
}

async function verifyZip(dir, manifest) {
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(dir, manifest.zip)));
  const members = Object.keys(zip.files);
  const seen = new Set();
  for (const member of members) {
    const key = member.toLowerCase();
    if (seen.has(key)) fail(EXIT.duplicate, `Duplicate ZIP member: ${member}`);
    seen.add(key);
  }
  for (const room of manifest.rooms) {
    for (const expected of [`${room.baseName}.png`, `${room.baseName}.pdf`]) {
      if (!zip.file(expected)) fail(EXIT.zipMember, `Room ${room.label}: ZIP is missing ${expected} (members: ${members.join(', ') || 'none'})`);
    }
  }
  return members.length;
}

async function decodeQr(pngPath) {
  const image = sharp(pngPath);
  const { width, height } = await image.metadata();
  const region = width >= QR_REGION.left + QR_REGION.width && height >= QR_REGION.top + QR_REGION.height
    ? image.extract(QR_REGION)
    : image;
  const { data, info } = await region.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
}

async function verifyQrCodes(dir, manifest) {
  const origin = manifest.siteUrl.replace(/\/+$/, '');
  for (const room of manifest.rooms) {
    const expected = `${origin}/r/${room.token}`;
    let decoded;
    try {
      decoded = await decodeQr(path.join(dir, room.png));
    } catch (error) {
      fail(EXIT.qrUndecodable, `Room ${room.label}: cannot read ${room.png} (${error.message})`);
    }
    if (!decoded) fail(EXIT.qrUndecodable, `Room ${room.label}: no QR code could be decoded from ${room.png}`);
    if (decoded.data !== expected) fail(EXIT.qrMismatch, `Room ${room.label}: QR encodes ${decoded.data}, expected ${expected}`);
  }
}

/** Returns a summary on success; throws VerificationError with an exit code otherwise. */
export async function verifyRoomAssets(manifestPath) {
  const manifest = await loadManifest(manifestPath);
  const dir = path.dirname(path.resolve(manifestPath));
  assertUniqueFilenames(manifest);
  await verifyPdfs(dir, manifest);
  const zipMembers = await verifyZip(dir, manifest);
  await verifyQrCodes(dir, manifest);
  return { rooms: manifest.rooms.length, pages: manifest.rooms.length, zipMembers };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error('Usage: node scripts/verify-room-assets.mjs <manifest.json>');
    process.exit(EXIT.manifest);
  }
  try {
    const summary = await verifyRoomAssets(manifestPath);
    console.log(`OK: ${summary.rooms} rooms, ${summary.pages} A5 pages, ${summary.zipMembers} ZIP members, every QR matches /r/<token>`);
  } catch (error) {
    if (error instanceof VerificationError) {
      console.error(`FAIL (${error.code}): ${error.message}`);
      process.exit(error.code);
    }
    console.error(`FAIL (${EXIT.manifest}): ${error.message}`);
    process.exit(EXIT.manifest);
  }
}
