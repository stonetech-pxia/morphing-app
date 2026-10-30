import {
  bindRecord,
  entryKind,
  isKnownComponent,
  isRecordToolUse,
  isToolRefUse,
  packageTargetId,
  toolTargetId,
  type Component,
  type ComponentOf,
  type ComponentType,
  type KnownComponent,
  type OpenTarget,
} from '@morph/core';

import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { LONG_PRESS_MS } from '../editing/entry';
import { t } from '../i18n';
import { FocusItem } from '../editing/FocusItem';
import { Chart } from './Chart';
import type { RenderEnv } from './components';
import { RecordForm, RecordList, Stat } from './data';
import { MonthCalendar } from './MonthCalendar';
import { Board } from './Board';
import { Tiles } from './Tiles';
import { FileList } from './FileList';
import { FilePick } from './FilePick';
import { FileSlot } from './FileSlot';
import { ImageView } from './ImageView';
import { onPicture } from './Backdrop';
import { QuickActionList } from './QuickActionList';
import { ActionButton } from './RecordActions';
import { RichText } from './RichText';
import { SIZES, textColor } from './style';
import { cardColors, iconColors } from './theme';
import { Tile, ToolCard } from './Tile';
import { ToolGrid } from './ToolGrid';
import { Button, Card, IconTile } from './ui';
import { WorkflowRunner } from './WorkflowRunner';

// 白名单渲染器（§5.2、§7A）：配置中的每种组件类型对应这里的一个真实组件。
// 配置只提供数据，不包含任何可执行内容。组件的结构定义在 core 的 components/，新增组件见 docs/COMPONENTS.md。

/** 画一个组件。按函数调用（不是 React 组件），所以不能用 hook；要用 hook 的放进自己的组件里。 */
export type Renderer<T extends ComponentType> = (
  component: ComponentOf<T>,
  env: RenderEnv,
) => ReactNode;

/** 打开按钮、快捷入口的目标。草稿里（D-190）快捷操作打不开：打开后就能运行，草稿能看不能用。 */
const open = (env: RenderEnv, target: OpenTarget) =>
  env.locked && toolTargetId(target) !== null ? env.locked() : env.navigate(target);

const scaleOf = (c: KnownComponent) => SIZES[c.style?.size ?? 'medium'];
const alignOf = (c: KnownComponent): TextStyle | undefined =>
  c.style?.align === 'center' ? styles.textCenter : undefined;

export const RENDERERS: { [T in ComponentType]: Renderer<T> } = {
  picker: (c, env) => (
    <FilePick source={pickToolOf(c) === '$pick.files' ? 'files' : 'media'} env={env} />
  ),
  header: (c, { palette }) => (
    <View style={styles.header}>
      <Text
        style={[
          palette.font('display', 28 * scaleOf(c)),
          { color: textColor(palette, c.style?.tone, palette.text), letterSpacing: -0.5 },
          alignOf(c),
        ]}>
        {c.show.title}
      </Text>
      {c.show.subtitle ? (
        <Text style={[palette.font('body', 15 * scaleOf(c)), { color: palette.muted }, alignOf(c)]}>
          {c.show.subtitle}
        </Text>
      ) : null}
    </View>
  ),
  text: (c, env) => (
    <RichText
      source={c.show.text}
      env={env}
      color={textColor(env.palette, c.style?.tone, env.palette.muted)}
      size={15 * scaleOf(c)}
      align={alignOf(c)}
    />
  ),
  // 入口（v34 合并 shortcut、catalogLink、toolCard、fileSlot）：按 opens 分。
  entry: (c, env) => {
    const kind = entryKind(c);
    if (kind === 'file') return <FileSlot component={c} env={env} />;
    const packageId = packageTargetId(c.opens);
    if (packageId !== null)
      return <ToolCard toolId={packageId} look={c.show?.shape} style={c.style} env={env} />;
    const show = c.show ?? {};
    return (
      <Tile
        env={env}
        style={c.style}
        icon={show.icon ?? 'apps'}
        title={show.title ?? ''}
        subtitle={show.subtitle}
        titleColor={show.accent ? env.palette.primaryText : undefined}
        onPress={() => open(env, c.opens)}
        look={show.shape ?? 'row'}
      />
    );
  },
  packages: (c, env) => (
    <ToolGrid
      grid={c}
      page={env.config.containers.pages.find((p) => p.id === env.pageId)}
      env={env}
    />
  ),
  button: (c, env) => {
    const use = c.tools?.[0];
    return use && isRecordToolUse(use) ? (
      <ActionButton
        action={use}
        label={c.show.label}
        variant={c.show.variant}
        icon={c.show.icon}
        env={env}
        style={c.style?.align === 'center' ? styles.centerSelf : undefined}
      />
    ) : (
      <Button
        palette={env.palette}
        label={c.show.label}
        variant={c.show.variant}
        icon={c.show.icon}
        onPress={env.interactive && c.opens ? () => open(env, c.opens!) : undefined}
        onLongPress={env.onLongPress}
        style={c.style?.align === 'center' ? styles.centerSelf : undefined}
      />
    );
  },
  notice: (c, env) => {
    const palette = onPicture(env.palette, c.style?.backdrop);
    const tone = c.style?.tone;
    const colors = cardColors(palette, tone ?? 'secondary');
    const fg =
      (tone ?? 'secondary') === 'secondary'
        ? palette.onSecondaryTint
        : tone === 'tertiary'
          ? palette.onTertiaryTint
          : palette.text;
    return (
      <Card
        palette={palette}
        background={colors.background}
        backdrop={c.style?.backdrop}
        style={styles.noticeCard}>
        <View style={styles.tileRow}>
          {c.show.icon ? (
            <IconTile
              palette={palette}
              icon={c.show.icon}
              size={36}
              {...iconColors(palette, 'solid', tone ?? 'secondary')}
            />
          ) : null}
          <View style={styles.flexText}>
            {c.show.title ? (
              <Text style={[palette.font('title', 15 * scaleOf(c)), { color: fg }, alignOf(c)]}>
                {c.show.title}
              </Text>
            ) : null}
            <RichText
              source={c.show.text}
              env={{ ...env, palette }}
              color={fg}
              size={14 * scaleOf(c)}
              align={alignOf(c)}
            />
          </View>
        </View>
      </Card>
    );
  },
  image: (c, env) => (
    <ImageView props={c.show} env={env} componentId={c.id} center={c.style?.align === 'center'} />
  ),
  divider: (_c, { palette }) => (
    <View style={[styles.divider, { backgroundColor: palette.border }]} />
  ),
  spacer: (c) => <View style={{ height: { small: 4, medium: 16, large: 32 }[c.show.size] }} />,
  group: (c, env) => <Group component={c} env={env} />,
  // 月历（D-305）只读一个月的记录，大圆块（D-311）和看板（D-313）画法不同，都是单独的组件。
  list: (c, env) => <RecordList block={c} env={env} tone={c.style?.tone} />,
  cards: (c, env) => <RecordList block={c} env={env} tone={c.style?.tone} />,
  checklist: (c, env) => <RecordList block={c} env={env} tone={c.style?.tone} />,
  calendar: (c, env) => (
    <MonthCalendar block={c} env={env} tone={c.style?.tone} componentId={c.id} />
  ),
  tiles: (c, env) => <Tiles block={c} env={env} tone={c.style?.tone} />,
  board: (c, env) => <Board block={c} env={env} tone={c.style?.tone} />,
  form: (c, env) => <RecordForm block={c} env={env} tone={c.style?.tone} />,
  number: (c, env) => (
    <Stat block={c} env={env} tone={c.style?.tone} backdrop={c.style?.backdrop} />
  ),
  chart: (c, env) => <Chart block={c} env={env} tone={c.style?.tone} />,
  files: (c, env) => <FileList block={c} env={env} />,
  action: (c, env) => {
    const use = c.tools[0];
    return use && isToolRefUse(use) ? (
      <WorkflowRunner
        workflowId={use.tool}
        look={c.show?.shape}
        backdrop={c.style?.backdrop}
        env={env}
      />
    ) : null;
  },
  library: (c, env) => <QuickActionList block={c} env={env} />,
};

