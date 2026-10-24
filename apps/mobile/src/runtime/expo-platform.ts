import { RunError } from '@morph/core';
import { setStringAsync } from 'expo-clipboard';
import { getDocumentAsync } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import {
  UIImagePickerPreferredAssetRepresentationMode,
  VideoExportPreset,
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
  type ImagePickerAsset,
} from 'expo-image-picker';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { printAsync, printToFileAsync } from 'expo-print';
import { shareAsync } from 'expo-sharing';

import {
  FOLDER_NOT_WRITABLE,
  rememberedFolder,
  saveAllToFolder,
  shareAll,
  type ShareDeps,
} from './expo-share';
import { expoTranslate } from './expo-translate';
import { expoBackground } from './expo-background';
import { expoMedia } from './expo-media';
import { expoVision } from './expo-vision';
import MorphShare from '../../modules/morph-share';
import MorphSpeech from '../../modules/morph-speech';
import MorphVision from '../../modules/morph-vision';
import type { FilePlatform, ImageFormat, PickedFile } from './platform';
import { composeOnSurface, enhanceJpeg, pixelsOf, renderTextPng } from './skia';
import { createSpeech } from './speech';
import { expoPackFs, expoSha256 } from '../packs/expo-pack-fs';
import { PackStore } from '../packs/store';

/** 只用来找语音模型的文件（下载由 App 根布局的 PackStore 负责，D-064）。 */
const speechPacks = new PackStore(expoPackFs, expoSha256);

// FilePlatform 的 Expo 实现。用户文件存放在 App 文档目录的 assets/<id>/<文件名>，
// 数据库只保存相对路径，与配置版本完全分开（§7G）。

const ROOT = 'assets';

/** 分享扩展复制进共享目录的文件名（plugins/share-extension/ShareViewController.swift）。 */
const SHARED_COPY = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\.[A-Za-z0-9]+$/i;

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

