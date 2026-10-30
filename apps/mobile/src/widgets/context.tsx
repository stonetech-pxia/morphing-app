import { createContext, useContext } from 'react';

import type { WidgetPlatform } from './types';

// 桌面小组件的平台（D-321）：根布局放本地模块，测试放假的；没有时（Expo Go、Web）为 null。
const WidgetContext = createContext<WidgetPlatform | null>(null);

export const WidgetProvider = WidgetContext.Provider;

export function useWidgetPlatform(): WidgetPlatform | null {
  return useContext(WidgetContext);
}
