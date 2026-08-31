# MehmonGo A5 Room Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate print-ready MehmonGo A5 room plaques with unique guest-site QR codes as PNG, individual PDF, multi-page hotel PDF, and ZIP downloads from the super-admin.

**Architecture:** A pure TypeScript template builds the approved 1748×2480 SVG for each room. The authenticated browser rasterizes it to a 300 DPI PNG, `pdf-lib` places each PNG on an exact A5 page, and JSZip packages individual files; generated assets are downloaded on demand and are not persisted.

**Tech Stack:** React 19, TypeScript 5.9, Vitest 4, TSX 4.23.13, QRCode 1.5.4, jsQR 1.4.0, `pdf-lib` 1.17.1, JSZip 3.10.1, browser Canvas/Blob APIs.

**Spec:** `docs/superpowers/specs/2026-08-31-mehmongo-request-admin-design.md`

## Global Constraints

- Execute after `2026-08-31-mehmongo-super-admin-implementation.md` Task 5.
- Every QR points to `${SITE_URL}/r/<room_token>`.
- Every generated page uses the approved MehmonGo colors `#102B4E`, `#D3226A`, and `#F7F3EC`.
- A5 portrait output is 148×210 mm; raster output is 1748×2480 pixels at 300 DPI.
- One room equals one A5 page.
- Room labels and hotel names are XML-escaped before SVG insertion.
- Output filenames are sanitized but displayed labels remain unchanged.
- Generation occurs only after admin authentication and uses no server secret.
- The existing room-205 plaque remains a visual regression reference.
- Pin added packages and commit `package-lock.json`.

---

## File Structure

- `lib/assets/room-plaque.ts` — URL, filename, and SVG template generation.
- `lib/assets/qr.ts` — QR creation and verification helpers.
- `lib/assets/rasterize.ts` — browser SVG-to-PNG conversion.
- `lib/assets/pdf.ts` — individual and multi-page A5 documents.
- `lib/assets/zip.ts` — ZIP construction and deterministic filenames.
- `lib/assets/download.ts` — Blob download helper with URL cleanup.
- `components/admin/asset-generator.tsx` — selection, progress, preview, and downloads.
- `app/admin/hotels/[id]/page.tsx` — embeds the generator under the room editor.
- `public/mehmongo-mark.svg` — existing approved mark reused by the template.
- `artifacts/mehmongo-room-205-plaque.png` — existing visual reference.

---

### Task 1: Pin asset dependencies and extract a pure plaque template

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/assets/room-plaque.ts`
- Test: `lib/assets/room-plaque.test.ts`
- Rename: `scripts/build-room-plaque.mjs` → `scripts/build-room-plaque.ts`

**Interfaces:**
- Produces: `RoomAssetInput = { hotelSlug; hotelName; roomLabel; roomToken; siteUrl }`.
- Produces: `buildGuestRoomUrl(input): string`.
- Produces: `buildRoomPlaqueSvg(input, qrDataUrl): string`.
- Produces: `roomAssetBaseName(input): string`.

- [ ] **Step 1: Write failing pure-template tests**

```ts
it('builds the opaque guest route', () => {
  expect(buildGuestRoomUrl(fixture)).toBe('https://example.com/r/4c5f9a10-1111-4222-8333-abcdefabcdef');
});

it('escapes hotel and room text in SVG', () => {
  const svg = buildRoomPlaqueSvg({ ...fixture, hotelName: 'A & B <Hotel>', roomLabel: 'A/1' }, QR_DATA_URL);
  expect(svg).toContain('A &amp; B &lt;Hotel&gt;');
  expect(svg).not.toContain('A & B <Hotel>');
});

