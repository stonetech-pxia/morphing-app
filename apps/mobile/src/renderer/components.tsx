import {
  localize,
  pageTarget,
  type Component,
  type ComponentStyle,
  type EntryLook,
  type Locale,
  type NavTarget,
  type Page,
  type Registry,
  type WorkspaceConfig,
} from '@morph/core';

import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { GestureDetector, type PanGesture } from 'react-native-gesture-handler';

import { t } from '../i18n';
import { LONG_PRESS_MS } from '../editing/entry';
import { FocusItem, FocusToolbar } from '../editing/FocusItem';
import type { SingleDrag } from '../editing/useSingleDrag';
import { Chart } from './Chart';
import { RecordForm, RecordList, Stat } from './data';
import { FileList } from './FileList';
import { FilePick } from './FilePick';
import { ImageView } from './ImageView';
import { RichText } from './RichText';
import { cardColors, iconColors, type Palette } from './theme';
import { Button, Card, IconTile } from './ui';
import { ToolGrid } from './ToolGrid';
import { QuickActionList } from './QuickActionList';
import { WorkflowRunner } from './WorkflowRunner';

// 白名单渲染器（§5.2、§7A）：配置中的每种组件类型对应这里的一个真实组件。
// 配置只提供数据，不包含任何可执行内容。新增组件类型必须同时修改 core 的 schema 和这里。

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

type Tone = NonNullable<ComponentStyle['tone']>;

/** 文字组件的 tone 是文字颜色。 */
function textColor(palette: Palette, tone: Tone | undefined, fallback: string): string {
  switch (tone) {
    case 'primary':
      return palette.primaryText;
    case 'secondary':
      return palette.secondary;
    case 'tertiary':
      return palette.tertiary;
    case 'muted':
      return palette.caption;
    default:
      return fallback;
  }
}

const SIZES = { small: 0.85, medium: 1, large: 1.2 } as const;

function Tile({
  env,
  style,
  icon,
  title,
  subtitle,
  onPress,
  titleColor,
  look,
}: {
  env: RenderEnv;
  style: ComponentStyle | undefined;
  icon: Parameters<typeof IconTile>[0]['icon'];
  title: string;
  subtitle?: string | undefined;
  onPress: () => void;
  titleColor?: string;
  /** row = 像设置页的一行（浅色图标底、右边有箭头），tile = 大图标块（D-230）。 */
  look: EntryLook;
}) {
  const { palette } = env;
  const colors = cardColors(palette, style?.tone);
  const scale = SIZES[style?.size ?? 'medium'];
  const center = style?.align === 'center';
  const stacked = center || env.inCell;
  // 宫格和居中排列里没有横向的位置，总是竖着排。
  const listRow = look === 'row' && !stacked;
  const iconTile = iconColors(palette, listRow ? 'tint' : 'solid', style?.tone);
  return (
    <Card
      palette={palette}
      background={colors.background}
      onPress={env.interactive ? onPress : undefined}
      onLongPress={env.onLongPress}
      style={styles.fill}>
      <View style={center ? styles.tileCenter : stacked ? styles.tileStacked : styles.tileRow}>
        <IconTile
          palette={palette}
          icon={icon}
          size={Math.round((listRow ? 40 : 46) * scale)}
          {...iconTile}
        />
        <View style={[styles.flexText, stacked && styles.centerText, center && styles.centerItems]}>
          <Text
            style={[
              palette.font('title', 16 * scale),
              { color: titleColor ?? palette.text },
              center && styles.textCenter,
            ]}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                palette.font('body', 14 * scale),
                { color: palette.muted },
                center && styles.textCenter,
              ]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {listRow ? (
          <Text style={[palette.font('title', 20), { color: palette.caption }]}>›</Text>
        ) : null}
      </View>
    </Card>
  );
}

