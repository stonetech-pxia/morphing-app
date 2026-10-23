import {
  sanitizeFileName,
  shareFit,
  sharedSizeProblem,
  uniqueFileName,
  type ShareFit,
  type Workflow,
} from '@morph/core';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { runErrorText } from '../i18n';
import { formatSize } from '../renderer/FileList';
import { Icon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { Button, Card, Pill, SectionLabel } from '../renderer/ui';
import { baseName, extOf, mimeOf } from '../runtime/actions/helpers';
import { newAssetId } from '../runtime/runner';
import { stepChain } from '../shell/WorkflowsScreen';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { releaseShare, useIncoming } from './incoming';

/**
 * 收件页面（TOOLS_DESIGN §11，D-117）：「收到 N 个文件」，列出能接这些文件的工作流，点一个才运行
 * （不会自动运行）；也可以存到 Morph 文件。文件名和大小只在本机显示，不发给 AI。由内核提供，AI 不能修改。
 */
export function ShareScreen() {
  const { repo, files, registry, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const showToast = useWorkspace((s) => s.showToast);
  const palette = usePalette(config.theme);
  const share = useIncoming((s) => s.share);
  const router = useRouter();
  const zh = locale === 'zh';
  const [saving, setSaving] = useState(false);
  // 交给运行页面或已经存好时为 true：离开页面时不删文件（运行页面关闭时再删）。
  const handed = useRef(false);
  const shareId = useRef(share?.id);
  useEffect(() => {
    shareId.current = share?.id;
  }, [share?.id]);

  useEffect(
    () => () => {
      // 关掉收件页面（返回、下滑）又没有处理：删掉共享目录里的副本。
      if (!handed.current && shareId.current !== undefined) {
        void releaseShare(files, shareId.current);
      }
    },
    [files],
  );

  const caption = [palette.font('body', 13), { color: palette.muted }];
  const title = share
    ? zh
      ? `收到 ${share.files.length} 个文件`
      : `${share.files.length} file${share.files.length === 1 ? '' : 's'} received`
    : zh
      ? '分享到 Morph'
      : 'Shared with Morph';

  if (!share || share.files.length === 0) {
    return (
      <View style={[styles.empty, { padding: palette.pad }]} testID="share-screen">
        <Stack.Screen options={{ title }} />
        <Text testID="share-none" style={[palette.font('body', 15), { color: palette.muted }]}>
          {zh
            ? 'Morph 只接收文件（照片、PDF 等），文字和网址不行。'
            : 'Morph only takes files (photos, PDFs and so on), not text or links.'}
        </Text>
        <Button palette={palette} label={zh ? '关闭' : 'Close'} onPress={() => router.back()} />
      </View>
    );
  }

  const infos = share.files.map((f) => ({
    name: f.name,
    mimeType: mimeOf(f.name, f.mimeType),
    size: f.size,
  }));
  const sizeProblem = sharedSizeProblem(infos);
  // 只列出第一步收文件、类型对得上的工作流；个数不对的列出来但不能点，说明原因。
  const candidates = [
    ...config.workflows.filter((w) => !w.toolId),
    ...config.workflows.filter((w) => w.toolId),
  ]
    .map((wf) => ({ wf, fit: shareFit(wf, infos) }))
    .filter(({ fit }) => fit.ok || fit.reason !== 'type')
    // 能运行的排在前面（排序是稳定的，组内保持原来的顺序）。
    .sort((a, b) => Number(b.fit.ok) - Number(a.fit.ok));

  const reason = (fit: ShareFit) =>
    fit.ok
      ? ''
      : fit.reason === 'tooFew'
        ? zh
          ? `需要至少 ${fit.min} 个文件`
          : `Needs at least ${fit.min} files`
        : fit.reason === 'tooMany'
          ? zh
            ? `最多 ${fit.max} 个文件`
            : `Takes at most ${fit.max} files`
          : '';

  function run(wf: Workflow) {
    handed.current = true;
    router.replace({
      pathname: '/run/[workflowId]',
      params: { workflowId: wf.id, shared: String(share!.id) },
    });
  }

  async function save() {
    if (!share) return;
    setSaving(true);
    try {
      const existing = (await repo.listAssets()).map((a) => a.name);
      for (const f of share.files) {
        const clean = sanitizeFileName(f.name);
        const mimeType = mimeOf(clean, f.mimeType);
        const ext = extOf(clean) || (mimeType === 'application/pdf' ? 'pdf' : 'bin');
        const name = uniqueFileName(baseName(clean), ext, existing);
        existing.push(name);
        const id = newAssetId();
        const stored = await files.importFile(f, id, name);
        await repo.addAsset({
          id,
          name,
          mimeType,
          size: stored.size,
          path: stored.path,
          source: 'picked',
          createdAt: Date.now(),
        });
      }
      bumpAssets();
      handed.current = true;
      await releaseShare(files, share.id);
      showToast({
        message: zh
          ? `已存到文件：${share.files.length} 个`
          : `Saved to files: ${share.files.length}`,
      });
      if (router.canDismiss()) router.dismissAll();
      else router.replace('/');
    } catch (e) {
      Alert.alert(zh ? '没能保存' : 'Could not save', String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      testID="share-screen"
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      <Stack.Screen options={{ title }} />
      <Card palette={palette}>
        {share.files.map((f, i) => (
          <View
            key={`${i}-${f.uri}`}
            style={[
              styles.file,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
            ]}>
            <Icon
              name={infos[i]!.mimeType.startsWith('image/') ? 'photo' : 'document'}
              size={18}
              color={palette.secondary}
            />
            <Text
              numberOfLines={1}
              style={[styles.flex, palette.font('bodyMedium', 15), { color: palette.text }]}>
              {f.name}
            </Text>
            {f.size !== null ? (
              <Text style={[palette.font('body', 13), { color: palette.caption }]}>
                {formatSize(f.size)}
              </Text>
            ) : null}
          </View>
        ))}
      </Card>
      <Text style={caption}>
        {zh
          ? '文件只在这台手机上处理，AI 看不到文件名和内容。'
          : 'Files are handled on this device only; AI never sees their names or contents.'}
      </Text>

      {sizeProblem ? (
        <Card palette={palette}>
          <Text
            testID="share-too-large"
            style={[palette.font('bodyMedium', 15), { color: palette.danger }]}>
            {runErrorText(locale, sizeProblem.code, sizeProblem.detail)}
          </Text>
        </Card>
      ) : (
        <>
          <Button
            palette={palette}
            testID="share-save"
            variant="outline"
            label={zh ? '存到 Morph 文件' : 'Save to Morph files'}
            loading={saving}
            disabled={saving}
            onPress={() => void save()}
          />
          <SectionLabel palette={palette}>{zh ? '用工作流处理' : 'Run a workflow'}</SectionLabel>
          {candidates.length === 0 ? (
            <Card palette={palette}>
              <Text testID="share-no-workflows" style={caption}>
                {zh
                  ? '没有能处理这些文件的工作流。可以在「设置 → 工作流」里从预设添加一个。'
                  : 'No workflow takes these files. Add one from the presets in Settings → Workflows.'}
              </Text>
            </Card>
          ) : (
            candidates.map(({ wf, fit }) => (
              <Card key={wf.id} palette={palette} testID={`share-workflow-${wf.id}`}>
                <Text style={[palette.font('title', 16), { color: palette.text }]}>{wf.name}</Text>
                {wf.toolId ? (
                  <Text style={caption}>{registry.tools.get(wf.toolId)?.name[locale]}</Text>
                ) : null}
                <Text style={caption}>{stepChain(wf, registry, locale)}</Text>
                {fit.ok ? (
                  <View style={styles.actions}>
                    <Pill
                      palette={palette}
                      testID={`share-run-${wf.id}`}
                      label={zh ? '运行' : 'Run'}
                      onPress={() => run(wf)}
                    />
                  </View>
                ) : (
                  <Text style={[palette.font('bodyMedium', 13), { color: palette.danger }]}>
                    {reason(fit)}
                  </Text>
                )}
              </Card>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, gap: 16, justifyContent: 'center' },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
});
