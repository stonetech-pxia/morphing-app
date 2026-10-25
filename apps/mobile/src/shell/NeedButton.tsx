import type { RejectReason } from '@morph/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAISettings } from '../ai/context';
import { t } from '../i18n';
import type { Palette } from '../renderer/theme';

// 需求回收（D-189）：AI 做不到时，在回答下面显示「把这个需求告诉我们」，用户点了才把那一句话发给 Morph
// （不含文件、记录和设置）。AI 修改页和草稿聊天框共用。

/** 这几种拒绝是「做不到」，值得把需求收回来；userData、protected、unavailable 等不是。 */
const NEED_REASONS = ['unknown', 'errand', 'notInstalled'] as const;

export function NeedButton({
  text,
  reason,
  palette,
  locale,
}: {
  text: string;
  reason: RejectReason | undefined;
  palette: Palette;
  locale: 'en' | 'zh' | 'fr';
}) {
  const shown = useAISettings((s) => s.needsButton && s.canSendNeeds);
  const sendNeed = useAISettings((s) => s.sendNeed);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const need = NEED_REASONS.find((r) => r === reason);
  if (!shown || !need || !text) return null;
  if (state === 'sent') {
    return (
      <Text testID="need-sent" style={[palette.font('body', 13), { color: palette.muted }]}>
        {t(locale, 'needSent')}
      </Text>
    );
  }
  return (
    <View style={styles.wrap}>
      <Pressable
        testID="need-send"
        disabled={state === 'sending'}
        hitSlop={8}
        onPress={() => {
          setState('sending');
          void sendNeed({ text, locale, reason: need }).then((ok) =>
            setState(ok ? 'sent' : 'failed'),
          );
        }}>
        <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>
          {t(locale, state === 'failed' ? 'needRetry' : 'needSend')}
        </Text>
      </Pressable>
      <Text style={[palette.font('body', 12), { color: palette.caption }]}>
        {t(locale, 'needPrivacy')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: 4, marginTop: 4 } });
