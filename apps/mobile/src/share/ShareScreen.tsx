import {
  localize,
  mediaKindOf,
  sharedSizeProblem,
  type IconName,
  type MediaKind,
  type ShareFit,
  type Workflow,
} from '@morph/core';

import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { runErrorText, t } from '../i18n';
import { formatSize } from '../renderer/FileList';
import { Icon } from '../renderer/Icon';
import { usePalette } from '../renderer/theme';
import { Button, Card, Pill, SectionLabel } from '../renderer/ui';
import { placeOnDesk } from '../desk/store';
import { mimeOf } from '../runtime/actions/helpers';
import { formatTime } from '../run/local/TrimScreen';
import { stepChain } from '../shell/WorkflowsScreen';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import { FileViewer, InlineVideo } from './FileViewer';
import { releaseShare, useIncoming } from './incoming';
import { shareRecommendations } from './recommendations';
import type { SucceededRuns } from '../storage/types';

/**
 * 收件页面（TOOLS_DESIGN §11，D-117）：「收到 N 个文件」，列出能接这些文件的工作流，点一个才运行
 * （不会自动运行）。文件名和大小只在本机显示，不发给 AI。由内核提供，AI 不能修改。
 */
// 页面上那一张照片、一个视频的高度（D-238）：iPhone 17e 上连同 5 个快捷操作和「我要自己说」不用上滑。
const PREVIEW_HEIGHT = 132;

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
  // 读到使用次数之前不排推荐：否则先按「都没用过」排一遍，读到后卡片跳位置，快点时会点错。
  const [usage, setUsage] = useState<SucceededRuns | null>(null);
  const [showAll, setShowAll] = useState(false);
  // 全屏看的照片或视频是第几个（D-238）；null 时没打开。
  const [viewing, setViewing] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // 正在复制到桌上（大视频要一会儿）。
  const [placing, setPlacing] = useState(false);
  useEffect(() => {
    let alive = true;
    void repo
      .countSucceededRuns()
      .then((counts) => {
        if (alive) setUsage(counts);
      })
      .catch(() => {
        /* 统计暂时不可用时仍可手动选择快捷操作。 */
        if (alive) setUsage(new Map());
      });
    return () => {
      alive = false;
    };
  }, [repo, share?.id]);
  // 交给运行页面或 AI 时为 true：离开页面时不删文件（运行页面关闭时再删）。
  const handed = useRef(false);
  // 从 AI 取消返回后，收件页重新负责关闭时的清理。
  useFocusEffect(
    useCallback(() => {
      handed.current = false;
    }, []),
  );
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

  useEffect(() => {
    const id = share?.id;
    handed.current = false;
    return () => {
      if (!handed.current && id !== undefined) void releaseShare(files, id);
    };
  }, [files, share?.id]);

  const caption = [palette.font('body', 13), { color: palette.muted }];
  const title = share
    ? share.source === 'result'
      ? t(locale, 'resultContinue')
      : t(locale, 'sharedFilesReceived', { n: share.files.length })
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
  // 预览（D-238）：一张照片、一个视频直接显示在页面上；多个照片和视频点文件列表里的一个，全屏左右翻看；
  // PDF 等别的文件用系统预览打开（一个时点摘要就打开）。只在本机显示。
  const viewerKind = (i: number) => {
    const kind = mediaKindOf(infos[i]!.mimeType, share.files[i]!.name);
    return kind === 'image' || kind === 'video' ? kind : undefined;
  };
  const viewable = share.files.flatMap((f, i) => {
    const kind = viewerKind(i);
    return kind ? [{ uri: f.uri, kind }] : [];
  });
  const single =
    share.files.length === 1 ? { uri: share.files[0]!.uri, kind: viewerKind(0) } : undefined;
  async function open(i: number) {
    setPreviewError(null);
    if (viewerKind(i)) {
      setViewing(viewable.findIndex((v) => v.uri === share!.files[i]!.uri));
      return;
    }
    try {
      await files.previewFile({
        uri: share!.files[i]!.uri,
        mimeType: infos[i]!.mimeType,
        name: share!.files[i]!.name,
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setPreviewError(code ? runErrorText(locale, code) : String(e));
    }
  }
  const counts = usage ?? new Map();
  const { all, recommended, anyUsed } = shareRecommendations(
    config.workflows,
    infos,
    counts,
    locale,
    newest,
  );
  // 「查看全部 N 个」就在这一页展开这 N 个（跳到分类页会漏掉也收这些文件、但属于别的分类的快捷操作）。
  const candidates = usage === null ? [] : showAll ? all : recommended;

  function isNew(wf: Workflow) {
    return knownIds !== null && !wf.toolId && !knownIds.has(wf.id);
  }

  // 一个快捷操作一行（D-237）：名字（法语长名字可以折成两行）和一行说明，右边「运行」；
  // 5 个加「我要自己说」不用上滑就能看全。
  const workflowRow = ({ wf, fit }: (typeof candidates)[number], i: number) => (
    <View
      key={wf.id}
      testID={`share-workflow-${wf.id}`}
      style={[
        styles.row,
        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
      ]}>
      <View style={styles.flex}>
        <Text numberOfLines={2} style={[palette.font('title', 15), { color: palette.text }]}>
          {wf.name}
          {isNew(wf) ? t(locale, 'ShareScreen_just_made_ed6c1') : ''}
        </Text>
        <Text
          numberOfLines={1}
          style={fit.ok ? caption : [palette.font('bodyMedium', 13), { color: palette.danger }]}>
          {fit.ok
            ? [
                counts.has(wf.id) ? t(locale, 'shareUsed', { n: counts.get(wf.id)!.count }) : null,
                wf.toolId ? localize(registry.tools.get(wf.toolId)?.name, locale) : null,
                stepChain(wf, registry, locale),
              ]
                .filter(Boolean)
                .join(' · ')
            : reason(fit)}
        </Text>
      </View>
      {fit.ok ? (
        <Pill
          palette={palette}
          testID={`share-run-${wf.id}`}
          label={t(locale, 'ShareScreen_Run_5cab2')}
          onPress={() => run(wf)}
        />
      ) : null}
    </View>
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

  /**
   * 放到桌上（D-340，创始人 2026-10-30 在会话里确认：做第一项，快捷操作推荐留在下面）：复制一份工作副本，
   * 进入文件房间。原件和收件这一批照旧（离开收件页面时释放），桌上的是自己的副本。
   */
  async function placeAndOpen() {
    if (placing) return;
    setPlacing(true);
    setPreviewError(null);
    try {
      const desk = await placeOnDesk(files, share!.files, Date.now());
      router.replace({ pathname: '/desk/[deskId]', params: { deskId: desk.id } });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setPreviewError(
        code
          ? runErrorText(locale, code, (e as { detail?: Record<string, string> }).detail)
          : String(e),
      );
      setPlacing(false);
    }
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
        {single?.kind === 'image' ? (
          <Pressable testID="share-preview-image" onPress={() => void open(0)}>
            <Image
              testID="share-preview-image-file"
              source={{ uri: single.uri }}
              style={[styles.preview, { borderRadius: 8 }]}
              contentFit="contain"
            />
          </Pressable>
        ) : single?.kind === 'video' ? (
          <InlineVideo uri={single.uri} height={PREVIEW_HEIGHT} />
        ) : null}
        <Button
          palette={palette}
          variant="text"
          testID="share-files-toggle"
          label={`${t(locale, infos.every((f) => f.mimeType.startsWith('image/')) ? 'sharePhotoSummary' : 'shareSummary', { n: share.files.length })}${
            infos.every((f) => f.size !== null)
              ? ` · ${formatSize(
                  infos.reduce((n, f) => n + (f.size ?? 0), 0),
                  locale,
                )}`
              : ''
          } · ${t(locale, single && !single.kind ? 'sharePreview' : expanded ? 'shareCollapse' : 'shareExpand')}`}
          onPress={() =>
            single && !single.kind ? void open(0) : setExpandedId(expanded ? null : share.id)
          }
        />
        {expanded
          ? share.files.map((f, i) => (
              <Pressable
                key={`${i}-${f.uri}`}
                testID={`share-file-${i}`}
                onPress={() => void open(i)}
                style={({ pressed }) => [
                  styles.file,
                  i > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderColor: palette.border,
                  },
                  pressed && { opacity: 0.6 },
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
                      durations[f.uri] ? formatTime(durations[f.uri]!, false, locale) : null,
                      f.size !== null ? formatSize(f.size, locale) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}
                <Text style={[palette.font('title', 18), { color: palette.caption }]}>›</Text>
              </Pressable>
            ))
          : null}
        {previewError ? (
          <Text
            testID="share-preview-error"
            style={[palette.font('bodyMedium', 14), { color: palette.danger }]}>
            {previewError}
          </Text>
        ) : null}
      </Card>
      {viewing !== null ? (
        <FileViewer
          items={viewable}
          start={viewing}
          onClose={() => setViewing(null)}
          palette={palette}
          locale={locale}
        />
      ) : null}

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
          {/* 放到桌上做第一项（D-340）。 */}
          <Card palette={palette} style={styles.list}>
            <View testID="share-desk" style={styles.row}>
              <View style={styles.flex}>
                <Text
                  numberOfLines={2}
                  style={[palette.font('title', 15), { color: palette.text }]}>
                  {t(locale, 'deskPlace')}
                </Text>
                <Text numberOfLines={2} style={caption}>
                  {t(locale, 'deskPlaceAbout')}
                </Text>
              </View>
              <Pill
                palette={palette}
                testID="share-desk-open"
                label={placing ? '…' : t(locale, 'open')}
                onPress={() => void placeAndOpen()}
              />
            </View>
          </Card>
          {candidates.length > 0 ? (
            <SectionLabel palette={palette}>
              {t(locale, anyUsed ? 'shareRecent' : 'shareSuggested')}
            </SectionLabel>
          ) : null}
          {candidates.length > 0 ? (
            <Card palette={palette} style={styles.list}>
              {candidates.map(workflowRow)}
            </Card>
          ) : null}
          {usage !== null && !showAll && all.length > recommended.length ? (
            <Button
              palette={palette}
              variant="text"
              testID="share-see-all"
              label={t(locale, 'shareSeeAll', { n: all.length })}
              onPress={() => setShowAll(true)}
            />
          ) : null}
          {/* 「我要自己说」放在快捷操作下面（D-237，原来在上面，D-233）。 */}
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
  preview: { height: PREVIEW_HEIGHT, width: '100%' },
  list: { paddingVertical: 2, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 },
});
