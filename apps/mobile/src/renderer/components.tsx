import {
  bindRecord,
  pageBrowseHost,
  pageDial,
  pageZones,
  type BlockOf,
  type Component,
  type Locale,
  type OpenTarget,
  type Page,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';

import { useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
} from 'react-native';

import { GestureDetector, type PanGesture } from 'react-native-gesture-handler';

import { FocusToolbar } from '../editing/FocusItem';
import type { SingleDrag } from '../editing/useSingleDrag';
import { BackdropFill, onPicture } from './Backdrop';
import { ListBrowseBar, useBrowseSelection, type BrowseSelection, type RecordBlock } from './data';
import { DialHost, type DialSlots } from './Dial';
import { Item, WhenRecords } from './registry';
import type { Palette } from './theme';

// 页面渲染：把页面上的组件按顺序排好，每种组件怎么画见 registry.tsx（RENDERERS）。

export interface RenderEnv {
  config: WorkspaceConfig;
  palette: Palette;
  locale: Locale;
  registry: Registry;
  /** 预览时为 false：组件只展示，不响应点击。 */
  interactive: boolean;
  /** 打开一个页面、系统入口或快捷操作（按钮、快捷入口、工具卡片使用；快捷操作只打开，D-256）。 */
  navigate: (target: OpenTarget) => void;
  /** 在横排或网格的格子里：卡片改为图标在上、文字在下。 */
  inCell?: boolean;
  /** 画在页面下方固定区：入口画成和浮动按钮同一个样子的按钮（D-437）。 */
  inBottomZone?: boolean;
  /** 正在渲染的页面（图片组件更换照片时要用）。 */
  pageId?: string;
  /** 可以直接编辑的页面：长按组件时打开它的操作面板（D-052）。预览和系统页面没有。 */
  edit?: (componentId: string) => void;
  /** 单组件编辑保留正常页面布局，只给选中项加工具栏。 */
  focus?: {
    selectedId: string | null;
    onEdit: (id: string) => void;
    onDone: () => void;
    drag?: SingleDrag;
  };
  parentDrag?: PanGesture;
  focusWithinSelected?: boolean;
  focusWithinDimmed?: boolean;
  /** 当前组件的长按操作：组件里可点按的部分（卡片、按钮、列表行）也要响应长按。 */
  onLongPress?: () => void;
  /**
   * 草稿模式（D-190）：能看不能用。设置时，打开页面照常，但运行、记录、选图片、打开文件等
   * 会真的做事的操作改为调用它（提示「应用之后才能用」）。
   */
  locked?: () => void;
  /** 给一条记录用的页面（D-342）：组件里的 "$record" 换成这条记录的 ID 再画。 */
  recordId?: string;
  /** 页面滚到底过几次：能往下加载的列表每次多显示一页（创始人 2026-11-04 定）。 */
  pageEnd?: number;
  /** 状态放在页面上的那个列表（搜索画在固定区，或者浮动按钮要拿它选出的记录）。 */
  pageBrowse?: BrowseSelection;
  /** 分开的浮动按钮（它的状态在页面上，DialHost）。 */
  dial?: DialSlots;
}

/** 多靠近页面底部算滚到底。 */
const PAGE_END_MARGIN = 240;

interface PageViewProps {
  page: Page;
  env: RenderEnv;
  bottomInset?: number;
  /** 下方固定区要让开多高（导航栏、浮动按钮）；不写时用 bottomInset。 */
  zoneInset?: number;
  /** 额外的滚动设置（编辑后重新挂载时恢复滚动位置）。 */
  scroll?: ScrollViewProps;
}

/** 换了页面（导航栏上切换）从头开始：用户在列表上临时的搜索、排序、筛选离开就没有了，什么都不写（底线 15）。 */
export function PageView(props: PageViewProps) {
  return <PageBody key={props.page.id} {...props} />;
}

/** 状态放在页面上的列表（useBrowseSelection 是 hook，所以是单独的组件）。 */
function BrowseHost({
  block,
  env,
  children,
}: {
  block: RecordBlock;
  env: RenderEnv;
  children: (selection: BrowseSelection) => ReactNode;
}) {
  const selection = useBrowseSelection(block, env);
  return <>{children(selection)}</>;
}

function PageBody({ page, env, bottomInset = 0, zoneInset, scroll }: PageViewProps) {
  // 整页的背景图片（D-258）：图片上的文字一律用正文色，组件浮在上面。
  const picture = page.backdrop?.assetId ? page.backdrop : undefined;
  const palette = onPicture(env.palette, picture);
  const [pageEnd, setPageEnd] = useState(0);
  const [bottomHeight, setBottomHeight] = useState(0);
  const pageEnv: RenderEnv = { ...env, palette, pageId: page.id, pageEnd };
  // 单组件编辑时固定区照常排在内容里（拖动、工具栏都在滚动的内容上），位置和配置里的顺序一样。
  const editing = !!env.focus?.selectedId;
  const zones = pageZones(page);
  const hasZones = !editing && (zones.top.length > 0 || zones.bottom.length > 0);
  // D-352：底部弹出的添加框是右下角的浮动「+」，不跟着内容滚动。
  const floats = (c: Component) => c.look === 'form' && c.show.mode === 'sheet';
  const floating = page.blocks.filter((c) => !c.hidden && floats(c));
  const inScroll = editing ? page.blocks.filter((c) => !c.hidden) : zones.middle;
  const host = pageBrowseHost(page);
  const dial = pageDial(page) as BlockOf<'dial'> | undefined;

  // 滚到底：内容每变一次高最多算一次；页面放得下还没铺满时（内容变高了还在底部）接着算，直到铺满或者没有更多。
  const tracksEnd = page.blocks.some(
    (c) => (c as { show?: { browse?: unknown } }).show?.browse !== undefined,
  );
  const metrics = useRef({ y: 0, height: 0, content: 0, fired: -1 });
  const checkEnd = () => {
    const m = metrics.current;
    if (m.height <= 0 || m.content <= 0 || m.fired === m.content) return;
    if (m.y + m.height < m.content - PAGE_END_MARGIN) return;
    m.fired = m.content;
    setPageEnd((n) => n + 1);
  };
  const endTracking: ScrollViewProps = tracksEnd
    ? {
        scrollEventThrottle: scroll?.scrollEventThrottle ?? 100,
        onScroll: (e) => {
          scroll?.onScroll?.(e);
          const n = e.nativeEvent;
          Object.assign(metrics.current, {
            y: n.contentOffset.y,
            height: n.layoutMeasurement.height,
            content: n.contentSize.height,
          });
          checkEnd();
        },
        onLayout: (e) => {
          scroll?.onLayout?.(e);
          metrics.current.height = e.nativeEvent.layout.height;
          checkEnd();
        },
        onContentSizeChange: (w, h) => {
          scroll?.onContentSizeChange?.(w, h);
          metrics.current.content = h;
          checkEnd();
        },
      }
    : {};

  const layout = (
    selection: BrowseSelection | undefined,
    slots: DialSlots | undefined,
    overlay: ReactNode,
  ) => {
    const pinnedList = !editing && selection?.block.show.browse?.pin === true;
    const contentEnv: RenderEnv = selection
      ? { ...pageEnv, pageBrowse: { ...selection, pinned: pinnedList } }
      : pageEnv;
    const content = (
      <ScrollView
        testID={env.focus ? 'editable-scroll' : undefined}
        ref={(view) => env.focus?.drag?.attachScroll(view)}
        {...scroll}
        {...endTracking}
        // 渐变背景画在外层容器上（和状态栏区域连成一片），页面本身透明。
        style={palette.hasBackdrop || picture ? undefined : { backgroundColor: palette.background }}
        // 数据表单：键盘弹出时可以直接点选项和按钮，并自动把输入框滚到键盘上方。
        keyboardShouldPersistTaps="handled"
        // 拖动页面收键盘；点空白收键盘（下面的 page-blank）。
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          flexGrow: 1,
          padding: palette.pad,
          gap: palette.gap,
          // 有浮动的「+」时多留出它的高度，最下面的内容不被盖住（D-352）。下方固定区在滚动区外面，导航栏由它让开。
          paddingBottom:
            24 +
            (hasZones && zones.bottom.length > 0 ? 0 : bottomInset) +
            (floating.length > 0 ? 80 : 0),
        }}>
        {env.focus?.selectedId ? (
          <Pressable
            testID="single-blank"
            accessible={false}
            style={StyleSheet.absoluteFill}
            onPress={env.focus.onDone}
          />
        ) : (
          <Pressable
            testID="page-blank"
            accessible={false}
            style={StyleSheet.absoluteFill}
            onPress={() => Keyboard.dismiss()}
          />
        )}
        {runnerGrid(inScroll.filter((c) => !floats(c))).map((block) =>
          Array.isArray(block) ? (
            <View
              key={block[0]!.id}
              style={[
                styles.row,
                {
                  gap: palette.gap - 4,
                  zIndex: block.some((c) => c.id === env.focus?.selectedId) ? 10 : 0,
                },
              ]}>
              {block.map((c) => (
                <Item
                  key={c.id}
                  component={c}
                  env={{ ...contentEnv, inCell: true }}
                  style={styles.cell}
                />
              ))}
              {block.length === 1 ? <View style={styles.cell} /> : null}
            </View>
          ) : (
            <Item key={block.id} component={block} env={contentEnv} />
          ),
        )}
        {env.focus?.selectedId ? <FocusToolbar env={pageEnv} page={page} /> : null}
      </ScrollView>
    );
    const drag = env.focus?.drag;
    // 背景图片画在滚动内容后面，不跟着滚动。
    const fill = picture ? (
      <BackdropFill backdrop={picture} color={palette.background} palette={palette} />
    ) : null;
    const behind = picture ? { backgroundColor: palette.background } : undefined;
    const zoneBackground =
      palette.hasBackdrop || picture ? undefined : { backgroundColor: palette.background };
    const fab =
      floating.length > 0 ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.fab,
            { bottom: 20 + (hasZones && zones.bottom.length > 0 ? bottomHeight : bottomInset) },
          ]}>
          {floating.map((c) => (
            <Item key={c.id} component={c} env={pageEnv} />
          ))}
        </View>
      ) : null;
    const topBlocks = hasZones ? zones.top.filter((c) => !floats(c)) : [];
    const showBar = pinnedList && selection && selection.sorted.length > 0;
    const bar = showBar ? <ListBrowseBar selection={selection} env={pageEnv} /> : null;
    const hostShowIf = selection?.block.showIf;
    const topZone =
      topBlocks.length > 0 || bar ? (
        <View
          testID="page-top-zone"
          style={[styles.topZone, { padding: palette.pad, gap: palette.gap - 4 }, zoneBackground]}>
          {topBlocks.map((c) => (
            <Item key={c.id} component={c} env={pageEnv} />
          ))}
          {bar && hostShowIf ? <WhenRecords showIf={hostShowIf}>{bar}</WhenRecords> : bar}
        </View>
      ) : null;
    const bottomBlocks = hasZones ? zones.bottom.filter((c) => !floats(c)) : [];
    const others = bottomBlocks.filter((c) => c.look !== 'dial');
    const bottomZone =
      bottomBlocks.length > 0 ? (
        <View
          testID="page-bottom-zone"
          onLayout={(e) => setBottomHeight(e.nativeEvent.layout.height)}
          style={[
            styles.bottomZone,
            {
              paddingHorizontal: palette.pad,
              paddingBottom: 10 + (zoneInset ?? bottomInset),
              gap: palette.gap - 4,
            },
            zoneBackground,
          ]}>
          <View style={[styles.cell, { gap: palette.gap - 4 }]}>
            {others.map((c) => (
              <Item key={c.id} component={c} env={{ ...pageEnv, inBottomZone: true }} />
            ))}
          </View>
          {dial && bottomBlocks.includes(dial) ? (
            <Item
              key={dial.id}
              component={dial}
              env={slots ? { ...pageEnv, dial: slots } : pageEnv}
            />
          ) : null}
        </View>
      ) : null;
    return drag ? (
      <View ref={(view) => drag.attachViewport(view)} style={{ flex: 1, ...behind }}>
        {fill}
        {topZone}
        <GestureDetector gesture={drag.scrollGesture}>{content}</GestureDetector>
        {bottomZone}
        {drag.target ? (
          <View
            testID="single-drop-line"
            pointerEvents="none"
            style={[
              { position: 'absolute', backgroundColor: palette.primary, zIndex: 100 },
              {
                left: drag.target.line.x,
                top: drag.target.line.y,
                width: drag.target.line.width,
                height: drag.target.line.height,
              },
            ]}
          />
        ) : null}
        {env.focus?.selectedId ? <FocusToolbar env={pageEnv} page={page} pinned /> : null}
        {fab}
        {overlay}
      </View>
    ) : picture || fab || topZone || bottomZone || overlay ? (
      <View style={{ flex: 1, ...behind }}>
        {fill}
        {topZone}
        {content}
        {bottomZone}
        {fab}
        {overlay}
      </View>
    ) : (
      content
    );
  };

  const withDial = (selection: BrowseSelection | undefined) =>
    dial ? (
      <DialHost block={dial} env={pageEnv} selection={selection} bottom={bottomHeight}>
        {(slots, overlay) => layout(selection, slots, overlay)}
      </DialHost>
    ) : (
      layout(selection, undefined, null)
    );
  if (!host) return withDial(undefined);
  // D-342：给一条记录用的页面上，筛选里的 "$record" 换成这条记录。
  const block = (env.recordId ? bindRecord(host, env.recordId) : host) as RecordBlock;
  return (
    <BrowseHost block={block} env={pageEnv}>
      {withDial}
    </BrowseHost>
  );
}

