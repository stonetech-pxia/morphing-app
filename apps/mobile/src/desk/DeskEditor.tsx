import type { Locale } from '@morph/core';
import {
  EDITABLE_CELLS,
  blockAt,
  blockText,
  canDeleteColumn,
  deleteBlock,
  deleteColumn,
  deleteRow,
  deleteTextBlock,
  editDocTable,
  insertColumn,
  insertRow,
  layoutSheet,
  pageCellCount,
  setBlockText,
  setCellText,
  setScope,
  setTextBlock,
  tableDocOf,
  type Box,
  type DocDoc,
  type DocRef,
  type SheetCell,
  type TableDoc,
} from '@morph/tool-office';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { t, type StringKey } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Crop } from '../run/Crop';
import { DocView, same } from '../run/DocView';
import { SheetView } from '../run/SheetView';

// 桌上的 Excel、Word 就是编辑器（file-room §11.3，D-366）：大预览就是表格视图、文档视图，点一下选中、
// 再点一下编辑。选中时下面换成编辑层：原图里这一块的截图，加上对它有用的操作（编辑、插删行列、删除）；
// 房间的工具栏这时收起来（编辑层不进工具栏配置，AI 改不了）。docx 里的表格就地改，不再弹出一个编辑页。
// 一页超过 2000 格时只能看（D-272）。改动交给 onApply，记撤销、合成版本的是房间（useDeskEdit）。

type Selection =
  { kind: 'sheet'; block: number; cell?: number } | { kind: 'doc'; at: DocRef; cell?: number };

interface EditLayerAction {
  id: string;
  label: StringKey;
  danger?: boolean;
  run: () => void;
}

