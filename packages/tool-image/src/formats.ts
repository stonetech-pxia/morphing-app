// 输出格式。只输出 JPEG / PNG / WebP，从不输出 HEIC（很多平台打不开）。

export const OUTPUT_FORMATS = ['jpeg', 'png', 'webp'] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const EXT: Record<OutputFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/** 去掉参数并转小写，如 "Image/JPEG; q=1" → "image/jpeg"。 */
function normalize(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

/** MIME 对应的输出格式；不是可输出的格式（如 HEIC、GIF）时返回 null。 */
export function formatOfMime(mime: string): OutputFormat | null {
  switch (normalize(mime)) {
    case 'image/jpeg':
    case 'image/jpg':
    case 'image/pjpeg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

export function extOfFormat(format: OutputFormat): string {
  return EXT[format];
}

export function mimeOfFormat(format: OutputFormat): string {
  return MIME[format];
}

/** 任意图片类型（含 HEIC、GIF 等只能输入的格式）。 */
export function isImageMime(mime: string): boolean {
  return /^image\/[a-z0-9.+-]+$/.test(normalize(mime));
}
