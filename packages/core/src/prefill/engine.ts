import { withDocKind } from './doc-context';
import { mergedSuggestions, planDocument, type DocumentPlan, type FieldPlan } from './code-rules';
import {
  MODEL_LIMITS,
  modelAnswers,
  modelRequest,
  type ModelLimits,
  type ModelSession,
  type OpenModel,
} from './model';
import type { Field } from '../schema';
import type { SuggestInput, ValueSuggestion } from './rank';

// 新记录表单的候选值从哪里来（D-398）：表单只认这个接口，规则和本机模型都写成这个形状，换引擎不动表单。
// 输入是按页、带位置的文字和这张表的字段；输出是结构化的候选，只进表单，用户点了才填（D-394）。
// 这不是快捷操作的一步：步骤之间只传一个值，走到这里文件就没了，输出也会流到分享、存文件这些步骤（D-396）。

/** 单行文字字段放不下换行（多行地址）：表单上显示和填进去的都用逗号隔开。 */
export const suggestionForField = (field: Pick<Field, 'type'>, s: ValueSuggestion) =>
  field.type === 'text' && s.value.includes('\n')
    ? { ...s, value: s.value.replace(/\n+/g, ', ') }
    : s;

/** 字段 ID → 候选（好的在前，最多 MAX_SUGGESTIONS 个）。 */
export type FieldSuggestions = Record<string, ValueSuggestion[]>;

/**
 * signal 取消时引擎应该尽快结束；结果和报错这时都不会再用。
 * 要跑一会儿的引擎用 onPartial 先给手上有的（可以调多次，每次是当时全部的候选），最后的结果在返回值里。
 */
export type PrefillEngine = (
  input: SuggestInput,
  signal?: AbortSignal,
  onPartial?: (suggestions: FieldSuggestions) => void,
) => Promise<FieldSuggestions>;

function suggestionsOf(
  plan: DocumentPlan,
  model: ReadonlyMap<FieldPlan, readonly string[]>,
): FieldSuggestions {
  const out: FieldSuggestions = {};
  for (const f of plan.fields) {
    const list = mergedSuggestions(f, model.get(f) ?? [], plan.pickOf);
    if (list.length > 0) out[f.field.id] = list;
  }
  return out;
}

/** 只用代码：规则打分、算术、中文规则、值记忆。模型没装时用的就是这些。 */
export const ruleEngine: PrefillEngine = async (input) =>
  suggestionsOf(planDocument(input), new Map());

/**
 * 等 work，但 stop 取消或到时间就不等了（给 undefined）。work 自己可能永远不回来（原生卡住），
 * 表单不能跟着等（取消一定要让 Promise 结束）。
 */
function bounded<T>(work: Promise<T>, stop: AbortSignal, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      stop.removeEventListener('abort', finish);
      resolve(undefined);
    };
    const timer = setTimeout(finish, ms);
    if (stop.aborted) return finish();
    stop.addEventListener('abort', finish);
    work.then(
      (value) => {
        clearTimeout(timer);
        stop.removeEventListener('abort', finish);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        stop.removeEventListener('abort', finish);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

const free = (session: ModelSession) => void session.release().catch(() => undefined);

/**
 * 代码 + 本机模型（D-396）：先给代码的候选，再一个字段一个字段地问代码拿不准的，答完一个补一个。
 * 没装、内存不够、加载失败、超时、取消：一律安静结束，留着已经有的候选，不报错。
 */
export function modelEngine(open: OpenModel, limits: ModelLimits = MODEL_LIMITS): PrefillEngine {
  return async (input, signal, onPartial) => {
    const plan = planDocument(input);
    const answers = new Map<FieldPlan, readonly string[]>();
    let current = suggestionsOf(plan, answers);
    onPartial?.(current);
    const asks = plan.fields.filter((f) => f.ask);
    if (asks.length === 0 || signal?.aborted) return current;

    // 调用方取消和总时间都走这一个信号，生成也跟着停。
    const stop = new AbortController();
    const abort = () => stop.abort();
    signal?.addEventListener('abort', abort);
    const total = setTimeout(abort, limits.totalMs);
    let session: ModelSession | null | undefined;
    try {
      const opening = open(stop.signal);
      // 不等加载了（取消、超时）：它回来以后也要释放。
      session = await bounded(opening, stop.signal, limits.openMs);
      if (session === undefined) {
        void opening.then((late) => late && free(late)).catch(() => undefined);
        stop.abort();
        return current;
      }
      if (session === null) return current;
      for (const f of asks) {
        const answer = await bounded(
          session.generate(
            withDocKind(plan.kind, () => modelRequest(f.field, plan.rows, limits)),
            stop.signal,
          ),
          stop.signal,
          limits.callMs,
        );
        // 卡住或取消：后面的字段也不问了。
        if (answer === undefined) {
          stop.abort();
          break;
        }
        const found = withDocKind(plan.kind, () =>
          modelAnswers(f.field, answer, plan.rows, input.locale),
        );
        if (found.length === 0) continue;
        answers.set(f, found);
        current = suggestionsOf(plan, answers);
        onPartial?.(current);
      }
    } catch {
      // 退回已经有的候选（D-396）：模型出问题不影响表单。
    } finally {
      clearTimeout(total);
      signal?.removeEventListener('abort', abort);
      if (session) free(session);
    }
    return current;
  };
}
