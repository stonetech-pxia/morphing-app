import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PlanAboutSchema, PlanSchema } from './ai/types';
import { createMockAIProvider } from './ai/mock';
import { prepareOps, prepareSnapshot } from './change';
import { createDefaultWorkspace } from './defaults';
import { V4_CUSTOM_ASK, V4_DEFAULT_MERGE, V4_FIXED_NAME } from './fixtures/v4';
import { migrateWorkspace } from './migrate';
import { applyOps, OpSchema, type Op } from './ops';
import { MAX_SET_ALL, PICK_TOOLS, RecordToolSchema, ToolUseSchema } from './record-ops-schema';
import {
  allComponents,
  CollectionSchema,
  CURRENT_SCHEMA_VERSION,
  ReminderSchema,
  WorkflowStepSchema,
  WorkspaceConfigSchema,
  type Workflow,
  type WorkspaceConfig,
} from './schema';
import { createStarterWorkspace } from './starter';
import { fromV33, registry, v33Fixture } from './test-helpers';
import { validateWorkspace } from './validate';
import { defaultParams, initialParams, typesAlong, workflowProblems } from './workflow/check';
import {
  actionAccepts,
  isSourceAction,
  outputTypeOf,
  type ActionDefinition,
} from './workflow/contract';
import { REDACTED_FILE, REDACTED_TEXT, redactForAI } from './workflow/redact';
import { presetById } from './workflows/presets';

// Morph 的 18 条底线（AGENTS.md「底线」，创始人 2026-10-31 在对话里暂定）。每条一个 describe，测行为，
// 不测实现细节。要在 App 里才测得到的（发给 AI 的请求、记录、文件、渲染）在
// apps/mobile/src/__tests__/invariants-test.tsx 和 invariants-files-test.ts；已经有专门测试的，这里写明在哪里。
// 测出真的违反时不改代码：用 it.fails 标出来，注释写「违反底线 N，待创始人决定：…」。

const REPO = join(__dirname, '..', '..', '..');
const SENTINEL = 'SENTINEL-私密-7f3a';

const V33_NAMES = readdirSync(join(__dirname, 'fixtures', 'v33'))
  .filter((f) => f.endsWith('.json') && !f.startsWith('coverage-'))
  .map((f) => f.slice(0, -'.json'.length));
const V34_NAMES = ['habits', 'calendar', 'tasks', 'todo'];

const v34Fixture = (name: string): WorkspaceConfig =>
  JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'v34', `${name}.json`), 'utf8'),
  ) as WorkspaceConfig;

/** 测试用的全部配置：v33 代码存下来的（默认、新用户、模版、样板、评测 setup）迁移后的，加上 v34 的范围模版。 */
const CONFIGS: [string, WorkspaceConfig][] = [
  ...V33_NAMES.map((n): [string, WorkspaceConfig] => [n, fromV33(v33Fixture(n))]),
  ...V34_NAMES.map((n): [string, WorkspaceConfig] => [`v34-${n}`, v34Fixture(n)]),
];

/** 14 个修改操作的名字（按 ops-schema.ts 里的顺序）。 */
const OP_NAMES = [
  ...readFileSync(join(__dirname, 'ops-schema.ts'), 'utf8').matchAll(/op: z\.literal\('(\w+)'\)/g),
].map((m) => m[1]!);

const ctx = { registry, locale: 'zh' as const, now: new Date(2026, 9, 31, 9, 0) };

/** 仓库里的源文件（不含测试、生成的、node_modules）。 */
function sourceFiles(dir: string, exts = ['.ts', '.tsx']): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path, exts));
    else if (exts.some((e) => name.endsWith(e)) && !/\.test\.tsx?$|-test\.tsx?$/.test(name))
      out.push(path);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 数据和隐私
// ---------------------------------------------------------------------------------------------

