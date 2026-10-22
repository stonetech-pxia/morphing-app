import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { RenderEnv } from './components';
import { Button, Card } from './ui';

/** workflowRunner 组件：显示工作流的步骤，点「开始」打开运行页面。 */
export function WorkflowRunner({ workflowId, env }: { workflowId: string; env: RenderEnv }) {
  const router = useRouter();
  const { palette, locale, registry } = env;
  const workflow = env.config.workflows.find((w) => w.id === workflowId);
  if (!workflow) return null;
  const label = (action: string) => registry.actions.get(action)?.label[locale] ?? action;

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
      <Button
        palette={palette}
        testID={`run-${workflow.id}`}
        label={t(locale, 'run')}
        onPress={() => {
          if (env.interactive)
            router.push({ pathname: '/run/[workflowId]', params: { workflowId } });
        }}
        onLongPress={env.onLongPress}
        style={styles.run}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 2 },
  run: { marginTop: 6 },
});
