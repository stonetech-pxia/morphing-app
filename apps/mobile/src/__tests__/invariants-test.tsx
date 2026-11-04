import {
  BUILTIN_TOOLS,
  CURRENT_SCHEMA_VERSION,
  DATA_TEMPLATES,
  FILE_RECORD_PRESETS,
  REDACTED_FILE,
  applyOps,
  createDefaultWorkspace,
  createRegistry,
  templateOps,
  type AIProvider,
  type Collection,
  type Locale,
  type Op,
  type Plan,
  type WorkspaceConfig,
} from '@morph/core';
import { createClaudePlanner, createHttpCompleter } from '@morph/planner';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import { useGuide } from '../guide/store';
import { sharedAbout } from '../share/about';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeFiles } from '../test-utils/fake-files';
import { renderToolsApp } from '../test-utils/render-app';
import { fromV33 } from '../test-utils/v33';
import { createRemoteAIProvider } from '../workspace/remote-ai';
import { createWorkspaceStore } from '../workspace/store';
import sampleBabyGrowth from '../../../../packages/core/src/fixtures/v33/sample-baby-growth-zh.json';
import sampleExpenseHelper from '../../../../packages/core/src/fixtures/v33/sample-expense-helper-zh.json';
import sampleShopOrders from '../../../../packages/core/src/fixtures/v33/sample-shop-orders-zh.json';
import sampleStudyHelper from '../../../../packages/core/src/fixtures/v33/sample-study-helper-zh.json';
import sampleVisaDocs from '../../../../packages/core/src/fixtures/v33/sample-visa-docs-zh.json';
import v34Calendar from '../../../../packages/core/src/fixtures/v34/calendar.json';
import v34Habits from '../../../../packages/core/src/fixtures/v34/habits.json';
import v34Tasks from '../../../../packages/core/src/fixtures/v34/tasks.json';
import v34Todo from '../../../../packages/core/src/fixtures/v34/todo.json';

// Tinkrum 的 19 条底线（AGENTS.md「底线」，创始人 2026-10-31 暂定，同一天改了 3、7、11、16，加了 19）在 App 这一层的守护测试：发给 AI 的请求、
// 记录在改 App 前后是否还在、看页面会不会写数据、写数据能不能撤销。core 那一层在
// packages/core/src/invariants.test.ts，文件平台在 invariants-files-test.ts。
// 测出真的违反时不改代码：标 it.failing，注释写「违反底线 N，待创始人决定：…」。

const registry = createRegistry(BUILTIN_TOOLS);
const NOW = new Date(2026, 9, 31, 9, 0);
const SENTINEL = 'SENTINEL-私密-7f3a';
const ASSET = 'sentinelasset01';
const OTHER_ASSET = 'otherasset0002';

/** 默认配置加一张笔记表和首页上一个文件位（指向用户自己选的文件）。 */
function seeded(locale: Locale = 'zh'): WorkspaceConfig {
  const ops: Op[] = [
    {
      op: 'addData',
      table: {
        id: 'notes',
        name: '笔记',
        fields: [
          { id: 'title', name: '标题', type: 'text' },
          { id: 'body', name: '内容', type: 'text' },
        ],
      },
    },
    {
      op: 'addContainer',
      page: 'home',
      block: { id: 'slot', look: 'entry', show: { title: '合同' }, opens: { file: ASSET } },
    },
  ];
  const r = applyOps(createDefaultWorkspace(locale), ops, { registry, locale });
  if (!r.ok) throw new Error(r.error);
  return r.config;
}

/** 记录、文件名、识别出的文字（存在记录里）都带哨兵字符串。 */
async function repoWithPrivateData() {
  const repo = new MemoryWorkspaceRepo();
  await repo.insertRecord({
    id: 'r1',
    collectionId: 'notes',
    values: { body: `${SENTINEL} 识别出的文字` },
    createdAt: NOW.getTime(),
    updatedAt: NOW.getTime(),
  });
  for (const id of [ASSET, OTHER_ASSET])
    await repo.addAsset({
      id,
      name: `${SENTINEL}-${id}.pdf`,
      mimeType: 'application/pdf',
      size: 10,
      path: `assets/${id}/${SENTINEL}.pdf`,
      source: 'picked',
      createdAt: NOW.getTime(),
    });
  return repo;
}

