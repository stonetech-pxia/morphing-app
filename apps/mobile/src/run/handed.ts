import type { HandedFiles, RunValue } from '@morph/core';

// 容器交给运行页面的值（D-428）：记录内容不能放进路由参数，所以路由只带一个键，值放在内存里。
// 只留最新的一份；App 被杀掉后键对不上，运行页面说明要从记录页或列表上点，不会空着跑。

let slot: { key: string; value: RunValue | HandedFiles } | null = null;
let next = 0;

export function handOver(value: RunValue | HandedFiles): string {
  const key = String(++next);
  slot = { key, value };
  return key;
}

export const readHanded = (key: string | undefined): RunValue | HandedFiles | null =>
  slot && slot.key === key ? slot.value : null;

export function dropHanded(key: string | undefined): void {
  if (slot?.key === key) slot = null;
}
