import {
  DEFAULT_MODEL,
  MODELS,
  checkBaseUrl,
  checkModelAccess,
  checkOpenAICompatible,
  AIHttpError,
  type AIErrorKind,
} from '@morph/planner';
import { createStore, type StoreApi } from 'zustand/vanilla';

// AI 设置（设备级，不属于工作空间配置，不进入版本历史）。
// 用户自带的 API key 存在系统安全存储（iOS 钥匙串 / Android Keystore），只在本机使用。
// 自带 key 有两种（D-241）：Anthropic，或 OpenAI 兼容接口（用户填 Base URL 和模型名）。
// 两种的 key 分开存：Anthropic 的 key 只发给 api.anthropic.com，不会因为切换而发到用户填的地址。

export type AIMode = 'mock' | 'server' | 'byok';
export type ByokProvider = 'anthropic' | 'openai';

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
  provider: 'morph.ai.provider',
  openaiKey: 'morph.ai.openai.apiKey',
  openaiKeyHint: 'morph.ai.openai.keyHint',
  openaiBaseUrl: 'morph.ai.openai.baseUrl',
  openaiModel: 'morph.ai.openai.model',
  needsButton: 'morph.ai.needsButton',
};

/** 用户主动发来的一条需求（D-189）：只有这句话和没有身份信息的元数据。 */
export interface Need {
  text: string;
  locale: 'en' | 'zh' | 'fr';
  reason: 'unknown' | 'errand' | 'notInstalled';
  ai: AIMode;
}

/** 把一条需求发给 Morph 的服务器；成功返回 true。 */
export type NeedSender = (need: Need) => Promise<boolean>;

export type ConnectionResult =
  { ok: true } | { ok: false; kind: AIErrorKind | 'no_key' | 'no_endpoint' | 'network' };

export type EndpointResult =
  { ok: true } | { ok: false; issue: 'invalid' | 'insecure' | 'no_model' };

export interface AISettingsState {
  loaded: boolean;
  mode: AIMode;
  /** Anthropic 时用的 Claude 模型。 */
  model: string;
  provider: ByokProvider;
  /** OpenAI 兼容接口的地址和模型名；没填时为空字符串。 */
  baseUrl: string;
  customModel: string;
  /** 当前 provider 已保存的 key 的末四位，用于显示；没有 key 时为 null。 */
  keyHint: string | null;
  /** 是否配置了 Morph 服务器地址。 */
  serverAvailable: boolean;
  /** AI 做不到时显示「把这个需求告诉我们」（D-189，默认显示；点了才发送）。 */
  needsButton: boolean;
  /** 能不能发需求（配置了服务器地址）。 */
  canSendNeeds: boolean;

  load(): Promise<void>;
  setMode(mode: AIMode): Promise<void>;
  setModel(model: string): Promise<void>;
  setProvider(provider: ByokProvider): Promise<void>;
  /** 保存 OpenAI 兼容接口的地址和模型名；地址换了就删掉旧 key，免得把它发到新地址。 */
  saveEndpoint(baseUrl: string, model: string): Promise<EndpointResult>;
  setNeedsButton(on: boolean): Promise<void>;
  sendNeed(need: Omit<Need, 'ai'>): Promise<boolean>;
  /** 保存当前 provider 的 key。 */
  saveKey(key: string): Promise<boolean>;
  clearKey(): Promise<void>;
  /** 当前 provider 的 key。 */
  getKey(): Promise<string | null>;
  testConnection(): Promise<ConnectionResult>;
}

export type AISettingsStore = StoreApi<AISettingsState>;

/** 粗略检查格式，避免把明显不是 key 的内容存进去。真正是否可用由“测试连接”判断。 */
export const looksLikeApiKey = (key: string) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key);
/** 各家 key 格式不同，只要求没有空白、不太短。 */
export const looksLikeOtherApiKey = (key: string) => /^[\x21-\x7e]{8,}$/.test(key);

const keySlot = (provider: ByokProvider) =>
  provider === 'anthropic'
    ? { key: KEYS.apiKey, hint: KEYS.keyHint }
    : { key: KEYS.openaiKey, hint: KEYS.openaiKeyHint };

