import { suggestValues, type SuggestInput, type ValueSuggestion } from './rank';

// 新记录表单的候选值从哪里来（D-398）：表单只认这个接口，规则和本机模型都写成这个形状，换引擎不动表单。
// 输入是按页、带位置的文字和这张表的字段；输出是结构化的候选，只进表单，用户点了才填（D-394）。
// 这不是快捷操作的一步：步骤之间只传一个值，走到这里文件就没了，输出也会流到分享、存文件这些步骤（D-396）。

/** 字段 ID → 候选（好的在前，最多 MAX_SUGGESTIONS 个）。 */
export type FieldSuggestions = Record<string, ValueSuggestion[]>;

/** signal 取消时引擎应该尽快结束；结果和报错这时都不会再用。 */
export type PrefillEngine = (
  input: SuggestInput,
  signal?: AbortSignal,
) => Promise<FieldSuggestions>;

/** 现在用的引擎：规则打分（D-394）。 */
export const ruleEngine: PrefillEngine = async (input) => suggestValues(input);
