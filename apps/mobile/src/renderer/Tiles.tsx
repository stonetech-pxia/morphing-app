import { MAX_TILES, calendarOf, formatRef, recordProgress, type DataRecord } from '@morph/core';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useRecordActionRunner } from '../data/record-actions';
import { LONG_PRESS_MS } from '../editing/entry';
import { setInnerGesture } from '../editing/useSingleDrag';
import { useLinkResolver } from '../data/records';
import { t } from '../i18n';
import type { RenderEnv } from './components';
import {
  Trailing,
  amountText,
  rowToolOf,
  useListRecords,
  type RecordBlock,
  type Tone,
} from './data';
import { openRow } from './open-row';
import { ProgressRing } from './Progress';
import { cardColors } from './theme';
import { Card } from './ui';

// 记录列表的大圆块外观（D-311，Streaks 那种）：每条记录一个大圆，下面是标题；有 progress 时圆外一圈进度环，
// 到了目标圆就填满。点一下执行这一块的行操作（第一个 when 满足的，D-300，执行是一键操作的代码），
// 没有行操作时打开这条记录；有行操作时长按打开记录。最多 24 个（D-312）。

const SIZE = 84;
/** 长按打开记录要比页面的长按编辑（LONG_PRESS_MS）先到。 */
const HOLD_MS = LONG_PRESS_MS - 150;
const STROKE = 6;

export function Tiles({ block, env, tone }: { block: RecordBlock; env: RenderEnv; tone?: Tone }) {
  const { palette, locale } = env;
  const router = useRouter();
  const runner = useRecordActionRunner();
  const { collection, view, loaded, sorted } = useListRecords(block, env);
  const links = useLinkResolver(view);
  if (!collection || !view) return null;
  const background = cardColors(palette, tone).background;
  const shown = sorted.slice(0, Math.min(block.source.limit, MAX_TILES));
  if (loaded && shown.length === 0) {
    return (
      <Card palette={palette} background={background}>
        <Text style={[palette.font('body', 14), { color: palette.caption }]}>
          {block.show.emptyText ?? t(locale, 'noRecords')}
        </Text>
      </Card>
    );
  }
  const cal = calendarOf(env.config);
  const now = new Date();
  const { show } = block;
  const format = show.format;

  const tile = (r: DataRecord) => {
    const title = formatRef(r, view, show.title, locale, links, now, cal) || '—';
    const action = rowToolOf(block, r, view, now, cal);
    const progress =
      format?.kind === 'progress'
        ? recordProgress(r, view, show.trailing!, format.goal, now, cal)
        : undefined;
    const field = view.fields.find((f) => f.id === show.trailing);
    const full = progress !== undefined && progress.ratio >= 1;
    const inside = progress
      ? t(locale, 'progressOfGoal', {
          value: amountText(progress.value, field, locale),
          goal: amountText(progress.goal, field, locale),
        })
      : undefined;
    const text = show.trailing ? formatRef(r, view, show.trailing, locale, links, now, cal) : '';
    const open = () => openRow(router, block.opens, collection.id, r.id);
    const run = action ? () => void runner.runRow(action, r) : open;
    // 打开记录后这一块可能等不到松手（onPressOut），过了页面长按编辑的时间再放开。
    const holdOpen = () => {
      open();
      setTimeout(() => setInnerGesture(false), LONG_PRESS_MS);
    };
    const press = env.interactive ? (env.locked ?? run) : undefined;
    return (
      <View key={r.id} style={styles.cell}>
        <Pressable
          testID={`tile-${r.id}`}
          accessibilityRole="button"
          accessibilityLabel={[title, inside ?? text].filter(Boolean).join(', ')}
          accessibilityHint={action?.label}
          // 有行操作时点一下执行它；读屏用户另外可以选「打开」看这条记录。
          accessibilityActions={
            action
              ? [
                  { name: 'activate', label: action.label },
                  { name: 'open', label: t(locale, 'open') },
                ]
              : undefined
          }
          onAccessibilityAction={(e) => {
            if (!env.interactive) return;
            if (env.locked) return env.locked();
            if (e.nativeEvent.actionName === 'open') open();
            else run();
          }}
          disabled={!press}
          onPress={press}
          // 有行操作时长按打开这条记录（D-311）：功能优先，单组件编辑（D-235）让路，长按圆块以外的地方照样进编辑。
          onPressIn={action && env.interactive ? () => setInnerGesture(true) : undefined}
          onPressOut={action ? () => setInnerGesture(false) : undefined}
          onLongPress={
            action ? (env.interactive ? (env.locked ?? holdOpen) : undefined) : env.onLongPress
          }
          delayLongPress={action ? HOLD_MS : undefined}
          style={({ pressed }) => [styles.tile, pressed && { transform: [{ scale: 0.94 }] }]}>
          <View style={styles.circleBox}>
            {progress ? (
              <View style={StyleSheet.absoluteFill}>
                <ProgressRing
                  ratio={progress.ratio}
                  size={SIZE}
                  stroke={STROKE}
                  palette={palette}
                  testID={`tile-ring-${r.id}`}
                />
              </View>
            ) : null}
            <View
              style={[
                styles.circle,
                {
                  backgroundColor: full ? palette.primary : palette.primaryTint,
                  margin: progress ? STROKE + 3 : 0,
                },
              ]}>
              {inside ? (
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[
                    palette.font('title', 15),
                    styles.tabular,
                    { color: full ? palette.onPrimary : palette.primaryText },
                  ]}>
                  {inside}
                </Text>
              ) : show.trailing ? (
                <Trailing record={r} view={view} show={show} env={env} text={text} />
              ) : action ? (
                <Text
                  numberOfLines={2}
                  style={[
                    palette.font('bodyBold', 13),
                    styles.center,
                    { color: palette.primaryText },
                  ]}>
                  {action.label}
                </Text>
              ) : null}
            </View>
          </View>
          <Text
            numberOfLines={2}
            style={[palette.font('bodyMedium', 14), styles.center, { color: palette.text }]}>
            {title}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <Card palette={palette} background={background}>
      <View style={styles.grid}>{shown.map(tile)}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  cell: { width: '33.333%', alignItems: 'center' },
  tile: { alignItems: 'center', gap: 8, paddingHorizontal: 4, minWidth: 88 },
  circleBox: { width: SIZE, height: SIZE },
  circle: {
    flex: 1,
    borderRadius: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  center: { textAlign: 'center' },
  tabular: { fontVariant: ['tabular-nums'] },
});
