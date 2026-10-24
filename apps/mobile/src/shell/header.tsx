import type { Palette } from '../renderer/theme';
import { CloseButton } from './CloseButton';

/** 页面栈的导航栏样式（跟随主题）。 */
export function stackScreenOptions(palette: Palette) {
  return {
    headerStyle: { backgroundColor: palette.background },
    headerShadowVisible: false,
    headerTintColor: palette.text,
    headerBackButtonDisplayMode: 'minimal',
    headerTitleStyle: { ...palette.font('title', 17), color: palette.text } as never,
    contentStyle: palette.backdrop,
  } as const;
}

/** 弹出页左上角的「关闭」（D-111）。 */
export function closeButtonOption(palette: Palette) {
  return { headerLeft: () => <CloseButton palette={palette} /> };
}
