import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CUSTOM_ICON_NAMES, ICON_NAMES, IconSchema } from '@morph/core';
import { render } from '@testing-library/react-native';

import { Icon, iosSymbolName } from '../renderer/Icon';

// 预设自带的图形图标（D-485）：8 个，每个有源 SVG 和按主题染色的 PNG，配置里可以当图标名用。

const ASSETS = join(__dirname, '../../assets');

describe('custom icons', () => {
  it('are eight, all on the icon whitelist', () => {
    expect([...CUSTOM_ICON_NAMES]).toEqual([
      'wallet',
      'rings',
      'moon',
      'timer',
      'book',
      'board',
      'suitcase',
      'vinyl',
    ]);
    for (const name of CUSTOM_ICON_NAMES) {
      expect(ICON_NAMES).toContain(name);
      expect(IconSchema.safeParse(name).success).toBe(true);
    }
  });

  it.each(CUSTOM_ICON_NAMES)('%s has its SVG source and a single-colour PNG', (name) => {
    const svg = join(ASSETS, 'preset-icons', `${name}.svg`);
    const png = join(ASSETS, 'images/preset-icons', `${name}.png`);
    expect(existsSync(svg)).toBe(true);
    expect(readFileSync(svg, 'utf8')).toContain('viewBox="0 0 24 24"');
    // PNG 签名；144×144，有透明底（RGBA）。
    const bytes = readFileSync(png);
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.readUInt32BE(16)).toBe(144);
    expect(bytes.readUInt32BE(20)).toBe(144);
    expect(bytes[25]).toBe(6);
  });

  it.each(CUSTOM_ICON_NAMES)('%s draws as an image in the theme colour', async (name) => {
    const { getByTestId } = await render(<Icon name={name} size={30} color="#ff0000" />);
    const style = getByTestId(`icon-${name}`).props.style;
    expect(style).toMatchObject({ width: 30, height: 30, tintColor: '#ff0000' });
    // 系统图标库里没有，长按菜单里不带图标。
    expect(iosSymbolName(name)).toBeUndefined();
  });
});