function pickedVideo(a: ImagePickerAsset): PickedFile {
  const ext =
    a.fileName?.split('.').pop()?.toLowerCase() ?? (a.mimeType === 'video/mp4' ? 'mp4' : 'mov');
  return {
    uri: a.uri,
    name: a.fileName ?? `video-${Date.now()}.${ext}`,
    size: a.fileSize ?? null,
    mimeType: a.mimeType ?? null,
    width: a.width,
    height: a.height,
    ...(a.duration ? { durationMs: a.duration } : {}),
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
  'video/mp4': 'public.mpeg-4',
  'video/quicktime': 'com.apple.quicktime-movie',
  'audio/mp4': 'com.apple.m4a-audio',
};

const shareOne = (item: { uri: string; mimeType: string }) =>
  shareAsync(item.uri, {
    mimeType: item.mimeType,
    ...(UTI[item.mimeType] ? { UTI: UTI[item.mimeType] } : {}),
  });

/** 分享和存到文件夹（D-119、D-120）：有 MorphShare 用它，Expo Go 里退回 expo-sharing / expo-file-system。 */
const SHARE: ShareDeps = {
  native: MorphShare,
  shareOne,
  remembered: null,
  async pickFolder() {
    let dir: Directory;
    try {
      dir = await Directory.pickDirectoryAsync();
    } catch (e) {
      if (/CANCEL/i.test(String((e as { code?: string }).code))) return null;
      throw e;
    }
    return {
      name: dir.name,
      names() {
        try {
          return dir.list().map((entry) => entry.name);
        } catch {
          return [];
        }
      },
      async write(name, mimeType, sourceUri) {
        let file: File;
        try {
          file = dir.createFile(name, mimeType);
        } catch {
          throw Object.assign(new Error('folder not writable'), { code: FOLDER_NOT_WRITABLE });
        }
        file.write(await new File(sourceUri).bytes());
      },
    };
  },
};

/** 照片最长边（D-047）：足够全屏清晰显示，又不会占用太多空间。 */
const MAX_IMAGE_SIDE = 2048;

export const expoFilePlatform: FilePlatform = {
  vision: expoVision((runId, relPath) => runFile(runId, relPath).uri),
  translator: expoTranslate(),
  media: expoMedia((runId, relPath) => runFile(runId, relPath).uri),
  background: expoBackground(),
  // Android 的识别模型在下载内容里（D-151）；iOS 用系统识别，不用下载内容。
  speech: createSpeech(MorphSpeech, {
    isInstalled: (id) => speechPacks.isInstalled(id),
    uri: (id, file) => expoPackFs.uri(speechPacks.path(id, file)),
  }),

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
    await shareOne({ uri: fileAt(path).uri, mimeType });
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

  async pickVideos(max) {
    const result = await launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: max > 1,
      selectionLimit: max,
      orderedSelection: true,
      // 原样拿到视频（HEVC 也不转），不然大视频要在选的时候先等系统转码（D-142）。
      videoExportPreset: VideoExportPreset.Passthrough,
      preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Current,
      shouldDownloadFromNetwork: true,
    });
    if (result.canceled) return null;
    return result.assets.map(pickedVideo);
  },

  async takePhoto() {
    // 开发版里没有相机时（模拟器）系统选择器会抛出原生异常让 App 崩溃，不能靠下面的 catch。
    if (MorphVision && !MorphVision.isCameraAvailable()) throw new RunError('cameraUnavailable');
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

  async adoptIntoRun(uri, runId, fileName) {
    const source = new File(uri);
    // 选择器放在缓存里的副本：移进本次运行的临时目录，运行结束一起删掉。
    if (uri.startsWith(Paths.cache.uri) && source.exists) {
      // 移动之前读大小：移动后新地址的 File 对象读到的可能还是 0。
      const size = source.size;
      const dest = runFile(runId, fileName);
      source.move(dest);
      return { uri: dest.uri, size };
    }
    // 分享进来的（共享目录、content://）：原地使用，不复制（D-116 另外负责删除）。
    let size = 0;
    try {
      size = source.size;
    } catch {
      // content:// 不一定读得到大小，之后由 probe 补上。
    }
    return { uri, size };
  },

  freeDiskBytes() {
    try {
      return Paths.availableDiskSpace;
    } catch {
      return null;
    }
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

  async removeShared(keep = [], copies = []) {
    // 分享扩展把文件复制到 App Group 共享目录的最上层，文件名是 UUID.扩展名。只删这种文件：
    // 共享目录里还有系统的文件（例如容器的元数据，删了系统会重建整个目录）和 Library 子目录。
    const keepNames = new Set(keep.map((uri) => uri.split('/').pop()));
    for (const container of Object.values(Paths.appleSharedContainers ?? {})) {
      for (const entry of container.list()) {
        if (entry instanceof File && SHARED_COPY.test(entry.name) && !keepNames.has(entry.name)) {
          entry.delete();
        }
      }
    }
    for (const uri of copies) {
      const copy = new File(uri);
      if (copy.uri.startsWith(Paths.cache.uri) && copy.exists) copy.delete();
    }
  },

  async saveRunFile(uri, assetId, name) {
    const dest = new File(assetDir(assetId), name);
    await new File(uri).copy(dest);
    return { path: `${ROOT}/${assetId}/${name}`, size: dest.size };
  },

  shareUris: (items) => shareAll(SHARE, items),

  saveToFolder: (items, choose = false) => saveAllToFolder(SHARE, items, choose),

  rememberedFolder: () => rememberedFolder(SHARE),

  async saveToPhotos(uris) {
    const permission = await requestPermissionsAsync(true, ['photo', 'video']);
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

  async loadSignatures() {
    const dir = new Directory(Paths.document, 'signatures');
    if (!dir.exists) return [];
    const files = dir
      .list()
      .filter((e): e is File => e instanceof File && e.name.endsWith('.png'))
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0))
      .slice(0, 3);
    return Promise.all(
      files.map(async (f) => ({
        uri: f.uri,
        bytes: await f.bytes(),
        aspect: Number(/_(\d+(?:\.\d+)?)\.png$/.exec(f.name)?.[1] ?? 3),
      })),
    );
  },

  async saveSignature(png, aspect) {
    const dir = new Directory(Paths.document, 'signatures');
    dir.create({ idempotent: true, intermediates: true });
    // 最多保留 3 个：最旧的删掉。
    const old = dir
      .list()
      .filter((e): e is File => e instanceof File)
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
    for (const f of old.slice(2)) f.delete();
    const file = new File(dir, `${Date.now()}_${aspect.toFixed(3)}.png`);
    file.create();
    file.write(png);
  },

  async renderText(text, style) {
    return renderTextPng(text, style);
  },

  async enhanceImage(uri, mode, runId, relPath) {
    const out = enhanceJpeg(await new File(uri).bytes(), mode);
    const dest = runFile(runId, relPath);
    dest.create();
    dest.write(out.bytes);
    return { uri: dest.uri, width: out.width, height: out.height, size: out.bytes.length };
  },

  async composeImage(canvas, ops, save, runId, relPath) {
    const out = await composeOnSurface(canvas, ops, save, (uri) => new File(uri).bytes());
    const dest = runFile(runId, relPath);
    dest.create();
    dest.write(out.bytes);
    return { uri: dest.uri, width: out.width, height: out.height, size: out.bytes.length };
  },

  async imagePixels(uri, maxSide) {
    return pixelsOf(await new File(uri).bytes(), maxSide);
  },

  async htmlToPdf(html, page, runId, relPath) {
    // iOS 的打印排版不认 CSS 的 @page 边距，要在这里给（单位是点）。
    const printed = await printToFileAsync({
      html,
      width: page.width,
      height: page.height,
      margins: { left: 44, right: 44, top: 40, bottom: 40 },
    });
    const dest = runFile(runId, relPath);
    await new File(printed.uri).move(dest);
    return { uri: dest.uri, size: new File(dest.uri).size, pageCount: printed.numberOfPages };
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
