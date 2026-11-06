import type { Locale } from '@morph/core';
import {
  canDeleteColumn,
  deleteBlock,
  deleteColumn,
  deleteRow,
  editDocTable,
  insertColumn,
  insertRow,
  leafBlocks,
  mergeEdited,
  originalArea,
  sameValue,
  swapToOriginal,
  tableDocOf,
  type Box,
  type DocDoc,
  type DocPage,
  type DocRef,
  type DocTable,
  type EditedPage,
  type TableCell,
  type TableDoc,
} from '@morph/tool-office';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { t, type StringKey } from '../i18n';
import type { Palette } from '../renderer/theme';
import { blockBase, jpegDataUrl, paperWidth, wordPageHtml } from './word-page';

// 桌上的 Word 整页直接改（D-465）：网页里的纸（word-page.ts）就是编辑器，光标随便放、选中跨段的字；
// 键盘上面一排按钮：字变大、变小、加粗、斜体、下划线、对齐、收起键盘（和 CamScanner 一样）。光标在表格里时
// 多一排插删行列。页面每改一下交回每一块的样子，停手一会儿（或点操作、完成、离开时）合回文档、记一步撤销。
// 页面按打开时的文档生成；顶部撤销、重做换了文档时重新生成（光标回到开头）。

/** 停手这么久，改的字合成一步撤销。 */
const IDLE_MS = 800;

type Align = 'left' | 'center' | 'right';

interface PageState {
  focus: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: Align;
  cell?: { ref: string; i: number } | null;
  /** 光标所在的段落、列表（D-467）。 */
  ref?: string | null;
  /** 选区碰到的段落、列表（D-468）。 */
  refs?: string[];
}

const NEXT_ALIGN: Record<Align, Align> = { left: 'center', center: 'right', right: 'left' };
const ALIGN_ICON = {
  left: { ios: 'text.alignleft', android: 'format_align_left' },
  center: { ios: 'text.aligncenter', android: 'format_align_center' },
  right: { ios: 'text.alignright', android: 'format_align_right' },
} as const;

function refOf(ref: string): DocRef | null {
  const [page, block, cell, item] = ref.split('-').map(Number);
  if (page === undefined || block === undefined) return null;
  return { page, block, ...(cell !== undefined && item !== undefined ? { cell, item } : {}) };
}

