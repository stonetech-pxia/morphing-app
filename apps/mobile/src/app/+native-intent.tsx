import { isShareLink } from '@/share/useIncomingShare';

/**
 * iOS 的分享扩展用 morph://dataUrl=morphShareKey… 唤起 App（D-095）。这不是页面地址：
 * 冷启动时先到首页，App 已经开着时留在当前页面；收件页面由 useIncomingShare 拿到文件后再打开。
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (isShareLink(path)) return initial ? '/' : null;
  } catch {
    // 出错时按普通地址处理（这里抛错会让 App 崩溃）。
  }
  return path;
}