/** 打开相册还是打开文件（picker 的 tools[0]）。 */
const pickToolOf = (c: ComponentOf<'picker'>) => {
  const use = c.tools[0];
  return use && isToolRefUse(use) ? use.tool : undefined;
};

export function ComponentView({ component, env }: { component: Component; env: RenderEnv }) {
  if (!isKnownComponent(component)) return <UnknownComponentView env={env} />;
  return (RENDERERS[component.look] as Renderer<ComponentType>)(component, env);
}

/** 更新的 App 加的组件（D-254）：配置里原样保留，这里只说明要更新 App 才能显示。 */
function UnknownComponentView({ env }: { env: RenderEnv }) {
  return (
    <Card palette={env.palette}>
      <Text style={[env.palette.font('body', 15), { color: env.palette.muted }]}>
        {t(env.locale, 'unknownComponent')}
      </Text>
    </Card>
  );
}

function Group({ component, env }: { component: ComponentOf<'group'>; env: RenderEnv }) {
  const { palette } = env;
  const children = component.children.filter((c) => !c.hidden);
  const { layout, title } = component.show;
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
    const columns = component.show.columns ?? 2;
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

/**
 * 页面上的一个组件。可编辑的页面里，长按打开它的操作面板（D-052）；
 * 组件内部可点按的部分通过 env.onLongPress 同样响应长按，松手时不会再触发点按。
 */
export function Item({
  component,
  env,
  style,
}: {
  component: Component;
  env: RenderEnv;
  style?: StyleProp<ViewStyle>;
}) {
  // D-342：只在画的时候换 "$record"，编辑和长按面板仍用配置里原来的组件。
  const shown = env.recordId ? bindRecord(component, env.recordId) : component;
  if (env.focus) {
    return (
      <FocusItem component={component} env={env} style={style}>
        {(itemEnv) => <ComponentView component={shown} env={itemEnv} />}
      </FocusItem>
    );
  }
  const edit = env.interactive ? env.edit : undefined;
  if (!edit) {
    return (
      <View testID={`component-${component.id}`} style={style}>
        <ComponentView component={shown} env={env} />
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
      <ComponentView component={shown} env={{ ...env, onLongPress: open }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingVertical: 8, gap: 6 },
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  flexText: { flex: 1, gap: 3 },
  textCenter: { textAlign: 'center' },
  centerSelf: { alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cell: { flex: 1 },
  noticeCard: { shadowOpacity: 0, elevation: 0 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
