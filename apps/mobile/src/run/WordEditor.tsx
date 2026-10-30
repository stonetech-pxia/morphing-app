import type { Locale, RunItem } from '@morph/core';
import {
  blockAt,
  blockText,
  deleteBlock,
  pushHistory,
  redo,
  setBlockText,
  setTableFrom,
  startHistory,
  tableDocOf,
  undo,
  type DocDoc,
  type DocLeaf,
  type DocPage,
  type DocRef,
  type History,
  type TableDoc,
} from '@morph/tool-office';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
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
import { Crop, TableEditor } from './TableEditor';
import { loadDocDoc, saveWordEdits } from './word-edit';

// 转 Word 的查看和编辑（D-328）：按块显示（标题、段落、列表、表格、图片），点一下选中、再点一下编辑；
// 选中时底部显示原图里这一块的截图（和转 Excel 的编辑页一样）。段落和列表改文字（列表一行一项），
// 表格交给转 Excel 的编辑页（只有这一张表），任何块都能删除。撤销只在内存里（最多 100 步）。
// 点「完成」或返回时，改过就重新生成 docx（新文件）并写回 DocDoc。
// 表单配好的标签和值（D-332）每行左右两段显示，编辑时是「标签、制表符、值」。
// 并排行（D-331）按原图的列宽左右排开，每格里的块和别的块一样点选、编辑、删除；整行本身不能选。

/** 正文在编辑页里的字号（点）；标题和别的字号按和正文的比例放大缩小。 */
const BODY_PX = 15;
/** 原图截图最高这么多点（和 TableEditor 一样）。 */
const IMAGE_HEIGHT = 160;

const same = (a: DocRef | null, b: DocRef) =>
  a?.page === b.page && a.block === b.block && a.cell === b.cell && a.item === b.item;

const refId = (at: DocRef) =>
  [at.page, at.block, ...(at.cell !== undefined ? [at.cell, at.item] : [])].join('-');

/** 一个块在编辑页里的样子。 */
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

