import { RunError } from '@morph/core';
import { setStringAsync } from 'expo-clipboard';
import { getDocumentAsync } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
  type ImagePickerAsset,
} from 'expo-image-picker';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { printAsync } from 'expo-print';
import { shareAsync } from 'expo-sharing';

import type { FilePlatform, ImageFormat, PickedFile } from './platform';

// FilePlatform 的 Expo 实现。用户文件存放在 App 文档目录的 assets/<id>/<文件名>，
// 数据库只保存相对路径，与配置版本完全分开（§7G）。

const ROOT = 'assets';

function assetDir(assetId: string): Directory {
  const dir = new Directory(Paths.document, ROOT, assetId);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

const fileAt = (path: string) => new File(Paths.document, ...path.split('/'));

/** 本次运行里的一个临时文件（D-063）。relPath 形如 `3/报告.pdf`，目录按需创建。 */
function runFile(runId: string, relPath: string): File {
  const parts = relPath.split('/');
  const dir = new Directory(Paths.cache, 'runs', runId, ...parts.slice(0, -1));
  dir.create({ idempotent: true, intermediates: true });
  const file = new File(dir, parts[parts.length - 1]!);
  if (file.exists) file.delete();
  return file;
}

/** EXIF 日期「2026:10:22 09:00:00」→ 毫秒（设备本地时间）。 */
function exifDate(exif: Record<string, unknown> | null | undefined): number | undefined {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTime;
  const m =
    typeof raw === 'string' ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw) : null;
  if (!m) return undefined;
  const [, y, mo, d, h, mi, se] = m.map(Number) as number[];
  return new Date(y!, mo! - 1, d, h, mi, se).getTime();
}

function pickedPhoto(a: ImagePickerAsset): PickedFile {
  const ext = a.mimeType?.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  const takenAt = exifDate(a.exif);
  return {
    uri: a.uri,
    name: a.fileName ?? `photo-${Date.now()}.${ext}`,
    size: a.fileSize ?? null,
    mimeType: a.mimeType ?? null,
    width: a.width,
    height: a.height,
    // 只读拍摄时间（命名用）；EXIF 里的其他信息（包括位置）不保存。
    ...(takenAt !== undefined ? { takenAt } : {}),
  };
}

const SAVE_FORMATS: Record<ImageFormat, SaveFormat> = {
  jpeg: SaveFormat.JPEG,
  png: SaveFormat.PNG,
  webp: SaveFormat.WEBP,
};

const UTI: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'text/csv': 'public.comma-separated-values-text',
  'image/jpeg': 'public.jpeg',
  'image/png': 'public.png',
  'application/zip': 'public.zip-archive',
  'text/plain': 'public.plain-text',
};

/** 照片最长边（D-047）：足够全屏清晰显示，又不会占用太多空间。 */
const MAX_IMAGE_SIDE = 2048;

