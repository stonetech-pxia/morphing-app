import {
  builtinText,
  describeParams,
  findWorkflowTarget,
  stepLabel,
  quickActionsOf,
  type Backdrop,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { onPicture } from './Backdrop';
import type { RenderEnv } from './components';
import { UiIcon } from './Icon';
import { IconButton } from './IconButton';
import { iconColors } from './theme';
import { Button, Card, IconTile } from './ui';

/**
 * workflowRunner 组件：显示工作流的步骤，点「开始」打开运行页面。
 * 在宫格里（相邻的多个运行卡片，或用户自己的 grid / row 分组）显示成小方块，整块可点（D-108）。
 * look 指定了样子时不看位置：card = 卡片加「运行」按钮，row = 一行、右边 ▶，tile = 小方块（D-230），
 * icon = 只有图标的白底按钮（D-449）。
 */
export function WorkflowRunner({
  workflowId,
  look,
  backdrop,
  env,
}: {
  workflowId: string;
  look?: 'card' | 'row' | 'tile' | 'icon';
  /** 图片背景（D-258）。 */
  backdrop?: Backdrop | undefined;
  env: RenderEnv;
}) {
  const router = useRouter();
  const { locale, registry } = env;
  const palette = onPicture(env.palette, backdrop);
  // 可以指向内设快捷操作的预设 ID；用户改过以后配置里的副本优先（D-259）。
  const found = findWorkflowTarget(quickActionsOf(env.config), workflowId, locale);
  if (!found) return null;
  // 内设快捷操作的名字跟着界面语言显示（用户改过的不换）。
  const workflow = { ...found, name: builtinText(found.name, locale, registry) };
  const label = (s: { action: string; params: Record<string, unknown> }) =>
    stepLabel(registry.actions.get(s.action), s.params, locale) ?? s.action;
  // 关键设置（例如「不超过 500 KB」）；每次运行时询问的参数不列出。
  const settings = workflow.steps
    .flatMap((s) => {
      const action = registry.actions.get(s.action);
      if (!action || action.input.length === 0) return [];
      const fixed = action.fields.map((f) => f.key).filter((k) => !s.ask?.includes(k));
      const text = describeParams(action, s.params, locale, new Date(), fixed);
      return text ? [text] : [];
    })
    .join(t(locale, 'separatorSemicolon'));
  const start = () => {
    if (env.locked) return env.locked();
    if (env.interactive)
      router.push({ pathname: '/run/[workflowId]', params: { workflowId: workflow.id } });
  };

  const shown = look ?? (env.inCell ? 'tile' : 'card');
  const icon =
    workflow.icon ?? (workflow.package && registry.tools.get(workflow.package)?.icon) ?? 'workflow';
  // 多步的工作流（预设、自己搭的）列出步骤；单功能的名字已经说明了做什么，只列固定的设置。
  const detail =
    workflow.steps.length > 2
      ? workflow.steps
          .slice(1)
          .map((s) => label(s))
          .join(' → ')
      : settings;

  if (shown === 'icon') {
    return (
      <IconButton
        palette={palette}
        icon={icon}
        label={workflow.name}
        testID={`run-${workflow.id}`}
        onPress={start}
        onLongPress={env.onLongPress}
        column={env.cellColumn}
      />
    );
  }

  if (shown === 'row') {
    const play = iconColors(palette, 'tint');
    return (
      <Card
        palette={palette}
        backdrop={backdrop}
        testID={`run-${workflow.id}`}
        accessibilityLabel={workflow.name}
        onPress={start}
        onLongPress={env.onLongPress}>
        <View style={styles.row}>
          <IconTile palette={palette} icon={icon} size={40} {...iconColors(palette, 'tint')} />
          <View style={styles.rowText}>
            <Text numberOfLines={2} style={[palette.font('title', 16), { color: palette.text }]}>
              {workflow.name}
            </Text>
            {detail ? (
              <Text
                numberOfLines={2}
                style={[palette.font('body', 13), { color: palette.caption }]}>
                {detail}
              </Text>
            ) : null}
          </View>
          <View style={[styles.play, { backgroundColor: play.background }]}>
            <UiIcon name="play" size={18} color={play.color} />
          </View>
        </View>
      </Card>
    );
  }

  if (shown === 'tile') {
    return (
      <Card
        palette={palette}
        backdrop={backdrop}
        testID={`run-${workflow.id}`}
        accessibilityLabel={workflow.name}
        onPress={start}
        onLongPress={env.onLongPress}
        style={styles.tile}>
        <IconTile palette={palette} icon={icon} size={40} {...iconColors(palette, 'tint')} />
        {/* 名字放不下两行时缩一点字号，不截断（法语的名字长，D-487）。 */}
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={[palette.font('title', 15), { color: palette.text }]}>
          {workflow.name}
        </Text>
        {/* D-487：多步的快捷操作（扫成 PDF、合并文件……）方块上只有图标和名字：步骤链几个方块都差不多又长，不放；
            单功能的（压缩照片……）名字说不全，照旧放固定的设置。 */}
        {workflow.steps.length <= 2 && settings ? (
          <Text numberOfLines={2} style={[palette.font('body', 12), { color: palette.caption }]}>
            {settings}
          </Text>
        ) : null}
      </Card>
    );
  }

  return (
    <Card palette={palette} backdrop={backdrop} onLongPress={env.onLongPress}>
      <Text style={[palette.font('title', 17), { color: palette.text }]}>{workflow.name}</Text>
      <View style={styles.steps}>
        {workflow.steps.map((s, i) => (
          <Text
            key={s.id}
            testID={`step-${s.id}`}
            style={[palette.font('body', 14), { color: palette.muted }]}>
            {`${i > 0 ? '→ ' : ''}${label(s)}`}
          </Text>
        ))}
      </View>
      {settings ? (
        <Text style={[palette.font('body', 13), { color: palette.caption }]}>{settings}</Text>
      ) : null}
      <Button
        palette={palette}
        testID={`run-${workflow.id}`}
        label={t(locale, 'run')}
        onPress={start}
        onLongPress={env.onLongPress}
        style={styles.run}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 2 },
  run: { marginTop: 6 },
  // 图标加最多两行的名字，内容约 124pt：同一行的方块一样高（D-487）。
  tile: { flex: 1, minHeight: 132 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 2 },
  play: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
