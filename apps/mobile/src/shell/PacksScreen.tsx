import { localize, packById, translateLanguageName, type Locale } from '@morph/core';

import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { t } from '../i18n';
import type { InstalledPack, PackStore } from '../packs/store';
import type { TranslatePlatform } from '../runtime/platform';
import type { Palette } from '../renderer/theme';
import { Card, PageTitle, Pill } from '../renderer/ui';
import { formatBytes } from '../run/ResultView';

/**
 * 「设置 → 扩展包」（D-064，TOOLS_DESIGN §6）：已下载的扩展包和占用空间，可以删除。
 * 删除文字识别包时各语言包一起删除。不进版本，删除后需要时会再次请用户确认下载。
 */
export function PacksScreen({
  store,
  palette,
  locale,
  translator,
  tools,
  onRemoveTool,
}: {
  store: PackStore;
  palette: Palette;
  locale: Locale;
  /** Android 的翻译语言模型也在这里列出、删除（D-175）；iOS 的由系统设置管理。 */
  translator?: TranslatePlatform | null;
  /** 从服务器下载的工具（D-177）。已经添加的要先在「工具」里移除才能删。 */
  tools?: readonly { id: string; name: string; version: string; bytes: number; added: boolean }[];
  onRemoveTool?: (id: string) => Promise<void>;
}) {
  const [list, setList] = useState<InstalledPack[] | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const reload = useCallback(() => {
    void store.installed().then(setList);
    void translator?.downloadedLanguages?.().then(setLanguages);
  }, [store, translator]);
  useEffect(reload, [reload]);

  function removeLanguage(code: string) {
    const name = translateLanguageName(code, locale);
    Alert.alert(t(locale, 'packDeleteTitle', { name }), t(locale, 'translateDeleteMessage'), [
      { text: t(locale, 'cancel'), style: 'cancel' },
      {
        text: t(locale, 'packDelete'),
        style: 'destructive',
        onPress: () => void translator?.removeLanguage?.(code).then(reload),
      },
    ]);
  }

  function remove(pack: InstalledPack) {
    const manifest = packById(pack.id)!;
    const dependents = (list ?? []).filter((p) =>
      (packById(p.id)?.requires ?? []).includes(pack.id),
    );
    const name = localize(manifest.name, locale);
    Alert.alert(
      t(locale, 'packDeleteTitle', { name }),
      dependents.length > 0
        ? t(locale, 'packDeleteWithLanguages', { count: dependents.length })
        : t(locale, 'packDeleteMessage'),
      [
        { text: t(locale, 'cancel'), style: 'cancel' },
        {
          text: t(locale, 'packDelete'),
          style: 'destructive',
          onPress: () => void store.remove(pack.id).then(reload),
        },
      ],
    );
  }

  function removeTool(tool: NonNullable<typeof tools>[number]) {
    if (tool.added) {
      Alert.alert(t(locale, 'packDeleteTitle', { name: tool.name }), t(locale, 'toolDeleteAdded'));
      return;
    }
    Alert.alert(t(locale, 'packDeleteTitle', { name: tool.name }), t(locale, 'toolDeleteMessage'), [
      { text: t(locale, 'cancel'), style: 'cancel' },
      {
        text: t(locale, 'packDelete'),
        style: 'destructive',
        onPress: () => void onRemoveTool?.(tool.id),
      },
    ]);
  }

  const caption = [palette.font('body', 13), { color: palette.muted }];
  const total = (list ?? []).reduce((sum, p) => sum + p.bytes, 0);
  return (
    <ScrollView
      testID="packs-screen"
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      <PageTitle palette={palette}>{t(locale, 'packsTitle')}</PageTitle>
      <Text style={caption}>{t(locale, 'packsHint')}</Text>
      {list === null ? null : list.length === 0 && languages.length === 0 && !tools?.length ? (
        <Card palette={palette}>
          <Text testID="packs-empty" style={caption}>
            {t(locale, 'packsEmpty')}
          </Text>
        </Card>
      ) : list.length === 0 ? null : (
        <>
          <Text
            testID="packs-total"
            style={[palette.font('bodyBold', 14), { color: palette.text }]}>
            {t(locale, 'packsTotal', { size: formatBytes(total, locale) })}
          </Text>
          {list.map((p) => {
            const manifest = packById(p.id)!;
            return (
              <Card key={p.id} palette={palette} testID={`pack-${p.id}`}>
                <Text style={[palette.font('title', 16), { color: palette.text }]}>
                  {localize(manifest.name, locale)}
                </Text>
                <Text style={caption}>{localize(manifest.description, locale)}</Text>
                <Text style={caption}>
                  {`${formatBytes(p.bytes, locale)} · ${manifest.license} · ${p.version}`}
                </Text>
                <View style={{ flexDirection: 'row' }}>
                  <Pill
                    palette={palette}
                    danger
                    testID={`pack-delete-${p.id}`}
                    label={t(locale, 'packDelete')}
                    onPress={() => remove(p)}
                  />
                </View>
              </Card>
            );
          })}
        </>
      )}
      {(tools ?? []).map((tool) => (
        <Card key={tool.id} palette={palette} testID={`downloaded-tool-${tool.id}`}>
          <Text style={[palette.font('title', 16), { color: palette.text }]}>{tool.name}</Text>
          <Text style={caption}>{t(locale, 'toolDownloadedHint')}</Text>
          <Text style={caption}>{`${formatBytes(tool.bytes, locale)} · ${tool.version}`}</Text>
          <View style={{ flexDirection: 'row' }}>
            <Pill
              palette={palette}
              danger
              testID={`downloaded-tool-delete-${tool.id}`}
              label={t(locale, 'packDelete')}
              onPress={() => removeTool(tool)}
            />
          </View>
        </Card>
      ))}
      {languages.map((code) => (
        <Card key={code} palette={palette} testID={`translate-language-${code}`}>
          <Text style={[palette.font('title', 16), { color: palette.text }]}>
            {t(locale, 'translateLanguageTitle', { name: translateLanguageName(code, locale) })}
          </Text>
          <Text style={caption}>{t(locale, 'translateLanguageHint')}</Text>
          <View style={{ flexDirection: 'row' }}>
            <Pill
              palette={palette}
              danger
              testID={`translate-language-delete-${code}`}
              label={t(locale, 'packDelete')}
              onPress={() => removeLanguage(code)}
            />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
