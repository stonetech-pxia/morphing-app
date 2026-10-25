import { localize, describeParams } from '@morph/core';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { RenderEnv } from './components';
import { Button, Card, IconTile } from './ui';

/**
 * workflowRunner 组件：显示工作流的步骤，点「开始」打开运行页面。
 * 在宫格里（相邻的多个运行卡片，或用户自己的 grid / row 分组）显示成小方块，整块可点（D-108）。
 */
export function WorkflowRunner({ workflowId, env }: { workflowId: string; env: RenderEnv }) {
  const router = useRouter();
  const { palette, locale, registry } = env;
  const workflow = env.config.workflows.find((w) => w.id === workflowId);
  if (!workflow) return null;
  const label = (action: string) => localize(registry.actions.get(action)?.label, locale) ?? action;
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
    if (env.interactive) router.push({ pathname: '/run/[workflowId]', params: { workflowId } });
  };

  if (env.inCell) {
    const icon =
      workflow.icon ?? (workflow.toolId && registry.tools.get(workflow.toolId)?.icon) ?? 'workflow';
    // 多步的工作流（预设、自己搭的）列出步骤；单功能的名字已经说明了做什么，只列固定的设置。
    const detail =
      workflow.steps.length > 2
        ? workflow.steps
            .slice(1)
            .map((s) => label(s.action))
            .join(' → ')
        : settings;
    return (
      <Card
        palette={palette}
        testID={`run-${workflow.id}`}
        accessibilityLabel={workflow.name}
        onPress={start}
        onLongPress={env.onLongPress}
        style={styles.tile}>
        <IconTile
          palette={palette}
          icon={icon}
          background={palette.primaryTint}
          color={palette.primaryText}
          size={40}
        />
        <Text numberOfLines={2} style={[palette.font('title', 15), { color: palette.text }]}>
          {workflow.name}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={[palette.font('body', 12), { color: palette.caption }]}>
            {detail}
          </Text>
        ) : null}
      </Card>
    );
  }

  return (
    <Card palette={palette} onLongPress={env.onLongPress}>
      <Text style={[palette.font('title', 17), { color: palette.text }]}>{workflow.name}</Text>
      <View style={styles.steps}>
        {workflow.steps.map((s, i) => (
          <Text
            key={s.id}
            testID={`step-${s.id}`}
            style={[palette.font('body', 14), { color: palette.muted }]}>
            {`${i > 0 ? '→ ' : ''}${label(s.action)}`}
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
  tile: { flex: 1, minHeight: 132 },
});
