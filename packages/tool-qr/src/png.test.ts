import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { decodeQr, qrMatrix, qrToRgba } from './index';
import { encodePng } from './png';

/** 读回 PNG 的像素（只支持我们自己写的格式：RGBA、不滤波）。 */
function readPng(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = new DataView(data.buffer, data.byteOffset).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset).getUint32(4);
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = unzlibSync(Uint8Array.from(idat.flatMap((d) => [...d])));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    data.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, data };
}

describe('encodePng', () => {
  it('writes a PNG whose pixels decode back to the same QR code', () => {
    const image = qrToRgba(qrMatrix('https://example.com/签证'), { scale: 6 });
    const png = encodePng(image);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const back = readPng(png);
    expect(back.width).toBe(image.width);
    expect(back.data).toEqual(image.data);
    expect(decodeQr(back)).toBe('https://example.com/签证');
  });

  it('rejects mismatched pixel data', () => {
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(3) })).toThrow();
  });
});
