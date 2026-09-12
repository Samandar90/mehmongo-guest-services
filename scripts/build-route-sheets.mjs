#!/usr/bin/env node
/**
 * Builds the MehmonGo route sheets: one A4 page per route, for the guest who
 * asks the concrete question — where exactly do we go, what do we see there,
 * and how long does it take.
 *
 *   node scripts/build-route-sheets.mjs [output-dir]
 *
 * One PDF per route so a single sheet can be sent to a single guest, plus one
 * PDF with all of them. The routes live in content/routes.<locale>.json and are
 * the owner's to correct: this script only lays them out.
 *
 * The price comes from content/catalog.<locale>.json, the same file the site
 * reads, so a sheet cannot quote a price the site does not. Purchase prices and
 * hotel payouts are not in that file and must never reach this one.
 *
 * The diagram is deliberately a diagram: positions are roughly true to each
 * other but it is not a map to scale, and it says so. The real map is the QR
 * code, which opens the route in Google Maps on the guest's own phone.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import {
  baseCss,
  brandAsset,
  browserPath,
  escapeHtml,
  projectDir,
  renderPdf,
} from './lib/print-assets.mjs';

const outputDir = process.argv[2] ?? path.join(projectDir, 'outputs', 'route-sheets');
const locales = ['ru', 'en'];

const contact = JSON.parse(readFileSync(path.join(projectDir, 'content', 'contact.json'), 'utf8'));

/**
 * Google resolves these by name, which survives a place moving a few metres
 * better than coordinates would. A route of alternatives has no order to hand
 * over, so it opens the area instead of a set of directions.
 */
function mapsUrl(route) {
  const places = route.stops.map((stop) => encodeURIComponent(stop.maps));
  if (route.stopsAre === 'options') {
    return `https://www.google.com/maps/search/?api=1&query=${places[0]}`;
  }
  const waypoints = places.slice(1, -1).join('%7C');
  return `https://www.google.com/maps/dir/?api=1&origin=${places[0]}&destination=${places[places.length - 1]}`
    + (waypoints ? `&waypoints=${waypoints}` : '')
    + `&travelmode=${route.travelmode}`;
}

/** The drawing box inside the diagram panel, in millimetres. */
const SCHEME_BOX = { width: 70, height: 62 };

/**
 * Frames the diagram on the points it actually has, keeping the box's own
 * proportions so nothing is stretched. Every drawn size is multiplied by the
 * resulting scale, so a number on a tight route prints the same height as a
 * number on a wide one.
 */
function schemeViewBox(points) {
  const pad = 10;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  let minX = Math.min(...xs) - pad;
  let minY = Math.min(...ys) - pad;
  let width = Math.max(...xs) + pad - minX;
  let height = Math.max(...ys) + pad - minY;

  const aspect = SCHEME_BOX.width / SCHEME_BOX.height;
  if (width / height < aspect) {
    const grown = height * aspect;
    minX -= (grown - width) / 2;
    width = grown;
  } else {
    const grown = width / aspect;
    minY -= (grown - height) / 2;
    height = grown;
  }
  return { minX, minY, width, height, unit: height / 100 };
}

/**
 * The route as a diagram: numbered dots in roughly true relative positions,
 * joined in the order we visit them. Names are not drawn on it — they are the
 * numbered list beside it, which keeps the drawing readable at this size.
 */
