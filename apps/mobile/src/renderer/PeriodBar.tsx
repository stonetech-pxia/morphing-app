import {
  choiceRange,
  calendarOf,
  validChoice,
  type BlockOf,
  type PageChoice,
  type PagePeriod,
} from '@morph/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { t } from '../i18n';
import type { RenderEnv } from './components';
import { onPage } from './theme';

// 时间范围（D-440）：一排小块，点一个，同一页里跟着它的图表和数字卡都按它画；多一个「自定义」时点了选起止日期。
// 选了什么只放在页面的状态里（RenderEnv.pageRange），什么都不写（底线 15）。

/** 页面上现在选的：状态里的，没有或者已经不在选项里（刚被改掉）就回到默认的那个。 */
export function resolveChoice(block: BlockOf<'period'>, picked: PageChoice | null): PageChoice {
  const { options, custom } = block.show;
  if (picked && 'period' in picked && options.includes(picked.period)) return picked;
  if (picked && 'start' in picked && custom && validChoice(picked)) return picked;
  return { period: block.show.default ?? options[0]! };
}

const LABELS: Record<PagePeriod, Parameters<typeof t>[1]> = {
  today: 'periodOpt_today',
  thisWeek: 'periodOpt_thisWeek',
  thisMonth: 'periodOpt_thisMonth',
  thisYear: 'periodOpt_thisYear',
  last7days: 'periodOpt_last7days',
  last30days: 'periodOpt_last30days',
  last90days: 'periodOpt_last90days',
  last365days: 'periodOpt_last365days',
};

export function PeriodBar({ block, env }: { block: BlockOf<'period'>; env: RenderEnv }) {
  const { locale, interactive } = env;
  const page = onPage(env.palette);
  const state = env.pageRange;
  const choice = state?.choice ?? resolveChoice(block, null);
  const [editing, setEditing] = useState(false);
  const range = choiceRange(choice, new Date(), calendarOf(env.config));
  const [start, setStart] = useState(range.start);
  const [end, setEnd] = useState(range.end);
  const custom = 'start' in choice;
  const draft: PageChoice = { start, end };
  const valid = validChoice(draft);
  const chip = (id: string, label: string, on: boolean, press: () => void) => (
    <Pressable
      key={id}
      testID={`period-${id}`}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      disabled={!interactive || !state}
      onPress={press}
      onLongPress={env.onLongPress}
      style={[
        styles.chip,
        {
          borderColor: on ? page.primary : page.border,
          backgroundColor: on ? page.primaryTint : 'transparent',
        },
      ]}>
      <Text style={[page.font('bodyMedium', 13), { color: on ? page.primaryText : page.muted }]}>
        {label}
      </Text>
    </Pressable>
  );
  const input = (id: string, label: string, value: string, set: (v: string) => void) => (
    <View style={styles.field}>
      <Text style={[page.font('bodyMedium', 12), { color: page.caption }]}>{label}</Text>
      <TextInput
        testID={`period-${id}`}
        value={value}
        onChangeText={set}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={page.caption}
        autoCorrect={false}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
        style={[
          styles.input,
          page.font('body', 15),
          {
            color: page.text,
            borderColor: valid ? page.border : page.primary,
            backgroundColor: page.surface,
            borderRadius: page.controlRadius,
          },
        ]}
      />
    </View>
  );
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {block.show.options.map((p) =>
          chip(p, t(locale, LABELS[p]), 'period' in choice && choice.period === p, () =>
            state?.set({ period: p }),
          ),
        )}
        {block.show.custom
          ? chip('custom', t(locale, 'periodCustom'), custom || editing, () =>
              setEditing((now) => !now),
            )
          : null}
      </View>
      {custom && !editing ? (
        <Text testID="period-range" style={[page.font('body', 12), { color: page.caption }]}>
          {t(locale, 'periodRangeText', { start: range.start, end: range.end })}
        </Text>
      ) : null}
      {editing ? (
        <View style={styles.custom}>
          <View style={styles.row}>
            {input('start', t(locale, 'periodCustomStart'), start, setStart)}
            {input('end', t(locale, 'periodCustomEnd'), end, setEnd)}
          </View>
          {!valid ? (
            <Text
              testID="period-invalid"
              style={[page.font('body', 12), { color: page.primaryText }]}>
              {t(locale, 'periodCustomInvalid')}
            </Text>
          ) : null}
          <Pressable
            testID="period-apply"
            accessibilityRole="button"
            disabled={!valid || !interactive || !state}
            onPress={() => {
              state?.set(draft);
              setEditing(false);
            }}
            style={[
              styles.apply,
              { backgroundColor: valid ? page.primary : page.border, borderRadius: 999 },
            ]}>
            <Text style={[page.font('bodyBold', 14), { color: page.onPrimary }]}>
              {t(locale, 'periodCustomApply')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 6 },
  chip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  custom: { gap: 8 },
  field: { flex: 1, minWidth: 130, gap: 4 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  apply: { alignSelf: 'flex-start', paddingHorizontal: 18, paddingVertical: 10 },
});
