import { getDocumentAsync } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
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

  async share(path, mimeType) {
    await shareAsync(fileAt(path).uri, {
      mimeType,
      ...(mimeType === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : {}),
    });
  },
};
