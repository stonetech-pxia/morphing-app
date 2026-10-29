import {
  isKnownComponent,
  workflowTargetId,
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
import { FileList } from './FileList';
import { FilePick } from './FilePick';
import { FileSlot } from './FileSlot';
import { ImageView } from './ImageView';
import { onPicture } from './Backdrop';
import { QuickActionList } from './QuickActionList';
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
  env.locked && workflowTargetId(target) !== null ? env.locked() : env.navigate(target);

const scaleOf = (c: KnownComponent) => SIZES[c.style?.size ?? 'medium'];
const alignOf = (c: KnownComponent): TextStyle | undefined =>
  c.style?.align === 'center' ? styles.textCenter : undefined;

export const RENDERERS: { [T in ComponentType]: Renderer<T> } = {
  filePick: (c, env) => <FilePick source={c.props.source} env={env} />,
  header: (c, { palette }) => (
    <View style={styles.header}>
      <Text
        style={[
          palette.font('display', 28 * scaleOf(c)),
          { color: textColor(palette, c.style?.tone, palette.text), letterSpacing: -0.5 },
          alignOf(c),
        ]}>
        {c.props.title}
      </Text>
      {c.props.subtitle ? (
        <Text style={[palette.font('body', 15 * scaleOf(c)), { color: palette.muted }, alignOf(c)]}>
          {c.props.subtitle}
        </Text>
      ) : null}
    </View>
  ),
  text: (c, env) => (
    <RichText
      source={c.props.text}
      env={env}
      color={textColor(env.palette, c.style?.tone, env.palette.muted)}
      size={15 * scaleOf(c)}
      align={alignOf(c)}
    />
  ),
  toolCard: (c, env) => (
    <ToolCard toolId={c.props.toolId} look={c.props.look} style={c.style} env={env} />
  ),
  toolGrid: (c, env) => (
    <ToolGrid grid={c} page={env.config.pages.find((p) => p.id === env.pageId)} env={env} />
  ),
  catalogLink: (c, env) => (
    <Tile
      env={env}
      style={c.style}
      icon="plus"
      title={c.props.title}
      titleColor={env.palette.primaryText}
      onPress={() => env.navigate('tools')}
      look={c.props.look ?? 'tile'}
    />
  ),
  shortcut: (c, env) => (
    <Tile
      env={env}
      style={c.style}
      icon={c.props.icon}
      title={c.props.title}
      subtitle={c.props.subtitle}
      onPress={() => open(env, c.props.target)}
      look={c.props.look ?? 'row'}
    />
  ),
  button: (c, env) => (
    <Button
      palette={env.palette}
      label={c.props.label}
      variant={c.props.variant}
      icon={c.props.icon}
      onPress={env.interactive ? () => open(env, c.props.target) : undefined}
      onLongPress={env.onLongPress}
      style={c.style?.align === 'center' ? styles.centerSelf : undefined}
    />
  ),
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
          {c.props.icon ? (
            <IconTile
              palette={palette}
              icon={c.props.icon}
              size={36}
              {...iconColors(palette, 'solid', tone ?? 'secondary')}
            />
          ) : null}
          <View style={styles.flexText}>
            {c.props.title ? (
              <Text style={[palette.font('title', 15 * scaleOf(c)), { color: fg }, alignOf(c)]}>
                {c.props.title}
              </Text>
            ) : null}
            <RichText
              source={c.props.text}
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
    <ImageView props={c.props} env={env} componentId={c.id} center={c.style?.align === 'center'} />
  ),
  divider: (_c, { palette }) => (
    <View style={[styles.divider, { backgroundColor: palette.border }]} />
  ),
  spacer: (c) => <View style={{ height: { small: 4, medium: 16, large: 32 }[c.props.size] }} />,
  group: (c, env) => <Group component={c} env={env} />,
  // 月历（D-302）只读一个月的记录，是单独的组件。
  recordList: (c, env) =>
    c.props.display === 'calendar' ? (
      <MonthCalendar props={c.props} env={env} tone={c.style?.tone} componentId={c.id} />
    ) : (
      <RecordList props={c.props} env={env} tone={c.style?.tone} />
    ),
  recordForm: (c, env) => (
    <RecordForm props={c.props} env={env} componentId={c.id} tone={c.style?.tone} />
  ),
  stat: (c, env) => (
    <Stat props={c.props} env={env} tone={c.style?.tone} backdrop={c.style?.backdrop} />
  ),
  chart: (c, env) => <Chart props={c.props} env={env} tone={c.style?.tone} />,
  fileList: (c, env) => (
    <FileList title={c.props.title} limit={c.props.limit} mimeType={c.props.mimeType} env={env} />
  ),
  workflowRunner: (c, env) => (
    <WorkflowRunner
      workflowId={c.props.workflowId}
      look={c.props.look}
      backdrop={c.style?.backdrop}
      env={env}
    />
  ),
  quickActionList: (c, env) => <QuickActionList props={c.props} env={env} />,
  fileSlot: (c, env) => <FileSlot component={c} env={env} />,
};

export function ComponentView({ component, env }: { component: Component; env: RenderEnv }) {
  if (!isKnownComponent(component)) return <UnknownComponentView env={env} />;
  return (RENDERERS[component.type] as Renderer<ComponentType>)(component, env);
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
