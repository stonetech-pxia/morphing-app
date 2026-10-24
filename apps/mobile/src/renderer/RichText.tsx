import { linkTarget, parseRichText, type Span } from '@morph/core';
import { Alert, Linking, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { t } from '../i18n';
import type { RenderEnv } from './components';

// 富文本渲染（D-044）：粗体、斜体、链接、列表。只有数据，没有可执行内容。
// 链接只可能是 https / mailto（schema 已校验），打开前还要用户确认目标地址。

export function RichText({
  source,
  env,
  color,
  size,
  align,
}: {
  source: string;
  env: RenderEnv;
  color: string;
  size: number;
  align?: TextStyle;
}) {
  const { palette, locale } = env;
  const lineHeight = Math.round(size * 1.5 * palette.theme.fontScale);
  const base = [palette.font('body', size), { color, lineHeight }, align];

  function open(url: string) {
    if (!env.interactive) return;
    if (env.locked) return env.locked();
    Alert.alert(
      t(locale, 'openLinkTitle'),
      t(locale, 'openLinkMessage', { target: linkTarget(url) }),
      [
        { text: t(locale, 'cancel'), style: 'cancel' },
        { text: t(locale, 'openLink'), onPress: () => void Linking.openURL(url) },
      ],
    );
  }

  const span = (s: Span, i: number) => {
    const style: TextStyle[] = [];
    if (s.bold) style.push(palette.font('bodyBold', size));
    if (s.italic) {
      style.push(
        palette.theme.font === 'clay'
          ? { fontFamily: s.bold ? 'Karla_700Bold' : 'Karla_400Regular_Italic' }
          : { fontStyle: 'italic' },
      );
    }
    if (s.url) style.push({ color: palette.primaryText, textDecorationLine: 'underline' });
    return (
      <Text
        key={i}
        style={style}
        onPress={s.url ? () => open(s.url!) : undefined}
        accessibilityRole={s.url ? 'link' : undefined}>
        {s.text}
      </Text>
    );
  };

  return (
    <View style={styles.blocks}>
      {parseRichText(source).map((block, b) =>
        block.type === 'paragraph' ? (
          <Text key={b} style={base}>
            {block.spans.map(span)}
          </Text>
        ) : (
          <View key={b} style={styles.list}>
            {block.items.map((item, i) => (
              <View key={i} style={styles.item}>
                <Text style={[base, block.ordered ? styles.number : styles.bullet]}>
                  {block.ordered ? `${i + 1}.` : '•'}
                </Text>
                <Text style={[base, styles.flex]}>{item.map(span)}</Text>
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: 8 },
  list: { gap: 4 },
  item: { flexDirection: 'row', gap: 6 },
  bullet: { minWidth: 10 },
  number: { minWidth: 18 },
  flex: { flex: 1 },
});
