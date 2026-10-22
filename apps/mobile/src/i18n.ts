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
  aiUnavailable: {
    en: 'The AI service could not be reached. Nothing was changed; please try again later.',
    zh: '暂时连不上 AI 服务，没有做任何修改，请稍后再试。',
  },
  aiRateLimited: {
    en: 'Too many requests in a short time. Please wait a minute and try again.',
    zh: '请求太频繁了，请等一分钟再试。',
  },
  aiDailyLimit: {
    en: 'Today’s AI request limit has been reached. Try again tomorrow.',
    zh: '今天的 AI 请求次数已用完，请明天再试。',
  },
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
  aiEngine: { en: 'AI', zh: 'AI' },
  aiEngineRemote: { en: 'Claude via the Morph server', zh: 'Claude（通过 Morph 服务器）' },
  aiEngineMock: { en: 'Built-in rules (offline mock)', zh: '内置规则（离线 mock）' },
  aiEngineByok: { en: 'My own Claude API key ({model})', zh: '我自己的 Claude API key（{model}）' },

  // AI 设置
  aiSettingsTitle: { en: 'AI', zh: 'AI' },
  aiModeQuestion: { en: 'Which AI changes this app', zh: '用哪种 AI 修改这个 App' },
  aiModeMock: { en: 'Built-in rules', zh: '内置规则' },
  aiModeMockNote: {
    en: 'Offline and free. Understands a fixed set of phrases.',
    zh: '离线、免费，只认识固定的几种说法。',
  },
  aiModeServer: { en: 'Morph server', zh: 'Morph 服务器' },
  aiModeServerNote: { en: 'Claude through {url}.', zh: '通过 {url} 调用 Claude。' },
  aiModeByok: { en: 'My own Claude API key', zh: '我自己的 Claude API key' },
  aiModeByokNote: {
    en: 'Calls Claude directly from this phone. Usage is billed to your Anthropic account.',
    zh: '从这台手机直接调用 Claude，费用由你的 Anthropic 账号支付。',
  },
  apiKeyLabel: { en: 'API key', zh: 'API key' },
  apiKeySaved: { en: 'Saved (ends with {hint})', zh: '已保存（末四位 {hint}）' },
  apiKeyPlaceholder: { en: 'sk-ant-…', zh: 'sk-ant-…' },
  saveKey: { en: 'Save key', zh: '保存 key' },
  deleteKey: { en: 'Delete key', zh: '删除 key' },
  keyFormatInvalid: {
    en: 'That doesn’t look like a Claude API key (it starts with sk-ant-).',
    zh: '这看起来不是 Claude API key（应以 sk-ant- 开头）。',
  },
  modelLabel: { en: 'Model', zh: '模型' },
  perChange: { en: 'about ${cost} per change', zh: '每次修改约 ${cost}' },
  testConnection: { en: 'Test connection', zh: '测试连接' },
  testOk: {
    en: 'Connected. The key works with this model.',
    zh: '连接成功，这个 key 可以使用所选模型。',
  },
  keyPrivacyNote: {
    en: 'The key is stored only in this phone’s secure storage (not synced or backed up to other devices) and is sent only to api.anthropic.com. Set a spend limit in the Claude Console.',
    zh: 'key 只保存在这台手机的安全存储里（不会同步或备份到其他设备），只发送给 api.anthropic.com。建议在 Claude Console 设置花费上限。',
  },

  byokNoKey: {
    en: 'Add your Claude API key in Settings → AI first.',
    zh: '请先在「设置 → AI」里填写你的 Claude API key。',
  },
  byokInvalidKey: {
    en: 'The API key is invalid or was deleted. Check it in Settings → AI.',
    zh: 'API key 无效或已被删除，请在「设置 → AI」里检查。',
  },
  byokPermission: {
    en: 'This API key isn’t allowed to use the selected model.',
    zh: '这个 API key 没有使用所选模型的权限。',
  },
  byokSpendLimit: {
    en: 'Your Claude Console spend limit has been reached. Nothing was changed.',
    zh: '已达到你在 Claude Console 设置的花费上限，没有做任何修改。',
  },
  byokBusy: {
    en: 'Claude is busy right now. Nothing was changed; please try again shortly.',
    zh: 'Claude 服务暂时繁忙，没有做任何修改，请稍后再试。',
  },
  byokModelNotFound: {
    en: 'The selected model wasn’t found. Choose another model in Settings → AI.',
    zh: '找不到所选模型，请在「设置 → AI」里换一个模型。',
  },
  byokUnavailable: {
    en: 'Couldn’t reach the Claude API. Nothing was changed; check the network and try again.',
    zh: '连不上 Claude API，没有做任何修改，请检查网络后再试。',
  },
  aiBadOutput: {
    en: 'The AI’s answer couldn’t be used. Nothing was changed; try saying it another way.',
    zh: 'AI 返回的内容无法使用，没有做任何修改，请换个说法再试。',
  },
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