function schemeSvg(route) {
  // The drive from Tashkent reaches the area, not one particular stop, when the
  // stops are alternatives: aim the line at their middle rather than at the first.
  const first = route.stopsAre === 'options'
    ? {
      x: route.stops.reduce((sum, stop) => sum + stop.x, 0) / route.stops.length,
      y: route.stops.reduce((sum, stop) => sum + stop.y, 0) / route.stops.length,
    }
    : route.stops[0];
  const origin = route.origin;
  const box = schemeViewBox([...route.stops, ...(origin ? [origin] : [])]);
  const u = box.unit;
  const points = route.stops.map((stop) => `${stop.x},${stop.y}`).join(' ');
  const northX = box.minX + box.width - 4 * u;
  const northY = box.minY + 2 * u;

  return `
    <svg class="scheme-svg" viewBox="${box.minX} ${box.minY} ${box.width} ${box.height}" role="img" aria-label="${escapeHtml(route.title)}">
      <g class="compass">
        <line x1="${northX}" y1="${northY + 2 * u}" x2="${northX}" y2="${northY + 9 * u}" stroke-width="${0.7 * u}" />
        <polygon points="${northX},${northY} ${northX - 1.9 * u},${northY + 3.6 * u} ${northX + 1.9 * u},${northY + 3.6 * u}" />
        <text x="${northX}" y="${northY + 13.4 * u}" font-size="${4.4 * u}">N</text>
      </g>

      ${origin ? `
      <line class="scheme-approach" x1="${origin.x}" y1="${origin.y}" x2="${first.x}" y2="${first.y}"
            stroke-width="${0.7 * u}" stroke-dasharray="${1.6 * u} ${1.8 * u}" />
      <rect class="scheme-origin" x="${origin.x - 2.6 * u}" y="${origin.y - 2.6 * u}"
            width="${5.2 * u}" height="${5.2 * u}" rx="${1.3 * u}" stroke-width="${0.9 * u}" />
      <text class="scheme-origin-label" x="${origin.x}" y="${origin.y + 7.6 * u}" font-size="${4.2 * u}">${escapeHtml(origin.name)}</text>
      <text class="scheme-approach-label" x="${(origin.x + first.x) / 2 + 3 * u}" y="${(origin.y + first.y) / 2 + u}" font-size="${3.8 * u}">${escapeHtml(origin.note ?? '')}</text>
      ` : ''}

      ${route.stopsAre === 'options' ? '' : `<polyline class="scheme-line" points="${points}" stroke-width="${u}" stroke-dasharray="${3 * u} ${2.2 * u}" />`}

      ${route.stops.map((stop, index) => `
      <g>
        <circle class="scheme-dot" cx="${stop.x}" cy="${stop.y}" r="${4.4 * u}" />
        <text class="scheme-number" x="${stop.x}" y="${stop.y + 1.6 * u}" font-size="${5 * u}">${index + 1}</text>
      </g>`).join('')}
    </svg>`;
}

function stopItem(stop, index) {
  return `
    <li class="stop">
      <span class="stop-number">${index + 1}</span>
      <div>
        <h3>${escapeHtml(stop.name)}</h3>
        <p class="stop-meta">${escapeHtml(stop.local)} · ${escapeHtml(stop.time)}</p>
        <p class="stop-text">${escapeHtml(stop.text)}</p>
      </div>
    </li>`;
}

function listBlock(title, items, tone) {
  return `
    <section class="list-block${tone ? ` list-${tone}` : ''}">
      <h4>${escapeHtml(title)}</h4>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </section>`;
}

