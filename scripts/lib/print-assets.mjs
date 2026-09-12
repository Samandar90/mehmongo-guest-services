/**
 * Shared plumbing for the printed pieces (the tour brochure and the route
 * sheets): the brand's own Geist faces inlined, the logo files, and the
 * headless browser that turns one HTML file into one PDF.
 *
 * Both pieces embed everything as data URIs, so a PDF renders identically on
 * a machine with no network and no fonts installed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/** The owner keeps the logo beside the repository, as the logo readme describes. */
export const brandDir = path.join(projectDir, '..', 'MehmonGo-логотип');

export function dataUri(filePath, mediaType) {
  return `data:${mediaType};base64,${readFileSync(filePath).toString('base64')}`;
}

export function brandAsset(name, mediaType = 'image/svg+xml') {
  return dataUri(path.join(brandDir, name), mediaType);
}

/**
 * The Geist faces the site already downloaded, inlined. The split by
 * unicode-range is kept, so Cyrillic comes from the Cyrillic file exactly as
 * it does in the browser.
 */
export function fontFaces() {
  const cssPath = path.join(projectDir, '.vinext', 'fonts', 'geist-8ac0455e797f', 'style.css');
  if (!existsSync(cssPath)) {
    throw new Error(`Geist not found at ${cssPath}. Run "npm run build" once to fetch it.`);
  }
  return readFileSync(cssPath, 'utf8').replace(/url\(([^)]+)\)/g, (match, url) => {
    const file = url.trim().replace(/^['"]|['"]$/g, '');
    return existsSync(file) ? `url(${dataUri(file, 'font/woff2')})` : match;
  });
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function browserPath() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Neither Chrome nor Edge was found; one of them renders the PDF.');
  return found;
}

/** The page box comes from the document's own @page rule, so no header or footer is added. */
export function renderPdf(browser, htmlPath, pdfPath) {
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    '--virtual-time-budget=20000',
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.replaceAll('\\', '/')}`,
  ], { stdio: 'ignore' });
}

/**
 * The A4 page box, the brand palette and the type rules both pieces share.
 * Anything that belongs to one piece alone stays in that piece's own script.
 */
export function baseCss(locale) {
  const cjk = locale === 'zh' ? `'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', ` : '';
  return `
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
  font-family: 'Geist', ${cjk}system-ui, sans-serif;
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

.eyebrow {
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .13em;
  color: var(--magenta);
}

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
`;
}
