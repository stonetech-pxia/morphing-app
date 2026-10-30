import { isValidTime } from './field-values';
import { SCHEDULE_DUE } from './schedule';
import { PERIODS, RECORD_REF, fieldDefinition, type Collection, type Condition } from './schema';

// 筛选条件的检查：组件的 filter（validate.ts）和汇总字段的 filter（D-288）共用。

/** 筛选条件：字段存在，操作和值是这种字段支持的（字段定义的 filter）。系统字段当作日期。 */
export function conditionProblems(
  conditions: Condition[] | undefined,
  collection: Collection,
  /** 组件所在页面给哪张表的一条记录用（D-332）：引用字段可以 is / isNot "$record"。 */
  recordOf?: string,
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
    // D-332：给一条记录用的页面上，指向那张表的引用字段可以等于（不等于）这条记录。
    if (v === RECORD_REF) {
      if (
        f?.type === 'link' &&
        f.collectionId === recordOf &&
        (cond.op === 'is' || cond.op === 'isNot')
      )
        continue;
      problems.push(
        recordOf
          ? `${where}: "${RECORD_REF}" only works with is / isNot on a link field that points at ${recordOf}`
          : `${where}: "${RECORD_REF}" only works on a page for one entry of a table (page.recordOf)`,
      );
      continue;
    }
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
      case 'due':
        if (!filter.schedule) problems.push(`${where}: due needs a schedule field`);
        else if (!(SCHEDULE_DUE as readonly unknown[]).includes(v))
          problems.push(`${where}: due must be one of ${SCHEDULE_DUE.join(', ')}`);
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
