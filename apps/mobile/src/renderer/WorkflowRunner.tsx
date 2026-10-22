import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { t, type StringKey } from '../i18n';
import { newAssetId, runWorkflow, type RunResult } from '../runtime/runner';
import { useWorkspace, useWorkspaceContext } from '../workspace/context';
import type { RenderEnv } from './components';
import { Button, Card } from './ui';

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

  return (
    <Card palette={palette}>
      <Text style={[palette.font('title', 17), { color: palette.text }]}>{workflow.name}</Text>
      {workflow.steps.map((s, i) => (
        <View key={s.id} style={styles.step}>
          <View
            style={[
              styles.stepNumber,
              { backgroundColor: step === i ? palette.primary : palette.primaryTint },
            ]}>
            <Text
              style={[
                palette.font('bodyBold', 12),
                { color: step === i ? palette.onPrimary : palette.primaryText },
              ]}>
              {i + 1}
            </Text>
          </View>
          <Text
            testID={`step-${s.id}`}
            style={[
              palette.font(step === i ? 'bodyBold' : 'body', 15),
              { color: step === i ? palette.text : palette.muted },
            ]}>
            {label(s.action)}
          </Text>
        </View>
      ))}

      <Button
        palette={palette}
        testID={`run-${workflow.id}`}
        label={t(locale, result ? 'runAgain' : 'run')}
        onPress={() => void start()}
        loading={running}
        style={styles.run}
      />
      {running ? (
        <Text style={[palette.font('body', 14), { color: palette.muted }]}>
          {t(locale, 'running', { n: step + 1, step: label(workflow.steps[step]!.action) })}
        </Text>
      ) : null}

      {result?.status === 'succeeded' && result.savedFile ? (
        <View testID="run-result" style={styles.result}>
          <Text style={[palette.font('bodyMedium', 15), { color: palette.text }]}>
            {t(locale, 'runDone', { name: result.savedFile.name, pages: result.pageCount ?? '?' })}
          </Text>
          <Pressable
            onPress={() => files.share(result.savedFile!.path, result.savedFile!.mimeType)}>
            <Text style={[palette.font('bodyBold', 15), { color: palette.primaryText }]}>
              {t(locale, 'share')}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {result?.status === 'cancelled' ? (
        <Text style={[palette.font('body', 14), { color: palette.muted }]}>
          {t(locale, 'runCancelled')}
        </Text>
      ) : null}
      {result?.status === 'failed' ? (
        <Text
          testID="run-error"
          style={[palette.font('bodyMedium', 14), { color: palette.danger }]}>
          {t(locale, `runError_${result.error.code}` as StringKey, result.error.detail)}
        </Text>
      ) : null}

      <Modal
        visible={prompt !== null}
        transparent
        animationType="fade"
        onRequestClose={() => answer(null)}>
        <View style={styles.backdrop}>
          <View
            style={[
              styles.dialog,
              { backgroundColor: palette.surface, borderRadius: palette.radius },
            ]}>
            <Text style={[palette.font('title', 18), { color: palette.text }]}>
              {prompt?.label}
            </Text>
            <TextInput
              testID="prompt-input"
              value={prompt?.value ?? ''}
              onChangeText={(value) => prompt && setPrompt({ ...prompt, value })}
              autoFocus
              style={[
                styles.input,
                palette.font('body', 16),
                {
                  color: palette.text,
                  borderColor: palette.primary,
                  borderRadius: palette.controlRadius,
                  backgroundColor: palette.surface,
                },
              ]}
            />
            <View style={styles.dialogActions}>
              <Pressable testID="prompt-cancel" onPress={() => answer(null)} hitSlop={8}>
                <Text style={[palette.font('bodyBold', 16), { color: palette.muted }]}>
                  {t(locale, 'cancel')}
                </Text>
              </Pressable>
              <Pressable
                testID="prompt-ok"
                onPress={() => answer(prompt?.value.trim() || null)}
                hitSlop={8}>
                <Text style={[palette.font('bodyBold', 16), { color: palette.primaryText }]}>
                  {t(locale, 'ok')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  run: { marginTop: 6 },
  result: { gap: 4 },
  backdrop: { flex: 1, backgroundColor: '#2A242080', justifyContent: 'center', padding: 24 },
  dialog: { padding: 22, gap: 16 },
  input: { borderWidth: 1.5, padding: 14 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24 },
});
