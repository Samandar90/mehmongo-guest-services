#!/usr/bin/env node
/**
 * Renders the icons the installed admin app needs, from the brand mark.
 *
 *   node scripts/build-app-icons.mjs
 *
 * Two shapes, because the platforms crop differently:
 *
 * - "any": the tile as the brand book draws it, navy with rounded corners and
 *   a margin. Shown as-is by desktop Chrome and in the manifest listing.
 * - "maskable": the same mark on navy filling the whole square. Android puts
 *   every icon behind its own mask — a circle, a squircle, a rounded square —
 *   and a rounded tile inside that mask gets its corners cut twice. The mark
 *   stays inside the 80% safe circle the specification requires.
 *
 * iOS rounds the home-screen icon itself, so apple-touch-icon is the
 * full-bleed square too.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import sharpModule from 'sharp';
import { projectDir } from './lib/print-assets.mjs';

const sharp = /** @type {(input: Buffer | Uint8Array) => any} */ (sharpModule);
const publicDir = path.join(projectDir, 'public');

const NAVY = '#102B4E';

/** The mark itself, positioned as in MehmonGo-логотип/icon.svg. */
const mark = `
  <g transform="translate(46 123) scale(1.4)">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M130 40 L55 95 L130 150 L185 95" stroke="#FFFFFF" stroke-width="26"/>
      <path d="M170 40 L245 95 L170 150 L115 95" stroke="#FFFFFF" stroke-width="26"/>
      <path d="M170 40 L200 62" stroke="#D3226A" stroke-width="26"/>
      <path d="M115 95 L143 75" stroke="#D3226A" stroke-width="26"/>
    </g>
  </g>`;

const roundedTile = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect x="24" y="24" width="464" height="464" rx="112" fill="${NAVY}"/>
  ${mark}
</svg>`;

const fullBleedTile = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${NAVY}"/>
  ${mark}
</svg>`;

const icons = [
  { file: 'app-icon-192.png', svg: roundedTile, size: 192 },
  { file: 'app-icon-512.png', svg: roundedTile, size: 512 },
  { file: 'app-icon-maskable-192.png', svg: fullBleedTile, size: 192 },
  { file: 'app-icon-maskable-512.png', svg: fullBleedTile, size: 512 },
  { file: 'apple-touch-icon.png', svg: fullBleedTile, size: 180 },
];

for (const icon of icons) {
  const png = await sharp(Buffer.from(icon.svg))
    .resize(icon.size, icon.size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(path.join(publicDir, icon.file), png);
  console.log(`${icon.file} — ${icon.size}×${icon.size}`);
}
