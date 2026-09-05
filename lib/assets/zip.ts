import JSZip from 'jszip';

export type RoomGeneratedAsset = {
  /** Filesystem-safe base name from roomAssetBaseName(), without extension. */
  baseName: string;
  png: Blob;
  pdf: Uint8Array;
};

/**
 * JSZip detects input types with instanceof checks, which fail across realms
 * (jsdom tests) and for Blobs in plain Node (verification scripts). Plain bytes
 * of the current realm work everywhere; Node additionally gets a Buffer.
 */
async function zipInput(data: Blob | Uint8Array): Promise<Uint8Array> {
  const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data);
  return typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes;
}

/**
 * Deterministic ZIP with <baseName>.png and <baseName>.pdf per room, sorted by
 * base name and DEFLATE-compressed, so the same selection always yields the
 * same archive layout.
 */
export async function buildHotelAssetZip(assets: RoomGeneratedAsset[]): Promise<Blob> {
  if (assets.length === 0) throw new Error('No rooms selected');

  const seen = new Set<string>();
  for (const asset of assets) {
    if (seen.has(asset.baseName)) throw new Error(`Duplicate asset name: ${asset.baseName}`);
    seen.add(asset.baseName);
  }

  const zip = new JSZip();
  const sorted = [...assets].sort((left, right) => left.baseName.localeCompare(right.baseName, 'en'));
  for (const asset of sorted) {
    zip.file(`${asset.baseName}.png`, await zipInput(asset.png));
    zip.file(`${asset.baseName}.pdf`, await zipInput(asset.pdf));
  }

  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
