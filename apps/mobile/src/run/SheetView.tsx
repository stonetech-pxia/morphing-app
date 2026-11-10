import {
  DEFAULT_FONT_SIZE,
  LINE_POINTS,
  cellNumber,
  columnName,
  lineCountAt,
  type SheetCell,
  type SheetLayout,
} from '@morph/tool-office';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { Palette } from '../renderer/theme';

// 表格视图（D-272，file-room DESIGN §11.4）：照着 xlsx 的样子画一页 TableDoc（列字母、行号、合并格子）。
// 从转 Excel 的编辑页拆出来：编辑页和文件房间的大预览共用。只管画和选中，改内容的是用它的那一方；
// 没有传回调时只能看（房间里 R1 只读）。

/** Excel 的一个字符宽大约这么多点；列宽和行高都限制在手指点得到、又不会太宽的范围。 */
const CHAR_PX = 8;
/** 和 xlsx 一样：没有判断出对齐时是「常规」，数字靠右、文字靠左。 */
const textAlignOf = (cell: SheetCell) =>
  cell.align ?? (cell.cell !== undefined && cellNumber(cell.text) ? 'right' : 'left');
/** 格子里的字号（点）：11 磅的字画 13，别的按比例，不小于 9、不大于 28。 */
const screenFont = (cell: SheetCell) =>
  Math.round(
    Math.min(28, Math.max(9, (13 * (cell.size ?? DEFAULT_FONT_SIZE)) / DEFAULT_FONT_SIZE)),
  );
const MIN_COL = 56;
const MAX_COL = 280;
const LINE_PX = 20;
/** 格子左右上下的空白。 */
const CELL_PAD = 4;
const MIN_ROW = 32;
const ROW_HEAD = 40;
const COL_HEAD = 28;

