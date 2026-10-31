#!/usr/bin/env node
/**
 * Builds the MehmonGo room booklet: eight small pages that stand beside the
 * room's QR plaque and explain, before anyone scans, what that code does.
 *
 *   npm run booklet              writes into ../MehmonGo-книжка
 *   npm run booklet -- <folder>  writes elsewhere
 *
 * The idea is one image carried through every page: the room has one more door,
 * and the QR code is its key. The doors are the pointed arches of Registan and
 * Chorsu, framed in the eight-pointed star tile of the same buildings, both
 * drawn here as vector so they stay sharp in print.
 *
 * One A4 sheet makes one booklet: print both sides, cut across the middle, stack
 * the halves, fold and staple. The finished size is 98 x 136 mm rather than A6,
 * so an office printer's unprintable margin falls outside the cut.
 *
 * The booklet deliberately carries no QR code, no link, no hotel and no room.
 * The plaque is the only code in the room, so a guest cannot scan the wrong one
 * and lose the room their request belongs to, and one print run serves every
 * hotel and survives a change of domain. The key on page 2 is drawn so that it
 * cannot be mistaken for a code to scan.
 *
 * Prices, titles and notes come from content/catalog.en.json, the same file the
 * website reads; the booklet's own words are in content/booklet.json. The two
 * supplier vehicle photos are "All rights reserved" and stay out of it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CarFront, Check, Compass, Globe, Ticket, Utensils } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { en as messages } from '../lib/i18n/messages/en.ts';
import { browserPath, dataUri, escapeHtml, fontFaces, projectDir, renderPdf } from './lib/print-assets.mjs';

const outputDir = process.argv[2] ?? path.join(projectDir, '..', 'MehmonGo-книжка');

const PAGE_WIDTH_MM = 98;
const PAGE_HEIGHT_MM = 136;
const BLEED_MM = 2;
const MM_TO_PT = 72 / 25.4;

/**
 * A whole number of tiles fits the page width, so a tile band runs on unbroken
 * across the fold of the centre spread and of the cover.
 */
const TILE_MM = PAGE_WIDTH_MM / 14;

/**
 * Where each page sits on the A4 sheet. The back row order mirrors the front, so
 * a printer flipping on the long edge puts 2 behind 1, 7 behind 8, 4 behind 3
 * and 5 behind 6, and every page stays upright.
 */
const SHEET_SIDES = [
  [[8, 1], [6, 3]],
  [[2, 7], [4, 5]],
];
const COLUMN_X_MM = [7, 105];
const ROW_Y_MM = [8, 153];

const NAVY = '#102B4E';
const MAGENTA = '#D3226A';
const PINK = '#F56FA0';
const IVORY = '#F7F3EC';
const PAPER = '#FFFDFA';
const TEAL = '#2B8F7E';

const readJson = (name) => JSON.parse(readFileSync(path.join(projectDir, 'content', name), 'utf8'));
const contact = readJson('contact.json');
const catalog = readJson('catalog.en.json');
const photoSources = readJson('photo-sources.json');
const copy = readJson('booklet.json');

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key]);
const icon = (Icon, size = 14) => renderToStaticMarkup(createElement(Icon, { size, strokeWidth: 2, 'aria-hidden': true }));

/** Copy marks its accent words as *word*; they are set in the site's Georgia italic. */
const accented = (text) => escapeHtml(text).replace(/\*(.+?)\*/g, '<em>$1</em>');

function offer(id) {
  const found = catalog.offers.find((entry) => entry.id === id);
  if (!found) throw new Error(`Offer ${id} is not in the catalogue; the booklet would lie about it.`);
  return found;
}

const photoName = (entry) => (entry.image.split('/').pop() ?? '').replace(/\.[a-z]+$/i, '');
const priceLabel = (entry) => fill(copy.rides.from, { amount: `$${entry.price.amount}` });

/** The photos that need a credit by licence, in the site's own wording. */
function creditLine(names) {
  return names
    .map((name) => photoSources.photos.find((entry) => entry.name === name))
    .filter((entry) => entry && entry.licenseUrl)
    .map((entry) => `${entry.title} — ${entry.author}, ${entry.license}`)
    .join(' · ');
}

