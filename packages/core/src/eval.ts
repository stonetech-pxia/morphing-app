// 评测和验收（开发用，不进 App）：真实模型评测集、个人记录能力验收的场景和打分。
// 不从 @morph/core 的主入口导出（R12）：App 几乎都从主入口导入，评测集有七千多行，不该跟着带进去。
// 用法：import { EVAL_CASES, runEvalCase } from '@morph/core/src/eval';（和 @morph/tool-office/src/test-helpers 一样走 src 路径）。
// mock AI（ai/mock）是 App 的离线功能，留在主入口。

export * from './ai/eval-cases';
export * from './acceptance';
