import { COMMON_FIRST_NAMES, FIRST_NAMES } from './card-names-data';

// 常见的名（ASCII 小写）：至少 1000 人用的、至少 100 人用的两档。姓氏试过没有增益，不用。
let common: Set<string> | null = null;
let known: Set<string> | null = null;

/** 这个名大约有多少人用：至少 1000 人时给 1000，至少 100 人时给 100，否则 0。 */
export function firstCount(word: string): number {
  common ??= new Set(COMMON_FIRST_NAMES.split(' '));
  known ??= new Set(FIRST_NAMES.split(' '));
  return common.has(word) ? 1000 : known.has(word) ? 100 : 0;
}
