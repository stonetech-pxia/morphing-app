import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import type { RenderEnv } from '../renderer/components';
import type { RevisionRecord } from '../storage/types';
import { useWorkspace } from '../workspace/context';

/** 历史版本（§3 旅程 D）：每次修改都是一个不可变版本；恢复会生成新版本。 */
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
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={[styles.title, { color: palette.text }]}>{t(locale, 'historyTitle')}</Text>
      {revisions.map((r) => (
        <View
          key={r.id}
          testID={`revision-${r.id}`}
          style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={{ color: palette.subtext, fontSize: 13 }}>
            #{r.id} · {t(locale, `source_${r.source}`)} ·{' '}
            {new Date(r.createdAt).toLocaleString(locale)}
            {r.id === headId ? ` · ${t(locale, 'current')}` : ''}
          </Text>
          <Text style={[styles.summary, { color: palette.text }]}>{r.summary}</Text>
          {r.id !== headId ? (
            <Pressable testID={`restore-${r.id}`} onPress={() => restore(r.id)}>
              <Text style={{ color: palette.primary, fontWeight: '600' }}>
                {t(locale, 'restoreThis')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, paddingBottom: 160 },
  title: { fontSize: 28, fontWeight: '700', paddingVertical: 8 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 6 },
  summary: { fontSize: 16 },
});
