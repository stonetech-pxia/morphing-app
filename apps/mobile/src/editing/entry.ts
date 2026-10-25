/**
 * D-235：重新开放长按单个组件的直接编辑；整页「编辑」按钮继续关闭。
 * 两种入口分别控制，整页编辑视图仍保留供测试和以后使用。
 */
export const directEditEntry = { longPress: true, pageButton: false };

/** 长按多久选中组件、开始拖动。 */
export const LONG_PRESS_MS = 450;