const themePlan: Plan = { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#336699' }] };

/** 假的 fetch：记下发出去的每个请求体，回一个合法的计划。 */
function capturingFetch(reply: (plan: string) => unknown) {
  const bodies: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    const body = reply(JSON.stringify(themePlan));
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

const relayReply = (text: string) => ({
  text,
  stopReason: 'end_turn',
  content: [{ type: 'text', text }],
  model: 'claude-haiku-5-5',
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
});
const claudeReply = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  model: 'claude-haiku-5-5',
  usage: { input_tokens: 1, output_tokens: 1 },
});

async function bootedStore(provider: AIProvider, repo?: MemoryWorkspaceRepo) {
  const r = repo ?? (await repoWithPrivateData());
  const store = createWorkspaceStore({
    repo: r,
    provider,
    registry,
    locale: 'zh',
    now: () => NOW,
    seed: () => seeded(),
  });
  await store.getState().boot();
  return { repo: r, store };
}

const fixedPlanner = (plan: Plan): AIProvider => ({ plan: async () => plan });

describe('底线 1 / 2：AI 的请求里没有数据内容（记录、文件名、文件内容、识别文字）', () => {
  const shared = {
    id: 1,
    source: 'share' as const,
    copies: [],
    files: [
      {
        uri: `file:///shared/${SENTINEL}.jpg`,
        name: `${SENTINEL}.jpg`,
        size: 99,
        mimeType: 'image/jpeg',
      },
      { uri: `content://x/${SENTINEL}.pdf`, name: `${SENTINEL}.pdf`, size: 7, mimeType: null },
    ],
  };

  it('Tinkrum server mode: the AI page, the inbox and the draft chat send no data', async () => {
    const { bodies, fetchImpl } = capturingFetch(relayReply);
    const provider = createRemoteAIProvider({
      baseUrl: 'https://relay.test',
      registry,
      now: () => NOW,
      fetchImpl,
    });
    const { store } = await bootedStore(provider);
    expect((await store.getState().change('换个颜色', provider)).kind).toBe('drafted');
    // 草稿聊天框接着说（带上之前说过的话，D-207）。
    await store.getState().draftChange('再深一点');
    await store.getState().deleteDraft();
    // 收件页面打开 AI：只带文件的类型和个数。
    await store.getState().change('给这些做个快捷操作', provider, { about: sharedAbout(shared) });
    await store.getState().deleteDraft();
    await store.getState().propose('换个颜色', provider, sharedAbout(shared));
    expect(bodies.length).toBeGreaterThanOrEqual(4);
    for (const body of bodies) {
      expect(body).not.toContain(SENTINEL);
      expect(body).not.toContain('识别出的文字');
    }
    // 配置本身是发了的（AI 要看结构）；文件位里只有占位符，连随机的文件 ID 也不发（底线 3）。
    expect(bodies[0]).toContain('notes');
    for (const body of bodies) {
      expect(body).not.toContain(ASSET);
      expect(body).not.toContain(OTHER_ASSET);
    }
    expect(bodies[0]).toContain(REDACTED_FILE);
  });

  it('saved presets stay out of what the AI sees: not in the config, not their names (D-410)', async () => {
    const { bodies, fetchImpl } = capturingFetch(relayReply);
    const provider = createRemoteAIProvider({
      baseUrl: 'https://relay.test',
      registry,
      now: () => NOW,
      fetchImpl,
    });
    const { repo, store } = await bootedStore(provider);
    const saved = await store.getState().savePreset(`预设-${SENTINEL}`);
    expect(saved.kind).toBe('saved');
    if (saved.kind !== 'saved') return;
    expect(store.getState().config).not.toHaveProperty('presets');
    await repo.insertPreset({ ...saved.preset, id: 'otherpreset', name: `另一个-${SENTINEL}` });
    // 应用过一个预设之后，版本说明里有它的名字，也不发给 AI。
    expect((await store.getState().proposePreset(saved.preset.id)).kind).toBe('preview');
    await store.getState().confirm();
    await store.getState().markRendered(store.getState().head!.id);
    await store.getState().change('换个颜色', provider);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    for (const body of bodies) expect(body).not.toContain(SENTINEL);
  });

  it('bring-your-own-key mode sends no data either', async () => {
    const { bodies, fetchImpl } = capturingFetch(claudeReply);
    const provider = createClaudePlanner({
      complete: createHttpCompleter({
        apiKey: 'test-key',
        model: 'claude-haiku-5-5',
        registry,
        fetchImpl,
      }),
      registry,
      now: () => NOW,
    });
    const { store } = await bootedStore(provider);
    await store.getState().change('换个颜色', provider, { about: sharedAbout(shared) });
    expect(bodies.length).toBe(1);
    expect(bodies[0]).not.toContain(SENTINEL);
  });
});