export function WordEditor({
  doc,
  palette,
  locale,
  width,
  readImage,
  cropOriginal,
  onApply,
  onSelecting,
  onTyping,
}: {
  doc: DocDoc;
  palette: Palette;
  locale: Locale;
  /** 编辑页的宽（点）。 */
  width: number;
  /** 读图片块的文件（写进页面）。 */
  readImage: (uri: string) => Promise<Uint8Array>;
  /**
   * 从这一页的原图上剪下 box（原图像素）那一块，返回剪好的图（D-467，「用原图」）；剪不出来时 null。
   * 没有时不显示「用原图」。
   */
  cropOriginal?: (page: DocPage, box: Box) => Promise<string | null>;
  onApply: (next: DocDoc) => void;
  /** 光标在页面上（房间收起工具栏，换成这一排格式按钮）。 */
  onSelecting: (on: boolean) => void;
  /** 有改了还没合回文档的字：交出合回去的函数；没有了是 null。 */
  onTyping?: (flush: (() => void) | null) => void;
}) {
  // 页面是按 shown 生成的：页面交回来的 ref 指的是它的块。自己合回去的文档不重新生成页面。
  // 文档每换一次看一次：是刚从页面合回去的那一份就用掉这个记号，别的（撤销、重做、插删行列）重新生成页面。
  // 撤销可能正好退回到以前从页面合回去的那一份，所以记号用一次就清掉。
  const [shown, setShown] = useState(doc);
  const [seen, setSeen] = useState(doc);
  const [fromPage, setFromPage] = useState<DocDoc | null>(null);
  if (doc !== seen) {
    setSeen(doc);
    setFromPage(null);
    if (doc !== fromPage) setShown(doc);
  }
  // 页面交回来的样子（按哪一份文档生成的页面）。页面重新生成以后，旧页面上没合回去的字对不上新的文档，不要了。
  const pending = useRef<{ base: DocDoc; pages: EditedPage[] } | null>(null);
  const [hasPending, setHasPending] = useState(false);
  if (doc !== seen && doc !== fromPage && hasPending) setHasPending(false);
  const [state, setState] = useState<PageState>({ focus: false });
  // WebView 的类型是函数组件（不带 ref），实际的 ref 有 injectJavaScript。
  const web = useRef<{ injectJavaScript?: (js: string) => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 图片块的字节读好再生成页面。每次重新生成都看一遍：「用原图」（D-467）会多出新剪的图。
  // 读不到的记成 null（画成灰块），不再读。
  const [images, setImages] = useState<Record<string, string | null>>({});
  const srcs = useMemo(() => imageSrcs(shown), [shown]);
  // 读文件的函数每次渲染都是新的：用最新的那个，不因为它重新读。
  const read = useRef(readImage);
  useEffect(() => {
    read.current = readImage;
  });
  useEffect(() => {
    const missing = srcs.filter((src) => !(src in images));
    if (!missing.length) return;
    let alive = true;
    Promise.all(
      missing.map((src) =>
        read.current(src).then(
          (bytes) => [src, jpegDataUrl(bytes)] as const,
          () => [src, null] as const,
        ),
      ),
    ).then((pairs) => {
      if (alive) setImages((had) => ({ ...had, ...Object.fromEntries(pairs) }));
    });
    return () => {
      alive = false;
    };
  }, [srcs, images]);
  const ready = srcs.every((src) => src in images);

  const html = useMemo(() => {
    if (!ready) return null;
    const loaded = Object.fromEntries(
      Object.entries(images).filter((e): e is [string, string] => e[1] !== null),
    );
    return wordPageHtml(shown, width, loaded);
  }, [ready, shown, width, images]);

  // 最新的文档和回调（合回去时用；页面的消息、计时器拿到的是旧的闭包）。
  const latest = useRef({ doc, shown, onApply });
  useEffect(() => {
    latest.current = { doc, shown, onApply };
  });

  /** 改了的字合回文档，记一步撤销；返回合好的文档。 */
  function commit(): DocDoc {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { doc: current, shown: base, onApply: apply } = latest.current;
    const edited = pending.current;
    pending.current = null;
    setHasPending(false);
    if (!edited || edited.base !== base) return current;
    const pw = paperWidth(width);
    const next = mergeEdited(base, edited.pages, (block, p) =>
      blockBase(block, base.pages[p]!, pw),
    );
    // 合好的和现在的一样（改回去了）：不记一步。
    if (sameValue(next, current)) return current;
    setFromPage(next);
    apply(next);
    return next;
  }
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    onTyping?.(hasPending ? () => commitRef.current() : null);
  }, [hasPending, onTyping]);
  useEffect(() => {
    onSelecting(state.focus);
  }, [state.focus, onSelecting]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      onSelecting(false);
    },
    [onSelecting],
  );

  function onMessage(e: WebViewMessageEvent) {
    let msg: { type?: string } & Record<string, unknown>;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'doc' && Array.isArray(msg.pages)) {
      pending.current = { base: latest.current.shown, pages: msg.pages as EditedPage[] };
      setHasPending(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => commitRef.current(), IDLE_MS);
    } else if (msg.type === 'state') {
      setState(msg as unknown as PageState);
      // 离开页面（收起键盘）：改的字马上合回去。
      if (!msg.focus) commitRef.current();
    }
  }

  function command(name: string) {
    web.current?.injectJavaScript?.(`window.__wordCommand(${JSON.stringify(name)});true;`);
  }

  // ---- 光标在表格里：插删行列（改完重新生成页面） ----
  const table = tableUnderCursor(shown, state.cell ?? null);
  const actions = table ? tableActionsOf(table) : [];

  function runTable(id: TableActionId) {
    if (!table) return;
    // 先把改的字合回去；合回去以后块的下标可能变了（前面的段落删了、分了），按表本身找到它再改。
    const merged = commit();
    const at = findTable(merged, table.block.table);
    if (!at) return;
    const next =
      id === 'desk-table-delete'
        ? deleteBlock(merged, at)
        : editDocTable(merged, at, (t) => tableEdit(id, table.cell, t));
    if (next !== merged) latest.current.onApply(next);
  }

  // ---- 「用原图」（D-467）：签名、印章被认成了字，换回原图里剪下来的那一块 ----
  // 选中了几行时一起换（D-468）；都要在同一页上。
  const targets = cropOriginal
    ? swapTargets(shown, state.refs ?? (state.ref ? [state.ref] : []))
    : null;

  async function swapInOriginal() {
    if (!cropOriginal || !targets) return;
    command('blur');
    // 先把改的字合回去（剪图要等一会儿：在合好的这一份上换，latest 这时不一定已经更新）。
    // 合回去以后块的下标可能变了，按原来的框找；碰到的图片（之前换的、剪好的印章）一起换成一张。
    const current = commit();
    const area = originalArea(current, targets.page, targets.boxes);
    if (!area) return;
    const src = await cropOriginal(current.pages[targets.page]!, area);
    if (!src) return;
    latest.current.onApply(
      swapToOriginal(current, targets.page, targets.boxes, { src, box: area }),
    );
  }

  const align = state.align ?? 'left';
  const button = (id: string, label: StringKey, content: ReactNode, name: string, on = false) => (
    <FormatButton
      key={id}
      id={id}
      label={t(locale, label)}
      on={on}
      palette={palette}
      onPress={() => command(name)}>
      {content}
    </FormatButton>
  );
  const glyph = (text: string, style: object = {}) => (
    <Text style={[palette.font('bodyBold', 20), { color: palette.text }, style]}>{text}</Text>
  );

  if (!html) {
    return (
      <View style={styles.flex} testID="desk-editor">
        <ActivityIndicator style={styles.flex} color={palette.primary} />
      </View>
    );
  }
  return (
    <View style={styles.flex} testID="desk-editor">
      <WebView
        ref={web as never}
        testID="word-editor-page"
        style={styles.flex}
        source={{ html, baseUrl: 'about:blank' }}
        originWhitelist={['*']}
        // 只显示我们生成的页面，不打开任何链接。
        onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith('data:')}
        onMessage={onMessage}
        javaScriptEnabled
        allowFileAccess={false}
        setSupportMultipleWindows={false}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        automaticallyAdjustContentInsets={false}
        textZoom={100}
      />
      {state.focus ? (
        <View
          testID="word-format-bar"
          style={[styles.bar, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          {actions.length ? (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.actions}>
              {actions.map((a) => (
                <Pressable
                  key={a.id}
                  testID={a.id}
                  accessibilityRole="button"
                  onPress={() => runTable(a.id)}
                  style={[
                    styles.action,
                    { borderColor: a.danger ? palette.danger : palette.border },
                  ]}>
                  <Text
                    style={[
                      palette.font('body', 13),
                      { color: a.danger ? palette.danger : palette.primaryText },
                    ]}>
                    {t(locale, a.label)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.tools}>
            {button('word-bigger', 'wordBigger', glyph('A⁺'), 'bigger')}
            {button('word-smaller', 'wordSmaller', glyph('A⁻'), 'smaller')}
            {button(
              'word-bold',
              'wordBold',
              glyph('B', state.bold ? { color: palette.primary } : {}),
              'bold',
              !!state.bold,
            )}
            {button(
              'word-italic',
              'wordItalic',
              glyph('I', {
                fontStyle: 'italic',
                ...(state.italic ? { color: palette.primary } : {}),
              }),
              'italic',
              !!state.italic,
            )}
            {button(
              'word-underline',
              'wordUnderline',
              glyph('U', {
                textDecorationLine: 'underline',
                ...(state.underline ? { color: palette.primary } : {}),
              }),
              'underline',
              !!state.underline,
            )}
            {button(
              'word-align',
              'wordAlign',
              <SymbolView name={ALIGN_ICON[align]} size={22} tintColor={palette.text} />,
              NEXT_ALIGN[align],
            )}
            {targets ? (
              <FormatButton
                key="word-use-original"
                id="word-use-original"
                label={t(locale, 'wordUseOriginal')}
                on={false}
                palette={palette}
                onPress={() => void swapInOriginal()}>
                <SymbolView
                  name={{ ios: 'photo', android: 'image' }}
                  size={22}
                  tintColor={palette.text}
                />
              </FormatButton>
            ) : null}
            {button(
              'word-hide-keyboard',
              'wordHideKeyboard',
              <SymbolView
                name={{ ios: 'keyboard.chevron.compact.down', android: 'keyboard_hide' }}
                size={22}
                tintColor={palette.text}
              />,
              'blur',
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function FormatButton({
  id,
  label,
  on,
  palette,
  onPress,
  children,
}: {
  id: string;
  label: string;
  on: boolean;
  palette: Palette;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        on ? { backgroundColor: palette.primaryTint } : null,
        { opacity: pressed ? 0.6 : 1 },
      ]}>
      {children}
    </Pressable>
  );
}

type TableActionId =
  | 'desk-row-above'
  | 'desk-row-below'
  | 'desk-col-left'
  | 'desk-col-right'
  | 'desk-row-delete'
  | 'desk-col-delete'
  | 'desk-table-delete';

interface TableUnderCursor {
  at: DocRef;
  block: DocTable;
  cell: TableCell;
}

/** 光标所在的表格和格子（按页面生成时的文档）。 */
function tableUnderCursor(
  doc: DocDoc,
  cursor: { ref: string; i: number } | null,
): TableUnderCursor | null {
  const at = cursor ? refOf(cursor.ref) : null;
  const block = at ? leafAt(doc, at) : undefined;
  const cell = block?.kind === 'table' ? block.table.cells[cursor!.i] : undefined;
  return at && block?.kind === 'table' && cell ? { at, block, cell } : null;
}

function tableActionsOf({
  block,
  cell,
}: TableUnderCursor): { id: TableActionId; label: StringKey; danger?: boolean }[] {
  return [
    { id: 'desk-row-above', label: 'tableInsertRowAbove' },
    { id: 'desk-row-below', label: 'tableInsertRowBelow' },
    { id: 'desk-col-left', label: 'tableInsertColumnLeft' },
    { id: 'desk-col-right', label: 'tableInsertColumnRight' },
    ...(block.table.rows > 1
      ? [{ id: 'desk-row-delete' as const, label: 'tableDeleteRow' as const, danger: true }]
      : []),
    ...(canDeleteColumn(oneTablePage(block), cell.col)
      ? [{ id: 'desk-col-delete' as const, label: 'tableDeleteColumn' as const, danger: true }]
      : []),
    { id: 'desk-table-delete', label: 'wordDeleteTable', danger: true },
  ];
}

/** 只有这一张表的一页（转 Excel 的编辑函数用）。 */
function oneTablePage(block: DocTable) {
  const page = { source: '', width: 1, height: 1, bodySize: 11, blocks: [block] };
  return tableDocOf({ version: 1, pages: [page] }, { page: 0, block: 0 }, '')!.pages[0]!;
}

function tableEdit(id: TableActionId, cell: TableCell, t: TableDoc): TableDoc {
  const one = { page: 0, block: 0 };
  switch (id) {
    case 'desk-row-above':
      return insertRow(t, one, cell.row);
    case 'desk-row-below':
      return insertRow(t, one, cell.row + cell.rowSpan);
    case 'desk-col-left':
      return insertColumn(t, 0, cell.col);
    case 'desk-col-right':
      return insertColumn(t, 0, cell.col + cell.colSpan);
    case 'desk-row-delete':
      return deleteRow(t, one, cell.row);
    case 'desk-col-delete':
      return deleteColumn(t, 0, cell.col);
    default:
      return t;
  }
}

/** 文档里所有图片块的 src（去重）。 */
function imageSrcs(doc: DocDoc): string[] {
  return [
    ...new Set(
      doc.pages.flatMap((p) => [
        ...leafBlocks(p).flatMap((b) => (b.kind === 'image' && b.src ? [b.src] : [])),
        // 每页的原图：光标上方的小窗用（D-468）。
        ...(p.source ? [p.source] : []),
      ]),
    ),
  ];
}

function leafAt(doc: DocDoc, at: DocRef) {
  const block = doc.pages[at.page]?.blocks[at.block];
  if (at.cell === undefined) return block?.kind === 'row' ? undefined : block;
  return block?.kind === 'row' ? block.cells[at.cell]?.blocks[at.item ?? -1] : undefined;
}

/** 合回去以后这张表在哪里（按表本身找：前面的段落删了、分了，下标会变）。 */
function findTable(doc: DocDoc, table: object): DocRef | null {
  for (const [p, page] of doc.pages.entries()) {
    for (const [b, block] of page.blocks.entries()) {
      if (block.kind === 'table' && sameTable(block.table, table)) return { page: p, block: b };
      if (block.kind !== 'row') continue;
      for (const [c, cell] of block.cells.entries()) {
        for (const [i, leaf] of cell.blocks.entries()) {
          if (leaf.kind === 'table' && sameTable(leaf.table, table)) {
            return { page: p, block: b, cell: c, item: i };
          }
        }
      }
    }
  }
  return null;
}

/** 「用原图」要换的块：这些 ref 里的段落、列表（只算和第一块同一页的）；一块都没有时 null。 */
function swapTargets(doc: DocDoc, refs: readonly string[]): { page: number; boxes: Box[] } | null {
  const leaves = refs
    .map((r) => refOf(r))
    .filter((at): at is DocRef => at !== null)
    .map((at) => ({ at, leaf: leafAt(doc, at) }))
    .filter(({ leaf }) => leaf?.kind === 'paragraph' || leaf?.kind === 'list');
  const page = leaves[0]?.at.page;
  if (page === undefined) return null;
  return {
    page,
    boxes: leaves.filter(({ at }) => at.page === page).map(({ leaf }) => leaf!.box),
  };
}

/** 同一张表：格子的字可能改过（合回去时换成了新对象），按位置和大小认。 */
function sameTable(a: { box: object; rows: number }, b: object) {
  const t = b as { box: object; rows: number };
  return JSON.stringify(a.box) === JSON.stringify(t.box) && a.rows === t.rows;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 4 },
  tools: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  tool: {
    minWidth: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingBottom: 4 },
  action: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 32,
    justifyContent: 'center',
  },
});
