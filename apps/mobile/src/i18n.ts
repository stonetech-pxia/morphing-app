import type { Locale } from '@morph/core';
import { getLocales } from 'expo-localization';

// 界面文案集中在这里（DECISIONS P-003：英文 + 简体中文，跟随系统语言）。
// 用户自己的内容（页面标题等）存放在工作空间配置里，不经过这里。

export function getDeviceLocale(): Locale {
  const [primary] = getLocales();
  return primary?.languageCode === 'zh' ? 'zh' : 'en';
}

const strings = {
  loading: { en: 'Loading…', zh: '正在载入…' },
  bootFailed: { en: 'The workspace could not be opened.', zh: '无法打开工作空间。' },

  // 修改流程
  changeTitle: { en: 'Change this app', zh: '修改这个 App' },
  changeHint: {
    en: 'Describe what to change. You will see a preview before anything is applied.',
    zh: '用一句话描述想怎么改。应用之前会先给你看预览。',
  },
  changePlaceholder: { en: 'e.g. Put PDF at the top', zh: '例如：把 PDF 放到最上面' },
  examples: { en: 'Try:', zh: '可以试试：' },
  preview: { en: 'Preview', zh: '预览' },
  thinking: { en: 'Working on it…', zh: '正在生成修改…' },
  planTitle: { en: 'Planned changes', zh: '将要做的修改' },
  before: { en: 'Before', zh: '修改前' },
  after: { en: 'After', zh: '修改后' },
  apply: { en: 'Apply', zh: '应用更改' },
  cancel: { en: 'Cancel', zh: '取消' },
  undo: { en: 'Undo', zh: '撤销' },
  close: { en: 'Close', zh: '关闭' },
  invalidPlan: {
    en: 'This change was blocked because it would break the app:',
    zh: '这次修改未通过校验，已被拦截：',
  },
  previewFailed: { en: 'The preview could not be rendered.', zh: '预览渲染失败。' },
  applied: { en: 'Applied', zh: '已应用' },
  conflict: {
    en: 'The app changed while you were previewing. Nothing was applied; please try again.',
    zh: '预览期间 App 已被修改，本次未应用，请重新生成。',
  },
  rolledBack: {
    en: 'The new version could not be displayed, so the previous version was restored.',
    zh: '新版本无法正常显示，已自动恢复到之前的版本。',
  },
  recovered: {
    en: 'The latest version was damaged, so the last working version was restored.',
    zh: '最新版本已损坏，已自动恢复到最后一个可用版本。',
  },
  noPrevious: { en: 'There is no earlier version to go back to.', zh: '没有更早的版本可以恢复。' },
  undoSummary: { en: 'Undo', zh: '撤销' },

  // 历史
  historyTitle: { en: 'History', zh: '历史版本' },
  current: { en: 'Current', zh: '当前' },
  restoreThis: { en: 'Restore this version', zh: '恢复到这个版本' },
  restoreSummary: { en: 'Restore version #{id}', zh: '恢复到版本 #{id}' },
  source_seed: { en: 'Initial', zh: '初始' },
  source_ai: { en: 'AI change', zh: 'AI 修改' },
  source_user: { en: 'Your change', zh: '手动修改' },
  source_restore: { en: 'Restore', zh: '恢复' },
  source_rollback: { en: 'Automatic rollback', zh: '自动回退' },
  source_recovery: { en: 'Automatic recovery', zh: '自动修复' },
  initialSummary: { en: 'Initial workspace', zh: '初始工作空间' },

  // 工具目录
  toolsTitle: { en: 'Tools', zh: '工具' },
  install: { en: 'Install', zh: '安装' },
  open: { en: 'Open', zh: '打开' },
  installed: { en: 'Installed', zh: '已安装' },
  uninstall: { en: 'Uninstall', zh: '卸载' },
  removeFromHome: { en: 'Remove from home', zh: '从首页移除入口' },
  addToHome: { en: 'Add to home', zh: '添加到首页' },
  confirmTitle: { en: 'Confirm', zh: '确认' },
  installSummary: { en: 'Install {name}', zh: '安装 {name}' },
  uninstallSummary: { en: 'Uninstall {name}', zh: '卸载 {name}' },
  removeCardSummary: { en: 'Remove {name} from home', zh: '从首页移除 {name}' },
  addCardSummary: { en: 'Add {name} to home', zh: '把 {name} 添加到首页' },

  // 设置
  settingsTitle: { en: 'Settings', zh: '设置' },
  openHistory: { en: 'Version history', zh: '历史版本' },
  language: { en: 'Language', zh: '语言' },
  languageValue: { en: 'English (follows system)', zh: '简体中文（跟随系统）' },
  about: { en: 'About', zh: '关于' },
  aboutValue: {
    en: 'Morph prototype · AGPL-3.0 · schema v{schema} · version #{revision}',
    zh: 'Morph 原型 · AGPL-3.0 · schema v{schema} · 版本 #{revision}',
  },

  // 页面组件
  noFiles: { en: 'No files yet', zh: '还没有文件' },
  run: { en: 'Start', zh: '开始' },
  runAgain: { en: 'Run again', zh: '再来一次' },
  running: { en: 'Step {n}: {step}', zh: '第 {n} 步：{step}' },
  runDone: { en: 'Saved “{name}” ({pages} pages)', zh: '已保存「{name}」（{pages} 页）' },
  runCancelled: { en: 'Cancelled', zh: '已取消' },
  share: { en: 'Share / export', zh: '分享 / 导出' },
  ok: { en: 'OK', zh: '确定' },
  runError_tooFew: { en: 'Choose at least {min} PDF files.', zh: '请至少选择 {min} 个 PDF 文件。' },
  runError_tooMany: { en: 'Choose at most {max} files.', zh: '最多选择 {max} 个文件。' },
  runError_notPdf: { en: '“{name}” is not a PDF.', zh: '「{name}」不是 PDF 文件。' },
  runError_tooLarge: {
    en: '“{name}” is larger than {mb} MB, which is not supported yet.',
    zh: '「{name}」超过 {mb} MB，暂不支持。',
  },
  runError_tooLargeTotal: {
    en: 'The selected files add up to more than {mb} MB.',
    zh: '所选文件合计超过 {mb} MB。',
  },
  runError_unreadable: {
    en: '“{name}” could not be read. It may be damaged.',
    zh: '无法读取「{name}」，文件可能已损坏。',
  },
  runError_encrypted: {
    en: '“{name}” is password-protected, which is not supported yet.',
    zh: '「{name}」有密码保护，暂不支持。',
  },
  runError_accessDenied: {
    en: '“{name}” could not be accessed. Check permissions and try again.',
    zh: '无法访问「{name}」，请检查权限后重试。',
  },
  runError_noGrant: {
    en: 'This tool is not allowed to read “{name}”.',
    zh: '这个工具无权读取「{name}」。',
  },
  runError_saveFailed: { en: 'Saving failed: {detail}', zh: '保存失败：{detail}' },
  runError_unsupportedAction: {
    en: 'This step is not supported: {action}',
    zh: '不支持这个步骤：{action}',
  },
  runError_unexpected: { en: 'Something went wrong: {detail}', zh: '出现错误：{detail}' },
  toolMissing: { en: 'This tool is not available.', zh: '这个工具不可用。' },
  pageMissing: { en: 'This page no longer exists.', zh: '这个页面已不存在。' },
} satisfies Record<string, Record<Locale, string>>;

export type StringKey = keyof typeof strings;

export function t(
  locale: Locale,
  key: StringKey,
  vars: Record<string, string | number> = {},
): string {
  return strings[key][locale].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars[name] ?? `{${name}}`),
  );
}
