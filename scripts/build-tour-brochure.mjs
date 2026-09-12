#!/usr/bin/env node
/**
 * Builds the MehmonGo tour brochure: one A4 PDF per guest language, to show
 * or send to a tourist who asks what we offer.
 *
 *   node scripts/build-tour-brochure.mjs [output-dir]
 *
 * Everything a guest reads comes from content/catalog.<locale>.json — the same
 * file the website and the Edge Functions read — so a price can never differ
 * between the brochure and the site. Purchase prices, hotel payouts and the
 * bonus formula are not in that file and must never reach this one.
 *
 * Only the four place photographs are used. The two supplier vehicle shots are
 * "All rights reserved" in content/photo-sources.json, and a brochure handed to
 * strangers is not the place for them.
 *
 * Rendering is Chrome (or Edge) in headless mode: the fonts, photos and QR code
 * are embedded as data URIs, so the HTML renders identically with no network.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import {
  brandAsset,
  browserPath,
  dataUri,
  escapeHtml,
  fontFaces,
  projectDir,
  renderPdf,
} from './lib/print-assets.mjs';

const outputDir = process.argv[2] ?? path.join(projectDir, 'outputs', 'tour-brochure');

const locales = ['en', 'ru', 'uz', 'zh'];

/** Copy that belongs to the brochure alone; everything else comes from the catalogue. */
const brochure = {
  en: {
    region: 'Tashkent · Uzbekistan',
    coverNote: 'Tours, private rides and tickets, arranged by a local team.',
    included: 'Included',
    from: (amount) => `From ${amount}`,
    quote: 'Individual quote',
    contactTitle: 'Ask us anything',
    contactText: 'Write on WhatsApp — scan the code or save the number. We answer in English, Russian, Uzbek and Chinese.',
    scan: 'Scan to open WhatsApp',
    hours: (from, to) => `Every day, ${from}–${to} (Tashkent time)`,
    inRoom: 'Staying at a partner hotel? The QR code in your room orders all of this without an account.',
    goodToKnow: 'Good to know',
    credits: 'Photographs',
    page: (n, total) => `${n} / ${total}`,
    restaurantsNote: 'We also book restaurant tables. Just ask.',
  },
  ru: {
    region: 'Ташкент · Узбекистан',
    coverNote: 'Экскурсии, трансферы и билеты — организует местная команда.',
    included: 'Входит в цену',
    from: (amount) => `от ${amount}`,
    quote: 'Индивидуальный расчёт',
    contactTitle: 'Спрашивайте о чём угодно',
    contactText: 'Напишите в WhatsApp — отсканируйте код или сохраните номер. Отвечаем на русском, английском, узбекском и китайском.',
    scan: 'Наведите камеру — откроется WhatsApp',
    hours: (from, to) => `Ежедневно, ${from}–${to} (по Ташкенту)`,
    inRoom: 'Живёте в отеле-партнёре? QR-код в номере заказывает всё это без регистрации.',
    goodToKnow: 'Полезно знать',
    credits: 'Фотографии',
    page: (n, total) => `${n} / ${total}`,
    restaurantsNote: 'Ещё бронируем столики в ресторанах — просто спросите.',
  },
  uz: {
    region: 'Toshkent · Oʻzbekiston',
    coverNote: 'Sayohatlar, shaxsiy transport va chiptalar — mahalliy jamoa tashkil qiladi.',
    included: 'Narxga kiradi',
    from: (amount) => `${amount} dan`,
    quote: 'Alohida hisob',
    contactTitle: 'Istalgan savolni bering',
    contactText: 'WhatsApp orqali yozing — kodni skanerlang yoki raqamni saqlang. Oʻzbek, rus, ingliz va xitoy tillarida javob beramiz.',
    scan: 'Skanerlang — WhatsApp ochiladi',
    hours: (from, to) => `Har kuni, ${from}–${to} (Toshkent vaqti)`,
    inRoom: 'Hamkor mehmonxonada turibsizmi? Xonangizdagi QR kod bularning barchasini roʻyxatdan oʻtmasdan buyurtma qiladi.',
    goodToKnow: 'Bilib qoʻying',
    credits: 'Fotosuratlar',
    page: (n, total) => `${n} / ${total}`,
    restaurantsNote: 'Restoranlarda stol ham band qilamiz — soʻrangiz kifoya.',
  },
  zh: {
    region: '塔什干 · 乌兹别克斯坦',
    coverNote: '游览、专车与票务，由本地团队为您安排。',
    included: '价格包含',
    from: (amount) => `${amount} 起`,
    quote: '单独报价',
    contactTitle: '有任何问题都可以问我们',
    contactText: '通过 WhatsApp 联系我们 — 扫描二维码或保存号码。我们提供中文、英语、俄语和乌兹别克语服务。',
    scan: '扫码打开 WhatsApp',
    hours: (from, to) => `每天 ${from}–${to}（塔什干时间）`,
    inRoom: '入住合作酒店？房间内的二维码无需注册即可预订以上全部服务。',
    goodToKnow: '温馨提示',
    credits: '图片来源',
    page: (n, total) => `${n} / ${total}`,
    restaurantsNote: '我们也可以为您预订餐厅，随时告诉我们。',
  },
};