export function DeskEditor({
  kind,
  doc,
  palette,
  locale,
  width,
  onApply,
  onSelecting,
}: {
  kind: 'table' | 'doc';
  doc: TableDoc | DocDoc;
  palette: Palette;
  locale: Locale;
  /** 编辑器的宽（点）。 */
  width: number;
  onApply: (next: TableDoc | DocDoc) => void;
  /** 选中了东西（房间收起工具栏，换成编辑层）。 */
  onSelecting: (on: boolean) => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<{ text: string } | null>(null);

  const table = kind === 'table' ? (doc as TableDoc) : null;
  const word = kind === 'doc' ? (doc as DocDoc) : null;
  const pages = table?.pages.length ?? 0;
  const page = table?.pages[Math.min(pageIndex, Math.max(0, pages - 1))] ?? null;
  const layout = useMemo(
    () => (table && page ? layoutSheet(page, table.scope) : null),
    [table, page],
  );
  const readOnly = table ? pageCellCount(table, pageIndex) > EDITABLE_CELLS : false;

  useEffect(() => {
    onSelecting(selected !== null);
  }, [selected, onSelecting]);
  // 换成别的文件（撤销到照片、切文件）时编辑器不在了：工具栏要回来。
  useEffect(() => () => onSelecting(false), [onSelecting]);

  const clear = () => {
    setSelected(null);
    setEditing(null);
  };
  const apply = (next: TableDoc | DocDoc, keep = false) => {
    onApply(next);
    if (!keep) clear();
  };

  // ---- 表格（转 Excel） ----
  const sheetCell =
    selected?.kind === 'sheet' && layout
      ? (layout.cells.find((c) => c.block === selected.block && c.cell === selected.cell) ?? null)
      : null;

  function sheetText(sel: { block: number; cell?: number }): string {
    const block = page!.blocks[sel.block]!;
    if (block.kind === 'text') return block.text;
    return block.cells[sel.cell!]?.text ?? '';
  }

  function pressSheetCell(cell: SheetCell) {
    const sel = { block: cell.block, ...(cell.cell !== undefined ? { cell: cell.cell } : {}) };
    if (
      selected?.kind === 'sheet' &&
      selected.block === cell.block &&
      selected.cell === cell.cell
    ) {
      setEditing({ text: sheetText(sel) });
      return;
    }
    setEditing(null);
    setSelected({ kind: 'sheet', ...sel });
  }

  function sheetActions(): EditLayerAction[] {
    if (!table || !page || !sheetCell || !layout) return [];
    const block = page.blocks[sheetCell.block]!;
    const edit = { id: 'desk-edit-text', label: 'tableEditCell' as const, run: startEdit };
    if (block.kind === 'text') {
      return [
        { ...edit, label: 'tableEditText' },
        {
          id: 'desk-block-delete',
          label: 'tableDeleteText',
          danger: true,
          run: () => apply(deleteTextBlock(table, pageIndex, sheetCell.block)),
        },
      ];
    }
    const at = { page: pageIndex, block: sheetCell.block };
    const tr = layout.rows[sheetCell.row]?.tableRow ?? 0;
    const col = sheetCell.col;
    return [
      edit,
      {
        id: 'desk-row-above',
        label: 'tableInsertRowAbove',
        run: () => apply(insertRow(table, at, tr)),
      },
      {
        id: 'desk-row-below',
        label: 'tableInsertRowBelow',
        run: () => apply(insertRow(table, at, tr + sheetCell.rowSpan)),
      },
      {
        id: 'desk-col-left',
        label: 'tableInsertColumnLeft',
        run: () => apply(insertColumn(table, pageIndex, col)),
      },
      {
        id: 'desk-col-right',
        label: 'tableInsertColumnRight',
        run: () => apply(insertColumn(table, pageIndex, col + sheetCell.colSpan)),
      },
      ...(block.rows > 1
        ? [
            {
              id: 'desk-row-delete',
              label: 'tableDeleteRow' as const,
              danger: true,
              run: () => apply(deleteRow(table, at, tr)),
            },
          ]
        : []),
      ...(canDeleteColumn(page, col)
        ? [
            {
              id: 'desk-col-delete',
              label: 'tableDeleteColumn' as const,
              danger: true,
              run: () => apply(deleteColumn(table, pageIndex, col)),
            },
          ]
        : []),
    ];
  }

  // ---- 文档（转 Word） ----
  const docBlock = selected?.kind === 'doc' && word ? blockAt(word, selected.at) : null;

  function pressBlock(at: DocRef) {
    if (selected?.kind === 'doc' && selected.cell === undefined && same(selected.at, at)) {
      if (docBlock && blockText(docBlock) !== null) startEdit();
      return;
    }
    setEditing(null);
    setSelected({ kind: 'doc', at });
  }

  function pressDocCell(at: DocRef, cell: number) {
    if (selected?.kind === 'doc' && selected.cell === cell && same(selected.at, at)) {
      startEdit();
      return;
    }
    setEditing(null);
    setSelected({ kind: 'doc', at, cell });
  }

  function docActions(): EditLayerAction[] {
    if (!word || selected?.kind !== 'doc' || !docBlock) return [];
    const at = selected.at;
    const remove = {
      id: 'desk-block-delete',
      label: 'wordDeleteBlock' as const,
      danger: true,
      run: () => apply(deleteBlock(word, at)),
    };
    if (docBlock.kind === 'table' && selected.cell !== undefined) {
      const cell = docBlock.table.cells[selected.cell];
      if (!cell) return [remove];
      const one = { page: 0, block: 0 };
      const op = (fn: (t: TableDoc) => TableDoc) => apply(editDocTable(word, at, fn));
      const tablePage = tableDocOf(word, at, '')!.pages[0]!;
      return [
        { id: 'desk-edit-text', label: 'tableEditCell', run: startEdit },
        {
          id: 'desk-row-above',
          label: 'tableInsertRowAbove',
          run: () => op((t) => insertRow(t, one, cell.row)),
        },
        {
          id: 'desk-row-below',
          label: 'tableInsertRowBelow',
          run: () => op((t) => insertRow(t, one, cell.row + cell.rowSpan)),
        },
        {
          id: 'desk-col-left',
          label: 'tableInsertColumnLeft',
          run: () => op((t) => insertColumn(t, 0, cell.col)),
        },
        {
          id: 'desk-col-right',
          label: 'tableInsertColumnRight',
          run: () => op((t) => insertColumn(t, 0, cell.col + cell.colSpan)),
        },
        ...(docBlock.table.rows > 1
          ? [
              {
                id: 'desk-row-delete',
                label: 'tableDeleteRow' as const,
                danger: true,
                run: () => op((t) => deleteRow(t, one, cell.row)),
              },
            ]
          : []),
        ...(canDeleteColumn(tablePage, cell.col)
          ? [
              {
                id: 'desk-col-delete',
                label: 'tableDeleteColumn' as const,
                danger: true,
                run: () => op((t) => deleteColumn(t, 0, cell.col)),
              },
            ]
          : []),
        remove,
      ];
    }
    return blockText(docBlock) !== null
      ? [{ id: 'desk-edit-text', label: 'wordEditText', run: startEdit }, remove]
      : [remove];
  }

  // ---- 共用 ----
  function startEdit() {
    if (selected?.kind === 'sheet' && page) setEditing({ text: sheetText(selected) });
    if (selected?.kind === 'doc' && word && docBlock) {
      if (docBlock.kind === 'table' && selected.cell !== undefined) {
        setEditing({ text: docBlock.table.cells[selected.cell]?.text ?? '' });
      } else {
        const text = blockText(docBlock);
        if (text !== null) setEditing({ text });
      }
    }
  }

  function commitText() {
    if (!editing || !selected) return;
    if (selected.kind === 'sheet' && table) {
      const next =
        selected.cell !== undefined
          ? setCellText(
              table,
              { page: pageIndex, block: selected.block },
              selected.cell,
              editing.text,
            )
          : setTextBlock(table, pageIndex, selected.block, editing.text);
      apply(next, true);
    } else if (selected.kind === 'doc' && word) {
      const next =
        selected.cell !== undefined
          ? editDocTable(word, selected.at, (t) =>
              setCellText(t, { page: 0, block: 0 }, selected.cell!, editing.text),
            )
          : setBlockText(word, selected.at, editing.text);
      // 段落改成空的会被删掉：那就不再选中它。
      apply(next, selected.cell !== undefined || !!blockAt(next as DocDoc, selected.at));
    }
    setEditing(null);
  }

  /** 选中的这一块在原图里的位置和那一页（截图用）。 */
  function sourceOf(): {
    page: { source: string; width: number; height: number };
    box?: Box;
  } | null {
    if (selected?.kind === 'sheet' && page && sheetCell) {
      const block = page.blocks[sheetCell.block]!;
      const box = block.kind === 'table' ? block.cells[sheetCell.cell!]?.box : block.box;
      return { page, ...(box ? { box } : {}) };
    }
    if (selected?.kind === 'doc' && word && docBlock) {
      const p = word.pages[selected.at.page]!;
      const box =
        docBlock.kind === 'table' && selected.cell !== undefined
          ? (docBlock.table.cells[selected.cell]?.box ?? docBlock.box)
          : docBlock.box;
      return { page: p, box };
    }
    return null;
  }

  const button = (id: string, label: string, onPress: () => void, danger = false, bold = false) => (
    <Pressable
      key={id}
      testID={id}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { borderColor: danger ? palette.danger : palette.border, opacity: pressed ? 0.6 : 1 },
      ]}>
      <Text
        style={[
          palette.font(bold ? 'bodyBold' : 'body', 14),
          { color: danger ? palette.danger : palette.primaryText },
        ]}>
        {label}
      </Text>
    </Pressable>
  );

  const actions = kind === 'table' ? sheetActions() : docActions();
  const source = sourceOf();
  const empty =
    (table && layout && layout.cells.length === 0) ||
    (word && word.pages.every((p) => p.blocks.length === 0));

  return (
    <View style={styles.flex} testID="desk-editor">
      {readOnly ? (
        <Text style={[palette.font('body', 13), styles.hint, { color: palette.muted }]}>
          {t(locale, 'tableReadOnly', { max: EDITABLE_CELLS })}
        </Text>
      ) : null}
      {empty ? (
        <Text style={[palette.font('body', 15), styles.empty, { color: palette.muted }]}>
          {t(locale, table ? 'tableEmpty' : 'wordEmpty')}
        </Text>
      ) : table && layout ? (
        <SheetView
          layout={layout}
          palette={palette}
          selected={sheetCell}
          {...(readOnly ? {} : { onPressCell: pressSheetCell })}
        />
      ) : word ? (
        <DocView
          doc={word}
          palette={palette}
          locale={locale}
          contentWidth={width - 20}
          selected={selected?.kind === 'doc' ? selected.at : null}
          selectedCell={selected?.kind === 'doc' ? (selected.cell ?? null) : null}
          onPress={pressBlock}
          onPressCell={pressDocCell}
        />
      ) : null}

      {editing ? (
        <View
          testID="desk-edit-panel"
          style={[styles.layer, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          <TextInput
            testID="desk-edit-input"
            autoFocus
            multiline
            value={editing.text}
            onChangeText={(text) => setEditing({ text })}
            style={[
              palette.font('body', 15),
              styles.input,
              { color: palette.text, borderColor: palette.border },
            ]}
          />
          <View style={styles.row}>
            {button('desk-edit-cancel', t(locale, 'cancel'), () => setEditing(null))}
            {button('desk-edit-ok', t(locale, 'ok'), commitText, false, true)}
          </View>
        </View>
      ) : selected ? (
        <View
          testID="desk-edit-bar"
          style={[styles.layer, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          <View style={styles.sourceRow}>
            <Text style={[palette.font('bodyBold', 13), styles.flex, { color: palette.muted }]}>
              {t(locale, 'tableSource')}
            </Text>
            <Pressable
              testID="desk-deselect"
              accessibilityRole="button"
              hitSlop={8}
              onPress={clear}>
              <Text style={[palette.font('bodyBold', 14), { color: palette.primaryText }]}>
                {t(locale, 'deskDeselect')}
              </Text>
            </Pressable>
          </View>
          {source?.box ? (
            <Crop page={source.page} box={source.box} maxWidth={width - 24} palette={palette} />
          ) : (
            <Text style={[palette.font('body', 13), { color: palette.muted }]}>
              {t(locale, 'tableNoSource')}
            </Text>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}>
            {actions.map((a) => button(a.id, t(locale, a.label), a.run, a.danger))}
          </ScrollView>
        </View>
      ) : table &&
        (pages > 1 || table.pages.some((p) => p.blocks.some((b) => b.kind === 'text'))) ? (
        // 没选中东西：识别范围（只影响写不写表外的文字）和页签。一行普通高度：横向 ScrollView 默认
        // flexGrow: 1，不压住会和表格平分高度，按钮被撑成大竖条（三星真机，2026-10-30）。
        <ScrollView
          horizontal
          testID="desk-scope-bar"
          style={styles.bar}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}>
          {(['tables', 'all'] as const).map((scope) => {
            const on = table.scope === scope;
            return (
              <Pressable
                key={scope}
                testID={`table-scope-${scope}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => apply(setScope(table, scope))}
                style={[styles.tab, chip(palette, on)]}>
                <Text style={[palette.font(on ? 'bodyBold' : 'body', 13), { color: palette.text }]}>
                  {t(locale, scope === 'tables' ? 'tableScopeTables' : 'tableScopeAll')}
                </Text>
              </Pressable>
            );
          })}
          {pages > 1
            ? table.pages.map((p, i) => (
                <Pressable
                  key={`page-${i}`}
                  testID={`desk-sheet-page-${i}`}
                  onPress={() => {
                    setPageIndex(i);
                    clear();
                  }}
                  style={[styles.tab, chip(palette, i === pageIndex)]}>
                  <Text
                    style={[
                      palette.font(i === pageIndex ? 'bodyBold' : 'body', 13),
                      { color: palette.text },
                    ]}>
                    {p.name}
                  </Text>
                </Pressable>
              ))
            : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const chip = (palette: Palette, on: boolean) => ({
  borderColor: on ? palette.primary : palette.border,
  backgroundColor: on ? palette.primaryTint : palette.surface,
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hint: { paddingHorizontal: 12, paddingVertical: 6 },
  empty: { flex: 1, padding: 24, textAlign: 'center' },
  layer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },
  sourceRow: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  action: {
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
  bar: { flexGrow: 0, flexShrink: 0 },
  tabs: { flexDirection: 'row', gap: 8, padding: 8, alignItems: 'center' },
  tab: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 32,
    justifyContent: 'center',
  },
});
