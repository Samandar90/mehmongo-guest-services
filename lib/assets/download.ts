export type DownloadAnchor = { href: string; download: string; click(): void };

/** The browser pieces a download touches, injectable for tests. */
export type DownloadAdapter = {
  createAnchor: () => DownloadAnchor;
  body: { appendChild: (anchor: DownloadAnchor) => unknown; removeChild: (anchor: DownloadAnchor) => unknown };
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** Defers a task until after the click has been dispatched (queueMicrotask in browsers). */
  schedule: (task: () => void) => void;
};

function browserDownloadAdapter(): DownloadAdapter {
  return {
    createAnchor: () => document.createElement('a'),
    body: {
      appendChild: (anchor) => document.body.appendChild(anchor as unknown as Node),
      removeChild: (anchor) => document.body.removeChild(anchor as unknown as Node),
    },
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    schedule: (task) => queueMicrotask(task),
  };
}

const safeFilename = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Triggers a browser download through a temporary anchor and revokes the
 * object URL only after the click so Safari and Chromium can start the download.
 */
export function downloadBlob(blob: Blob, filename: string, adapter: DownloadAdapter = browserDownloadAdapter()): void {
  if (!safeFilename.test(filename) || filename.includes('..')) throw new Error('Invalid download filename');

  const url = adapter.createObjectURL(blob);
  const anchor = adapter.createAnchor();
  anchor.href = url;
  anchor.download = filename;
  adapter.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    adapter.body.removeChild(anchor);
    adapter.schedule(() => adapter.revokeObjectURL(url));
  }
}
