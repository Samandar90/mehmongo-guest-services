import { A5_PIXEL_HEIGHT, A5_PIXEL_WIDTH } from '@/lib/assets/room-plaque';

export type RasterImage = { width: number; height: number };

export type RasterContext = {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: RasterImage, x: number, y: number, width: number, height: number): void;
};

export type RasterCanvas = {
  width: number;
  height: number;
  getContext(type: '2d'): RasterContext | null;
  toBlob(callback: (blob: Blob | null) => void, type: string): void;
};

/** The browser pieces the rasterizer touches, injectable so Node tests need no canvas. */
export type CanvasAdapter = {
  createCanvas: (width: number, height: number) => RasterCanvas;
  loadImage: (url: string) => Promise<RasterImage>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};

export type RasterizeErrorCode = 'CANVAS_CONTEXT_UNAVAILABLE' | 'IMAGE_LOAD_FAILED' | 'PNG_EXPORT_FAILED';

export class RasterizeError extends Error {
  constructor(readonly code: RasterizeErrorCode, message: string) {
    super(message);
    this.name = 'RasterizeError';
  }
}

function browserCanvasAdapter(): CanvasAdapter {
  return {
    createCanvas(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return {
        get width() { return canvas.width; },
        set width(value) { canvas.width = value; },
        get height() { return canvas.height; },
        set height(value) { canvas.height = value; },
        getContext: (type) => canvas.getContext(type) as RasterContext | null,
        toBlob: (callback, type) => canvas.toBlob(callback, type),
      };
    },
    loadImage(url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('SVG image failed to load'));
        image.src = url;
      });
    },
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

/**
 * Renders an SVG string to a PNG Blob at the given pixel size (A5 at 300 DPI
 * by default) on a white background. The temporary object URL is always revoked.
 */
export async function svgToPngBlob(
  svg: string,
  width = A5_PIXEL_WIDTH,
  height = A5_PIXEL_HEIGHT,
  adapter: CanvasAdapter = browserCanvasAdapter(),
): Promise<Blob> {
  const canvas = adapter.createCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new RasterizeError('CANVAS_CONTEXT_UNAVAILABLE', 'Canvas 2D context is unavailable');

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = adapter.createObjectURL(svgBlob);
  let image: RasterImage;
  try {
    image = await adapter.loadImage(objectUrl);
  } catch (error) {
    throw new RasterizeError('IMAGE_LOAD_FAILED', error instanceof Error ? error.message : 'SVG image failed to load');
  } finally {
    adapter.revokeObjectURL(objectUrl);
  }

  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new RasterizeError('PNG_EXPORT_FAILED', 'Canvas did not produce a PNG');
  return png;
}
