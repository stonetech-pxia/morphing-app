/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ImageError, readExif, stripJpegMetadata } from './exif';

// 真实的 8×8 基线 JPEG（sips 生成），自带 APP0、APP1（Exif）、APP13。
const fixture = new Uint8Array(readFileSync(new URL('./__fixtures__/tiny.jpg', import.meta.url)));

const bytesOf = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

interface RawSegment {
  marker: number;
  bytes: Uint8Array;
}

/** 测试用的独立段解析：SOS 之前的段 + 剩余的扫描数据。 */
function split(jpeg: Uint8Array): { segments: RawSegment[]; scan: Uint8Array } {
  const segments: RawSegment[] = [];
  let i = 2;
  while (jpeg[i + 1] !== 0xda) {
    const len = ((jpeg[i + 2] ?? 0) << 8) | (jpeg[i + 3] ?? 0);
    segments.push({ marker: jpeg[i + 1] ?? 0, bytes: jpeg.slice(i, i + 2 + len) });
    i += 2 + len;
  }
  return { segments, scan: jpeg.slice(i) };
}

const body = split(fixture);
const app0 = body.segments.find((s) => s.marker === 0xe0)!.bytes;
const imageSegments = body.segments.filter((s) => s.marker < 0xe0 || s.marker > 0xef);

