import type { Locale } from '@morph/core';
import {
  A4_WIDTH_PT,
  leafBlocks,
  type DocBlock,
  type DocDoc,
  type DocLeaf,
  type DocPage,
  type DocRef,
} from '@morph/tool-office';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Crop } from './Crop';

// 文档视图（D-328，file-room DESIGN §11.4）：按块画一份 DocDoc（标题、段落、列表、表格、图片、并排行、
// 标签和值）。从转 Word 的编辑页拆出来：编辑页和文件房间的大预览共用。只管画和选中，改内容的是用它的那一方；
// 没有传 onPress 时只能看。文件房间里（R2，D-366）表格的格子也能点选，就地改这张表（不再弹出转 Excel 的编辑页）。
// 位置（D-464，和 docx 的 D-463 一样对标 CamScanner）：块和块之间按原图里空着的高度空开，靠左的段落、列表、图片
// 按原图里的左边缩进；字号按识别出的大小（标题不再放大）；和字一样长的线画成下划线；印章等图片按原来的大小。

/** 块的上下边界（原图像素）重叠时（位置用不了，例如文字转 Word 的占位框）块之间空这么多点。 */
const PLAIN_GAP = 6;
/** 每块四周选中框的边和内边距（点）：上下一共多出这么多，从原图的空白里扣掉。 */
const BLOCK_EDGE = 2;

/** 一块在编辑页里离上一块多远、往右缩进多少（点）。 */
function placeOf(
  block: DocBlock,
  previous: DocBlock | undefined,
  base: number,
  k: number,
): { top: number; left: number } {
  const top = !previous
    ? 0
    : block.box.y >= previous.box.y + previous.box.height
      ? Math.max(0, (block.box.y - previous.box.y - previous.box.height) * k - 2 * BLOCK_EDGE)
      : PLAIN_GAP;
  const leftAligned =
    block.kind === 'image' ||
    block.kind === 'list' ||
    (block.kind === 'paragraph' && !block.tab && (!block.align || block.align === 'left'));
  return { top: Math.round(top), left: leftAligned ? Math.round((block.box.x - base) * k) : 0 };
}

/** 字号按原件占页宽的比例（D-464，和 CamScanner 一样）；太小时不小于这么多点。 */
const MIN_PX = 7;
/** 纸上的字是深色（纸是白的，不跟着主题）。 */
const INK = '#1A1A1A';

/** 正在页面上直接改的那段字（D-464）：改的就是这一块（表格时是这一格）。 */
export interface InlineEdit {
  at: DocRef;
  cell?: number;
  text: string;
  onChange(text: string): void;
  onEnd(): void;
}
/** 文档里还没剪好的图片块最高这么多点。 */
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
  pageWidth,
  palette,
  cellTestId,
  selectedCell = null,
  onPressCell,
  edit = null,
}: {
  block: DocLeaf;
  page: DocPage;
  maxWidth: number;
  /** 整页在编辑页里有多宽（点）：图片按原来占页宽的比例。 */
  pageWidth: number;
  palette: Palette;
  cellTestId?: string;
  /** 选中的表格格子（table.cells 的下标）。 */
  selectedCell?: number | null;
  onPressCell?: (cell: number) => void;
  /** 这一块正在页面上直接改（表格时 edit.cell 是哪一格）。 */
  edit?: InlineEdit | null;
}) {
  const scale = (size: number | undefined) =>
    Math.max(MIN_PX, Math.round(((size ?? page.bodySize) * pageWidth) / A4_WIDTH_PT));
  // 直接在页面上改（D-464）：同样的字体、字号、位置，换成输入框。
  const inline = (style: object, multiline = true) =>
    edit ? (
      <TextInput
        testID="desk-edit-input"
        autoFocus
        multiline={multiline}
        scrollEnabled={false}
        value={edit.text}
        onChangeText={edit.onChange}
        onBlur={edit.onEnd}
        style={[style, styles.inline]}
      />
    ) : null;
  switch (block.kind) {
    case 'paragraph': {
      // 识别出字号的标题照它的大小（D-463）；没有字号时（旧的结果）照旧放大。
      const size =
        block.heading && !block.size
          ? Math.max(scale(block.size), block.heading === 1 ? 22 : 18)
          : scale(block.size);
      const textStyle = [
        palette.font(block.heading || block.bold ? 'bodyBold' : 'body', size),
        { color: block.color ? `#${block.color}` : INK },
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
      const style = [
        palette.font(block.heading || block.bold ? 'bodyBold' : 'body', size),
        {
          color: block.color ? `#${block.color}` : INK,
          textAlign: block.align ?? 'left',
          ...(block.underline ? { textDecorationLine: 'underline' as const } : {}),
        },
      ];
      return inline(style) ?? <Text style={style}>{block.text}</Text>;
    }
    case 'list':
      return (
        inline([
          palette.font(block.bold ? 'bodyBold' : 'body', scale(block.size)),
          { color: INK },
        ]) ?? (
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
                    { color: block.color ? `#${block.color}` : INK },
                  ]}>
                  {item}
                </Text>
              </View>
            ))}
          </View>
        )
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
                .map((c, i) => ({ c, i }))
                .filter(({ c }) => c.row <= r && r < c.row + c.rowSpan)
                .map(({ c, i }) => {
                  const on = selectedCell === i;
                  return (
                    <Pressable
                      key={`${c.row}-${c.col}`}
                      testID={c.row === r ? `${cellTestId}-${i}` : undefined}
                      disabled={!onPressCell}
                      {...(onPressCell ? { onPress: () => onPressCell(i) } : {})}
                      style={[
                        styles.tableCell,
                        {
                          width: width(c.col, c.colSpan),
                          borderColor: palette.border,
                          ...(on ? { backgroundColor: palette.primaryTint } : {}),
                        },
                      ]}>
                      {c.row === r && edit?.cell === i ? (
                        inline([palette.font('body', scale(undefined)), { color: INK }])
                      ) : (
                        <Text style={[palette.font('body', scale(undefined)), { color: INK }]}>
                          {c.row === r ? c.text : ''}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
            </View>
          ))}
        </View>
      );
    }
    case 'image': {
      // 按原来的大小（不超过能放的宽）。
      const width = Math.min(maxWidth, (block.box.width / page.width) * pageWidth);
      return block.src ? (
        <Image
          source={{ uri: block.src }}
          contentFit="contain"
          style={{
            width,
            height: Math.min(IMAGE_HEIGHT, (width * block.box.height) / block.box.width),
          }}
        />
      ) : (
        <Crop page={page} box={block.box} maxWidth={width} palette={palette} />
      );
    }
  }
}