async function routePage(route, data, catalog, assets) {
  const labels = data.labels;
  const offer = catalog.offers.find((entry) => entry.id === route.offerId);
  // A route whose shape is not the catalogue product it borrows — a whole day
  // with waiting against a one-way transfer — must not print that price.
  const quoted = route.priceMode === 'quote' || !offer || offer.price.mode !== 'from' || offer.price.amount === null;
  const price = quoted ? labels.quote : `${labels.priceFrom} $${offer.price.amount}`;
  const priceUnit = quoted ? '' : offer.price.unit;
  // A quote explains itself on the small line; a figure only needs the caveat.
  const priceSmall = [quoted ? route.priceNote : '', labels.notConfirmed].filter(Boolean).join(' ');
  // 34 mm at this URL length keeps a module near half a millimetre, which is
  // what a phone camera needs off paper; 22 mm was too dense to scan.
  const qr = await QRCode.toDataURL(mapsUrl(route), {
    margin: 0,
    width: 600,
    color: { dark: '#102B4E', light: '#FFFDFA' },
  });

  // Seven stops make a fourth row in the two-column list and push the sheet
  // over the page; the dense variant buys that row back.
  return `
<section class="page"${route.stops.length > 6 ? ' data-dense="true"' : ''}>
  <header class="running">
    <span class="running-brand"><img src="${assets.mark}" alt=""><b>Mehmon<i>Go</i></b></span>
    <span class="running-label">${escapeHtml(labels.sheet)}</span>
  </header>

  <div class="title-block">
    <p class="eyebrow">${escapeHtml(route.eyebrow)}</p>
    <h1>${escapeHtml(route.title)}</h1>
    <p class="summary">${escapeHtml(route.summary)}</p>
    <ul class="facts">
      ${route.facts.map((fact) => `<li><span>${escapeHtml(fact.label)}</span><b>${escapeHtml(fact.value)}</b></li>`).join('')}
    </ul>
  </div>

  <div class="panel">
    <figure class="scheme">
      ${schemeSvg(route)}
      <figcaption>${escapeHtml(route.stopsAre === 'options' ? labels.schemeNoteOptions : labels.schemeNote)}</figcaption>
    </figure>
    <div class="panel-side">
      <figure class="qr">
        <img src="${qr}" alt="">
        <figcaption>${escapeHtml(route.stopsAre === 'options' ? labels.openArea : labels.openMap)}</figcaption>
      </figure>
      ${listBlock(labels.included, route.included)}
      ${listBlock(labels.extra, route.extra, 'extra')}
    </div>
  </div>

  <ol class="stops">${route.stops.map(stopItem).join('')}</ol>

  ${listBlock(labels.tips, route.tips, 'tips')}

  <footer class="page-foot sheet-foot">
    <span class="foot-price">
      <b>${escapeHtml(price)}</b>
      ${priceUnit ? `<i>${escapeHtml(priceUnit)}</i>` : ''}
      <em>${escapeHtml(priceSmall)}</em>
    </span>
    <span class="foot-contact">
      <i>${escapeHtml(labels.askUs)}</i>
      <b>${escapeHtml(contact.phone)}</b>
    </span>
  </footer>
</section>`;
}

