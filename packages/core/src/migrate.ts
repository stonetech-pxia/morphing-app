import { CURRENT_SCHEMA_VERSION } from './schema';
import { DEFAULT_THEME } from './theme';

// Schema 迁移（§7E）：恢复旧快照时逐级升级到当前版本，然后再校验。
// 每次提升 CURRENT_SCHEMA_VERSION，都必须在 MIGRATIONS 中加入上一版本的迁移函数和测试。
// 只新增一种组件不提升版本号（D-254），见 schema.ts。

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

/** v8 → v9：新增工具宫格组件 toolGrid，图标多了 translate 和 note（D-181）；已有数据不需要改动，只提升版本号。 */
export const migrateV8toV9: Migration = (config) => ({ ...config, schemaVersion: 9 });

/** v9 → v10：新增文件选择入口；保持老用户页面原样。 */
export const migrateV9toV10: Migration = (config) => ({ ...config, schemaVersion: 10 });

/** v10 → v11：允许分类系统入口，保持老用户的首页原样。 */
export const migrateV10toV11: Migration = (config) => ({ ...config, schemaVersion: 11 });

/**
 * v11 → v12：入口卡片和快捷操作可以选样子，按钮可以带图标，主题多了图标底色，新增快捷操作列表组件（D-230）；
 * 已有数据不需要改动，只提升版本号。
 */
export const migrateV11toV12: Migration = (config) => ({ ...config, schemaVersion: 12 });

/** v12 → v13：统计组件可以按单选字段分组（D-248）；已有数据不需要改动，只提升版本号。 */
export const migrateV12toV13: Migration = (config) => ({ ...config, schemaVersion: 13 });

/** v13 → v14：新增图表组件 chart（D-249）；已有数据不需要改动，只提升版本号。 */
export const migrateV13toV14: Migration = (config) => ({ ...config, schemaVersion: 14 });

/** v14 → v15：数据表新增引用字段 link（D-250）；已有数据不需要改动，只提升版本号。 */
export const migrateV14toV15: Migration = (config) => ({ ...config, schemaVersion: 15 });

/** v15 → v16：新增提醒 reminders（D-251，可以不写，不写就是没有提醒）；只提升版本号。 */
export const migrateV15toV16: Migration = (config) => ({ ...config, schemaVersion: 16 });

/**
 * v16 → v17：按钮和快捷入口可以打开一个快捷操作 workflow:<id>（D-256，改了已有组件的结构，按 D-254 提升）；
 * 已有数据不需要改动，只提升版本号。
 */
export const migrateV16toV17: Migration = (config) => ({ ...config, schemaVersion: 17 });

/**
 * v17 → v18：卡片类组件的 style 和页面可以有图片背景 backdrop（D-258，改了已有结构，按 D-254 提升）；
 * 已有数据不需要改动，只提升版本号。
 */
export const migrateV17toV18: Migration = (config) => ({ ...config, schemaVersion: 18 });

/**
 * v18 → v19：快捷操作可以放到手机桌面 homeScreen（D-271，改了已有结构，按 D-254 提升）；
 * 已有的快捷操作都不在桌面上，不需要改动，只提升版本号。
 */
export const migrateV18toV19: Migration = (config) => ({ ...config, schemaVersion: 19 });

/**
 * v19 → v20：识别文字的语言可以选「自动」（D-278，改了已有动作的参数，按 D-254 提升）。
 * 文字识别工具装进来的两个快捷操作（ocr-photos、ocr-scan）存的是步骤副本，以前每次运行都问语言；
 * 只有和旧版生成的一模一样（用户没改过）时，把识别那一步改成自动、不再问。用户改过的不动。
 */
const OLD_OCR_STEPS: Record<string, (lang: string) => unknown[]> = {
  'ocr-photos': (lang) => [
    { id: 'pick', action: 'in.photos', params: { source: 'library', min: 1, max: 20 } },
    { id: 'read', action: 'ocr.recognize', params: { lang }, ask: ['lang'] },
  ],
  'ocr-scan': (lang) => [
    { id: 'shoot', action: 'in.photos', params: { source: 'scanner', min: 1, max: 10 } },
    { id: 'edges', action: 'scan.detect', params: {} },
    { id: 'read', action: 'ocr.recognize', params: { lang }, ask: ['lang'] },
  ],
};

