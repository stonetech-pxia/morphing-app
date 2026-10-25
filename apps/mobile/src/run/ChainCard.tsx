import type { Workflow } from '@morph/core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Card, Pill } from '../renderer/ui';
import type { IncomingShare } from '../share/incoming';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { dismissChain, recordChain, sameWorkflow } from './chains';

export function ChainCard({
  source,
  workflow,
  palette,
}: {
  source: NonNullable<IncomingShare['result']>;
  workflow: Workflow;
  palette: Palette;
}) {
  const { repo, locale } = useWorkspaceContext();
  const workflows = useWorkspace((s) => s.config!.workflows);
  const first = workflows.find((w) => w.id === source.workflow.id);
  const second = workflows.find((w) => w.id === workflow.id);
  const valid =
    first && second && sameWorkflow(first, source.workflow) && sameWorkflow(second, workflow);
  const [suggest, setSuggest] = useState(false);
  const router = useRouter();
  useEffect(() => {
    let live = true;
    if (valid)
      void recordChain(repo, source.workflow, workflow, source.runId)
        .then((ready) => {
          if (live) setSuggest(ready);
        })
        .catch(() => {
          /* 统计失败不阻塞结果。 */
        });
    return () => {
      live = false;
    };
    // 每次成功运行只记一次，不在 UI 重绘时重复记。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!valid || !suggest) return null;
  return (
    <Card palette={palette} testID="chain-card">
      <Text style={[palette.font('body', 14), { color: palette.text }]}>
        {t(locale, 'chainAbout', { first: first.name, second: second.name })}
      </Text>
      <View style={styles.row}>
        <Pill
          palette={palette}
          testID="chain-make"
          label={t(locale, 'chainMake')}
          onPress={() => {
            void dismissChain(repo, first, second).catch(() => undefined);
            router.push({
              pathname: '/change',
              params: { first: first.id, second: second.id, text: t(locale, 'chainRequest') },
            });
          }}
        />
        <Pill
          palette={palette}
          testID="chain-no"
          label={t(locale, 'habitNo')}
          onPress={() => {
            setSuggest(false);
            void dismissChain(repo, first, second).catch(() => undefined);
          }}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
});
