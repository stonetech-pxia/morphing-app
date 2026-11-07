import { describe, expect, it } from 'vitest';

import { appConfigFile, readAppConfigFile } from './config-file';
import { workspace } from './test-helpers';

describe('readAppConfigFile', () => {
  it('reads an exported file and a bare configuration', () => {
    const config = workspace('zh');
    expect(readAppConfigFile(appConfigFile(config, new Date()))).toEqual(config);
    expect(readAppConfigFile(JSON.stringify(config))).toEqual(config);
  });

  it.each([
    'not json',
    '[]',
    '{"hello":1}',
    '{"format":"morph-app-config"}',
    '{"format":"morph-app-config","config":{"nope":1}}',
    '{"format":"morph-layout-store","config":{"schemaVersion":38}}',
  ])('refuses %s', (text) => {
    expect(readAppConfigFile(text)).toBeNull();
  });
});
