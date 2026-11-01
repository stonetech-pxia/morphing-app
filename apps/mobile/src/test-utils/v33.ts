import { migrateWorkspace, type WorkspaceConfig } from '@morph/core';

// 仅供测试：照旧写的 v33 配置经过迁移链升到 v34（只迁移、不校验）。
// 新测试直接写 v34；只有输入很长、断言不看它的形状时才用这个。
export function fromV33(raw: unknown): WorkspaceConfig {
  const result = migrateWorkspace({ schemaVersion: 33, ...(raw as object) });
  if (!result.ok) throw new Error(result.error);
  return result.config as WorkspaceConfig;
}
