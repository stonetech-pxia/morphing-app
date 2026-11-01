// 仅供测试使用（不从 index.ts 导出）：v34 等价测试用的确定的记录。照搬 v33 生成器
// （git show 611d201:packages/core/src/v33-golden.gen.test.ts 的 sampleRecords），只把引用字段的
// collectionId 改成 table；字段顺序、随机数的调用次数都不变，所以生成的记录和 v33 那次一模一样。
import type { DataRecord } from './data';
import type { Collection } from './schema';

/** 生成 fixtures/v33/derived/ 时的「现在」。 */
export const V33_NOW = new Date(2026, 9, 22, 9, 0);

/** 确定的伪随机数（按表 ID 播种）。 */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayString = (offset: number) => {
  const d = new Date(V33_NOW.getFullYear(), V33_NOW.getMonth(), V33_NOW.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'kappa', 'sigma'];

/** 每张表 30 条记录；引用字段指向被引用的表的记录（ID 是 <表>-<序号>）。 */
export function sampleRecords(collections: readonly Collection[]): Map<string, DataRecord[]> {
  const NOW = V33_NOW;
  const out = new Map<string, DataRecord[]>();
  for (const c of collections) {
    const r = rng(c.id);
    const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
    const list: DataRecord[] = [];
    for (let i = 0; i < 30; i++) {
      const values: Record<string, unknown> = {};
      for (const f of c.fields) {
        if (r() < 0.12 && !('required' in f && f.required)) continue;
        switch (f.type) {
          case 'text':
          case 'note':
            values[f.id] = `${pick(WORDS)} ${i}`;
            break;
          case 'number':
          case 'money':
            values[f.id] = Math.round(r() * 2000) / 10;
            break;
          case 'rating':
            values[f.id] = 1 + Math.floor(r() * 5);
            break;
          case 'duration':
            values[f.id] = Math.floor(r() * 300);
            break;
          case 'checkbox':
            values[f.id] = r() < 0.5;
            break;
          case 'date':
            values[f.id] = dayString(Math.floor(r() * 70) - 50);
            break;
          case 'time':
            values[f.id] = `${pad(Math.floor(r() * 24))}:${pad(Math.floor(r() * 60))}`;
            break;
          case 'datetime':
            values[f.id] =
              NOW.getTime() - Math.floor(r() * 50 * 86400000) + Math.floor(r() * 5 * 86400000);
            break;
          case 'choice':
            values[f.id] = pick(f.options).id;
            break;
          case 'link':
            values[f.id] = `${f.table}-${Math.floor(r() * 30)}`;
            break;
          case 'schedule':
            values[f.id] = pick([
              { repeat: 'daily' },
              { repeat: 'once', date: dayString(Math.floor(r() * 20) - 5) },
              { repeat: 'once' },
              { repeat: 'weekdays', days: [1, 3, 5] },
              { repeat: 'interval', every: 3, unit: 'day' },
            ]);
            break;
          default:
            break;
        }
      }
      const created = NOW.getTime() - Math.floor(r() * 60 * 86400000);
      list.push({
        id: `${c.id}-${i}`,
        collectionId: c.id,
        values,
        createdAt: created,
        updatedAt: created + Math.floor(r() * 5 * 86400000),
      });
    }
    out.set(c.id, list);
  }
  return out;
}
