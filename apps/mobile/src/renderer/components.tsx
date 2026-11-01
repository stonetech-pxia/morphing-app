import type { Locale, OpenTarget, Page, Registry, WorkspaceConfig, Component } from '@morph/core';

import { Pressable, ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native';

import { GestureDetector, type PanGesture } from 'react-native-gesture-handler';

import { FocusToolbar } from '../editing/FocusItem';
import type { SingleDrag } from '../editing/useSingleDrag';
import { BackdropFill, onPicture } from './Backdrop';
import { Item } from './registry';
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
}

export function PageView({
  page,
  env,
  bottomInset = 0,
  scroll,
}: {
  page: Page;
  env: RenderEnv;
  bottomInset?: number;
  /** 额外的滚动设置（编辑后重新挂载时恢复滚动位置）。 */
  scroll?: ScrollViewProps;
}) {
  // 整页的背景图片（D-258）：图片上的文字一律用正文色，组件浮在上面。
  const picture = page.backdrop?.assetId ? page.backdrop : undefined;
  const palette = onPicture(env.palette, picture);
  const pageEnv = { ...env, palette, pageId: page.id };
  // D-352：底部弹出的添加框是右下角的浮动「+」，不跟着内容滚动。
  const floats = (c: Component) => c.look === 'form' && c.show.mode === 'sheet';
  const floating = page.blocks.filter((c) => !c.hidden && floats(c));
  const content = (
    <ScrollView
      testID={env.focus ? 'editable-scroll' : undefined}
      ref={(view) => env.focus?.drag?.attachScroll(view)}
      {...scroll}
      // 渐变背景画在外层容器上（和状态栏区域连成一片），页面本身透明。
      style={palette.hasBackdrop || picture ? undefined : { backgroundColor: palette.background }}
      // 数据表单：键盘弹出时可以直接点选项和按钮，并自动把输入框滚到键盘上方。
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{
        flexGrow: 1,
        padding: palette.pad,
        gap: palette.gap,
        // 有浮动的「+」时多留出它的高度，最下面的内容不被盖住（D-352）。
        paddingBottom: 24 + bottomInset + (floating.length > 0 ? 80 : 0),
      }}>
      {env.focus?.selectedId ? (
        <Pressable
          testID="single-blank"
          accessible={false}
          style={StyleSheet.absoluteFill}
          onPress={env.focus.onDone}
        />
      ) : null}
      {runnerGrid(page.blocks.filter((c) => !c.hidden && !floats(c))).map((block) =>
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
                env={{ ...pageEnv, inCell: true }}
                style={styles.cell}
              />
            ))}
            {block.length === 1 ? <View style={styles.cell} /> : null}
          </View>
        ) : (
          <Item key={block.id} component={block} env={pageEnv} />
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
  const fab =
    floating.length > 0 ? (
      <View pointerEvents="box-none" style={[styles.fab, { bottom: 20 + bottomInset }]}>
        {floating.map((c) => (
          <Item key={c.id} component={c} env={pageEnv} />
        ))}
      </View>
    ) : null;
  return drag ? (
    <View ref={(view) => drag.attachViewport(view)} style={{ flex: 1, ...behind }}>
      {fill}
      <GestureDetector gesture={drag.scrollGesture}>{content}</GestureDetector>
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
    </View>
  ) : picture || fab ? (
    <View style={{ flex: 1, ...behind }}>
      {fill}
      {content}
      {fab}
    </View>
  ) : (
    content
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
});
