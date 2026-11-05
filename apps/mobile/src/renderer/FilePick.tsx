import { MAX_PICK, sharedSizeProblem } from '@morph/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { runErrorText, t } from '../i18n';
import { mimeOf } from '../runtime/actions/helpers';
import { releaseShare, useIncoming } from '../share/incoming';
import { useGuide } from '../guide/store';
import { useWorkspaceContext } from '../workspace/context';
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
  const { files } = useWorkspaceContext();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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
      useIncoming.getState().receive(selected, [], 'picker');
      // 新手引导第 2 步时打开了图片或文件：引导结束（第 3 步样板 App 取消了，D-447）。
      if (useGuide.getState().stage === 'goal') void useGuide.getState().setStage('done');
      router.push('/share');
    } catch {
      Alert.alert(label, t(env.locale, 'filePickFailed'));
    } finally {
      setBusy(false);
    }
  }
  const onPress = env.interactive
    ? () => (source === 'open' ? choose() : void pick(source))
    : undefined;
  if (iconOnly) {
    return (
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
    );
  }
  return (
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
  );
}