export const expoFilePlatform: FilePlatform = {
  async pickImage() {
    const result = await launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return null;
    const picked = result.assets[0];
    // 重新编码为 JPEG：统一格式（Android 不能显示 HEIC）、缩小到最长边 2048，并去掉位置等元数据（D-047）。
    let image = await ImageManipulator.manipulate(picked.uri).renderAsync();
    if (Math.max(image.width, image.height) > MAX_IMAGE_SIDE) {
      image = await ImageManipulator.manipulate(image)
        .resize(
          image.width >= image.height ? { width: MAX_IMAGE_SIDE } : { height: MAX_IMAGE_SIDE },
        )
        .renderAsync();
    }
    const saved = await image.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
    const base = (picked.fileName ?? `photo-${Date.now()}`).replace(/\.[^.]+$/, '');
    return {
      uri: saved.uri,
      name: `${base}.jpg`,
      size: new File(saved.uri).size,
      mimeType: 'image/jpeg',
    };
  },

  fileUri: (path) => fileAt(path).uri,

  async importFile(file, assetId, name) {
    const dest = new File(assetDir(assetId), name);
    await new File(file.uri).copy(dest);
    return { path: `${ROOT}/${assetId}/${name}`, size: dest.size };
  },

  readBytes: (path) => fileAt(path).bytes(),

  async writeBytes(assetId, name, bytes) {
    const dest = new File(assetDir(assetId), name);
    await dest.write(bytes);
    return { path: `${ROOT}/${assetId}/${name}`, size: dest.size };
  },

  async shareText(fileName, text, mimeType) {
    const dir = new Directory(Paths.cache, 'exports');
    dir.create({ idempotent: true, intermediates: true });
    const file = new File(dir, fileName);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
    await shareAsync(file.uri, {
      mimeType,
      ...(mimeType === 'text/csv' ? { UTI: 'public.comma-separated-values-text' } : {}),
    });
  },

  async share(path, mimeType) {
    await shareAsync(fileAt(path).uri, {
      mimeType,
      ...(UTI[mimeType] ? { UTI: UTI[mimeType] } : {}),
    });
  },

  async pickPhotos(max) {
    const result = await launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: max > 1,
      selectionLimit: max,
      orderedSelection: true,
      exif: true,
    });
    if (result.canceled) return null;
    return result.assets.map(pickedPhoto);
  },

  async takePhoto() {
    const permission = await requestCameraPermissionsAsync();
    if (!permission.granted) throw new RunError('permissionDenied', { what: 'camera' });
    let result;
    try {
      result = await launchCameraAsync({ mediaTypes: ['images'], exif: true });
    } catch {
      // 模拟器没有相机。
      throw new RunError('cameraUnavailable');
    }
    if (result.canceled || !result.assets[0]) return null;
    return pickedPhoto(result.assets[0]);
  },

  async pickDocuments(types, multiple) {
    const result = await getDocumentAsync({
      type: [...types],
      multiple,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return null;
    return result.assets.map((a) => ({
      uri: a.uri,
      name: a.name,
      size: a.size ?? null,
      mimeType: a.mimeType ?? null,
    }));
  },

  async copyToRun(uri, runId, fileName) {
    const dest = runFile(runId, fileName);
    await new File(uri).copy(dest);
    return { uri: dest.uri, size: dest.size };
  },

  async writeRunFile(runId, fileName, bytes) {
    const dest = runFile(runId, fileName);
    dest.create();
    dest.write(bytes);
    // 刚写完时 size 可能还是 0，直接用字节数。
    return { uri: dest.uri, size: bytes.length };
  },

  readUri: (uri) => new File(uri).bytes(),

  async removeRun(runId) {
    const dir = new Directory(Paths.cache, 'runs', runId);
    if (dir.exists) dir.delete();
  },

  async removeAllRuns() {
    const dir = new Directory(Paths.cache, 'runs');
    if (dir.exists) dir.delete();
  },

  async saveRunFile(uri, assetId, name) {
    const dest = new File(assetDir(assetId), name);
    await new File(uri).copy(dest);
    return { path: `${ROOT}/${assetId}/${name}`, size: dest.size };
  },

  async shareUris(items) {
    for (const item of items) {
      await shareAsync(item.uri, {
        mimeType: item.mimeType,
        ...(UTI[item.mimeType] ? { UTI: UTI[item.mimeType] } : {}),
      });
    }
  },

  async saveToPhotos(uris) {
    const permission = await requestPermissionsAsync(true, ['photo']);
    if (!permission.granted) throw new RunError('permissionDenied', { what: 'photos' });
    for (const uri of uris) await Asset.create(uri);
  },

  async print(item) {
    if (item.mimeType === 'application/pdf') {
      await printAsync({ uri: item.uri });
      return;
    }
    // 图片：WKWebView 里不能引用本地文件，内联成 data URI（open-tool-research #17）。
    const base64 = await new File(item.uri).base64();
    await printAsync({
      html: `<html><body style="margin:0"><img style="width:100%" src="data:${item.mimeType};base64,${base64}"></body></html>`,
    });
  },

  async copyText(text) {
    await setStringAsync(text);
  },

  async imageSize(uri) {
    const image = await ImageManipulator.manipulate(uri).renderAsync();
    return { width: image.width, height: image.height };
  },

  async transformImage(uri, ops, save, runId, relPath) {
    const context = ImageManipulator.manipulate(uri);
    if (ops.crop) {
      context.crop({
        originX: Math.round(ops.crop.x),
        originY: Math.round(ops.crop.y),
        width: Math.round(ops.crop.width),
        height: Math.round(ops.crop.height),
      });
    }
    if (ops.resize) context.resize({ width: ops.resize.width, height: ops.resize.height });
    if (ops.rotate) context.rotate(ops.rotate);
    if (ops.flip) context.flip(ops.flip === 'horizontal' ? FlipType.Horizontal : FlipType.Vertical);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      compress: save.quality,
      format: SAVE_FORMATS[save.format],
    });
    const dest = runFile(runId, relPath);
    await new File(saved.uri).move(dest);
    return {
      uri: dest.uri,
      width: saved.width,
      height: saved.height,
      size: new File(dest.uri).size,
    };
  },
};
