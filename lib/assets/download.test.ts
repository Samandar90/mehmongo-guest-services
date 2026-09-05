import { describe, expect, it, vi } from 'vitest';
import { downloadBlob, type DownloadAdapter } from './download';

function fakeBrowserAdapter() {
  const order: string[] = [];
  const anchor = {
    href: '',
    download: '',
    click: vi.fn(() => order.push('click')),
  };
  const body = {
    appendChild: vi.fn(() => order.push('append')),
    removeChild: vi.fn(() => order.push('remove')),
  };
  const adapter: DownloadAdapter = {
    createAnchor: vi.fn(() => anchor),
    body,
    createObjectURL: vi.fn(() => 'blob:test'),
    revokeObjectURL: vi.fn(() => order.push('revoke')),
    schedule: vi.fn((task: () => void) => { order.push('schedule'); task(); }),
  };
  return { adapter, anchor, body, order };
}

describe('downloadBlob', () => {
  it('revokes temporary download URL', () => {
    const { adapter } = fakeBrowserAdapter();

    downloadBlob(new Blob(['x']), 'room.png', adapter);

    expect(adapter.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('clicks a temporary anchor with the filename and only revokes after the click', () => {
    const { adapter, anchor, body, order } = fakeBrowserAdapter();
    const blob = new Blob(['x']);

    downloadBlob(blob, 'kamilovs-room-205.pdf', adapter);

    expect(adapter.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe('blob:test');
    expect(anchor.download).toBe('kamilovs-room-205.pdf');
    expect(body.appendChild).toHaveBeenCalledWith(anchor);
    expect(body.removeChild).toHaveBeenCalledWith(anchor);
    expect(order).toEqual(['append', 'click', 'remove', 'schedule', 'revoke']);
  });

  it('rejects an unsafe filename', () => {
    const { adapter } = fakeBrowserAdapter();

    expect(() => downloadBlob(new Blob(['x']), '../room.png', adapter)).toThrow('Invalid download filename');
    expect(() => downloadBlob(new Blob(['x']), '', adapter)).toThrow('Invalid download filename');
    expect(adapter.createObjectURL).not.toHaveBeenCalled();
  });
});
