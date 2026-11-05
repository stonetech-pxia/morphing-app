import { findWorkflowTarget, quickActionsOf, type Workflow } from '@morph/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';
import { Icon } from './Icon';

/** 最多几个。 */
const MAX = 4;

/**
 * 最近用过的快捷操作（look library，source.recent，D-452）：读已有的运行记录（tool_runs，成功的那些，
 * 按最后一次运行从新到旧），一行小胶囊，点一下打开运行页面。没有用过时整块不显示。只读（底线 15）。
 */
export function RecentActions({ title, env }: { title: string | undefined; env: RenderEnv }) {
  const { repo } = useWorkspaceContext();
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  const { palette, locale, registry } = env;

  // 回到这一页时重新读一次：刚运行完回来就能看到。
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void repo.countSucceededRuns().then((runs) => {
        if (!alive) return;
        setIds([...runs.entries()].sort((a, b) => b[1].lastAt - a[1].lastAt).map(([id]) => id));
      });
      return () => {
        alive = false;
      };
    }, [repo]),
  );

  const flows: Workflow[] = [];
  for (const id of ids) {
    const flow = findWorkflowTarget(quickActionsOf(env.config), id, locale);
    if (flow && !flows.some((f) => f.id === flow.id)) flows.push(flow);
    if (flows.length === MAX) break;
  }
  if (flows.length === 0) return null;

  return (
    <View style={styles.block} testID="recent-actions">
      {title ? (
        <Text style={[palette.font('bodyMedium', 14), styles.title, { color: palette.caption }]}>
          {title}
        </Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}>
        {flows.map((flow) => {
          const icon =
            flow.icon ?? (flow.package && registry.tools.get(flow.package)?.icon) ?? 'workflow';
          return (
            <Pressable
              key={flow.id}
              testID={`recent-${flow.id}`}
              accessibilityRole="button"
              disabled={!env.interactive}
              onPress={
                env.locked ??
                (() =>
                  router.push({ pathname: '/run/[workflowId]', params: { workflowId: flow.id } }))
              }
              onLongPress={env.onLongPress}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: palette.surface, opacity: pressed ? 0.7 : 1 },
              ]}>
              <Icon name={icon} size={16} color={palette.primaryText} />
              <Text numberOfLines={1} style={[palette.font('body', 14), { color: palette.text }]}>
                {flow.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  title: { paddingHorizontal: 4 },
  row: { gap: 8, paddingRight: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 220,
  },
});
