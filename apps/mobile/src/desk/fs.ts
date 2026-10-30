// 桌面目录（file-room DESIGN §3，D-336）：App 文档目录下的 desk/<deskId>/，不放缓存（系统会清缓存）。
// 这里只管桌面目录里的文件；路径都是 desk/ 下的相对路径（iOS 更新 App 后文档目录的绝对地址会变）。
// 原件（相册、「文件」、content://）和收件那一批的副本只复制、不移动；只有本次运行的临时文件可以移进来
// （AGENTS.md「文件的归属」）。

export interface DeskFs {
  /** 桌面目录里一个相对路径现在的地址（显示、交给运行）。 */
  uri(path: string): string;
  /** 是不是运行目录（cache/runs/）里的临时文件：属于这次运行，可以移进桌面。 */
  isRunFile(uri: string): boolean;
  /** uri 在桌面目录里时返回它的相对路径（工具原样交回的文件），否则 null。 */
  pathOf(uri: string): string | null;
  /** 复制进桌面目录（原件、收件那一批的副本：不动它们），返回大小。 */
  copyIn(uri: string, path: string): Promise<number>;
  /** 移进桌面目录（只用于运行目录里的临时文件），返回大小。 */
  moveIn(uri: string, path: string): Promise<number>;
  writeText(path: string, text: string): Promise<number>;
  /** 写一个文件（编辑合上时生成的 xlsx / docx，D-345），返回大小。 */
  writeBytes(path: string, bytes: Uint8Array): Promise<number>;
  /** 读不到时返回 null。 */
  readText(path: string): Promise<string | null>;
  /** 删掉几个文件；只删桌面目录里的，已经不在了不算错。 */
  remove(paths: readonly string[]): Promise<void>;
  /** 删掉整个桌面。 */
  removeDesk(deskId: string): Promise<void>;
  /** 有哪些桌面（目录名）。 */
  list(): Promise<string[]>;
}
