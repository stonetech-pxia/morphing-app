import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PlanAboutSchema, PlanSchema } from './ai/types';
import { createMockAIProvider } from './ai/mock';
import { prepareOps, prepareSnapshot } from './change';
import { createDefaultWorkspace } from './defaults';
import { defaultDeskTools } from './desk/tools';
import { V4_CUSTOM_ASK, V4_DEFAULT_MERGE, V4_FIXED_NAME } from './fixtures/v4';
import { perCurrencyText } from './data';
import { fieldLink } from './field-link';
import { fieldDefinition } from './fields';
import { en, enSingular } from './messages/en';
import { fr, frSingular } from './messages/fr';
import { zh } from './messages/zh';
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
import { planDocument } from './prefill/code-rules';
import { sampleOps } from './samples';
import { createStarterWorkspace } from './starter';
import { fromV33, registry, v33Fixture } from './test-helpers';
import { validateWorkspace } from './validate';
import { defaultParams, initialParams, typesAlong, workflowProblems } from './workflow/check';
import {
  actionAccepts,
  handedTypeOf,
  isSourceAction,
  outputTypeOf,
  type ActionDefinition,
} from './workflow/contract';
import { REDACTED_FILE, REDACTED_TEXT, redactForAI } from './workflow/redact';
import { presetById } from './workflows/presets';

// Tinkrum 的 19 条底线（AGENTS.md「底线」，创始人 2026-10-31 在对话里暂定，同一天改了 3、7、11、16，加了 19）。每条一个 describe，测行为，
// 不测实现细节。要在 App 里才测得到的（发给 AI 的请求、记录、文件、渲染）在
// apps/mobile/src/__tests__/invariants-test.tsx 和 invariants-files-test.ts；已经有专门测试的，这里写明在哪里。
// 测出真的违反时不改代码：用 it.fails 标出来，注释写「违反底线 N，待创始人决定：…」。

const REPO = join(__dirname, '..', '..', '..');
const SENTINEL = 'SENTINEL-私密-7f3a';

const V33_NAMES = readdirSync(join(__dirname, 'fixtures', 'v33'))
  .filter((f) => f.endsWith('.json') && !f.startsWith('coverage-'))
  .map((f) => f.slice(0, -'.json'.length));
const V34_NAMES = ['habits', 'calendar', 'tasks', 'todo'];

