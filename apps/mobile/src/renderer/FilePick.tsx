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
import { Button } from './ui';

/** 只由内核选择文件；草稿、预览和取消不会产生一次收件。 */
export function FilePick({ source, env }: { source: 'media' | 'files'; env: RenderEnv }) {
  const { files } = useWorkspaceContext();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = t(env.locale, source === 'media' ? 'openMedia' : 'openFiles');
  async function pick() {
    if (env.locked) return env.locked();
    if (!env.interactive || busy) return;
    setBusy(true);
    try {
      const selected =
        source === 'media'
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
      // 新手引导第 2 步就是打开图片或文件（D-231）：打开了，引导结束。
      if (useGuide.getState().stage === 'goal') void useGuide.getState().setStage('done');
      router.push('/share');
    } catch {
      Alert.alert(label, t(env.locale, 'filePickFailed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      palette={env.palette}
      label={label}
      testID={`file-pick-${source}`}
      disabled={busy}
      loading={busy}
      onPress={env.interactive ? () => void pick() : undefined}
      onLongPress={env.onLongPress}
      style={{ minHeight: 76 }}
    />
  );
}
