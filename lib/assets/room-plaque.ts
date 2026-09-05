import { buildGuestRoomUrl as buildGuestRoomUrlFromOrigin } from '@/lib/site-url';

/** Everything the A5 template needs for one room. `siteUrl` is the validated public origin. */
export type RoomAssetInput = {
  hotelSlug: string;
  hotelName: string;
  roomLabel: string;
  roomToken: string;
  siteUrl: string;
};

/** 148 × 210 mm at 300 DPI. */
export const A5_PIXEL_WIDTH = 1748;
export const A5_PIXEL_HEIGHT = 2480;

/** Approved MehmonGo colors. */
export const PLAQUE_COLORS = { navy: '#102B4E', magenta: '#D3226A', warm: '#F7F3EC' } as const;

/**
 * The approved mark, byte-for-byte the content of public/mehmongo-mark.svg.
 * Inlined so the browser template and the Node script share one source;
 * room-plaque.test.ts fails if the two files ever drift apart.
 */
export const MEHMONGO_MARK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="190" viewBox="0 0 300 190">


  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M130 40 L55 95 L130 150 L185 95" stroke="#102B4E" stroke-width="26"/>
    <path d="M170 40 L245 95 L170 150 L115 95" stroke="#102B4E" stroke-width="26"/>
    <path d="M170 40 L200 62" stroke="#D3226A" stroke-width="26"/>
    <path d="M115 95 L143 75" stroke="#D3226A" stroke-width="26"/>
  </g>
</svg>
`;

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const MEHMONGO_MARK_DATA_URL = `data:image/svg+xml;base64,${toBase64(MEHMONGO_MARK_SVG)}`;

const xmlEscapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => xmlEscapes[char]);
}

export function buildGuestRoomUrl(input: Pick<RoomAssetInput, 'siteUrl' | 'roomToken'>): string {
  return buildGuestRoomUrlFromOrigin(input.siteUrl, input.roomToken);
}

/** Lowercase ASCII slug of the room label; falls back to the token prefix when nothing survives. */
export function roomAssetBaseName(input: Pick<RoomAssetInput, 'hotelSlug' | 'roomLabel' | 'roomToken'>): string {
  const label = input.roomLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${input.hotelSlug}-room-${label || input.roomToken.slice(0, 8)}`;
}

const pngDataUrlPattern = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

/**
 * Builds the approved 1748×2480 A5 plaque. Text is XML-escaped; the QR must be
 * a PNG data URL produced by lib/assets/qr.ts so nothing else can be injected
 * into the image element.
 */
export function buildRoomPlaqueSvg(input: RoomAssetInput, qrDataUrl: string): string {
  if (!pngDataUrlPattern.test(qrDataUrl)) throw new Error('Invalid QR data URL');

  const hotelName = escapeXml(input.hotelName);
  const roomBadge = escapeXml(`ROOM ${input.roomLabel}`);
  // The approved badge is 348px wide and right-aligned at x=1622; longer labels widen it leftwards.
  const badgeWidth = Math.max(348, Math.round(roomBadge.length * 21 + 90));
  const badgeX = 1622 - badgeWidth;
  const badgeCenter = badgeX + badgeWidth / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${A5_PIXEL_WIDTH}" height="${A5_PIXEL_HEIGHT}" viewBox="0 0 1748 2480">
  <rect width="1748" height="2480" fill="${PLAQUE_COLORS.warm}"/>
  <circle cx="1660" cy="-10" r="340" fill="none" stroke="${PLAQUE_COLORS.magenta}" stroke-opacity=".08" stroke-width="104"/>
  <circle cx="-65" cy="2350" r="260" fill="none" stroke="${PLAQUE_COLORS.navy}" stroke-opacity=".06" stroke-width="86"/>

  <g transform="translate(128 118)">
    <image href="${MEHMONGO_MARK_DATA_URL}" x="0" y="0" width="208" height="132"/>
    <text x="240" y="91" font-family="Arial, Helvetica, sans-serif" font-size="86" font-weight="700" letter-spacing="-4" fill="${PLAQUE_COLORS.navy}">Mehmon<tspan fill="${PLAQUE_COLORS.magenta}">Go</tspan></text>
  </g>

  <rect x="${badgeX}" y="130" width="${badgeWidth}" height="98" rx="49" fill="#FFFFFF" stroke="#E2D9CD" stroke-width="3"/>
  <text x="${badgeCenter}" y="194" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="${PLAQUE_COLORS.navy}">${roomBadge}</text>

  <text x="128" y="445" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="700" letter-spacing="7" fill="${PLAQUE_COLORS.magenta}">GUEST SERVICES</text>
  <text x="128" y="575" font-family="Arial, Helvetica, sans-serif" font-size="108" font-weight="750" letter-spacing="-5" fill="${PLAQUE_COLORS.navy}">
    <tspan x="128" dy="0">Everything you need</tspan>
    <tspan x="128" dy="116">during your stay —</tspan>
    <tspan x="128" dy="116" fill="${PLAQUE_COLORS.magenta}">one scan away.</tspan>
  </text>

  <rect x="262" y="908" width="1224" height="1224" rx="96" fill="#FFFFFF"/>
  <image href="${qrDataUrl}" x="362" y="1008" width="1024" height="1024"/>

  <g font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="${PLAQUE_COLORS.navy}" text-anchor="middle">
    <text x="219" y="2245"><tspan fill="${PLAQUE_COLORS.magenta}">●</tspan><tspan dx="12">TOURS</tspan></text>
    <text x="656" y="2245"><tspan fill="${PLAQUE_COLORS.magenta}">●</tspan><tspan dx="12">TRANSPORT</tspan></text>
    <text x="1092" y="2245"><tspan fill="${PLAQUE_COLORS.magenta}">●</tspan><tspan dx="12">RESTAURANTS</tspan></text>
    <text x="1529" y="2245"><tspan fill="${PLAQUE_COLORS.magenta}">●</tspan><tspan dx="12">TICKETS</tspan></text>
  </g>
  <text x="874" y="2345" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="36" fill="#667286">Scan to request a service. No registration required.</text>
  <text x="874" y="2408" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="#8993A0">${hotelName} · MehmonGo local concierge</text>
</svg>`;
}
