import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  A5_PIXEL_HEIGHT,
  A5_PIXEL_WIDTH,
  MEHMONGO_MARK_SVG,
  buildGuestRoomUrl,
  buildRoomPlaqueSvg,
  roomAssetBaseName,
  type RoomAssetInput,
} from './room-plaque';

const fixture: RoomAssetInput = {
  hotelSlug: 'kamilovs',
  hotelName: 'Kamilovs Hotel',
  roomLabel: '205',
  roomToken: '4c5f9a10-1111-4222-8333-abcdefabcdef',
  siteUrl: 'https://example.com',
};

const QR_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('room plaque template', () => {
  it('embeds the approved mark without drifting from public/mehmongo-mark.svg', () => {
    // Compare line by line ignoring trailing whitespace: the public file carries two blank lines with spaces.
    const normalize = (svg: string) => svg.split(/\r?\n/).map((line) => line.trimEnd()).join('\n').trim();
    const publicMark = readFileSync(resolve(process.cwd(), 'public/mehmongo-mark.svg'), 'utf8');
    expect(normalize(MEHMONGO_MARK_SVG)).toBe(normalize(publicMark));
  });

  it('builds the opaque guest route', () => {
    expect(buildGuestRoomUrl(fixture)).toBe('https://example.com/r/4c5f9a10-1111-4222-8333-abcdefabcdef');
    expect(buildGuestRoomUrl({ ...fixture, siteUrl: 'https://example.com/' })).toBe('https://example.com/r/4c5f9a10-1111-4222-8333-abcdefabcdef');
  });

  it('renders the approved A5 canvas with the hotel, room and QR', () => {
    const svg = buildRoomPlaqueSvg(fixture, QR_DATA_URL);

    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain(`width="${A5_PIXEL_WIDTH}" height="${A5_PIXEL_HEIGHT}" viewBox="0 0 1748 2480"`);
    expect(svg).toContain('ROOM 205');
    expect(svg).toContain('Kamilovs Hotel · MehmonGo local concierge');
    expect(svg).toContain(`href="${QR_DATA_URL}" x="362" y="1008" width="1024" height="1024"`);
    for (const label of ['TOURS', 'TRANSPORT', 'RESTAURANTS', 'TICKETS']) expect(svg).toContain(label);
    expect(svg).toContain('Scan to request a service. No registration required.');
    expect(svg).toContain('#F7F3EC');
    expect(svg).toContain('#102B4E');
    expect(svg).toContain('#D3226A');
  });

  it('escapes hotel and room text in SVG', () => {
    const svg = buildRoomPlaqueSvg({ ...fixture, hotelName: 'A & B <Hotel>', roomLabel: 'A/1' }, QR_DATA_URL);

    expect(svg).toContain('A &amp; B &lt;Hotel&gt;');
    expect(svg).not.toContain('A & B <Hotel>');
    expect(svg).toContain('ROOM A/1');
  });

  it('rejects a QR that is not a PNG data URL', () => {
    expect(() => buildRoomPlaqueSvg(fixture, 'javascript:alert(1)')).toThrow('Invalid QR data URL');
  });

  it('creates filesystem-safe stable names', () => {
    expect(roomAssetBaseName({ ...fixture, roomLabel: 'Villa 3 / East' })).toBe('kamilovs-room-villa-3-east');
    expect(roomAssetBaseName(fixture)).toBe('kamilovs-room-205');
    expect(roomAssetBaseName({ ...fixture, roomLabel: 'Люкс 7' })).toBe('kamilovs-room-7');
    expect(roomAssetBaseName({ ...fixture, roomLabel: '///' })).toBe('kamilovs-room-4c5f9a10');
  });
});
