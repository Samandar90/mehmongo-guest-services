import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import sharp from 'sharp';
import jsQR from 'jsqr';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(scriptDir);
const artifactsDir = path.join(projectDir, 'artifacts');
const baseUrl = process.argv[2];

if (!baseUrl) {
  throw new Error('Pass the deployed site URL, for example: npm run plaque -- https://example.com');
}

const guestUrl = new URL(baseUrl);
guestUrl.searchParams.set('hotel', 'kamilovs');
guestUrl.searchParams.set('room', '205');
const targetUrl = guestUrl.toString();

await fs.mkdir(artifactsDir, { recursive: true });

const qrBuffer = await QRCode.toBuffer(targetUrl, {
  errorCorrectionLevel: 'H',
  margin: 4,
  width: 900,
  color: { dark: '#102B4EFF', light: '#FFFFFFFF' },
});

const qrPath = path.join(artifactsDir, 'mehmongo-room-205-qr.png');
const checkPath = path.join(artifactsDir, 'mehmongo-room-205-qr-check.png');
await fs.writeFile(qrPath, qrBuffer);
await fs.writeFile(checkPath, qrBuffer);

const { data, info } = await sharp(qrBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
if (!decoded || decoded.data !== targetUrl) {
  throw new Error(`QR verification failed. Expected ${targetUrl}, received ${decoded?.data ?? 'nothing'}`);
}

const markSvg = await fs.readFile(path.join(projectDir, 'public', 'mehmongo-mark.svg'));
const markData = `data:image/svg+xml;base64,${markSvg.toString('base64')}`;
const qrData = `data:image/png;base64,${qrBuffer.toString('base64')}`;

const plaqueSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1748" height="2480" viewBox="0 0 1748 2480">
  <rect width="1748" height="2480" fill="#F7F3EC"/>
  <circle cx="1660" cy="-10" r="340" fill="none" stroke="#D3226A" stroke-opacity=".08" stroke-width="104"/>
  <circle cx="-65" cy="2350" r="260" fill="none" stroke="#102B4E" stroke-opacity=".06" stroke-width="86"/>

  <g transform="translate(128 118)">
    <image href="${markData}" x="0" y="0" width="208" height="132"/>
    <text x="240" y="91" font-family="Arial, Helvetica, sans-serif" font-size="86" font-weight="700" letter-spacing="-4" fill="#102B4E">Mehmon<tspan fill="#D3226A">Go</tspan></text>
  </g>

  <rect x="1274" y="130" width="348" height="98" rx="49" fill="#FFFFFF" stroke="#E2D9CD" stroke-width="3"/>
  <text x="1448" y="194" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#102B4E">ROOM 205</text>

  <text x="128" y="445" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="700" letter-spacing="7" fill="#D3226A">GUEST SERVICES</text>
  <text x="128" y="575" font-family="Arial, Helvetica, sans-serif" font-size="108" font-weight="750" letter-spacing="-5" fill="#102B4E">
    <tspan x="128" dy="0">Everything you need</tspan>
    <tspan x="128" dy="116">during your stay —</tspan>
    <tspan x="128" dy="116" fill="#D3226A">one scan away.</tspan>
  </text>

  <rect x="262" y="908" width="1224" height="1224" rx="96" fill="#FFFFFF"/>
  <image href="${qrData}" x="362" y="1008" width="1024" height="1024"/>

  <g font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#102B4E" text-anchor="middle">
    <text x="219" y="2245"><tspan fill="#D3226A">●</tspan><tspan dx="12">TOURS</tspan></text>
    <text x="656" y="2245"><tspan fill="#D3226A">●</tspan><tspan dx="12">TRANSPORT</tspan></text>
    <text x="1092" y="2245"><tspan fill="#D3226A">●</tspan><tspan dx="12">RESTAURANTS</tspan></text>
    <text x="1529" y="2245"><tspan fill="#D3226A">●</tspan><tspan dx="12">TICKETS</tspan></text>
  </g>
  <text x="874" y="2345" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="36" fill="#667286">Scan to request a service. No registration required.</text>
  <text x="874" y="2408" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="#8993A0">Kamilovs Hotel · MehmonGo local concierge</text>
</svg>`;

const svgPath = path.join(artifactsDir, 'mehmongo-room-205-plaque.svg');
const pngPath = path.join(artifactsDir, 'mehmongo-room-205-plaque.png');
await fs.writeFile(svgPath, plaqueSvg, 'utf8');
await sharp(Buffer.from(plaqueSvg)).png().toFile(pngPath);

console.log(`QR verified: ${targetUrl}`);
console.log(`Plaque: ${pngPath}`);
