import { packById, PREFILL_MODEL_PACK, type Locale } from '@morph/core';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { t } from '../i18n';
import type { Palette } from '../renderer/theme';
import { Card, Pill, SectionLabel } from '../renderer/ui';
import { formatBytes } from '../run/ResultView';
import { deviceFitsLocalModel } from '../runtime/local-model';
import { PackGate } from './PackGate';
import { usePacks } from './PackHost';

/**
 * 「设置 → 数据」里的本机模型（D-396）：只有用户在这里点了、在确认框里同意才下载，表单上不催，也不自动下载。
 * 没配置下载地址时不提示下载（D-274）；已经装好的照样能删。
 */
export function LocalModelCard({ palette, locale }: { palette: Palette; locale: Locale }) {
  const packs = usePacks();
  const [ready, setReady] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!packs) return;
    let alive = true;
    void packs.store.isInstalled(PREFILL_MODEL_PACK).then((on) => {
      if (alive) setReady(on);
    });
    return () => {
      alive = false;
    };
  }, [packs]);

  const fits = deviceFitsLocalModel();
  // 内存明显不够的手机不推荐下载，也不提这件事（创始人 2026-11-02）；装过的还要能删。
  if (!packs || (!ready && (!fits || !process.env.EXPO_PUBLIC_MORPH_PACKS_URL))) return null;

  const bytes = packById(PREFILL_MODEL_PACK)?.files.reduce((sum, f) => sum + f.size, 0) ?? 0;
  const remove = () =>
    Alert.alert(t(locale, 'localModelRemove'), t(locale, 'localModelRemoveConfirm'), [
      { text: t(locale, 'cancel'), style: 'cancel' },
      {
        text: t(locale, 'localModelRemove'),
        style: 'destructive',
        onPress: () => void packs.store.remove(PREFILL_MODEL_PACK).then(() => setReady(false)),
      },
    ]);

  return (
    <>
      <SectionLabel palette={palette}>{t(locale, 'localModelTitle')}</SectionLabel>
      <Card palette={palette} testID="local-model">
        {ready ? (
          <Text style={[palette.font('title', 15), { color: palette.text }]}>
            {t(locale, 'localModelReady', { size: formatBytes(bytes, locale) })}
          </Text>
        ) : null}
        <Text style={[palette.font('body', 13), { color: palette.muted }]}>
          {t(locale, fits ? 'localModelHint' : 'localModelTooSmall')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {ready ? (
            <Pill
              palette={palette}
              danger
              testID="local-model-remove"
              label={t(locale, 'localModelRemove')}
              onPress={remove}
            />
          ) : (
            <Pill
              palette={palette}
              testID="local-model-download"
              label={t(locale, 'localModelDownload')}
              onPress={() => setAsking(true)}
            />
          )}
        </View>
      </Card>
      {asking ? (
        <PackGate
          needs={[{ pack: PREFILL_MODEL_PACK, optional: false }]}
          store={packs.store}
          palette={palette}
          locale={locale}
          onDone={(left) => {
            setAsking(false);
            if (left !== null) setReady(true);
          }}
        />
      ) : null}
    </>
  );
}