describe('底线 3：AI 永远不碰文件', () => {
  // 创始人 2026-10-31（对话）：AI 的修改一律不能写文件引用，只有用户在长按编辑里选。
  it('AI cannot point a file slot at one of the user’s files; only the user picks it', async () => {
    const plan: Plan = {
      kind: 'ops',
      ops: [
        {
          op: 'updateContainer',
          page: 'home',
          block: 'slot',
          changes: { opens: { file: OTHER_ASSET } },
        },
      ],
    };
    const { store } = await bootedStore(fixedPlanner(plan));
    const result = await store.getState().change('换成另一个文件', fixedPlanner(plan));
    expect(['rejected', 'invalid']).toContain(result.kind);
  });

  it('AI can add an empty file slot (the user picks the file)', async () => {
    const plan: Plan = {
      kind: 'ops',
      ops: [
        {
          op: 'addContainer',
          page: 'home',
          block: { id: 'slot2', look: 'entry', show: { title: '护照' }, opens: { file: null } },
        },
      ],
    };
    const { store } = await bootedStore(fixedPlanner(plan));
    expect((await store.getState().change('加一个放护照的地方', fixedPlanner(plan))).kind).toBe(
      'drafted',
    );
  });
});

describe('底线 5：改 App 永远不删数据', () => {
  async function apply(store: Awaited<ReturnType<typeof bootedStore>>['store'], ops: Op[]) {
    const r = await store.getState().proposeOps(ops, 'x');
    expect(r.kind).toBe('preview');
    expect(await store.getState().confirm()).toBe(true);
    await store.getState().markRendered(store.getState().head!.id);
  }

  it('removing a field or a table keeps the entries; going back to an old version keeps them too', async () => {
    const { repo, store } = await bootedStore(fixedPlanner(themePlan));
    const first = store.getState().head!.id;
    await apply(store, [{ op: 'removeData', table: 'notes', field: 'body' }]);
    expect((await repo.getRecord('r1'))!.values.body).toContain(SENTINEL);
    await apply(store, [{ op: 'removeData', table: 'notes' }]);
    expect((await repo.listRecords('notes')).map((r) => r.id)).toEqual(['r1']);
    // 恢复到最早的版本：表回来了，记录一直都在。
    expect((await store.getState().proposeRestore(first)).kind).toBe('preview');
    await store.getState().confirm();
    expect(store.getState().config!.data.tables.some((t) => t.id === 'notes')).toBe(true);
    expect((await repo.getRecord('r1'))!.values.body).toContain(SENTINEL);
    // 撤销也一样。
    await store.getState().undo();
    expect((await repo.listRecords('notes')).length).toBe(1);
  });

  it('applying a saved preset keeps every entry, also of tables the preset does not have (D-410)', async () => {
    const { repo, store } = await bootedStore(fixedPlanner(themePlan));
    await repo.insertPreset({
      id: 'emptypreset',
      name: '空的',
      createdAt: 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      config: createDefaultWorkspace('zh'),
    });
    expect((await store.getState().proposePreset('emptypreset')).kind).toBe('preview');
    await store.getState().confirm();
    expect(store.getState().config!.data.tables.some((t) => t.id === 'notes')).toBe(false);
    expect((await repo.getRecord('r1'))!.values.body).toContain(SENTINEL);
    expect(await repo.listDeletedRecords()).toEqual([]);
    await store.getState().markRendered(store.getState().head!.id);
    await store.getState().undo();
    expect(store.getState().config!.data.tables.some((t) => t.id === 'notes')).toBe(true);
    expect((await repo.listRecords('notes')).length).toBe(1);
  });

  it('an AI change can never reach the entries: the store only gets a configuration back', async () => {
    const plan: Plan = { kind: 'ops', ops: [{ op: 'removeData', table: 'notes' }] };
    const { repo, store } = await bootedStore(fixedPlanner(plan));
    await store.getState().change('删掉笔记表', fixedPlanner(plan));
    expect((await repo.listRecords('notes')).length).toBe(1);
    expect(await repo.listDeletedRecords()).toEqual([]);
  });
});