const contact = JSON.parse(readFileSync(path.join(projectDir, 'content', 'contact.json'), 'utf8'));
const photoSources = JSON.parse(readFileSync(path.join(projectDir, 'content', 'photo-sources.json'), 'utf8'));

function photo(name) {
  return dataUri(path.join(projectDir, 'public', 'catalog', `${name}-960.jpg`), 'image/jpeg');
}

/** "assets/charvak-lake.jpg" -> "charvak-lake" */
function photoName(image) {
  if (!image) return null;
  return (image.split('/').pop() ?? '').replace(/\.[a-z]+$/i, '');
}

/** Titles are sentences; strung together on the cover their full stops meet the separator. */
function titleList(offers) {
  return offers.map((offer) => offer.title.replace(/[.。]+$/, '')).join(' · ');
}

function priceLabel(offer, copy) {
  if (offer.price.mode === 'quote' || offer.price.amount === null) return copy.quote;
  const currency = offer.price.currency === 'USD' ? '$' : `${offer.price.currency ?? ''} `;
  return copy.from(`${currency}${offer.price.amount}`);
}

/** Credits for the photographs a page actually shows, in the site's own wording. */
function creditLine(names) {
  return names
    .map((name) => photoSources.photos.find((entry) => entry.name === name))
    .filter((entry) => entry && entry.licenseUrl)
    .map((entry) => `${entry.title} — ${entry.author}, ${entry.license}`)
    .join(' · ');
}

function offerCard(offer, copy) {
  const name = photoName(offer.image);
  const includes = offer.includes.slice(0, 2);
  return `
    <article class="card">
      ${name ? `<img class="card-photo" src="${photo(name)}" alt="${escapeHtml(offer.imageAlt ?? '')}">` : ''}
      <div class="card-body">
        <p class="eyebrow">${escapeHtml(offer.eyebrow)}</p>
        <h3>${escapeHtml(offer.title)}</h3>
        <p class="summary">${escapeHtml(offer.summary)}</p>
        <div class="card-foot">
          <p class="included"><span>${escapeHtml(copy.included)}</span>${includes.map((item) => `<em>${escapeHtml(item)}</em>`).join('')}</p>
          <p class="price"><strong>${escapeHtml(priceLabel(offer, copy))}</strong><span>${escapeHtml(offer.price.unit)}</span></p>
        </div>
      </div>
    </article>`;
}

function rideRow(offer, copy) {
  return `
    <article class="ride">
      <div class="ride-text">
        <p class="eyebrow">${escapeHtml(offer.eyebrow)}</p>
        <h3>${escapeHtml(offer.title)}</h3>
        <p class="summary">${escapeHtml(offer.summary)}</p>
        <ul class="facts">${offer.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul>
      </div>
      <p class="price price-block"><strong>${escapeHtml(priceLabel(offer, copy))}</strong><span>${escapeHtml(offer.price.unit)}</span></p>
    </article>`;
}