function css(locale) {
  return `
${baseCss(locale)}

.title-block { margin: 5mm 0 4mm; }
.title-block h1 { margin-top: 2mm; font-size: 32px; font-weight: 800; letter-spacing: -.035em; line-height: 1.06; }
.summary { margin-top: 3mm; max-width: 160mm; font-size: 12.5px; line-height: 1.55; color: var(--navy-2); }
.facts { display: flex; flex-wrap: wrap; gap: 3mm; margin-top: 4mm; list-style: none; }
.facts li {
  padding: 2.5mm 4mm;
  border: 1px solid var(--line);
  border-radius: 3mm;
  background: var(--paper);
}
.facts span { display: block; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
.facts b { display: block; margin-top: 0.8mm; font-size: 12px; font-weight: 700; }

/* ---------- diagram, QR and the two short lists ---------- */
.panel { display: grid; grid-template-columns: 78mm 1fr; gap: 6mm; margin-top: 2mm; }
.scheme {
  padding: 4mm;
  border: 1px solid var(--line);
  border-radius: 4mm;
  background: var(--paper);
  display: flex;
  flex-direction: column;
}
.scheme-svg { width: 100%; height: 62mm; display: block; }
.scheme figcaption { margin-top: 2.5mm; font-size: 8.5px; line-height: 1.45; color: var(--muted); }

/* Geometry is set per route on the elements themselves, so a tight diagram and
   a wide one print their dots and numbers at the same physical size. */
.scheme-line { fill: none; stroke: var(--magenta); stroke-linecap: round; stroke-linejoin: round; }
.scheme-dot { fill: var(--navy); }
.scheme-number { fill: var(--paper); font-weight: 700; text-anchor: middle; }
.scheme-origin { fill: none; stroke: var(--muted); }
.scheme-origin-label { fill: var(--muted); font-weight: 600; text-anchor: middle; }
.scheme-approach { stroke: var(--muted); }
.scheme-approach-label { fill: var(--muted); font-weight: 600; }
.compass line { stroke: var(--muted); }
.compass polygon { fill: var(--muted); }
.compass text { fill: var(--muted); font-weight: 700; text-anchor: middle; }

.panel-side { display: grid; gap: 3.5mm; align-content: start; }
.qr { display: grid; grid-template-columns: 34mm 1fr; gap: 3.5mm; align-items: center; }
.qr img { width: 34mm; height: 34mm; display: block; border: 1px solid var(--line); border-radius: 2.5mm; background: var(--paper); padding: 2mm; }
.qr figcaption { font-size: 9.5px; line-height: 1.4; color: var(--navy-2); font-weight: 600; }

.list-block h4 { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
.list-block ul { margin-top: 1.5mm; list-style: none; display: grid; gap: 1mm; }
.list-block li { font-size: 10.5px; line-height: 1.4; padding-left: 4mm; position: relative; }
.list-block li::before { content: '—'; position: absolute; left: 0; color: var(--magenta); }
.list-extra li::before { content: '+'; color: var(--muted); }

/* ---------- the stops themselves ---------- */
.stops {
  margin-top: 5mm;
  padding-top: 4mm;
  border-top: 1px solid var(--line);
  list-style: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3.5mm 7mm;
}
.stop { display: grid; grid-template-columns: 6.5mm 1fr; gap: 3mm; align-items: start; }
.stop-number {
  display: grid;
  place-items: center;
  width: 6.5mm; height: 6.5mm;
  border-radius: 50%;
  background: var(--navy);
  color: var(--paper);
  font-size: 11px;
  font-weight: 700;
}
.stop h3 { font-size: 13px; font-weight: 800; letter-spacing: -.02em; line-height: 1.2; }
.stop-meta { margin-top: 0.8mm; font-size: 9px; font-weight: 600; color: var(--magenta); }
.stop-text { margin-top: 1.5mm; font-size: 10px; line-height: 1.45; color: var(--muted); }

.list-tips {
  margin-top: 4mm;
  padding: 4mm 4.5mm;
  border: 1px dashed var(--line);
  border-radius: 4mm;
}
.list-tips ul { grid-template-columns: 1fr 1fr; gap: 1.5mm 7mm; display: grid; }
.list-tips li { font-size: 10px; color: var(--navy-2); }

/* A sheet with more stops than the others gives up a little air, not a stop. */
.page[data-dense] .title-block { margin: 4mm 0 3mm; }
.page[data-dense] .summary { margin-top: 2.5mm; font-size: 12px; }
.page[data-dense] .facts { margin-top: 3mm; }
/* The panel is as tall as its side column, not as the diagram, so that is
   where a dense sheet has to find the room. The QR stays 34 mm: below that it
   stops scanning off paper, which is the whole point of it. */
.page[data-dense] .scheme-svg { height: 54mm; }
.page[data-dense] .panel-side { gap: 2.5mm; }
.page[data-dense] .list-block ul { gap: 0.7mm; }
.page[data-dense] .stops { margin-top: 4mm; padding-top: 3mm; gap: 2.2mm 7mm; }
.page[data-dense] .stop-text { font-size: 9.5px; line-height: 1.4; }
.page[data-dense] .list-tips { margin-top: 3mm; padding: 3mm 4.5mm; }
.page[data-dense] .list-tips ul { gap: 1mm 7mm; }

.sheet-foot { align-items: center; }
.foot-price b { font-size: 17px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; color: var(--navy); }
.foot-price i { font-style: normal; margin-left: 2mm; font-size: 9.5px; color: var(--muted); max-width: 105mm; }
.foot-price em { display: block; margin-top: 0.8mm; font-style: normal; font-size: 8.5px; color: var(--muted); }
.foot-contact { text-align: right; white-space: nowrap; }
.foot-contact i { display: block; font-style: normal; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: var(--magenta); }
.foot-contact b { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--navy); }
`;
}

