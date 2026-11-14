import { describe, expect, it } from 'vitest';

import { findPageGutter } from './word-gutter';

const page = { width: 1400, height: 2000 };
const line = (x: number, y: number, width: number, text: string) => ({
  x,
  y,
  width,
  height: 20,
  text,
});
/** 一栏小表单：每排一个标签，有的排右边还有一个短标签（和另一栏同一高度）。 */
const form = (x: number) =>
  Array.from({ length: 30 }, (_, i) => [
    line(x, 200 + i * 50, 280, `DADOS DO ADQUIRENTE ${i}`),
    ...(i % 3 ? [] : [line(x + 450, 200 + i * 50, 60, 'NIF')]),
  ]).flat();

describe('findPageGutter', () => {
  it('finds the gutter between two columns of forms whose lines share baselines (EU sample 044)', () => {
    const header = line(100, 100, 1200, 'Diário da República, 1.ª série');
    const g = findPageGutter([header, ...form(100), ...form(760)], [], 20, page);
    expect(g).not.toBeNull();
    expect(g!.x).toBeGreaterThan(610);
    expect(g!.x).toBeLessThan(760);
    expect(g!.top).toBeGreaterThanOrEqual(200);
  });

  it('finds none when a line crosses the gutter between the columns', () => {
    const across = line(100, 900, 1200, 'Uma linha que atravessa as duas colunas');
    expect(findPageGutter([across, ...form(100), ...form(760)], [], 20, page)).toBeNull();
  });

  it('finds none when a picture crosses the gutter between the columns', () => {
    const picture = { x: 500, y: 800, width: 400, height: 200 };
    expect(findPageGutter([...form(100), ...form(760)], [picture], 20, page)).toBeNull();
  });

  it('finds none between the columns of a receipt (names, then amounts)', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [
      line(100, 200 + i * 40, 400, `Articolo numero ${i}`),
      line(800, 200 + i * 40, 80, `${i}.50`),
      line(1100, 200 + i * 40, 100, `${i * 3}.20`),
    ]).flat();
    expect(findPageGutter(rows, [], 20, page)).toBeNull();
  });

  it('finds none between a narrow label column and wide values', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [
      line(100, 200 + i * 40, 150, `Label ${i}`),
      line(500, 200 + i * 40, 800, `A long value that fills most of the line ${i}`),
    ]).flat();
    expect(findPageGutter(rows, [], 20, page)).toBeNull();
  });
});
