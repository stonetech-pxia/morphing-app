import { leafBlocks, type DocDoc } from '@morph/tool-office';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { Palette } from '../renderer/theme';
import { jpegDataUrl, wordPageHtml } from './word-page';

// 预览页上的 Word（D-470）：Tinkrum 转出来、存过的 Word 按编辑页的版面显示（只能看），不再是「这个文件显示不了」
// （Android 系统不会显示 Word）。页面是我们自己生成的固定 HTML，不联网。

export function WordPreview({
  doc,
  width,
  palette,
  readImage,
}: {
  doc: DocDoc;
  width: number;
  palette: Palette;
  readImage: (uri: string) => Promise<Uint8Array>;
}) {
  const [images, setImages] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    const srcs = [
      ...new Set(
        doc.pages.flatMap((p) =>
          leafBlocks(p).flatMap((b) => (b.kind === 'image' && b.src ? [b.src] : [])),
        ),
      ),
    ];
    void Promise.all(
      srcs.map((src) =>
        readImage(src).then(
          (bytes) => [src, jpegDataUrl(bytes)] as const,
          () => null,
        ),
      ),
    ).then((pairs) => {
      if (alive) setImages(Object.fromEntries(pairs.filter((p) => p !== null)));
    });
    return () => {
      alive = false;
    };
    // 文档换了才重读；读文件的函数每次渲染都是新的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  const html = useMemo(
    () => (images ? wordPageHtml(doc, width, images, false, null, true) : null),
    [doc, width, images],
  );
  if (!html) return <ActivityIndicator style={styles.flex} color={palette.primary} />;
  return (
    <View style={styles.flex}>
      <WebView
        testID="word-preview-page"
        style={styles.flex}
        source={{ html, baseUrl: 'about:blank' }}
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith('data:')}
        javaScriptEnabled={false}
        allowFileAccess={false}
        setSupportMultipleWindows={false}
        textZoom={100}
      />
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
