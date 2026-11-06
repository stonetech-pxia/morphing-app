import { fileKindOf, type FileKind } from '@morph/core';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { t, type StringKey } from '@/i18n';
import { FileRow, previewAsset } from '@/renderer/FileList';
import { Icon } from '@/renderer/Icon';
import { usePalette } from '@/renderer/theme';
import type { AssetRecord } from '@/storage/types';
import { useWorkspace, useWorkspaceContext } from '@/workspace/context';

type Sort = 'newest' | 'name' | 'size';
const SORTS: { id: Sort; label: StringKey }[] = [
  { id: 'newest', label: 'filesSortNewest' },
  { id: 'name', label: 'filesSortName' },
  { id: 'size', label: 'filesSortSize' },
];
const KIND_LABELS: Record<FileKind, StringKey> = {
  pdf: 'filesKindPdf',
  image: 'filesKindImage',
  doc: 'filesKindDoc',
  sheet: 'filesKindSheet',
  video: 'filesKindVideo',
  audio: 'filesKindAudio',
  other: 'filesKindOther',
};
/** 文件名里没有、文字里有搜索词时，显示文字里那一段（前后各留一点）。 */
function snippetOf(text: string | undefined, name: string, query: string, locale: string) {
  const word = query.trim().split(/\s+/)[0]?.toLocaleLowerCase(locale);
  if (!text || !word || name.toLocaleLowerCase(locale).includes(word)) return undefined;
  const at = text.toLocaleLowerCase(locale).indexOf(word);
  if (at < 0) return undefined;
  const start = Math.max(0, at - 16);
  const piece = text
    .slice(start, at + word.length + 40)
    .replace(/\s+/g, ' ')
    .trim();
  return `${start > 0 ? '…' : ''}${piece}…`;
}

const KIND_ORDER: FileKind[] = ['pdf', 'image', 'doc', 'sheet', 'video', 'audio', 'other'];

/**
 * 全部文件（D-453）：首页「最近文件」的「全部」打开这里。和收据、名片模版一样，上面是搜索框、排序和类型筛选，
 * 下面是列表，没有固定按钮。点一行用系统预览打开。只读：搜索、排序、筛选都不写数据（底线 15）。
 */
export default function FilesScreen() {
  const { repo, files, locale } = useWorkspaceContext();
  const theme = useWorkspace((s) => s.config!.theme);
  const version = useWorkspace((s) => s.assetsVersion);
  const palette = usePalette(theme);
  // 两条线（D-454）：搜索框、列表的边和排序、类型两行贴着页面边距；搜索框里的字和列表里的缩略图缩进 inset。
  const inset = palette.inset;
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [kind, setKind] = useState<FileKind | null>(null);
  // 文件里的文字（D-455）：有搜索词时才读，只在这一页的内存里。
  const [texts, setTexts] = useState<Record<string, string>>({});
  const searching = query.trim().length > 0;

  useEffect(() => {
    if (!searching || !files.assetText) return;
    const missing = assets.filter((a) => !(a.id in texts));
    if (missing.length === 0) return;
    let alive = true;
    void Promise.all(
      missing.map(
        async (a) => [a.id, (await files.assetText!(a.path).catch(() => null)) ?? ''] as const,
      ),
    ).then((read) => {
      if (alive) setTexts((now) => ({ ...now, ...Object.fromEntries(read) }));
    });
    return () => {
      alive = false;
    };
  }, [searching, assets, texts, files]);

  useEffect(() => {
    let alive = true;
    void repo.listAssets().then((all) => {
      if (alive) setAssets(all);
    });
    return () => {
      alive = false;
    };
  }, [repo, version]);

  const kinds = useMemo(() => {
    const present = new Set(assets.map((a) => fileKindOf(a.mimeType)));
    return KIND_ORDER.filter((k) => present.has(k));
  }, [assets]);

  const shown = useMemo(() => {
    const words = query.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
    // 文件名或文件里的文字（D-455）都算。
    const list = assets.filter((a) => {
      if (kind !== null && fileKindOf(a.mimeType) !== kind) return false;
      const name = a.name.toLocaleLowerCase(locale);
      const text = (texts[a.id] ?? '').toLocaleLowerCase(locale);
      return words.every((w) => name.includes(w) || text.includes(w));
    });
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    return list.sort((a, b) =>
      sort === 'name'
        ? collator.compare(a.name, b.name)
        : sort === 'size'
          ? b.size - a.size
          : b.createdAt - a.createdAt,
    );
  }, [assets, query, kind, sort, locale, texts]);

  const chip = (id: string, label: string, on: boolean, onPress: () => void) => (
    <Pressable
      key={id}
      testID={id}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: on ? palette.primary : palette.border,
          backgroundColor: on ? palette.primaryTint : 'transparent',
        },
      ]}>
      <Text
        style={[
          palette.font('bodyMedium', 13),
          { color: on ? palette.primaryText : palette.muted },
        ]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.root, palette.backdrop]} testID="files-screen">
      <FlatList
        data={shown}
        keyExtractor={(a) => a.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { padding: palette.pad }]}
        ListHeaderComponent={
          <View style={styles.head}>
            <TextInput
              testID="files-search"
              value={query}
              onChangeText={setQuery}
              placeholder={t(locale, 'browseSearch')}
              placeholderTextColor={palette.caption}
              autoCorrect={false}
              returnKeyType="search"
              style={[
                styles.input,
                palette.font('body', 15),
                {
                  paddingHorizontal: inset,
                  color: palette.text,
                  borderColor: palette.border,
                  backgroundColor: palette.surface,
                  borderRadius: palette.controlRadius,
                },
              ]}
            />
            <View style={styles.row}>
              <Text style={[palette.font('bodyMedium', 13), { color: palette.caption }]}>
                {t(locale, 'browseSort')}
              </Text>
              {SORTS.map((s) =>
                chip(`files-sort-${s.id}`, t(locale, s.label), sort === s.id, () => setSort(s.id)),
              )}
            </View>
            {kinds.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.row}>
                {chip('files-kind-all', t(locale, 'browseFilterAll'), kind === null, () =>
                  setKind(null),
                )}
                {kinds.map((k) =>
                  chip(`files-kind-${k}`, t(locale, KIND_LABELS[k]), kind === k, () => setKind(k)),
                )}
              </ScrollView>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              { backgroundColor: palette.surface, paddingHorizontal: inset },
              index === 0 && {
                borderTopLeftRadius: palette.radius,
                borderTopRightRadius: palette.radius,
                paddingTop: 2,
              },
              index === shown.length - 1 && {
                borderBottomLeftRadius: palette.radius,
                borderBottomRightRadius: palette.radius,
                paddingBottom: 2,
              },
            ]}>
            <FileRow
              asset={item}
              first={index === 0}
              palette={palette}
              locale={locale}
              snippet={snippetOf(texts[item.id], item.name, query, locale)}
              onPress={() => void previewAsset(files, item, locale)}
            />
          </View>
        )}
        ListEmptyComponent={
          <View testID="files-none" style={styles.empty}>
            <Icon name="search" size={22} color={palette.caption} />
            <Text style={[palette.font('body', 14), { color: palette.caption }]}>
              {t(locale, assets.length === 0 ? 'noFiles' : 'filesNoMatch')}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 40 },
  head: { gap: 10, marginBottom: 12 },
  input: { borderWidth: 1, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40 },
});
