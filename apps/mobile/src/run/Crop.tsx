import type { Box, TablePage } from '@morph/tool-office';
import { Image } from 'expo-image';
import { View } from 'react-native';

import type { Palette } from '../renderer/theme';

// 原图里一块的截图（D-272、D-328）：整张图按比例放大，只露出这一块（四周多留一点）。
// 文件房间里选中格子、段落时显示在下面，核对认错的字不用切回原图（file-room §11.3）。

/** 截图最高这么多点。 */
const CROP_HEIGHT = 140;

export function Crop({
  page,
  box,
  maxWidth,
  palette,
}: {
  page: Pick<TablePage, 'source' | 'width' | 'height'>;
  box: Box;
  maxWidth: number;
  palette: Palette;
}) {
  const padX = Math.min(box.width * 0.08, 20);
  const padY = Math.min(box.height * 0.15, 12);
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const w = Math.min(page.width - x, box.width + 2 * padX);
  const h = Math.min(page.height - y, box.height + 2 * padY);
  if (w <= 0 || h <= 0) return null;
  const scale = Math.min(maxWidth / w, CROP_HEIGHT / h);
  return (
    <View
      testID="table-crop"
      style={{
        width: w * scale,
        height: h * scale,
        overflow: 'hidden',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: palette.border,
      }}>
      <Image
        source={{ uri: page.source }}
        contentFit="fill"
        style={{
          position: 'absolute',
          left: -x * scale,
          top: -y * scale,
          width: page.width * scale,
          height: page.height * scale,
        }}
      />
    </View>
  );
}
