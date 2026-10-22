import { CURRENT_SCHEMA_VERSION } from './schema';

// Schema 迁移（§7E）：恢复旧快照时逐级升级到当前版本，然后再校验。
// 每次提升 CURRENT_SCHEMA_VERSION，都必须在 MIGRATIONS 中加入上一版本的迁移函数和测试。

export type Migration = (config: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] 把 schemaVersion n 升级到 n + 1。 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

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
