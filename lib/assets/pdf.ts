import { PDFDocument, type PDFImage } from 'pdf-lib';

/** A5 portrait, 148 × 210 mm, in PDF points (1 pt = 1/72 in). */
export const A5_WIDTH_PT = 419.527559;
export const A5_HEIGHT_PT = 595.275591;

/** PNG bytes, or a loader so large sets can materialize one page at a time. */
export type RoomPdfPage = { label: string; png: Uint8Array | (() => Promise<Uint8Array>) };

async function embedPng(document: PDFDocument, png: Uint8Array, label: string): Promise<PDFImage> {
  try {
    return await document.embedPng(png);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Room ${label}: PNG could not be embedded (${reason})`);
  }
}

function addA5Page(document: PDFDocument, image: PDFImage): void {
  const page = document.addPage([A5_WIDTH_PT, A5_HEIGHT_PT]);
  // The PNG already is the full A5 artwork at 300 DPI, so it fills the page edge to edge.
  page.drawImage(image, { x: 0, y: 0, width: A5_WIDTH_PT, height: A5_HEIGHT_PT });
}

function withMetadata(document: PDFDocument, title: string): PDFDocument {
  document.setTitle(title);
  document.setProducer('MehmonGo');
  document.setCreator('MehmonGo super admin');
  return document;
}

/** One room plaque on one exact A5 page. */
export async function buildRoomPdf(png: Uint8Array, label = 'room'): Promise<Uint8Array> {
  const document = withMetadata(await PDFDocument.create(), `MehmonGo room ${label}`);
  addA5Page(document, await embedPng(document, png, label));
  return document.save();
}

/** One A5 page per room, in input order; embeds each PNG once. */
export async function buildHotelPdf(pages: RoomPdfPage[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('No rooms selected');
  const document = withMetadata(await PDFDocument.create(), 'MehmonGo room plaques');
  for (const page of pages) {
    const png = typeof page.png === 'function' ? await page.png() : page.png;
    addA5Page(document, await embedPng(document, png, page.label));
  }
  return document.save();
}
