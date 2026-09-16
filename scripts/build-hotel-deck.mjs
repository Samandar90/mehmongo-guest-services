#!/usr/bin/env node
/**
 * Builds the MehmonGo presentation for hotels: a 16:9 PDF, in Russian and
 * English, to open on a laptop in the meeting and to send afterwards.
 *
 *   npm run deck                                   for any hotel
 *   npm run deck -- "Hyatt Regency Tashkent"       with that hotel on the cover and the plaque
 *
 * Every figure is taken, not typed: prices from content/catalog.<locale>.json,
 * the payout rules from lib/partners/payout-example.ts (which mirrors the rate
 * tables in the database), the phone number from content/contact.json. The
 * words live in content/deck.<locale>.json.
 *
 * Run through tsx, because the plaque on slide four is drawn by the same
 * TypeScript template that prints the real ones.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { createRoomQrDataUrl } from '../lib/assets/qr.ts';
import { buildRoomPlaqueSvg } from '../lib/assets/room-plaque.ts';
import { monthPayout, PAYOUT_RATES_USD, VOLUME_TIERS } from '../lib/partners/payout-example.ts';
import { brandAsset, browserPath, dataUri, escapeHtml, fontFaces, projectDir, renderPdf } from './lib/print-assets.mjs';

const PARTNER_SITE = 'https://samandar90.github.io/mehmongo-partners/';
const locales = ['ru', 'en'];

const hotelArgument = process.argv[2]?.trim() || null;
// Beside the repository, next to the logo, brochure and route folders.
const outputDir = process.argv[3] ?? path.join(projectDir, '..', 'MehmonGo-презентация');

const contact = JSON.parse(readFileSync(path.join(projectDir, 'content', 'contact.json'), 'utf8'));

function readJson(name) {
  return JSON.parse(readFileSync(path.join(projectDir, 'content', name), 'utf8'));
}

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Whole dollars: "$2 376" in Russian, "$2,376" in English. */
function usd(amount, locale) {
  const rounded = Math.round(amount);
  const grouped = locale === 'ru'
    ? String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    : rounded.toLocaleString('en-US');
  return `$${grouped}`;
}

function percent(bonus) {
  return `+${Math.round(bonus * 100)}%`;
}

function priceOf(catalog, offerId, labels) {
  if (!offerId) return labels.onRequest;
  const offer = catalog.offers.find((entry) => entry.id === offerId);
  if (!offer || offer.price.mode !== 'from' || offer.price.amount === null) return labels.quote;
  return `${labels.from} $${offer.price.amount}`;
}

function folio(index, total) {
  return `<footer class="folio"><span>Mehmon<i>Go</i></span><span>${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></footer>`;
}

