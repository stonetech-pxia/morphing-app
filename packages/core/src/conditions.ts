import { isValidTime } from './field-values';
import { PERIODS, fieldDefinition, type Collection, type Condition } from './schema';

// 筛选条件的检查：组件的 filter（validate.ts）和汇总字段的 filter（D-288）共用。

/** 筛选条件：字段存在，操作和值是这种字段支持的（字段定义的 filter）。系统字段当作日期。 */
export function conditionProblems(
  conditions: Condition[] | undefined,
  collection: Collection,
): string[] {
  const problems: string[] = [];
  for (const cond of conditions ?? []) {
    const system = cond.field === 'createdAt' || cond.field === 'updatedAt';
    const f = collection.fields.find((x) => x.id === cond.field);
    if (!system && !f) {
      problems.push(`filter field ${cond.field} is not a field of ${collection.id}`);
      continue;
    }
    const type = system ? 'date' : f!.type;
    const { filter } = fieldDefinition(type);
    const v = cond.value;
    const where = `filter on ${cond.field}`;
    // 引用字段只能看有没有选（D-250）：记录 ID 对 AI 和用户都没有意义。
    if (filter.emptyOnly && cond.op !== 'isEmpty' && cond.op !== 'isNotEmpty') {
      problems.push(`${where}: a ${type} field can only be filtered with isEmpty or isNotEmpty`);
      continue;
    }
    switch (cond.op) {
      case 'isEmpty':
      case 'isNotEmpty':
        break;
      case 'inPeriod':
        if (!filter.period) problems.push(`${where}: inPeriod needs a date field`);
        else if (!(PERIODS as readonly unknown[]).includes(v)) {
          problems.push(`${where}: period must be one of ${PERIODS.join(', ')}`);
        }
        break;
      case 'contains':
        if (!filter.contains) problems.push(`${where}: contains needs a text field`);
        else if (typeof v !== 'string') problems.push(`${where}: value must be text`);
        break;
      case 'gt':
      case 'lt':
        if (
          filter.compare === 'number'
            ? typeof v !== 'number'
            : filter.compare === 'time'
              ? typeof v !== 'string' || !isValidTime(v)
              : filter.compare !== 'date' || typeof v !== 'string'
        ) {
          problems.push(`${where}: ${cond.op} needs a number or date field and a matching value`);
        }
        break;
      case 'is':
      case 'isNot': {
        // 系统字段没有定义，按日期（文字）比较。
        const ok = f ? filter.is(f, v) : typeof v === 'string';
        if (!ok) problems.push(`${where}: value does not match the field type`);
        break;
      }
    }
  }
  return problems;
}