function runningHead(catalog, label, mark) {
  return `
    <header class="running">
      <span class="running-brand"><img src="${mark}" alt=""><b>Mehmon<i>Go</i></b></span>
      <span class="running-label">${escapeHtml(label)}</span>
    </header>`;
}

function pageFoot(copy, pageNumber, total, note) {
  return `
    <footer class="page-foot">
      <span>${note ? escapeHtml(note) : ''}</span>
      <span class="folio">${escapeHtml(copy.page(pageNumber, total))}</span>
    </footer>`;
}

async function buildHtml(locale) {
  const catalog = JSON.parse(readFileSync(path.join(projectDir, 'content', `catalog.${locale}.json`), 'utf8'));
  const copy = brochure[locale];
  const page = catalog.page;

  const lockupWhite = brandAsset('lockup-white.svg');
  const mark = brandAsset('mark.svg');

  const whatsappText = encodeURIComponent(copy.contactTitle);
  const qr = await QRCode.toDataURL(`https://wa.me/${contact.whatsapp}?text=${whatsappText}`, {
    margin: 0,
    width: 420,
    color: { dark: '#102B4E', light: '#FFFDFA' },
  });

  const byId = (id) => catalog.offers.find((offer) => offer.id === id);
  /** The cheapest published start in a category — what the cover promises. */
  const categoryFrom = (category) => {
    const amounts = catalog.offers
      .filter((offer) => offer.category === category && offer.price.mode === 'from' && offer.price.amount !== null)
      .map((offer) => offer.price.amount);
    return amounts.length > 0 ? copy.from(`$${Math.min(...amounts)}`) : copy.quote;
  };
  const tours = ['tashkent-private-guide', 'tashkent-mountains-base', 'tashkent-city-car', 'tashkent-samarkand-one-way']
    .map(byId).filter(Boolean);
  const rides = catalog.offers.filter((offer) => offer.category === 'transport');
  const tickets = catalog.offers.find((offer) => offer.category === 'tickets');
  const filterLabel = (id) => page.filters.find((entry) => entry.id === id)?.label ?? '';

  const contactBlock = `
    <section class="contact">
      <div>
        <p class="eyebrow eyebrow-accent">${escapeHtml(copy.contactTitle)}</p>
        <p class="contact-number">${escapeHtml(contact.phone)}</p>
        <p class="contact-text">${escapeHtml(copy.contactText)}</p>
        <p class="contact-hours">${escapeHtml(copy.hours(contact.hoursFrom, contact.hoursTo))}</p>
      </div>
      <figure class="qr">
        <img src="${qr}" alt="">
        <figcaption>${escapeHtml(copy.scan)}</figcaption>
      </figure>
    </section>`;

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>MehmonGo — ${escapeHtml(filterLabel('all'))}</title>
<style>
${fontFaces()}

@page { size: A4; margin: 0; }

:root {
  --navy: #102B4E;
  --navy-2: #163455;
  --magenta: #D3226A;
  --pink: #F56FA0;
  --ivory: #F7F3EC;
  --paper: #FFFDFA;
  --line: #E5DED2;
  --muted: #5E6A7C;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Geist', ${locale === 'zh' ? `'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', ` : ''}system-ui, sans-serif;
  color: var(--navy);
  background: var(--ivory);
  -webkit-font-smoothing: antialiased;
}

.page {
  width: 210mm;
  height: 297mm;
  padding: 14mm 15mm 11mm;
  position: relative;
  overflow: hidden;
  background: var(--ivory);
  display: flex;
  flex-direction: column;
  page-break-after: always;
}
.page:last-child { page-break-after: auto; }

/* ---------- cover ---------- */
.cover {
  background: var(--navy);
  color: var(--paper);
  padding: 18mm 15mm 13mm;
  justify-content: space-between;
}
.cover::before {
  content: '';
  position: absolute;
  width: 250mm; height: 250mm;
  border: 30mm solid rgba(245, 111, 160, .09);
  border-radius: 50%;
  top: -105mm; right: -118mm;
}
.cover > * { position: relative; }
.cover-lockup { width: 62mm; display: block; }
.cover-title {
  margin-top: 9mm;
  font-size: ${locale === 'zh' ? '46px' : '54px'};
  line-height: ${locale === 'zh' ? '1.18' : '1.02'};
  letter-spacing: ${locale === 'zh' ? '0' : '-.045em'};
  font-weight: 800;
  max-width: 150mm;
  text-wrap: balance;
}
.cover-intro {
  margin-top: 7mm;
  max-width: 132mm;
  font-size: 15px;
  line-height: 1.62;
  color: rgba(255, 253, 250, .82);
}
.cover-note { margin-top: 3mm; font-size: 14px; color: var(--pink); font-weight: 600; }
.trust { display: flex; flex-wrap: wrap; gap: 4mm 9mm; margin-top: 8mm; list-style: none; }
.trust li { font-size: 13px; font-weight: 500; color: rgba(255, 253, 250, .9); }
.trust li::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--pink); margin-right: 7px; vertical-align: middle; }

