import { MAX_PICK, sharedSizeProblem } from '@morph/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, View } from 'react-native';

import { runErrorText, t } from '../i18n';
import { mimeOf } from '../runtime/actions/helpers';
import { releaseShare, useIncoming } from '../share/incoming';
import { useGuide } from '../guide/store';
import { keepIncomingFiles } from '../storage/keep-files';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';
import { IconButton } from './IconButton';
import { Button } from './ui';

/**
 * 只由内核选择文件；草稿、预览和取消不会产生一次收件。
 * open（D-449）：先问从相册还是从「文件」选；iconOnly：只有图标的白底按钮。
 */
export function FilePick({
  source,
  iconOnly,
  env,
}: {
  source: 'media' | 'files' | 'open';
  iconOnly?: boolean;
  env: RenderEnv;
}) {
  const { files, repo } = useWorkspaceContext();
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // 存进文档库的进度（一次打开很多张照片要好几秒，2026-11-06 测试：屏幕灰着没有提示）。
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const label = t(env.locale, source === 'media' ? 'openMedia' : 'openFiles');
  function choose() {
    if (env.locked) return env.locked();
    if (!env.interactive || busy) return;
    Alert.alert(label, undefined, [
      { text: t(env.locale, 'pickFromPhotos'), onPress: () => void pick('media') },
      { text: t(env.locale, 'pickFromFiles'), onPress: () => void pick('files') },
      { text: t(env.locale, 'cancel'), style: 'cancel' },
    ]);
  }
  async function pick(from: 'media' | 'files') {
    if (env.locked) return env.locked();
    if (!env.interactive || busy) return;
    setBusy(true);
    try {
      const selected =
        from === 'media'
          ? await files.pickMedia(MAX_PICK)
          : await files.pickDocuments(['*/*'], true);
      if (!selected?.length) return;
      const problem = sharedSizeProblem(
        selected.map((f) => ({ ...f, mimeType: mimeOf(f.name, f.mimeType) })),
      );
      if (problem?.code === 'tooMany') {
        // 选多了不收：选择器复制进缓存的副本（视频可能很大）也删掉。
        await files.removePickedCopies(selected.map((f) => f.uri)).catch(() => undefined);
        Alert.alert(
          label,
          runErrorText(env.locale, 'tooMany', {
            max: problem.detail.max,
          }),
        );
        return;
      }
      const previous = useIncoming.getState().share;
      if (previous) await releaseShare(files, previous.id);
      // 打开的文件存进文档库（D-455），再进收件页面。
      if (selected.length > 1) setSaving({ done: 0, total: selected.length });
      const kept = await keepIncomingFiles(selected, files, repo, (done, total) =>
        setSaving(total > 1 ? { done, total } : null),
      );
      setSaving(null);
      bumpAssets();
      useIncoming.getState().receive(kept, [], 'picker');
      // 新手引导第 2 步时打开了图片或文件：引导结束（第 3 步样板 App 取消了，D-447）。
      if (useGuide.getState().stage === 'goal') void useGuide.getState().setStage('done');
      router.push('/share');
    } catch {
      Alert.alert(label, t(env.locale, 'filePickFailed'));
    } finally {
      setSaving(null);
      setBusy(false);
    }
  }
  const progress = saving ? (
    <Modal visible transparent animationType="fade">
      <View style={styles.dim}>
        <View
          testID="file-pick-progress"
          style={[styles.card, { backgroundColor: env.palette.surface }]}>
          <ActivityIndicator color={env.palette.primary} />
          <Text style={[env.palette.font('body', 15), { color: env.palette.text }]}>
            {t(env.locale, 'importSaving', { done: saving.done, total: saving.total })}
          </Text>
        </View>
      </View>
    </Modal>
  ) : null;
  const onPress = env.interactive
    ? () => (source === 'open' ? choose() : void pick(source))
    : undefined;
  if (iconOnly) {
    return (
      <>
        {progress}
        <IconButton
          palette={env.palette}
          icon={source === 'media' ? 'photo' : 'folder'}
          {...(source === 'media' ? {} : { glyph: 'folderOpen' as const })}
          label={label}
          testID={`file-pick-${source}`}
          disabled={busy}
          onPress={onPress}
          onLongPress={env.onLongPress}
          column={env.cellColumn}
        />
      </>
    );
  }
  return (
    <>
      {progress}
      <Button
        palette={env.palette}
        label={label}
        testID={`file-pick-${source}`}
        disabled={busy}
        loading={busy}
        onPress={onPress}
        onLongPress={env.onLongPress}
        style={{ minHeight: 76 }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  dim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 16,
  },
});
