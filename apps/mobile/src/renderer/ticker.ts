import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

// 正在走的计时（D-303 的 elapsed）每秒刷新一次。所有正在走的行共用一个计时器：没有正在走的行时不跑，
// App 退到后台时也停（回到前台马上刷新一次），省电。只有显示出来的、没有结束时间的行才订阅。

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let active = AppState.currentState !== 'background';

function sync() {
  const want = active && listeners.size > 0;
  if (want && !timer) timer = setInterval(() => listeners.forEach((l) => l()), 1000);
  if (!want && timer) {
    clearInterval(timer);
    timer = null;
  }
}

AppState.addEventListener?.('change', (state) => {
  active = state === 'active';
  if (active) listeners.forEach((l) => l());
  sync();
});

/** running 为 true 时每秒返回新的现在；为 false 时不订阅。 */
export function useTicker(running: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(new Date());
    listeners.add(tick);
    sync();
    return () => {
      listeners.delete(tick);
      sync();
    };
  }, [running]);
  return now;
}
