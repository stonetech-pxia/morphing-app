import type { Locale } from '@morph/core';
import type { DocDoc, DocLeaf, DocPage, DocRef } from '@morph/tool-office';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Crop } from './TableEditor';

// 文档视图（D-328，file-room DESIGN §11.4）：按块画一份 DocDoc（标题、段落、列表、表格、图片、并排行、
// 标签和值）。从转 Word 的编辑页拆出来：编辑页和文件房间的大预览共用。只管画和选中，改内容的是用它的那一方；
// 没有传 onPress 时只能看（房间里 R1 只读）。

/** 正文在编辑页里的字号（点）；标题和别的字号按和正文的比例放大缩小。 */
const BODY_PX = 15;
/** 原图截图最高这么多点（和 TableEditor 一样）。 */
const IMAGE_HEIGHT = 160;

export const same = (a: DocRef | null, b: DocRef) =>
  a?.page === b.page && a.block === b.block && a.cell === b.cell && a.item === b.item;

const refId = (at: DocRef) =>
  [at.page, at.block, ...(at.cell !== undefined ? [at.cell, at.item] : [])].join('-');

/** 一个块的样子。 */
function BlockView({
  block,
  page,
  maxWidth,
  palette,
}: {
  block: DocLeaf;
  page: DocPage;
  maxWidth: number;
  palette: Palette;
}) {
  const scale = (size: number | undefined) =>
    Math.round((BODY_PX * (size ?? page.bodySize)) / page.bodySize);
  switch (block.kind) {
    case 'paragraph': {
      const size = block.heading
        ? Math.max(scale(block.size), block.heading === 1 ? 22 : 18)
        : scale(block.size);
      const textStyle = [
        palette.font(block.heading || block.bold ? 'bodyBold' : 'body', size),
        { color: block.color ? `#${block.color}` : palette.text },
      ];
      if (block.tab) {
        // 表单的标签和值（D-332）：每行一对，值从原图里的位置开始。
        const labelWidth = Math.min(0.6, block.tab / Math.max(1, block.box.width)) * maxWidth;
        return (
          <View>
            {block.text.split('\n').map((line, i) => {
              const [label = '', ...rest] = line.split('\t');
              return (
                <View key={i} style={styles.listItem}>
                  <Text style={[textStyle, { width: labelWidth }]}>{label}</Text>
                  <Text style={[textStyle, styles.flex]}>{rest.join(' ')}</Text>
                </View>
              );
            })}
          </View>
        );
      }
      return (
        <Text
          style={[
            palette.font(block.heading || block.bold ? 'bodyBold' : 'body', size),
            {
              color: block.color ? `#${block.color}` : palette.text,
              textAlign: block.align ?? 'left',
            },
          ]}>
          {block.text}
        </Text>
      );
    }
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={[palette.font('body', scale(block.size)), { color: palette.muted }]}>
                {block.ordered
                  ? (block.format ?? '%1.').replace('%1', String((block.start ?? 1) + i))
                  : '•'}
              </Text>
              <Text
                style={[
                  palette.font(block.bold ? 'bodyBold' : 'body', scale(block.size)),
                  styles.flex,
                  { color: block.color ? `#${block.color}` : palette.text },
                ]}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'table': {
      // 只读的预览：每一行按格子的列宽比例排（跨行的格子只在第一行显示字）。
      const { table, colWidths } = block;
      const total = colWidths.reduce((a, b) => a + b, 0) || 1;
      const width = (col: number, span: number) =>
        (colWidths.slice(col, col + span).reduce((a, b) => a + b, 0) / total) * maxWidth;
      return (
        <View style={[styles.table, { borderColor: palette.border }]}>
          {Array.from({ length: table.rows }, (_, r) => (
            <View key={r} style={styles.tableRow}>
              {table.cells
                .filter((c) => c.row <= r && r < c.row + c.rowSpan)
                .map((c) => (
                  <View
                    key={`${c.row}-${c.col}`}
                    style={[
                      styles.tableCell,
                      { width: width(c.col, c.colSpan), borderColor: palette.border },
                    ]}>
                    <Text style={[palette.font('body', 12), { color: palette.text }]}>
                      {c.row === r ? c.text : ''}
                    </Text>
                  </View>
                ))}
            </View>
          ))}
        </View>
      );
    }
    case 'image':
      return block.src ? (
        <Image
          source={{ uri: block.src }}
          contentFit="contain"
          style={{
            width: maxWidth,
            height: Math.min(IMAGE_HEIGHT, (maxWidth * block.box.height) / block.box.width),
          }}
        />
      ) : (
        <Crop page={page} box={block.box} maxWidth={maxWidth} palette={palette} />
      );
  }
}

export function DocView({
  doc,
  palette,
  locale,
  contentWidth,
  selected = null,
  onPress,
}: {
  doc: DocDoc;
  palette: Palette;
  locale: Locale;
  /** 内容区的宽（点）。 */
  contentWidth: number;
  selected?: DocRef | null;
  onPress?: (at: DocRef) => void;
}) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.pages} testID="word-blocks">
      {doc.pages.map((page, p) => (
        <View key={p} style={styles.page}>
          {doc.pages.length > 1 ? (
            <Text style={[palette.font('bodyBold', 12), { color: palette.muted }]}>
              {t(locale, 'tableSheetName', { n: p + 1 })}
            </Text>
          ) : null}
          {page.blocks.map((block, b) => {
            const leaf = (inner: DocLeaf, at: DocRef, maxWidth: number) => {
              const on = same(selected, at);
              return (
                <Pressable
                  key={refId(at)}
                  testID={`word-block-${refId(at)}`}
                  disabled={!onPress}
                  {...(onPress ? { onPress: () => onPress(at) } : {})}
                  style={[
                    styles.block,
                    {
                      borderColor: on ? palette.primary : 'transparent',
                      backgroundColor: on ? palette.primaryTint : 'transparent',
                    },
                  ]}>
                  <BlockView block={inner} page={page} maxWidth={maxWidth} palette={palette} />
                </Pressable>
              );
            };
            if (block.kind !== 'row') {
              return leaf(block, { page: p, block: b }, contentWidth - 12);
            }
            // 并排行：每格的宽按原图里的比例。
            const total = block.cells.reduce((a, c) => a + c.width, 0) || 1;
            return (
              <View key={b} testID={`word-block-${p}-${b}`} style={styles.sideBySide}>
                {block.cells.map((cell, c) => {
                  const width = ((contentWidth - 12) * cell.width) / total;
                  return (
                    <View key={c} style={{ width }}>
                      {cell.blocks.map((inner, i) =>
                        leaf(inner, { page: p, block: b, cell: c, item: i }, width - 12),
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pages: { padding: 10, gap: 24 },
  page: { gap: 6 },
  block: { borderWidth: 2, borderRadius: 6, padding: 4 },
  list: { gap: 4 },
  listItem: { flexDirection: 'row', gap: 6 },
  table: { borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth },
  tableRow: { flexDirection: 'row' },
  tableCell: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 3,
    minHeight: 24,
  },
  sideBySide: { flexDirection: 'row', alignItems: 'flex-start' },
});