describe('底线 1：用户的数据永远不离开手机', () => {
  // 真正的请求（自带 key、Morph 服务器、收件页面）在 mobile 的 invariants-test.tsx 里用哨兵字符串测。

  it('the app has no telemetry, crash-report or analytics library', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'apps', 'mobile', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const tracking =
      /sentry|bugsnag|crashlytics|firebase|analytics|amplitude|segment|mixpanel|posthog|datadog|newrelic|insights|expo-updates/i;
    expect(Object.keys(pkg.dependencies).filter((d) => tracking.test(d))).toEqual([]);
  });

  it('every network call in the app code is one of the allowed kinds (AI, downloads, the need button)', () => {
    // 新加一个联网的地方，这个测试就会失败：先确认它不带数据内容（底线 1）、不是离线功能必需的（底线 13），
    // 再加进下面的清单，并在 DECISIONS 里写明。
    const ALLOWED: Record<string, string> = {
      'packages/planner/src/http.ts': 'AI 修改：自带 key 调 Claude',
      'packages/planner/src/openai.ts': 'AI 修改：自带 key 调 OpenAI 兼容接口',
      'packages/planner/src/relay.ts': 'AI 修改：经 Morph 服务器转发（D-193）',
      'apps/mobile/src/workspace/remote-ai.ts': '「把这个需求告诉我们」（D-189）：只发用户那句话',
      'apps/mobile/src/tool-download/expo-tool-fs.ts': '下载工具（D-177）：目录和工具文件',
      'apps/mobile/src/tool-download/store.ts':
        '下载工具：经 expo-tool-fs 取目录（每天最多一次）和工具',
      'apps/mobile/src/packs/expo-pack-fs.ts': '下载扩展包（模型、识别语言）',
    };
    const NETWORK =
      /\bfetch\(|fetchImpl\(|XMLHttpRequest|new WebSocket|downloadFileAsync|createDownloadResumable|downloadAsync\(/;
    const found = [
      ...sourceFiles(join(REPO, 'apps', 'mobile', 'src')),
      ...sourceFiles(join(REPO, 'packages', 'core', 'src')),
      ...sourceFiles(join(REPO, 'packages', 'planner', 'src')),
    ]
      .filter((f) => !f.includes(`${join('src', 'test-utils')}`))
      // 扩展包页面里叫 fetch 的方法是向 App 要本机的字节（BinaryDataFactory），不联网。
      .filter((f) => !f.endsWith(join('packs', 'pages', 'pdfview.ts')))
      .filter((f) => NETWORK.test(readFileSync(f, 'utf8')))
      .map((f) => relative(REPO, f).split('\\').join('/'));
    expect(found.sort()).toEqual(Object.keys(ALLOWED).sort());
  });
});

describe('底线 2：AI 永远看不到数据内容', () => {
  // 发出去的请求（含收件页面、草稿聊天、两种 AI）在 mobile 的 invariants-test.tsx 里用哨兵字符串测；
  // 这里测 core 里决定「发什么」的两处。

  it('the inbox context sent to AI is only kinds and counts: names, sizes and contents do not fit', () => {
    expect(
      PlanAboutSchema.safeParse({ kind: 'shared', images: 1, pdfs: 0, others: 0 }).success,
    ).toBe(true);
    for (const extra of [
      { names: ['a.pdf'] },
      { size: 1000 },
      { text: SENTINEL },
      { files: [{ name: 'a.pdf' }] },
    ])
      expect(
        PlanAboutSchema.safeParse({ kind: 'shared', images: 1, pdfs: 0, others: 0, ...extra })
          .success,
      ).toBe(false);
  });

  it('text the user typed into quick-action steps (watermark, stamp …) is replaced before the config goes to AI', () => {
    const base = createDefaultWorkspace('zh');
    let hidden = 0;
    const steps = [...registry.actions.values()]
      .filter((a) => a.fields.some((f) => f.private))
      .map((a, i) => {
        const params: Record<string, unknown> = {};
        for (const f of a.fields.filter((x) => x.private)) {
          params[f.key] = `${SENTINEL}-${i}-${f.key}`;
          hidden++;
        }
        return { id: `s${i}`, action: a.id, params };
      });
    expect(hidden).toBeGreaterThan(0);
    const config = {
      ...base,
      tools: [...base.tools, { id: 'qa', kind: 'quickAction', name: 'x', steps }],
    } as WorkspaceConfig;
    const sent = JSON.stringify(redactForAI(config, registry));
    expect(sent).not.toContain(SENTINEL);
    expect(sent.split(REDACTED_TEXT).length - 1).toBe(hidden);
  });
});

describe('底线 3：AI 永远不碰文件', () => {
  it('the 14 changes AI can make are all changes to the configuration; none reads, writes, moves or deletes a file', () => {
    expect(OP_NAMES).toEqual([
      'addData',
      'updateData',
      'removeData',
      'moveData',
      'addContainer',
      'updateContainer',
      'removeContainer',
      'moveContainer',
      'addTool',
      'updateTool',
      'removeTool',
      'moveTool',
      'setTheme',
      'setPackage',
    ]);
    for (const op of [
      { op: 'deleteFile', file: 'abcdef12' },
      { op: 'moveFile', file: 'abcdef12', to: 'x' },
      { op: 'writeFile', name: 'a.txt', text: 'x' },
      { op: 'readFile', file: 'abcdef12' },
    ])
      expect(OpSchema.safeParse(op).success).toBe(false);
  });

  it('applying changes is pure: the result is a new configuration and the input is untouched', () => {
    for (const [, config] of CONFIGS.slice(0, 6)) {
      const before = JSON.stringify(config);
      const first = config.data.tables[0];
      if (!first) continue;
      const result = applyOps(config, [{ op: 'removeData', table: first.id }], ctx);
      expect(JSON.stringify(config)).toBe(before);
      expect(Object.keys(result).sort()).toEqual(
        result.ok ? ['config', 'notes', 'ok'] : ['error', 'ok'],
      );
    }
  });

  it('a file slot that AI adds starts empty: the user picks the file (prompt rule; the store-level check is in mobile)', () => {
    // 结构允许 {file: null}（空的文件位）；指向一个文件的 ID 只能由用户选（mobile 的 invariants-test.tsx 测 AI 那一路）。
    const config = createDefaultWorkspace('zh');
    const ok = prepareOps(
      config,
      [
        {
          op: 'addContainer',
          page: 'home',
          block: { id: 'slot', look: 'entry', show: { title: '合同' }, opens: { file: null } },
        },
      ],
      ctx,
    );
    expect(ok.ok ? [] : ok.issues).toEqual([]);
  });

  // 创始人 2026-10-31（对话）：AI 的修改一律不能写文件引用；文件 ID 不再发给 AI。
  describe('only the user picks a file: AI changes never write a reference to one', () => {
    const A = 'useraaaa01';
    const B = 'userbbbb02';
    /** 首页上一个指向 A 的文件位、一张指向 B 的图片（带图片背景），首页的背景也是 B。 */
    function withFiles(): WorkspaceConfig {
      const r = applyOps(
        createDefaultWorkspace('zh'),
        [
          {
            op: 'addContainer',
            page: 'home',
            block: { id: 'slot', look: 'entry', show: { title: '合同' }, opens: { file: A } },
          },
          {
            op: 'addContainer',
            page: 'home',
            block: { id: 'pic', look: 'image', show: { asset: B, aspect: 'wide', fit: 'cover' } },
          },
          {
            op: 'updateContainer',
            page: 'home',
            changes: { backdrop: { overlay: 'medium', assetId: B } },
          },
        ],
        ctx,
      );
      if (!r.ok) throw new Error(r.error);
      return r.config;
    }
    const ai = { ...ctx, fromAI: true };

    it.each<[string, unknown[]]>([
      [
        'pointing a file slot at another file',
        [
          {
            op: 'updateContainer',
            page: 'home',
            block: 'slot',
            changes: { opens: { file: B } },
          },
        ],
      ],
      [
        'adding a file slot that already points at a file',
        [
          {
            op: 'addContainer',
            page: 'home',
            block: { id: 'slot2', look: 'entry', show: { title: 'x' }, opens: { file: A } },
          },
        ],
      ],
      [
        'adding an image of a user file',
        [
          {
            op: 'addContainer',
            page: 'home',
            block: { id: 'pic2', look: 'image', show: { asset: B, aspect: 'wide', fit: 'cover' } },
          },
        ],
      ],
      [
        'changing the photo of an image',
        [{ op: 'updateContainer', page: 'home', block: 'pic', changes: { show: { asset: A } } }],
      ],
      [
        'putting a user file behind a page',
        [
          {
            op: 'updateContainer',
            page: 'home',
            changes: { backdrop: { overlay: 'light', assetId: A } },
          },
        ],
      ],
    ])('%s is refused', (_name, ops) => {
      const r = prepareOps(withFiles(), ops, ai);
      expect(r.ok).toBe(false);
      // 用户自己在长按编辑里选文件，走的是同一个 prepareOps（不带 fromAI），照常能存。
      expect(prepareOps(withFiles(), ops, ctx).ok).toBe(true);
    });

    it('clearing a file slot and moving or restyling a block with a file still work', () => {
      const config = withFiles();
      for (const ops of [
        [
          {
            op: 'updateContainer',
            page: 'home',
            block: 'slot',
            changes: { opens: { file: null } },
          },
        ],
        [{ op: 'updateContainer', page: 'home', block: 'pic', changes: { show: { asset: null } } }],
        [{ op: 'updateContainer', page: 'home', changes: { backdrop: null } }],
        [
          {
            op: 'updateContainer',
            page: 'home',
            block: 'pic',
            changes: { show: { caption: '图' } },
          },
        ],
        [{ op: 'moveContainer', page: 'home', block: 'slot', toIndex: 0 }],
        [{ op: 'removeContainer', page: 'home', block: 'pic' }],
      ]) {
        const r = prepareOps(config, ops, ai);
        expect(r.ok ? [] : r.issues).toEqual([]);
      }
    });

    it('AI sees a placeholder instead of the file IDs, and handing the placeholder back keeps the file', () => {
      const config = withFiles();
      const sent = JSON.stringify(redactForAI(config, registry));
      expect(sent).not.toContain(A);
      expect(sent).not.toContain(B);
      expect(sent).toContain(REDACTED_FILE);
      const r = prepareOps(
        config,
        [
          {
            op: 'updateContainer',
            page: 'home',
            block: 'slot',
            changes: { opens: { file: REDACTED_FILE }, show: { title: '租房合同' } },
          },
        ],
        ai,
      );
      expect(r.ok ? [] : r.issues).toEqual([]);
      if (r.ok) expect(JSON.stringify(r.after)).toContain(A);
    });
  });
});

describe('底线 4：原件永远不移动、不删除', () => {
  // 文件平台（expo-platform.ts）的删除和移动只碰运行目录、选择器副本：mobile 的 invariants-files-test.ts。
  it('the configuration can only point at a file by an opaque id; it has no place for a path or a content:// uri', () => {
    const config = createDefaultWorkspace('zh');
    for (const file of ['content://media/external/images/1', 'file:///DCIM/a.jpg', '/var/a.pdf']) {
      const r = prepareOps(
        config,
        [
          {
            op: 'addContainer',
            page: 'home',
            block: { id: 'slot', look: 'entry', show: { title: 'x' }, opens: { file } },
          },
        ],
        ctx,
      );
      expect(r.ok).toBe(false);
    }
  });
});

describe('底线 5：改 App 永远不删数据', () => {
  // 记录在数据库里、不在配置里：removeData、恢复旧版本之后记录都还在，见 mobile 的 invariants-test.tsx。

  it('records have no place in the configuration: a table or a config carrying entries is rejected', () => {
    const config = createDefaultWorkspace('zh');
    expect(
      WorkspaceConfigSchema.safeParse({ ...config, records: [{ id: 'r', values: {} }] }).success,
    ).toBe(false);
    expect(
      CollectionSchema.safeParse({
        id: 't',
        name: 'T',
        fields: [{ id: 'a', name: 'A', type: 'text' }],
        records: [{ a: SENTINEL }],
      }).success,
    ).toBe(false);
  });

  it('no change AI can make deletes entries: removing a table or a field only changes the configuration', () => {
    // 能删记录的只有用户在「设置 → 数据」里亲手点的永久删除和记录页的删除（mobile）。
    expect(OP_NAMES.filter((n) => /record|purge|clear|delete/i.test(n))).toEqual([]);
    const config = v34Fixture('tasks');
    const result = applyOps(config, [{ op: 'removeData', table: 'tasks' }], ctx);
    // 移除表的结果只有配置（和给草稿的说明），没有要执行的删除。
    if (result.ok) expect(Object.keys(result).sort()).toEqual(['config', 'notes', 'ok']);
  });
});

// ---------------------------------------------------------------------------------------------
// AI 的权限
// ---------------------------------------------------------------------------------------------

describe('底线 6：AI 只改 App，不替用户办事（D-113）', () => {
  it('an AI reply is changes, "go back one version" or a refusal: there is no reply that runs a tool or answers', () => {
    for (const reply of [
      { kind: 'run', tool: 'pdf-merge' },
      { kind: 'answer', text: 'Dear …' },
      { kind: 'ops', ops: [{ op: 'runTool', tool: 'pdf-merge' }] },
      { kind: 'ops', ops: [{ op: 'addData', table: 't' }], answer: 'hi' },
    ])
      expect(PlanSchema.safeParse(reply).success).toBe(false);
  });

  it('the built-in AI turns down errands (write an email, summarize a file) and does nothing', async () => {
    const ai = createMockAIProvider();
    for (const input of ['帮我写一封请假邮件', '总结一下这个文件']) {
      const plan = await ai.plan(input, {
        config: createDefaultWorkspace('zh'),
        registry,
        locale: 'zh',
      });
      expect(plan.kind).toBe('reject');
    }
  });
});

describe('底线 7：每次修改先进草稿，确认才生效，能撤销', () => {
  // 草稿、确认、撤销、改动记录在 App 里（mobile 的 invariants-test.tsx、workspace-store-test.ts）。
  it('an old version from the change history always opens again (every frozen config is a valid snapshot)', () => {
    for (const [name, config] of CONFIGS) {
      const r = prepareSnapshot(config, registry);
      expect({ name, issues: r.ok ? [] : r.issues }).toEqual({ name, issues: [] });
    }
  });
});

describe('底线 8：AI 改不了系统层', () => {
  it('Settings (with the AI page and the change history behind it) always stays reachable', () => {
    const config = createDefaultWorkspace('zh');
    for (const nav of [
      { bar: ['page:home', 'ai'], floating: [] },
      { bar: ['page:home'] },
      { floating: [] },
    ]) {
      const r = prepareOps(config, [{ op: 'updateContainer', nav }], ctx);
      // 要么拒绝，要么「设置」被放回浮动入口。
      if (r.ok) expect([...r.after.nav.bar, ...r.after.nav.floating]).toContain('settings');
    }
    const without = { ...config, nav: { bar: ['page:home' as const], floating: [] } };
    expect(validateWorkspace(without, registry).ok).toBe(false);
  });

  it('there is no change that reaches the AI page, drafts, history, settings or permissions', () => {
    for (const op of [
      { op: 'updateContainer', page: 'settings', changes: { title: 'x' } },
      { op: 'removeContainer', page: 'ai' },
      { op: 'removeContainer', page: 'history' },
      { op: 'setSettings', ai: 'off' },
      { op: 'updateHistory', keep: 0 },
      { op: 'setPermission', camera: true },
    ]) {
      const r = prepareOps(createDefaultWorkspace('zh'), [op], ctx);
      expect({ op, ok: r.ok }).toEqual({ op, ok: false });
    }
  });

  it('a theme that hides Settings (unreadable colors) is rejected', () => {
    const r = prepareOps(
      createDefaultWorkspace('zh'),
      [{ op: 'setTheme', colors: { background: '#ffffff', text: '#fefefe' } }],
      ctx,
    );
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------------------------

describe('底线 9：工具不能触发工具；没有分支、循环', () => {
  // 工具不触发工具：relation-rules.test.ts「rule 13」（提醒没有步骤、done 不能引用工具、步骤不能是快捷操作）。
  it('a step is one catalog action with parameters: no condition, jump, loop or call', () => {
    for (const extra of [
      { if: { field: 'a', op: 'eq', value: 1 } },
      { goto: 's1' },
      { repeat: 3 },
      { forEach: 'files' },
      { then: 'other-quick-action' },
      { runs: 'pdf-merge' },
    ])
      expect(
        WorkflowStepSchema.safeParse({ id: 's', action: 'pdf.merge', params: {}, ...extra })
          .success,
      ).toBe(false);
  });

  it('a one-tap record tool is one of five fixed kinds and cannot chain another tool', () => {
    for (const bad of [
      { do: 'run', table: 't', tool: 'x' },
      { do: 'create', table: 't', then: { do: 'set', table: 't', field: 'a', value: 1 } },
    ])
      expect(RecordToolSchema.safeParse(bad).success).toBe(false);
  });
});

describe('底线 10：数据离开 App 只能由用户每次亲手点', () => {
  // relation-rules.test.ts「rule 14」：时间触发的工具只打开、不运行；分享、导出只能是快捷操作的步骤。
  it('a tool on a block cannot share, export or save to Files', () => {
    for (const action of ['out.share', 'out.saveToFolder', 'out.saveToPhotos', 'out.print'])
      expect(ToolUseSchema.safeParse({ as: 'button', label: 'x', action }).success).toBe(false);
  });

  it('a reminder cannot carry a step', () => {
    expect(
      ReminderSchema.safeParse({
        id: 'r',
        kind: 'reminder',
        title: 'x',
        enabled: true,
        when: { every: 'day', at: '09:00' },
        opens: 'page:home',
        steps: [{ id: 's', action: 'out.share', params: {} }],
      }).success,
    ).toBe(false);
  });
});

describe('底线 11：写数据的操作都能挽回；不容易改回去的显示撤销；批量修改一定先问', () => {
  // 一键记录的撤销、setAll 先问、新建到另一张表的撤销：mobile 的 record-actions-test.tsx；打勾、表单添加、删除：
  // mobile 的 invariants-test.tsx。
  it('a bulk change has no setting that skips asking first', () => {
    const base = { do: 'setAll', table: 't', field: 'a', value: true };
    expect(RecordToolSchema.safeParse(base).success).toBe(true);
    for (const skip of [{ confirm: false }, { ask: false }, { ask: 'none' }, { silent: true }])
      expect(RecordToolSchema.safeParse({ ...base, ...skip }).success).toBe(false);
  });

  it('setAll is capped at 200 entries', () => {
    const set = (n: number) =>
      RecordToolSchema.safeParse({ do: 'setAll', table: 't', field: 'a', value: true, max: n });
    // 上限是常量，配置里写不进别的数。
    expect(MAX_SET_ALL).toBe(200);
    expect(set(1000).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 兼容
// ---------------------------------------------------------------------------------------------

describe('底线 12：旧的永远能打开', () => {
  // 迁移不丢东西：migrate-v34.test.ts（每份冻结配置的 ID 都在、M1–M8）、v34-equivalence.test.ts（迁移前后算出的
  // 数据一样）、migrate.test.ts（每一步）。这里把每一份冻结的旧配置从头升到现在。
  it.each(V33_NAMES)('frozen v33 config %s opens as a valid current config', (name) => {
    const r = prepareSnapshot(v33Fixture(name), registry);
    expect(r.ok ? [] : r.issues).toEqual([]);
  });

  it.each([
    ['V4_DEFAULT_MERGE', V4_DEFAULT_MERGE],
    ['V4_FIXED_NAME', V4_FIXED_NAME],
    ['V4_CUSTOM_ASK', V4_CUSTOM_ASK],
  ])('the real v4 snapshot %s opens as a valid current config', (_name, raw) => {
    const r = prepareSnapshot(raw, registry);
    expect(r.ok ? [] : r.issues).toEqual([]);
  });

  it('migrating a current config changes nothing', () => {
    for (const [, config] of CONFIGS) {
      const r = migrateWorkspace(structuredClone(config));
      expect(r.ok && r.config).toEqual(config);
    }
    expect(CURRENT_SCHEMA_VERSION).toBe(34);
  });
});

describe('底线 13：不联网也能用', () => {
  // 联网的地方只有 AI、下载、需求按钮：上面「底线 1」的清单测试。离线时原生模块（ML Kit、翻译、语音）的
  // 行为只能在真机上测，见 INVARIANTS_AUDIT.md。
  it('the core and planner packages call the network only to reach the AI', () => {
    const files = [
      ...sourceFiles(join(REPO, 'packages', 'core', 'src')),
      ...sourceFiles(join(REPO, 'packages', 'planner', 'src')),
    ].filter((f) => /\bfetch\(|fetchImpl\(/.test(readFileSync(f, 'utf8')));
    expect(files.map((f) => relative(REPO, f).split('\\').join('/')).sort()).toEqual([
      'packages/planner/src/http.ts',
      'packages/planner/src/openai.ts',
      'packages/planner/src/relay.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 容器、工具、数据之间
// ---------------------------------------------------------------------------------------------

describe('底线 14：数据只有一份，只在数据里', () => {
  it('a computed field has no stored value', () => {
    const table = (field: object) => ({
      id: 't',
      name: 'T',
      fields: [{ id: 'n', name: 'N', type: 'number' }, field],
    });
    const formula = { id: 'f', name: 'F', type: 'formula', expression: '{n} * 2' };
    expect(CollectionSchema.safeParse(table(formula)).success).toBe(true);
    expect(CollectionSchema.safeParse(table({ ...formula, value: 4 })).success).toBe(false);
    expect(CollectionSchema.safeParse(table({ ...formula, values: [4] })).success).toBe(false);
  });
});

describe('底线 15：看永远不会改', () => {
  // 渲染每个模版、样板页面时数据库零写入：mobile 的 invariants-test.tsx。
  it('reading data is a pure function of the configuration and the entries', () => {
    // source.ts 的读法不收写入的回调；这里检查它导出的读函数都不接受 repo（静态检查）。
    const text = readFileSync(join(__dirname, 'source.ts'), 'utf8');
    expect(text).not.toMatch(/insertRecord|updateRecord|deleteRecord|setMeta|commitRevision/);
  });
});

describe('底线 16：每次写入都来自用户的一次操作', () => {
  // 提醒到点只弹通知、没有后台写入：relation-rules.test.ts「rule 13」（提醒没有步骤）；
  // 启动、渲染、排提醒时零写入：mobile 的 invariants-test.tsx。
  it('the code that schedules reminders cannot write entries', () => {
    const text = readFileSync(join(__dirname, 'reminders.ts'), 'utf8');
    expect(text).not.toMatch(/insertRecord|updateRecord|deleteRecord/);
  });
});

describe('底线 17：用户看到的就是被改的（关系规则 12）', () => {
  // record-ops.test.ts「relation rule 12」：块上的工具只写块读的那张表，或经 $row / $record 关联到达的那条；
  // relation-rules.test.ts：提醒的 done 只写这一条。mobile 的 record-actions-test.tsx 测执行时写的是哪张表。
  it('every one-tap tool in every frozen config writes a table the block reads, or a table linked back to it', () => {
    for (const [name, config] of CONFIGS) {
      const r = validateWorkspace(config, registry);
      expect({ name, issues: r.ok ? [] : r.issues.map((i) => i.message) }).toEqual({
        name,
        issues: [],
      });
    }
  });
});

// ---- 底线 18 用的：不靠 validate 的、独立的引用检查 ----

type Json = Record<string, unknown>;

/** 配置里指向不存在的表、字段、工具、页面、工具包的引用。 */
function danglingRefs(config: WorkspaceConfig): string[] {
  const tables = new Map(config.data.tables.map((t) => [t.id, new Set(t.fields.map((f) => f.id))]));
  const pages = new Set(config.containers.pages.map((p) => p.id));
  const tools = new Set(config.tools.map((t) => t.id));
  // 内置的快捷操作（D-236，不用添加就能运行）和两个选择器也是能引用的工具。
  const toolOk = (id: string) =>
    tools.has(id) || presetById(id) !== undefined || (PICK_TOOLS as readonly string[]).includes(id);
  const packages = new Set(config.packages.map((p) => p.id));
  const out: string[] = [];
  const tableOk = (id: string) => id === '$files' || tables.has(id);
  const target = (s: string, at: string) => {
    const m = /^(page|tool|package):(.+)$/.exec(s);
    if (!m) return;
    const [, kind, id] = m;
    const ok = kind === 'page' ? pages.has(id!) : kind === 'tool' ? toolOk(id!) : packages.has(id!);
    if (!ok) out.push(`${at}: ${s}`);
  };
  const walk = (v: unknown, at: string) => {
    if (typeof v === 'string') return target(v, at);
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
    if (!v || typeof v !== 'object') return;
    const o = v as Json;
    if (typeof o.table === 'string' && !tableOk(o.table)) out.push(`${at}.table: ${o.table}`);
    if (typeof o.table === 'string' && tables.has(o.table)) {
      const fields = tables.get(o.table)!;
      for (const key of ['field', 'via'])
        if (
          typeof o[key] === 'string' &&
          !fields.has(o[key]) &&
          !/^(createdAt|updatedAt|name|size)$/.test(o[key])
        )
          out.push(`${at}.${key}: ${o.table}.${o[key]}`);
    }
    if (typeof o.of === 'string' && !tables.has(o.of)) out.push(`${at}.of: ${o.of}`);
    // 块上引用一个快捷操作：{tool: "<id>"}（不是 kind 为 reminder 的那种定义）。
    if (typeof o.tool === 'string' && !('kind' in o) && !toolOk(o.tool))
      out.push(`${at}.tool: ${o.tool}`);
    for (const [k, x] of Object.entries(o)) walk(x, `${at}.${k}`);
  };
  walk(config.containers, 'containers');
  walk(config.nav, 'nav');
  walk(config.tools, 'tools');
  walk(config.data, 'data');
  for (const id of config.nav.phoneHomeScreen ?? [])
    if (!tools.has(id)) out.push(`nav.phoneHomeScreen: ${id}`);
  // 快捷操作的步骤：参数里的表（collectionId），和记录生成 PDF 列出的字段（属于前面读取记录的那张表）。
  for (const wf of config.tools) {
    if (wf.kind !== 'quickAction') continue;
    let read: string | null = null;
    for (const step of wf.steps) {
      const at = `tools.${wf.id}.${step.id}`;
      const table = step.params.collectionId;
      if (typeof table === 'string' && !tables.has(table)) out.push(`${at}.collectionId: ${table}`);
      if (step.action === 'in.records') read = typeof table === 'string' ? table : null;
      if (Array.isArray(step.params.fields) && read && tables.has(read))
        for (const f of step.params.fields as string[])
          if (!tables.get(read)!.has(f) && !/^(createdAt|updatedAt)$/.test(f))
            out.push(`${at}.fields: ${read}.${f}`);
    }
  }
  return out;
}

/** 一份配置里每样能删的东西的删除操作。 */
function removals(config: WorkspaceConfig): Op[] {
  const ops: Op[] = [];
  for (const t of config.data.tables) {
    ops.push({ op: 'removeData', table: t.id });
    for (const f of t.fields) ops.push({ op: 'removeData', table: t.id, field: f.id });
  }
  for (const p of config.containers.pages) {
    ops.push({ op: 'removeContainer', page: p.id });
    for (const c of allComponents(p)) ops.push({ op: 'removeContainer', page: p.id, block: c.id });
  }
  for (const t of config.tools) {
    ops.push({ op: 'removeTool', tool: t.id });
    if (t.kind === 'quickAction')
      for (const s of t.steps) ops.push({ op: 'removeTool', tool: t.id, step: s.id });
  }
  for (const p of config.packages) ops.push({ op: 'setPackage', package: p.id, do: 'remove' });
  return ops;
}

/** 确定的伪随机数。 */
function rng(seed: number) {
  let h = seed >>> 0 || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

describe('底线 18：配置永远自洽', () => {
  it('every frozen config starts without a dangling reference (the checker itself)', () => {
    for (const [name, config] of CONFIGS)
      expect({ name, refs: danglingRefs(config) }).toEqual({ name, refs: [] });
    // 检查器本身认得出坏引用（包括快捷操作步骤里的表和字段）。
    const broken = structuredClone(v34Fixture('tasks'));
    broken.nav.bar = ['page:nope', 'settings'];
    expect(danglingRefs(broken)).toEqual(['nav.bar[0]: page:nope']);
    const steps = structuredClone(fromV33(v33Fixture('sample-expense-helper-zh')));
    steps.data.tables = [];
    expect(danglingRefs(steps).filter((r) => r.startsWith('tools.')).length).toBeGreaterThan(0);
  });

  it.each(CONFIGS.map(([n]) => n))(
    '%s: removing a table or field that quick-action steps use cleans up those steps instead of being refused for them',
    (name) => {
      const config = CONFIGS.find(([n]) => n === name)![1];
      for (const op of removals(config).filter((o) => o.op === 'removeData')) {
        const r = prepareOps(config, [op], ctx);
        if (r.ok) continue;
        // 别的原因（被别的表引用、表单问的字段）照常拒绝；不能因为快捷操作的步骤拒绝。
        expect({ op, issues: r.issues.filter((i) => /^[\w-]+\/[\w-]+: /.test(i)) }).toEqual({
          op,
          issues: [],
        });
      }
    },
  );

  it.each(CONFIGS.map(([n]) => n))(
    '%s: removing any one table, field, page, block, tool, step or package either cleans up or is refused',
    (name) => {
      const config = CONFIGS.find(([n]) => n === name)![1];
      for (const op of removals(config)) {
        const r = prepareOps(config, [op], ctx);
        if (r.ok) expect({ op, refs: danglingRefs(r.after) }).toEqual({ op, refs: [] });
        else expect(r.issues.length).toBeGreaterThan(0);
      }
    },
  );

  it.each(CONFIGS.map(([n]) => n))(
    '%s: random sequences of removals keep the config valid after every step',
    (name) => {
      let config = CONFIGS.find(([n]) => n === name)![1];
      const next = rng(name.length * 7919 + name.charCodeAt(0));
      for (let step = 0; step < 12; step++) {
        const ops = removals(config);
        if (ops.length === 0) break;
        const op = ops[Math.floor(next() * ops.length)]!;
        const r = prepareOps(config, [op], ctx);
        if (!r.ok) continue;
        expect({ op, refs: danglingRefs(r.after) }).toEqual({ op, refs: [] });
        const valid = validateWorkspace(r.after, registry);
        expect(valid.ok).toBe(true);
        config = r.after;
      }
    },
  );

  it('starting points (new user, default) are self-consistent', () => {
    for (const config of [createStarterWorkspace('zh', registry), createDefaultWorkspace('en')])
      expect(danglingRefs(config)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 用户要的事
// ---------------------------------------------------------------------------------------------

describe('底线 19：用户要的事都能做到', () => {
  // 创始人 2026-10-31（对话）：快捷操作处理文件，最后交给页面（新记录表单、记录页）由用户确认保存；类型对得上的
  // 动作都能串；AI 不能因为「不合理」拒绝做得到的组合（提示词那一半在 planner 的 prompt-baseline.test.ts）。
  // 还是直链，每步只拿上一步的输出（底线 9 不变）。
  const paramsOf = (a: ActionDefinition) => {
    const p = { ...(defaultParams(a) ?? initialParams(a)) };
    if ('collectionId' in p) p.collectionId = 'notes';
    return p;
  };

  const variants = (a: ActionDefinition) => {
    const base = paramsOf(a);
    const out = [base];
    for (const f of a.fields)
      if (f.kind === 'choice')
        for (const o of f.options ?? []) {
          const p = { ...base, [f.key]: o.value };
          if (a.params.safeParse(p).success) out.push(p);
        }
    return out;
  };

  it('any two catalog actions whose types fit chain into a quick action that passes the checks', () => {
    const actions = [...registry.actions.values()];
    const sources = actions.filter(isSourceAction);
    const problems: string[] = [];
    let pairs = 0;
    for (const a of actions) {
      // a 前面接一个能喂它的输入动作（a 本身是输入动作时它就是第一步）。
      // 输入动作的输出可能看参数（in.files 的 accept）：每个选项都试。
      const feed = isSourceAction(a)
        ? []
        : sources
            .flatMap((s) => variants(s).map((params) => ({ s, params })))
            .filter(({ s, params }) => {
              const out = outputTypeOf(s, params, null);
              return out !== null && actionAccepts(a, out);
            })
            .slice(0, 1)
            .map(({ s, params }) => ({ id: 'in', action: s.id, params }));
      if (!isSourceAction(a) && feed.length === 0) {
        problems.push(`${a.id}: no input action gives it something it accepts`);
        continue;
      }
      const head = [...feed, { id: 'a', action: a.id, params: paramsOf(a) }];
      const out = typesAlong(head, registry).at(-1);
      expect(out, a.id).toBeTruthy();
      for (const b of actions) {
        if (isSourceAction(b) || !actionAccepts(b, out!)) continue;
        const wf = {
          id: 'qa',
          kind: 'quickAction',
          name: 'x',
          steps: [...head, { id: 'next', action: b.id, params: paramsOf(b) }],
        } as Workflow;
        problems.push(...workflowProblems(wf, registry).map((p) => p.message));
        pairs++;
      }
    }
    expect(problems).toEqual([]);
    expect(pairs).toBeGreaterThan(1000);
  });
});