export function createAISettingsStore(deps: {
  secrets: SecretStore;
  serverAvailable: boolean;
  fetchImpl?: typeof fetch;
  needs?: NeedSender | null;
}): AISettingsStore {
  const { secrets } = deps;
  const defaultMode: AIMode = deps.serverAvailable ? 'server' : 'mock';
  return createStore<AISettingsState>()((set, get) => ({
    loaded: false,
    mode: defaultMode,
    model: DEFAULT_MODEL,
    provider: 'anthropic',
    baseUrl: '',
    customModel: '',
    keyHint: null,
    serverAvailable: deps.serverAvailable,
    needsButton: true,
    canSendNeeds: Boolean(deps.needs),

    async load() {
      const [mode, model, needsButton, storedProvider, baseUrl, customModel] = await Promise.all([
        secrets.get(KEYS.mode),
        secrets.get(KEYS.model),
        secrets.get(KEYS.needsButton),
        secrets.get(KEYS.provider),
        secrets.get(KEYS.openaiBaseUrl),
        secrets.get(KEYS.openaiModel),
      ]);
      const provider: ByokProvider = storedProvider === 'openai' ? 'openai' : 'anthropic';
      const keyHint = await secrets.get(keySlot(provider).hint);
      const validMode =
        mode === 'mock' || mode === 'byok' || (mode === 'server' && deps.serverAvailable)
          ? mode
          : defaultMode;
      set({
        loaded: true,
        mode: validMode,
        model: MODELS.some((m) => m.id === model) ? model! : DEFAULT_MODEL,
        provider,
        baseUrl: baseUrl ?? '',
        customModel: customModel ?? '',
        keyHint,
        needsButton: needsButton !== 'off',
      });
    },

    async setNeedsButton(on) {
      await secrets.set(KEYS.needsButton, on ? 'on' : 'off');
      set({ needsButton: on });
    },

    async sendNeed(need) {
      if (!deps.needs) return false;
      return deps.needs({ ...need, ai: get().mode });
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

    async setProvider(provider) {
      await secrets.set(KEYS.provider, provider);
      set({ provider, keyHint: await secrets.get(keySlot(provider).hint) });
    },

    async saveEndpoint(rawUrl, rawModel) {
      const checked = checkBaseUrl(rawUrl);
      if (!checked.ok) return checked;
      const model = rawModel.trim();
      if (!model) return { ok: false, issue: 'no_model' };
      if (get().baseUrl && checked.url !== get().baseUrl) {
        const slot = keySlot('openai');
        await secrets.delete(slot.key);
        await secrets.delete(slot.hint);
        if (get().provider === 'openai') set({ keyHint: null });
      }
      await secrets.set(KEYS.openaiBaseUrl, checked.url);
      await secrets.set(KEYS.openaiModel, model);
      set({ baseUrl: checked.url, customModel: model });
      return { ok: true };
    },

    async saveKey(raw) {
      const key = raw.trim();
      const { provider } = get();
      if (!(provider === 'anthropic' ? looksLikeApiKey : looksLikeOtherApiKey)(key)) return false;
      const slot = keySlot(provider);
      await secrets.set(slot.key, key);
      await secrets.set(slot.hint, key.slice(-4));
      set({ keyHint: key.slice(-4) });
      return true;
    },

    async clearKey() {
      const slot = keySlot(get().provider);
      await secrets.delete(slot.key);
      await secrets.delete(slot.hint);
      set({ keyHint: null });
    },

    getKey: () => secrets.get(keySlot(get().provider).key),

    async testConnection() {
      const { provider, baseUrl, customModel } = get();
      const apiKey = await get().getKey();
      const transport = {
        timeoutMs: 15_000,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      };
      try {
        if (provider === 'openai') {
          // 本地模型可以不填 key。
          if (!baseUrl || !customModel) return { ok: false, kind: 'no_endpoint' };
          await checkOpenAICompatible(customModel, { baseUrl, apiKey, ...transport });
          return { ok: true };
        }
        if (!apiKey) return { ok: false, kind: 'no_key' };
        await checkModelAccess(get().model, { apiKey, ...transport });
        return { ok: true };
      } catch (e) {
        return { ok: false, kind: e instanceof AIHttpError ? e.kind : 'network' };
      }
    },
  }));
}
