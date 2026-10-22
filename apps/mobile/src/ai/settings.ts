import {
  DEFAULT_MODEL,
  MODELS,
  checkModelAccess,
  ClaudeHttpError,
  type ClaudeErrorKind,
} from '@morph/planner';
import { createStore, type StoreApi } from 'zustand/vanilla';

// AI 设置（设备级，不属于工作空间配置，不进入版本历史）。
// 用户自带的 API key 存在系统安全存储（iOS 钥匙串 / Android Keystore），只在本机使用。

export type AIMode = 'mock' | 'server' | 'byok';

/** 安全存储接口：App 中由 expo-secure-store 实现，测试中用内存实现。 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const KEYS = {
  apiKey: 'morph.ai.apiKey',
  keyHint: 'morph.ai.keyHint',
  mode: 'morph.ai.mode',
  model: 'morph.ai.model',
};

export type ConnectionResult =
  { ok: true } | { ok: false; kind: ClaudeErrorKind | 'no_key' | 'network' };

export interface AISettingsState {
  loaded: boolean;
  mode: AIMode;
  model: string;
  /** 已保存的 key 的末四位，用于显示；没有 key 时为 null。 */
  keyHint: string | null;
  /** 是否配置了 Morph 服务器地址。 */
  serverAvailable: boolean;

  load(): Promise<void>;
  setMode(mode: AIMode): Promise<void>;
  setModel(model: string): Promise<void>;
  saveKey(key: string): Promise<boolean>;
  clearKey(): Promise<void>;
  getKey(): Promise<string | null>;
  testConnection(): Promise<ConnectionResult>;
}

export type AISettingsStore = StoreApi<AISettingsState>;

/** 粗略检查格式，避免把明显不是 key 的内容存进去。真正是否可用由“测试连接”判断。 */
export const looksLikeApiKey = (key: string) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key);

export function createAISettingsStore(deps: {
  secrets: SecretStore;
  serverAvailable: boolean;
  fetchImpl?: typeof fetch;
}): AISettingsStore {
  const { secrets } = deps;
  const defaultMode: AIMode = deps.serverAvailable ? 'server' : 'mock';
  return createStore<AISettingsState>()((set, get) => ({
    loaded: false,
    mode: defaultMode,
    model: DEFAULT_MODEL,
    keyHint: null,
    serverAvailable: deps.serverAvailable,

    async load() {
      const [mode, model, keyHint] = await Promise.all([
        secrets.get(KEYS.mode),
        secrets.get(KEYS.model),
        secrets.get(KEYS.keyHint),
      ]);
      const validMode =
        mode === 'mock' || mode === 'byok' || (mode === 'server' && deps.serverAvailable)
          ? mode
          : defaultMode;
      set({
        loaded: true,
        mode: validMode,
        model: MODELS.some((m) => m.id === model) ? model! : DEFAULT_MODEL,
        keyHint,
      });
    },

    async setMode(mode) {
      if (mode === 'server' && !deps.serverAvailable) return;
      await secrets.set(KEYS.mode, mode);
      set({ mode });
    },

    async setModel(model) {
      if (!MODELS.some((m) => m.id === model)) return;
      await secrets.set(KEYS.model, model);
      set({ model });
    },

    async saveKey(raw) {
      const key = raw.trim();
      if (!looksLikeApiKey(key)) return false;
      await secrets.set(KEYS.apiKey, key);
      await secrets.set(KEYS.keyHint, key.slice(-4));
      set({ keyHint: key.slice(-4) });
      return true;
    },

    async clearKey() {
      await secrets.delete(KEYS.apiKey);
      await secrets.delete(KEYS.keyHint);
      set({ keyHint: null });
    },

    getKey: () => secrets.get(KEYS.apiKey),

    async testConnection() {
      const apiKey = await get().getKey();
      if (!apiKey) return { ok: false, kind: 'no_key' };
      try {
        await checkModelAccess(get().model, {
          apiKey,
          timeoutMs: 15_000,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, kind: e instanceof ClaudeHttpError ? e.kind : 'network' };
      }
    },
  }));
}
