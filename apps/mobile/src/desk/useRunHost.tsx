import { RunError, type AskRequest, type Locale, type PackNeed } from '@morph/core';
import { useState, type ComponentType, type ReactNode } from 'react';
import { Alert, Modal, Platform } from 'react-native';

import { t } from '../i18n';
import { PackGate } from '../packs/PackGate';
import { usePacks } from '../packs/PackHost';
import type { Palette } from '../renderer/theme';
import { AskPanel } from '../run/AskPanel';
import { LOCAL_SCREENS } from '../run/local';
import type { LocalScreenProps } from '../run/RunScreen';
import type { LocalKind, LocalSteps, LocalUi } from '../runtime/local';
import type { RunContext } from '../runtime/runner';

// 房间里跑工具和快捷操作时要的系统界面（file-room DESIGN §4，D-339）：运行时询问、扩展包下载、
// 本地操作界面（裁剪、找边、签名……照旧弹出原来的界面）。做法和运行页（RunScreen）一样，
// 只是结果交回房间，不打开结果页。

/** 问话框淡出要多久（毫秒，和 RunScreen 一样）。 */
const ASK_DISMISS_MS = 400;

interface Pending<T> {
  resolve: (value: T) => void;
}

type LocalPending = {
  [K in LocalKind]: { kind: K; input: LocalSteps[K]['in'] } & Pending<LocalSteps[K]['out'] | null>;
}[LocalKind];

export type RunHost = Pick<
  RunContext,
  'ui' | 'askParams' | 'ensurePack' | 'ensurePacks' | 'packs'
> & { elements: ReactNode };

export function useRunHost(palette: Palette, locale: Locale): RunHost {
  const packs = usePacks();
  const [ask, setAsk] = useState<(AskRequest & Pending<Record<string, unknown> | null>) | null>(
    null,
  );
  const [packAsk, setPackAsk] = useState<
    ({ needs: readonly PackNeed[] } & Pending<string[] | null>) | null
  >(null);
  const [local, setLocal] = useState<LocalPending | null>(null);

  const ui: LocalUi = {
    confirm: (title, ok, cancel, message) =>
      new Promise((resolve) =>
        Alert.alert(
          title,
          message,
          [
            { text: cancel, style: 'cancel', onPress: () => resolve(false) },
            { text: ok, onPress: () => resolve(true) },
          ],
          { cancelable: false },
        ),
      ),
    choose: (title, message, options) =>
      new Promise((resolve) =>
        Alert.alert(
          title,
          message,
          [
            ...options.map((text, i) => ({ text, onPress: () => resolve(i) })),
            { text: t(locale, 'cancel'), style: 'cancel' as const, onPress: () => resolve(null) },
          ],
          { cancelable: false },
        ),
      ),
    open: (kind, input) =>
      new Promise((resolve) => setLocal({ kind, input, resolve } as unknown as LocalPending)),
  };

  const LocalScreen = local
    ? (LOCAL_SCREENS[local.kind] as ComponentType<LocalScreenProps<LocalKind>> | undefined)
    : undefined;

  const elements = (
    <>
      {ask ? (
        <AskPanel
          request={ask}
          palette={palette}
          locale={locale}
          now={new Date()}
          onAnswer={(answer) => {
            setAsk(null);
            if (Platform.OS === 'ios') setTimeout(() => ask.resolve(answer), ASK_DISMISS_MS);
            else ask.resolve(answer);
          }}
        />
      ) : null}
      {packAsk && packs ? (
        <PackGate
          needs={packAsk.needs}
          store={packs.store}
          palette={palette}
          locale={locale}
          onDone={(left) => {
            packAsk.resolve(left);
            setPackAsk(null);
          }}
        />
      ) : null}
      {local && LocalScreen ? (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => {
            local.resolve(null);
            setLocal(null);
          }}>
          <LocalScreen
            input={local.input}
            palette={palette}
            locale={locale}
            onDone={(out) => {
              (local.resolve as (v: unknown) => void)(out);
              setLocal(null);
            }}
            onCancel={() => {
              local.resolve(null);
              setLocal(null);
            }}
          />
        </Modal>
      ) : null}
    </>
  );

  return {
    ui,
    elements,
    packs: packs
      ? { runtime: packs.bridge, isInstalled: (id) => packs.store.isInstalled(id) }
      : null,
    askParams: (request) => new Promise((resolve) => setAsk({ ...request, resolve })),
    ensurePacks: async (needs) => {
      if (!packs) throw new RunError('packFailed', { detail: needs[0]?.pack });
      const have = new Set((await packs.store.installed()).map((p) => p.id));
      const missing = needs.filter((n) => !have.has(n.pack));
      if (missing.length === 0) return [];
      return new Promise((resolve) => setPackAsk({ needs: missing, resolve }));
    },
    ensurePack: async (packId, options) => {
      if (!packs) throw new RunError('packFailed', { detail: packId });
      if (await packs.store.isInstalled(packId)) return true;
      const left = await new Promise<string[] | null>((resolve) =>
        setPackAsk({ needs: [{ pack: packId, optional: options?.optional === true }], resolve }),
      );
      return left !== null && !left.includes(packId);
    },
  };
}
