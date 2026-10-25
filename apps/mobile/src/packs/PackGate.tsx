import { localize, t, packById, packDownloadSize, type Locale } from '@morph/core';

import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Palette } from '../renderer/theme';
import { formatBytes } from '../run/ResultView';
import type { PackStore } from './store';

// 需要扩展包时的确认框（D-064）：显示名称、用途、大小，建议用 Wi-Fi。只有用户点「下载」才会下载；
// 取消则本次运行取消。AI 和工作流都不能自己触发下载。

export function PackGate({
  packId,
  store,
  palette,
  locale,
  onDone,
}: {
  packId: string;
  store: PackStore;
  palette: Palette;
  locale: Locale;
  onDone: (installed: boolean) => void;
}) {
  const zh = locale === 'zh';
  const pack = packById(packId)!;
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  // 大小要扣掉已安装的依赖；还没装的依赖（语言包要先有文字识别包）一起说明。
  useEffect(() => {
    void store.installed().then((list) => {
      const have = new Set(list.map((p) => p.id));
      setSize(packDownloadSize(packId, have));
      setMissing((pack.requires ?? []).filter((d) => !have.has(d)));
    });
  }, [store, packId, pack]);

  async function download() {
    setError(null);
    setProgress(0);
    try {
      await store.install(packId, (p) =>
        setProgress(p.totalBytes ? p.doneBytes / p.totalBytes : 0),
      );
      onDone(true);
    } catch (e) {
      setProgress(null);
      setError(
        t(locale, 'PackGate_The_download_did_not_finish_Check_the__9d7b7', {
          v0: String((e as Error).message),
        }),
      );
    }
  }

  const text = (role: 'title' | 'body', value: string, extra = {}) => (
    <Text
      style={[
        palette.font(role === 'title' ? 'title' : 'body', role === 'title' ? 18 : 15),
        { color: role === 'title' ? palette.text : palette.muted },
        extra,
      ]}>
      {value}
    </Text>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onDone(false)}>
      <View style={styles.backdrop}>
        <View
          testID="pack-gate"
          style={[
            styles.dialog,
            { backgroundColor: palette.surface, borderRadius: palette.radius },
          ]}>
          {/* 第一次用到时的提示（D-112）：不出现「扩展包」这个词，只说要下载多少、之后能离线用。 */}
          {text(
            'title',
            t(locale, 'PackGate_First_use_needs_a_download_3c1d7', {
              v0: size === null ? '…' : formatBytes(size, locale),
            }),
          )}
          {text('body', t(locale, 'PackGate_After_that_it_works_offline_Wi_Fi_is_r_77ca7'))}
          {text(
            'body',
            [pack, ...missing.map((d) => packById(d) ?? null)]
              .flatMap((p) => (p ? [localize(p.description, locale)] : []))
              .join(zh ? '' : ' '),
          )}
          {text('body', t(locale, 'PackGate_License_ff05c', { v0: pack.license }), {
            fontSize: 12,
          })}
          {progress !== null ? (
            <View style={styles.progressRow}>
              <ActivityIndicator />
              <View style={[styles.bar, { backgroundColor: palette.primaryTint }]}>
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.round(progress * 100)}%`, backgroundColor: palette.primary },
                  ]}
                />
              </View>
            </View>
          ) : null}
          {error ? (
            <Text style={[palette.font('bodyMedium', 14), { color: palette.danger }]}>{error}</Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable testID="pack-cancel" onPress={() => onDone(false)} hitSlop={8}>
              <Text style={[palette.font('bodyBold', 16), { color: palette.muted }]}>
                {t(locale, 'PackGate_Cancel_bd576')}
              </Text>
            </Pressable>
            {progress === null ? (
              <Pressable testID="pack-download" onPress={() => void download()} hitSlop={8}>
                <Text style={[palette.font('bodyBold', 16), { color: palette.primaryText }]}>
                  {t(locale, error ? 'retry' : 'speechDownload')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#2A242080', justifyContent: 'center', padding: 24 },
  dialog: { padding: 22, gap: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bar: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 6 },
});
