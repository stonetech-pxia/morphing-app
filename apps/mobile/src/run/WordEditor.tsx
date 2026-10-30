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
  type DocRef,
  type History,
  type TableDoc,
} from '@morph/tool-office';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
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
import { DocView, same } from './DocView';
import { Crop, TableEditor } from './TableEditor';
import { loadDocDoc, saveWordEdits } from './word-edit';

// 转 Word 的查看和编辑（D-328）：按块显示（标题、段落、列表、表格、图片），点一下选中、再点一下编辑；
// 选中时底部显示原图里这一块的截图（和转 Excel 的编辑页一样）。段落和列表改文字（列表一行一项），
// 表格交给转 Excel 的编辑页（只有这一张表），任何块都能删除。撤销只在内存里（最多 100 步）。
// 点「完成」或返回时，改过就重新生成 docx（新文件）并写回 DocDoc。
// 表单配好的标签和值（D-332）每行左右两段显示，编辑时是「标签、制表符、值」。
// 并排行（D-331）按原图的列宽左右排开，每格里的块和别的块一样点选、编辑、删除；整行本身不能选。

// 画块的部分在 DocView（文件房间的大预览也用它，file-room DESIGN §11.4）。

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
          <DocView
            doc={doc}
            palette={palette}
            locale={locale}
            contentWidth={contentWidth}
            selected={selected}
            onPress={press}
          />
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
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  input: {
    minHeight: 80,
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    textAlignVertical: 'top',
  },
});
