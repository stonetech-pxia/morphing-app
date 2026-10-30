import {
  MAX_TILES,
  calendarOf,
  formatRef,
  recordProgress,
  shownRowAction,
  type DataRecord,
} from '@morph/core';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useRecordActionRunner } from '../data/record-actions';
import { useLinkResolver } from '../data/records';
import { t } from '../i18n';
import type { RenderEnv } from './components';
import {
  Trailing,
  amountText,
  openEditor,
  useListRecords,
  type RecordListProps,
  type Tone,
} from './data';
import { ProgressRing } from './Progress';
import { cardColors } from './theme';
import { Card } from './ui';

// 记录列表的大圆块外观（D-311，Streaks 那种）：每条记录一个大圆，下面是标题；有 progress 时圆外一圈进度环，
// 到了目标圆就填满。点一下执行这一块的行操作（第一个 when 满足的，D-300，执行和撤销都是一键操作的代码），
// 没有行操作时打开这条记录。最多 24 个（D-312）。

const SIZE = 84;
const STROKE = 6;

export function Tiles({
  props,
  env,
  tone,
}: {
  props: RecordListProps;
  env: RenderEnv;
  tone?: Tone;
}) {
  const { palette, locale } = env;
  const router = useRouter();
  const runner = useRecordActionRunner();
  const { collection, view, loaded, sorted } = useListRecords(props, env);
  const links = useLinkResolver(view);
  if (!collection || !view) return null;
  const background = cardColors(palette, tone).background;
  const shown = sorted.slice(0, Math.min(props.limit, MAX_TILES));
  if (loaded && shown.length === 0) {
    return (
      <Card palette={palette} background={background}>
        <Text style={[palette.font('body', 14), { color: palette.caption }]}>
          {props.emptyText ?? t(locale, 'noRecords')}
        </Text>
      </Card>
    );
  }
  const cal = calendarOf(env.config);
  const now = new Date();
  const format = props.trailingFormat;

  const tile = (r: DataRecord) => {
    const title = formatRef(r, view, props.titleField, locale, links, now, cal) || '—';
    const action = shownRowAction(props.rowActions, r, view, now, cal);
    const progress =
      format?.kind === 'progress'
        ? recordProgress(r, view, props.trailingField!, format.goal, now, cal)
        : undefined;
    const field = view.fields.find((f) => f.id === props.trailingField);
    const full = progress !== undefined && progress.ratio >= 1;
    const inside = progress
      ? t(locale, 'progressOfGoal', {
          value: amountText(progress.value, field, locale),
          goal: amountText(progress.goal, field, locale),
        })
      : undefined;
    const text = props.trailingField
      ? formatRef(r, view, props.trailingField, locale, links, now, cal)
      : '';
    const open = () => openEditor(router, collection.id, r.id);
    const run = action ? () => void runner.runRow(action, r, collection) : open;
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
          onLongPress={env.onLongPress}
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
              ) : props.trailingField ? (
                <Trailing record={r} view={view} props={props} env={env} text={text} />
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
