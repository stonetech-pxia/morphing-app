import { getDocumentAsync } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { shareAsync } from 'expo-sharing';

import type { FilePlatform } from './runner';

// FilePlatform 的 Expo 实现。用户文件存放在 App 文档目录的 assets/<id>/<文件名>，
// 数据库只保存相对路径，与配置版本完全分开（§7G）。

const ROOT = 'assets';

function assetDir(assetId: string): Directory {
  const dir = new Directory(Paths.document, ROOT, assetId);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

const fileAt = (path: string) => new File(Paths.document, ...path.split('/'));

/** 照片最长边（D-047）：足够全屏清晰显示，又不会占用太多空间。 */
const MAX_IMAGE_SIDE = 2048;

export const expoFilePlatform: FilePlatform = {
  async pickPdfs() {
    const result = await getDocumentAsync({
      type: 'application/pdf',
      multiple: true,
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
      ...(mimeType === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : {}),
    });
  },
};
