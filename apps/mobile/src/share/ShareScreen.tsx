import {
  localize,
  WORKFLOW_PRESETS,
  mediaKindOf,
  newWorkflowId,
  presetWorkflow,
  sharedSizeProblem,
  type IconName,
  type MediaKind,
  type ShareFit,
  type Workflow,
} from '@morph/core';

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import { runErrorText, t } from '../i18n';
import { formatSize } from '../renderer/FileList';
import { Icon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { Button, Card, Pill, SectionLabel } from '../renderer/ui';
import { mimeOf } from '../runtime/actions/helpers';
import { formatTime } from '../run/local/TrimScreen';
import { useWorkflowChange } from '../run/workflow-change';
import { stepChain } from '../shell/WorkflowsScreen';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { releaseShare, useIncoming } from './incoming';
import { shareRecommendations } from './recommendations';
import type { SucceededRuns } from '../storage/types';

/**
 * 收件页面（TOOLS_DESIGN §11，D-117）：「收到 N 个文件」，列出能接这些文件的工作流，点一个才运行
 * （不会自动运行）。文件名和大小只在本机显示，不发给 AI。由内核提供，AI 不能修改。
 */
const ICONS: Partial<Record<MediaKind, IconName>> = {
  image: 'photo',
  video: 'video',
  audio: 'audio',
};

export function ShareScreen() {
  const { repo, files, registry, locale } = useWorkspaceContext();
  const config = useWorkspace((s) => s.config)!;
  const palette = usePalette(config.theme);
  const share = useIncoming((s) => s.share);
  const router = useRouter();

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const expanded = expandedId === share?.id;
  const [usage, setUsage] = useState<SucceededRuns>(new Map());
  useEffect(() => {
    let alive = true;
    void repo
      .countSucceededRuns()
      .then((counts) => {
        if (alive) setUsage(counts);
      })
      .catch(() => {
        /* 统计暂时不可用时仍可手动选择快捷操作。 */
      });
    return () => {
      alive = false;
    };
  }, [repo, share?.id]);
  // 交给运行页面或 AI 时为 true：离开页面时不删文件（运行页面关闭时再删）。
  const handed = useRef(false);
  const shareId = useRef(share?.id);
  const change = useWorkflowChange();
  // 打开 AI 之前已有的快捷操作：回来后新做的那个标「刚做好」、排在最前面（D-129）。
  // AI 的修改在草稿里应用（D-190），应用后重新打开这个页面，带着新做的那个（made）。
  const { made } = useLocalSearchParams<{ made?: string }>();
  const [knownIds, setKnownIds] = useState<Set<string> | null>(() =>
    made ? new Set(config.workflows.filter((w) => w.id !== made).map((w) => w.id)) : null,
  );
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
  // 视频和音频的时长（只在本机显示）；没有原生模块时不显示。
  const [durations, setDurations] = useState<Record<string, number>>({});
  useEffect(() => {
    const media = files.media;
    if (!share || !media) return;
    let alive = true;
    void (async () => {
      for (const f of share.files) {
        const kind = mediaKindOf(mimeOf(f.name, f.mimeType), f.name);
        if (kind !== 'video' && kind !== 'audio') continue;
        try {
          const info = await media.probe(f.uri);
          if (alive) setDurations((d) => ({ ...d, [f.uri]: info.durationMs }));
        } catch {
          // 打不开的文件运行时会报错，这里只是不显示时长。
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [files, share]);

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
    ? t(locale, 'sharedFilesReceived', { n: share.files.length })
    : t(locale, 'ShareScreen_Shared_with_Morph_bb8fe');

  if (!share || share.files.length === 0) {
    return (
      <View style={[styles.empty, { padding: palette.pad }]} testID="share-screen">
        <Stack.Screen options={{ title }} />
        <Text testID="share-none" style={[palette.font('body', 15), { color: palette.muted }]}>
          {t(locale, 'ShareScreen_Morph_only_takes_files_photos_PDFs_and_91f45')}
        </Text>
        <Button
          palette={palette}
          label={t(locale, 'ShareScreen_Close_59a26')}
          onPress={() => router.back()}
        />
      </View>
    );
  }

  const infos = share.files.map((f) => ({
    name: f.name,
    mimeType: mimeOf(f.name, f.mimeType),
    size: f.size,
  }));
  const sizeProblem = sharedSizeProblem(infos);
  const { all, recommended } = shareRecommendations(config.workflows, infos, usage, locale, newest);
  const candidates = recommended;

  function isNew(wf: Workflow) {
    return knownIds !== null && !wf.toolId && !knownIds.has(wf.id);
  }

  const workflowCard = ({ wf, fit, preset }: (typeof candidates)[number]) => (
    <Card
      key={wf.id}
      palette={palette}
      testID={preset ? `share-preset-${preset.id}` : `share-workflow-${wf.id}`}>
      <Text style={[palette.font('title', 16), { color: palette.text }]}>
        {wf.name}
        {isNew(wf) ? t(locale, 'ShareScreen_just_made_ed6c1') : ''}
      </Text>
      {usage.has(wf.id) && !preset ? (
        <Text style={caption}>{t(locale, 'shareUsed', { n: usage.get(wf.id)!.count })}</Text>
      ) : null}
      {wf.toolId ? (
        <Text style={caption}>{localize(registry.tools.get(wf.toolId)?.name, locale)}</Text>
      ) : null}
      <Text style={caption}>{stepChain(wf, registry, locale)}</Text>
      {fit.ok ? (
        <View style={styles.actions}>
          <Pill
            palette={palette}
            testID={preset ? `share-preset-add-${preset.id}` : `share-run-${wf.id}`}
            label={
              preset
                ? t(locale, 'ShareScreen_Add_and_run_c4281')
                : t(locale, 'ShareScreen_Run_5cab2')
            }
            onPress={() => (preset ? void addAndRun(preset) : run(wf))}
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
        ? t(locale, 'ShareScreen_Needs_at_least_files_0ed9b', { v0: fit.min })
        : fit.reason === 'tooMany'
          ? t(locale, 'ShareScreen_Takes_at_most_files_0fe59', { v0: fit.max })
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
      t(locale, 'ShareScreen_Added_the_quick_action_ad5f0', { v0: wf.name }),
    );
    if (ok) run(wf);
  }

  /** 让 AI 搭一个：AI 只知道文件的类型和个数（D-124）。做好后回到这里，新的排在最前面。 */
  function askAI() {
    setKnownIds(new Set(config.workflows.map((w) => w.id)));
    // AI 的修改先进草稿、这个页面会关掉（D-190）：分享的文件留着，应用后回到这里还能用。
    handed.current = true;
    router.push({ pathname: '/change', params: { shared: String(share!.id) } });
  }

  return (
    <ScrollView
      ref={scroll}
      testID="share-screen"
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      <Stack.Screen options={{ title }} />
      <Card palette={palette}>
        <Button
          palette={palette}
          variant="text"
          testID="share-files-toggle"
          label={`${t(locale, infos.every((f) => f.mimeType.startsWith('image/')) ? 'sharePhotoSummary' : 'shareSummary', { n: share.files.length })}${infos.every((f) => f.size !== null) ? ` · ${formatSize(infos.reduce((n, f) => n + (f.size ?? 0), 0))}` : ''} · ${t(locale, expanded ? 'shareCollapse' : 'shareExpand')}`}
          onPress={() => setExpandedId(expanded ? null : share.id)}
        />
        {expanded
          ? share.files.map((f, i) => (
              <View
                key={`${i}-${f.uri}`}
                style={[
                  styles.file,
                  i > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderColor: palette.border,
                  },
                ]}>
                <Icon
                  name={ICONS[mediaKindOf(infos[i]!.mimeType, f.name)] ?? 'document'}
                  size={18}
                  color={palette.secondary}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.flex, palette.font('bodyMedium', 15), { color: palette.text }]}>
                  {f.name}
                </Text>
                {f.size !== null || durations[f.uri] ? (
                  <Text style={[palette.font('body', 13), { color: palette.caption }]}>
                    {[
                      durations[f.uri] ? formatTime(durations[f.uri]!) : null,
                      f.size !== null ? formatSize(f.size) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}
              </View>
            ))
          : null}
      </Card>

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
          {candidates.length > 0 ? (
            <SectionLabel palette={palette}>{t(locale, 'shareRecent')}</SectionLabel>
          ) : null}
          {candidates.map(workflowCard)}
          {all.length > recommended.length ? (
            <Button
              palette={palette}
              variant="text"
              testID="share-see-all"
              label={t(locale, 'shareSeeAll', { n: all.length })}
              onPress={() => {
                handed.current = true;
                const kinds = new Set(infos.map((f) => mediaKindOf(f.mimeType, f.name)));
                const first = [...kinds][0];
                const kind =
                  first === 'image' || first === 'video' || first === 'audio' ? first : 'document';
                router.replace(
                  kinds.size === 1
                    ? {
                        pathname: '/quick-actions/[kind]',
                        params: { kind, shared: String(share.id) },
                      }
                    : { pathname: '/quick-actions', params: { shared: String(share.id) } },
                );
              }}
            />
          ) : null}
          <Button
            palette={palette}
            testID="share-ask-ai"
            variant="outline"
            label={t(locale, 'shareDescribe')}
            onPress={askAI}
          />
        </>
      )}
      <Text style={caption}>
        {t(locale, 'ShareScreen_Files_are_handled_on_this_device_only__c8099')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, gap: 16, justifyContent: 'center' },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
});
