import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// D-454：页面上只有两条竖线：方块的边和方块外面的字贴着页面边距 palette.pad，方块里面的内容缩进 palette.inset。
// 这些文件画的是浮在页面上或贴着页面边的东西：贴着页面边的左右距离只能来自 palette。

const SRC = join(__dirname, '..');
const FILES = [
  'shell/Shell.tsx',
  'shell/Banner.tsx',
  'shell/ChangeScreen.tsx',
  'shell/AISettingsScreen.tsx',
  'guide/GuideBubble.tsx',
  'guide/GuideCard.tsx',
  'guide/SampleHint.tsx',
  'desk/DeskResume.tsx',
  'renderer/IconButton.tsx',
  'renderer/FileList.tsx',
  'renderer/RecentActions.tsx',
  'app/files.tsx',
];

/**
 * 写死的、贴着页面边的左右距离：left / right / marginHorizontal 写数字，或者自己算 pad - 2。
 * 小按钮、小胶囊自己里面的留白（paddingHorizontal: 12 这种）和一位数的形状偏移（气泡尖角）不算。
 */
const HARD_CODED = /\b(?:left|right|marginHorizontal): [1-9]\d\b|pad - 2/;

describe('page alignment uses the two theme lines (D-454)', () => {
  it.each(FILES)('%s has no hard-coded side spacing', (file) => {
    const lines = readFileSync(join(SRC, file), 'utf8')
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => !line.trim().startsWith('//') && HARD_CODED.test(line));
    expect(lines).toEqual([]);
  });
});
