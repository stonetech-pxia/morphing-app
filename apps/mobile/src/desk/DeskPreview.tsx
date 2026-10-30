import { deskKindOf, type Desk, type DeskFile, type Locale } from '@morph/core';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';

import { formatSize } from '../renderer/FileList';
import { Icon } from '../renderer/Icon';
import type { Palette } from '../renderer/theme';
import { Button } from '../renderer/ui';
import { t } from '../i18n';
import { PackGate } from '../packs/PackGate';
import { usePacks } from '../packs/PackHost';
import { InlineVideo } from '../share/FileViewer';
import { ZoomImage } from '../share/ZoomImage';
import type { FilePlatform } from '../runtime/platform';
import { deskFileUri } from './store';

// 房间的大预览（file-room DESIGN §4、§11.3，D-360）：图片能双指放大；PDF 一页一页左右翻（用「PDF 预览」
// 扩展包把页面画成图，不加原生依赖）；转 Excel / 转 Word 的结果不在这里画，房间直接用编辑器（DeskEditor，D-366）；
// 视频直接播放；别的文件（外来的 Word、Excel 等）用系统预览看（§8：第一版不读外来的办公文档）。
// 全部只在本机显示，不发给 AI。

/** PDF 一页画多大（最长边，像素）：全屏看得清，又不会太占内存。 */
const PDF_SIDE = 1600;
const PDF_QUALITY = 0.8;
/** 当前页前后各留几页画好的（翻页时不用等），更远的放掉。 */
const PDF_KEEP = 2;

export function DeskPreview({
  desk,
  file,
  files,
  palette,
  locale,
  onSystemPreview,
}: {
  desk: Desk;
  file: DeskFile;
  files: FilePlatform;
  palette: Palette;
  locale: Locale;
  onSystemPreview: () => void;
}) {
  const window = useWindowDimensions();
  const [measured, setSize] = useState<{ width: number; height: number } | null>(null);
  // 量出预览区的大小之前先按屏幕估（第一帧不留白）。
  const size = measured ?? { width: window.width, height: Math.round(window.height * 0.5) };
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }));
  };
  const uri = deskFileUri(files, desk, file.path);
  const kind = deskKindOf(file);
  let body: React.ReactNode = null;
  {
    if (kind === 'image') {
      body = <ZoomImage key={uri} uri={uri} width={size.width} height={size.height} />;
    } else if (kind === 'pdf') {
      body = (
        <PdfPages
          key={uri}
          uri={uri}
          width={size.width}
          height={size.height}
          palette={palette}
          locale={locale}
          onSystemPreview={onSystemPreview}
        />
      );
    } else if (kind === 'video') {
      body = <InlineVideo key={uri} uri={uri} height={size.height} />;
    } else {
      body = (
        <Generic file={file} palette={palette} locale={locale} onSystemPreview={onSystemPreview} />
      );
    }
  }
  return (
    <View style={styles.flex} onLayout={onLayout} testID={`desk-preview-${kind}`}>
      {body}
    </View>
  );
}

/** 只有名字、大小和「用系统预览看」（音频、外来的办公文档、认不出的文件）。 */
function Generic({
  file,
  palette,
  locale,
  onSystemPreview,
  note,
}: {
  file: DeskFile;
  palette: Palette;
  locale: Locale;
  onSystemPreview: () => void;
  note?: string;
}) {
  return (
    <View style={styles.center} testID="desk-preview-generic">
      <Icon name="document" size={48} color={palette.secondary} />
      <Text numberOfLines={2} style={[palette.font('title', 16), { color: palette.text }]}>
        {`${file.name}.${file.ext}`}
      </Text>
      <Text style={[palette.font('body', 13), { color: palette.caption }]}>
        {formatSize(file.size, locale)}
      </Text>
      <Text style={[palette.font('body', 14), styles.note, { color: palette.muted }]}>
        {note ?? t(locale, 'deskNoPreview')}
      </Text>
      <Button
        palette={palette}
        variant="outline"
        testID="desk-system-preview"
        label={t(locale, 'deskSystemPreview')}
        onPress={onSystemPreview}
      />
    </View>
  );
}

