import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import type { PickedFile } from '../runtime/platform';

// 新手引导的示例文件（D-149）：第一次用不用先选自己的照片、也不用给相册权限，就能看到快捷操作真的跑通。
// 照片是 scripts/make-guide-photos.py 画的风景（带 GPS 定位，「去掉定位」有东西可去）；
// 合同用 pdf-lib 现场生成，不占安装包。都放在缓存目录，运行时当作「分享进来的文件」交给第一步。

export type SampleKind = 'photos' | 'pdfs';

const PHOTOS = [
  require('../../assets/guide/trip-1.jpg'),
  require('../../assets/guide/trip-2.jpg'),
  require('../../assets/guide/trip-3.jpg'),
];

async function samplePhotos(): Promise<PickedFile[]> {
  const assets = await Asset.loadAsync(PHOTOS);
  return assets.map((asset, i) => {
    const uri = asset.localUri ?? asset.uri;
    return {
      uri,
      name: `trip-${i + 1}.jpg`,
      size: new File(uri).size,
      mimeType: 'image/jpeg',
      width: asset.width ?? 4032,
      height: asset.height ?? 3024,
    };
  });
}

const CONTRACTS: { file: string; title: string; pages: number }[] = [
  { file: 'sample-contract-a.pdf', title: 'Service Agreement', pages: 3 },
  { file: 'sample-contract-b.pdf', title: 'Non-Disclosure Agreement', pages: 2 },
];

/** 一份几页的示例合同：每页大字标着 SAMPLE，不像真的文件。 */
async function contractPdf(title: string, pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText('SAMPLE', {
      x: 120,
      y: 380,
      size: 110,
      font: bold,
      color: rgb(0.93, 0.9, 0.86),
    });
    page.drawText(i === 0 ? title : `${title} (continued)`, {
      x: 60,
      y: 760,
      size: 22,
      font: bold,
    });
    for (let line = 0; line < 22; line++) {
      page.drawText(`${line + 1}. Sample clause text for the Morph guide. Not a real contract.`, {
        x: 60,
        y: 710 - line * 26,
        size: 11,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }
  }
  return doc.save();
}

async function sampleContracts(): Promise<PickedFile[]> {
  const dir = new Directory(Paths.cache, 'guide');
  dir.create({ idempotent: true, intermediates: true });
  const out: PickedFile[] = [];
  for (const c of CONTRACTS) {
    const file = new File(dir, c.file);
    if (!file.exists) file.write(await contractPdf(c.title, c.pages));
    out.push({ uri: file.uri, name: c.file, size: file.size, mimeType: 'application/pdf' });
  }
  return out;
}

export function loadSamples(kind: SampleKind): Promise<PickedFile[]> {
  return kind === 'photos' ? samplePhotos() : sampleContracts();
}

export const isSampleKind = (v: string | undefined): v is SampleKind =>
  v === 'photos' || v === 'pdfs';