export const migrateV19toV20: Migration = (config) => {
  const workflows = Array.isArray(config.workflows) ? config.workflows : [];
  return {
    ...config,
    schemaVersion: 20,
    workflows: workflows.map((w: unknown) => {
      const wf = w as { id?: unknown; toolId?: unknown; steps?: unknown[] };
      const old = typeof wf.id === 'string' ? OLD_OCR_STEPS[wf.id] : undefined;
      if (!old || wf.toolId !== 'ocr') return w;
      const same = ['chi_sim', 'fra', 'eng'].some(
        (lang) => JSON.stringify(wf.steps) === JSON.stringify(old(lang)),
      );
      if (!same) return w;
      return {
        ...wf,
        steps: wf.steps!.map((s) => {
          const step = s as { action?: unknown };
          return step.action === 'ocr.recognize'
            ? { id: 'read', action: 'ocr.recognize', params: { lang: 'auto' } }
            : s;
        }),
      };
    }),
  };
};

/**
 * v20 → v21：字段多了时间、日期时间、时长三种类型（D-279），公式能用新函数、引用别的公式、最长 500 字
 * （D-280、D-281）。已有的字段和公式都还是合法的，只提升版本号。
 */
export const migrateV20toV21: Migration = (config) => ({ ...config, schemaVersion: 21 });

/**
 * v21 → v22：统计有按顺序的聚合（连续天数等，D-284），时间段多了几种（D-285），配置可以有 calendar
 * （一天、一周从什么时候开始，D-286）；没有 calendar 就是原来的 0 点、周一，已有数据不需要改动，只提升版本号。
 */
export const migrateV21toV22: Migration = (config) => ({ ...config, schemaVersion: 22 });

/**
 * v22 → v23：字段多了查找、汇总、上一条三种类型（D-287–D-289），值都是算出来的、不存进记录。
 * 已有的字段都还是合法的，只提升版本号。
 */
export const migrateV22toV23: Migration = (config) => ({ ...config, schemaVersion: 23 });

/**
 * v23 → v24：字段多了日程（schedule，D-292、D-293），筛选多了 due（D-294）。已有的字段和筛选都还是合法的，
 * 只提升版本号。
 */
export const migrateV23toV24: Migration = (config) => ({ ...config, schemaVersion: 24 });

/**
 * v24 → v25：按钮多了 action、target 可以不写，记录列表多了 rowActions（一键记录操作，D-300–D-304）。
 * 已有的按钮都有 target，仍然合法，只提升版本号。
 */
export const migrateV24toV25: Migration = (config) => ({ ...config, schemaVersion: 25 });

/**
 * v25 → v26：记录列表多了月历外观和右侧字段的显示格式（D-305、D-306），统计多了目标和「和上一段比」
 * （D-307、D-308）。都是新的可选属性，已有配置照样合法，只提升版本号。
 */
export const migrateV25toV26: Migration = (config) => ({ ...config, schemaVersion: 26 });

/**
 * v26 → v27：记录列表多了大圆块 tiles 和看板 board 两种外观、看板分栏用的 groupField（D-311–D-314）。
 * 都是新的可选值，已有配置照样合法，只提升版本号。
 */
export const migrateV26toV27: Migration = (config) => ({ ...config, schemaVersion: 27 });

/**
 * v27 → v28：提醒多了按记录的日程排的 scheduleField 和它的 unless、done、snoozeMinutes（D-316–D-318）。
 * 都是新的可选值，已有配置照样合法，只提升版本号。
 */
export const migrateV27toV28: Migration = (config) => ({ ...config, schemaVersion: 28 });

/**
 * v28 → v29：统计和图表可以按引用字段分组（D-326），统计可以减去另一个合计（minus，D-327），
 * 一键操作的新建可以打开表单（form，D-328）。都是新的可选值，只提升版本号。
 */
export const migrateV28toV29: Migration = (config) => ({ ...config, schemaVersion: 29 });

/**
 * v29 → v30：日程的「一次」和 countEarly（D-330、D-331）、给一条记录用的页面（recordOf、recordList.opens、
 * "$record"，D-332）、快速添加表单的预设值和 smartDate（D-333、D-334）。都是新的可选值，只提升版本号。
 */
export const migrateV29toV30: Migration = (config) => ({ ...config, schemaVersion: 30 });

/** MIGRATIONS[n] 把 schemaVersion n 升级到 n + 1。 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: migrateV4toV5,
  5: migrateV5toV6,
  6: migrateV6toV7,
  7: migrateV7toV8,
  8: migrateV8toV9,
  9: migrateV9toV10,
  10: migrateV10toV11,
  11: migrateV11toV12,
  12: migrateV12toV13,
  13: migrateV13toV14,
  14: migrateV14toV15,
  15: migrateV15toV16,
  16: migrateV16toV17,
  17: migrateV17toV18,
  18: migrateV18toV19,
  19: migrateV19toV20,
  20: migrateV20toV21,
  21: migrateV21toV22,
  22: migrateV22toV23,
  23: migrateV23toV24,
  24: migrateV24toV25,
  25: migrateV25toV26,
  26: migrateV26toV27,
  27: migrateV27toV28,
  28: migrateV28toV29,
  29: migrateV29toV30,
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
