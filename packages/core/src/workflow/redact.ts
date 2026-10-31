import { redactFileRefs } from '../file-refs';
import type { Registry } from '../registry';
import type { WorkspaceConfig } from '../schema';

export { REDACTED_FILE } from '../file-refs';

// 发给 AI 的配置（D-065）：用户在快捷操作的参数里自己写的文字（水印、文字戳）换成占位符；
// 指向用户文件的 ID 也换成占位符（底线 3）。

export const REDACTED_TEXT = '<user text>';

export function redactForAI(config: WorkspaceConfig, registry: Registry): WorkspaceConfig {
  const files = redactFileRefs(config);
  return {
    ...files,
    tools: files.tools.map((tool) =>
      tool.kind !== 'quickAction'
        ? tool
        : {
            ...tool,
            steps: tool.steps.map((step) => {
              const fields = registry.actions.get(step.action)?.fields ?? [];
              const hidden = fields.filter((f) => f.private && step.params[f.key] !== undefined);
              if (hidden.length === 0) return step;
              const params = { ...step.params };
              for (const f of hidden) params[f.key] = REDACTED_TEXT;
              return { ...step, params };
            }),
          },
    ),
  };
}