describe('底线 7：外观修改先进草稿；功能修改直接生效，随时能在改动记录里撤销', () => {
  it('an AI change to the look goes into a draft; the app does not change until the user applies it', async () => {
    const { store } = await bootedStore(fixedPlanner(themePlan));
    const head = store.getState().head!.id;
    expect((await store.getState().change('换个颜色', fixedPlanner(themePlan))).kind).toBe(
      'drafted',
    );
    expect(store.getState().head!.id).toBe(head);
    await store.getState().applyDraft();
    expect(store.getState().head!.id).not.toBe(head);
    await store.getState().markRendered(store.getState().head!.id);
    await store.getState().undo();
    expect(store.getState().config!.theme.primaryColor).not.toBe('#336699');
  });

  // D-411：草稿聊天框里说的功能修改也一样，草稿接着开着，外观还没生效。
  it('a function change said in the draft chat is recorded and can be undone; the look stays a draft', async () => {
    const table: Plan = {
      kind: 'ops',
      ops: [
        {
          op: 'addData',
          table: { id: 'books', name: 'B', fields: [{ id: 'title', name: 'T', type: 'text' }] },
        },
      ],
    };
    const { repo, store } = await bootedStore({
      plan: async (input) => (input === 'look' ? themePlan : table),
    });
    await store.getState().draftChange('look');
    const before = store.getState().config!.theme.primaryColor;
    const head = store.getState().head!.id;
    await store.getState().draftChange('table');
    expect(store.getState().config!.theme.primaryColor).toBe(before);
    expect(store.getState().draft!.steps[0]!.config.theme.primaryColor).toBe('#336699');
    expect(await repo.listRevisions(1)).toMatchObject([{ source: 'ai', parentId: head }]);
    await store.getState().proposeRestore(head);
    await store.getState().confirm();
    expect(store.getState().config!.data.tables.some((t) => t.id === 'books')).toBe(false);
    expect(store.getState().draft!.open).toBe(true);
  });

  // 创始人 2026-10-31（对话）改了底线 7 的措辞：功能修改（D-191，建表、加快捷操作等）直接生效，但随时能在
  // 改动记录里撤销。
  it('an AI change to function (a new table) applies at once, is recorded in the history and can be undone', async () => {
    const plan: Plan = {
      kind: 'ops',
      ops: [
        {
          op: 'addData',
          table: {
            id: 'books',
            name: '书',
            fields: [{ id: 'title', name: '书名', type: 'text' }],
          },
        },
      ],
    };
    const { repo, store } = await bootedStore(fixedPlanner(plan));
    const head = store.getState().head!.id;
    expect((await store.getState().change('加一张书的表', fixedPlanner(plan))).kind).toBe(
      'applied',
    );
    const after = store.getState().head!;
    expect(after.id).not.toBe(head);
    expect(after.source).toBe('ai');
    expect(store.getState().config!.data.tables.some((t) => t.id === 'books')).toBe(true);
    // 改动记录里有这一版，前一版随时能回去。
    expect((await repo.listRevisions(50)).map((r) => r.id)).toEqual(
      expect.arrayContaining([head, after.id]),
    );
    await store.getState().markRendered(after.id);
    await store.getState().undo();
    expect(store.getState().config!.data.tables.some((t) => t.id === 'books')).toBe(false);
    expect((await store.getState().proposeRestore(after.id)).kind).toBe('preview');
    await store.getState().confirm();
    expect(store.getState().config!.data.tables.some((t) => t.id === 'books')).toBe(true);
  });
});

