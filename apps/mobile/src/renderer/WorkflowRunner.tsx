import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { t, type StringKey } from '../i18n';
import { newAssetId, runWorkflow, type RunResult } from '../runtime/runner';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';

interface Prompt {
  label: string;
  value: string;
  resolve: (value: string | null) => void;
}

/** workflowRunner 组件：展示步骤，并在用户点击后真实执行。 */
export function WorkflowRunner({ workflowId, env }: { workflowId: string; env: RenderEnv }) {
  const { repo, files } = useWorkspaceContext();
  const revisionId = useWorkspace((s) => s.head!.id);
  const bumpAssets = useWorkspace((s) => s.bumpAssets);
  const { palette, locale, registry } = env;
  const workflow = env.config.workflows.find((w) => w.id === workflowId);
  const [step, setStep] = useState<number | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  if (!workflow) return null;
  const label = (action: string) => registry.actions.get(action)?.label[locale] ?? action;
  const running = step !== null;

  async function start() {
    if (!workflow || running || !env.interactive) return;
    setResult(null);
    const outcome = await runWorkflow({
      workflow,
      revisionId,
      repo,
      files,
      registry,
      locale,
      now: () => new Date(),
      newId: newAssetId,
      onStep: setStep,
      prompts: {
        askText: (promptLabel, value) =>
          new Promise((resolve) => setPrompt({ label: promptLabel, value, resolve })),
      },
    });
    setStep(null);
    setResult(outcome);
    if (outcome.status === 'succeeded') bumpAssets();
  }

  function answer(value: string | null) {
    prompt?.resolve(value);
    setPrompt(null);
  }

  const card = [styles.card, { backgroundColor: palette.card, borderColor: palette.border }];
  return (
    <View style={card}>
      <Text style={[styles.title, { color: palette.text }]}>{workflow.name}</Text>
      {workflow.steps.map((s, i) => (
        <Text
          key={s.id}
          testID={`step-${s.id}`}
          style={{
            color: step === i ? palette.primary : palette.subtext,
            fontWeight: step === i ? '700' : '400',
          }}>
          {i + 1}. {label(s.action)}
        </Text>
      ))}

      <Pressable
        testID={`run-${workflow.id}`}
        onPress={() => void start()}
        disabled={running}
        style={[styles.button, { backgroundColor: palette.primary, opacity: running ? 0.6 : 1 }]}>
        {running ? (
          <ActivityIndicator color={palette.onPrimary} />
        ) : (
          <Text style={[styles.buttonText, { color: palette.onPrimary }]}>
            {t(locale, result ? 'runAgain' : 'run')}
          </Text>
        )}
      </Pressable>
      {running ? (
        <Text style={{ color: palette.subtext }}>
          {t(locale, 'running', { n: step + 1, step: label(workflow.steps[step]!.action) })}
        </Text>
      ) : null}

      {result?.status === 'succeeded' && result.savedFile ? (
        <View testID="run-result" style={styles.result}>
          <Text style={{ color: palette.text }}>
            {t(locale, 'runDone', { name: result.savedFile.name, pages: result.pageCount ?? '?' })}
          </Text>
          <Pressable
            onPress={() => files.share(result.savedFile!.path, result.savedFile!.mimeType)}>
            <Text style={{ color: palette.primary, fontWeight: '600' }}>{t(locale, 'share')}</Text>
          </Pressable>
        </View>
      ) : null}
      {result?.status === 'cancelled' ? (
        <Text style={{ color: palette.subtext }}>{t(locale, 'runCancelled')}</Text>
      ) : null}
      {result?.status === 'failed' ? (
        <Text testID="run-error" style={{ color: palette.danger }}>
          {t(locale, `runError_${result.error.code}` as StringKey, result.error.detail)}
        </Text>
      ) : null}

      <Modal
        visible={prompt !== null}
        transparent
        animationType="fade"
        onRequestClose={() => answer(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.dialog, { backgroundColor: palette.card }]}>
            <Text style={[styles.title, { color: palette.text }]}>{prompt?.label}</Text>
            <TextInput
              testID="prompt-input"
              value={prompt?.value ?? ''}
              onChangeText={(value) => prompt && setPrompt({ ...prompt, value })}
              autoFocus
              style={[styles.input, { color: palette.text, borderColor: palette.border }]}
            />
            <View style={styles.dialogActions}>
              <Pressable testID="prompt-cancel" onPress={() => answer(null)}>
                <Text style={{ color: palette.subtext, fontSize: 16 }}>{t(locale, 'cancel')}</Text>
              </Pressable>
              <Pressable testID="prompt-ok" onPress={() => answer(prompt?.value.trim() || null)}>
                <Text style={{ color: palette.primary, fontSize: 16, fontWeight: '700' }}>
                  {t(locale, 'ok')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  title: { fontSize: 17, fontWeight: '600' },
  button: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  result: { gap: 4 },
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 16, padding: 20, gap: 14 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24 },
});
