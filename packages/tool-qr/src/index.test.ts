import { describe, expect, it } from 'vitest';

import {
  QrError,
  decodeQr,
  downscaleRgba,
  qrMatrix,
  qrToRgba,
  wifiProblem,
  wifiText,
  type QrEcc,
  type RgbaImage,
} from './index';

const SAMPLES = [
  'Hello, Morph! 123',
  '你好，世界！这是一个二维码测试。',
  'https://example.com/path/页面?q=测试&id=42#top',
];
const LEVELS: QrEcc[] = ['L', 'M', 'Q', 'H'];

/** 绕中心旋转（最近邻采样），外面填白色。 */
function rotate(image: RgbaImage, degrees: number): RgbaImage {
  const { width, height, data } = image;
  const out = new Uint8Array(data.length).fill(255);
  const cos = Math.cos((degrees * Math.PI) / 180);
  const sin = Math.sin((degrees * Math.PI) / 180);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.round(cos * (x - cx) + sin * (y - cy) + cx);
      const sy = Math.round(-sin * (x - cx) + cos * (y - cy) + cy);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      out.set(data.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data: out };
}

describe('qrMatrix', () => {
  it('builds a square matrix of 0/1 modules', () => {
    const m = qrMatrix('morph');
    expect(m.size).toBe(21);
    expect(m.modules).toHaveLength(21 * 21);
    expect(m.modules.every((v) => v === 0 || v === 1)).toBe(true);
    // 左上角定位图案：7×7 外框是深色。
    expect(m.modules[0]).toBe(1);
    expect(m.modules[6]).toBe(1);
    expect(m.modules[6 * 21]).toBe(1);
  });

  it('rejects empty and too-long text', () => {
    expect(() => qrMatrix('')).toThrow(QrError);
    expect(() => qrMatrix('')).toThrow(expect.objectContaining({ code: 'empty' }));
    expect(() => qrMatrix('a'.repeat(1001))).toThrow(expect.objectContaining({ code: 'tooLong' }));
    // 1000 个汉字（3000 字节）超出二维码最大容量。
    expect(() => qrMatrix('码'.repeat(1000))).toThrow(expect.objectContaining({ code: 'tooLong' }));
    expect(qrMatrix('a'.repeat(1000), { ecc: 'H' }).size).toBeGreaterThan(100);
    // 按字符数而不是 UTF-16 长度计算：600 个 emoji 是 1200 个 UTF-16 单元，但只有 600 个字符。
    expect(qrMatrix('😀'.repeat(600), { ecc: 'L' }).size).toBeGreaterThan(150);
  });
});

describe('qrToRgba', () => {
  it('rasterises with margin, scale and colours', () => {
    const m = qrMatrix('morph');
    const img = qrToRgba(m, { scale: 3, marginModules: 2, dark: '#123456', light: '#ffffff88' });
    expect(img.width).toBe((21 + 4) * 3);
    expect(img.height).toBe(img.width);
    expect(img.data).toHaveLength(img.width * img.height * 4);
    expect(Array.from(img.data.subarray(0, 4))).toEqual([255, 255, 255, 0x88]);
    // 第一个深色模块在留白之后：(2*3, 2*3)。
    const i = (6 * img.width + 6) * 4;
    expect(Array.from(img.data.subarray(i, i + 4))).toEqual([0x12, 0x34, 0x56, 255]);
  });

  it('rejects invalid options', () => {
    const m = qrMatrix('morph');
    expect(() => qrToRgba(m, { scale: 0 })).toThrow(RangeError);
    expect(() => qrToRgba(m, { scale: 2, dark: 'black' })).toThrow(RangeError);
  });
});

describe('decodeQr', () => {
  for (const text of SAMPLES) {
    for (const ecc of LEVELS) {
      it(`round-trips ${JSON.stringify(text.slice(0, 12))} at ecc ${ecc}`, () => {
        const img = qrToRgba(qrMatrix(text, { ecc }), { scale: 4 });
        expect(decodeQr(img)).toBe(text);
      });
    }
  }

  it('decodes light-on-dark codes', () => {
    const img = qrToRgba(qrMatrix('inverted'), { scale: 4, dark: '#FFFFFF', light: '#000000' });
    expect(decodeQr(img)).toBe('inverted');
  });

  it('decodes a rotated code', () => {
    const text = SAMPLES[1]!;
    const img = rotate(qrToRgba(qrMatrix(text, { ecc: 'Q' }), { scale: 6, marginModules: 8 }), 20);
    expect(decodeQr(img)).toBe(text);
  });

  it('decodes a large image after downscaling', () => {
    const text = SAMPLES[2]!;
    const big = qrToRgba(qrMatrix(text), { scale: 50 });
    expect(big.width).toBeGreaterThan(1600);
    const small = downscaleRgba(big);
    expect(Math.max(small.width, small.height)).toBe(1600);
    expect(decodeQr(small)).toBe(text);
  });

  it('returns null when there is no code', () => {
    const blank = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(255) };
    expect(decodeQr(blank)).toBeNull();
  });
});

describe('downscaleRgba', () => {
  it('keeps small images and box-averages large ones', () => {
    const img = { width: 4, height: 2, data: new Uint8Array(4 * 2 * 4) };
    expect(downscaleRgba(img, 4)).toBe(img);
    // 左半黑、右半白，缩成 2×1 后各自保持纯色；交界处平均。
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++)
        img.data.set(x < 2 ? [0, 0, 0, 255] : [200, 200, 200, 255], (y * 4 + x) * 4);
    }
    const small = downscaleRgba(img, 2);
    expect(small).toMatchObject({ width: 2, height: 1 });
    expect(Array.from(small.data)).toEqual([0, 0, 0, 255, 200, 200, 200, 255]);
    const one = downscaleRgba(img, 1);
    expect(Array.from(one.data)).toEqual([100, 100, 100, 255]);
  });
});

describe('Wi-Fi QR codes (D-199)', () => {
  const net = { name: 'Home', security: 'WPA' as const, password: 'secret123', hidden: false };

  it('writes the text phone cameras read, escaping special characters', () => {
    expect(wifiText(net)).toBe('WIFI:T:WPA;S:Home;P:secret123;;');
    expect(wifiText({ ...net, name: 'Café;Bar', password: 'a:b,c"d\\e', hidden: true })).toBe(
      'WIFI:T:WPA;S:Café\\;Bar;P:a\\:b\\,c\\"d\\\\e;H:true;;',
    );
    expect(wifiText({ ...net, security: 'none', password: 'ignored' })).toBe(
      'WIFI:T:nopass;S:Home;;',
    );
    // 能做成二维码再读回来。
    const image = qrToRgba(qrMatrix(wifiText(net)), { scale: 6 });
    expect(decodeQr(image)).toBe('WIFI:T:WPA;S:Home;P:secret123;;');
  });

  it('checks the name and the password first', () => {
    expect(wifiProblem(net)).toBeNull();
    expect(wifiProblem({ ...net, name: '  ' })).toBe('name');
    expect(wifiProblem({ ...net, name: '网'.repeat(11) })).toBe('name');
    expect(wifiProblem({ ...net, password: '' })).toBe('passwordMissing');
    expect(wifiProblem({ ...net, password: 'short' })).toBe('password');
    expect(wifiProblem({ ...net, security: 'WEP', password: 'short' })).toBeNull();
    expect(wifiProblem({ ...net, security: 'none', password: '' })).toBeNull();
  });
});
