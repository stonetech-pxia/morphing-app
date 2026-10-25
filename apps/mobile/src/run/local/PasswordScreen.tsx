import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { t } from '../../i18n';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';

// 去掉 PDF 密码（D-194）：要密码才能打开的 PDF，逐个输密码。密码只交给这一次运行，不保存、不发给 AI。

export function PasswordScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'password'>) {
  const { name, wrong, index, total } = input;
  const [password, setPassword] = useState('');
  return (
    <LocalFrame
      palette={palette}
      title={total > 1 ? `${name} · ${index + 1}/${total}` : name}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, 'PasswordScreen_Open_c5147')}
      onCancel={onCancel}
      onDone={() => onDone({ password })}
      doneDisabled={password === ''}
      avoidKeyboard>
      <View style={styles.body}>
        <Text style={[palette.font('body', 15), { color: palette.text }]}>
          {t(locale, 'PasswordScreen_This_PDF_needs_a_password_to_open_Morp_31218')}
        </Text>
        <TextInput
          testID="password-input"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          onSubmitEditing={() => password !== '' && onDone({ password })}
          style={[
            styles.input,
            palette.font('body', 16),
            {
              color: palette.text,
              borderColor: wrong ? palette.danger : palette.border,
              borderRadius: palette.controlRadius,
              backgroundColor: palette.surface,
            },
          ]}
        />
        {wrong ? (
          <Text
            testID="password-wrong"
            style={[palette.font('bodyMedium', 14), { color: palette.danger }]}>
            {t(locale, 'PasswordScreen_That_password_is_wrong_Try_again_74476')}
          </Text>
        ) : null}
        <Text style={[palette.font('body', 13), { color: palette.caption }]}>
          {t(locale, 'PasswordScreen_The_password_is_not_saved_9f226')}
        </Text>
        {total > 1 ? (
          <Pressable
            testID="password-skip"
            onPress={() => onDone({ skip: true })}
            style={styles.skip}
            hitSlop={8}>
            <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>
              {t(locale, 'PasswordScreen_Skip_this_one_71a32')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </LocalFrame>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 14 },
  input: { borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12 },
  skip: { alignSelf: 'center', paddingVertical: 8 },
});
