import { RECORD_REF, type Component } from './schema';

// 给一条记录用的页面（D-332）：配置里写的是 "$record"，打开页面时在本机换成那条记录的 ID。
// 只换组件里正好等于 "$record" 的值（筛选的 value、新建的预设值），别的不动；AI 看不到 ID（D-042）。

function bind(value: unknown, recordId: string): unknown {
  if (value === RECORD_REF) return recordId;
  if (Array.isArray(value)) return value.map((v) => bind(v, recordId));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = bind(v, recordId);
    return out;
  }
  return value;
}

/** 组件（连同分组里的子组件）里的 "$record" 换成这条记录的 ID（渲染时用，配置本身不变）。 */
export function bindRecord<C extends Component>(component: C, recordId: string): C {
  return bind(component, recordId) as C;
}
