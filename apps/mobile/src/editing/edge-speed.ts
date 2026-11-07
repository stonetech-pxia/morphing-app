// 拖动时的自动滚动速度。单独一个文件：渲染器的 Board / Tiles 和拖动逻辑都要它，不该为此依赖整个编辑页面（R11）。

/** 手指离可见区域上下边缘多近时开始自动滚动，以及最快每帧滚动多少（pt）。 */
const EDGE = 80;
const MAX_SPEED = 14;

/** 拖动时的自动滚动速度：越靠近边缘越快；负数向上。 */
export function edgeSpeed(pageY: number, top: number, bottom: number): number {
  if (pageY < top + EDGE) return -MAX_SPEED * Math.min(1, (top + EDGE - pageY) / EDGE);
  if (pageY > bottom - EDGE) return MAX_SPEED * Math.min(1, (pageY - (bottom - EDGE)) / EDGE);
  return 0;
}
