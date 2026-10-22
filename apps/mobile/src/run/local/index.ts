import type { ComponentType } from 'react';

import type { LocalKind } from '../../runtime/local';
import type { LocalScreenProps } from '../RunScreen';
import { CropScreen } from './CropScreen';
import { FillFormScreen } from './FillFormScreen';
import { PagesScreen } from './PagesScreen';
import { ReorderScreen } from './ReorderScreen';
import { SignScreen } from './SignScreen';

// 每种本地操作对应的界面。
export const LOCAL_SCREENS: { [K in LocalKind]?: ComponentType<LocalScreenProps<K>> } = {
  crop: CropScreen,
  pages: PagesScreen,
  reorder: ReorderScreen,
  sign: SignScreen,
  fillForm: FillFormScreen,
};
