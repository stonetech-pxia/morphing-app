import { describe, expect, it } from 'vitest';

import {
  APP_CONFIG_FILE_FORMAT,
  MAX_APP_CONFIG_SIZE,
  appConfigFile,
  parseAppConfigFile,
} from './config-file';
import { CURRENT_SCHEMA_VERSION } from './schema';
import { workspace } from './test-helpers';

// 门户下载的预设文件和导出的文件是同一个格式；读不了的要说清楚是哪一种原因（底线 18）。
describe('parseAppConfigFile', () => {
  const exported = (extra: Record<string, unknown> = {}, config: unknown = workspace('zh')) =>
    JSON.stringify({
      format: APP_CONFIG_FILE_FORMAT,
      version: 1,
      exportedAt: 'x',
      config,
      ...extra,
    });

  it('reads an exported file and a bare configuration', () => {
    const config = workspace('zh');
    expect(parseAppConfigFile(exported())).toEqual({ ok: true, config });
    expect(parseAppConfigFile(JSON.stringify(config))).toEqual({ ok: true, config });
  });

  it('keeps an old configuration as it is: migrating is the next step, not this one (底线 12)', () => {
    const old = { ...workspace('zh'), schemaVersion: 20 };
    expect(parseAppConfigFile(exported({}, old))).toEqual({ ok: true, config: old });
  });

  it.each([
    ['not json', 'notJson'],
    ['', 'notJson'],
    ['[]', 'wrongFormat'],
    ['{"hello":1}', 'wrongFormat'],
    ['{"format":"morph-app-config"}', 'wrongFormat'],
    ['{"format":"morph-app-config","version":1}', 'wrongFormat'],
    ['{"format":"morph-app-config","version":1,"config":{"nope":1}}', 'wrongFormat'],
    [
      `{"format":"morph-layout-store","version":1,"config":{"schemaVersion":${CURRENT_SCHEMA_VERSION}}}`,
      'wrongFormat',
    ],
  ])('refuses %j as %s', (text, problem) => {
    expect(parseAppConfigFile(text)).toEqual({ ok: false, problem });
  });

  it('refuses an exported file without a usable version number', () => {
    for (const version of [undefined, 0, -1, 1.5, '1', null])
      expect(parseAppConfigFile(exported({ version }))).toEqual({
        ok: false,
        problem: 'wrongFormat',
      });
  });

  it('says so when the file or its configuration comes from a newer app', () => {
    expect(parseAppConfigFile(exported({ version: 2 }))).toEqual({
      ok: false,
      problem: 'newerApp',
    });
    const future = { ...workspace('zh'), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(parseAppConfigFile(exported({}, future))).toEqual({ ok: false, problem: 'newerApp' });
    expect(parseAppConfigFile(JSON.stringify(future))).toEqual({ ok: false, problem: 'newerApp' });
  });

  it('refuses a file that is too large before parsing it', () => {
    const padding = ' '.repeat(MAX_APP_CONFIG_SIZE + 1);
    expect(parseAppConfigFile(exported() + padding)).toEqual({ ok: false, problem: 'tooLarge' });
    // 刚好在上限里的没问题。
    const ok = exported();
    expect(ok.length).toBeLessThan(MAX_APP_CONFIG_SIZE);
    expect(parseAppConfigFile(ok + ' '.repeat(MAX_APP_CONFIG_SIZE - ok.length)).ok).toBe(true);
  });

  it('a real exported app fits the limit with a lot of room', () => {
    expect(appConfigFile(workspace('zh'), new Date()).length).toBeLessThan(
      MAX_APP_CONFIG_SIZE / 10,
    );
  });
});
