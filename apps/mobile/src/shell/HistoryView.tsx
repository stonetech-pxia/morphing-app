import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text } from 'react-native';

import { formatWhen, t } from '../i18n';
import type { RenderEnv } from '../renderer/components';
import { Card, PageTitle } from '../renderer/ui';
import type { RevisionRecord } from '../storage/types';
import { useWorkspace } from '../workspace/context';

/** 改动记录（§3 旅程 D，D-112）：每次修改都是一个不可变版本；回到之前会生成新版本。 */
export function HistoryView({ env }: { env: RenderEnv }) {
  const { palette, locale } = env;
  const router = useRouter();
  const headId = useWorkspace((s) => s.head!.id);
  const listRevisions = useWorkspace((s) => s.listRevisions);
  const proposeRestore = useWorkspace((s) => s.proposeRestore);
  const [revisions, setRevisions] = useState<RevisionRecord[]>([]);

  useEffect(() => {
    let alive = true;
    void listRevisions().then((r) => alive && setRevisions(r));
    return () => {
      alive = false;
    };
  }, [headId, listRevisions]);

  async function restore(id: number) {
    const result = await proposeRestore(id);
    if (result.kind === 'preview') router.push('/change');
    else
      Alert.alert(
        t(locale, 'invalidPlan'),
        result.kind === 'invalid' ? result.issues.join('\n') : result.message,
      );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 160 }}>
      <PageTitle palette={palette}>{t(locale, 'historyTitle')}</PageTitle>
      {revisions.map((r) => (
        <Card
          key={r.id}
          testID={`revision-${r.id}`}
          palette={palette}
          background={r.id === headId ? palette.primaryTint : undefined}>
          <Text style={[palette.font('bodyBold', 12), { color: palette.caption }]}>
            {formatWhen(locale, new Date(r.createdAt), new Date())} ·{' '}
            {t(locale, `source_${r.source}`)}
            {r.id === headId ? ` · ${t(locale, 'current')}` : ''}
          </Text>
          <Text style={[palette.font('bodyMedium', 16), { color: palette.text }]}>{r.summary}</Text>
          {r.id !== headId ? (
            <Pressable testID={`restore-${r.id}`} onPress={() => restore(r.id)} hitSlop={6}>
              <Text style={[palette.font('bodyBold', 14), { color: palette.primaryText }]}>
                {t(locale, 'restoreThis')}
              </Text>
            </Pressable>
          ) : null}
        </Card>
      ))}
    </ScrollView>
  );
}