it('creates filesystem-safe stable names', () => {
  expect(roomAssetBaseName({ ...fixture, roomLabel: 'Villa 3 / East' })).toBe('kamilovs-room-villa-3-east');
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run lib/assets/room-plaque.test.ts`
Expected: FAIL because the module is absent.

- [ ] **Step 3: Install pinned packages**

```powershell
npm install --save-exact pdf-lib@1.17.1 jszip@3.10.1
npm install --save-dev --save-exact tsx@4.23.13
```

- [ ] **Step 4: Implement the pure template**

Move the approved A5 SVG markup from `scripts/build-room-plaque.mjs` into `buildRoomPlaqueSvg`. Preserve exact canvas size, logo placement, room badge, headline, QR quiet zone, service labels, instruction, and footer. Use a deterministic XML escape helper:

```ts
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
```

- [ ] **Step 5: Make the existing script consume the shared template**

Rename the script to TypeScript, import the shared functions directly, and change the package script to `tsx scripts/build-room-plaque.ts`. Do not keep a second SVG copy. The command must still support the existing `npm run plaque -- <site-url>` workflow for room 205.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm test -- --run lib/assets/room-plaque.test.ts
npm run plaque -- "https://mehmongo-guest-services.xurshidaoldcity.chatgpt.site"
npm run lint
```

Expected: template tests pass, the existing plaque regenerates, and lint exits 0.

```powershell
git add package.json package-lock.json lib/assets/room-plaque* scripts/build-room-plaque.ts scripts/build-room-plaque.mjs artifacts
git commit -m "refactor: share the MehmonGo room plaque template"
```

---

### Task 2: Generate and programmatically verify room QR codes

**Files:**
- Create: `lib/assets/qr.ts`
- Test: `lib/assets/qr.test.ts`

**Interfaces:**
- Produces: `createRoomQrDataUrl(url: string): Promise<string>`.
- Produces: `decodeQrPng(dataUrl: string): Promise<string>` for test/verification use.

- [ ] **Step 1: Write failing QR tests**

```ts
it('encodes the exact room URL at high error correction', async () => {
  const url = 'https://example.com/r/4c5f9a10-1111-4222-8333-abcdefabcdef';
  const dataUrl = await createRoomQrDataUrl(url);
  await expect(decodeQrPng(dataUrl)).resolves.toBe(url);
});

it('rejects non-HTTPS production URLs', async () => {
  await expect(createRoomQrDataUrl('javascript:alert(1)')).rejects.toThrow('Invalid guest room URL');
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run lib/assets/qr.test.ts`
Expected: FAIL because QR module is absent.

- [ ] **Step 3: Implement QR generation**

```ts
export async function createRoomQrDataUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') throw new Error('Invalid guest room URL');
  return QRCode.toDataURL(parsed.toString(), { errorCorrectionLevel: 'H', width: 1024, margin: 4, color: { dark: '#102B4E', light: '#FFFFFF' } });
}
```

Test decoding converts the data URL to RGBA pixels and passes them to jsQR. Production code must not decode every QR unless the administrator explicitly runs verification.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --run lib/assets/qr.test.ts`
Expected: exact URL round-trip passes.

```powershell
git add lib/assets/qr*
git commit -m "feat: generate verified room QR codes"
```

---

### Task 3: Rasterize the A5 SVG to a print-resolution PNG

**Files:**
- Create: `lib/assets/rasterize.ts`
- Test: `lib/assets/rasterize.test.ts`
- Create: `lib/assets/download.ts`
- Test: `lib/assets/download.test.ts`

**Interfaces:**
- Produces: `svgToPngBlob(svg: string, width = 1748, height = 2480): Promise<Blob>`.
- Produces: `downloadBlob(blob: Blob, filename: string): void`.

- [ ] **Step 1: Write failing rasterizer tests with injected browser adapters**

```ts
it('renders at exact 300 DPI pixel dimensions', async () => {
  const adapter = fakeCanvasAdapter();
  await svgToPngBlob('<svg width="1748" height="2480"/>', 1748, 2480, adapter);
  expect(adapter.canvas.width).toBe(1748);
  expect(adapter.canvas.height).toBe(2480);
  expect(adapter.drawImage).toHaveBeenCalled();
});

it('revokes temporary download URL', () => {
  downloadBlob(new Blob(['x']), 'room.png', browserAdapter);
  expect(browserAdapter.revokeObjectURL).toHaveBeenCalledWith('blob:test');
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run lib/assets/rasterize.test.ts lib/assets/download.test.ts`
Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement browser-safe rasterization**

Create an SVG Blob, object URL, and `Image`; draw after load to a canvas with a white background, export `image/png`, and revoke the object URL in `finally`. Reject null canvas context, image load failure, and null `toBlob` result with stable error codes.

- [ ] **Step 4: Implement safe downloads**

Append a temporary `<a download>`, click it, remove it, and revoke the URL in a queued microtask so Safari/Chromium can start the download.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run lib/assets/rasterize.test.ts lib/assets/download.test.ts && npm run lint`
Expected: raster and cleanup tests pass; lint exits 0.

```powershell
git add lib/assets/rasterize* lib/assets/download*
git commit -m "feat: render print-ready room plaque PNGs"
```

---

### Task 4: Build individual and multi-page A5 PDFs

**Files:**
- Create: `lib/assets/pdf.ts`
- Test: `lib/assets/pdf.test.ts`

**Interfaces:**
- Produces: `A5_WIDTH_PT = 419.527559` and `A5_HEIGHT_PT = 595.275591`.
- Produces: `buildRoomPdf(png: Uint8Array): Promise<Uint8Array>`.
- Produces: `buildHotelPdf(pages: Array<{ label: string; png: Uint8Array }>): Promise<Uint8Array>`.

- [ ] **Step 1: Write failing PDF tests**

```ts
it('creates one exact A5 portrait page', async () => {
  const bytes = await buildRoomPdf(PNG_FIXTURE);
  const document = await PDFDocument.load(bytes);
  expect(document.getPageCount()).toBe(1);
  expect(document.getPage(0).getSize()).toEqual({ width: A5_WIDTH_PT, height: A5_HEIGHT_PT });
});

it('creates one page per room in input order', async () => {
  const bytes = await buildHotelPdf([{ label: '205', png: PNG_FIXTURE }, { label: '206', png: PNG_FIXTURE }]);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run lib/assets/pdf.test.ts`
Expected: FAIL because PDF module is absent.

- [ ] **Step 3: Implement exact A5 documents**

Create PDF pages at the point dimensions above, embed each PNG once, and draw it at `x: 0, y: 0, width: A5_WIDTH_PT, height: A5_HEIGHT_PT`. Reject empty multi-page input with `No rooms selected`.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --run lib/assets/pdf.test.ts`
Expected: dimensions and page counts pass.

```powershell
git add lib/assets/pdf*
git commit -m "feat: create A5 room plaque PDFs"
```

---

### Task 5: Package individual PNG/PDF assets into ZIP

**Files:**
- Create: `lib/assets/zip.ts`
- Test: `lib/assets/zip.test.ts`

**Interfaces:**
- Produces: `buildHotelAssetZip(assets: RoomGeneratedAsset[]): Promise<Blob>`.
- `RoomGeneratedAsset = { baseName: string; png: Blob; pdf: Uint8Array }`.

- [ ] **Step 1: Write failing ZIP tests**

```ts
it('contains one PNG and PDF per room', async () => {
  const blob = await buildHotelAssetZip([room205, room206]);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  expect(Object.keys(zip.files).sort()).toEqual([
    'kamilovs-room-205.pdf', 'kamilovs-room-205.png',
    'kamilovs-room-206.pdf', 'kamilovs-room-206.png',
  ]);
});
```

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run lib/assets/zip.test.ts`
Expected: FAIL because ZIP module is absent.

- [ ] **Step 3: Implement deterministic ZIP creation**

Reject duplicate basenames, sort assets by basename, add exact `.png` and `.pdf` names, use DEFLATE compression, and return `type: 'blob'`.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- --run lib/assets/zip.test.ts`
Expected: ZIP content test passes.

```powershell
git add lib/assets/zip*
git commit -m "feat: package hotel room assets"
```

---

### Task 6: Add the admin asset generator and progress UX

**Files:**
- Create: `components/admin/asset-generator.tsx`
- Test: `components/admin/asset-generator.test.tsx`
- Modify: `components/admin/room-editor.tsx`
- Modify: `app/admin/hotels/[id]/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes selected active `Room[]`, `Hotel`, template/QR/raster/PDF/ZIP functions.
- Produces preview, individual downloads, combined PDF, ZIP, and QR verification result.

- [ ] **Step 1: Write failing component tests**

```ts
it('disables generation when no active rooms are selected', () => {
  renderAssetGenerator({ rooms: [] });
  expect(screen.getByRole('button', { name: 'Создать материалы' })).toBeDisabled();
});

it('shows room-by-room progress', async () => {
  const generateRoom = controlledRoomGenerator();
  renderAssetGenerator({ rooms: [room205, room206], generateRoom });
  await userEvent.click(screen.getByRole('button', { name: 'Создать материалы' }));
  generateRoom.resolveNext(asset205);
  expect(await screen.findByText('1 из 2')).toBeInTheDocument();
  generateRoom.resolveNext(asset206);
  expect(await screen.findByText('2 из 2')).toBeInTheDocument();
});

it('downloads an individual PNG and PDF', async () => {
  const downloadBlob = vi.fn();
  renderAssetGenerator({ rooms: [room205], generated: [asset205], downloadBlob });
  await userEvent.click(screen.getByRole('button', { name: 'Скачать PNG 205' }));
  await userEvent.click(screen.getByRole('button', { name: 'Скачать PDF 205' }));
  expect(downloadBlob).toHaveBeenNthCalledWith(1, asset205.png, 'kamilovs-room-205.png');
  expect(downloadBlob).toHaveBeenNthCalledWith(2, expect.any(Blob), 'kamilovs-room-205.pdf');
});

it('downloads combined PDF and ZIP for selected rooms', async () => {
  const downloadBlob = vi.fn();
  renderAssetGenerator({ rooms: [room205, room206], generated: [asset205, asset206], downloadBlob });
  await userEvent.click(screen.getByRole('button', { name: 'Общий PDF' }));
  await userEvent.click(screen.getByRole('button', { name: 'Скачать ZIP' }));
  expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'kamilovs-all-rooms-a5.pdf');
  expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'kamilovs-room-assets.zip');
});

it('reports the failing room and produces no partial combined download', async () => {
  const downloadBlob = vi.fn();
  renderAssetGenerator({ rooms: [room205, room206], generateRoom: rejectingRoomGenerator('206'), downloadBlob });
  await userEvent.click(screen.getByRole('button', { name: 'Создать материалы' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать материалы для комнаты 206');
  expect(screen.getByRole('button', { name: 'Общий PDF' })).toBeDisabled();
  expect(downloadBlob).not.toHaveBeenCalled();
});
```

Define `renderAssetGenerator`, room fixtures, generated asset fixtures, and controlled generator helpers in the same test file with fully typed dependency injection.

- [ ] **Step 2: Confirm RED**

Run: `npm test -- --run components/admin/asset-generator.test.tsx`
Expected: FAIL because generator is absent.

- [ ] **Step 3: Implement sequential bounded generation**

Generate one room at a time to cap memory. For each room: build URL, create QR, build SVG, rasterize PNG, build individual PDF, update progress. Keep completed assets in memory only until download or reset. If any room fails, show its label, keep selection, and require a fresh retry before combined files are enabled.

- [ ] **Step 4: Implement preview and download controls**

Russian controls: `Предпросмотр`, `Скачать PNG`, `Скачать PDF`, `Общий PDF`, `Скачать ZIP`, `Проверить QR`. Preview uses the generated Blob URL and revokes the previous URL on change/unmount.

- [ ] **Step 5: Integrate with room selection**

The room editor owns selected IDs; disabled rooms cannot be selected. Pass selected room objects and hotel to `AssetGenerator` below the list.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm test -- --run components/admin/asset-generator.test.tsx components/admin/room-editor.test.tsx
npm run lint
npm run build
```

Expected: UI tests, lint, and build pass.

```powershell
git add components/admin/asset-generator* components/admin/room-editor.tsx app/admin/hotels/[id]/page.tsx app/globals.css
git commit -m "feat: generate room assets from the super admin"
```

---

### Task 7: Run print, visual, QR, and full-product verification

**Files:**
- Create: `scripts/verify-room-assets.mjs`
- Create: `docs/operations/a5-print-checklist.md`
- Update generated test artifacts only under ignored `outputs/`.

**Interfaces:**
- Consumes a generated hotel PDF, ZIP, and room manifest JSON.
- Produces exit 0 only when page count, A5 size, filenames, and every decoded QR are correct.

- [ ] **Step 1: Write the verifier against intentionally invalid fixtures**

The script must fail separately for wrong PDF page count, non-A5 page size, missing ZIP member, duplicate filename, undecodable QR, and decoded URL mismatch. Use explicit nonzero exit codes and room labels in errors.

- [ ] **Step 2: Generate Kamilovs 205 and 206 test assets**

Use local seeded rooms and the production-format site URL. Store files in `outputs/a5-verification/`, which remains ignored.

- [ ] **Step 3: Run automated artifact verification**

Run:

```powershell
node scripts/verify-room-assets.mjs outputs/a5-verification/manifest.json
```

Expected: exit 0, two A5 pages, four ZIP members, and two exact `/r/<token>` QR matches.

- [ ] **Step 4: Perform visual QA**

Render both PDF pages to PNG and inspect at original resolution. Confirm logo, hotel name, room badge, headline, QR quiet zone, four service labels, instruction, footer, safe margins, no overlap, and no clipping. Compare room 205 against `artifacts/mehmongo-room-205-plaque.png`.

- [ ] **Step 5: Write the print checklist**

Record A5 portrait, 100% scale, no fit-to-page, color mode, recommended paper weight, 300 DPI source, and a required physical phone scan before hotel rollout.

- [ ] **Step 6: Run the complete project gate**

Run:

```powershell
npm test -- --run
npm run lint
npm run build
npm audit --omit=dev
npm run supabase:test
npm run functions:test -- supabase/functions
node scripts/verify-room-assets.mjs outputs/a5-verification/manifest.json
git status --short
```

Expected: every test and verifier passes, lint/build exit 0, audit reports 0 production vulnerabilities, and only intended documentation/script changes are uncommitted.

- [ ] **Step 7: Commit**

```powershell
git add scripts/verify-room-assets.mjs docs/operations/a5-print-checklist.md
git commit -m "test: verify MehmonGo A5 room assets"
git push origin main
```
