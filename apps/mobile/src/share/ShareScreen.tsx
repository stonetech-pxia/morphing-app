import {
  WORKFLOW_PRESETS,
  newWorkflowId,
  presetWorkflow,
  sanitizeFileName,
  shareFit,
  sharedSizeProblem,
  uniqueFileName,
  type ShareFit,
  type Workflow,
} from '@morph/core';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import { runErrorText } from '../i18n';
import { formatSize } from '../renderer/FileList';
import { Icon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { Button, Card, Pill, SectionLabel } from '../renderer/ui';
import { baseName, extOf, mimeOf } from '../runtime/actions/helpers';
import { useWorkflowChange } from '../run/workflow-change';
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
  const change = useWorkflowChange();
  // 打开 AI 之前已有的快捷操作：回来后新做的那个标「刚做好」、排在最前面（D-129）。
  const [knownIds, setKnownIds] = useState<Set<string> | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  // AI 做好回到这里时，新的排在最前：滚到顶上让用户看到（否则还停在「让 AI 搭一个」那里）。
  const newest = knownIds
    ? config.workflows.find((w) => !w.toolId && !knownIds.has(w.id))?.id
    : undefined;
  useEffect(() => {
    if (newest) scroll.current?.scrollTo({ y: 0, animated: true });
  }, [newest]);
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
    // 能运行的排在前面（排序是稳定的，组内保持原来的顺序）；刚让 AI 做好的排最前。
    .sort((a, b) => Number(b.fit.ok) - Number(a.fit.ok))
    .sort((a, b) => Number(isNew(b.wf)) - Number(isNew(a.wf)));
  const mine = candidates.filter(({ wf }) => !wf.toolId);
  const fromTools = candidates.filter(({ wf }) => wf.toolId);
  // 还没添加、第一步收得下这些文件的现成快捷操作（D-129）。
  const presets = WORKFLOW_PRESETS.filter((p) => !config.workflows.some((w) => w.presetId === p.id))
    .map((preset) => ({ preset, wf: presetWorkflow(preset, locale, preset.id) }))
    .filter(({ wf }) => shareFit(wf, infos).ok);

  function isNew(wf: Workflow) {
    return knownIds !== null && !wf.toolId && !knownIds.has(wf.id);
  }

  const workflowCard = ({ wf, fit }: (typeof candidates)[number]) => (
    <Card key={wf.id} palette={palette} testID={`share-workflow-${wf.id}`}>
      <Text style={[palette.font('title', 16), { color: palette.text }]}>
        {wf.name}
        {isNew(wf) ? (zh ? ' · 刚做好' : ' · just made') : ''}
      </Text>
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
  );

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

  /** 添加一个现成的快捷操作（可撤销），然后用分享的文件运行它。 */
  async function addAndRun(preset: (typeof WORKFLOW_PRESETS)[number]) {
    const wf = presetWorkflow(preset, locale, newWorkflowId(preset.id, config.workflows));
    const ok = await change(
      [{ op: 'addWorkflow', workflow: wf }],
      zh ? `添加了快捷操作「${wf.name}」` : `Added the quick action “${wf.name}”`,
    );
    if (ok) run(wf);
  }

  /** 让 AI 搭一个：AI 只知道文件的类型和个数（D-124）。做好后回到这里，新的排在最前面。 */
  function askAI() {
    setKnownIds(new Set(config.workflows.map((w) => w.id)));
    router.push({ pathname: '/change', params: { shared: String(share!.id) } });
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
      ref={scroll}
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
          <SectionLabel palette={palette}>
            {zh ? '用快捷操作处理' : 'Run a quick action'}
          </SectionLabel>
          {candidates.length === 0 ? (
            <Card palette={palette}>
              <Text testID="share-no-workflows" style={caption}>
                {zh
                  ? '还没有能处理这些文件的快捷操作。可以让 AI 搭一个，或者添加下面现成的。'
                  : 'No quick action takes these files yet. Ask AI to make one, or add a ready-made one below.'}
              </Text>
            </Card>
          ) : (
            mine.map(workflowCard)
          )}
          <Button
            palette={palette}
            testID="share-ask-ai"
            variant="outline"
            label={zh ? '让 AI 搭一个' : 'Ask AI to make one'}
            onPress={askAI}
          />
          {presets.length > 0 ? (
            <>
              <SectionLabel palette={palette}>
                {zh ? '现成的快捷操作' : 'Ready-made quick actions'}
              </SectionLabel>
              {presets.map(({ preset, wf }) => (
                <Card key={preset.id} palette={palette} testID={`share-preset-${preset.id}`}>
                  <Text style={[palette.font('title', 16), { color: palette.text }]}>
                    {preset.name[locale]}
                  </Text>
                  <Text style={caption}>{stepChain(wf, registry, locale)}</Text>
                  <View style={styles.actions}>
                    <Pill
                      palette={palette}
                      testID={`share-preset-add-${preset.id}`}
                      label={zh ? '添加并运行' : 'Add and run'}
                      onPress={() => void addAndRun(preset)}
                    />
                  </View>
                </Card>
              ))}
            </>
          ) : null}
          {/* 工具里的单个功能放在最后：图片工具就有十几个，放前面会把「让 AI 搭一个」和现成的挤到很下面。 */}
          {fromTools.length > 0 ? (
            <>
              <SectionLabel palette={palette}>
                {zh ? '工具里的功能' : 'From your tools'}
              </SectionLabel>
              {fromTools.map(workflowCard)}
            </>
          ) : null}
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