/**
 * 相邻的两个以上运行卡片排成两列宫格（D-108），例如工具页上的十几个功能；单独一个保持整张卡片。
 * 只影响显示，配置里仍是一个个组件，AI 和编辑模式看到的结构不变。
 */
function runnerGrid(components: readonly Component[]): (Component | Component[])[] {
  const blocks: (Component | Component[])[] = [];
  let run: Component[] = [];
  const flush = () => {
    const tiles =
      run.length >= 2 || run.some((c) => c.look === 'action' && c.show?.shape === 'tile');
    if (tiles) for (let i = 0; i < run.length; i += 2) blocks.push(run.slice(i, i + 2));
    else blocks.push(...run);
    run = [];
  };
  for (const c of components) {
    // 指定了 row / card 的不进宫格；指定了 tile 的单独一个也放进宫格（D-230）。
    if (c.look === 'action' && c.show?.shape !== 'row' && c.show?.shape !== 'card') run.push(c);
    else {
      flush();
      blocks.push(c);
    }
  }
  flush();
  return blocks;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cell: { flex: 1 },
  fab: { position: 'absolute', right: 20, alignItems: 'flex-end' },
  topZone: { paddingBottom: 8 },
  bottomZone: { flexDirection: 'row', alignItems: 'center', paddingTop: 10 },
});
