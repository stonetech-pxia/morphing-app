import type { ComponentType } from 'react';

import type { LocalKind } from '../../runtime/local';
import type { LocalScreenProps } from '../RunScreen';
import { ReorderScreen } from './ReorderScreen';

// 每种本地操作对应的界面。
export const LOCAL_SCREENS: { [K in LocalKind]?: ComponentType<LocalScreenProps<K>> } = {
  reorder: ReorderScreen,
};
