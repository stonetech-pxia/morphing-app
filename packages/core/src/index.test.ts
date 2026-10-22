import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION } from './index';

describe('core', () => {
  it('exposes a positive integer schema version', () => {
    expect(Number.isInteger(CURRENT_SCHEMA_VERSION)).toBe(true);
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