function ToolCard({
  toolId,
  look,
  style,
  env,
}: {
  toolId: string;
  look: EntryLook | undefined;
  style?: ComponentStyle;
  env: RenderEnv;
}) {
  const def = env.registry.tools.get(toolId);
  const installed = env.config.tools.find((x) => x.toolId === toolId);
  if (!def || !installed) {
    return (
      <Card palette={env.palette}>
        <Text style={[env.palette.font('body', 15), { color: env.palette.muted }]}>
          {t(env.locale, 'toolMissing')}
        </Text>
      </Card>
    );
  }
  const page = env.config.pages.find((p) => p.id === installed.pageId);
  return (
    <Tile
      env={env}
      style={style}
      icon={def.icon}
      title={page?.title ?? localize(def.name, env.locale)}
      subtitle={localize(def.description, env.locale)}
      onPress={() => env.navigate(pageTarget(installed.pageId))}
      look={look ?? 'tile'}
    />
  );
}

function Group({
  component,
  env,
}: {
  component: Extract<Component, { type: 'group' }>;
  env: RenderEnv;
}) {
  const { palette } = env;
  const children = component.children.filter((c) => !c.hidden);
  const { layout, title } = component.props;
  const item = (c: Component) => (
    <Item
      key={c.id}
      component={c}
      env={layout === 'stack' ? env : { ...env, inCell: true }}
      style={layout === 'stack' ? undefined : styles.cell}
    />
  );
  let body: ReactNode;
  if (layout === 'stack') {
    body = <View style={{ gap: palette.gap }}>{children.map(item)}</View>;
  } else if (layout === 'row') {
    body = <View style={[styles.row, { gap: palette.gap - 4 }]}>{children.map(item)}</View>;
  } else {
    const columns = component.props.columns ?? 2;
    const rows: Component[][] = [];
    for (let i = 0; i < children.length; i += columns) rows.push(children.slice(i, i + columns));
    body = (
      <View style={{ gap: palette.gap - 4 }}>
        {rows.map((row, r) => (
          <View
            key={r}
            style={[
              styles.row,
              {
                gap: palette.gap - 4,
                zIndex: row.some((c) => c.id === env.focus?.selectedId) ? 10 : 0,
              },
            ]}>
            {row.map(item)}
            {Array.from({ length: columns - row.length }, (_, i) => (
              <View key={`empty-${i}`} style={styles.cell} />
            ))}
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {title ? (
        <Text
          style={[
            palette.font('bodyBold', 12),
            {
              color: textColor(palette, component.style?.tone, palette.caption),
              letterSpacing: 0.5,
            },
            component.style?.align === 'center' && styles.textCenter,
          ]}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      {children.length === 0 && env.focus ? <View style={{ height: 44 }} /> : body}
    </View>
  );
}

export function ComponentView({ component, env }: { component: Component; env: RenderEnv }) {
  const { palette } = env;
  const style = component.style;
  const scale = SIZES[style?.size ?? 'medium'];
  const align: TextStyle | undefined = style?.align === 'center' ? styles.textCenter : undefined;
  switch (component.type) {
    case 'filePick':
      return <FilePick source={component.props.source} env={env} />;
    case 'header':
      return (
        <View style={styles.header}>
          <Text
            style={[
              palette.font('display', 28 * scale),
              { color: textColor(palette, style?.tone, palette.text), letterSpacing: -0.5 },
              align,
            ]}>
            {component.props.title}
          </Text>
          {component.props.subtitle ? (
            <Text style={[palette.font('body', 15 * scale), { color: palette.muted }, align]}>
              {component.props.subtitle}
            </Text>
          ) : null}
        </View>
      );
    case 'text':
      return (
        <RichText
          source={component.props.text}
          env={env}
          color={textColor(palette, style?.tone, palette.muted)}
          size={15 * scale}
          align={align}
        />
      );
    case 'toolCard':
      return (
        <ToolCard
          toolId={component.props.toolId}
          look={component.props.look}
          style={style}
          env={env}
        />
      );
    case 'toolGrid':
      return (
        <ToolGrid
          grid={component}
          page={env.config.pages.find((p) => p.id === env.pageId)}
          env={env}
        />
      );
    case 'catalogLink':
      return (
        <Tile
          env={env}
          style={style}
          icon="plus"
          title={component.props.title}
          titleColor={palette.primaryText}
          onPress={() => env.navigate('tools')}
          look={component.props.look ?? 'tile'}
        />
      );
    case 'shortcut':
      return (
        <Tile
          env={env}
          style={style}
          icon={component.props.icon}
          title={component.props.title}
          subtitle={component.props.subtitle}
          onPress={() => env.navigate(component.props.target)}
          look={component.props.look ?? 'row'}
        />
      );
    case 'button':
      return (
        <Button
          palette={palette}
          label={component.props.label}
          variant={component.props.variant}
          icon={component.props.icon}
          onPress={env.interactive ? () => env.navigate(component.props.target) : undefined}
          onLongPress={env.onLongPress}
          style={style?.align === 'center' ? styles.centerSelf : undefined}
        />
      );
    case 'notice': {
      const colors = cardColors(palette, style?.tone ?? 'secondary');
      const fg =
        (style?.tone ?? 'secondary') === 'secondary'
          ? palette.onSecondaryTint
          : style?.tone === 'tertiary'
            ? palette.onTertiaryTint
            : palette.text;
      return (
        <Card palette={palette} background={colors.background} style={styles.noticeCard}>
          <View style={styles.tileRow}>
            {component.props.icon ? (
              <IconTile
                palette={palette}
                icon={component.props.icon}
                size={36}
                {...iconColors(palette, 'solid', style?.tone ?? 'secondary')}
              />
            ) : null}
            <View style={styles.flexText}>
              {component.props.title ? (
                <Text style={[palette.font('title', 15 * scale), { color: fg }, align]}>
                  {component.props.title}
                </Text>
              ) : null}
              <RichText
                source={component.props.text}
                env={env}
                color={fg}
                size={14 * scale}
                align={align}
              />
            </View>
          </View>
        </Card>
      );
    }
    case 'image':
      return (
        <ImageView
          props={component.props}
          env={env}
          componentId={component.id}
          center={style?.align === 'center'}
        />
      );
    case 'divider':
      return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
    case 'spacer':
      return <View style={{ height: { small: 4, medium: 16, large: 32 }[component.props.size] }} />;
    case 'group':
      return <Group component={component} env={env} />;
    case 'recordList':
      return <RecordList props={component.props} env={env} tone={style?.tone} />;
    case 'recordForm':
      return (
        <RecordForm
          props={component.props}
          env={env}
          componentId={component.id}
          tone={style?.tone}
        />
      );
    case 'stat':
      return <Stat props={component.props} env={env} tone={style?.tone} />;
    case 'chart':
      return <Chart props={component.props} env={env} tone={style?.tone} />;
    case 'fileList':
      return (
        <FileList
          title={component.props.title}
          limit={component.props.limit}
          mimeType={component.props.mimeType}
          env={env}
        />
      );
    case 'workflowRunner':
      return (
        <WorkflowRunner
          workflowId={component.props.workflowId}
          look={component.props.look}
          env={env}
        />
      );
    case 'quickActionList':
      return <QuickActionList props={component.props} env={env} />;
  }
}

/**
 * 页面上的一个组件。可编辑的页面里，长按打开它的操作面板（D-052）；
 * 组件内部可点按的部分通过 env.onLongPress 同样响应长按，松手时不会再触发点按。
 */
function Item({
  component,
  env,
  style,
}: {
  component: Component;
  env: RenderEnv;
  style?: StyleProp<ViewStyle>;
}) {
  if (env.focus) {
    return (
      <FocusItem component={component} env={env} style={style}>
        {(itemEnv) => <ComponentView component={component} env={itemEnv} />}
      </FocusItem>
    );
  }
  const edit = env.interactive ? env.edit : undefined;
  if (!edit) {
    return (
      <View testID={`component-${component.id}`} style={style}>
        <ComponentView component={component} env={env} />
      </View>
    );
  }
  const open = () => edit(component.id);
  return (
    <Pressable
      testID={`component-${component.id}`}
      style={style}
      accessible={false}
      onLongPress={open}
      delayLongPress={LONG_PRESS_MS}>
      <ComponentView component={component} env={{ ...env, onLongPress: open }} />
    </Pressable>
  );
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
  header: { paddingVertical: 8, gap: 6 },
  fill: { flexGrow: 1 },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tileCenter: { alignItems: 'center', gap: 10 },
  tileStacked: { alignItems: 'flex-start', gap: 12 },
  flexText: { flex: 1, gap: 3 },
  centerText: { flex: 0 },
  centerItems: { alignItems: 'center' },
  textCenter: { textAlign: 'center' },
  centerSelf: { alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cell: { flex: 1 },
  noticeCard: { shadowOpacity: 0, elevation: 0 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
