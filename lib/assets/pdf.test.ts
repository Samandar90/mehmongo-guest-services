import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { A5_HEIGHT_PT, A5_WIDTH_PT, buildHotelPdf, buildRoomPdf } from './pdf';

// 1×1 white PNG.
const PNG_FIXTURE = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='),
  (char) => char.charCodeAt(0),
);

describe('A5 PDF documents', () => {
  it('uses exact A5 portrait point dimensions', () => {
    expect(A5_WIDTH_PT).toBeCloseTo(419.527559, 6);
    expect(A5_HEIGHT_PT).toBeCloseTo(595.275591, 6);
  });

  it('creates one exact A5 portrait page', async () => {
    const bytes = await buildRoomPdf(PNG_FIXTURE);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(1);
    expect(document.getPage(0).getSize()).toEqual({ width: A5_WIDTH_PT, height: A5_HEIGHT_PT });
  });

  it('creates one page per room in input order', async () => {
    const bytes = await buildHotelPdf([{ label: '205', png: PNG_FIXTURE }, { label: '206', png: PNG_FIXTURE }]);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(2);
    expect(document.getPage(1).getSize()).toEqual({ width: A5_WIDTH_PT, height: A5_HEIGHT_PT });
  });

  it('rejects an empty multi-page document', async () => {
    await expect(buildHotelPdf([])).rejects.toThrow('No rooms selected');
  });

  it('rejects bytes that are not a PNG with the room label', async () => {
    await expect(buildHotelPdf([{ label: '205', png: new Uint8Array([1, 2, 3]) }])).rejects.toThrow('205');
  });
});
