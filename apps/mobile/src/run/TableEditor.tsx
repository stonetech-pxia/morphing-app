import type { Locale, RunItem } from '@morph/core';
import {
  EDITABLE_CELLS,
  canDeleteColumn,
  cellNumber,
  columnName,
  deleteColumn,
  deleteRow,
  deleteTextBlock,
  insertColumn,
  insertRow,
  layoutSheet,
  lineCount,
  pageCellCount,
  pushHistory,
  redo,
  setCellText,
  setScope,
  setTextBlock,
  startHistory,
  undo,
  type Box,
  type SheetCell,
  type TableDoc,
  type TableHistory,
  type TablePage,
} from '@morph/tool-office';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import type { FilePlatform } from '../runtime/platform';
import { loadTableDoc, saveTableEdits } from './table-edit';

// 转 Excel 的查看和编辑（D-272，设计稿 §5）：照着 xlsx 的样子画（列字母、行号、合并格子），
// 点一下选中、再点一下编辑；选中时底部显示原图里这一格的截图，核对认错的字不用切回原图。
// 长按行号插入或删除行，长按列字母插入或删除列；可以切换识别范围、切换页。撤销只在内存里（最多 100 步）。
// 点「完成」或返回时，改过就重新生成 xlsx（新文件）并写回 TableDoc。一页超过 2000 格时只能查看。

/** Excel 的一个字符宽大约这么多点；列宽和行高都限制在手指点得到、又不会太宽的范围。 */
const CHAR_PX = 8;
/** 和 xlsx 一样：没有判断出对齐时是「常规」，数字靠右、文字靠左。 */
const textAlignOf = (cell: SheetCell) =>
  cell.align ?? (cell.cell !== undefined && cellNumber(cell.text) ? 'right' : 'left');
const MIN_COL = 56;
const MAX_COL = 280;
const LINE_PX = 20;
/** 格子左右上下的空白。 */
const CELL_PAD = 4;
const MIN_ROW = 32;
const ROW_HEAD = 40;
const COL_HEAD = 28;
/** 原图截图最高这么多点。 */
const CROP_HEIGHT = 140;

interface MenuOption {
  label: string;
  danger?: boolean;
  run: () => void;
}

/** 原图里一格的截图：整张图按比例放大，只露出这一格（四周多留一点）。转 Word 的编辑页也用（D-328）。 */
export function Crop({
  page,
  box,
  maxWidth,
  palette,
}: {
  page: Pick<TablePage, 'source' | 'width' | 'height'>;
  box: Box;
  maxWidth: number;
  palette: Palette;
}) {
  const padX = Math.min(box.width * 0.08, 20);
  const padY = Math.min(box.height * 0.15, 12);
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const w = Math.min(page.width - x, box.width + 2 * padX);
  const h = Math.min(page.height - y, box.height + 2 * padY);
  if (w <= 0 || h <= 0) return null;
  const scale = Math.min(maxWidth / w, CROP_HEIGHT / h);
  return (
    <View
      testID="table-crop"
      style={{
        width: w * scale,
        height: h * scale,
        overflow: 'hidden',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: palette.border,
      }}>
      <Image
        source={{ uri: page.source }}
        contentFit="fill"
        style={{
          position: 'absolute',
          left: -x * scale,
          top: -y * scale,
          width: page.width * scale,
          height: page.height * scale,
        }}
      />
    </View>
  );
}