async function buildDocument(locale, routes, data, catalog, assets) {
  const pages = [];
  for (const route of routes) pages.push(await routePage(route, data, catalog, assets));

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>MehmonGo — ${escapeHtml(routes.length === 1 ? routes[0].title : data.labels.stops)}</title>
<style>${css(locale)}</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;
}

function readme(routes) {
  const list = routes.map((route) => `  MehmonGo-${route.id}-ru.pdf / -en.pdf`.padEnd(52) + route.title).join('\n');
  return `МАРШРУТНЫЕ ЛИСТЫ MEHMONGO
=========================

Один лист A4 на один маршрут: что смотрим по порядку, сколько времени на
каждой точке, что входит в цену и что оплачивается отдельно. Для туриста,
который спрашивает «а куда конкретно мы поедем и что там будет».

ЧТО ГДЕ

${list}

  MehmonGo-all-routes-ru.pdf / -en.pdf             Все четыре одним файлом

  Папка html/ — те же листы в браузере, если удобнее показать на экране.

СХЕМА И КАРТА

  Слева на листе — схема: пронумерованные точки примерно там, где они
  стоят друг относительно друга. Это не карта в масштабе, и на листе так
  и написано.

  Настоящая карта — QR-код рядом. Турист наводит камеру, и маршрут со
  всеми точками открывается у него в Google Картах. Отсканируйте сами
  один раз и убедитесь, что названия распознаются как надо.

ЦЕНЫ

  Берутся из каталога (content/catalog.<язык>.json), как и на сайте.
  У Самарканда стоит «по расчёту»: в каталоге есть только трансфер в одну
  сторону за $200, а поездка на день с ожиданием и возвращением стоит
  иначе. Скажите цену — поставлю её.

ЧТО ПОПРАВИТЬ ПОД СЕБЯ

  Маршруты — черновик по стандартным точкам. Вы возите людей и знаете,
  как есть на самом деле. Всё лежит в content/routes.ru.json и
  routes.en.json: названия, тексты, время на точке, что входит в цену,
  советы. После правок:

    npm run routes

  Файлы в этой папке перезапишутся.

  Языки пока два. Узбекский и китайский сделаю, когда подтвердите, что
  маршруты верные — переводить черновик смысла нет.
`;
}

async function main() {
  const htmlDir = path.join(outputDir, 'html');
  mkdirSync(htmlDir, { recursive: true });
  const browser = browserPath();
  const assets = { mark: brandAsset('mark.svg') };

  for (const locale of locales) {
    const data = JSON.parse(readFileSync(path.join(projectDir, 'content', `routes.${locale}.json`), 'utf8'));
    const catalog = JSON.parse(readFileSync(path.join(projectDir, 'content', `catalog.${locale}.json`), 'utf8'));

    for (const route of data.routes) {
      const html = await buildDocument(locale, [route], data, catalog, assets);
      const htmlPath = path.join(htmlDir, `${route.id}-${locale}.html`);
      const pdfPath = path.join(outputDir, `MehmonGo-${route.id}-${locale}.pdf`);
      writeFileSync(htmlPath, html, 'utf8');
      renderPdf(browser, htmlPath, pdfPath);
      console.log(`${path.basename(pdfPath)} written`);
    }

    const all = await buildDocument(locale, data.routes, data, catalog, assets);
    const allHtml = path.join(htmlDir, `all-routes-${locale}.html`);
    const allPdf = path.join(outputDir, `MehmonGo-all-routes-${locale}.pdf`);
    writeFileSync(allHtml, all, 'utf8');
    renderPdf(browser, allHtml, allPdf);
    console.log(`${path.basename(allPdf)} written`);

    if (locale === 'ru') {
      writeFileSync(path.join(outputDir, 'ЧИТАТЬ.txt'), readme(data.routes), 'utf8');
      console.log(`ЧИТАТЬ.txt written into ${outputDir}`);
    }
  }
}

await main();