/** 存下来的是 v34，和读配置时一样升到现在的版本。 */
const v34Fixture = (name: string): WorkspaceConfig => {
  const r = migrateWorkspace(
    JSON.parse(readFileSync(join(__dirname, 'fixtures', 'v34', `${name}.json`), 'utf8')),
  );
  if (!r.ok) throw new Error(`fixture ${name}: ${r.error}`);
  return r.config as WorkspaceConfig;
};

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
  // 真正的请求（自带 key、Tinkrum 服务器、收件页面）在 mobile 的 invariants-test.tsx 里用哨兵字符串测。

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
      'packages/planner/src/relay.ts': 'AI 修改：经 Tinkrum 服务器转发（D-193）',
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

  it('the page a change was opened from is only an id or a kind of file: titles of records, names and contents do not fit (D-406)', () => {
    const places = [
      { kind: 'page', pageId: 'budget' },
      { kind: 'table', tableId: 'expenses' },
      { kind: 'screen', screen: 'tools' },
      { kind: 'desk', fileKind: 'pdf' },
    ];
    for (const place of places) {
      expect(PlanAboutSchema.safeParse(place).success).toBe(true);
      for (const extra of [
        { recordId: 'r1' },
        { title: SENTINEL },
        { name: 'a.pdf' },
        { text: SENTINEL },
      ])
        expect(PlanAboutSchema.safeParse({ ...place, ...extra }).success).toBe(false);
    }
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

describe('底线 1 / 2 / 14：保存的预设不在配置里（D-410）', () => {
  it('a config carrying saved presets is rejected, so they can never go to the AI with it', () => {
    const config = createDefaultWorkspace('zh');
    expect(
      WorkspaceConfigSchema.safeParse({ ...config, presets: [{ id: 'p', name: SENTINEL }] })
        .success,
    ).toBe(false);
  });
});

describe('底线 2：扫到的二维码不发给 AI（D-423）', () => {
  it('the code is only for the candidates: not in the document text, and never in config', () => {
    const fields = [{ id: 'name', name: 'Name', type: 'text' as const }];
    const plan = planDocument({
      fields,
      rules: 'card',
      pages: [],
      locale: 'en',
      codes: [`BEGIN:VCARD\nFN:${SENTINEL}\nEND:VCARD`],
    });
    // 要问模型时给的是 rows；AI 的计划里只有配置（配置里放不下候选）。
    expect(plan.rows).toEqual([]);
    expect(plan.fields[0]!.fromCode.map((s) => s.value)).toEqual([SENTINEL]);
    expect(plan.fields[0]!.ask).toBe(false);
    expect(
      CollectionSchema.safeParse({ id: 't', name: 'T', fields, codes: [SENTINEL] }).success,
    ).toBe(false);
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

describe('底线 3：新设置里没有文件引用（D-424）', () => {
  const page = (block: object) => ({
    op: 'addContainer' as const,
    page: { id: 'p', title: 'P', blocks: [block] },
  });
  const table = {
    op: 'addData' as const,
    table: { id: 't', name: 'T', fields: [{ id: 'a', name: 'A', type: 'text' as const }] },
  };

  it.each([
    [
      'single with a file',
      { id: 'x', look: 'single', source: { table: 't' }, show: { fields: ['a'], asset: 'f' } },
    ],
    [
      'single with opens',
      {
        id: 'x',
        look: 'single',
        source: { table: 't' },
        show: { fields: ['a'] },
        opens: { file: 'f' },
      },
    ],
    [
      'list browse with a file',
      {
        id: 'x',
        look: 'list',
        source: { table: 't' },
        show: { title: 'a', browse: { search: true, asset: 'f' } },
      },
    ],
    [
      'showIf with a file',
      { id: 'x', look: 'divider', showIf: { table: 't', has: 'some', asset: 'f' } },
    ],
  ])('%s is refused', (_name, block) => {
    expect(OpSchema.safeParse(page(block)).success).toBe(false);
    expect(prepareOps(createDefaultWorkspace('en'), [table, page(block) as never], ctx).ok).toBe(
      false,
    );
  });
});

describe('底线 2 / 3：报表带附件，AI 只能开关这个参数（D-425）', () => {
  const steps = (attachments: unknown) => [
    { id: 'a', action: 'in.records', params: { collectionId: 'notes', period: 'all' } },
    {
      id: 'b',
      action: 'print.records',
      params: { template: 'table', title: '', fields: [], pageSize: 'a4', attachments },
    },
  ];
  const params = () => registry.actions.get('print.records')!.params;

  it('the parameter is a yes or no: a file id, a path or a list cannot be written there', () => {
    expect(params().safeParse(steps(true)[1]!.params).success).toBe(true);
    for (const bad of ['asset01', 'file:///x.jpg', ['asset01'], { file: 'asset01' }, 1])
      expect(params().safeParse(steps(bad)[1]!.params).success).toBe(false);
  });

  it('what AI sees of the step is the switch, never a file', () => {
    const base = createDefaultWorkspace('en');
    const tool = { id: 'q', kind: 'quickAction', name: 'Q', steps: steps(true) };
    const config = { ...base, tools: [...base.tools, tool] } as WorkspaceConfig;
    const shown = JSON.stringify(redactForAI(config, registry).tools.find((x) => x.id === 'q'));
    expect(shown).toContain('"attachments":true');
    expect(shown).not.toMatch(/asset|file:/);
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

  // D-422：AI 能写字段的 format（配置），没有打电话、写信、开网页的操作；点是用户在记录页上点的。
  it("AI can set a text field's format, and no op dials, emails or opens a link", () => {
    const base = applyOps(
      createDefaultWorkspace('zh'),
      [
        {
          op: 'addData',
          table: { id: 'c', name: 'c', fields: [{ id: 'p', name: 'p', type: 'text' }] },
        },
      ],
      ctx,
    );
    if (!base.ok) throw new Error(base.error);
    const set: Op = { op: 'updateData', table: 'c', field: 'p', changes: { format: 'phone' } };
    expect(PlanSchema.safeParse({ kind: 'ops', ops: [set] }).success).toBe(true);
    expect(prepareOps(base.config, [set], { ...ctx, fromAI: true }).ok).toBe(true);
    for (const op of ['dial', 'call', 'openLink', 'openUrl', 'sendEmail', 'runTool'])
      expect(OpSchema.safeParse({ op, url: 'tel:123', field: 'p', table: 'c' }).success).toBe(
        false,
      );
    const ops = OpSchema.options.map((o) => o.shape.op.value as string);
    expect(ops.filter((o) => /dial|call|mail|link|url|open/i.test(o))).toEqual([]);
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
      { op: 'savePreset', name: 'x' },
      { op: 'applyPreset', id: 'x' },
      { op: 'deletePreset', id: 'x' },
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
  // D-428（取代 D-422 的「不是步骤」，创始人 2026-11-04 在对话里定）：打电话、发短信、发邮件、打开网站是四个步骤，
  // 只收容器交的文字；块上的工具、提醒都运行不了它们，配置里也写不了地址。
  it('only the four value steps open a link, and no block tool or reminder can run them', () => {
    const opening = [...registry.actions.values()].filter((a) => a.opensLink);
    expect(opening.map((a) => [a.id, a.opensLink, a.input, a.fields])).toEqual([
      ['out.call', 'phone', ['text'], []],
      ['out.message', 'message', ['text'], []],
      ['out.email', 'email', ['text'], []],
      ['out.website', 'url', ['text'], []],
    ]);
    const ids = [...registry.actions.keys()];
    expect(ids.filter((id) => /tel|mailto|dial|openurl|openlink/i.test(id))).toEqual([]);
    for (const { id: action } of opening) {
      expect(ToolUseSchema.safeParse({ as: 'button', label: 'x', action }).success).toBe(false);
      expect(
        ReminderSchema.safeParse({
          id: 'r',
          kind: 'reminder',
          title: 'x',
          enabled: true,
          when: { every: 'day', at: '09:00' },
          opens: 'page:home',
          steps: [{ id: 's', action, params: {} }],
        }).success,
      ).toBe(false);
    }
    // 动作的参数里也没有要打开的地址（有也打不开：下一个测试说明只有两个地方能调系统打开）。
    const params = [...registry.actions.values()].flatMap((a) =>
      a.fields
        .filter((f) => /^(tel|mailto|phone|email|url)$/i.test(f.key))
        .map((f) => `${a.id}.${f.key}`),
    );
    expect(params).toEqual([]);
  });

  it('only the record page and rich text can open something outside the app', () => {
    const openers = sourceFiles(join(REPO, 'apps', 'mobile', 'src'))
      .filter((path) => /\bLinking\.openURL\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(REPO, path));
    expect(openers.sort()).toEqual([
      join('apps', 'mobile', 'src', 'renderer', 'RichText.tsx'),
      join('apps', 'mobile', 'src', 'renderer', 'open-link.ts'),
    ]);
  });

  // D-423：导出成 vCard 只是快捷操作的一步，只做一个文件；要离开 App 还要接 out.share（快捷操作是用户点了才运行）。
  it('records.toVCard is only a step: no block tool or reminder can run it', () => {
    const action = registry.actions.get('records.toVCard')!;
    expect(action.input).toEqual(['records']);
    expect(action.output).toBe('files');
    expect(ToolUseSchema.safeParse({ as: 'button', label: 'x', action: action.id }).success).toBe(
      false,
    );
    expect(
      ReminderSchema.safeParse({
        id: 'r',
        kind: 'reminder',
        title: 'x',
        enabled: true,
        when: { every: 'day', at: '09:00' },
        opens: 'page:home',
        steps: [{ id: 's', action: action.id, params: {} }],
      }).success,
    ).toBe(false);
  });

  it('in.records → records.toVCard → out.share is a straight chain the catalog accepts', () => {
    const wf: Workflow = {
      id: 'q',
      kind: 'quickAction',
      name: 'Q',
      steps: [
        { id: 'a', action: 'in.records', params: { collectionId: 't', period: 'all' } },
        { id: 'b', action: 'records.toVCard', params: {} },
        { id: 'c', action: 'out.share', params: {} },
      ],
    };
    expect(workflowProblems(wf, registry)).toEqual([]);
    expect(typesAlong(wf.steps, registry)).toEqual(['records', 'files', 'files']);
  });

  // D-427：导出成 Excel 和 vCard 一样只是一步，要离开 App 还要接 out.share。
  it('records.toExcel is only a step: no block tool or reminder can run it', () => {
    const action = registry.actions.get('records.toExcel')!;
    expect(action.input).toEqual(['records']);
    expect(action.output).toBe('files');
    expect(ToolUseSchema.safeParse({ as: 'button', label: 'x', action: action.id }).success).toBe(
      false,
    );
    expect(
      ReminderSchema.safeParse({
        id: 'r',
        kind: 'reminder',
        title: 'x',
        enabled: true,
        when: { every: 'day', at: '09:00' },
        opens: 'page:home',
        steps: [{ id: 's', action: action.id, params: {} }],
      }).success,
    ).toBe(false);
  });

  it('in.records → records.toExcel → out.share is a straight chain the catalog accepts', () => {
    const wf: Workflow = {
      id: 'q',
      kind: 'quickAction',
      name: 'Q',
      steps: [
        { id: 'a', action: 'in.records', params: { collectionId: 't', period: 'all' } },
        { id: 'b', action: 'records.toExcel', params: {} },
        { id: 'c', action: 'out.share', params: {} },
      ],
    };
    expect(workflowProblems(wf, registry)).toEqual([]);
    expect(typesAlong(wf.steps, registry)).toEqual(['records', 'files', 'files']);
  });

  // D-428：记录页的按钮只在 onPress 里运行，「分享 vCard」也走快捷操作，没有另一条路（mobile 测试点了才跑）。
  it('the entry page runs its tools only in the tap handler, with no way around the steps', () => {
    const text = readFileSync(
      join(REPO, 'apps', 'mobile', 'src', 'renderer', 'RecordActionRow.tsx'),
      'utf8',
    );
    expect(text).not.toMatch(/shareText|shareUris|Linking|useEffect/);
    expect(text.match(/\brun\(/g)).toHaveLength(1);
    expect(text).toMatch(/onPress=\{\(\) => void run\(/);
  });

  // 容器上的工具不能从别的地方运行：提醒、手机桌面、普通按钮都没有值可交（D-428）。
  describe('a quick action taking a handed value cannot be reached from a schedule or a shortcut', () => {
    const base = () => {
      const r = prepareOps(
        createDefaultWorkspace('en'),
        [
          {
            op: 'addData',
            table: { id: 'people', name: 'People', fields: [{ id: 'n', name: 'N', type: 'text' }] },
          },
          {
            op: 'addTool',
            tool: {
              id: 'send',
              kind: 'quickAction',
              name: 'Send',
              steps: [
                { id: 'a', action: 'records.toVCard', params: {} },
                { id: 'b', action: 'out.share', params: {} },
              ],
            },
          },
        ] as Op[],
        ctx,
      );
      if (!r.ok) throw new Error(r.issues.join());
      return r.after;
    };
    const refused = (ops: unknown[]) => prepareOps(base(), ops as Op[], ctx).ok;

    it('a reminder cannot open it', () => {
      expect(
        refused([
          {
            op: 'addTool',
            tool: {
              id: 'r',
              kind: 'reminder',
              title: 'x',
              enabled: true,
              when: { every: 'day', at: '09:00' },
              opens: 'tool:send',
            },
          },
        ]),
      ).toBe(false);
    });

    it('nor can a built-in one that dials', () => {
      expect(
        refused([
          {
            op: 'addTool',
            tool: {
              id: 'r',
              kind: 'reminder',
              title: 'x',
              enabled: true,
              when: { every: 'day', at: '09:00' },
              opens: 'tool:record-call',
            },
          },
        ]),
      ).toBe(false);
    });

    it('the phone home screen, an action block and a button cannot run it', () => {
      expect(refused([{ op: 'updateContainer', nav: { phoneHomeScreen: ['send'] } }])).toBe(false);
      expect(
        refused([
          {
            op: 'addContainer',
            page: 'home',
            index: 0,
            block: { id: 'x', look: 'action', tools: [{ tool: 'send' }] },
          },
        ]),
      ).toBe(false);
      expect(
        refused([
          {
            op: 'addContainer',
            page: 'home',
            index: 0,
            block: { id: 'x', look: 'button', show: { label: 'Go' }, opens: 'tool:send' },
          },
        ]),
      ).toBe(false);
    });
  });

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

describe('底线 11：写数据的操作都能挽回；只有删除弹撤销提示；批量修改一定先问', () => {
  // 删除弹撤销、其余写入（表单、打勾、一键新建、+1、点圆块）不弹：mobile 的 invariants-test.tsx；setAll 先问、
  // 改完不弹撤销：mobile 的 record-actions-test.tsx；拖看板：tiles-board-test.tsx；桌面小组件：widgets-journeys-test.tsx。
  it('asking before a bulk change does not promise an undo', () => {
    for (const text of [
      en.recordActionConfirm,
      enSingular.recordActionConfirm,
      zh.recordActionConfirm,
      fr.recordActionConfirm,
      frSingular.recordActionConfirm,
    ])
      expect(text).not.toMatch(/undo|撤销|annuler/i);
  });

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
  it('a print.records step saved before D-425 is still valid, with no attachments', () => {
    const params = { template: 'table', title: 'T', fields: [], pageSize: 'a4' };
    expect(registry.actions.get('print.records')!.params.safeParse(params).success).toBe(true);
    const old = v33Fixture('sample-expense-helper-zh') as never;
    const r = prepareSnapshot(old, registry);
    expect(r.ok ? [] : r.issues).toEqual([]);
    const opened = fromV33(old);
    expect(JSON.stringify(opened.tools)).not.toContain('"attachments"');
  });

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
    expect(CURRENT_SCHEMA_VERSION).toBe(39);
  });

  // D-424：showIf、browse、single 都是新的可选值，没有它们的旧配置一个字不变；schemaVersion 不变。
  it('old configs have no showIf or browse and load exactly as they were', () => {
    for (const [, config] of CONFIGS) {
      const text = JSON.stringify(config);
      expect(text).not.toMatch(/"showIf"|"browse"|"look":"single"/);
      const r = prepareSnapshot(structuredClone(config), registry);
      expect(r.ok && r.after).toEqual(config);
    }
  });

  // D-422：format 是可选的，旧配置没有它，读出来一个字不变，文字的值也一样读。
  it('an old config with no format loads unchanged and its text values read the same', () => {
    const table = {
      id: 'c',
      name: 'c',
      fields: [{ id: 'p', name: '电话', type: 'text', required: true }],
    };
    const base = createDefaultWorkspace('zh');
    const old = {
      ...structuredClone(base),
      schemaVersion: 36,
      data: { ...base.data, tables: [table] },
    };
    const r = prepareSnapshot(old, registry);
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (!r.ok) return;
    const loaded = r.after.data.tables[0]!;
    expect(loaded).toEqual(table);
    const f = loaded.fields[0]!;
    expect(fieldLink(f, '+33 6 12 34 56 78')).toBeNull();
    expect(fieldDefinition(f.type).read(f as never, '+33 6 12')).toBe('+33 6 12');
    expect(fieldDefinition(f.type).format(f as never, '+33 6 12', 'zh')).toBe('+33 6 12');
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

describe('底线 14：配置里没有名片内容（D-423）', () => {
  const single = (show: object) => ({ id: 'x', look: 'single', source: { table: 't' }, show });

  it('a single block holds only a table and field ids; a QR code or values do not fit', () => {
    for (const extra of [
      { vcard: 'BEGIN:VCARD' },
      { qrImage: 'data:' },
      { values: { a: SENTINEL } },
    ])
      expect(
        OpSchema.safeParse({
          op: 'addContainer',
          page: 'home',
          block: single({ fields: ['a'], ...extra }),
        }).success,
      ).toBe(false);
    expect(
      OpSchema.safeParse({
        op: 'addContainer',
        page: 'home',
        block: { ...single({ fields: ['a'] }), record: 'r1' },
      }).success,
    ).toBe(false);
  });

  it('search text and the chosen sort or group have no place in browse', () => {
    for (const extra of [{ query: 'x' }, { current: 'name' }, { selected: 'name' }])
      expect(
        OpSchema.safeParse({
          op: 'addContainer',
          page: 'home',
          block: {
            id: 'x',
            look: 'list',
            source: { table: 't' },
            show: { title: 'a', browse: { search: true, ...extra } },
          },
        }).success,
      ).toBe(false);
  });

  it('the business card sample carries no entries or card text in its config', () => {
    const base = createStarterWorkspace('en', registry);
    const result = sampleOps('business-cards', base, 'en');
    if (!result.ok) throw new Error(result.message);
    const r = prepareOps(base, result.ops, ctx);
    if (!r.ok) throw new Error(r.issues.join());
    expect(JSON.stringify(r.after)).not.toMatch(/BEGIN:VCARD|data:image|"values":\{/);
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
    // 表上的 recordRow（D-428）：字段是这张表的。
    if (Array.isArray(o.recordRow) && Array.isArray(o.fields)) {
      const own = new Set((o.fields as Json[]).map((f) => f.id));
      for (const item of o.recordRow as Json[])
        if (item.field !== undefined && !own.has(item.field))
          out.push(`${at}.recordRow: ${String(item.field)}`);
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
  // 文件桌面的工具栏：快捷操作的 ID（提醒不算）、目录里的动作。
  for (const [kind, groups] of Object.entries(config.containers.desk?.tools ?? {}))
    for (const item of (groups ?? []).flatMap((g) => g.items)) {
      if (typeof item === 'string') {
        const reminder = config.tools.some((t) => t.id === item && t.kind === 'reminder');
        if (reminder || !toolOk(item)) out.push(`containers.desk.tools.${kind}: ${item}`);
      } else if (!registry.actions.has(item.action))
        out.push(`containers.desk.tools.${kind}: ${item.action}`);
    }
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

describe('底线 18：删掉新设置引用的表和字段（D-424）', () => {
  const sample = () => {
    const base = createStarterWorkspace('en', registry);
    const result = sampleOps('business-cards', base, 'en');
    if (!result.ok) throw new Error(result.message);
    const r = prepareOps(base, result.ops, ctx);
    if (!r.ok) throw new Error(r.issues.join());
    return r.after;
  };

  it('a field the list also shows as a subtitle is refused as before; the app says which', () => {
    const r = prepareOps(
      sample(),
      [{ op: 'removeData', table: 'contacts', field: 'company' }],
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join()).toMatch(/subtitleField company/);
  });

  it.each(['contacts', 'my-card'])('removing table %s leaves nothing dangling', (table) => {
    const r = prepareOps(sample(), [{ op: 'removeData', table }], ctx);
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (!r.ok) return;
    expect(danglingRefs(r.after)).toEqual([]);
    expect(JSON.stringify(r.after.containers)).not.toContain(`"table":"${table}"`);
  });

  it.each([
    ['contacts', 'note'],
    ['my-card', 'phone'],
  ])('removing field %s.%s leaves nothing dangling', (table, field) => {
    const r = prepareOps(sample(), [{ op: 'removeData', table, field }], ctx);
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (!r.ok) return;
    expect(danglingRefs(r.after)).toEqual([]);
    const blocks = r.after.containers.pages.flatMap(allComponents);
    for (const b of blocks) {
      const show = (
        b as { show?: { fields?: string[]; browse?: { sort?: string[]; group?: string[] } } }
      ).show;
      expect([
        ...(show?.fields ?? []),
        ...(show?.browse?.sort ?? []),
        ...(show?.browse?.group ?? []),
      ]).not.toContain(field);
    }
  });
});

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

  // 下面这些引用校验器原来不查（审计 F3，创始人 2026-11-03 在对话里说先修复）。只在修改时拒绝：旧配置要还能打开（底线 12）。
  describe('a change cannot add a reference to something that does not exist', () => {
    const base = (): WorkspaceConfig => {
      const r = applyOps(
        createDefaultWorkspace('en'),
        [
          {
            op: 'addData',
            table: {
              id: 'expenses',
              name: 'Expenses',
              fields: [
                { id: 'amount', name: 'Amount', type: 'number' },
                {
                  id: 'category',
                  name: 'Category',
                  type: 'choice',
                  options: [{ id: 'food', label: 'Food' }],
                },
              ],
            },
          },
        ],
        ctx,
      );
      if (!r.ok) throw new Error(r.error);
      return r.config;
    };
    const number = (source: object) => ({
      id: 'n',
      look: 'number',
      show: { label: 'N' },
      source: { table: 'expenses', ...source },
    });
    const chart = (source: object) => ({
      id: 'c',
      look: 'chart',
      show: { kind: 'bar', title: 'C' },
      source: { table: 'expenses', group: { by: 'category' }, ...source },
    });
    const add = (block: object) => [{ op: 'addContainer', page: 'home', block }];
    const desk = (kind: string, items: unknown[]) => [
      { op: 'updateContainer', desk: { tools: { [kind]: [{ items }] } } },
    ];
    const reminder = (extra: object) => ({
      op: 'addTool',
      tool: {
        id: 'r',
        kind: 'reminder',
        title: 'T',
        enabled: true,
        when: { every: 'day', at: '09:00' },
        opens: 'page:home',
        ...extra,
      },
    });
    const quickAction = (extra: object) => ({
      op: 'addTool',
      tool: {
        id: 'q',
        kind: 'quickAction',
        name: 'Q',
        steps: [{ id: 's', action: 'in.photos', params: { source: 'files', min: 1, max: 5 } }],
        ...extra,
      },
    });

    it.each([
      ['number count', number({ aggregate: 'count', field: 'nope' })],
      ['number streak', number({ aggregate: 'streak', field: 'nope' })],
      ['chart count', chart({ aggregate: 'count', field: 'nope' })],
      ['chart distinctDays', chart({ aggregate: 'distinctDays', field: 'nope' })],
      [
        'minus count',
        number({
          aggregate: 'count',
          minus: { table: 'expenses', aggregate: 'count', field: 'nope' },
        }),
      ],
    ])('%s: field must exist even where the aggregate does not read it', (_name, block) => {
      const r = prepareOps(base(), add(block), ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues.join()).toContain('nope');
    });

    it('a count may leave field out, or name a real field (older configs do)', () => {
      for (const block of [
        number({ aggregate: 'count' }),
        number({ aggregate: 'count', field: 'amount' }),
        chart({ aggregate: 'count', field: 'amount' }),
      ])
        expect(prepareOps(base(), add(block), ctx).ok).toBe(true);
    });

    it('removing a field clears it from count blocks, charts and minus', () => {
      const added = prepareOps(
        base(),
        [
          ...add(number({ aggregate: 'count', field: 'amount' })),
          ...add({ ...chart({ aggregate: 'count', field: 'amount' }) }),
          ...add({
            ...number({
              aggregate: 'count',
              minus: { table: 'expenses', aggregate: 'count', field: 'amount' },
            }),
            id: 'm',
          }),
        ],
        ctx,
      );
      if (!added.ok) throw new Error(added.issues.join());
      const r = prepareOps(
        added.after,
        [{ op: 'removeData', table: 'expenses', field: 'amount' }],
        ctx,
      );
      if (!r.ok) throw new Error(r.issues.join());
      expect(danglingRefs(r.after)).toEqual([]);
      const blocks = allComponents(r.after.containers.pages.find((p) => p.id === 'home')!);
      const source = (id: string) => (blocks.find((c) => c.id === id) as Json).source as Json;
      expect(source('n').field).toBeUndefined();
      expect(source('c').field).toBeUndefined();
      expect((source('m').minus as Json).field).toBeUndefined();
    });

    it.each([
      ['a quick action that does not exist', 'pdf', 'no-such-quick-action'],
      ['an action that is not in the catalog', 'pdf', { action: 'foo.bar' }],
      ['an action for another kind of file', 'pdf', { action: 'image.rotate' }],
      ['a spec the action does not have', 'image', { action: 'image.compress', preset: 'nope' }],
    ])('desk toolbar: %s is refused', (_name, kind, item) => {
      expect(prepareOps(base(), desk(kind, [item]), ctx).ok).toBe(false);
    });

    it('desk toolbar: a reminder id is refused', () => {
      const r = prepareOps(base(), [reminder({}), ...desk('pdf', ['r'])], ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues.join()).toContain('reminder');
    });

    it('desk toolbar: actions that take this kind of file and quick actions are fine', () => {
      for (const [kind, items] of [
        ['pdf', [{ action: 'pdf.rotate' }, 'visa-photo']],
        ['image', [{ action: 'image.rotate' }, { action: 'pdf.fromImages' }]],
      ] as const)
        expect(prepareOps(base(), desk(kind, [...items]), ctx).ok).toBe(true);
      const own = prepareOps(base(), [quickAction({}), ...desk('image', ['q'])], ctx);
      expect(own.ok).toBe(true);
      // 默认工具栏上的动作都能写进配置。
      for (const kind of ['image', 'pdf', 'sheet', 'doc', 'video', 'audio'] as const) {
        const items = defaultDeskTools(kind, registry, [], 'en').flatMap((g) => g.items);
        const r = prepareOps(base(), desk(kind, items.slice(0, 20)), ctx);
        expect({ kind, issues: r.ok ? [] : r.issues }).toEqual({ kind, issues: [] });
      }
    });

    it('a new reminder cannot name a tool or a preset, so removeTool can always remove it', () => {
      expect(prepareOps(base(), [reminder({ package: 'nope' })], ctx).ok).toBe(false);
      expect(prepareOps(base(), [reminder({ preset: 'nope' })], ctx).ok).toBe(false);
      const ok = prepareOps(base(), [reminder({})], ctx);
      if (!ok.ok) throw new Error(ok.issues.join());
      expect(prepareOps(ok.after, [{ op: 'removeTool', tool: 'r' }], ctx).ok).toBe(true);
    });

    it('a new quick action can only name a preset that exists', () => {
      const r = prepareOps(base(), [quickAction({ preset: 'nope' })], ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues.join()).toContain('nope');
      expect(prepareOps(base(), [quickAction({ preset: 'visa-photo' })], ctx).ok).toBe(true);
    });

    it('a config saved with such references still opens and can still be changed (底线 12)', () => {
      const old = structuredClone(base());
      const home = old.containers.pages.find((p) => p.id === 'home')!;
      home.blocks.push(number({ aggregate: 'count', field: 'gone' }) as never);
      old.containers.desk = { tools: { pdf: [{ items: ['gone', { action: 'image.rotate' }] }] } };
      old.tools.push(
        {
          id: 'old-r',
          kind: 'reminder',
          package: 'gone',
          title: 'T',
          enabled: true,
          when: { every: 'day', at: '09:00' },
          opens: 'page:home',
        } as never,
        {
          id: 'old-q',
          kind: 'quickAction',
          name: 'Q',
          preset: 'gone',
          steps: [{ id: 's', action: 'in.photos', params: { source: 'files', min: 1, max: 5 } }],
        } as never,
      );
      expect(validateWorkspace(old, registry).ok).toBe(true);
      expect(prepareSnapshot(old, registry).ok).toBe(true);
      const edit = [{ op: 'updateContainer', page: 'home', changes: { title: 'Home 2' } }];
      expect(prepareOps(old, edit, ctx).ok).toBe(true);
      // 工具栏上旧的提醒 ID：提醒还能删。
      const withReminder = structuredClone(old);
      withReminder.containers.desk = { tools: { pdf: [{ items: ['old-r2'] }] } };
      withReminder.tools.push({
        id: 'old-r2',
        kind: 'reminder',
        title: 'T',
        enabled: true,
        when: { every: 'day', at: '09:00' },
        opens: 'page:home',
      });
      expect(prepareOps(withReminder, [{ op: 'removeTool', tool: 'old-r2' }], ctx).ok).toBe(true);
      // 新写的坏引用照样拒绝。
      expect(
        prepareOps(old, [...edit, ...add(number({ aggregate: 'count', field: 'no' }))], ctx).ok,
      ).toBe(false);
    });
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

// ---- 容器把数据交给工具（D-428，创始人 2026-11-04 在对话里定）----

/** 样板「名片」：两张表都有记录页的按钮，列表、单条记录块上都有工具。 */
const cardsSample = () => {
  const base = createStarterWorkspace('en', registry);
  const result = sampleOps('business-cards', base, 'en');
  if (!result.ok) throw new Error(result.message);
  const r = prepareOps(base, result.ops, ctx);
  if (!r.ok) throw new Error(r.issues.join());
  return r.after;
};
const handedSteps = (id: string, ...actions: string[]): Workflow => ({
  id,
  kind: 'quickAction',
  name: id,
  steps: actions.map((action, i) => ({
    id: `s${i}`,
    action,
    params: initialParams(registry.actions.get(action)!),
  })),
});

describe('底线 2 / 6：AI 能配置容器上的工具，运行不了，也看不到值（D-428）', () => {
  it('recordRow is only structure, and the ops take it', () => {
    const r = prepareOps(
      cardsSample(),
      [
        {
          op: 'updateData',
          table: 'contacts',
          changes: {
            recordRow: [{ tool: 'record-vcard' }, { tool: 'record-call', field: 'phone' }],
          },
        },
      ],
      ctx,
    );
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (r.ok)
      expect(r.after.data.tables.find((t) => t.id === 'contacts')!.recordRow).toEqual([
        { tool: 'record-vcard' },
        { tool: 'record-call', field: 'phone' },
      ]);
  });

  it('no op runs a tool or carries the handed value', () => {
    expect(OP_NAMES.filter((n) => /run|exec|call|send|open/i.test(n))).toEqual([]);
    for (const action of ['out.call', 'out.message', 'out.email', 'out.website'])
      expect(registry.actions.get(action)!.params.safeParse({ text: '1', to: '1' }).success).toBe(
        false,
      );
  });

  it('what the AI sees of these tables has no handed values', () => {
    const shown = JSON.stringify(redactForAI(cardsSample(), registry));
    expect(shown).toContain('recordRow');
    expect(shown).not.toMatch(/tel:|mailto:|sms:/);
  });
});

describe('底线 9：容器上的工具也是直链，不能触发别的工具（D-428）', () => {
  it('an item in the row names one tool and nothing else', () => {
    const table = { id: 't', name: 'T', fields: [{ id: 'f', name: 'F', type: 'text' }] };
    for (const extra of [{ then: 'other' }, { steps: [] }, { when: [] }, { run: true }])
      expect(
        CollectionSchema.safeParse({ ...table, recordRow: [{ tool: 'a', ...extra }] }).success,
      ).toBe(false);
  });

  it('an input step cannot come after a handed step', () => {
    const wf = handedSteps('w', 'records.toVCardText', 'in.text');
    expect(workflowProblems(wf, registry).map((p) => p.code)).toContain('source');
  });

  it('no step takes a tool as a parameter', () => {
    for (const action of registry.actions.values())
      expect(action.fields.filter((f) => /^(tool|workflow|quickAction)$/.test(f.key))).toEqual([]);
  });
});

describe('底线 12：旧配置不变（D-428）', () => {
  it('stays on the same version: every addition is optional', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(39);
  });

  it.each(CONFIGS)('%s loads with no row and no list tool made up', (_name, config) => {
    expect(validateWorkspace(config, registry).ok).toBe(true);
    expect(config.data.tables.some((t) => t.recordRow !== undefined)).toBe(false);
    expect(JSON.stringify(config.containers)).not.toContain('"as":"list"');
  });

  it('quick actions with an input step keep their input step', () => {
    for (const [, config] of CONFIGS)
      for (const wf of config.tools)
        if (wf.kind === 'quickAction')
          expect(isSourceAction(registry.actions.get(wf.steps[0]!.action)!)).toBe(true);
  });
});

describe('底线 14：配置里只有 ID，没有值（D-428）', () => {
  it('an item has no place for a value, and neither does a list tool', () => {
    const table = { id: 't', name: 'T', fields: [{ id: 'f', name: 'F', type: 'text' }] };
    for (const value of [{ value: '13800000000' }, { text: 'x' }, { url: 'tel:1' }])
      expect(
        CollectionSchema.safeParse({ ...table, recordRow: [{ tool: 'a', field: 'f', ...value }] })
          .success,
      ).toBe(false);
    expect(ToolUseSchema.safeParse({ as: 'list', tool: 'a', records: [] }).success).toBe(false);
  });
});

describe('底线 17：列表交的就是它选出的（D-428）', () => {
  it('a tool on a list must take records, and a tool on each entry cannot be a quick action', () => {
    const list = (use: object) => ({
      op: 'addContainer',
      page: 'home',
      index: 0,
      block: {
        id: 'x',
        look: 'list',
        source: { table: 'contacts' },
        show: { title: 'name' },
        tools: [use],
      },
    });
    const ok = (use: object) => prepareOps(cardsSample(), [list(use)] as Op[], ctx).ok;
    expect(ok({ as: 'list', tool: 'record-vcard' })).toBe(true);
    // 自己选输入的快捷操作不看列表选了什么，放在列表上会让人以为只作用到看到的这些。
    expect(ok({ as: 'list', tool: 'scan-card' })).toBe(false);
    expect(ok({ as: 'list', tool: 'record-call' })).toBe(false);
    expect(ok({ as: 'button', label: 'x', tool: 'record-vcard' })).toBe(false);
    expect(ok({ as: 'list', do: 'toggle', table: 'contacts', field: 'name' })).toBe(false);
  });
});

describe('底线 4 / 17 / 18：容器把附件交给工具（D-442）', () => {
  const shrink = () => handedSteps('shrink', 'pdf.compress');
  const tableOf = (config: WorkspaceConfig, id: string) =>
    config.data.tables.find((t) => t.id === id)!;
  const withShrink = (ops: unknown[]) =>
    prepareOps(cardsSample(), [{ op: 'addTool', tool: shrink() }, ...ops] as Op[], ctx);
  const list = (use: object, table = 'contacts', title = 'name') => ({
    op: 'addContainer',
    page: 'home',
    index: 0,
    block: {
      id: 'x',
      look: 'list',
      source: { table },
      show: { title },
      tools: [use],
    },
  });

  it('the row hands an attachment field to a tool that takes files, and nothing else', () => {
    const row = (recordRow: unknown) =>
      withShrink([{ op: 'updateData', table: 'contacts', changes: { recordRow } }]).ok;
    expect(row([{ tool: 'shrink', field: 'attachments' }])).toBe(true);
    // 没写字段、写的不是附件字段、字段不存在：交不出文件。
    expect(row([{ tool: 'shrink' }])).toBe(false);
    expect(row([{ tool: 'shrink', field: 'name' }])).toBe(false);
    expect(row([{ tool: 'shrink', field: 'nope' }])).toBe(false);
    // 反过来：收文字的工具不能接附件字段。
    expect(row([{ tool: 'record-copy', field: 'attachments' }])).toBe(false);
  });

  it('a number or a date can be handed over as text; a checkbox cannot', () => {
    const base = prepareOps(
      cardsSample(),
      [
        {
          op: 'addData',
          table: {
            id: 'bills',
            name: 'Bills',
            fields: [
              { id: 'title', name: 'Title', type: 'text' },
              { id: 'total', name: 'Total', type: 'number' },
              { id: 'due', name: 'Due', type: 'date' },
              { id: 'paid', name: 'Paid', type: 'checkbox' },
            ],
          },
        },
      ] as Op[],
      ctx,
    );
    if (!base.ok) throw new Error(base.issues.join());
    const row = (field: string) =>
      prepareOps(
        base.after,
        [
          {
            op: 'updateData',
            table: 'bills',
            changes: { recordRow: [{ tool: 'record-copy', field }] },
          },
        ] as Op[],
        ctx,
      ).ok;
    expect(row('total')).toBe(true);
    expect(row('due')).toBe(true);
    expect(row('paid')).toBe(false);
  });

  it('a list or a single block hands over the attachments of its own table, so the table needs an attachment field', () => {
    expect(withShrink([list({ as: 'list', tool: 'shrink' })]).ok).toBe(true);
    const plain = {
      op: 'addData',
      table: { id: 'plain', name: 'Plain', fields: [{ id: 'n', name: 'N', type: 'text' }] },
    };
    expect(withShrink([plain, list({ as: 'list', tool: 'shrink' }, 'plain', 'n')]).ok).toBe(false);
    // 同样的列表读有附件字段的表：可以（说明上面是因为没有附件字段才不行）。
    expect(withShrink([list({ as: 'list', tool: 'shrink' }, 'contacts', 'name')]).ok).toBe(true);
    const single = (table: string, field = 'name') => ({
      op: 'addContainer',
      page: 'home',
      index: 0,
      block: {
        id: 'one',
        look: 'single',
        source: { table },
        show: { fields: [field] },
        tools: [{ tool: 'shrink' }],
      },
    });
    expect(withShrink([single('contacts')]).ok).toBe(true);
    expect(withShrink([plain, single('plain', 'n')]).ok).toBe(false);
  });

  it('it cannot sit where nothing hands over attachments: a button, an action block, a reminder', () => {
    const at = (block: object) =>
      withShrink([{ op: 'addContainer', page: 'home', index: 0, block }]).ok;
    expect(at({ id: 'b', look: 'button', label: 'Go', opens: 'tool:shrink' })).toBe(false);
    expect(at({ id: 'a', look: 'action', tool: 'shrink' })).toBe(false);
  });

  it('removing the attachment field takes its button with it; removing the tool cleans the row', () => {
    const placed = withShrink([
      {
        op: 'updateData',
        table: 'contacts',
        changes: { recordRow: [{ tool: 'shrink', field: 'attachments' }] },
      },
    ]);
    if (!placed.ok) throw new Error(placed.issues.join());
    expect(danglingRefs(placed.after)).toEqual([]);
    const field = prepareOps(
      placed.after,
      [{ op: 'removeData', table: 'contacts', field: 'attachments' }],
      ctx,
    );
    expect(field.ok ? [] : field.issues).toEqual([]);
    if (field.ok) expect(tableOf(field.after, 'contacts').recordRow).toBeUndefined();
    const tool = prepareOps(placed.after, [{ op: 'removeTool', tool: 'shrink' }], ctx);
    expect(tool.ok ? [] : tool.issues).toEqual([]);
    if (tool.ok) {
      expect(tableOf(tool.after, 'contacts').recordRow).toBeUndefined();
      expect(danglingRefs(tool.after)).toEqual([]);
    }
  });

  it('the AI is told it can hand attachments, and that it never sees them (底线 2、3)', () => {
    const rule = registry.actions.get('out.call')!.aiRules!.find((r) => r.n === 54)!.text;
    expect(rule).toMatch(/attachment/i);
    expect(rule).toMatch(/never see/i);
  });
});

describe('底线 3 / 5 / 14 / 18：记一笔放进已有记录（D-443）', () => {
  const addRecord = registry.actions.get('out.addRecord')!;
  const own = (params: Record<string, unknown>): Workflow => ({
    id: 'to-existing',
    kind: 'quickAction',
    name: 'To existing',
    steps: [
      { id: 'a', action: 'in.photos', params: initialParams(registry.actions.get('in.photos')!) },
      { id: 'b', action: 'out.addRecord', params },
    ],
  });

  it('the AI only says which table and that it is an existing entry: the entry and the files are chosen by the user when it runs', () => {
    // 能写的只有表、每个文件一条、into；写不了哪一条记录、哪个文件（也看不到）。
    for (const extra of [{ recordId: 'r1' }, { assetId: 'a1' }, { fileId: 'a1' }, { values: {} }])
      expect(
        addRecord.params.safeParse({ collectionId: 'contacts', into: 'existing', ...extra })
          .success,
      ).toBe(false);
    expect(addRecord.params.safeParse({ collectionId: 'contacts', into: 'existing' }).success).toBe(
      true,
    );
    expect(addRecord.params.safeParse({ collectionId: 'contacts', into: 'a1' }).success).toBe(
      false,
    );
  });

  it('a quick action that adds to an existing entry is accepted, and it is removed with its table like the others', () => {
    const wf = own({ collectionId: 'contacts', into: 'existing' });
    const added = prepareOps(cardsSample(), [{ op: 'addTool', tool: wf }] as Op[], ctx);
    expect(added.ok ? [] : added.issues).toEqual([]);
    if (!added.ok) return;
    expect(danglingRefs(added.after)).toEqual([]);
    // 删掉它写的表：这一步（所以整个快捷操作）一起清理，不留指向不存在的表的引用。
    const gone = prepareOps(added.after, [{ op: 'removeData', table: 'contacts' }], ctx);
    expect(gone.ok ? [] : gone.issues).toEqual([]);
    if (gone.ok) expect(danglingRefs(gone.after)).toEqual([]);
  });

  it('the table needs a place for what is added, the same as for a new entry', () => {
    const noFileField = prepareOps(
      cardsSample(),
      [
        {
          op: 'addData',
          table: { id: 'plain', name: 'Plain', fields: [{ id: 'n', name: 'N', type: 'text' }] },
        },
        { op: 'addTool', tool: own({ collectionId: 'plain', into: 'existing' }) },
      ] as Op[],
      ctx,
    );
    expect(noFileField.ok).toBe(false);
  });
});

describe('底线 18：容器上的工具的引用（D-428）', () => {
  const tableOf = (config: WorkspaceConfig, id: string) =>
    config.data.tables.find((t) => t.id === id)!;

  it('the sample starts clean', () => {
    expect(danglingRefs(cardsSample())).toEqual([]);
  });

  it('removing a field takes its buttons with it and says so', () => {
    const r = prepareOps(
      cardsSample(),
      [{ op: 'removeData', table: 'my-card', field: 'email' }],
      ctx,
    );
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (!r.ok) return;
    expect(tableOf(r.after, 'my-card').recordRow!.map((i) => i.tool)).toEqual([
      'record-call',
      'record-message',
      'record-website',
      'record-vcard',
    ]);
    expect(danglingRefs(r.after)).toEqual([]);
  });

  it('removing the last field the row used removes the row', () => {
    const base = applyOps(
      createDefaultWorkspace('en'),
      [
        {
          op: 'addData',
          table: {
            id: 't',
            name: 'T',
            fields: [
              { id: 'n', name: 'N', type: 'text' },
              { id: 'p', name: 'P', type: 'text', format: 'phone' },
            ],
            recordRow: [{ tool: 'record-call', field: 'p' }],
          },
        },
      ],
      ctx,
    );
    if (!base.ok) throw new Error(base.error);
    const r = applyOps(base.config, [{ op: 'removeData', table: 't', field: 'p' }], ctx);
    if (!r.ok) throw new Error(r.error);
    expect(tableOf(r.config, 't').recordRow).toBeUndefined();
    expect(r.notes.map((n) => n.kind)).toContain('removedRecordActions');
  });

  it('removing a quick action cleans the row, the list and the single block; the blocks stay', () => {
    const base = cardsSample();
    const withOwn = prepareOps(
      base,
      [
        { op: 'addTool', tool: handedSteps('qr-own', 'records.toVCardText', 'qr.generate') },
        { op: 'updateData', table: 'my-card', changes: { recordRow: [{ tool: 'qr-own' }] } },
      ] as Op[],
      ctx,
    );
    if (!withOwn.ok) throw new Error(withOwn.issues.join());
    const r = prepareOps(withOwn.after, [{ op: 'removeTool', tool: 'qr-own' }], ctx);
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (r.ok) expect(tableOf(r.after, 'my-card').recordRow).toBeUndefined();

    const gone = prepareOps(base, [{ op: 'removeTool', tool: 'export-contacts' }], ctx);
    expect(gone.ok ? [] : gone.issues).toEqual([]);
    if (!gone.ok) return;
    expect(danglingRefs(gone.after)).toEqual([]);
    const page = gone.after.containers.pages.find((p) => p.id === 'contacts')!;
    // 导出在样板里是分开的浮动按钮的一项：这一项去掉，别的留着（创始人 2026-11-04 定）。
    const dial = allComponents(page).find((c) => c.look === 'dial') as {
      tools: { tool?: string; do?: string }[];
    };
    expect(dial.tools.map((u) => u.tool ?? u.do)).toEqual(['scan-card', 'create']);
  });

  it('a reference that does not exist, or a field that does not fit, is refused', () => {
    const row = (recordRow: unknown) =>
      prepareOps(
        cardsSample(),
        [{ op: 'updateData', table: 'contacts', changes: { recordRow } }] as Op[],
        ctx,
      ).ok;
    expect(row([{ tool: 'record-call', field: 'phone' }])).toBe(true);
    expect(row([{ tool: 'nope' }])).toBe(false);
    expect(row([{ tool: 'record-call', field: 'nope' }])).toBe(false);
    expect(row([{ tool: 'record-call' }])).toBe(false);
    expect(row([{ tool: 'record-vcard', field: 'phone' }])).toBe(false);
    expect(row([{ tool: 'scan-card' }])).toBe(false);
    expect(row([{ tool: 'record-call', field: 'attachments' }])).toBe(false);
    expect(
      row([
        { tool: 'record-call', field: 'phone' },
        { tool: 'record-call', field: 'phone' },
      ]),
    ).toBe(false);
  });

  it('records handed by a container cannot name fields: the table is not known there', () => {
    const wf = handedSteps('w', 'print.records');
    wf.steps[0]!.params = {
      template: 'table',
      title: 'x',
      fields: ['name'],
      pageSize: 'a4',
    };
    const r = prepareOps(cardsSample(), [{ op: 'addTool', tool: wf }] as Op[], ctx);
    expect(r.ok).toBe(false);
    wf.steps[0]!.params = { ...wf.steps[0]!.params, fields: [] };
    expect(prepareOps(cardsSample(), [{ op: 'addTool', tool: wf }] as Op[], ctx).ok).toBe(true);
  });

  it('removing the input step of a quick action on a removed table removes it, it does not turn into a handed one', () => {
    const r = prepareOps(
      createDefaultWorkspace('en'),
      [
        {
          op: 'addData',
          table: { id: 'x', name: 'X', fields: [{ id: 'n', name: 'N', type: 'text' }] },
        },
        {
          op: 'addTool',
          tool: {
            id: 'exp',
            kind: 'quickAction',
            name: 'Exp',
            steps: [
              { id: 'a', action: 'in.records', params: { collectionId: 'x', period: 'all' } },
              { id: 'b', action: 'records.toVCard', params: {} },
              { id: 'c', action: 'out.share', params: {} },
            ],
          },
        },
        { op: 'removeData', table: 'x' },
      ] as Op[],
      ctx,
    );
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (r.ok) expect(r.after.tools.some((t) => t.id === 'exp')).toBe(false);
  });
});

describe('底线 19：容器上的工具类型对得上就能串（D-428）', () => {
  it('every action taking text or records can start a chain, and what fits can follow', () => {
    for (const action of registry.actions.values()) {
      if (isSourceAction(action) || !handedTypeOf(action)) continue;
      const wf = handedSteps('w', action.id);
      expect(
        workflowProblems(wf, registry).filter((p) => p.code === 'source' || p.code === 'binding'),
      ).toEqual([]);
    }
    for (const chain of [
      ['records.toVCard', 'out.share'],
      ['records.toVCardText', 'qr.generate', 'out.share'],
      ['records.toExcel', 'out.share'],
      ['text.copy', 'qr.generate'],
      ['text.tidy', 'out.call'],
    ]) {
      const wf = handedSteps('w', ...chain);
      expect(
        workflowProblems(wf, registry).filter((p) => p.code === 'source' || p.code === 'binding'),
      ).toEqual([]);
    }
  });

  it('a value tool still chains from an input step', () => {
    const wf = handedSteps('w', 'in.text', 'out.call');
    expect(typesAlong(wf.steps, registry)).toEqual(['text', 'text']);
  });
});

// D-429：每一笔单独选货币。货币是记录里一个单选字段的值，配置里只有字段 ID。
describe('each entry picks its own currency (D-429)', () => {
  const ctx = { registry, locale: 'en' as const };
  const table = () => ({
    id: 'claims',
    name: 'Claims',
    fields: [
      { id: 'amount', name: 'Amount', type: 'money', currency: 'USD', currencyField: 'cur' },
      { id: 'cur', name: 'Currency', type: 'choice', options: [{ id: 'usd', label: 'USD' }] },
    ] as Record<string, unknown>[],
  });
  const withTable = (t: ReturnType<typeof table>) => {
    const c = structuredClone(createDefaultWorkspace('en'));
    c.data.tables = [t as never];
    return c;
  };
  const problems = (t: ReturnType<typeof table>) => {
    const r = validateWorkspace(withTable(t), registry);
    return r.ok ? '' : JSON.stringify(r);
  };

  it('rule 12: a money field saved before D-429 is still valid', () => {
    const t = table();
    delete t.fields[0]!.currencyField;
    expect(problems(t)).toBe('');
  });

  it('rule 18: currencyField must be a choice field of this table holding currency codes', () => {
    expect(problems(table())).toBe('');
    const missing = table();
    missing.fields = [missing.fields[0]!];
    expect(problems(missing)).toContain('currencyField');
    const bad = table();
    bad.fields[1]!.options = [{ id: 'other', label: 'Other' }];
    expect(problems(bad)).toContain('other');
  });

  it('rule 18: removing the currency field is refused until the money field lets go', () => {
    const c = withTable(table());
    const remove = { op: 'removeData', table: 'claims', field: 'cur' } as const;
    expect(JSON.stringify(applyOps(c, [remove], ctx))).toContain('currencyField');
    const freed = applyOps(
      c,
      [
        { op: 'updateData', table: 'claims', field: 'amount', changes: { currencyField: null } },
        remove,
      ],
      ctx,
    );
    expect(freed.ok).toBe(true);
  });

  it('rule 14: the config holds a field id only; the code comes from the record', () => {
    expect(JSON.stringify(table().fields[0])).not.toContain('eur');
    const record = { id: 'a', createdAt: 1, updatedAt: 1, values: { amount: 2, cur: 'usd' } };
    expect(perCurrencyText([record as never], table() as never, 'sum', 'amount', 'en')).toContain(
      '2.00',
    );
  });
});

describe('底线 2 / 14：标签只在记录里，配置和发给 AI 的都没有标签名（创始人 2026-11-04 定）', () => {
  const list = (browse: object) => ({
    id: 'x',
    look: 'list',
    source: { table: 'contacts' },
    show: { title: 'name', browse },
  });
  const addTo = (block: object) =>
    prepareOps(cardsSample(), [{ op: 'addContainer', page: 'my-card', block } as Op], ctx);

  it('a tags field has no options, default or list of values: tag names do not fit in the config', () => {
    const table = cardsSample().data.tables.find((t) => t.id === 'contacts')!;
    expect(table.fields.find((f) => f.type === 'tags')).toEqual({
      id: 'tags',
      name: 'Tags',
      type: 'tags',
    });
    for (const extra of [{ options: [SENTINEL] }, { default: [SENTINEL] }, { values: [SENTINEL] }])
      expect(
        CollectionSchema.safeParse({
          id: 't',
          name: 'T',
          fields: [{ id: 'g', name: 'G', type: 'tags', ...extra }],
        }).success,
      ).toBe(false);
  });

  it('a saved filter can only ask whether there are tags: is / isNot would store a tag name', () => {
    const filter = (op: string, value?: string) =>
      addTo({
        ...list({ search: true }),
        source: { table: 'contacts', filter: [{ field: 'tags', op, value }] },
      });
    for (const op of ['is', 'isNot', 'contains']) {
      const r = filter(op, SENTINEL);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues.join()).toMatch(/isEmpty or isNotEmpty/);
    }
    expect(filter('isNotEmpty').ok).toBe(true);
  });

  it('a record tool can not preset a tag either', () => {
    const r = addTo({
      id: 'x',
      look: 'button',
      show: { label: 'A', variant: 'filled' },
      tools: [{ do: 'create', table: 'contacts', values: { tags: [SENTINEL] } }],
    });
    expect(r.ok).toBe(false);
  });

  it('the picked filter value, the search text and the sort have no place in browse', () => {
    for (const extra of [{ picked: SENTINEL }, { value: SENTINEL }, { query: SENTINEL }])
      expect(
        OpSchema.safeParse({
          op: 'addContainer',
          page: 'home',
          block: list({ filter: ['tags'], ...extra }),
        }).success,
      ).toBe(false);
    expect(
      OpSchema.safeParse({
        op: 'addContainer',
        page: 'home',
        block: list({ filter: [SENTINEL + ' a tag'] }),
      }).success,
    ).toBe(false);
  });

  it('the sample and the contacts preset hold no tag name', () => {
    const text = JSON.stringify(cardsSample());
    for (const old of ['"client"', '"colleague"', '"friend"']) expect(text).not.toContain(old);
  });
});

describe('底线 12：旧的配置不用固定区、标签和浮动按钮照样打开（创始人 2026-11-04 定）', () => {
  it('schemaVersion stays 39 and a config without the new keys is valid and unchanged', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(39);
    const old = fromV33(v33Fixture('sample-expense-helper-zh') as never);
    const text = JSON.stringify(old);
    for (const key of ['"pin"', '"dial"', '"tags"']) expect(text).not.toContain(key);
    expect(validateWorkspace(old, registry).ok).toBe(true);
  });
});

describe('底线 18：固定区、标签筛选、浮动按钮的引用（创始人 2026-11-04 定）', () => {
  const dialOf = (config: WorkspaceConfig) =>
    allComponents(config.containers.pages.find((p) => p.id === 'contacts')!).find(
      (c) => c.look === 'dial',
    ) as { tools: { as?: string; tool?: string; do?: string }[] } | undefined;

  it('removing the list takes the item that hands its records off the dial; the others stay', () => {
    const r = prepareOps(
      cardsSample(),
      [{ op: 'removeContainer', page: 'contacts', block: 'contacts' }],
      ctx,
    );
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (!r.ok) return;
    expect(danglingRefs(r.after)).toEqual([]);
    expect(dialOf(r.after)!.tools.map((u) => u.tool ?? u.do)).toEqual(['scan-card', 'create']);
  });

  it('removing the table takes the dial items that used it; the scan stays while it can', () => {
    const r = prepareOps(cardsSample(), [{ op: 'removeData', table: 'contacts' }], ctx);
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (!r.ok) return;
    expect(danglingRefs(r.after)).toEqual([]);
    expect(JSON.stringify(dialOf(r.after) ?? {})).not.toContain('"contacts"');
    expect(dialOf(r.after)?.tools.some((u) => u.as === 'list') ?? false).toBe(false);
  });

  it('a dial with nothing left is removed', () => {
    const base = cardsSample();
    const r = prepareOps(
      base,
      [
        { op: 'removeTool', tool: 'scan-card' },
        { op: 'removeTool', tool: 'export-contacts' },
        { op: 'removeData', table: 'contacts' },
      ],
      ctx,
    );
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (r.ok) expect(dialOf(r.after)).toBeUndefined();
  });

  it('removing a page a dial opens takes that item off', () => {
    const base = cardsSample();
    const added = prepareOps(
      base,
      [
        {
          op: 'updateContainer',
          page: 'contacts',
          block: 'actions',
          changes: {
            tools: [
              { tool: 'scan-card', label: 'Scan' },
              { opens: 'my-card', label: 'Mine' },
            ],
          },
        },
      ] as Op[],
      ctx,
    );
    expect(added.ok ? [] : added.issues).toEqual([]);
    if (!added.ok) return;
    const r = prepareOps(added.after, [{ op: 'removeContainer', page: 'my-card' }], ctx);
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (r.ok) expect(dialOf(r.after)!.tools.map((u) => u.tool)).toEqual(['scan-card']);
  });

  it('removing a filter field takes it out of browse; browse goes when nothing is left', () => {
    const base = cardsSample();
    const prepared = prepareOps(
      base,
      [
        {
          op: 'addData',
          table: {
            id: 'kinds',
            name: 'Kinds',
            fields: [
              { id: 'name', name: 'Name', type: 'text' },
              { id: 'labels', name: 'Labels', type: 'tags' },
            ],
          },
        },
        {
          op: 'addContainer',
          page: 'my-card',
          block: {
            id: 'k',
            look: 'list',
            source: { table: 'kinds' },
            show: { title: 'name', browse: { filter: ['labels'] } },
          },
        },
      ] as Op[],
      ctx,
    );
    expect(prepared.ok ? [] : prepared.issues).toEqual([]);
    if (!prepared.ok) return;
    const r = prepareOps(
      prepared.after,
      [{ op: 'removeData', table: 'kinds', field: 'labels' }],
      ctx,
    );
    expect(r.ok ? [] : r.issues).toEqual([]);
    if (!r.ok) return;
    const block = allComponents(r.after.containers.pages.find((p) => p.id === 'my-card')!).find(
      (c) => c.id === 'k',
    ) as { show: { browse?: unknown } };
    expect(block.show.browse).toBeUndefined();
  });

  it('a block in a group can not be pinned, and moving a pinned block into a group is refused', () => {
    const r = prepareOps(
      cardsSample(),
      [
        {
          op: 'addContainer',
          page: 'my-card',
          block: {
            id: 'g',
            look: 'group',
            show: { layout: 'stack' },
            children: [{ id: 'h', look: 'divider', pin: 'top' }],
          },
        },
      ] as Op[],
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join()).toMatch(/can't have pin/);
  });

  it('every dial item is checked: a handed quick action, a list that is not there, a record page', () => {
    const dial = (tools: object[]) => ({ id: 'd', look: 'dial', pin: 'bottom', tools });
    const add = (block: object, page = 'my-card') =>
      prepareOps(cardsSample(), [{ op: 'addContainer', page, block } as Op], ctx);
    const refused = (block: object, pattern: RegExp) => {
      const r = add(block);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues.join()).toMatch(pattern);
    };
    // 交记录的工具不能当普通项（没有值可交），也不能在没有列表的页面上。
    refused(dial([{ tool: 'export-contacts' }]), /takes a record, a value or attachments/);
    refused(dial([{ as: 'list', tool: 'export-contacts' }]), /exactly one top-level list/);
    // 要容器交记录的才能放 as: "list"；自己选文件的不行。
    refused(dial([{ as: 'list', tool: 'scan-card' }]), /must start with a step that takes records/);
    refused(dial([{ tool: 'no-such' }]), /missing quick action/);
    refused(dial([{ opens: 'no-such', label: 'x' }]), /is not a page/);
    refused(dial([{ do: 'create', table: 'contacts', ask: 'all' }]), /needs a label/);
    refused({ id: 'd', look: 'dial', tools: [{ tool: 'scan-card' }] }, /set pin "bottom"/);
    expect(add(dial([{ tool: 'scan-card' }])).ok).toBe(true);
    // 一个页面一个。
    const two = prepareOps(
      cardsSample(),
      [
        {
          op: 'addContainer',
          page: 'contacts',
          block: dial([{ tool: 'scan-card' }]),
        },
      ] as Op[],
      ctx,
    );
    expect(two.ok).toBe(false);
  });

  it('a list with show.browse can not be pinned, and only one list on a page pins its search', () => {
    const list = (id: string, extra: object) => ({
      id,
      look: 'list',
      source: { table: 'contacts' },
      show: { title: 'name', browse: { search: true, ...extra } },
    });
    const add = (block: object) =>
      prepareOps(cardsSample(), [{ op: 'addContainer', page: 'contacts', block } as Op], ctx);
    const second = add(list('b', { pin: true }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.issues.join()).toMatch(/only one list/);
    const pinned = add({ ...list('c', {}), pin: 'top' });
    expect(pinned.ok).toBe(false);
    if (!pinned.ok) expect(pinned.issues.join()).toMatch(/scrolls in the middle/);
    const wrongType = add({
      ...list('d', {}),
      show: { title: 'name', browse: { filter: ['name'] } },
    });
    expect(wrongType.ok).toBe(false);
  });
});