function segment(marker: number, payload: number[]): Uint8Array {
  const len = payload.length + 2;
  return Uint8Array.from([0xff, marker, len >> 8, len & 0xff, ...payload]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 用给定的应用段拼出一张完整的 JPEG（图像数据来自 fixture）。 */
function jpeg(...apps: Uint8Array[]): Uint8Array {
  return concat([
    Uint8Array.of(0xff, 0xd8),
    ...apps,
    ...imageSegments.map((s) => s.bytes),
    body.scan,
  ]);
}

// ---- 手工构造 TIFF/EXIF ----

type Value = { type: number; count: number; data: number[] } | { ifd: number };
type Ifd = [tag: number, value: Value][];

function tiff(little: boolean, ifds: Ifd[]): number[] {
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => {
    const b = [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    return little ? b.reverse() : b;
  };
  const offsets: number[] = [];
  let at = 8;
  for (const ifd of ifds) {
    offsets.push(at);
    at += 2 + ifd.length * 12 + 4;
  }
  const out = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8)];
  const extra: number[] = [];
  for (const ifd of ifds) {
    out.push(...u16(ifd.length));
    for (const [tag, value] of ifd) {
      out.push(...u16(tag));
      if ('ifd' in value) {
        out.push(...u16(4), ...u32(1), ...u32(offsets[value.ifd] ?? 0));
        continue;
      }
      out.push(...u16(value.type), ...u32(value.count));
      if (value.data.length <= 4) {
        out.push(...value.data, ...Array<number>(4 - value.data.length).fill(0));
      } else {
        out.push(...u32(at + extra.length));
        extra.push(...value.data);
      }
    }
    out.push(...u32(0));
  }
  return [...out, ...extra];
}

function exifSegment(
  little: boolean,
  opts: { orientation?: number; dateTime?: string; original?: string; gps?: 'coords' | 'version' },
): Uint8Array {
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => {
    const b = [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    return little ? b.reverse() : b;
  };
  const ascii = (s: string) => ({ type: 2, count: s.length + 1, data: [...bytesOf(s), 0] });
  const ifd0: Ifd = [];
  const ifds: Ifd[] = [ifd0];
  if (opts.orientation !== undefined)
    ifd0.push([0x0112, { type: 3, count: 1, data: u16(opts.orientation) }]);
  if (opts.dateTime) ifd0.push([0x0132, ascii(opts.dateTime)]);
  if (opts.original) {
    ifd0.push([0x8769, { ifd: ifds.length }]);
    ifds.push([[0x9003, ascii(opts.original)]]);
  }
  if (opts.gps) {
    ifd0.push([0x8825, { ifd: ifds.length }]);
    const gps: Ifd = [[0x0000, { type: 1, count: 4, data: [2, 3, 0, 0] }]];
    if (opts.gps === 'coords') {
      gps.push([0x0001, ascii('N')]);
      gps.push([0x0002, { type: 5, count: 3, data: [31, 1, 14, 1, 2, 1].flatMap(u32) }]);
    }
    ifds.push(gps);
  }
  return segment(0xe1, [...bytesOf('Exif\0\0'), ...tiff(little, ifds)]);
}

const full = {
  orientation: 6,
  dateTime: '2020:01:02 03:04:05',
  original: '2024:05:01 12:34:56',
  gps: 'coords',
} as const;

describe('readExif', () => {
  for (const little of [true, false]) {
    it(`reads date, orientation and GPS (${little ? 'little' : 'big'} endian)`, () => {
      const info = readExif(jpeg(app0, exifSegment(little, full)));
      expect(info.takenAt).toEqual(new Date(2024, 4, 1, 12, 34, 56));
      expect(info.orientation).toBe(6);
      expect(info.hasLocation).toBe(true);
    });
  }

  it('falls back to DateTime without DateTimeOriginal', () => {
    const info = readExif(jpeg(exifSegment(false, { dateTime: '2020:01:02 03:04:05' })));
    expect(info).toEqual({
      takenAt: new Date(2020, 0, 2, 3, 4, 5),
      orientation: null,
      hasLocation: false,
    });
  });

  it('does not count a GPS IFD without coordinates as location', () => {
    expect(readExif(jpeg(exifSegment(true, { gps: 'version' }))).hasLocation).toBe(false);
  });

  it('ignores invalid values', () => {
    const info = readExif(
      jpeg(exifSegment(true, { orientation: 9, original: '0000:00:00 00:00:00' })),
    );
    expect(info).toEqual({ takenAt: null, orientation: null, hasLocation: false });
  });

  it('reads the real fixture (Exif without date/orientation)', () => {
    expect(readExif(fixture)).toEqual({ takenAt: null, orientation: null, hasLocation: false });
  });

  it('never throws on non-JPEG or truncated input', () => {
    const empty = { takenAt: null, orientation: null, hasLocation: false };
    expect(readExif(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toEqual(empty);
    expect(readExif(new Uint8Array(0))).toEqual(empty);
    const whole = jpeg(exifSegment(true, full));
    for (const cut of [4, 20, 40, 60, 90, 120]) {
      expect(() => readExif(whole.slice(0, cut))).not.toThrow();
    }
    // 段长度正确但 TIFF 内部偏移越界：保留能读到的部分。
    const seg = exifSegment(true, full);
    const broken = seg.slice();
    broken.fill(0xff, 40);
    expect(() => readExif(jpeg(broken))).not.toThrow();
  });

  it('reads EXIF from a subarray view', () => {
    const whole = jpeg(exifSegment(true, full));
    const padded = new Uint8Array(whole.length + 10);
    padded.set(whole, 7);
    expect(readExif(padded.subarray(7, 7 + whole.length)).orientation).toBe(6);
  });
});

describe('stripJpegMetadata', () => {
  const xmp = segment(0xe1, [
    ...bytesOf('http://ns.adobe.com/xap/1.0/\0'),
    ...bytesOf('<x:xmpmeta/>'),
  ]);
  const icc = segment(0xe2, [...bytesOf('ICC_PROFILE\0'), 1, 1, 0, 0, 0, 0]);
  const iptc = segment(0xed, [...bytesOf('Photoshop 3.0\0'), ...bytesOf('8BIM'), 4, 4, 0, 0]);

  it('drops Exif, XMP and Photoshop segments and keeps JFIF, ICC and image data', () => {
    const input = jpeg(app0, exifSegment(true, full), xmp, icc, iptc);
    const { bytes, removed } = stripJpegMetadata(input);
    expect(removed).toEqual(['exif', 'xmp', 'photoshop']);
    expect(bytes).toEqual(jpeg(app0, icc));
    expect(readExif(bytes)).toEqual({ takenAt: null, orientation: null, hasLocation: false });
    expect(split(bytes).segments.map((s) => s.marker)).not.toContain(0xe1);
  });

  it('strips the real fixture losslessly', () => {
    const { bytes, removed } = stripJpegMetadata(fixture);
    expect(removed).toEqual(['exif', 'photoshop']);
    expect(bytes.length).toBeLessThan(fixture.length);
    const after = split(bytes);
    expect(after.scan).toEqual(body.scan);
    expect(after.segments.map((s) => s.marker)).toEqual(
      body.segments.filter((s) => s.marker !== 0xe1 && s.marker !== 0xed).map((s) => s.marker),
    );
  });

  it('leaves a JPEG without metadata unchanged', () => {
    const plain = jpeg(app0);
    expect(stripJpegMetadata(plain)).toEqual({ bytes: plain, removed: [] });
  });

  it('handles fill bytes before a marker', () => {
    const exif = exifSegment(false, full);
    const padded = concat([
      Uint8Array.of(0xff, 0xd8, 0xff, 0xff),
      exif,
      app0,
      ...imageSegments.map((s) => s.bytes),
      body.scan,
    ]);
    expect(readExif(padded).orientation).toBe(6);
    expect(stripJpegMetadata(padded).bytes).toEqual(jpeg(app0));
  });

  it('rejects non-JPEG and malformed input', () => {
    expect(() => stripJpegMetadata(Uint8Array.of(1, 2, 3, 4))).toThrow(ImageError);
    const truncated = jpeg(app0, exifSegment(true, full)).slice(0, 30);
    expect(() => stripJpegMetadata(truncated)).toThrow(
      expect.objectContaining({ code: 'malformed' }),
    );
  });
});
