# A5 room plaque print checklist

Use this before any batch of MehmonGo room plaques goes to a hotel. The files come from the super admin (`/admin/hotels/<id>` → «Материалы для печати») or, for verification runs, from `npm run assets:generate`.

## Source files

- One page per room, generated from the approved template in `lib/assets/room-plaque.ts`.
- Raster source: PNG 1748 × 2480 px, 300 DPI, sRGB, white background.
- PDF: exact A5 portrait, 148 × 210 mm (419.53 × 595.28 pt), image placed edge to edge, no bleed.
- Every QR encodes `<site origin>/r/<room token>` with error correction level H and a four-module quiet zone. The origin is `VITE_SITE_URL` at build time; it must equal the deployed guest site.

## Before printing

1. Run the automated check on the exact files you will send:

   ```bash
   node scripts/verify-room-assets.mjs outputs/a5-verification/manifest.json
   ```

   Exit 0 means page count, A5 page size, ZIP members and every decoded QR are correct. Any other exit code names the room and the defect.
2. Open the combined PDF and confirm each page shows: MehmonGo mark and wordmark, the hotel name in the footer, the room badge at the top right, the headline, the QR inside its white card, the four service labels, the instruction line. Nothing may overlap the safe margin of about 6 mm.
3. Compare one page against `artifacts/mehmongo-room-205-plaque.png` (visual reference). Colors must be navy `#102B4E`, magenta `#D3226A`, warm `#F7F3EC`.

## Printer settings

- Paper size: A5 portrait (148 × 210 mm). Do not print A5 content scaled onto A4.
- Scale: 100 % / «Actual size». Never «Fit to page» or «Shrink to fit»; both change the QR module size.
- Color: CMYK or sRGB color printing. Black-and-white output is acceptable only for an internal proof.
- Resolution: 300 DPI or higher; the source is 300 DPI.
- Paper: 250–300 g/m² matte or silk card. Glossy stock reflects light and makes phone scanning worse.
- Lamination: matte only, if any. Do not laminate glossy.
- Margins: the design has no bleed; borderless printing is optional, small white edges are acceptable.

## After printing, before the hotel rollout

- Physically scan every printed plaque with a phone camera (iOS Camera and Android Camera or Google Lens). Each scan must open `<site origin>/r/<token>` and show the correct hotel name and room label.
- A plaque that opens the wrong room or fails to scan is reprinted; never re-labeled by hand.
- Keep a note of the print run: date, hotel, rooms, site origin, and who scanned the test set.
