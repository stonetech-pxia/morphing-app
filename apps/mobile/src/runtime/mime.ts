import { MEDIA_MIME_BY_EXT, OFFICE_MIME_BY_EXT } from '@morph/core';

// 文件名 / 扩展名 / MIME 之间的换算（纯函数）。单独一个文件：存储也要用，不该为此依赖动作的公共工具（R11）。

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  zip: 'application/zip',
  txt: 'text/plain',
  ...MEDIA_MIME_BY_EXT,
  ...OFFICE_MIME_BY_EXT,
};

export const extOf = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
export const baseName = (name: string) => name.replace(/\.[^./]+$/, '');
export const mimeOfExt = (ext: string) => MIME_BY_EXT[ext] ?? 'application/octet-stream';
/** MIME 对应的扩展名（名字里没有扩展名时用）；认不出时是空的。 */
export const extOfMime = (mime: string | null | undefined) =>
  Object.keys(MIME_BY_EXT).find((ext) => MIME_BY_EXT[ext] === mime?.toLowerCase()) ?? '';

export function mimeOf(name: string, given: string | null): string {
  if (given && given !== 'application/octet-stream') return given;
  return mimeOfExt(extOf(name));
}

export const isImageMime = (mime: string) => mime.startsWith('image/');
