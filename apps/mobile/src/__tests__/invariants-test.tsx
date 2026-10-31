import {
  BUILTIN_TOOLS,
  DATA_TEMPLATES,
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

// Morph 的 18 条底线（AGENTS.md「底线」，创始人 2026-10-31 暂定）在 App 这一层的守护测试：发给 AI 的请求、
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

  it('Morph server mode: the AI page, the inbox and the draft chat send no data', async () => {
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
    // 配置本身是发了的（AI 要看结构），文件位只是一个随机 ID。
    expect(bodies[0]).toContain('notes');
    expect(bodies[0]).toContain(ASSET);
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
  // 违反底线 3，待创始人决定：AI 能在修改里写 {file: <文件 ID>} 或图片的 asset，让一个文件位指向用户的另一个
  // 文件（AI 看得到配置里的文件 ID）。prepareOps 不分来源，AI 那一路没有「新出现的文件 ID 一律拒绝」的检查。
  it.failing(
    'AI cannot point a file slot at one of the user’s files; only the user picks it',
    async () => {
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
    },
  );

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

  it('an AI change can never reach the entries: the store only gets a configuration back', async () => {
    const plan: Plan = { kind: 'ops', ops: [{ op: 'removeData', table: 'notes' }] };
    const { repo, store } = await bootedStore(fixedPlanner(plan));
    await store.getState().change('删掉笔记表', fixedPlanner(plan));
    expect((await repo.listRecords('notes')).length).toBe(1);
    expect(await repo.listDeletedRecords()).toEqual([]);
  });
});

describe('底线 7：每次修改先进草稿，用户确认才生效', () => {
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

  // 违反底线 7，待创始人决定：功能类修改（加表、加字段、加快捷操作、加工具包）按 D-191 不进草稿，直接存成
  // 一个 AI 版本（顶部「已改好 · 撤销」，能撤销，但没有先确认）。底线写的是「每次修改先进草稿，用户确认才生效」。
  it.failing(
    'an AI change to function (a new table) also waits for the user to confirm',
    async () => {
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
      const { store } = await bootedStore(fixedPlanner(plan));
      const head = store.getState().head!.id;
      await store.getState().change('加一张书的表', fixedPlanner(plan));
      expect(store.getState().head!.id).toBe(head);
    },
  );
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
  'discardRecord',
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

function withTemplate(template: (typeof DATA_TEMPLATES)[number]): WorkspaceConfig {
  const config = createDefaultWorkspace('zh');
  const r = applyOps(config, templateOps(template, config, 'zh'), { registry, locale: 'zh' });
  if (!r.ok) throw new Error(r.error);
  return r.config;
}

const VIEWED: [string, () => WorkspaceConfig, Locale][] = [
  ['default (fr)', () => createDefaultWorkspace('fr'), 'fr'],
  ...DATA_TEMPLATES.map((t): [string, () => WorkspaceConfig, Locale] => [
    `template ${t}`,
    () => withTemplate(t),
    'zh',
  ]),
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

describe('底线 15 / 16：看永远不会改；每次写入都来自用户的一次操作', () => {
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

  // 违反底线 16（可能），待创始人决定：启动时把放进「最近删除」超过保留期的记录永久删掉（D-037，revisions.ts
  // bootHead）。记录是用户自己删的，但永久删除这一步没有用户操作。
  it.failing('starting the app never changes entries, not even old deleted ones', async () => {
    const repo = await repoWithPrivateData();
    await repo.deleteRecord('r1', NOW.getTime() - 60 * 86_400_000);
    await bootedStore(fixedPlanner(themePlan), repo);
    expect((await repo.listDeletedRecords()).map((r) => r.id)).toEqual(['r1']);
  });
});

describe('底线 11：写数据的操作都能撤销', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    useGuide.setState({ stage: null, repo: null });
  });

  // 每个测试重新渲染，但 expo-router 的全局 router 记得上一个测试停在哪：带一个不同的参数，保证推进的是新的一页。
  let visit = 0;
  async function todoPage() {
    const app = await renderSeeded(v34('todo'), 'zh');
    await act(() =>
      router.push({ pathname: '/page/[pageId]', params: { pageId: 'todo', visit: ++visit } }),
    );
    return app;
  }

  it('deleting an entry shows undo', async () => {
    const { store } = await todoPage();
    await fireEvent.press(await screen.findByText('todos 1'));
    await fireEvent.press(await screen.findByTestId('editor-delete'));
    await waitFor(() => expect(store.getState().toast?.restoreRecordId).toBe('todos-1'));
  });

  // 违反底线 11，待创始人决定：页面上的表单（inline / sheet）添加一条后没有撤销（records.ts add 不出提示条）；
  // 记录编辑页保存修改也没有撤销。只能手动删掉或改回去。
  it.failing('adding an entry with the form on the page can be undone', async () => {
    const { repo, store } = await todoPage();
    await fireEvent.changeText(await screen.findByTestId('form-add-title'), '买牛奶');
    await fireEvent.press(screen.getByTestId('form-add-submit'));
    await settle();
    expect((await repo.listRecords('todos')).length).toBe(4);
    expect(store.getState().toast?.undo).toBeDefined();
  });

  // 违反底线 11，待创始人决定：清单上打勾直接写记录（renderer/data.tsx 的 toggle 调 actions.update），不弹可以
  // 撤销的提示条；再点一下能取消，但不是「撤销」。一键记录的其他工具（button、tap、drag）都有撤销。
  it.failing('ticking a checklist entry can be undone', async () => {
    const { repo, store } = await todoPage();
    await fireEvent.press(await screen.findByTestId('check-todos-1'));
    await settle();
    expect((await repo.getRecord('todos-1'))!.values.done).toBe(true);
    expect(store.getState().toast?.undo).toBeDefined();
  });
});