/* What is inside, priced: the first thing a tourist wants off a cover. */
.menu { margin-top: 12mm; border-top: 1px solid rgba(255, 253, 250, .22); }
.menu-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 8mm;
  padding: 4.5mm 0;
  border-bottom: 1px solid rgba(255, 253, 250, .22);
}
.menu-row b { font-size: 17px; font-weight: 700; letter-spacing: ${locale === 'zh' ? '0' : '-.02em'}; }
.menu-row i { display: block; margin-top: 1.5mm; font-style: normal; font-size: 11.5px; color: rgba(255, 253, 250, .62); }
.menu-price { font-size: 17px; font-weight: 800; color: var(--pink); font-variant-numeric: tabular-nums; white-space: nowrap; }

.cover-contact {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 10mm;
  padding: 8mm;
  border: 1px solid rgba(255, 253, 250, .22);
  border-radius: 6mm;
  background: rgba(255, 253, 250, .04);
}
.cover-contact .contact-number { font-size: 27px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.cover-contact .contact-text { margin-top: 3mm; font-size: 12.5px; line-height: 1.55; color: rgba(255, 253, 250, .78); max-width: 105mm; }
.cover-contact .contact-hours { margin-top: 2mm; font-size: 12.5px; color: var(--pink); font-weight: 600; }
.cover-contact .eyebrow { color: var(--pink); }
.cover-contact .qr img { width: 30mm; height: 30mm; display: block; border-radius: 3mm; background: var(--paper); padding: 2.5mm; }
.cover-contact .qr figcaption { margin-top: 2.5mm; font-size: 10px; text-align: center; color: rgba(255, 253, 250, .7); max-width: 35mm; line-height: 1.35; }

/* ---------- running head and foot ---------- */
.running {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 4mm;
  border-bottom: 1px solid var(--line);
}
.running-brand { display: inline-flex; align-items: center; gap: 2.5mm; font-size: 15px; font-weight: 800; letter-spacing: -.03em; }
.running-brand img { width: 9mm; }
.running-brand i { color: var(--magenta); font-style: normal; }
.running-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--muted); }