/** PDF 左右翻页：用到哪页画哪页（PDF 预览扩展包），没装时先问要不要下载。 */
function PdfPages({
  uri,
  width,
  height,
  palette,
  locale,
  onSystemPreview,
}: {
  uri: string;
  width: number;
  height: number;
  palette: Palette;
  locale: Locale;
  onSystemPreview: () => void;
}) {
  const packs = usePacks();
  // 没有扩展包功能（测试里没有 PackHost）时当作没装。
  const [installed, setInstalled] = useState<boolean | null>(packs ? null : false);
  const [asking, setAsking] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [pages, setPages] = useState<Map<number, string>>(new Map());
  const [failed, setFailed] = useState(false);
  const loading = useRef(new Set<number>());

  useEffect(() => {
    if (!packs) return;
    let alive = true;
    void packs.store.isInstalled('pdfview').then((ok) => alive && setInstalled(ok));
    return () => {
      alive = false;
    };
  }, [packs]);

  // 画当前页和前后几页；更远的放掉（几十页的 PDF 不全留在内存里）。
  useEffect(() => {
    if (!installed || !packs) return;
    let alive = true;
    const want = [index, index + 1, index - 1, index + 2].filter(
      (i) => i >= 0 && (count === null || i < count) && !pages.has(i) && !loading.current.has(i),
    );
    if (want.length === 0) return;
    for (const i of want) loading.current.add(i);
    void packs.bridge
      .call<{ count: number; pages: { index: number; data: string }[] }>(
        'pdfview',
        'preview',
        { file: 'input', pages: want, maxSide: PDF_SIDE, quality: PDF_QUALITY },
        { input: uri },
      )
      .then(
        (result) => {
          for (const i of want) loading.current.delete(i);
          if (!alive) return;
          setCount(result.count);
          setPages((old) => {
            const next = new Map([...old].filter(([i]) => Math.abs(i - index) <= PDF_KEEP));
            for (const p of result.pages) next.set(p.index, `data:image/jpeg;base64,${p.data}`);
            return next;
          });
        },
        () => {
          for (const i of want) loading.current.delete(i);
          if (alive) setFailed(true);
        },
      );
    return () => {
      alive = false;
    };
  }, [installed, packs, uri, index, count, pages]);

  if (installed === null) return <ActivityIndicator style={styles.flex} color={palette.primary} />;
  if (!installed || failed) {
    return (
      <View style={styles.center} testID="desk-pdf-pack">
        <Icon name="document" size={48} color={palette.secondary} />
        <Text style={[palette.font('body', 14), styles.note, { color: palette.muted }]}>
          {t(locale, failed ? 'deskPageFailed' : 'deskPdfNeedsPack')}
        </Text>
        {!failed && packs ? (
          <Button
            palette={palette}
            testID="desk-pdf-download"
            label={t(locale, 'deskDownload')}
            onPress={() => setAsking(true)}
          />
        ) : null}
        <Button
          palette={palette}
          variant="outline"
          testID="desk-system-preview"
          label={t(locale, 'deskSystemPreview')}
          onPress={onSystemPreview}
        />
        {asking && packs ? (
          <PackGate
            needs={[{ pack: 'pdfview', optional: false }]}
            store={packs.store}
            palette={palette}
            locale={locale}
            onDone={(left) => {
              setAsking(false);
              if (left !== null) setInstalled(true);
            }}
          />
        ) : null}
      </View>
    );
  }
  const total = count ?? 1;
  return (
    <View style={styles.flex} testID="desk-pdf-pages">
      <FlatList
        horizontal
        pagingEnabled
        data={Array.from({ length: total }, (_, i) => i)}
        keyExtractor={(i) => String(i)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))
        }
        renderItem={({ item }) => {
          const page = pages.get(item);
          return (
            <View style={{ width, height }} testID={`desk-pdf-page-${item}`}>
              {page ? (
                <ZoomImage uri={page} width={width} height={height} />
              ) : (
                <ActivityIndicator style={styles.flex} color={palette.primary} />
              )}
            </View>
          );
        }}
      />
      {count !== null ? (
        <View style={[styles.counter, { backgroundColor: palette.surface }]}>
          <Text
            testID="desk-pdf-counter"
            style={[palette.font('bodyBold', 13), { color: palette.text }]}>
            {`${index + 1} / ${count}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  note: { textAlign: 'center' },
  counter: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    opacity: 0.9,
  },
});
