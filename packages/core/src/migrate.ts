import { CURRENT_SCHEMA_VERSION } from './schema';
import { DEFAULT_THEME } from './theme';

// Schema 迁移（§7E）：恢复旧快照时逐级升级到当前版本，然后再校验。
// 每次提升 CURRENT_SCHEMA_VERSION，都必须在 MIGRATIONS 中加入上一版本的迁移函数和测试。

export type Migration = (config: Record<string, unknown>) => Record<string, unknown>;

/** v1 的默认主色；没改过主色的工作空间升级后换成新的默认风格（Clay）。 */
const V1_DEFAULT_PRIMARY = '#3B5BDB';

/**
 * v1 → v2：主题增加样式 token（字体、字号、圆角、疏密、卡片和导航栏样式），
 * 受保护元素从「AI + 历史」改为「设置」（设置页内固定提供 AI 修改和历史入口）。
 */
export const migrateV1toV2: Migration = (config) => {
  const theme = config.theme as { primaryColor: string; mode: string };
  const shell = config.shell as { nav: string[]; floating: string[] };
  const nav = [...shell.nav];
  const floating = [...shell.floating];
  if (!nav.includes('settings') && !floating.includes('settings')) {
    if (nav.length < 5) nav.push('settings');
    else if (floating.length < 3) floating.push('settings');
    else floating[floating.length - 1] = 'settings';
  }
  // v2 的页面可以有图标；首页补上首页图标，其他页面使用导航栏的默认图标。
  const pages = (config.pages as { id: string; icon?: string }[]).map((p) =>
    p.id === 'home' && p.icon === undefined ? { ...p, icon: 'home' } : p,
  );
  return {
    ...config,
    schemaVersion: 2,
    pages,
    theme: {
      ...DEFAULT_THEME,
      primaryColor:
        theme.primaryColor.toUpperCase() === V1_DEFAULT_PRIMARY
          ? DEFAULT_THEME.primaryColor
          : theme.primaryColor,
      mode: theme.mode,
    },
    shell: { nav, floating },
  };
};

/** v2 → v3：新增数据表结构 collections（记录本身不在配置里）。 */
export const migrateV2toV3: Migration = (config) => ({
  ...config,
  schemaVersion: 3,
  collections: [],
});

/** v3 → v4：新增图片组件、emoji 图标和富文本；已有数据不需要改动，只提升版本号。 */
export const migrateV3toV4: Migration = (config) => ({ ...config, schemaVersion: 4 });

interface V4Step {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

/**
 * v4 → v5：工作流步骤之间改为传递有类型的值（D-060，TOOLS_DESIGN §8）。
 * - pdf.selectFiles {min, max} → in.files {accept: 'pdf', min, max}
 * - ui.askFileName {defaultTemplate} + file.save {nameTemplate} → file.rename（每次运行时问）+ file.save {}
 * - 只有 file.save {nameTemplate}（已去掉询问）→ file.rename {template} + file.save {}
 */
export const migrateV4toV5: Migration = (config) => {
  const workflows = (config.workflows as { steps: V4Step[] }[]).map((wf) => {
    const ask = wf.steps.find((s) => s.action === 'ui.askFileName');
    const steps: Record<string, unknown>[] = [];
    for (const step of wf.steps) {
      switch (step.action) {
        case 'pdf.selectFiles':
          steps.push({
            id: step.id,
            action: 'in.files',
            params: { accept: 'pdf', min: step.params.min, max: step.params.max },
          });
          break;
        case 'ui.askFileName':
          steps.push({
            id: step.id,
            action: 'file.rename',
            params: { template: step.params.defaultTemplate },
            ask: ['template'],
          });
          break;
        case 'file.save':
          if (!ask) {
            steps.push({
              id: steps.some((s) => s.id === 'name') ? `${step.id}-name` : 'name',
              action: 'file.rename',
              params: { template: step.params.nameTemplate },
            });
          }
          steps.push({ id: step.id, action: 'file.save', params: {} });
          break;
        default:
          steps.push({ ...step });
      }
    }
    return { ...wf, steps };
  });
  return { ...config, schemaVersion: 5, workflows };
};

/** v5 → v6：主题新增第三色、深色模式颜色、页面背景和六种卡片样式；已有数据不需要改动，只提升版本号。 */
export const migrateV5toV6: Migration = (config) => ({ ...config, schemaVersion: 6 });

/**
 * v6 → v7：文件列表可以只列一大类文件（image/*、video/*、audio/*），图标多了 video 和 audio（D-140）；
 * 已有数据不需要改动，只提升版本号。
 */
export const migrateV6toV7: Migration = (config) => ({ ...config, schemaVersion: 7 });

/**
 * v7 → v8：数据表新增附件（file）和公式（formula）字段，快捷操作可以「记一笔」（D-187、D-188）；
 * 已有数据不需要改动，只提升版本号。
 */
export const migrateV7toV8: Migration = (config) => ({ ...config, schemaVersion: 8 });

/** MIGRATIONS[n] 把 schemaVersion n 升级到 n + 1。 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: migrateV4toV5,
  5: migrateV5toV6,
  6: migrateV6toV7,
  7: migrateV7toV8,
};

export type MigrateResult =
  { ok: true; config: unknown; fromVersion: number } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function migrateWorkspace(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): MigrateResult {
  if (!isRecord(raw) || !Number.isInteger(raw.schemaVersion)) {
    return { ok: false, error: 'missing schemaVersion' };
  }
  const fromVersion = raw.schemaVersion as number;
  if (fromVersion > targetVersion) {
    return { ok: false, error: `schemaVersion ${fromVersion} is newer than this app supports` };
  }
  let current: Record<string, unknown> = JSON.parse(JSON.stringify(raw));
  for (let v = fromVersion; v < targetVersion; v++) {
    const migration = migrations[v];
    if (!migration) return { ok: false, error: `no migration from schemaVersion ${v}` };
    try {
      current = migration(current);
    } catch (e) {
      return { ok: false, error: `migration from ${v} failed: ${String(e)}` };
    }
    if (current.schemaVersion !== v + 1) {
      return { ok: false, error: `migration from ${v} did not produce schemaVersion ${v + 1}` };
    }
  }
  return { ok: true, config: current, fromVersion };
}