export function TableEditor({
  item,
  files,
  runId,
  palette,
  locale,
  onClose,
  onSaved,
  inMemory,
}: {
  item: RunItem;
  files: FilePlatform;
  runId: string;
  palette: Palette;
  locale: Locale;
  /** 没有改动时关闭。 */
  onClose: () => void;
  /** 改过、已经写好新的 xlsx：换掉结果里的这一项。 */
  onSaved: (next: RunItem) => void;
  /**
   * 转 Word 的表格（D-328）：编辑内存里的这份 TableDoc（只有一张表），不读写文件；
   * 改过时点「完成」交回 onDone（不调用 onSaved）。
   */
  inMemory?: { doc: TableDoc; onDone: (doc: TableDoc) => void };
}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [original, setOriginal] = useState<TableDoc | null>(null);
  const [history, setHistory] = useState<TableHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<{ block: number; cell?: number } | null>(null);
  const [editing, setEditing] = useState<{ block: number; cell?: number; text: string } | null>(
    null,
  );
  const [menu, setMenu] = useState<{ title: string; options: MenuOption[] } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (inMemory ? Promise.resolve(inMemory.doc) : loadTableDoc(files, item))
      .then((doc) => {
        if (!alive) return;
        setOriginal(doc);
        setHistory(startHistory(doc));
      })
      .catch((e: unknown) => alive && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      alive = false;
    };
    // 只在打开时读一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doc = history?.present ?? null;
  const page = doc?.pages[pageIndex] ?? null;
  const layout = useMemo(() => (doc && page ? layoutSheet(page, doc.scope) : null), [doc, page]);
  const readOnly = doc ? pageCellCount(doc, pageIndex) > EDITABLE_CELLS : false;

  const colPx = useMemo(
    () =>
      layout?.colWidths.map((w) => Math.round(Math.min(MAX_COL, Math.max(MIN_COL, w * CHAR_PX)))) ??
      [],
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
    const out = layout?.rows.map((r) => Math.max(MIN_ROW, r.lines * LINE_PX + 10)) ?? [];
    for (const cell of layout?.cells ?? []) {
      if (cell.cell !== undefined) continue;
      const lines = lineCount(cell.text, (textWidth - 2 * CELL_PAD) / CHAR_PX);
      out[cell.row] = Math.max(MIN_ROW, lines * LINE_PX + 10);
    }
    return out;
  }, [layout, textWidth]);
  const rowAt = useMemo(() => {
    const out = [0];
    for (const h of rowPx) out.push(out.at(-1)! + h);
    return out;
  }, [rowPx]);

  const apply = (next: TableDoc, keepSelection = false) => {
    if (!history) return;
    setHistory(pushHistory(history, next));
    if (!keepSelection) setSelected(null);
  };

  const selectedCell =
    selected && layout
      ? (layout.cells.find((c) => c.block === selected.block && c.cell === selected.cell) ?? null)
      : null;

  function currentText(cell: SheetCell): string {
    const block = page!.blocks[cell.block]!;
    if (block.kind === 'text') return block.text;
    return block.cells[cell.cell!]?.text ?? '';
  }

  function pressCell(cell: SheetCell) {
    const same = selected?.block === cell.block && selected.cell === cell.cell;
    if (same && !readOnly) {
      setEditing({
        block: cell.block,
        ...(cell.cell !== undefined ? { cell: cell.cell } : {}),
        text: currentText(cell),
      });
      return;
    }
    setSelected({ block: cell.block, ...(cell.cell !== undefined ? { cell: cell.cell } : {}) });
  }

  function commitEdit() {
    if (!editing || !doc) return;
    const next =
      editing.cell !== undefined
        ? setCellText(doc, { page: pageIndex, block: editing.block }, editing.cell, editing.text)
        : setTextBlock(doc, pageIndex, editing.block, editing.text);
    apply(next, true);
    setEditing(null);
  }

  function rowMenu(r: number) {
    if (readOnly || !doc || !layout || !page) return;
    const row = layout.rows[r]!;
    if (row.block === null) return;
    const at = { page: pageIndex, block: row.block };
    const block = page.blocks[row.block]!;
    if (block.kind === 'text') {
      setMenu({
        title: String(r + 1),
        options: [
          {
            label: t(locale, 'tableDeleteText'),
            danger: true,
            run: () => apply(deleteTextBlock(doc, pageIndex, row.block!)),
          },
        ],
      });
      return;
    }
    const tr = row.tableRow!;
    setMenu({
      title: String(r + 1),
      options: [
        { label: t(locale, 'tableInsertRowAbove'), run: () => apply(insertRow(doc, at, tr)) },
        { label: t(locale, 'tableInsertRowBelow'), run: () => apply(insertRow(doc, at, tr + 1)) },
        ...(block.rows > 1
          ? [
              {
                label: t(locale, 'tableDeleteRow'),
                danger: true,
                run: () => apply(deleteRow(doc, at, tr)),
              },
            ]
          : []),
      ],
    });
  }

  function columnMenu(c: number) {
    if (readOnly || !doc || !page) return;
    // 一页的列是各张表共用的（D-272）：插入和删除对整页，经过这一列的每张表都跟着变。
    if (!page.blocks.some((b) => b.kind === 'table') || c >= page.colWidths.length) return;
    setMenu({
      title: columnName(c),
      options: [
        {
          label: t(locale, 'tableInsertColumnLeft'),
          run: () => apply(insertColumn(doc, pageIndex, c)),
        },
        {
          label: t(locale, 'tableInsertColumnRight'),
          run: () => apply(insertColumn(doc, pageIndex, c + 1)),
        },
        ...(canDeleteColumn(page, c)
          ? [
              {
                label: t(locale, 'tableDeleteColumn'),
                danger: true,
                run: () => apply(deleteColumn(doc, pageIndex, c)),
              },
            ]
          : []),
      ],
    });
  }

  async function finish() {
    if (saving) return;
    if (!history || !original || history.present === original) {
      onClose();
      return;
    }
    if (inMemory) {
      inMemory.onDone(history.present);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveTableEdits(files, runId, item, history.present));
    } catch (e) {
      setError(t(locale, 'tableSaveFailed', { error: String(e instanceof Error ? e.message : e) }));
      setSaving(false);
    }
  }

  const headerButton = (
    id: string,
    label: string,
    onPress: () => void,
    disabled = false,
    bold = false,
  ) => (
    <Pressable
      testID={id}
      accessibilityRole="button"
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: disabled ? 0.35 : pressed ? 0.6 : 1 })}>
      <Text style={[palette.font(bold ? 'bodyBold' : 'body', 16), { color: palette.primaryText }]}>
        {label}
      </Text>
    </Pressable>
  );

  const toggle = (id: string, label: string, on: boolean, onPress: () => void) => (
    <Pressable
      key={id}
      testID={id}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[
        styles.toggle,
        {
          borderColor: on ? palette.primary : palette.border,
          backgroundColor: on ? palette.primaryTint : palette.surface,
        },
      ]}>
      <Text
        style={[
          palette.font(on ? 'bodyBold' : 'body', 13),
          { color: on ? palette.primaryText : palette.text },
        ]}>
        {label}
      </Text>
    </Pressable>
  );

  const sheetWidth = ROW_HEAD + (colAt.at(-1) ?? 0);
  const sheetHeight = COL_HEAD + (rowAt.at(-1) ?? 0);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={finish}>
      <KeyboardAvoidingView
        behavior="padding"
        style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}
        testID="table-editor">
        <View style={[styles.header, { borderColor: palette.border }]}>
          <Text
            numberOfLines={1}
            style={[palette.font('title', 16), styles.flex, { color: palette.text }]}>
            {`${item.name}.${item.ext}`}
          </Text>
          {headerButton(
            'table-undo',
            t(locale, 'undo'),
            () => history && setHistory(undo(history)),
            !history?.past.length,
          )}
          {headerButton(
            'table-redo',
            t(locale, 'tableRedo'),
            () => history && setHistory(redo(history)),
            !history?.future.length,
          )}
          {saving ? (
            <ActivityIndicator color={palette.primary} />
          ) : (
            headerButton('table-done', t(locale, 'done'), () => void finish(), false, true)
          )}
        </View>
        <Text
          testID="table-hint"
          style={[
            palette.font('body', 13),
            styles.hint,
            { color: palette.muted, backgroundColor: palette.primaryTint },
          ]}>
          {readOnly
            ? t(locale, 'tableReadOnly', { max: EDITABLE_CELLS })
            : t(locale, 'tableEditorHint')}
        </Text>
        {error ? (
          <Text
            testID="table-error"
            style={[palette.font('bodyMedium', 14), styles.hint, { color: palette.danger }]}>
            {error}
          </Text>
        ) : null}

        {!doc || !layout ? (
          error ? (
            <View style={styles.flex} />
          ) : (
            <ActivityIndicator style={styles.flex} color={palette.primary} />
          )
        ) : layout.cells.length === 0 ? (
          <Text style={[palette.font('body', 15), styles.empty, { color: palette.muted }]}>
            {t(locale, 'tableEmpty')}
          </Text>
        ) : (
          <ScrollView horizontal style={styles.flex} testID="table-sheet">
            <ScrollView stickyHeaderIndices={[0]} contentContainerStyle={{ width: sheetWidth }}>
              {/* 列字母（上下滚动时停在顶上）。按位置摆：iOS 上停靠的那一行不按 flexDirection 排。 */}
              <View
                style={[styles.colHeads, { width: sheetWidth, backgroundColor: palette.surface }]}>
                {colPx.map((w, c) => (
                  <Pressable
                    key={c}
                    testID={`table-col-${c}`}
                    onLongPress={() => columnMenu(c)}
                    style={[
                      styles.head,
                      styles.abs,
                      { left: ROW_HEAD + colAt[c]!, top: 0, width: w, borderColor: palette.border },
                    ]}>
                    <Text style={[palette.font('bodyBold', 12), { color: palette.muted }]}>
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
                    onLongPress={() => rowMenu(r)}
                    style={[
                      styles.head,
                      styles.abs,
                      {
                        left: 0,
                        top: rowAt[r]!,
                        width: ROW_HEAD,
                        height: h,
                        borderColor: palette.border,
                        backgroundColor: palette.surface,
                      },
                    ]}>
                    <Text style={[palette.font('bodyBold', 12), { color: palette.muted }]}>
                      {r + 1}
                    </Text>
                  </Pressable>
                ))}
                {layout.cells.map((cell) => {
                  const left = ROW_HEAD + colAt[cell.col]!;
                  const top = rowAt[cell.row]!;
                  const table = cell.cell !== undefined;
                  const width = table
                    ? colAt[Math.min(cell.col + cell.colSpan, colPx.length)]! - colAt[cell.col]!
                    : textWidth;
                  const height = rowAt[Math.min(cell.row + cell.rowSpan, rowPx.length)]! - top;
                  const on = selectedCell === cell;
                  return (
                    <Pressable
                      key={`${cell.block}-${cell.cell ?? 't'}`}
                      testID={`table-cell-${cell.row}-${cell.col}`}
                      onPress={() => pressCell(cell)}
                      style={[
                        styles.abs,
                        styles.cell,
                        {
                          left,
                          top,
                          width,
                          height,
                          borderColor: on
                            ? palette.primary
                            : table
                              ? palette.border
                              : 'transparent',
                          borderWidth: on ? 2 : StyleSheet.hairlineWidth,
                          backgroundColor: palette.surface,
                        },
                      ]}>
                      <Text
                        {...(table
                          ? { numberOfLines: Math.max(1, Math.floor((height - 8) / LINE_PX)) }
                          : {})}
                        style={[
                          palette.font('body', 13),
                          { color: palette.text, textAlign: textAlignOf(cell) },
                        ]}>
                        {cell.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </ScrollView>
        )}

        <View
          style={[
            styles.bottom,
            {
              borderColor: palette.border,
              backgroundColor: palette.surface,
              paddingBottom: insets.bottom + 10,
            },
          ]}>
          {editing ? (
            <>
              <Text style={[palette.font('bodyBold', 14), { color: palette.text }]}>
                {t(locale, editing.cell !== undefined ? 'tableEditCell' : 'tableEditText')}
              </Text>
              <TextInput
                testID="table-edit-input"
                autoFocus
                multiline
                value={editing.text}
                onChangeText={(text) => setEditing({ ...editing, text })}
                style={[
                  palette.font('body', 15),
                  styles.input,
                  { color: palette.text, borderColor: palette.border },
                ]}
              />
              <View style={styles.row}>
                {headerButton('table-edit-cancel', t(locale, 'cancel'), () => setEditing(null))}
                {headerButton('table-edit-ok', t(locale, 'ok'), commitEdit, false, true)}
              </View>
            </>
          ) : (
            <>
              {selectedCell && page ? (
                <View style={styles.source}>
                  <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
                    {t(locale, 'tableSource')}
                  </Text>
                  {(() => {
                    const block = page.blocks[selectedCell.block]!;
                    const box =
                      block.kind === 'table' ? block.cells[selectedCell.cell!]?.box : block.box;
                    return box ? (
                      <Crop page={page} box={box} maxWidth={screenWidth - 32} palette={palette} />
                    ) : (
                      <Text style={[palette.font('body', 13), { color: palette.muted }]}>
                        {t(locale, 'tableNoSource')}
                      </Text>
                    );
                  })()}
                </View>
              ) : null}
              {/* 转 Word 的表格只有这一张表，没有表外的文字，不用切换识别范围。 */}
              {doc && !inMemory ? (
                <View style={styles.row}>
                  {toggle(
                    'table-scope-tables',
                    t(locale, 'tableScopeTables'),
                    doc.scope === 'tables',
                    () => apply(setScope(doc, 'tables'), true),
                  )}
                  {toggle('table-scope-all', t(locale, 'tableScopeAll'), doc.scope === 'all', () =>
                    apply(setScope(doc, 'all'), true),
                  )}
                </View>
              ) : null}
              {doc && doc.pages.length > 1 ? (
                <ScrollView horizontal contentContainerStyle={styles.row}>
                  {doc.pages.map((p, i) =>
                    toggle(`table-page-${i}`, p.name, i === pageIndex, () => {
                      setPageIndex(i);
                      setSelected(null);
                    }),
                  )}
                </ScrollView>
              ) : null}
            </>
          )}
        </View>

        {menu ? (
          <View style={[StyleSheet.absoluteFill, styles.menuRoot]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setMenu(null)}
              testID="table-menu-backdrop"
            />
            <View
              style={[
                styles.menu,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                  paddingBottom: insets.bottom + 8,
                },
              ]}>
              <Text style={[palette.font('bodyBold', 14), { color: palette.muted }]}>
                {menu.title}
              </Text>
              {menu.options.map((o, i) => (
                <Pressable
                  key={o.label}
                  testID={`table-menu-${i}`}
                  onPress={() => {
                    setMenu(null);
                    o.run();
                  }}
                  style={styles.menuItem}>
                  <Text
                    style={[
                      palette.font('body', 16),
                      { color: o.danger ? palette.danger : palette.text },
                    ]}>
                    {o.label}
                  </Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setMenu(null)} style={styles.menuItem}>
                <Text style={[palette.font('bodyBold', 16), { color: palette.primaryText }]}>
                  {t(locale, 'cancel')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hint: { paddingHorizontal: 16, paddingVertical: 8 },
  empty: { flex: 1, padding: 24, textAlign: 'center' },
  colHeads: { height: COL_HEAD },
  head: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    height: COL_HEAD,
  },
  abs: { position: 'absolute' },
  cell: { paddingHorizontal: CELL_PAD, paddingVertical: CELL_PAD },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  source: { gap: 6 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'flex-start' },
  toggle: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 36,
    justifyContent: 'center',
  },
  input: {
    minHeight: 80,
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    textAlignVertical: 'top',
  },
  menuRoot: { justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  menu: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  menuItem: { minHeight: 48, justifyContent: 'center' },
});
