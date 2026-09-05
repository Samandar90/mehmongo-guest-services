import { describe, expect, it, vi } from 'vitest';
import { RasterizeError, svgToPngBlob, type CanvasAdapter, type RasterCanvas, type RasterContext } from './rasterize';

function fakeCanvasAdapter(overrides: {
  context?: RasterContext | null;
  loadImage?: CanvasAdapter['loadImage'];
  pngBlob?: Blob | null;
} = {}) {
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const context: RasterContext = overrides.context === undefined
    ? { fillStyle: '', fillRect, drawImage }
    : overrides.context as RasterContext;
  const pngBlob = overrides.pngBlob === undefined ? new Blob(['png'], { type: 'image/png' }) : overrides.pngBlob;
  const canvas: RasterCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: (blob: Blob | null) => void) => callback(pngBlob)),
  };
  const image = { width: 1748, height: 2480 };
  const adapter: CanvasAdapter = {
    createCanvas: vi.fn(() => canvas),
    loadImage: overrides.loadImage ?? vi.fn().mockResolvedValue(image),
    createObjectURL: vi.fn(() => 'blob:svg'),
    revokeObjectURL: vi.fn(),
  };
  return { adapter, canvas, context, drawImage, fillRect, image };
}

describe('svgToPngBlob', () => {
  it('renders at exact 300 DPI pixel dimensions', async () => {
    const { adapter, canvas, drawImage, image } = fakeCanvasAdapter();

    const blob = await svgToPngBlob('<svg width="1748" height="2480"/>', 1748, 2480, adapter);

    expect(canvas.width).toBe(1748);
    expect(canvas.height).toBe(2480);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 1748, 2480);
    expect(blob.type).toBe('image/png');
  });

  it('paints a white background before drawing the SVG', async () => {
    const { adapter, context, fillRect } = fakeCanvasAdapter();

    await svgToPngBlob('<svg/>', 100, 200, adapter);

    expect(context.fillStyle).toBe('#FFFFFF');
    expect(fillRect).toHaveBeenCalledWith(0, 0, 100, 200);
  });

  it('loads the SVG through a temporary object URL and always revokes it', async () => {
    const { adapter } = fakeCanvasAdapter();
    await svgToPngBlob('<svg/>', 10, 10, adapter);
    expect(adapter.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/svg+xml;charset=utf-8' }));
    expect(adapter.loadImage).toHaveBeenCalledWith('blob:svg');
    expect(adapter.revokeObjectURL).toHaveBeenCalledWith('blob:svg');

    const failing = fakeCanvasAdapter({ loadImage: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(svgToPngBlob('<svg/>', 10, 10, failing.adapter)).rejects.toMatchObject({ code: 'IMAGE_LOAD_FAILED' });
    expect(failing.adapter.revokeObjectURL).toHaveBeenCalledWith('blob:svg');
  });

  it('fails with stable codes for a missing context and a failed PNG export', async () => {
    await expect(svgToPngBlob('<svg/>', 10, 10, fakeCanvasAdapter({ context: null }).adapter))
      .rejects.toMatchObject({ code: 'CANVAS_CONTEXT_UNAVAILABLE' });
    await expect(svgToPngBlob('<svg/>', 10, 10, fakeCanvasAdapter({ pngBlob: null }).adapter))
      .rejects.toMatchObject({ code: 'PNG_EXPORT_FAILED' });
    await expect(svgToPngBlob('<svg/>', 10, 10, fakeCanvasAdapter({ pngBlob: null }).adapter))
      .rejects.toBeInstanceOf(RasterizeError);
  });
});
