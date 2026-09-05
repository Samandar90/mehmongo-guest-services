import JSZip from 'jszip';

export type RoomGeneratedAsset = {
  /** Filesystem-safe base name from roomAssetBaseName(), without extension. */
  baseName: string;
  png: Blob;
  pdf: Uint8Array;
};

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
    zip.file(`${asset.baseName}.png`, asset.png);
    // Wrapped in a Blob: JSZip's typed-array detection is realm-sensitive (jsdom vs Node), Blobs are not.
    zip.file(`${asset.baseName}.pdf`, new Blob([asset.pdf as BlobPart], { type: 'application/pdf' }));
  }

  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