// ---- 渲染：看页面不写数据（底线 15、16），写数据能撤销（底线 11）----

/** 每张表几条简单的记录（只填存下来的、好填的字段）。 */
async function fillRecords(repo: MemoryWorkspaceRepo, tables: readonly Collection[]) {
  for (const t of tables)
    for (let i = 0; i < 3; i++) {
      const values: Record<string, unknown> = {};
      for (const f of t.fields) {
        if (f.type === 'text' || f.type === 'note') values[f.id] = `${t.id} ${i}`;
        else if (f.type === 'number' || f.type === 'money' || f.type === 'rating')
          values[f.id] = i + 1;
        else if (f.type === 'date') values[f.id] = `2026-10-${20 + i}`;
        else if (f.type === 'checkbox') values[f.id] = i === 0;
        else if (f.type === 'choice') values[f.id] = f.options[i % f.options.length]!.id;
      }
      await repo.insertRecord({
        id: `${t.id}-${i}`,
        collectionId: t.id,
        values,
        createdAt: NOW.getTime() - i * 86_400_000,
        updatedAt: NOW.getTime() - i * 86_400_000,
      });
    }
}

const WRITES = [
  'insertRecord',
  'updateRecord',
  'deleteRecord',
  'restoreRecord',
  'purgeDeletedRecords',
  'purgeCollection',
  'commitRevision',
  'addAsset',
  'deleteAsset',
] as const;

function spyWrites(repo: MemoryWorkspaceRepo) {
  return WRITES.map((name) => [name, jest.spyOn(repo, name)] as const);
}

// core 里冻结的配置：v34 的范围模版、v33 代码存下来的样板（迁移到现在）。
const V34: Record<string, unknown> = {
  habits: v34Habits,
  calendar: v34Calendar,
  tasks: v34Tasks,
  todo: v34Todo,
};
const SAMPLES: Record<string, unknown> = {
  'expense-helper': sampleExpenseHelper,
  'visa-docs': sampleVisaDocs,
  'study-helper': sampleStudyHelper,
  'shop-orders': sampleShopOrders,
  'baby-growth': sampleBabyGrowth,
};
const v34 = (name: string) => structuredClone(V34[name]) as WorkspaceConfig;

function withTemplate(
  template: (typeof DATA_TEMPLATES)[number] | (typeof FILE_RECORD_PRESETS)[number],
): WorkspaceConfig {
  const config = createDefaultWorkspace('zh');
  const r = applyOps(config, templateOps(template, config, 'zh'), { registry, locale: 'zh' });
  if (!r.ok) throw new Error(r.error);
  return r.config;
}

const VIEWED: [string, () => WorkspaceConfig, Locale][] = [
  ['default (fr)', () => createDefaultWorkspace('fr'), 'fr'],
  // 收件页面「存成记录」的预设表（D-392）也一样只看不写。
  ...[...DATA_TEMPLATES, ...FILE_RECORD_PRESETS].map(
    (t): [string, () => WorkspaceConfig, Locale] => [`template ${t}`, () => withTemplate(t), 'zh'],
  ),
  ...['habits', 'calendar', 'tasks', 'todo'].map((n): [string, () => WorkspaceConfig, Locale] => [
    `v34 ${n}`,
    () => v34(n),
    'zh',
  ]),
  ...['expense-helper', 'visa-docs', 'study-helper', 'shop-orders', 'baby-growth'].map(
    (n): [string, () => WorkspaceConfig, Locale] => [
      `sample ${n}`,
      () => fromV33(structuredClone(SAMPLES[n])),
      'zh',
    ],
  ),
];

