import {
  applyOps,
  type AskRequest,
  BUILTIN_TOOLS,
  createDefaultWorkspace,
  createRegistry,
  quickActionsOf,
  type Workflow,
} from '@morph/core';

import type { LocalUi } from '../runtime/local';
import { isBackgroundAction, startRun } from '../runtime/runner';
import { MemoryWorkspaceRepo } from '../storage/memory';
import { FakeBackground, FakeFiles, FakeMedia } from '../test-utils/fake-files';

// 长任务切到后台也继续（D-160–D-162）：含视频、音频步骤的运行前后保活，进度写进通知，
// 不在前台时发完成通知；短任务不碰。原生模块 morph-background 换成 FakeBackground。

const registry = createRegistry(BUILTIN_TOOLS);
const MB = 1024 * 1024;

function videoWorkflow(id: string): Workflow {
  const result = applyOps(
    createDefaultWorkspace('zh'),
    [{ op: 'setPackage', package: 'video', do: 'add' }],
    {
      registry,
      locale: 'zh',
    },
  );
  if (!result.ok) throw new Error(result.error);
  return quickActionsOf(result.config).find((w) => w.id === id)!;
}

let ids = 0;
function setup(workflow: Workflow, opts: { signal?: { cancelled: boolean } } = {}) {
  const files = new FakeFiles();
  const background = new FakeBackground();
  files.background = background;
  files.nextVideos = [files.offerVideo('a.mov', { size: 100 * MB })];
  const ui: LocalUi = {
    confirm: async () => false,
    choose: async () => null,
    open: async () => null as never,
  };
  // 每次读时间往后走 2 秒：进度通知不被「一秒最多一次」挡掉。
  let clock = new Date(2026, 9, 24).getTime();
  const run = async () =>
    (
      await startRun({
        workflow,
        revisionId: 1,
        repo: new MemoryWorkspaceRepo(),
        files,
        registry,
        locale: 'zh',
        now: () => new Date((clock += 2000)),
        newId: () => `id${++ids}`,
        ui,
        askParams: async (request: AskRequest) => request.params,
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
    ).result;
  return { files, background, media: files.media as FakeMedia, run };
}

describe('background runs', () => {
  it('knows which actions run long', () => {
    expect(isBackgroundAction('video.compress')).toBe(true);
    expect(isBackgroundAction('audio.transcribe')).toBe(true);
    expect(isBackgroundAction('image.resize')).toBe(false);
  });

  it('asks for notifications, keeps the run alive and writes progress into the notification', async () => {
    const workflow = videoWorkflow('video-compress');
    const { background, run } = setup(workflow);
    expect((await run()).status).toBe('succeeded');
    const kinds = background.calls.map((c) => c.kind);
    expect(kinds[0]).toBe('permission');
    expect(background.calls[1]).toEqual({ kind: 'begin', title: workflow.name, text: '准备中…' });
    expect(kinds.at(-1)).toBe('end');
    const compress = workflow.steps.findIndex((s) => s.action === 'video.compress');
    expect(background.calls).toContainEqual({
      kind: 'update',
      text: `第 ${compress + 1}/${workflow.steps.length} 步：压缩视频`,
      fraction: null,
    });
    expect(background.calls).toContainEqual({
      kind: 'update',
      text: `第 ${compress + 1}/${workflow.steps.length} 步：压缩视频 · 50%`,
      fraction: 0.5,
    });
    // 在前台结束：不发完成通知。
    expect(background.calls.at(-1)).toEqual({ kind: 'end', done: null });
  });

  it('sends a finished notice only when Morph is in the background', async () => {
    const workflow = videoWorkflow('video-compress');
    const done = setup(workflow);
    done.background.foreground = false;
    expect((await done.run()).status).toBe('succeeded');
    expect(done.background.calls.at(-1)).toEqual({
      kind: 'end',
      done: { title: `「${workflow.name}」处理完了`, body: '点这里看结果。' },
    });

    const failed = setup(workflow);
    failed.background.foreground = false;
    failed.media.failWith = 'ERR_MEDIA_UNSUPPORTED';
    expect((await failed.run()).status).toBe('failed');
    expect(failed.background.calls.at(-1)).toEqual({
      kind: 'end',
      done: { title: `「${workflow.name}」没有完成`, body: '点这里看看是怎么回事。' },
    });

    // 用户自己停的：不用通知。
    const stopped = setup(workflow, { signal: { cancelled: true } });
    stopped.background.foreground = false;
    expect((await stopped.run()).status).toBe('cancelled');
    expect(stopped.background.calls.at(-1)).toEqual({ kind: 'end', done: null });
  });

  it('runs normally in the foreground when the system refuses to keep it alive', async () => {
    const { background, run } = setup(videoWorkflow('video-convert'));
    background.canBegin = false;
    expect((await run()).status).toBe('succeeded');
    expect(background.calls.map((c) => c.kind)).toEqual(['permission', 'begin']);
  });

  it('leaves runs without long steps alone', async () => {
    const workflow = videoWorkflow('video-compress');
    const short = {
      ...workflow,
      steps: workflow.steps.filter((s) => !isBackgroundAction(s.action)),
    };
    const { background, run } = setup(short);
    await run();
    expect(background.calls).toEqual([]);
  });
});
