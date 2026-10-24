import type { ComponentType } from 'react';

import type { LocalKind } from '../../runtime/local';
import type { LocalScreenProps } from '../RunScreen';
import { CornersScreen } from './CornersScreen';
import { CropScreen } from './CropScreen';
import { FillFormScreen } from './FillFormScreen';
import { PagesScreen } from './PagesScreen';
import { PasswordScreen } from './PasswordScreen';
import { RecordEntryScreen } from './RecordEntryScreen';
import { RecordScreen } from './RecordScreen';
import { RedactScreen } from './RedactScreen';
import { ReorderScreen } from './ReorderScreen';
import { SignScreen } from './SignScreen';
import { FrameScreen } from './FrameScreen';
import { TrimScreen } from './TrimScreen';

// 每种本地操作对应的界面。
export const LOCAL_SCREENS: { [K in LocalKind]?: ComponentType<LocalScreenProps<K>> } = {
  crop: CropScreen,
  pages: PagesScreen,
  reorder: ReorderScreen,
  sign: SignScreen,
  fillForm: FillFormScreen,
  corners: CornersScreen,
  redact: RedactScreen,
  trimMedia: TrimScreen,
  frameMedia: FrameScreen,
  record: RecordScreen,
  recordEntry: RecordEntryScreen,
  password: PasswordScreen,
};