export function WordEditor({
  item,
  files,
  runId,
  palette,
  locale,
  onClose,
  onSaved,
}: {
  item: RunItem;
  files: FilePlatform;
  runId: string;
  palette: Palette;
  locale: Locale;
  /** 没有改动时关闭。 */
  onClose: () => void;
  /** 改过、已经写好新的 docx：换掉结果里的这一项。 */
  onSaved: (next: RunItem) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [original, setOriginal] = useState<DocDoc | null>(null);
  const [history, setHistory] = useState<History<DocDoc> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DocRef | null>(null);
  const [editing, setEditing] = useState<{ at: DocRef; text: string } | null>(null);
  const [table, setTable] = useState<{ at: DocRef; doc: TableDoc } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    loadDocDoc(files, item)
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
  const contentWidth = screenWidth - 32;
  const selectedBlock = selected && doc ? blockAt(doc, selected) : null;

  const apply = (next: DocDoc) => {
    if (!history) return;
    setHistory(pushHistory(history, next));
    setSelected(null);
  };

  function edit(at: DocRef) {
    if (!doc) return;
    const block = blockAt(doc, at);
    if (!block) return;
    if (block.kind === 'table') {
      const tdoc = tableDocOf(doc, at, t(locale, 'tableSheetName', { n: at.page + 1 }));
      if (tdoc) setTable({ at, doc: tdoc });
      return;
    }
    const text = blockText(block);
    if (text !== null) setEditing({ at, text });
  }

  function press(at: DocRef) {
    if (same(selected, at)) edit(at);
    else setSelected(at);
  }

  function commitEdit() {
    if (!editing || !doc) return;
    apply(setBlockText(doc, editing.at, editing.text));
    setEditing(null);
  }

  async function finish() {
    if (saving) return;
    if (!history || !original || history.present === original) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveWordEdits(files, runId, item, history.present));
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

  const empty = doc !== null && doc.pages.every((p) => p.blocks.length === 0);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={finish}>
      <KeyboardAvoidingView
        behavior="padding"
        style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}
        testID="word-editor">
        <View style={[styles.header, { borderColor: palette.border }]}>
          <Text
            numberOfLines={1}
            style={[palette.font('title', 16), styles.flex, { color: palette.text }]}>
            {`${item.name}.${item.ext}`}
          </Text>
          {headerButton(
            'word-undo',
            t(locale, 'undo'),
            () => history && setHistory(undo(history)),
            !history?.past.length,
          )}
          {headerButton(
            'word-redo',
            t(locale, 'tableRedo'),
            () => history && setHistory(redo(history)),
            !history?.future.length,
          )}
          {saving ? (
            <ActivityIndicator color={palette.primary} />
          ) : (
            headerButton('word-done', t(locale, 'done'), () => void finish(), false, true)
          )}
        </View>
        <Text
          style={[
            palette.font('body', 13),
            styles.hint,
            { color: palette.muted, backgroundColor: palette.primaryTint },
          ]}>
          {t(locale, 'wordEditorHint')}
        </Text>
        {error ? (
          <Text
            testID="word-error"
            style={[palette.font('bodyMedium', 14), styles.hint, { color: palette.danger }]}>
            {error}
          </Text>
        ) : null}

        {!doc ? (
          error ? (
            <View style={styles.flex} />
          ) : (
            <ActivityIndicator style={styles.flex} color={palette.primary} />
          )
        ) : empty ? (
          <Text style={[palette.font('body', 15), styles.empty, { color: palette.muted }]}>
            {t(locale, 'wordEmpty')}
          </Text>
        ) : (
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
                        onPress={() => press(at)}
                        style={[
                          styles.block,
                          {
                            borderColor: on ? palette.primary : 'transparent',
                            backgroundColor: on ? palette.primaryTint : 'transparent',
                          },
                        ]}>
                        <BlockView
                          block={inner}
                          page={page}
                          maxWidth={maxWidth}
                          palette={palette}
                        />
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
                {t(locale, 'wordEditText')}
              </Text>
              <TextInput
                testID="word-edit-input"
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
                {headerButton('word-edit-cancel', t(locale, 'cancel'), () => setEditing(null))}
                {headerButton('word-edit-ok', t(locale, 'ok'), commitEdit, false, true)}
              </View>
            </>
          ) : selected && selectedBlock && doc ? (
            <>
              <Text style={[palette.font('bodyBold', 13), { color: palette.muted }]}>
                {t(locale, 'tableSource')}
              </Text>
              <Crop
                page={doc.pages[selected.page]!}
                box={selectedBlock.box}
                maxWidth={contentWidth}
                palette={palette}
              />
              <View style={styles.row}>
                {selectedBlock.kind === 'table'
                  ? headerButton('word-edit-table', t(locale, 'wordEditTable'), () =>
                      edit(selected),
                    )
                  : selectedBlock.kind !== 'image'
                    ? headerButton('word-edit-text', t(locale, 'wordEditText'), () =>
                        edit(selected),
                      )
                    : null}
                <Pressable
                  testID="word-delete"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => apply(deleteBlock(doc, selected))}>
                  <Text style={[palette.font('body', 16), { color: palette.danger }]}>
                    {t(locale, 'wordDeleteBlock')}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>

        {table && doc ? (
          <TableEditor
            item={item}
            files={files}
            runId={runId}
            palette={palette}
            locale={locale}
            onClose={() => setTable(null)}
            onSaved={() => setTable(null)}
            inMemory={{
              doc: table.doc,
              onDone: (edited) => {
                apply(setTableFrom(doc, table.at, edited));
                setTable(null);
              },
            }}
          />
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
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  sideBySide: { flexDirection: 'row', alignItems: 'flex-start' },
  input: {
    minHeight: 80,
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    textAlignVertical: 'top',
  },
});