.page-foot {
  margin-top: auto;
  padding-top: 4mm;
  border-top: 1px solid var(--line);
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8mm;
  font-size: 9.5px;
  line-height: 1.5;
  color: var(--muted);
}
.folio { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ---------- section heads ---------- */
.section-head { margin: 5mm 0 4mm; }
.section-head h2 {
  font-size: ${locale === 'zh' ? '27px' : '30px'};
  font-weight: 800;
  letter-spacing: ${locale === 'zh' ? '0' : '-.035em'};
  line-height: 1.1;
}
.section-head p { margin-top: 2mm; font-size: 13px; color: var(--muted); }

.eyebrow {
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .13em;
  color: var(--magenta);
}
.eyebrow-accent { margin-bottom: 2.5mm; }

/* ---------- offer cards ---------- */
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
.card {
  border: 1px solid var(--line);
  border-radius: 5mm;
  background: var(--paper);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.card-photo { width: 100%; height: 33mm; object-fit: cover; display: block; }
.card-body { padding: 4.5mm 4.5mm 5mm; display: flex; flex-direction: column; flex: 1; }
.card-body h3 {
  margin-top: 2mm;
  font-size: ${locale === 'zh' ? '16px' : '17px'};
  font-weight: 800;
  letter-spacing: ${locale === 'zh' ? '0' : '-.02em'};
  line-height: 1.2;
}
.summary {
  margin-top: 2.5mm;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-foot { margin-top: auto; padding-top: 3.5mm; }
.included { font-size: 10.5px; line-height: 1.45; color: var(--navy-2); }
.included span {
  display: block;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .11em;
  color: var(--muted);
  margin-bottom: 1.5mm;
}
.included em { display: block; font-style: normal; }
.included em::before { content: '—'; color: var(--magenta); margin-right: 5px; }
.price { margin-top: 3.5mm; padding-top: 2.5mm; border-top: 1px solid var(--line); }
.price strong { display: block; font-size: 19px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.price span { display: block; margin-top: 1mm; font-size: 10px; color: var(--muted); }

/* ---------- ride rows ---------- */
.rides { display: grid; gap: 4mm; }
.ride {
  display: grid;
  grid-template-columns: 1fr 42mm;
  gap: 8mm;
  align-items: center;
  padding: 4.5mm 5mm;
  border: 1px solid var(--line);
  border-radius: 5mm;
  background: var(--paper);
}
.ride h3 { margin-top: 1.5mm; font-size: 16px; font-weight: 800; letter-spacing: ${locale === 'zh' ? '0' : '-.02em'}; }
.ride .summary { -webkit-line-clamp: 2; }
.facts { list-style: none; display: flex; flex-wrap: wrap; gap: 1.5mm 5mm; margin-top: 3mm; }
.facts li { font-size: 10.5px; color: var(--navy-2); }
.facts li::before { content: '•'; color: var(--magenta); margin-right: 5px; }
.price-block { margin: 0; padding: 0; border: 0; text-align: right; }
.price-block strong { font-size: 22px; }
/* A quote is words, not a figure: at the price size it shouts and wraps badly. */
.price-quote strong { font-size: 14px; line-height: 1.3; letter-spacing: 0; }

.aside {
  margin-top: 4mm;
  padding: 4.5mm 5mm;
  border: 1px dashed var(--line);
  border-radius: 5mm;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--navy-2);
}
.aside b { display: block; font-size: 13px; margin-bottom: 1.5mm; }

.notes { margin-top: 4mm; display: grid; gap: 2mm; font-size: 10px; line-height: 1.55; color: var(--muted); }

/* ---------- steps and questions ---------- */
.steps { counter-reset: step; display: grid; gap: 3.5mm; margin-top: 1mm; }
.steps li { counter-increment: step; list-style: none; display: grid; grid-template-columns: 9mm 1fr; gap: 4mm; align-items: start; }
.steps li::before {
  content: counter(step);
  display: grid;
  place-items: center;
  width: 9mm; height: 9mm;
  border-radius: 50%;
  background: var(--navy);
  color: var(--paper);
  font-size: 13px;
  font-weight: 700;
}
.steps b { display: block; font-size: 14px; font-weight: 700; }
.steps span { display: block; margin-top: 1mm; font-size: 11.5px; line-height: 1.55; color: var(--muted); }

.faq { display: grid; gap: 3mm; margin-top: 1mm; }
.faq div { padding: 4mm 4.5mm; border: 1px solid var(--line); border-radius: 4mm; background: var(--paper); }
.faq dt { font-size: 12.5px; font-weight: 700; }
.faq dd { margin-top: 1.5mm; font-size: 11px; line-height: 1.55; color: var(--muted); }

.contact {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 9mm;
  align-items: center;
  margin-top: 5mm;
  padding: 6mm;
  border-radius: 5mm;
  background: var(--navy);
  color: var(--paper);
}
.contact .eyebrow { color: var(--pink); }
.contact .contact-number { font-size: 25px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.contact .contact-text { margin-top: 2.5mm; font-size: 11.5px; line-height: 1.55; color: rgba(255, 253, 250, .78); max-width: 100mm; }
.contact .contact-hours { margin-top: 2mm; font-size: 11.5px; font-weight: 600; color: var(--pink); }
.contact .qr img { width: 27mm; height: 27mm; display: block; border-radius: 3mm; background: var(--paper); padding: 2.5mm; }
.contact .qr figcaption { margin-top: 2mm; font-size: 9.5px; text-align: center; color: rgba(255, 253, 250, .7); max-width: 32mm; line-height: 1.35; }
</style>
</head>
<body>

<section class="page cover">
  <div>
    <img class="cover-lockup" src="${lockupWhite}" alt="MehmonGo">
    <p class="cover-note" style="margin-top:8mm">${escapeHtml(copy.region)}</p>
    <h1 class="cover-title">${escapeHtml(page.title)}</h1>
    <p class="cover-intro">${escapeHtml(page.intro)}</p>
    <p class="cover-note">${escapeHtml(copy.coverNote)}</p>
    <ul class="trust">${page.trustItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>

    <div class="menu">
      <div class="menu-row">
        <div><b>${escapeHtml(filterLabel('tours'))}</b><i>${escapeHtml(titleList(tours))}</i></div>
        <span class="menu-price">${escapeHtml(categoryFrom('tours'))}</span>
      </div>
      <div class="menu-row">
        <div><b>${escapeHtml(filterLabel('transport'))}</b><i>${escapeHtml(titleList(rides))}</i></div>
        <span class="menu-price">${escapeHtml(categoryFrom('transport'))}</span>
      </div>
      <div class="menu-row">
        <div><b>${escapeHtml(filterLabel('tickets'))}</b><i>${escapeHtml(tickets ? tickets.summary : '')}</i></div>
        <span class="menu-price">${escapeHtml(copy.quote)}</span>
      </div>
    </div>
  </div>

  <section class="cover-contact">
    <div>
      <p class="eyebrow">${escapeHtml(copy.contactTitle)}</p>
      <p class="contact-number">${escapeHtml(contact.phone)}</p>
      <p class="contact-text">${escapeHtml(copy.contactText)}</p>
      <p class="contact-hours">${escapeHtml(copy.hours(contact.hoursFrom, contact.hoursTo))}</p>
    </div>
    <figure class="qr">
      <img src="${qr}" alt="">
      <figcaption>${escapeHtml(copy.scan)}</figcaption>
    </figure>
  </section>
</section>

<section class="page">
  ${runningHead(catalog, filterLabel('tours'), mark)}
  <div class="section-head">
    <h2>${escapeHtml(filterLabel('tours'))}</h2>
    <p>${escapeHtml(page.sectionIntro)}</p>
  </div>
  <div class="grid">${tours.map((offer) => offerCard(offer, copy)).join('')}</div>
  ${pageFoot(copy, 2, 4, creditLine(tours.map((offer) => photoName(offer.image)).filter(Boolean)))}
</section>

<section class="page">
  ${runningHead(catalog, filterLabel('transport'), mark)}
  <div class="section-head">
    <h2>${escapeHtml(filterLabel('transport'))}</h2>
  </div>
  <div class="rides">${rides.map((offer) => rideRow(offer, copy)).join('')}</div>

  ${tickets ? `
  <div class="section-head">
    <h2>${escapeHtml(filterLabel('tickets'))}</h2>
  </div>
  <article class="ride">
    <div class="ride-text">
      <p class="eyebrow">${escapeHtml(tickets.eyebrow)}</p>
      <h3>${escapeHtml(tickets.title)}</h3>
      <p class="summary">${escapeHtml(tickets.summary)}</p>
      <ul class="facts">${tickets.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul>
    </div>
    <p class="price price-block price-quote"><strong>${escapeHtml(copy.quote)}</strong><span>${escapeHtml(tickets.price.unit)}</span></p>
  </article>` : ''}

  <div class="aside">
    <b>${escapeHtml(page.restaurantTitle)}</b>
    ${escapeHtml(copy.restaurantsNote)}
  </div>

  <div class="notes">
    <p>${escapeHtml(page.priceNote)}</p>
    <p>${escapeHtml(page.paymentNote)}</p>
  </div>
  ${pageFoot(copy, 3, 4, '')}
</section>

<section class="page">
  ${runningHead(catalog, page.stepsTitle, mark)}
  <div class="section-head">
    <h2>${escapeHtml(page.stepsTitle)}</h2>
  </div>
  <ol class="steps">${page.steps.map((step) => `<li><div><b>${escapeHtml(step.title)}</b><span>${escapeHtml(step.text)}</span></div></li>`).join('')}</ol>

  <div class="section-head">
    <h2>${escapeHtml(copy.goodToKnow)}</h2>
  </div>
  <dl class="faq">${catalog.faq.map((entry) => `<div><dt>${escapeHtml(entry.question)}</dt><dd>${escapeHtml(entry.answer)}</dd></div>`).join('')}</dl>

  <div class="aside">${escapeHtml(copy.inRoom)}</div>

  ${contactBlock}
  ${pageFoot(copy, 4, 4, `${copy.credits}: ${creditLine(['charvak-lake', 'samarkand-registan-square'])}`)}
</section>

</body>
</html>`;
}

/** Named so the folder reads without this script open, as the logo folder does. */
function readme() {
  return `БУКЛЕТ MEHMONGO ДЛЯ ТУРИСТОВ
============================

ЧТО ГДЕ

  MehmonGo-tours-en.pdf   Английский
  MehmonGo-tours-ru.pdf   Русский
  MehmonGo-tours-uz.pdf   Узбекский
  MehmonGo-tours-zh.pdf   Китайский

  4 страницы A4: обложка с ценами «от», экскурсии, трансферы и билеты,
  как это работает и ответы на частые вопросы. На обложке и в конце —
  QR-код: турист наводит камеру, открывается WhatsApp на ${contact.phone}.

  Папка html/ — те же буклеты страницей в браузере. Удобно показать
  на экране: листается легче, чем PDF, и работает без интернета.

КАК ПОКАЗЫВАТЬ

  Спросите, на каком языке турист говорит, и отправьте нужный файл
  в WhatsApp или Telegram. Печатать не обязательно, но если печатаете —
  A4, без полей, двусторонняя печать даёт аккуратный разворот.

ЦЕНЫ

  Все цены — стартовые, те же, что на сайте: буклет собирается из того
  же файла каталога. Отдельно менять цены в буклете не нужно и нельзя.

КАК ПЕРЕСОБРАТЬ ПОСЛЕ ИЗМЕНЕНИЯ ЦЕН

  Измените content/catalog.<язык>.json в проекте mehmongo-guest-services
  и выполните:

    npm run brochure

  Файлы в этой папке перезапишутся. Телефон и часы ответа берутся из
  content/contact.json.

ФОТОГРАФИИ

  Две фотографии — Чарвак и Регистан — чужие, под лицензиями Creative
  Commons, поэтому внизу второй страницы стоит подпись с авторами. Её
  убирать нельзя. Фотографии машин от поставщика в буклет не вошли —
  они «все права защищены» и для раздачи посторонним не годятся.
`;
}

async function main() {
  const htmlDir = path.join(outputDir, 'html');
  mkdirSync(htmlDir, { recursive: true });
  const browser = browserPath();

  for (const locale of locales) {
    const html = await buildHtml(locale);
    const htmlPath = path.join(htmlDir, `mehmongo-tours-${locale}.html`);
    const pdfPath = path.join(outputDir, `MehmonGo-tours-${locale}.pdf`);
    writeFileSync(htmlPath, html, 'utf8');

    renderPdf(browser, htmlPath, pdfPath);
    console.log(`${path.basename(pdfPath)} written`);
  }

  writeFileSync(path.join(outputDir, 'ЧИТАТЬ.txt'), readme(), 'utf8');
  console.log(`ЧИТАТЬ.txt written into ${outputDir}`);
}

await main();
