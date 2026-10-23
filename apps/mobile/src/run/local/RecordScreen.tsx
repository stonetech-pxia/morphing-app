import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import type { Palette } from '../../renderer/theme';
import type { LocalScreenProps } from '../RunScreen';
import { LocalFrame } from './LocalFrame';
import { formatTime } from './TrimScreen';

// 录音（D-154）：大按钮开始 / 暂停 / 继续，计时和音量条；锁屏后继续录（app.json 里 expo-audio 的
// 后台录音：iOS 后台音频，Android 前台服务和「正在录音」通知）。录成 M4A（AAC 单声道 64 kbps，
// 一小时约 28 MB），录完交给下一步；录音只在本机。

/** 说话录音：单声道 64 kbps 足够清楚，也方便后面转文字。 */
export const VOICE_RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
};

/** 音量（分贝，-160–0）→ 0–1：-50 dB 以下算安静。 */
export const levelOf = (db: number | undefined) =>
  db === undefined ? 0 : Math.max(0, Math.min(1, (db + 50) / 50));

type Phase = 'idle' | 'recording' | 'paused';

export function RecordScreen({
  input,
  palette,
  locale,
  onDone,
  onCancel,
}: LocalScreenProps<'record'>) {
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const state = useAudioRecorderState(recorder, 200);
  const [phase, setPhase] = useState<Phase>('idle');
  const [denied, setDenied] = useState(false);

  async function start() {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setDenied(true);
      return;
    }
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      allowsBackgroundRecording: true,
    });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase('recording');
  }

  function toggle() {
    if (phase === 'idle') return void start();
    if (phase === 'recording') {
      recorder.pause();
      setPhase('paused');
    } else {
      recorder.record();
      setPhase('recording');
    }
  }

  async function stop() {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false }).catch(
      () => undefined,
    );
    return recorder.uri;
  }

  async function finish() {
    const durationMs = state.durationMillis;
    const uri = await stop();
    if (!uri) return onCancel();
    const file = new File(uri);
    onDone({
      uri,
      name: `${input.name}.m4a`,
      size: file.exists ? file.size : null,
      mimeType: 'audio/mp4',
      durationMs,
    });
  }

  function cancel() {
    if (phase === 'idle') return onCancel();
    Alert.alert(t(locale, 'recordDiscardTitle'), undefined, [
      { text: t(locale, 'recordKeep'), style: 'cancel' },
      {
        text: t(locale, 'recordDiscard'),
        style: 'destructive',
        onPress: () => {
          void stop().then((uri) => {
            if (uri) {
              const file = new File(uri);
              if (file.exists) file.delete();
            }
            onCancel();
          });
        },
      },
    ]);
  }

  const level = phase === 'recording' ? levelOf(state.metering) : 0;
  const label =
    phase === 'idle' ? 'recordStart' : phase === 'recording' ? 'recordPause' : 'recordResume';
  return (
    <LocalFrame
      palette={palette}
      title={t(locale, 'recordTitle')}
      cancelLabel={t(locale, 'cancel')}
      doneLabel={t(locale, 'recordDone')}
      doneDisabled={phase === 'idle' || state.durationMillis <= 0}
      onCancel={cancel}
      onDone={() => void finish()}>
      <View style={styles.body}>
        <Text
          testID="record-time"
          style={[palette.font('title', 56), styles.time, { color: palette.text }]}>
          {formatTime(state.durationMillis)}
        </Text>
        <Meter level={level} palette={palette} />
        <Pressable
          testID="record-toggle"
          accessibilityRole="button"
          accessibilityLabel={t(locale, label)}
          onPress={toggle}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: phase === 'recording' ? palette.primaryTint : palette.primary,
              borderColor: palette.primary,
              opacity: pressed ? 0.8 : 1,
            },
          ]}>
          <Text
            style={[
              palette.font('bodyBold', 18),
              { color: phase === 'recording' ? palette.primaryText : palette.onPrimary },
            ]}>
            {t(locale, label)}
          </Text>
        </Pressable>
        <Text style={[palette.font('body', 15), styles.hint, { color: palette.caption }]}>
          {denied
            ? t(locale, 'runError_permissionDenied', { what: t(locale, 'recordMicrophone') })
            : t(locale, 'recordHint')}
        </Text>
      </View>
    </LocalFrame>
  );
}

/** 音量条：20 格，亮几格看现在多大声。 */
function Meter({ level, palette }: { level: number; palette: Palette }) {
  const lit = Math.round(level * 20);
  return (
    <View testID="record-meter" style={styles.meter}>
      {Array.from({ length: 20 }, (_, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: 8 + i * 2,
              backgroundColor: i < lit ? palette.primary : palette.border,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28, padding: 24 },
  time: { fontVariant: ['tabular-nums'] },
  meter: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 50 },
  bar: { width: 8, borderRadius: 3 },
  button: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { textAlign: 'center' },
});
