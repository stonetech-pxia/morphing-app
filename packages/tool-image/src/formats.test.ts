import { describe, expect, it } from 'vitest';

import { OUTPUT_FORMATS, extOfFormat, formatOfMime, isImageMime, mimeOfFormat } from './formats';

describe('formats', () => {
  it('never offers HEIC output', () => {
    expect(OUTPUT_FORMATS).toEqual(['jpeg', 'png', 'webp']);
    expect(formatOfMime('image/heic')).toBeNull();
    expect(formatOfMime('image/gif')).toBeNull();
  });

  it('maps MIME types to formats', () => {
    expect(formatOfMime('image/jpeg')).toBe('jpeg');
    expect(formatOfMime('Image/JPG')).toBe('jpeg');
    expect(formatOfMime('image/png; charset=binary')).toBe('png');
    expect(formatOfMime('image/webp')).toBe('webp');
    expect(formatOfMime('application/pdf')).toBeNull();
  });

  it('round-trips format, MIME and extension', () => {
    for (const f of OUTPUT_FORMATS) expect(formatOfMime(mimeOfFormat(f))).toBe(f);
    expect(OUTPUT_FORMATS.map(extOfFormat)).toEqual(['jpg', 'png', 'webp']);
  });

  it('recognises image MIME types', () => {
    expect(isImageMime('image/heic')).toBe(true);
    expect(isImageMime('image/svg+xml')).toBe(true);
    expect(isImageMime('IMAGE/PNG')).toBe(true);
    expect(isImageMime('image/')).toBe(false);
    expect(isImageMime('video/mp4')).toBe(false);
    expect(isImageMime('')).toBe(false);
  });
});
