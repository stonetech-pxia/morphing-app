// 签名放在页面上哪里、多大（页面比例坐标，左上角为原点）。
// 2026-11-09 用户测试：原来默认放在右下角、宽度是页宽的 32%，A4 上约 80 磅高，合同里一行才十几磅，一放就压住两行；
// 只能拖，不能点一下放到那一行上。现在点哪一行就放在哪一行上，没自己挑大小时高度照那一行字定。

type Size = { width: number; height: number };

export interface SignPlacement {
  place: { x: number; y: number; width: number };
  /** 开始拖时的位置（PanResponder 的 dx 是从按下算起的累计值）。 */
  start: { x: number; y: number };
  /** 页面在屏幕上的大小。 */
  size: Size;
  /** 用户自己挑过 S / M / L：以后点到别处也不再按那一行改大小。 */
  sized: boolean;
}

export type SignAction =
  | { type: 'grant' }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'size'; width: number }
  | { type: 'layout'; width: number; height: number }
  /** 选好签名（知道了宽高比）或换了一页：回到默认大小和位置。 */
  | { type: 'reset' }
  /** 点在页面上（屏幕点）；lineHeight 是点附近那一行字的高（原图点），没认出字时不给。 */
  | { type: 'tap'; x: number; y: number; lineHeight?: number };

/** 没认出字时当作正文行高：短边的 1.9%（约 11 磅的字）× 1.3。 */
const bodyLineHeight = (page: Size) => Math.min(page.width, page.height) * 0.019 * 1.3;
/** 签名大约两行半高（签名比字大一些，但不压到上下两行）。 */
const SIGNATURE_LINES = 2.5;

function widthFor(lineHeight: number, page: Size, aspect: number): number {
  const width = (SIGNATURE_LINES * lineHeight * aspect) / page.width;
  return Math.min(0.45, Math.max(0.08, width));
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function initialPlacement(page: Size, aspect: number): SignPlacement {
  const width = widthFor(bodyLineHeight(page), page, aspect);
  return {
    place: { x: Math.min(0.55, 1 - width), y: 0.8, width },
    start: { x: 0, y: 0 },
    size: { width: 0, height: 0 },
    sized: false,
  };
}

export function reducePlacement(
  state: SignPlacement,
  action: SignAction,
  page: Size,
  aspect: number,
): SignPlacement {
  const { place } = state;
  switch (action.type) {
    case 'grant':
      return { ...state, start: { x: place.x, y: place.y } };
    case 'move': {
      if (!state.size.width) return state;
      const x = state.start.x + action.dx / state.size.width;
      const y = state.start.y + action.dy / state.size.height;
      return {
        ...state,
        place: { ...place, x: clamp(x, 0, 1 - place.width), y: clamp(y, 0, 0.97) },
      };
    }
    case 'size':
      return {
        ...state,
        sized: true,
        place: { ...place, width: action.width, x: Math.min(place.x, 1 - action.width) },
      };
    case 'layout':
      return { ...state, size: { width: action.width, height: action.height } };
    case 'reset':
      return { ...initialPlacement(page, aspect), size: state.size };
    case 'tap': {
      if (!state.size.width || !state.size.height) return state;
      const width = state.sized
        ? place.width
        : widthFor(action.lineHeight ?? bodyLineHeight(page), page, aspect);
      const height = (width * page.width) / aspect / page.height;
      // 左边从手指的地方开始，底边落在点的那一行上。
      return {
        ...state,
        place: {
          width,
          x: clamp(action.x / state.size.width, 0, 1 - width),
          y: clamp(action.y / state.size.height - height, 0, Math.min(0.97, 1 - height)),
        },
      };
    }
  }
}