async function renderSeeded(
  config: WorkspaceConfig,
  locale: Locale,
  repo = new MemoryWorkspaceRepo(),
) {
  await repo.setMeta('guide', 'done');
  await act(() => useGuide.getState().load(repo));
  await fillRecords(repo, config.data.tables);
  return renderToolsApp(repo, new FakeFiles(), { seed: () => config, locale });
}

// renderRouter 换成了假的计时器：往前拨一点，让页面上的读取、动画跑完。
const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(200);
    await Promise.resolve();
  });

describe('底线 15 / 16：看永远不会改；每次写入都来自用户的一次操作（例外：启动时清空回收站里超过 30 天的）', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    useGuide.setState({ stage: null, repo: null });
  });

  it.each(VIEWED)(
    '%s: opening every page writes nothing',
    async (_name, make, locale) => {
      const config = make();
      const { repo, store } = await renderSeeded(config, locale);
      // 种子版本能用（不是退回去的默认配置），页面才是要看的那些。
      expect(store.getState().head!.source).toBe('seed');
      await settle();
      const spies = spyWrites(repo);
      const reads = jest.spyOn(repo, 'listRecords');
      for (const page of config.containers.pages) {
        if (page.of !== undefined || page.package !== undefined) continue;
        await act(() => router.push({ pathname: '/page/[pageId]', params: { pageId: page.id } }));
        await settle();
        await act(() => router.back());
      }
      await settle();
      expect(spies.filter(([, s]) => s.mock.calls.length > 0).map(([n]) => n)).toEqual([]);
      // 页面真的画出来、读了记录（不是什么都没显示所以没写）。
      if (config.data.tables.length > 0) expect(reads).toHaveBeenCalled();
    },
    20_000,
  );

  // 创始人 2026-10-31（对话）定的例外（D-037）：回收站里删掉超过 30 天的记录在启动时永久删除，起因是用户自己删的。
  // 这是启动时唯一的写入。
  it('starting the app writes nothing except emptying entries deleted more than 30 days ago', async () => {
    const repo = await repoWithPrivateData();
    await repo.insertRecord({
      id: 'r2',
      collectionId: 'notes',
      values: { title: 'x' },
      createdAt: NOW.getTime(),
      updatedAt: NOW.getTime(),
    });
    await repo.insertRecord({
      id: 'r3',
      collectionId: 'notes',
      values: { title: 'y' },
      createdAt: NOW.getTime(),
      updatedAt: NOW.getTime(),
    });
    // 第一次打开（存下种子版本），然后用户删了两条：一条 60 天前，一条 5 天前。
    await bootedStore(fixedPlanner(themePlan), repo);
    await repo.deleteRecord('r2', NOW.getTime() - 60 * 86_400_000);
    await repo.deleteRecord('r3', NOW.getTime() - 5 * 86_400_000);
    const spies = spyWrites(repo);
    await bootedStore(fixedPlanner(themePlan), repo);
    expect(spies.filter(([, s]) => s.mock.calls.length > 0).map(([n]) => n)).toEqual([
      'purgeDeletedRecords',
    ]);
    expect((await repo.listDeletedRecords()).map((r) => r.id)).toEqual(['r3']);
    expect((await repo.getRecord('r1'))!.values.body).toContain(SENTINEL);
    jest.restoreAllMocks();
  });
});