function list(items, className = '') {
  return `<ul class="${className}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

/* ---------------------------------------------------------------- slides */

function coverSlide(deck, assets, audience) {
  return `
<section class="slide dark cover">
  <img class="cover-mark" src="${assets.markWhite}" alt="">
  <img class="cover-lockup" src="${assets.lockupWhite}" alt="MehmonGo">
  <div class="cover-body">
    <p class="eyebrow">${escapeHtml(audience)}</p>
    <h1>${escapeHtml(deck.cover.title)}</h1>
    <p class="lead">${escapeHtml(deck.cover.lead)}</p>
  </div>
  <ul class="cover-facts">${deck.cover.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul>
</section>`;
}

function problemSlide(deck, n, total) {
  const s = deck.problem;
  return `
<section class="slide">
  <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
  <h2>${escapeHtml(s.title)}</h2>
  <div class="cards three">
    ${s.cards.map((card) => `
    <article class="card">
      <h3>${escapeHtml(card.title)}</h3>
      <p>${escapeHtml(card.text)}</p>
    </article>`).join('')}
  </div>
  ${folio(n, total)}
</section>`;
}

function solutionSlide(deck, n, total) {
  const s = deck.solution;
  const last = s.steps.length - 1;
  return `
<section class="slide">
  <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
  <h2>${escapeHtml(s.title)}</h2>
  <ol class="steps four">
    ${s.steps.map((step, index) => `
    <li class="${index === last ? 'is-hotel' : ''}">
      <span class="step-number">${index + 1}</span>
      ${index === last ? `<span class="step-tag">${escapeHtml(deck.labels.hotelStep)}</span>` : ''}
      <h3>${escapeHtml(step.title)}</h3>
      <p>${escapeHtml(step.text)}</p>
    </li>`).join('')}
  </ol>
  ${folio(n, total)}
</section>`;
}

function phoneMock(catalogEn, assets, hotelName, roomLabel) {
  const offer = catalogEn.offers.find((entry) => entry.id === 'tashkent-private-guide');
  return `
  <figure class="phone">
    <div class="phone-screen">
      <div class="pm-header"><span class="pm-brand"><img src="${assets.mark}" alt=""><b>Mehmon<i>Go</i></b></span><span class="pm-lang">EN</span></div>
      <p class="pm-stay">${escapeHtml(hotelName)} · Room ${escapeHtml(roomLabel)}</p>
      <p class="pm-eyebrow">${escapeHtml(catalogEn.page.eyebrow)}</p>
      <p class="pm-title">${escapeHtml(catalogEn.page.title)}</p>
      <div class="pm-card">
        <img src="${assets.guidePhoto}" alt="">
        <div class="pm-card-body">
          <p class="pm-card-eyebrow">${escapeHtml(offer.eyebrow)}</p>
          <p class="pm-card-title">${escapeHtml(offer.title)}</p>
          <p class="pm-card-price">From $${offer.price.amount}</p>
        </div>
      </div>
    </div>
  </figure>`;
}

function guestSlide(deck, assets, catalogEn, hotelName, n, total) {
  const s = deck.guest;
  return `
<section class="slide guest">
  <div class="guest-copy">
    <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
    <h2>${escapeHtml(s.title)}</h2>
    ${list(s.points, 'ticks')}
  </div>
  <div class="guest-visual">
    <figure class="plaque">
      <img src="${assets.plaque}" alt="">
      <figcaption>${escapeHtml(deck.labels.plaqueCaption)}</figcaption>
    </figure>
    ${phoneMock(catalogEn, assets, hotelName, deck.labels.roomLabel)}
    <p class="phone-caption">${escapeHtml(deck.labels.phoneCaption)}</p>
  </div>
  ${folio(n, total)}
</section>`;
}

function servicesSlide(deck, catalog, n, total) {
  const s = deck.services;
  return `
<section class="slide">
  <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
  <h2>${escapeHtml(s.title)}</h2>
  <dl class="menu">
    ${s.items.map((item) => `
    <div><dt>${escapeHtml(item.name)}</dt><dd>${escapeHtml(priceOf(catalog, item.offerId, deck.labels))}</dd></div>`).join('')}
  </dl>
  <p class="note">${escapeHtml(s.note)}</p>
  ${folio(n, total)}
</section>`;
}

function rolesSlide(deck, n, total) {
  const s = deck.roles;
  return `
<section class="slide">
  <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
  <h2>${escapeHtml(s.title)}</h2>
  <div class="roles">
    <article class="role role-hotel">
      <h3>${escapeHtml(s.hotelTitle)}</h3>
      ${list(s.hotel)}
    </article>
    <article class="role role-us">
      <h3>${escapeHtml(s.usTitle)}</h3>
      ${list(s.us)}
    </article>
  </div>
  ${folio(n, total)}
</section>`;
}

function earningsSlide(deck, n, total) {
  const s = deck.earnings;
  const tiers = [...VOLUME_TIERS].reverse();
  return `
<section class="slide dark">
  <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
  <h2>${escapeHtml(s.title)}</h2>
  <div class="rates">
    ${s.rates.map((rate) => `
    <div class="rate"><b>$${PAYOUT_RATES_USD[rate.service]}</b><span>${escapeHtml(rate.label)}</span></div>`).join('')}
  </div>
  <p class="rates-note">${escapeHtml(s.restaurants)}</p>
  <div class="bonus">
    <p class="bonus-title">${escapeHtml(s.bonusTitle)} <span>${escapeHtml(s.bonusText)}</span></p>
    <div class="bonus-steps">
      ${tiers.map((tier) => `
      <div class="bonus-step"><b>${percent(tier.bonus)}</b><span>${escapeHtml(s.bonusFrom.replace('{count}', String(tier.from)))}</span></div>`).join('')}
    </div>
  </div>
  <p class="footnote">${escapeHtml(s.footnote)}</p>
  ${folio(n, total)}
</section>`;
}

function exampleSlide(deck, n, total, locale) {
  const s = deck.example;
  const labels = deck.labels;
  return `
<section class="slide">
  <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
  <h2>${escapeHtml(s.title)}</h2>
  <div class="months">
    ${s.scenarios.map((scenario, index) => {
      const month = monthPayout(scenario);
      return `
    <article class="month${index === 1 ? ' is-typical' : ''}">
      <h3>${escapeHtml(scenario.name)}</h3>
      <table>
        ${month.lines.map((line) => `
        <tr><th>${escapeHtml(labels[line.service])}</th><td class="calc">${line.count} × $${line.rate}</td><td class="sum">${usd(line.base, locale)}</td></tr>`).join('')}
        <tr class="bonus-row"><th colspan="2">${month.completed} ${escapeHtml(labels.completed)} · ${escapeHtml(labels.bonus)} ${percent(month.bonus)}</th><td class="sum">+${usd(month.bonusAmount, locale)}</td></tr>
      </table>
      <p class="month-total"><b>${usd(month.total, locale)}</b> <span>${escapeHtml(labels.perMonth)}</span></p>
      <p class="month-year">${usd(month.total * 12, locale)} ${escapeHtml(labels.perYear)}</p>
    </article>`;
    }).join('')}
  </div>
  <p class="note">${escapeHtml(s.disclaimer)}</p>
  ${folio(n, total)}
</section>`;
}

function verifySlide(deck, n, total) {
  const s = deck.verify;
  return `
<section class="slide verify">
  <div class="verify-copy">
    <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
    <h2>${escapeHtml(s.title)}</h2>
    <div class="points two">
      ${s.points.map((point) => `
      <div class="point"><h3>${escapeHtml(point.title)}</h3><p>${escapeHtml(point.text)}</p></div>`).join('')}
    </div>
  </div>
  <figure class="cabinet">
    <div class="cabinet-head"><b>${escapeHtml(s.table.title)}</b><span class="tag">${escapeHtml(deck.labels.example)}</span></div>
    <table>
      <thead><tr>${s.table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>
      <tbody>${s.table.rows.map((row) => `<tr class="${row[4] === '—' ? 'is-cancelled' : ''}">${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  </figure>
  ${folio(n, total)}
</section>`;
}

function bigHotelSlide(deck, n, total) {
  const s = deck.bigHotel;
  return `
<section class="slide dark">
  <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
  <h2>${escapeHtml(s.title)}</h2>
  <div class="points three">
    ${s.points.map((point) => `
    <div class="point"><h3>${escapeHtml(point.title)}</h3><p>${escapeHtml(point.text)}</p></div>`).join('')}
  </div>
  ${folio(n, total)}
</section>`;
}

function statusSlide(deck, n, total) {
  const s = deck.status;
  return `
<section class="slide">
  <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
  <h2>${escapeHtml(s.title)}</h2>
  <div class="status">
    <article><h3 class="is-live">${escapeHtml(s.workingTitle)}</h3>${list(s.working, 'dots live')}</article>
    <article><h3 class="is-building">${escapeHtml(s.buildingTitle)}</h3>${list(s.building, 'dots building')}</article>
  </div>
  <p class="proof">${escapeHtml(s.proof)}</p>
  ${folio(n, total)}
</section>`;
}

function launchSlide(deck, n, total) {
  const s = deck.launch;
  return `
<section class="slide">
  <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
  <h2>${escapeHtml(s.title)}</h2>
  <ol class="timeline">
    ${s.steps.map((step, index) => `<li><span class="step-number">${index + 1}</span><p>${escapeHtml(step)}</p></li>`).join('')}
  </ol>
  ${folio(n, total)}
</section>`;
}

// The sign-off slide carries the full lockup, so it has no running footer to repeat it.
function contactSlide(deck, assets) {
  const s = deck.contact;
  return `
<section class="slide dark contact">
  <img class="cover-mark" src="${assets.markWhite}" alt="">
  <div class="contact-copy">
    <p class="eyebrow">${escapeHtml(s.eyebrow)}</p>
    <h2>${escapeHtml(s.title)}</h2>
    <p class="phone-number">${escapeHtml(contact.phone)}</p>
    <p class="lead">${escapeHtml(s.text)}</p>
    <img class="contact-lockup" src="${assets.lockupWhite}" alt="MehmonGo">
  </div>
  <figure class="contact-qr">
    <img src="${assets.siteQr}" alt="">
    <figcaption><b>${escapeHtml(s.qrCaption)}</b><span>${escapeHtml(PARTNER_SITE.replace('https://', '').replace(/\/$/, ''))}</span></figcaption>
  </figure>
</section>`;
}

/* ------------------------------------------------------------------ style */

function css(locale) {
  const cjk = locale === 'zh' ? `'Microsoft YaHei', 'PingFang SC', ` : '';
  return `
${fontFaces()}

@page { size: 1280px 720px; margin: 0; }

:root {
  --navy: #102B4E; --navy-2: #163455; --magenta: #D3226A; --pink: #F56FA0;
  --ivory: #F7F3EC; --paper: #FFFDFA; --line: #E5DED2; --muted: #5E6A7C;
  --on-dark-muted: rgba(255, 253, 250, .68); --on-dark-line: rgba(255, 253, 250, .16);
  --live: #2CA47A; --building: #D69A2D;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Geist', ${cjk}system-ui, sans-serif; color: var(--navy); background: var(--ivory); -webkit-font-smoothing: antialiased; }

.slide {
  width: 1280px; height: 720px;
  padding: 60px 80px 70px;
  position: relative; overflow: hidden;
  display: flex; flex-direction: column;
  background: var(--ivory);
  page-break-after: always;
}
.slide:last-child { page-break-after: auto; }
.slide.dark { background: var(--navy); color: var(--paper); }

.eyebrow { font-size: 14px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--magenta); }
.dark .eyebrow { color: var(--pink); }
h2 { margin-top: 14px; max-width: 1000px; font-size: 46px; font-weight: 800; line-height: 1.06; letter-spacing: -.035em; text-wrap: balance; }
h3 { font-size: 21px; font-weight: 750; letter-spacing: -.02em; line-height: 1.2; }
.lead { font-size: 22px; line-height: 1.5; }
.note { margin-top: auto; padding-top: 18px; font-size: 15px; line-height: 1.5; color: var(--muted); max-width: 980px; }

.folio {
  position: absolute; left: 80px; right: 80px; bottom: 28px;
  display: flex; justify-content: space-between;
  font-size: 13px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums;
}
.folio i { font-style: normal; color: var(--magenta); }
.dark .folio { color: var(--on-dark-muted); }
.dark .folio i { color: var(--pink); }

/* ---------- cover ---------- */
.cover { padding: 64px 80px; justify-content: space-between; }
.cover-lockup { width: 250px; position: relative; }
.cover-mark { position: absolute; right: -150px; bottom: -120px; width: 720px; opacity: .07; }
.cover-body { position: relative; max-width: 900px; }
.cover h1 { margin-top: 18px; font-size: 80px; font-weight: 800; line-height: 1; letter-spacing: -.045em; text-wrap: balance; }
.cover .lead { margin-top: 26px; max-width: 760px; color: var(--on-dark-muted); }
.cover-facts { position: relative; display: flex; gap: 12px; list-style: none; }
.cover-facts li { padding: 10px 18px; border: 1px solid var(--on-dark-line); border-radius: 999px; font-size: 16px; font-weight: 600; }

/* ---------- cards ---------- */
/* Short rows of cards sit in the middle of the room left under the title:
   pinned to the bottom, they left a band of nothing across the slide. */
.cards { margin-top: auto; margin-bottom: auto; display: grid; gap: 22px; }
.cards.three { grid-template-columns: repeat(3, 1fr); }
.card { padding: 30px 30px 32px; border: 1px solid var(--line); border-radius: 22px; background: var(--paper); }
.card p { margin-top: 12px; font-size: 17px; line-height: 1.55; color: var(--muted); }

/* ---------- numbered steps ---------- */
.steps { margin-top: auto; margin-bottom: auto; list-style: none; display: grid; gap: 20px; }
.steps.four { grid-template-columns: repeat(4, 1fr); }
.steps li { position: relative; padding: 30px 28px 34px; border: 1px solid var(--line); border-radius: 22px; background: var(--paper); }
.steps li p { margin-top: 12px; font-size: 17px; line-height: 1.55; color: var(--muted); }
.steps h3 { margin-top: 24px; font-size: 23px; }
.step-number {
  display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%;
  background: var(--navy); color: var(--paper); font-size: 18px; font-weight: 750;
}
.steps li.is-hotel { border-color: var(--magenta); }
.steps li.is-hotel .step-number { background: var(--magenta); }
.step-tag {
  position: absolute; top: 34px; right: 22px;
  font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--magenta);
}

/* ---------- guest view ---------- */
.guest { flex-direction: row; gap: 50px; padding-right: 60px; }
.guest-copy { width: 520px; display: flex; flex-direction: column; }
.guest-copy h2 { font-size: 42px; }
.ticks { margin-top: auto; list-style: none; display: grid; gap: 13px; }
.ticks li { position: relative; padding-left: 30px; font-size: 18px; line-height: 1.45; }
.ticks li::before { content: ''; position: absolute; left: 2px; top: 9px; width: 12px; height: 12px; border-radius: 50%; background: var(--magenta); }
.guest-visual { flex: 1; position: relative; }
/* The phone starts below the plaque's top edge so the room badge stays visible. */
.plaque { position: absolute; left: 0; top: 4px; width: 360px; }
.plaque img { width: 100%; display: block; border-radius: 10px; box-shadow: 0 24px 60px rgba(16, 43, 78, .18); }
.plaque figcaption, .phone-caption { margin-top: 12px; font-size: 13px; font-weight: 600; color: var(--muted); }
.phone {
  position: absolute; right: 0; top: 64px; width: 262px; height: 500px;
  padding: 11px; border-radius: 44px; background: var(--navy);
  box-shadow: 0 30px 70px rgba(16, 43, 78, .30);
}
.phone-caption { position: absolute; right: 0; top: 576px; width: 262px; text-align: center; }
.phone-screen { height: 100%; overflow: hidden; border-radius: 34px; background: var(--ivory); padding: 20px 16px; }
.pm-header { display: flex; align-items: center; justify-content: space-between; }
.pm-brand { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 800; letter-spacing: -.03em; }
.pm-brand img { width: 24px; }
.pm-brand i { font-style: normal; color: var(--magenta); }
.pm-lang { padding: 4px 9px; border: 1px solid var(--line); border-radius: 999px; font-size: 9px; font-weight: 700; letter-spacing: .08em; }
.pm-stay { display: inline-block; margin-top: 16px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); font-size: 9px; font-weight: 650; color: #4b5c70; }
.pm-eyebrow { margin-top: 14px; font-size: 8px; font-weight: 750; letter-spacing: .14em; color: var(--magenta); }
.pm-title { margin-top: 6px; font-size: 23px; font-weight: 800; line-height: 1.02; letter-spacing: -.04em; }
.pm-card { margin-top: 14px; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: var(--paper); }
.pm-card img { width: 100%; height: 118px; object-fit: cover; display: block; }
.pm-card-body { padding: 10px 12px 14px; }
.pm-card-eyebrow { font-size: 7px; font-weight: 750; letter-spacing: .12em; color: var(--magenta); }
.pm-card-title { margin-top: 5px; font-size: 13px; font-weight: 750; line-height: 1.2; letter-spacing: -.02em; }
.pm-card-price { margin-top: 8px; font-size: 13px; font-weight: 800; }

/* ---------- services menu ---------- */
.menu { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; column-gap: 64px; }
.menu div { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; padding: 17px 0; border-bottom: 1px solid var(--line); }
.menu dt { font-size: 19px; font-weight: 600; }
.menu dd { font-size: 19px; font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--navy); }

/* ---------- roles ---------- */
.roles { margin-top: auto; margin-bottom: auto; display: grid; grid-template-columns: 1fr 1.55fr; gap: 22px; }
.role { padding: 30px 34px 34px; border-radius: 22px; }
.role ul { margin-top: 16px; list-style: none; display: grid; gap: 12px; }
.role li { position: relative; padding-left: 26px; font-size: 18px; line-height: 1.4; }
.role li::before { content: '—'; position: absolute; left: 0; }
.role-hotel { border: 1px solid var(--line); background: var(--paper); }
.role-hotel li::before { color: var(--muted); }
.role-us { background: var(--navy); color: var(--paper); }
.role-us ul { grid-template-columns: 1fr 1fr; column-gap: 28px; }
.role-us li::before { color: var(--pink); }

/* ---------- earnings ---------- */
.rates { margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
.rate { padding: 22px 28px 24px; border: 1px solid var(--on-dark-line); border-radius: 22px; }
.rate b { display: block; font-size: 84px; font-weight: 800; line-height: 1; letter-spacing: -.05em; font-variant-numeric: tabular-nums; }
.rate:first-child b { color: var(--pink); }
.rate span { display: block; margin-top: 10px; font-size: 18px; color: var(--on-dark-muted); }
.rates-note { margin-top: 14px; font-size: 16px; color: var(--on-dark-muted); }
.bonus { margin-top: 22px; display: flex; align-items: center; justify-content: space-between; gap: 30px; padding: 20px 28px; border-radius: 20px; background: rgba(255, 253, 250, .07); }
.bonus-title { font-size: 20px; font-weight: 750; }
.bonus-title span { display: block; margin-top: 4px; font-size: 15px; font-weight: 500; color: var(--on-dark-muted); }
.bonus-steps { display: flex; gap: 36px; }
.bonus-step { display: flex; align-items: baseline; gap: 12px; }
.bonus-step b { font-size: 40px; font-weight: 800; letter-spacing: -.03em; color: var(--pink); }
.bonus-step span { font-size: 16px; color: var(--on-dark-muted); }
.footnote { margin-top: 14px; font-size: 14px; color: var(--on-dark-muted); }

/* ---------- example month ---------- */
.months { margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
.month { padding: 24px 26px 26px; border: 1px solid var(--line); border-radius: 22px; background: var(--paper); }
.month.is-typical { border-color: var(--navy); box-shadow: 0 18px 44px rgba(16, 43, 78, .12); }
.month table { width: 100%; margin-top: 14px; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.month th, .month td { padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 15px; text-align: left; }
.month th { font-weight: 600; }
.month td.calc { color: var(--muted); }
.month td.sum { text-align: right; font-weight: 700; }
.month .bonus-row th { font-size: 13px; font-weight: 600; color: var(--magenta); }
.month .bonus-row td { color: var(--magenta); }
.month-total { margin-top: 14px; }
.month-total b { font-size: 46px; font-weight: 800; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.month-total span { font-size: 16px; color: var(--muted); }
.month-year { margin-top: 2px; font-size: 15px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }

/* ---------- verify ---------- */
.verify { flex-direction: row; gap: 48px; }
.verify-copy { flex: 1; display: flex; flex-direction: column; }
.points { margin-top: auto; margin-bottom: auto; display: grid; gap: 26px 30px; }
.points.two { grid-template-columns: 1fr 1fr; }
.points.three { grid-template-columns: repeat(3, 1fr); }
.point h3 { font-size: 19px; }
.point p { margin-top: 8px; font-size: 16px; line-height: 1.5; color: var(--muted); }
.dark .point { padding-top: 20px; border-top: 1px solid var(--on-dark-line); }
.dark .point h3 { font-size: 23px; }
.dark .point p { margin-top: 10px; font-size: 18px; color: var(--on-dark-muted); }
.cabinet { width: 540px; flex: none; align-self: center; padding: 22px 24px 18px; border: 1px solid var(--line); border-radius: 22px; background: var(--paper); box-shadow: 0 24px 60px rgba(16, 43, 78, .12); }
.cabinet-head { display: flex; align-items: center; justify-content: space-between; font-size: 17px; }
.tag { padding: 4px 10px; border-radius: 999px; background: var(--ivory); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.cabinet table { width: 100%; margin-top: 14px; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.cabinet th { padding: 8px 6px; border-bottom: 1px solid var(--line); font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); text-align: left; }
/* A reference split over two lines reads as two requests. */
.cabinet td { padding: 11px 6px; border-bottom: 1px solid var(--line); font-size: 13px; white-space: nowrap; }
.cabinet td:first-child { font-weight: 700; }
.cabinet td:last-child, .cabinet th:last-child { text-align: right; }
.cabinet tr.is-cancelled td { color: var(--muted); }

/* ---------- status ---------- */
.status { margin-top: auto; display: grid; grid-template-columns: 1.35fr 1fr; gap: 22px; }
.status article { padding: 26px 30px 28px; border: 1px solid var(--line); border-radius: 22px; background: var(--paper); }
.status h3 { font-size: 15px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.status h3.is-live { color: var(--live); }
.status h3.is-building { color: var(--building); }
.dots { margin-top: 14px; list-style: none; display: grid; gap: 10px; }
.dots li { position: relative; padding-left: 22px; font-size: 17px; line-height: 1.4; }
.dots li::before { content: ''; position: absolute; left: 0; top: 8px; width: 9px; height: 9px; border-radius: 50%; }
.dots.live li::before { background: var(--live); }
.dots.building li::before { background: var(--building); }
/* The lists and the line under them move as one block, centred in the slide. */
.proof { margin-top: 18px; margin-bottom: auto; font-size: 18px; font-weight: 700; }

/* ---------- launch timeline ---------- */
.timeline { margin-top: auto; margin-bottom: auto; list-style: none; display: grid; grid-template-columns: repeat(5, 1fr); position: relative; }
.timeline::before { content: ''; position: absolute; left: 21px; right: calc(20% - 21px); top: 21px; height: 2px; background: var(--line); }
.timeline li { position: relative; padding-right: 24px; }
.timeline li:last-child .step-number { background: var(--magenta); }
.timeline p { margin-top: 20px; font-size: 20px; font-weight: 650; line-height: 1.35; }

/* ---------- contact ---------- */
.contact { flex-direction: row; align-items: stretch; gap: 60px; }
.contact-copy { flex: 1; position: relative; display: flex; flex-direction: column; }
.phone-number { margin-top: auto; font-size: 60px; font-weight: 800; letter-spacing: -.035em; font-variant-numeric: tabular-nums; }
.contact .lead { margin-top: 14px; max-width: 640px; color: var(--on-dark-muted); font-size: 20px; }
.contact-lockup { width: 190px; margin-top: 34px; }
.contact-qr { position: relative; align-self: center; width: 300px; padding: 24px; border-radius: 26px; background: var(--paper); color: var(--navy); }
.contact-qr img { width: 100%; display: block; }
.contact-qr figcaption { margin-top: 16px; }
.contact-qr b { display: block; font-size: 17px; }
.contact-qr span { display: block; margin-top: 4px; font-size: 13px; color: var(--muted); }
`;
}

/* ------------------------------------------------------------------ build */

async function buildDeck(locale, assets, hotelName) {
  const deck = readJson(`deck.${locale}.json`);
  const catalog = readJson(`catalog.${locale}.json`);
  const catalogEn = readJson('catalog.en.json');
  const audience = hotelName ? deck.labels.audienceFor.replace('{hotel}', hotelName) : deck.labels.defaultAudience;
  const mockHotel = hotelName ?? deck.labels.mockHotel;

  const makers = [
    () => coverSlide(deck, assets, audience),
    (n, t) => problemSlide(deck, n, t),
    (n, t) => solutionSlide(deck, n, t),
    (n, t) => guestSlide(deck, assets, catalogEn, mockHotel, n, t),
    (n, t) => servicesSlide(deck, catalog, n, t),
    (n, t) => rolesSlide(deck, n, t),
    (n, t) => earningsSlide(deck, n, t),
    (n, t) => exampleSlide(deck, n, t, locale),
    (n, t) => verifySlide(deck, n, t),
    (n, t) => bigHotelSlide(deck, n, t),
    (n, t) => statusSlide(deck, n, t),
    (n, t) => launchSlide(deck, n, t),
    () => contactSlide(deck, assets),
  ];
  const slides = makers.map((make, index) => make(index + 1, makers.length));

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>MehmonGo — ${escapeHtml(audience)}</title>
<style>${css(locale)}</style>
</head>
<body>
${slides.join('\n')}
</body>
</html>`;
}

async function main() {
  const htmlDir = path.join(outputDir, 'html');
  mkdirSync(htmlDir, { recursive: true });
  const browser = browserPath();

  // The plaque is drawn by the real print template, with the target hotel's
  // name when there is one. Its QR opens the partner page, not a room: a
  // manager who scans it off the screen should land on the payout calculator,
  // not on a room link that belongs to nobody.
  const plaqueQr = await createRoomQrDataUrl(PARTNER_SITE);
  const plaqueSvg = buildRoomPlaqueSvg({
    hotelSlug: 'deck',
    hotelName: hotelArgument ?? 'Your Hotel',
    roomLabel: '1204',
    roomToken: '00000000-0000-4000-8000-000000000000',
    siteUrl: PARTNER_SITE,
  }, plaqueQr);

  const assets = {
    mark: brandAsset('mark.svg'),
    markWhite: brandAsset('mark-white.svg'),
    lockupWhite: brandAsset('lockup-white.svg'),
    guidePhoto: dataUri(path.join(projectDir, 'public', 'catalog', 'tashkent-tv-tower-960.jpg'), 'image/jpeg'),
    plaque: `data:image/svg+xml;base64,${Buffer.from(plaqueSvg).toString('base64')}`,
    siteQr: await QRCode.toDataURL(PARTNER_SITE, { margin: 0, width: 600, color: { dark: '#102B4E', light: '#FFFDFA' } }),
  };

  const suffix = hotelArgument ? `-${slugify(hotelArgument) || 'hotel'}` : '';
  for (const locale of locales) {
    const html = await buildDeck(locale, assets, hotelArgument);
    const htmlPath = path.join(htmlDir, `deck-${locale}${suffix}.html`);
    const pdfPath = path.join(outputDir, `MehmonGo-presentation-${locale}${suffix}.pdf`);
    writeFileSync(htmlPath, html, 'utf8');
    renderPdf(browser, htmlPath, pdfPath);
    console.log(`${path.basename(pdfPath)} written`);
  }

  writeFileSync(path.join(outputDir, 'ЧИТАТЬ.txt'), readme(), 'utf8');
}

/** Named so the folder reads without this script open, as the other print folders do. */
function readme() {
  return `ПРЕЗЕНТАЦИЯ MEHMONGO ДЛЯ ОТЕЛЕЙ
================================

13 слайдов 16:9 — показать на ноутбуке или планшете на встрече и отправить
отелю после неё.

  MehmonGo-presentation-ru.pdf    на русском
  MehmonGo-presentation-en.pdf    на английском — для сетевых отелей

  Папка html/ — те же слайды в браузере.

ПОД КОНКРЕТНЫЙ ОТЕЛЬ

  Название отеля встаёт на обложку, на табличку и на экран телефона:

    npm run deck -- "Hyatt Regency Tashkent"

  Рядом появятся файлы ...-ru-hyatt-regency-tashkent.pdf и -en-.

ОТКУДА ЦИФРЫ

  Ничего не вписано руками. Цены услуг — из каталога сайта. Ставки
  выплат и бонус за объём — из тех же правил, по которым платит база.
  Пример месяца считается формулой, и тест не даст ему разойтись со
  ставками.

  Пример месяца — именно пример, а не прогноз: на слайде это написано.
  Настоящих оборотов отелей в презентации нет.

QR-КОДЫ

  И на табличке, и на последнем слайде QR ведёт на партнёрский сайт с
  калькулятором. Если директор отеля отсканирует код с экрана, он
  попадёт туда, а не в чужой номер.

ЧТО ПОПРАВИТЬ

  Тексты — в content/deck.ru.json и content/deck.en.json.
  После правок: npm run deck
`;
}

await main();