const brandMark = (colour) => {
  const svg = readFileSync(path.join(projectDir, 'public', 'mehmongo-mark.svg'), 'utf8').replaceAll('#102B4E', colour);
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

const wordmark = (light) => `
  <span class="brand ${light ? 'brand-light' : ''}">
    <img src="${brandMark(light ? PAPER : NAVY)}" alt=""><b>Mehmon<i>Go</i></b>
  </span>`;

/** The site's language pill, drawn as the guest will see it. */
const languagePill = `<span class="pill">${icon(Globe, 8)}EN</span>`;

let nextId = 0;
const uniqueId = (prefix) => `${prefix}-${(nextId += 1)}`;

/** `amount` of the way from one #RRGGBB colour to another. */
function mixColour(from, to, amount) {
  const channel = (hex, index) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const mixed = [0, 1, 2].map((index) => Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** An eight-pointed star: two squares turned 45 degrees, the figure of the tile. */
function starPoints(cx, cy, radius) {
  const inner = radius * (Math.cos(Math.PI / 4) / Math.cos(Math.PI / 8));
  return Array.from({ length: 16 }, (_, index) => {
    const angle = (index * Math.PI) / 8;
    const r = index % 2 === 0 ? radius : inner;
    return `${(cx + r * Math.cos(angle)).toFixed(3)},${(cy + r * Math.sin(angle)).toFixed(3)}`;
  }).join(' ');
}

/**
 * The star and the cross its neighbours leave between them, laid out over a
 * rectangle. Each tile is real geometry rather than an SVG <pattern>: the browser
 * rasterises a pattern when it writes the PDF, and the tile prints blurred.
 *
 * The grid is anchored to the coordinate origin, not the rectangle, so bands on
 * facing pages share one grid.
 *
 * `fade` says how much of a row shows, from 0 to 1, by the row's height on the
 * page. It mixes the colours rather than laying a transparent veil on top: the
 * whole booklet is free of transparency, because a print shop opens this file in
 * CorelDRAW and soft masks are what such an import loses.
 */
function tileShapes({ x, y, w, h, size = TILE_MM, ground, star, heart, jewel, fade }) {
  const id = uniqueId('tile');
  const half = size / 2;
  const corner = size * 0.13;
  const firstColumn = Math.floor(x / size);
  const firstRow = Math.floor(y / size);
  const defs = [];
  const uses = [];
  for (let row = firstRow; row * size < y + h; row += 1) {
    const shown = fade ? fade((row + 0.5) * size) : 1;
    const colour = (value) => mixColour(ground, value, shown);
    const rowId = `${id}-${row - firstRow}`;
    // One shape is enough when every row looks the same.
    if (fade || row === firstRow) {
      defs.push(`<g id="${rowId}">
      ${jewel ? [[0, 0], [size, 0], [0, size], [size, size]].map(([cx, cy]) => `<polygon points="${cx},${cy - corner} ${cx + corner},${cy} ${cx},${cy + corner} ${cx - corner},${cy}" fill="${colour(jewel)}"/>`).join('') : ''}
      <polygon points="${starPoints(half, half, half)}" fill="${colour(star)}"/>
      ${heart ? `<polygon points="${starPoints(half, half, half * 0.5)}" fill="${colour(heart)}"/>` : ''}
    </g>`);
    }
    for (let column = firstColumn; column * size < x + w; column += 1) {
      uses.push(`<use href="#${fade ? rowId : `${id}-0`}" x="${(column * size).toFixed(3)}" y="${(row * size).toFixed(3)}"/>`);
    }
  }
  return `<defs>${defs.join('')}</defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${ground}"/>
    ${uses.join('')}`;
}

/** A rectangle of tile, positioned in the page's own millimetres. */
function tileField({ x, y, w, h, ...tile }) {
  return `<svg class="field" style="left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm" viewBox="${x} ${y} ${w} ${h}" aria-hidden="true">
    ${tileShapes({ x, y, w, h, ...tile })}
  </svg>`;
}

const BAND_TILE = { ground: NAVY, star: IVORY, heart: MAGENTA, jewel: TEAL };

/** The tile band along the top of an inside page, bleeding off the edge. */
const frieze = () => `
  ${tileField({ x: -BLEED_MM, y: -BLEED_MM, w: PAGE_WIDTH_MM + 2 * BLEED_MM, h: TILE_MM + BLEED_MM, ...BAND_TILE })}
  <div class="frieze-rule"></div>`;

const folio = (number, light = false) => `
  <div class="folio ${light ? 'folio-light' : ''}">
    <svg viewBox="0 0 10 10" aria-hidden="true"><polygon points="${starPoints(5, 5, 5)}"/></svg>
    <span>${number}</span>
  </div>`;

/** A pointed arch standing on its base, as in the iwans of Registan. */
function archPath(x, y, w, h, spring) {
  const cx = x + w / 2;
  const side = y + spring;
  return `M${x} ${y + h} V${side} C${x} ${y + spring * 0.52} ${x + w * 0.3} ${y + spring * 0.22} ${cx} ${y} C${x + w * 0.7} ${y + spring * 0.22} ${x + w} ${y + spring * 0.52} ${x + w} ${side} V${y + h} Z`;
}

/**
 * A doorway: the tile frame with whatever lies beyond it clipped inside. `w` and
 * `h` are the outside of the frame; `inside` draws in the same millimetres.
 */
function doorway({ w, h, spring, band, tile, inside }) {
  const clipId = uniqueId('door');
  const frameId = uniqueId('frame');
  const inset = band * 1.7;
  const opening = archPath(band, inset, w - 2 * band, h - inset, spring - band * 0.4);
  return `<svg class="door" viewBox="0 0 ${w} ${h}" style="width:${w}mm;height:${h}mm" aria-hidden="true">
    <defs>
      <clipPath id="${frameId}"><path d="${archPath(0, 0, w, h, spring)}"/></clipPath>
      <clipPath id="${clipId}"><path d="${opening}"/></clipPath>
    </defs>
    <g clip-path="url(#${frameId})">${tileShapes({ x: 0, y: 0, w, h, size: band, ...tile })}</g>
    <g clip-path="url(#${clipId})">${inside(band, inset, w - 2 * band, h - inset)}</g>
    <path d="${opening}" fill="none" stroke="${PINK}" stroke-width=".3"/>
  </svg>`;
}

/** A photo filling the opening, slid sideways so its subject stands under the point. */
function photoFill(href, pixelWidth, pixelHeight, subjectX) {
  return (x, y, w, h) => {
    const scale = Math.max(w / pixelWidth, h / pixelHeight);
    const width = pixelWidth * scale;
    const height = pixelHeight * scale;
    const left = Math.min(0, Math.max(w - width, w / 2 - subjectX * width));
    return `<image href="${href}" x="${x + left}" y="${y + h - height}" width="${width}" height="${height}" preserveAspectRatio="none"/>`;
  };
}

/**
 * The owner's original rather than the 960 px card: the cover door is the largest
 * photo here. The dark foot that carries the cover's text is painted into the
 * photo itself, so the page needs no transparent layer over it.
 */
async function coverPhoto() {
  const source = path.join(projectDir, 'content', 'owner-photos', 'tashkent-tv-tower.jpg');
  const shade = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1125">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".5" stop-color="${NAVY}" stop-opacity="0"/>
      <stop offset=".86" stop-color="${NAVY}" stop-opacity=".94"/>
    </linearGradient></defs>
    <rect width="2000" height="1125" fill="url(#shade)"/>
  </svg>`;
  const buffer = await sharp(source).composite([{ input: Buffer.from(shade) }]).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

/**
 * The key, whose bow borrows a QR code's corners without being one: a star sits
 * where the data would be, so no phone will try to read it.
 */
function keyIllustration(extraClass = '') {
  const finder = (x, y) => `
    <rect x="${x}" y="${y}" width="15" height="15" rx="2.6" fill="${MAGENTA}"/>
    <rect x="${x + 3}" y="${y + 3}" width="9" height="9" rx="1.2" fill="${PAPER}"/>
    <rect x="${x + 5.2}" y="${y + 5.2}" width="4.6" height="4.6" rx=".7" fill="${MAGENTA}"/>`;
  const body = (colour) => `
    <rect x="0" y="0" width="60" height="60" rx="10" fill="${colour}"/>
    <rect x="58" y="19" width="10" height="22" rx="2.5" fill="${colour}"/>
    <rect x="66" y="25" width="86" height="10" rx="3" fill="${colour}"/>
    <path d="M122 33 h9 v13 a2 2 0 0 1 -2 2 h-5 a2 2 0 0 1 -2 -2 z M137 33 h13 v19 a2 2 0 0 1 -2 2 h-9 a2 2 0 0 1 -2 -2 z" fill="${colour}"/>`;
  return `<svg class="key ${extraClass}" viewBox="-4 -14 164 92" aria-hidden="true">
    <g transform="rotate(-9 76 30)">
      <g transform="translate(1.6 2.2)">${body('#AC1653')}</g>
      ${body(PAPER)}
      ${finder(6, 6)}${finder(39, 6)}${finder(6, 39)}
      <polygon points="${starPoints(38.5, 38.5, 13)}" fill="${MAGENTA}"/>
      <polygon points="${starPoints(38.5, 38.5, 6)}" fill="${PAPER}"/>
    </g>
  </svg>`;
}

function doorCard(entry, subjectX) {
  const name = photoName(entry);
  const href = dataUri(path.join(projectDir, 'public', 'catalog', `${name}-960.jpg`), 'image/jpeg');
  return `
    <article class="door-card">
      ${doorway({
        w: 39,
        h: 62,
        spring: 23,
        band: 2.6,
        tile: BAND_TILE,
        inside: photoFill(href, 960, 640, subjectX),
      })}
      <h3>${escapeHtml(entry.title)}</h3>
      <p class="summary">${escapeHtml(entry.summary)}</p>
      <p class="door-price"><strong>${escapeHtml(priceLabel(entry))}</strong><span>${escapeHtml(entry.price.unit)}</span></p>
    </article>`;
}

function ticketRow(title, detail, stub, tone = '') {
  return `
    <article class="ticket ${tone}">
      <div class="ticket-main">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(detail)}</p>
      </div>
      <div class="ticket-stub">${stub}</div>
    </article>`;
}

const priceStub = (entry) => `<strong>${escapeHtml(priceLabel(entry))}</strong><span>${escapeHtml(entry.price.unit)}</span>`;

function languageBlock(entry) {
  return `
    <article class="language" lang="${entry.tag}">
      <p class="language-name">${escapeHtml(entry.name)}</p>
      <h3>${escapeHtml(entry.title)}</h3>
      <p class="language-text">${escapeHtml(entry.before)} ${languagePill} ${escapeHtml(entry.after)}</p>
    </article>`;
}

async function buildPages() {
  const filterLabel = (id) => catalog.page.filters.find((entry) => entry.id === id)?.label ?? '';
  const ticket = offer('ticket-assistance');
  const services = [
    [Compass, messages.services.tours],
    [CarFront, messages.services.transport],
    [Ticket, messages.services.tickets],
    [Utensils, messages.services.restaurants],
  ];
  const creditedPhotos = ['tashkent-mountains-base', 'tashkent-samarkand-one-way'].map((id) => photoName(offer(id)));
  const coverHref = await coverPhoto();
  const navyField = { ground: NAVY, star: '#163A63', heart: '#1B4470', jewel: '#1B4470' };
  // The tile dies away where text stands on it: under the cover's headline, under the back cover's small print.
  const coverFade = (y) => clamp01((y - 24) / 37);
  const backFade = (y) => 1 - clamp01((y - 84) / 13);

  return {
    1: `
    <section class="p p-navy">
      ${tileField({ x: -BLEED_MM, y: -BLEED_MM, w: PAGE_WIDTH_MM + 2 * BLEED_MM, h: PAGE_HEIGHT_MM + 2 * BLEED_MM, ...navyField, fade: coverFade })}
      <div class="cover-door">
        ${doorway({
          w: 82,
          h: 94,
          spring: 36,
          band: 3.5,
          tile: BAND_TILE,
          inside: photoFill(coverHref, 2000, 1125, 0.37),
        })}
      </div>
      <div class="cover-top">
        ${wordmark(true)}
        <h1>${accented(copy.cover.title)}</h1>
      </div>
      <div class="cover-bottom">
        <p class="cover-guide">${escapeHtml(copy.cover.guide)}</p>
        <p class="cover-languages">${escapeHtml(copy.cover.languages)}</p>
      </div>
    </section>`,

    2: `
    <section class="p p-magenta">
      ${tileField({ x: -BLEED_MM, y: -BLEED_MM, w: PAGE_WIDTH_MM + 2 * BLEED_MM, h: PAGE_HEIGHT_MM + 2 * BLEED_MM, ground: MAGENTA, star: '#C81E63', heart: '#BC1A5B', jewel: '#BC1A5B' })}
      <div class="inner">
        <p class="eyebrow">${escapeHtml(copy.intro.eyebrow)}</p>
        <h2 class="display">${accented(copy.intro.title)}</h2>
        ${keyIllustration()}
        <div class="intro-foot">
          <p class="lead">${escapeHtml(copy.intro.text)}</p>
          <ul class="promises">
            <li>${icon(Check, 10)}${escapeHtml(copy.intro.promises.noAccount)}</li>
            <li>${icon(Check, 10)}${escapeHtml(copy.intro.promises.price)}</li>
            <li>${icon(Check, 10)}${escapeHtml(fill(copy.intro.promises.reply, { minutes: contact.replyMinutes, from: contact.hoursFrom, to: contact.hoursTo }))}</li>
          </ul>
        </div>
        ${folio(2, true)}
      </div>
    </section>`,

    3: `
    <section class="p">
      ${frieze()}
      <div class="inner inner-frieze">
        <p class="eyebrow">${escapeHtml(copy.steps.eyebrow)}</p>
        <h2>${accented(copy.steps.title)}</h2>
        <ol class="steps">
          ${copy.steps.items.map((step, index) => `
          <li>
            <span class="step-star"><svg viewBox="0 0 10 10" aria-hidden="true"><polygon points="${starPoints(5, 5, 5)}"/></svg><b>${index + 1}</b></span>
            <div><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.text)}</span></div>
          </li>`).join('')}
        </ol>
        <div class="opens">
          <p>${escapeHtml(copy.steps.opens)}</p>
          <ul>
            ${services.map(([Icon, service]) => `<li>${icon(Icon, 15)}<span>${escapeHtml(service.title)}</span></li>`).join('')}
          </ul>
        </div>
        ${folio(3)}
      </div>
    </section>`,

    4: `
    <section class="p">
      ${frieze()}
      <div class="inner inner-frieze inner-left">
        <p class="eyebrow">${escapeHtml(filterLabel('tours'))}</p>
        <h2>${accented(copy.tours.left)}</h2>
        <div class="arcade">${doorCard(offer('tashkent-private-guide'), 0.37)}${doorCard(offer('tashkent-mountains-base'), 0.3)}</div>
        ${folio(4)}
      </div>
    </section>`,

    5: `
    <section class="p">
      ${frieze()}
      <div class="inner inner-frieze inner-right">
        <p class="eyebrow">${escapeHtml(filterLabel('tours'))}</p>
        <h2>${accented(copy.tours.right)}</h2>
        <div class="arcade">${doorCard(offer('tashkent-city-car'), 0.51)}${doorCard(offer('tashkent-samarkand-one-way'), 0.5)}</div>
        ${folio(5)}
      </div>
    </section>`,

    6: `
    <section class="p">
      ${frieze()}
      <div class="inner inner-frieze">
        <p class="eyebrow">${escapeHtml(filterLabel('transport'))}</p>
        <h2>${accented(copy.rides.title)}</h2>
        <div class="tickets">
          ${['tashkent-airport-sedan', 'tashkent-airport-minivan', 'tashkent-airport-welcome'].map((id) => {
            const ride = offer(id);
            return ticketRow(ride.title, ride.facts.join(' · '), priceStub(ride));
          }).join('')}
        </div>
        <p class="eyebrow also">${escapeHtml(copy.rides.alsoTitle)}</p>
        <div class="tickets">
          ${ticketRow(filterLabel('tickets'), ticket.facts.slice(0, 2).join(' · '), `<strong class="stub-word">${escapeHtml(copy.rides.quote)}</strong>`, 'ticket-teal')}
          ${ticketRow(catalog.page.restaurantTitle, copy.rides.restaurantText, `<strong class="stub-word">${escapeHtml(copy.rides.restaurantStub)}</strong>`, 'ticket-teal')}
        </div>
        <p class="fine">${escapeHtml(catalog.page.priceNote)}</p>
        ${folio(6)}
      </div>
    </section>`,

    7: `
    <section class="p">
      ${frieze()}
      <div class="inner inner-frieze">
        <h2 class="languages-title">${accented(copy.languages.title)}</h2>
        <div class="languages">${copy.languages.entries.map(languageBlock).join('')}</div>
        ${folio(7)}
      </div>
    </section>`,

    8: `
    <section class="p p-navy">
      ${tileField({ x: -BLEED_MM, y: -BLEED_MM, w: PAGE_WIDTH_MM + 2 * BLEED_MM, h: PAGE_HEIGHT_MM + 2 * BLEED_MM, ...navyField, fade: backFade })}
      <div class="back-door">
        ${doorway({
          w: 82,
          h: 88,
          spring: 36,
          band: 3.5,
          tile: BAND_TILE,
          inside: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${MAGENTA}"/>`,
        })}
        ${keyIllustration('key-small')}
        <div class="back-door-text">
          <p class="eyebrow">${escapeHtml(copy.back.eyebrow)}</p>
          <h2 class="display">${accented(copy.back.title)}</h2>
          <p class="lead">${escapeHtml(copy.back.text)}</p>
        </div>
      </div>
      <div class="back-foot">
        <ul class="back-services">${copy.back.services.map((service) => `<li>${escapeHtml(service)}</li>`).join('')}</ul>
        <p>${escapeHtml(copy.back.reception)}</p>
        <p>${escapeHtml(fill(copy.back.questions, { phone: contact.phone, from: contact.hoursFrom, to: contact.hoursTo }))}</p>
        <div class="back-sign">
          ${wordmark(true)}
          <p class="back-credits">${escapeHtml(copy.back.credits)}: ${escapeHtml(creditLine(creditedPhotos)).replaceAll(' · ', '<br>')}</p>
        </div>
      </div>
    </section>`,
  };
}

const pageCss = `
${fontFaces()}

:root {
  --navy: ${NAVY};
  --navy-2: #163455;
  --magenta: ${MAGENTA};
  --pink: ${PINK};
  --ivory: ${IVORY};
  --paper: ${PAPER};
  --teal: #257666;
  --line: #E5DED2;
  --muted: #5E6A7C;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Geist', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', system-ui, sans-serif;
  color: var(--navy);
  background: #fff;
  -webkit-font-smoothing: antialiased;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* A page's background runs ${BLEED_MM} mm past its trim; whatever holds the page decides how much shows. */
.p { position: relative; width: ${PAGE_WIDTH_MM}mm; height: ${PAGE_HEIGHT_MM}mm; }
.p::before { content: ''; position: absolute; inset: -${BLEED_MM}mm; background: var(--ivory); }
.p-navy::before { background: var(--navy); }
.p-magenta::before { background: var(--magenta); }
.field { position: absolute; display: block; }
.frieze-rule { position: absolute; left: -${BLEED_MM}mm; right: -${BLEED_MM}mm; top: ${TILE_MM}mm; height: .5mm; background: var(--magenta); }

.inner { position: relative; height: 100%; padding: 8mm 8mm 5mm; display: flex; flex-direction: column; }
.inner-frieze { padding-top: 12mm; }

.eyebrow { font-size: 6.2pt; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--magenta); }
/* Tight tracking narrows Geist's already small space, and bold words run together: the words are opened up to compensate. */
h2 { margin-top: 1.6mm; font-size: 16.5pt; line-height: 1.12; font-weight: 800; letter-spacing: -.025em; word-spacing: .14em; text-wrap: balance; }
em { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-weight: 400; letter-spacing: -.02em; color: var(--magenta); }
h3 { font-size: 9.2pt; line-height: 1.16; font-weight: 800; letter-spacing: -.015em; }
.lead { font-size: 8.4pt; line-height: 1.42; }

.folio { position: relative; flex: none; width: 6.4mm; height: 6.4mm; margin: auto auto 0; display: grid; place-items: center; }
.folio svg { position: absolute; inset: 0; width: 100%; height: 100%; fill: var(--navy); }
.folio span { position: relative; font-size: 6.2pt; font-weight: 700; color: var(--paper); font-variant-numeric: tabular-nums; }
.folio-light svg { fill: var(--paper); }
.folio-light span { color: var(--magenta); }

.brand { display: inline-flex; align-items: center; gap: 1.6mm; font-size: 10.5pt; letter-spacing: -.03em; }
.brand img { width: 8mm; display: block; }
.brand b { font-weight: 800; }
.brand i { font-style: normal; color: var(--magenta); }
.brand-light { color: var(--paper); }
.brand-light i { color: var(--pink); }

/* ---------- cover ---------- */
.cover-door { position: absolute; left: 8mm; top: 44mm; }
.door { display: block; }
.cover-top { position: absolute; left: 8mm; right: 8mm; top: 7mm; text-align: center; color: var(--paper); }
.cover-top h1 { margin: 3mm auto 0; font-size: 22.5pt; line-height: 1.06; font-weight: 800; letter-spacing: -.028em; word-spacing: .14em; text-wrap: balance; }
.cover-top em { color: var(--pink); font-size: 1.1em; }
.cover-bottom { position: absolute; left: 15mm; right: 15mm; bottom: 7mm; text-align: center; color: var(--paper); }
.cover-guide { font-size: 9pt; line-height: 1.3; font-weight: 700; letter-spacing: -.012em; text-wrap: balance; }
.cover-languages { margin-top: 1.8mm; font-size: 6.6pt; font-weight: 600; color: var(--pink); }

/* ---------- the key ---------- */
.p-magenta { color: var(--paper); }
.p-magenta .eyebrow { color: #F9DEE6; }
.display { margin-top: 2mm; font-size: 20pt; line-height: 1.08; letter-spacing: -.028em; word-spacing: .14em; }
.p-magenta em { color: var(--paper); font-size: 1.1em; }
.key { display: block; flex: none; width: 88mm; margin: auto -3mm; }
.key-small { position: absolute; left: 17mm; top: 20mm; width: 48mm; margin: 0; }
.intro-foot { flex: none; }
.promises { list-style: none; margin-top: 2.6mm; display: grid; gap: .9mm; }
.promises li { display: grid; grid-template-columns: 3.4mm 1fr; gap: 1.2mm; font-size: 7.1pt; line-height: 1.3; font-weight: 500; }
.promises svg { margin-top: .25mm; }
.p-magenta .folio { margin-top: 2mm; }

/* ---------- steps ---------- */
.steps { position: relative; list-style: none; display: grid; gap: 7mm; margin-top: 7mm; }
.steps::before { content: ''; position: absolute; left: 4mm; top: 4mm; bottom: 12mm; border-left: .35mm dashed var(--magenta); }
.steps li { position: relative; display: grid; grid-template-columns: 8mm 1fr; gap: 2.4mm; }
.step-star { position: relative; display: grid; place-items: center; width: 8mm; height: 8mm; }
.step-star svg { position: absolute; inset: 0; fill: var(--magenta); }
.step-star b { position: relative; font-size: 9pt; font-weight: 800; color: var(--paper); }
.steps strong { display: block; font-size: 9.6pt; font-weight: 800; letter-spacing: -.012em; }
.steps div span { display: block; margin-top: .6mm; font-size: 8pt; line-height: 1.38; color: var(--navy-2); }
.opens { margin-top: 8mm; padding: 3mm 2mm 2.8mm; border-radius: 2.6mm; background: var(--navy); color: var(--paper); }
.opens p { text-align: center; font-size: 5.8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--pink); }
.opens ul { list-style: none; display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 1.6mm; }
.opens li { display: grid; justify-items: center; gap: .9mm; font-size: 6.4pt; font-weight: 600; }

/* ---------- the arcade across the centre spread ---------- */
.inner-left { padding-left: 7mm; padding-right: 8mm; }
.inner-right { padding-left: 8mm; padding-right: 7mm; }
.arcade { display: grid; grid-template-columns: 39mm 39mm; gap: 0 4mm; margin-top: 3.4mm; }
.door-card { display: flex; flex-direction: column; }
.door-card h3 { margin-top: 2mm; font-size: 8.8pt; }
.summary { margin: .9mm 0 1.6mm; font-size: 6.4pt; line-height: 1.32; color: var(--muted); }
.door-price { margin-top: auto; padding-top: 1.2mm; border-top: .3mm solid var(--magenta); }
.door-price strong { display: block; font-size: 10.5pt; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.door-price span { display: block; margin-top: .2mm; font-size: 5.4pt; line-height: 1.2; color: var(--muted); }

/* ---------- rides as tickets ---------- */
.tickets { display: grid; gap: 2.2mm; margin-top: 3mm; }
.ticket { position: relative; display: grid; grid-template-columns: 1fr 21mm; border-radius: 2mm; background: var(--navy); color: var(--paper); }
.ticket::before, .ticket::after { content: ''; position: absolute; right: 19.8mm; width: 2.4mm; height: 2.4mm; border-radius: 50%; background: var(--ivory); }
.ticket::before { top: -1.2mm; }
.ticket::after { bottom: -1.2mm; }
.ticket-main { padding: 2.4mm 2.2mm 2.4mm 2.8mm; }
.ticket h3 { font-size: 8.2pt; }
.ticket p { margin-top: .5mm; font-size: 6pt; line-height: 1.26; color: #C6CBD1; }
.ticket-stub { display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 1.4mm 1.3mm; border-left: .3mm dashed #7C8A9B; }
.ticket-stub strong { font-size: 9pt; font-weight: 800; letter-spacing: -.02em; color: var(--pink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ticket-stub span { margin-top: .3mm; font-size: 4.9pt; line-height: 1.16; color: #C6CBD1; }
.ticket-stub .stub-word { font-size: 6.6pt; line-height: 1.16; letter-spacing: 0; color: var(--paper); white-space: normal; }
.ticket-teal { background: var(--teal); }
.ticket-teal p { color: #CBDDD7; }
.ticket-teal .ticket-stub { border-left-color: #87B3A9; }
.also { margin-top: 3mm; }
.fine { margin-top: 2.2mm; font-size: 5.5pt; line-height: 1.32; color: var(--muted); }

/* ---------- languages ---------- */
.languages-title { margin-top: .5mm; }
.languages { display: grid; margin-top: 2mm; }
.language { padding: 2.5mm 0 2.6mm; border-top: .3mm solid var(--line); }
.language:first-child { border-top: 0; }
.language-name { font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 12pt; line-height: 1.1; color: var(--magenta); }
.language:lang(zh) .language-name { font-family: inherit; font-style: normal; font-weight: 700; font-size: 11pt; }
.language h3 { margin-top: .6mm; font-size: 8.2pt; }
.language-text { margin-top: .7mm; font-size: 7.2pt; line-height: 1.38; color: var(--navy-2); }
.language:lang(zh) h3, .language:lang(zh) .language-text { letter-spacing: 0; }
.pill { display: inline-flex; align-items: center; gap: .6mm; padding: 0 1.1mm; border: .2mm solid var(--navy); border-radius: 2mm; font-size: 6pt; font-weight: 700; line-height: 1.35; color: var(--navy); vertical-align: 1px; white-space: nowrap; }

/* ---------- back cover ---------- */
.back-door { position: absolute; left: 8mm; top: 7mm; width: 82mm; height: 88mm; }
.back-door-text { position: absolute; left: 11mm; right: 11mm; bottom: 8mm; text-align: center; color: var(--paper); }
.back-door-text .eyebrow { color: #F9DEE6; }
.back-door-text .display { margin: 2mm -3mm 0; font-size: 22.5pt; white-space: nowrap; }
.back-door-text em { color: var(--paper); font-size: 1.08em; }
.back-door-text .lead { margin-top: 2.6mm; font-size: 8pt; text-wrap: balance; }
.back-foot { position: absolute; left: 8mm; right: 8mm; bottom: 6mm; color: #DEE0E2; font-size: 6.5pt; line-height: 1.34; text-align: center; }
.back-foot p { text-wrap: balance; }
.back-foot p + p { margin-top: .5mm; }
.back-services { list-style: none; display: flex; justify-content: center; flex-wrap: wrap; gap: 1mm 2.6mm; margin-bottom: 2mm; color: var(--paper); }
.back-services li { font-size: 6pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.back-services li::before { content: ''; display: inline-block; width: 1.1mm; height: 1.1mm; margin-right: .9mm; border-radius: 50%; background: var(--pink); vertical-align: 1px; }
.back-sign { display: grid; justify-items: center; gap: 1mm; margin-top: 2mm; }
.back-sign .back-credits { font-size: 4.8pt; line-height: 1.25; color: #AEB6C0; }
`;

function documentHtml(title, pageSize, css, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
@page { size: ${pageSize}; margin: 0; }
${pageCss}
${css}
</style>
</head>
<body>${body}</body>
</html>`;
}

/** The pages in reading order, cut to their final size: for looking at, not for printing. */
function previewHtml(pages) {
  const css = `
.slot { width: ${PAGE_WIDTH_MM}mm; height: ${PAGE_HEIGHT_MM}mm; overflow: hidden; page-break-after: always; }
.slot:last-child { page-break-after: auto; }`;
  const body = Object.values(pages).map((page) => `<div class="slot">${page}</div>`).join('');
  return documentHtml('MehmonGo booklet', `${PAGE_WIDTH_MM}mm ${PAGE_HEIGHT_MM}mm`, css, body);
}

/** A mark runs over the bleed, which is cut away, and stops short of the finished page. */
function cutMarks() {
  const lines = [];
  const stopShort = 0.8;
  const [left, spine] = COLUMN_X_MM;
  const right = spine + PAGE_WIDTH_MM;
  const [top, lower] = ROW_Y_MM;
  const rowEdges = [top, top + PAGE_HEIGHT_MM, lower, lower + PAGE_HEIGHT_MM];

  for (const y of rowEdges) {
    lines.push([2, y, left - stopShort, y], [right + stopShort, y, 208, y]);
  }
  for (const x of [left, right]) {
    lines.push([x, 2, x, top - stopShort], [x, top + PAGE_HEIGHT_MM + stopShort, x, lower - stopShort], [x, lower + PAGE_HEIGHT_MM + stopShort, x, 295]);
  }
  const draw = (stroke, width) => lines
    .map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"/>`)
    .join('');
  const fold = [[spine, 2, spine, top - stopShort], [spine, top + PAGE_HEIGHT_MM + stopShort, spine, top + PAGE_HEIGHT_MM + BLEED_MM], [spine, lower - BLEED_MM, spine, lower - stopShort], [spine, lower + PAGE_HEIGHT_MM + stopShort, spine, 295]]
    .map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#D3226A" stroke-width=".18" stroke-dasharray="1 .8"/>`)
    .join('');
  return `<svg class="marks" viewBox="0 0 210 297" aria-hidden="true">${draw('#fff', 0.6)}${draw('#000', 0.15)}${fold}</svg>`;
}

/** One A4 sheet, both sides. Every page keeps its bleed except along the fold. */
function sheetHtml(pages) {
  const css = `
.sheet { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; }
.sheet:last-child { page-break-after: auto; }
.cell { position: absolute; overflow: hidden; width: ${PAGE_WIDTH_MM + BLEED_MM}mm; height: ${PAGE_HEIGHT_MM + 2 * BLEED_MM}mm; }
.marks { position: absolute; inset: 0; width: 210mm; height: 297mm; }
.note { position: absolute; left: 12mm; right: 12mm; top: ${ROW_Y_MM[0] + PAGE_HEIGHT_MM + BLEED_MM}mm; height: ${ROW_Y_MM[1] - ROW_Y_MM[0] - PAGE_HEIGHT_MM - 2 * BLEED_MM}mm; display: flex; align-items: center; justify-content: center; font-size: 5.6pt; color: #5E6A7C; }`;

  const sides = SHEET_SIDES.map((rows, sideIndex) => {
    const cells = rows.flatMap((row, rowIndex) => row.map((pageNumber, columnIndex) => {
      const onLeft = columnIndex === 0;
      const cellX = onLeft ? COLUMN_X_MM[0] - BLEED_MM : COLUMN_X_MM[1];
      const cellY = ROW_Y_MM[rowIndex] - BLEED_MM;
      return `<div class="cell" style="left:${cellX}mm;top:${cellY}mm"><div style="position:absolute;left:${onLeft ? BLEED_MM : 0}mm;top:${BLEED_MM}mm;width:${PAGE_WIDTH_MM}mm">${pages[pageNumber]}</div></div>`;
    })).join('');
    return `<div class="sheet">${cells}<p class="note">Сторона ${sideIndex + 1} из 2 · печать 100 %, двусторонняя, переворот по длинному краю · резать по чёрным меткам, сгибать по розовым</p>${cutMarks()}</div>`;
  }).join('');
  return documentHtml('MehmonGo booklet, A4 sheet', '210mm 297mm', css, sides);
}

/** A wrong size or page count would still look like a PDF; refuse to call it finished. */
async function assertPdf(pdfPath, expectedPages, widthMm, heightMm) {
  const pdf = await PDFDocument.load(readFileSync(pdfPath));
  if (pdf.getPageCount() !== expectedPages) {
    throw new Error(`${path.basename(pdfPath)} has ${pdf.getPageCount()} pages, expected ${expectedPages}.`);
  }
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    if (Math.abs(width - widthMm * MM_TO_PT) > 1 || Math.abs(height - heightMm * MM_TO_PT) > 1) {
      throw new Error(`${path.basename(pdfPath)} has a ${width}x${height} pt page, expected ${widthMm}x${heightMm} mm.`);
    }
  }
}

function readme() {
  return `МИНИ-КНИЖКА MEHMONGO ДЛЯ НОМЕРОВ
=================================

ИДЕЯ

  «У вашего номера есть ещё одна дверь»: она открывается в Ташкент, а ключ
  от неё — QR-код на табличке рядом. Двери — стрельчатые арки Регистана и
  Чорсу, рамки — звёздная плитка тех же зданий.

ЧТО ГДЕ

  MehmonGo-booklet-print-A4.pdf         Для печати: 1 лист A4, две стороны.
  MehmonGo-booklet-print-A4-curves.pdf  То же, весь текст в кривых: для типографии
                                        и для импорта в CorelDRAW.
  svg-curves/                           Те же две стороны в SVG, если Corel
                                        плохо импортирует PDF.
  MehmonGo-booklet-preview.pdf          8 страниц по порядку. Только посмотреть.
  html/                                 Те же страницы для браузера.

КАК НАПЕЧАТАТЬ

  1. Откройте MehmonGo-booklet-print-A4.pdf и печатайте так:
     масштаб 100 % («Фактический размер»), двусторонняя печать,
     переворот по ДЛИННОМУ краю, цвет. Бумага 160–200 г/м², матовая.
  2. Разрежьте лист по чёрным меткам: получатся две половинки.
  3. Положите половинку с обложкой (страницы 8 и 1) этими страницами вниз,
     сверху — половинку со страницами 6 и 3 тоже ими вниз.
  4. Согните пополам по розовой метке, обложкой наружу.
  5. Скрепите двумя скобами по сгибу.

  Готовая книжка: ${PAGE_WIDTH_MM} x ${PAGE_HEIGHT_MM} мм. Проверка: страницы идут 1, 2, 3 … 8.

В ТИПОГРАФИИ

  Отдайте MehmonGo-booklet-print-A4-curves.pdf. В нём уже есть вылеты ${BLEED_MM} мм
  и метки реза, а шрифты не нужны: текст в кривых. Попросите биговку и две скобы.

  Если просят файл CDR: CorelDRAW открывает этот PDF через «Файл → Импорт» и сам
  сохраняет его как CDR. Создать CDR без самого CorelDRAW нечем.

ГДЕ СТАВИТЬ

  Рядом с табличкой с QR-кодом, обложкой к гостю. В самой книжке кода нет:
  она одна на все отели и все номера, а заявка должна прийти из того номера,
  где стоит табличка. Поэтому менять книжку при новом отеле не нужно.

КАК ПЕРЕСОБРАТЬ

  Слова книжки: content/booklet.json. Цены и названия: content/catalog.en.json.
  Телефон и часы: content/contact.json. Затем:

    npm run booklet
    npm run booklet:curves

  Вторая команда один раз требует: pip install pymupdf

ФОТОГРАФИИ

  Чарвак и Регистан чужие, под лицензиями Creative Commons, поэтому на задней
  обложке стоит подпись с авторами. Её убирать нельзя.
`;
}

async function main() {
  const htmlDir = path.join(outputDir, 'html');
  mkdirSync(htmlDir, { recursive: true });
  const browser = browserPath();

  const pieces = [
    { name: 'preview', pdf: 'MehmonGo-booklet-preview.pdf', wrap: previewHtml, count: 8, width: PAGE_WIDTH_MM, height: PAGE_HEIGHT_MM },
    { name: 'print-a4', pdf: 'MehmonGo-booklet-print-A4.pdf', wrap: sheetHtml, count: 2, width: 210, height: 297 },
  ];
  for (const piece of pieces) {
    const htmlPath = path.join(htmlDir, `mehmongo-booklet-${piece.name}.html`);
    const pdfPath = path.join(outputDir, piece.pdf);
    writeFileSync(htmlPath, piece.wrap(await buildPages()), 'utf8');
    renderPdf(browser, htmlPath, pdfPath);
    await assertPdf(pdfPath, piece.count, piece.width, piece.height);
    console.log(`${piece.pdf} written`);
  }

  writeFileSync(path.join(outputDir, 'ЧИТАТЬ.txt'), readme(), 'utf8');
  console.log(`ЧИТАТЬ.txt written into ${outputDir}`);
}

await main();
