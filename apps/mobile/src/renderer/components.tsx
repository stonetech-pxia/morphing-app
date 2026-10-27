import type { Locale, NavTarget, Page, Registry, WorkspaceConfig, Component } from '@morph/core';

import { Pressable, ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native';

import { GestureDetector, type PanGesture } from 'react-native-gesture-handler';

import { FocusToolbar } from '../editing/FocusItem';
import type { SingleDrag } from '../editing/useSingleDrag';
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
  /** 打开一个页面或系统入口（按钮、快捷入口、工具卡片使用）。 */
  navigate: (target: NavTarget) => void;
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
  const { palette } = env;
  const pageEnv = { ...env, pageId: page.id };
  const content = (
    <ScrollView
      testID={env.focus ? 'editable-scroll' : undefined}
      ref={(view) => env.focus?.drag?.attachScroll(view)}
      {...scroll}
      // 渐变背景画在外层容器上（和状态栏区域连成一片），页面本身透明。
      style={palette.hasBackdrop ? undefined : { backgroundColor: palette.background }}
      // 数据表单：键盘弹出时可以直接点选项和按钮，并自动把输入框滚到键盘上方。
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{
        flexGrow: 1,
        padding: palette.pad,
        gap: palette.gap,
        paddingBottom: 24 + bottomInset,
      }}>
      {env.focus?.selectedId ? (
        <Pressable
          testID="single-blank"
          accessible={false}
          style={StyleSheet.absoluteFill}
          onPress={env.focus.onDone}
        />
      ) : null}
      {runnerGrid(page.components.filter((c) => !c.hidden)).map((block) =>
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
  return drag ? (
    <View ref={(view) => drag.attachViewport(view)} style={{ flex: 1 }}>
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
      run.length >= 2 || run.some((c) => c.type === 'workflowRunner' && c.props.look === 'tile');
    if (tiles) for (let i = 0; i < run.length; i += 2) blocks.push(run.slice(i, i + 2));
    else blocks.push(...run);
    run = [];
  };
  for (const c of components) {
    // 指定了 row / card 的不进宫格；指定了 tile 的单独一个也放进宫格（D-230）。
    if (c.type === 'workflowRunner' && c.props.look !== 'row' && c.props.look !== 'card')
      run.push(c);
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
});
