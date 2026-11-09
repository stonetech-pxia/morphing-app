import { initialPlacement, reducePlacement } from '../run/local/sign-placement';

// 2026-11-09 用户测试：签名默认放在右下角、宽度是页宽的 32%，A4 上约 80 磅高，一放就压住合同里的两行；
// 只能拖，不能点一下放到那一行上。

const page = { width: 1000, height: 1414 };
const aspect = 3;
const shown = { width: 500, height: 707 };
const laidOut = () =>
  reducePlacement(initialPlacement(page, aspect), { type: 'layout', ...shown }, page, aspect);

it('starts about as tall as two and a half lines of body text, not a third of the page', () => {
  const { place } = initialPlacement(page, aspect);
  // 正文行高约短边的 1.9% × 1.3；签名高 2.5 行，宽 = 高 × 3。
  expect(place.width).toBeCloseTo((1000 * 0.019 * 1.3 * 2.5 * 3) / 1000, 3);
  expect(place.width).toBeLessThan(0.32);
});

it('a tap puts the signature on that line: left edge at the finger, bottom on the line', () => {
  const state = reducePlacement(laidOut(), { type: 'tap', x: 100, y: 300 }, page, aspect);
  expect(state.place.x).toBeCloseTo(0.2, 5);
  const heightFraction = (state.place.width * page.width) / aspect / page.height;
  expect(state.place.y + heightFraction).toBeCloseTo(300 / 707, 5);
});

it('the nearest line sets the size until the person picks S / M / L', () => {
  let state = reducePlacement(
    laidOut(),
    { type: 'tap', x: 100, y: 300, lineHeight: 30 },
    page,
    aspect,
  );
  // 2.5 × 30 = 75 高，宽 225，页宽 1000。
  expect(state.place.width).toBeCloseTo(0.225, 5);
  state = reducePlacement(state, { type: 'size', width: 0.45 }, page, aspect);
  state = reducePlacement(state, { type: 'tap', x: 10, y: 600, lineHeight: 30 }, page, aspect);
  expect(state.place.width).toBe(0.45);
});

it('stays on the page near the edges', () => {
  const state = reducePlacement(laidOut(), { type: 'tap', x: 495, y: 5 }, page, aspect);
  expect(state.place.x + state.place.width).toBeLessThanOrEqual(1);
  expect(state.place.y).toBeGreaterThanOrEqual(0);
});
