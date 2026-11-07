/** 新的用户文件 / 记录 / 预设的 ID（时间 + 随机）。单独一个文件：存储、渲染器都要它，不该为此依赖执行器（R11）。 */
export function newAssetId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
