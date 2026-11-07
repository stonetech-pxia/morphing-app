import { applyOps } from './ops';
import { registryRevision, type Registry } from './registry';
import type { Locale, WorkspaceConfig } from './schema';
import { createStarterWorkspace, homeFileEntryOps } from './starter';

// 内置文字跟着界面语言显示：新用户的首页、工具箱、工具页和内设快捷操作的文字，是建立时按当时的语言
// 写进配置的。设置里改了语言以后，显示时把和某种语言的内置文字一字不差的换成新语言；用户自己改过的
// 不动。只在显示时换，不写配置（语言是设备偏好，不进配置和版本历史，D-459；底线 15）。

const LOCALES: readonly Locale[] = ['en', 'zh', 'fr'];

type Variants = Record<Locale, string>;

/** 三种语言的同一份东西按位置对齐，同一位置上三种语言写法不同的字符串就是一条内置文字。 */
function pairStrings(versions: readonly unknown[], out: Map<string, Variants | null>) {
  const [first] = versions;
  if (typeof first === 'string') {
    if (!versions.every((v) => typeof v === 'string')) return;
    const texts = versions as string[];
    if (texts.every((s) => s === first)) return;
    const variants = Object.fromEntries(LOCALES.map((l, i) => [l, texts[i]])) as Variants;
    for (const s of new Set(texts)) {
      const known = out.get(s);
      // 同一句话在不同地方翻法不同时，不知道该换成哪个，干脆不换。
      if (known === undefined) out.set(s, variants);
      else if (known && LOCALES.some((l) => known[l] !== variants[l])) out.set(s, null);
    }
    return;
  }
  if (Array.isArray(first)) {
    if (!versions.every((v) => Array.isArray(v) && v.length === first.length)) return;
    first.forEach((_, i) =>
      pairStrings(
        versions.map((v) => (v as unknown[])[i]),
        out,
      ),
    );
    return;
  }
  if (first && typeof first === 'object') {
    if (!versions.every((v) => v && typeof v === 'object' && !Array.isArray(v))) return;
    for (const key of Object.keys(first)) {
      pairStrings(
        versions.map((v) => (v as Record<string, unknown>)[key]),
        out,
      );
    }
  }
}

function starterWithEntries(locale: Locale, registry: Registry): WorkspaceConfig {
  const config = createStarterWorkspace(locale, registry);
  const applied = applyOps(config, homeFileEntryOps(config, locale), { registry, locale });
  return applied.ok ? applied.config : config;
}

const cache = new WeakMap<Registry, { revision: number; index: Map<string, Variants | null> }>();

function builtinIndex(registry: Registry): Map<string, Variants | null> {
  const cached = cache.get(registry);
  if (cached && cached.revision === registryRevision(registry)) return cached.index;
  const index = new Map<string, Variants | null>();
  pairStrings(
    LOCALES.map((l) => starterWithEntries(l, registry)),
    index,
  );
  for (const tool of registry.tools.values()) {
    pairStrings(
      LOCALES.map((l) => tool.name[l] ?? tool.name.en),
      index,
    );
    pairStrings(
      LOCALES.map((l) => tool.createPage(l)),
      index,
    );
    pairStrings(
      LOCALES.map((l) => tool.createWorkflows(l)),
      index,
    );
  }
  cache.set(registry, { revision: registryRevision(registry), index });
  return index;
}

/** 配置里的一段文字按界面语言显示：是内置文字时换成这种语言的写法，否则原样返回。 */
export function builtinText(text: string, locale: Locale, registry: Registry): string;
export function builtinText(
  text: string | undefined,
  locale: Locale,
  registry: Registry,
): string | undefined;
export function builtinText(
  text: string | undefined,
  locale: Locale,
  registry: Registry,
): string | undefined {
  if (!text) return text;
  return builtinIndex(registry).get(text)?.[locale] ?? text;
}
