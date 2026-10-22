import { packById, type Locale } from '@morph/core';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { t } from '../i18n';
import type { InstalledPack, PackStore } from '../packs/store';
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
}: {
  store: PackStore;
  palette: Palette;
  locale: Locale;
}) {
  const [list, setList] = useState<InstalledPack[] | null>(null);
  const reload = useCallback(() => void store.installed().then(setList), [store]);
  useEffect(reload, [reload]);

  function remove(pack: InstalledPack) {
    const manifest = packById(pack.id)!;
    const dependents = (list ?? []).filter((p) =>
      (packById(p.id)?.requires ?? []).includes(pack.id),
    );
    const name = manifest.name[locale];
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

  const caption = [palette.font('body', 13), { color: palette.muted }];
  const total = (list ?? []).reduce((sum, p) => sum + p.bytes, 0);
  return (
    <ScrollView
      testID="packs-screen"
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ padding: palette.pad, gap: palette.gap - 4, paddingBottom: 48 }}>
      <PageTitle palette={palette}>{t(locale, 'packsTitle')}</PageTitle>
      <Text style={caption}>{t(locale, 'packsHint')}</Text>
      {list === null ? null : list.length === 0 ? (
        <Card palette={palette}>
          <Text testID="packs-empty" style={caption}>
            {t(locale, 'packsEmpty')}
          </Text>
        </Card>
      ) : (
        <>
          <Text
            testID="packs-total"
            style={[palette.font('bodyBold', 14), { color: palette.text }]}>
            {t(locale, 'packsTotal', { size: formatBytes(total) })}
          </Text>
          {list.map((p) => {
            const manifest = packById(p.id)!;
            return (
              <Card key={p.id} palette={palette} testID={`pack-${p.id}`}>
                <Text style={[palette.font('title', 16), { color: palette.text }]}>
                  {manifest.name[locale]}
                </Text>
                <Text style={caption}>{manifest.description[locale]}</Text>
                <Text style={caption}>
                  {`${formatBytes(p.bytes)} · ${manifest.license} · ${p.version}`}
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
    </ScrollView>
  );
}
