import { deskKindOf, type Desk, type DeskFile, type Locale } from '@morph/core';
import { layoutSheet, type DocDoc, type OfficeImport, type TableDoc } from '@morph/tool-office';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
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
import { SheetView } from '../run/SheetView';
import { InlineVideo } from '../share/FileViewer';
import { ZoomImage } from '../share/ZoomImage';
import type { FilePlatform } from '../runtime/platform';
import { deskFileUri } from './store';
import { WordPreview } from './WordPreview';

// 房间的大预览（file-room DESIGN §4、§11.3，D-360）：图片能双指放大；PDF 一页一页左右翻（用「PDF 预览」
// 扩展包把页面画成图，不加原生依赖）；转 Excel / 转 Word 的结果不在这里画，房间直接用编辑器（DeskEditor，D-366）；
// 视频直接播放；外来的 docx / xlsx 在预览页上按读出来的中间格式显示（D-509，取代 §8「第一版不读外来的办公文档」），
// 别的文件（.doc、.pptx 等）用系统预览看。全部只在本机显示，不发给 AI。

/** 预览页上外来的 docx / xlsx（D-509）：还在读、读好的中间格式，或者读不了的原因。只在内存里，什么都不写。 */
export type OfficePreview = 'loading' | OfficeImport;

/** PDF 一页画多大（最长边，像素）：全屏看得清，又不会太占内存。 */
const PDF_SIDE = 1600;
const PDF_QUALITY = 0.8;
/** 当前页前后各留几页画好的（翻页时不用等），更远的放掉。 */
const PDF_KEEP = 2;

export function DeskPreview({
  desk,
  uri: shownUri,
  file,
  files,
  palette,
  locale,
  onSystemPreview,
  wordDoc,
  office,
}: {
  /** 存过的 Word 的中间格式（D-470）：有时按编辑页的版面显示。 */
  wordDoc?: DocDoc | null;
  /** 外来的 docx / xlsx 读出来的样子（D-509）。 */
  office?: OfficePreview | null;
  /** 桌上的文件；预览页（收到的一份文件，不在桌上）改给 `uri`。 */
  desk?: Desk;
  uri?: string;
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
  const uri = shownUri ?? deskFileUri(files, desk!, file.path);
  const kind = deskKindOf(file);
  let body: React.ReactNode = null;
  {
    if (kind === 'image') {
      body = <ZoomImage key={uri} uri={uri} width={size.width} height={size.height} top />;
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
    } else if (wordDoc) {
      body = (
        <WordPreview
          doc={wordDoc}
          width={size.width}
          palette={palette}
          readImage={(u) => files.readUri(u)}
        />
      );
    } else if (office === 'loading') {
      body = <ActivityIndicator style={styles.flex} color={palette.primary} />;
    } else if (office?.ok && office.kind === 'doc') {
      const images = office.images;
      body = (
        <WordPreview
          doc={office.doc}
          width={size.width}
          palette={palette}
          readImage={async (src) => {
            const image = images.get(src);
            if (!image) throw new Error(`no image ${src}`);
            return image.bytes;
          }}
        />
      );
    } else if (office?.ok && office.kind === 'table') {
      body = <TablePreview doc={office.doc} palette={palette} />;
    } else if (kind === 'video') {
      body = <InlineVideo key={uri} uri={uri} height={size.height} />;
    } else {
      const note =
        office && !office.ok && office.error === 'encrypted'
          ? t(locale, 'officeLocked')
          : office && !office.ok && office.error === 'tooLarge'
            ? t(locale, 'officeTooLarge')
            : undefined;
      body = (
        <Generic
          file={file}
          palette={palette}
          locale={locale}
          onSystemPreview={onSystemPreview}
          {...(note ? { note } : {})}
        />
      );
    }
  }
  return (
    <View style={styles.flex} onLayout={onLayout} testID={`desk-preview-${kind}`}>
      {body}
    </View>
  );
}

/** 只有名字、大小和「用系统预览看」（音频、.doc / .pptx 这些、读不了的 docx / xlsx、认不出的文件）。 */
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

/** 外来的 xlsx（D-509）：和桌上的表格编辑器一样的表格视图，只能看；几张工作表时下面有页签。 */
function TablePreview({ doc, palette }: { doc: TableDoc; palette: Palette }) {
  const [index, setIndex] = useState(0);
  const page = doc.pages[Math.min(index, doc.pages.length - 1)];
  const layout = useMemo(() => (page ? layoutSheet(page, doc.scope) : null), [page, doc.scope]);
  if (!layout) return null;
  return (
    <View style={styles.flex} testID="table-preview">
      <SheetView layout={layout} palette={palette} testID="table-preview-sheet" />
      {doc.pages.length > 1 ? (
        <ScrollView
          horizontal
          style={styles.tabs}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRow}>
          {doc.pages.map((p, i) => (
            <Pressable
              key={`sheet-${i}`}
              testID={`table-preview-page-${i}`}
              accessibilityRole="button"
              accessibilityState={{ selected: i === index }}
              onPress={() => setIndex(i)}
              style={[
                styles.tab,
                {
                  borderColor: i === index ? palette.primary : palette.border,
                  backgroundColor: i === index ? palette.primaryTint : palette.surface,
                },
              ]}>
              <Text
                style={[
                  palette.font(i === index ? 'bodyBold' : 'body', 13),
                  { color: palette.text },
                ]}>
                {p.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
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
    const check = () =>
      void packs.store.isInstalled('pdfview').then((ok) => alive && setInstalled(ok));
    check();
    // 别处（例如文件处理包的框，D-456）装好了也要跟着变。
    const stop = packs.store.subscribe(check);
    return () => {
      alive = false;
      stop();
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
                <ZoomImage uri={page} width={width} height={height} top />
              ) : (
                <ActivityIndicator style={styles.flex} color={palette.primary} />
              )}
            </View>
          );
        }}
      />
      {count !== null ? (
        <View style={styles.counter}>
          <Text
            testID="desk-pdf-counter"
            style={[palette.font('bodyBold', 13), styles.counterText]}>
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
  // 页签一行普通高度（横向 ScrollView 默认 flexGrow: 1，同 DeskEditor）。
  tabs: { flexGrow: 0, flexShrink: 0 },
  tabRow: { flexDirection: 'row', gap: 8, padding: 8, alignItems: 'center' },
  tab: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 32,
    justifyContent: 'center',
  },
  note: { textAlign: 'center' },
  // D-488：深色半透明的小药丸，压在页面上也看得清（不跟着主题变，纸是白的）。
  counter: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
    backgroundColor: 'rgba(32,26,22,0.78)',
  },
  counterText: { color: '#FFFFFF' },
});