describe('底线 11：写数据的操作都能挽回；只有删除弹撤销提示', () => {
  // 创始人 2026-10-31（对话）：「存储东西或者是经过用户确认的操作，就不要撤销了，除了删除操作」。存下的和用户确认过的
  // （表单保存、打勾、一键新建、+1、拖看板、点圆块、批量修改、桌面小组件）不弹撤销，用户用同样简单的操作改回去；
  // 批量修改一定先问（record-actions-test.tsx）。
  afterEach(() => {
    jest.restoreAllMocks();
    useGuide.setState({ stage: null, repo: null });
  });

  // 每个测试重新渲染，但 expo-router 的全局 router 记得上一个测试停在哪：带一个不同的参数，保证推进的是新的一页。
  let visit = 0;
  async function openPage(config: WorkspaceConfig, pageId: string, repo?: MemoryWorkspaceRepo) {
    const app = await renderSeeded(config, 'zh', repo);
    await act(() =>
      router.push({ pathname: '/page/[pageId]', params: { pageId, visit: ++visit } }),
    );
    return app;
  }
  const todoPage = () => openPage(v34('todo'), 'todo');

  it('deleting an entry shows undo', async () => {
    const { store } = await todoPage();
    await fireEvent.press(await screen.findByText('todos 1'));
    await fireEvent.press(await screen.findByTestId('editor-delete'));
    await waitFor(() => expect(store.getState().toast?.restoreRecordId).toBe('todos-1'));
    expect(screen.getByTestId('toast-undo')).toBeTruthy();
  });

  it('adding an entry with the form on the page shows no undo; deleting it does', async () => {
    const { repo, store } = await todoPage();
    await fireEvent.changeText(await screen.findByTestId('form-add-title'), '买牛奶');
    await fireEvent.press(screen.getByTestId('form-add-submit'));
    await settle();
    const added = (await repo.listRecords('todos')).find((r) => r.values.title === '买牛奶')!;
    expect(added).toBeDefined();
    expect(screen.queryByTestId('toast-undo')).toBeNull();
    // 新的一条就在这张表上，点开删掉（删除照常有撤销）。
    await fireEvent.press(await screen.findByText('买牛奶'));
    await fireEvent.press(await screen.findByTestId('editor-delete'));
    await waitFor(() => expect(store.getState().toast?.restoreRecordId).toBe(added.id));
    expect((await repo.listRecords('todos')).some((r) => r.id === added.id)).toBe(false);
  });

  it('ticking a checklist entry shows no undo and is taken back by ticking it again', async () => {
    const { repo } = await todoPage();
    const before = (await repo.getRecord('todos-1'))!.values.done ?? false;
    await fireEvent.press(await screen.findByTestId('check-todos-1'));
    await settle();
    expect((await repo.getRecord('todos-1'))!.values.done).toBe(!before);
    expect(screen.queryByTestId('toast-undo')).toBeNull();
    await fireEvent.press(await screen.findByTestId('check-todos-1'));
    await settle();
    expect((await repo.getRecord('todos-1'))!.values.done ?? false).toBe(before);
  });

  it('a one-tap check-in (tapping a habit tile) shows no undo', async () => {
    const seededRepo = new MemoryWorkspaceRepo();
    await seededRepo.insertRecord({
      id: 'run',
      collectionId: 'habits',
      values: { name: '跑步', plan: { repeat: 'daily' } },
      createdAt: NOW.getTime(),
      updatedAt: NOW.getTime(),
    });
    const { repo } = await openPage(v34('habits'), 'habits', seededRepo);
    const before = (await repo.listRecords('checkins')).length;
    await fireEvent.press(await screen.findByTestId('tile-run'));
    await waitFor(async () => expect(await repo.listRecords('checkins')).toHaveLength(before + 1));
    await settle();
    expect(screen.queryByTestId('toast-undo')).toBeNull();
  });
});

