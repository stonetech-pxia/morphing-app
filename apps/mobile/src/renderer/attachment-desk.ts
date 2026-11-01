import { MAX_ATTACHMENTS } from '@morph/core';

// 记录附件「放到桌上」（D-395）：附件复制一份进新桌面（记录里存的文件不动），在桌上改完点「完成」时每次都问
// 「加成新附件」还是「替换原件」，结果存成用户文件、交回表单（还要用户点保存才写进记录）。
// 交回的通道只在内存里，按桌面 ID（随机的）找；不放进路由参数，外部链接不能借它往记录里塞文件。

export type DeskReturnMode = 'add' | 'replace';

export interface DeskReturn {
  /** 放上桌的那个附件。 */
  assetId: string;
  /** 表单里这个字段现在的文件 ID；表单已经关掉时为 null。 */
  ids(): readonly string[] | null;
  /** 把桌上的结果（已经存成用户文件）交回表单。表单已经关掉时返回 false，什么都不改。 */
  deliver(mode: DeskReturnMode, fresh: readonly string[]): boolean;
}

const returns = new Map<string, DeskReturn>();

/** 表单打开桌面时登记；返回的函数在表单关掉时调用（之后桌面就是普通的桌面）。 */
export function holdDeskReturn(deskId: string, entry: DeskReturn): () => void {
  returns.set(deskId, entry);
  return () => {
    if (returns.get(deskId) === entry) returns.delete(deskId);
  };
}

/** 这个桌面是不是从记录的附件放上来的（房间的「完成」先问怎么放回去）。 */
export const deskReturnOf = (deskId: string): DeskReturn | undefined => returns.get(deskId);

/** 交回以后就不再连着表单。 */
export function endDeskReturn(deskId: string): void {
  returns.delete(deskId);
}

/** 桌上 n 份文件能不能加成新附件、能不能替换原件（最多 MAX_ATTACHMENTS 个）。 */
export function deskReturnChoices(
  ids: readonly string[],
  assetId: string,
  n: number,
): { add: boolean; replace: boolean } {
  return {
    add: n > 0 && ids.length + n <= MAX_ATTACHMENTS,
    replace: n > 0 && ids.includes(assetId) && ids.length - 1 + n <= MAX_ATTACHMENTS,
  };
}

/** 加在最后，或者放在原件的位置上（原件不再在这个字段里）。 */
export function applyDeskReturn(
  ids: readonly string[],
  assetId: string,
  mode: DeskReturnMode,
  fresh: readonly string[],
): string[] {
  if (mode === 'add') return [...ids, ...fresh];
  const at = ids.indexOf(assetId);
  if (at < 0) return [...ids, ...fresh];
  return [...ids.slice(0, at), ...fresh, ...ids.slice(at + 1)];
}