export function DocView({
  doc,
  palette,
  locale,
  contentWidth,
  selected = null,
  selectedCell = null,
  onPress,
  onPressCell,
  edit = null,
}: {
  doc: DocDoc;
  palette: Palette;
  locale: Locale;
  /** 内容区的宽（点）。 */
  contentWidth: number;
  selected?: DocRef | null;
  /** 选中的块是表格时，选中的是哪一格（table.cells 的下标）。 */
  selectedCell?: number | null;
  onPress?: (at: DocRef) => void;
  /** 点了表格里的一格（就地改，D-366）。 */
  onPressCell?: (at: DocRef, cell: number) => void;
  /** 正在页面上直接改的那一块（D-464）。 */
  edit?: InlineEdit | null;
}) {
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.pages}
      keyboardShouldPersistTaps="handled"
      testID="word-blocks">
      {doc.pages.map((page, p) => {
        const pageWidth = contentWidth - 12;
        const k = pageWidth / Math.max(1, page.width);
        const base = Math.min(...leafBlocks(page).map((b) => b.box.x), page.width);
        return (
          <View key={p} style={[styles.page, styles.paper]}>
            {doc.pages.length > 1 ? (
              <Text style={[palette.font('bodyBold', 12), { color: palette.muted }]}>
                {t(locale, 'tableSheetName', { n: p + 1 })}
              </Text>
            ) : null}
            {page.blocks.map((block, b) => {
              const place = placeOf(block, page.blocks[b - 1], base, k);
              const leaf = (
                inner: DocLeaf,
                at: DocRef,
                maxWidth: number,
                at0: { top: number; left: number } = { top: 0, left: 0 },
              ) => {
                const on = same(selected, at);
                // 缩进后还要放得下这一块原来的宽（字体不同，留一成余量），不把一行字挤到下一行。
                const left = Math.max(0, Math.min(at0.left, maxWidth - inner.box.width * k * 1.1));
                return (
                  <Pressable
                    key={refId(at)}
                    testID={`word-block-${refId(at)}`}
                    disabled={!onPress}
                    {...(onPress ? { onPress: () => onPress(at) } : {})}
                    style={[
                      styles.block,
                      { marginTop: at0.top, marginLeft: left },
                      {
                        borderColor: on ? palette.primary : 'transparent',
                        backgroundColor: on ? palette.primaryTint : 'transparent',
                      },
                    ]}>
                    <BlockView
                      block={inner}
                      page={page}
                      maxWidth={maxWidth - left}
                      pageWidth={pageWidth}
                      palette={palette}
                      cellTestId={`word-cell-${refId(at)}`}
                      selectedCell={on ? selectedCell : null}
                      edit={edit && same(edit.at, at) ? edit : null}
                      {...(onPressCell
                        ? { onPressCell: (cell: number) => onPressCell(at, cell) }
                        : {})}
                    />
                  </Pressable>
                );
              };
              if (block.kind !== 'row') {
                return leaf(block, { page: p, block: b }, pageWidth, place);
              }
              // 并排行：每格的宽按原图里的比例。
              const total = block.cells.reduce((a, c) => a + c.width, 0) || 1;
              return (
                <View
                  key={b}
                  testID={`word-block-${p}-${b}`}
                  style={[styles.sideBySide, { marginTop: place.top }]}>
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
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pages: { padding: 10, gap: 24 },
  page: {},
  // 一页像一张纸（D-464，和 CamScanner 一样）：白底，字是深色，不跟着主题。
  paper: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderRadius: 4,
    boxShadow: '0px 1px 4px rgba(0,0,0,0.12)',
  },
  inline: { padding: 0, margin: 0 },
  block: { borderWidth: 1, borderRadius: 4, padding: BLOCK_EDGE - 1 },
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
