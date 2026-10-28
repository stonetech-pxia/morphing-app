import { createContext, useContext } from 'react';

import type { HomeScreenPlatform } from './platform';

// 手机桌面的平台（D-271）：根布局放本地模块，测试放假的；没有时（Expo Go、Web）为 null。
const HomeScreenContext = createContext<HomeScreenPlatform | null>(null);

export const HomeScreenProvider = HomeScreenContext.Provider;

export function useHomeScreenPlatform(): HomeScreenPlatform | null {
  return useContext(HomeScreenContext);
}