export function SheetView({
  layout,
  palette,
  selected = null,
  onPressCell,
  onLongPressRow,
  onLongPressColumn,
  testID = 'table-sheet',
}: {
  layout: SheetLayout;
  palette: Palette;
  /** 选中的格子（画粗边框）。 */
  selected?: SheetCell | null;
  onPressCell?: (cell: SheetCell) => void;
  onLongPressRow?: (row: number) => void;
  onLongPressColumn?: (col: number) => void;
  testID?: string;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const colPx = useMemo(
    () =>
      layout.colWidths.map((w) => Math.round(Math.min(MAX_COL, Math.max(MIN_COL, w * CHAR_PX)))),
    [layout],
  );
  const colAt = useMemo(() => {
    const out = [0];
    for (const w of colPx) out.push(out.at(-1)! + w);
    return out;
  }, [colPx]);
  // 表外的文字整行合并，但不比屏幕宽（表格列多时整行比屏幕宽很多，居中的字会跑到屏幕两边外面）；
  // 这一行的行高按这个宽度折出来的行数算（按 Excel 列宽估的行数和这里对不上）。
  const textWidth = Math.max(MIN_COL, Math.min(colAt.at(-1) ?? 0, screenWidth - ROW_HEAD));
  const rowPx = useMemo(() => {
    // 行高按行里最高的格子（磅，按字号）：11 磅的一行是 LINE_PX 个点。
    const out = layout.rows.map((r) => Math.max(MIN_ROW, (r.points / LINE_POINTS) * LINE_PX + 10));
    for (const cell of layout.cells) {
      // 整行合并的文字按屏幕宽折行重算（按 Excel 列宽估的行数和这里对不上）；有列范围的文字、
      // 并排一带里的文字（合并了几行）、图片不改行高。
      if (cell.cell !== undefined || cell.image || cell.colSpan < colPx.length || cell.rowSpan > 1)
        continue;
      const size = cell.size ?? DEFAULT_FONT_SIZE;
      const lines = lineCountAt(cell.text, (textWidth - 2 * CELL_PAD) / CHAR_PX, size);
      out[cell.row] = Math.max(MIN_ROW, ((lines * size) / DEFAULT_FONT_SIZE) * LINE_PX + 10);
    }
    return out;
  }, [layout, textWidth, colPx.length]);
  const rowAt = useMemo(() => {
    const out = [0];
    for (const h of rowPx) out.push(out.at(-1)! + h);
    return out;
  }, [rowPx]);

  const sheetWidth = ROW_HEAD + (colAt.at(-1) ?? 0);
  const sheetHeight = COL_HEAD + (rowAt.at(-1) ?? 0);

  return (
    <ScrollView horizontal style={styles.flex} testID={testID}>
      <ScrollView stickyHeaderIndices={[0]} contentContainerStyle={{ width: sheetWidth }}>
        {/* 列字母（上下滚动时停在顶上）。按位置摆：iOS 上停靠的那一行不按 flexDirection 排。 */}
        <View style={[styles.colHeads, { width: sheetWidth, backgroundColor: palette.background }]}>
          {colPx.map((w, c) => (
            <Pressable
              key={c}
              testID={`table-col-${c}`}
              {...(onLongPressColumn ? { onLongPress: () => onLongPressColumn(c) } : {})}
              style={[
                styles.head,
                styles.abs,
                {
                  left: ROW_HEAD + colAt[c]!,
                  top: 0,
                  width: w,
                  borderColor: palette.border,
                  // D-488：选中的格子所在的列和行，表头换成浅主色。
                  ...(selected?.col === c ? { backgroundColor: palette.primaryTint } : {}),
                },
              ]}>
              <Text
                style={[
                  palette.font('bodyBold', 12),
                  { color: selected?.col === c ? palette.primaryText : palette.muted },
                ]}>
                {columnName(c)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ width: sheetWidth, height: sheetHeight - COL_HEAD }}>
          {rowPx.map((h, r) => (
            <Pressable
              key={`r${r}`}
              testID={`table-row-${r}`}
              {...(onLongPressRow ? { onLongPress: () => onLongPressRow(r) } : {})}
              style={[
                styles.head,
                styles.abs,
                {
                  left: 0,
                  top: rowAt[r]!,
                  width: ROW_HEAD,
                  height: h,
                  borderColor: palette.border,
                  backgroundColor: selected?.row === r ? palette.primaryTint : palette.background,
                },
              ]}>
              <Text
                style={[
                  palette.font('bodyBold', 12),
                  { color: selected?.row === r ? palette.primaryText : palette.muted },
                ]}>
                {r + 1}
              </Text>
            </Pressable>
          ))}
          {layout.cells.map((cell) => {
            const left = ROW_HEAD + colAt[cell.col]!;
            const top = rowAt[cell.row]!;
            const table = cell.cell !== undefined;
            // 横跨整页的文字不比屏幕宽；有列范围的文字、图片按它占的列。
            const width =
              table || cell.image || cell.colSpan < colPx.length
                ? colAt[Math.min(cell.col + cell.colSpan, colPx.length)]! - colAt[cell.col]!
                : textWidth;
            const height = rowAt[Math.min(cell.row + cell.rowSpan, rowPx.length)]! - top;
            const on = selected === cell;
            return (
              <Pressable
                key={`${cell.block}-${cell.cell ?? 't'}`}
                testID={`table-cell-${cell.row}-${cell.col}`}
                disabled={!onPressCell}
                {...(onPressCell ? { onPress: () => onPressCell(cell) } : {})}
                style={[
                  styles.abs,
                  styles.cell,
                  {
                    left,
                    top,
                    width,
                    height,
                    borderColor: on ? palette.primary : table ? palette.border : 'transparent',
                    borderWidth: on ? 2 : StyleSheet.hairlineWidth,
                    backgroundColor: on ? palette.primaryTint : palette.surface,
                  },
                ]}>
                {cell.image ? (
                  // 从原图剪下来的图片（D-520）；还没有剪出来时只留一个框。
                  cell.image.src ? (
                    <Image
                      testID={`table-image-${cell.row}-${cell.col}`}
                      source={{ uri: cell.image.src }}
                      style={{ width: width - 2 * CELL_PAD, height: height - 2 * CELL_PAD }}
                      contentFit="contain"
                    />
                  ) : null
                ) : (
                  <Text
                    {...(table
                      ? { numberOfLines: Math.max(1, Math.floor((height - 8) / LINE_PX)) }
                      : {})}
                    style={[
                      palette.font(
                        cell.bold ? 'bodyBold' : on ? 'bodyMedium' : 'body',
                        screenFont(cell),
                      ),
                      { color: palette.text, textAlign: textAlignOf(cell) },
                    ]}>
                    {cell.text}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  colHeads: { height: COL_HEAD },
  head: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    height: COL_HEAD,
  },
  abs: { position: 'absolute' },
  cell: { paddingHorizontal: CELL_PAD, paddingVertical: CELL_PAD },
});