describe('工具清单和搭建计划不破坏底线（D-414、D-415、D-416）', () => {
  const steps = [
    { id: 'theme', kind: 'look', title: '颜色', request: '换颜色' },
    { id: 'pkg', kind: 'file', title: '工具', request: '加图片工具' },
  ] as const;
  const scripted = (calls: string[]): AIProvider => ({
    plan: async (input) => {
      calls.push(input);
      if (input === '搭一个') return { kind: 'build', summary: '一个 App', steps: [...steps] };
      if (input === '换颜色')
        return { kind: 'ops', ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }] };
      return { kind: 'ops', ops: [{ op: 'setPackage', package: 'image', do: 'add' }] };
    },
  });
  const persisted = async (repo: MemoryWorkspaceRepo) =>
    `${(await repo.getMeta('session')) ?? ''}${(await repo.getMeta('build')) ?? ''}`;

  it('底线 1 / 2 / 14：清单和发给 AI 的 <session> 里没有记录内容', async () => {
    const { bodies, fetchImpl } = capturingFetch(relayReply);
    const provider = createRemoteAIProvider({
      baseUrl: 'https://relay.test',
      registry,
      now: () => NOW,
      fetchImpl,
    });
    const { repo, store } = await bootedStore(provider);
    expect(JSON.stringify(await repo.listRecords('notes'))).toContain(SENTINEL);
    await store.getState().change('换个颜色', provider);
    await store.getState().change('再深一点', provider);
    expect(bodies.at(-1)).toContain('<session>');
    for (const body of bodies) expect(body).not.toContain(SENTINEL);
    expect(await persisted(repo)).not.toContain(SENTINEL);
    expect(await persisted(repo)).not.toContain(ASSET);
    expect(JSON.stringify(store.getState().session)).toContain('换个颜色');
  });

  it('底线 7：外观步骤进草稿，功能步骤进正式版本，能在改动记录里撤销', async () => {
    const calls: string[] = [];
    const provider = scripted(calls);
    const { store } = await bootedStore(provider);
    const startId = store.getState().head!.id;
    await store.getState().change('搭一个', provider);
    await store.getState().startBuild();
    const { config, draft, head } = store.getState();
    expect(config!.theme.primaryColor).not.toBe('#2F9E44');
    expect(draft!.steps.at(-1)!.config.theme.primaryColor).toBe('#2F9E44');
    expect(config!.packages.map((p) => p.id)).toContain('image');
    expect(head!.parentId).toBe(startId);
    expect(head!.source).toBe('ai');
  });

  it('底线 8：清单和计划不在配置里，模型的回复写不到它们', async () => {
    const provider: AIProvider = {
      plan: async () =>
        ({
          kind: 'ops',
          ops: [{ op: 'setTheme', primaryColor: '#2F9E44' }],
          session: { items: [] },
        }) as unknown as Plan,
    };
    const { repo, store } = await bootedStore(provider);
    await store.getState().change('记一句', provider);
    const session = await repo.getMeta('session');
    expect(store.getState().config).not.toHaveProperty('session');
    // 多带字段的回复过不了 PlanSchema，什么都没变，清单只记「没做」。
    expect(session).toContain('记一句');
    expect(store.getState().session.items).toEqual([]);
    expect(store.getState().draft).toBeNull();
  });

  it('底线 16：计划不点「开始」不做；重启、停下都不自动继续；一次「开始」连续做完（D-416）', async () => {
    const calls: string[] = [];
    const provider = scripted(calls);
    const repo = new MemoryWorkspaceRepo();
    const make = () =>
      createWorkspaceStore({ repo, provider, registry, locale: 'zh', now: () => NOW });
    const store = make();
    await store.getState().boot();
    await store.getState().change('搭一个', provider);
    const heads = store.getState().head!.id;
    await settle();
    expect(calls).toEqual(['搭一个']);
    expect(store.getState().head!.id).toBe(heads);

    // 重启：还是只有计划。
    const again = make();
    await again.getState().boot();
    await settle();
    expect(calls).toEqual(['搭一个']);
    expect(again.getState().build!.phase).toBe('review');

    await again.getState().startBuild();
    expect(calls).toEqual(['搭一个', '换颜色', '加图片工具']);
    expect(again.getState().build!.phase).toBe('finished');
  });
});
