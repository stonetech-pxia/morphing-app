import { localize, t, packById, type Locale, type PackNeed } from '@morph/core';

import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Palette } from '../renderer/theme';
import { formatBytes } from '../run/ResultView';
import type { PackStore } from './store';

// 需要扩展包时的确认框（D-064）：显示名称、用途、大小，建议用 Wi-Fi。只有用户点「下载」才会下载；
// 必需的不下载则本次运行取消；可选的（D-274，例如扫描的展平模型）可以不勾，不下载也照样做。
// 一次运行要的都列在一个框里、一次下载（D-289）。AI 和工作流都不能自己触发下载。

/** 一个扩展包自己的文件大小（不含依赖）。 */
const ownSize = (id: string) => packById(id)?.files.reduce((sum, f) => sum + f.size, 0) ?? 0;

export function PackGate({
  needs,
  store,
  palette,
  locale,
  onDone,
}: {
  /** 要下载的扩展包（调用方已去掉装好的）；optional：不下载这一步也照样做。 */
  needs: readonly PackNeed[];
  store: PackStore;
  palette: Palette;
  locale: Locale;
  /** 下载完：没下载的可选扩展包；null 表示必需的没下载（取消运行）。 */
  onDone: (left: string[] | null) => void;
}) {
  const zh = locale === 'zh';
  const key = needs.map((n) => n.pack).join(',');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [have, setHave] = useState<Set<string> | null>(null);
  const [left, setLeft] = useState<string[]>([]);
  // 同一次运行接着问下一个扩展包时提示框不会重新挂载，上一个的进度、错误和勾选要清掉。
  const [shownFor, setShownFor] = useState(key);
  if (shownFor !== key) {
    setShownFor(key);
    setProgress(null);
    setError(null);
    setLeft([]);
  }

  // 大小要扣掉已安装的依赖；还没装的依赖（语言包要先有文字识别包）一起算、一起说明。
  useEffect(() => {
    void store.installed().then((list) => setHave(new Set(list.map((p) => p.id))));
  }, [store, key]);

  const chosen = needs.filter((n) => !left.includes(n.pack));
  const missingDeps = (id: string) =>
    (packById(id)?.requires ?? []).filter((d) => have !== null && !have.has(d));
  // 列出来的一行只算它自己和没列出来的依赖，不重复算。
  const unlistedDeps = (id: string) =>
    missingDeps(id).filter((d) => !needs.some((n) => n.pack === d));
  const toFetch = new Set(chosen.flatMap((n) => [...missingDeps(n.pack), n.pack]));
  const total = have === null ? null : [...toFetch].reduce((sum, id) => sum + ownSize(id), 0);
  const anyRequired = needs.some((n) => !n.optional);

  async function download() {
    setError(null);
    setProgress(0);
    const done = new Map<string, number>();
    const all = [...toFetch].reduce((sum, id) => sum + ownSize(id), 0);
    try {
      for (const { pack } of chosen) {
        await store.install(pack, (p) => {
          done.set(p.packId, p.doneBytes);
          setProgress(all ? [...done.values()].reduce((a, b) => a + b, 0) / all : 0);
        });
      }
      onDone([...left]);
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

  const licenses = [...new Set(needs.map((n) => packById(n.pack)?.license ?? ''))].filter(Boolean);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onDone(null)}>
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
              v0: total === null ? '…' : formatBytes(total, locale),
            }),
          )}
          {text('body', t(locale, 'PackGate_After_that_it_works_offline_Wi_Fi_is_r_77ca7'))}
          {needs.map(({ pack: id, optional }) => {
            const pack = packById(id);
            if (!pack) return null;
            const on = !left.includes(id);
            const size = [...unlistedDeps(id), id].reduce((sum, d) => sum + ownSize(d), 0);
            const about = [pack, ...unlistedDeps(id).map((d) => packById(d) ?? null)]
              .flatMap((p) => (p ? [localize(p.description, locale)] : []))
              .join(zh ? '' : ' ');
            const body = (
              <View style={styles.itemText}>
                <Text style={[palette.font('bodyBold', 15), { color: palette.text }]}>
                  {localize(pack.name, locale)}
                  {have === null ? '' : ` · ${formatBytes(size, locale)}`}
                </Text>
                {text('body', about, { fontSize: 13 })}
                {optional ? text('body', t(locale, 'packOptionalHint'), { fontSize: 13 }) : null}
              </View>
            );
            return optional ? (
              <Pressable
                key={id}
                testID={`pack-item-${id}`}
                disabled={progress !== null}
                onPress={() => setLeft((l) => (on ? [...l, id] : l.filter((x) => x !== id)))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={styles.item}>
                <View
                  testID={`pack-include-${id}`}
                  style={[
                    styles.box,
                    {
                      borderColor: on ? palette.primary : palette.border,
                      backgroundColor: on ? palette.primary : 'transparent',
                    },
                  ]}>
                  {on ? <Text style={[styles.tick, { color: palette.surface }]}>✓</Text> : null}
                </View>
                {body}
              </Pressable>
            ) : (
              <View key={id} testID={`pack-item-${id}`} style={styles.item}>
                {needs.some((n) => n.optional) ? <View style={styles.box} /> : null}
                {body}
              </View>
            );
          })}
          {text('body', t(locale, 'PackGate_License_ff05c', { v0: licenses.join('; ') }), {
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
            <Pressable
              testID="pack-cancel"
              onPress={() => onDone(anyRequired ? null : needs.map((n) => n.pack))}
              hitSlop={8}>
              <Text style={[palette.font('bodyBold', 16), { color: palette.muted }]}>
                {t(locale, anyRequired ? 'PackGate_Cancel_bd576' : 'packSkip')}
              </Text>
            </Pressable>
            {progress === null && chosen.length > 0 ? (
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
  item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  itemText: { flex: 1, gap: 2 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: 'transparent' },
  tick: { fontSize: 14, lineHeight: 18, textAlign: 'center', fontWeight: '700' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bar: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 6 },
});
