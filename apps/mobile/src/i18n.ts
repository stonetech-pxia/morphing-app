import type { Locale } from '@morph/core';
import { getLocales } from 'expo-localization';

// 界面文案集中在这里（DECISIONS P-003：英文 + 简体中文，跟随系统语言）。
// 用户自己的内容（页面标题等）存放在工作空间配置里，不经过这里。

export function getDeviceLocale(): Locale {
  const [primary] = getLocales();
  return primary?.languageCode === 'zh' ? 'zh' : 'en';
}

const strings = {
  openMedia: { en: 'Open photo library', zh: '打开相册', fr: 'Ouvrir les photos' },
  openFiles: { en: 'Open files', zh: '打开文件', fr: 'Ouvrir les fichiers' },
  filePickFailed: {
    en: 'Could not open the picker. Please try again.',
    zh: '没能打开选择器，请重试。',
    fr: 'Impossible d’ouvrir le sélecteur. Réessayez.',
  },
  shareRecent: { en: 'Used recently', zh: '最近用过', fr: 'Utilisés récemment' },
  shareUsed: { en: 'Used {n} times', zh: '用过 {n} 次', fr: 'Utilisé {n} fois' },
  shareDescribe: { en: 'Describe it myself', zh: '我要自己说', fr: 'Je le décris moi-même' },
  shareSeeAll: { en: 'See all {n}', zh: '查看全部 {n} 个', fr: 'Tout voir ({n})' },
  sharePicked: {
    en: 'For the {what} you picked',
    zh: '给你选的 {what}',
    fr: 'Pour les {what} choisis',
  },
  sharePlaceholder: {
    en: 'Say what you want, and Morph will do its best to make it happen',
    zh: '说出你想要的，Morph 会努力完成你的需求',
    fr: 'Dites ce que vous voulez, Morph fera de son mieux pour y arriver',
  },
  shareExpand: { en: 'Show files', zh: '查看文件', fr: 'Voir les fichiers' },
  shareCollapse: { en: 'Hide files', zh: '收起文件', fr: 'Masquer les fichiers' },
  shareSummary: { en: '{n} files', zh: '{n} 个文件', fr: '{n} fichiers' },
  sharePhotoSummary: { en: '{n} photos', zh: '{n} 张照片', fr: '{n} photos' },
  loading: { en: 'Loading…', zh: '正在载入…' },
  bootFailed: { en: 'The workspace could not be opened.', zh: '无法打开工作空间。' },

  // 修改流程
  changeTitle: { en: 'Change this app', zh: '修改这个 App' },
  changeHint: {
    en: 'Describe what to change. You will see a preview before anything changes.',
    zh: '用一句话描述想怎么改。改之前会先给你看预览。',
  },
  changePlaceholder: {
    en: 'e.g. Bigger text and no shadows',
    zh: '例如：字体大一点，去掉阴影',
  },
  examples: { en: 'Try:', zh: '可以试试：' },
  pickStyle: { en: 'Pick a style', zh: '选一个风格' },
  preview: { en: 'Preview', zh: '预览' },
  thinking: { en: 'Working on it…', zh: '正在生成修改…' },
  planTitle: { en: 'Planned changes', zh: '将要做的修改' },
  before: { en: 'Now', zh: '现在' },
  after: { en: 'After', zh: '改完后' },
  apply: { en: 'Make this change', zh: '确认修改' },
  cancel: { en: 'Cancel', zh: '取消' },
  undo: { en: 'Undo', zh: '撤销' },
  close: { en: 'Close', zh: '关闭' },
  invalidPlan: {
    en: 'This change was blocked because it would break the app:',
    zh: '这次修改未通过校验，已被拦截：',
  },
  previewFailed: { en: 'The preview could not be rendered.', zh: '预览渲染失败。' },
  applied: { en: 'Changed', zh: '已改好' },
  conflict: {
    en: 'The app changed while you were previewing. Nothing was changed; please try again.',
    zh: '预览期间 App 已被修改，这次没有改，请重新生成。',
  },
  rolledBack: {
    en: 'The change could not be displayed, so the app went back to how it was.',
    zh: '这次修改无法正常显示，已自动回到改之前的样子。',
  },
  recovered: {
    en: 'The latest change was damaged, so the app went back to the last time it worked.',
    zh: '最近的修改已损坏，已自动回到最后一次能正常使用的样子。',
  },
  noPrevious: { en: 'There is no earlier change to undo.', zh: '前面没有可以撤销的修改了。' },
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

  // 改动记录（D-112）
  historyTitle: { en: 'Change history', zh: '改动记录' },
  current: { en: 'Now', zh: '现在的样子' },
  restoreThis: { en: 'Go back to this', zh: '回到这时候的样子' },
  restoreSummary: { en: 'Back to {when}', zh: '回到 {when} 的样子' },
  source_seed: { en: 'Start', zh: '一开始' },
  source_ai: { en: 'By AI', zh: 'AI 改的' },
  source_user: { en: 'By you', zh: '你改的' },
  source_restore: { en: 'Went back', zh: '回到之前' },
  source_rollback: { en: 'Undone automatically', zh: '自动退回' },
  source_recovery: { en: 'Fixed automatically', zh: '自动修复' },
  initialSummary: { en: 'The app as installed', zh: '刚装好的样子' },
  dateToday: { en: 'Today {time}', zh: '今天 {time}' },
  dateYesterday: { en: 'Yesterday {time}', zh: '昨天 {time}' },

  // 工具目录
  toolsTitle: { en: 'Tools', zh: '工具' },
  install: { en: 'Add', zh: '添加' },
  open: { en: 'Open', zh: '打开' },
  installed: { en: 'Added', zh: '已添加' },
  uninstall: { en: 'Remove', zh: '移除' },
  removeFromHome: { en: 'Remove from home', zh: '从首页移除入口' },
  addToHome: { en: 'Add to home', zh: '添加到首页' },
  installSummary: { en: 'Added {name}', zh: '添加了{name}工具' },
  uninstallSummary: { en: 'Removed {name}', zh: '移除了{name}工具' },
  uninstallTitle: { en: 'Remove {name}?', zh: '移除{name}工具？' },
  removeCardSummary: { en: 'Took {name} off home', zh: '从首页移除了{name}' },
  addCardSummary: { en: 'Put {name} on home', zh: '把{name}放到了首页' },
  // 下载的工具（D-177）
  toolDownloadSize: { en: 'Downloads {size}', zh: '需要下载 {size}' },
  toolDownloading: { en: 'Downloading…', zh: '正在下载…' },
  toolNeedsAppUpdate: {
    en: 'Needs a newer version of this app',
    zh: '需要先更新 App 才能添加',
  },
  toolRevoked: { en: 'Paused', zh: '暂时停用' },
  toolRevokedRun: {
    en: '“{name}” is paused for now, so this quick action can’t run. Try again later.',
    zh: '「{name}」暂时停用了，这个快捷操作现在不能用。过一阵再试试。',
  },
  toolDownloadFailedTitle: { en: '“{name}” was not added', zh: '「{name}」没有添加' },
  toolDownloadFailed: {
    en: 'It could not be downloaded. Check the network and try again.',
    zh: '没有下载成功。请检查网络后再试。',
  },
  toolDownloadRejected: {
    en: 'What was downloaded did not pass the safety check, so nothing was changed.',
    zh: '下载的内容没有通过安全检查，什么都没有改。',
  },
  restoreNeedsTool: {
    en: 'This version uses {names}, which is not on this phone. Add it in Tools first, then restore.',
    zh: '这个版本用到了「{names}」，这台手机上还没有。先到「工具」里添加，再恢复。',
  },
  listSeparator: { en: ', ', zh: '、' },
  toolDownloadedHint: {
    en: 'A tool downloaded from the Morph catalog.',
    zh: '从 Morph 工具目录下载的工具。',
  },
  toolDeleteMessage: {
    en: 'You can download it again from Tools later.',
    zh: '以后可以在「工具」里再下载。',
  },
  toolDeleteAdded: {
    en: 'This tool is still added. Remove it in Tools first, then delete it here.',
    zh: '这个工具还在用。先到「工具」里移除它，再回来删除。',
  },

  // 设置
  settingsTitle: { en: 'Settings', zh: '设置' },
  thisApp: { en: 'This app', zh: '这个 App' },
  general: { en: 'General', zh: '通用' },
  changeRowHint: {
    en: 'Describe how the app should change',
    zh: '用一句话描述想怎么改',
  },
  historyRowHint: {
    en: 'Undo a change or go back to how the app was before',
    zh: '撤销修改，或回到之前任何时候的样子',
  },
  toolsRowHint: { en: 'Add, open or remove tools', zh: '添加、打开或移除工具' },
  openHistory: { en: 'Change history', zh: '改动记录' },
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
  shareInputStep: { en: 'Shared files ({n})', zh: '分享进来的文件（{n} 个）' },
  shareGone: {
    en: 'These files are no longer here. Please share them again.',
    zh: '这些文件已经不在了，请重新分享。',
  },
  runError_tooFew: { en: 'Choose at least {min} files.', zh: '请至少选择 {min} 个文件。' },
  runError_tooMany: { en: 'Choose at most {max} files.', zh: '最多选择 {max} 个文件。' },
  runError_wrongType: {
    en: '“{name}” is not a {kind} file.',
    zh: '「{name}」不是 {kind} 文件。',
  },
  runError_invalidWorkflow: {
    en: 'This quick action has a step that doesn’t fit. Adjust its settings and try again.',
    zh: '这个快捷操作里有接不上的步骤，请先调整设置再试。',
  },
  runError_cameraUnavailable: {
    en: 'The camera is not available on this device.',
    zh: '这台设备上不能使用相机。',
  },
  runError_permissionDenied: {
    en: 'Morph needs permission for this ({what}). You can allow it in the system Settings.',
    zh: '需要权限才能继续（{what}），可以在系统「设置」里允许。',
  },
  runError_packFailed: {
    en: 'The download didn’t finish: {detail}',
    zh: '需要的内容没有下载好：{detail}',
  },
  runError_targetNotMet: {
    en: 'Could not get “{name}” under {target} (smallest was {got}).',
    zh: '「{name}」无法压到 {target} 以内（最小只能到 {got}）。',
  },
  runError_unsupportedText: {
    en: 'This text can’t be written into the PDF yet: {name}',
    zh: '这段文字暂时不能写进 PDF：{name}',
  },
  runError_badRange: {
    en: 'Those pages don’t exist in “{name}”.',
    zh: '「{name}」里没有这些页。',
  },
  runError_noFormFields: {
    en: '“{name}” has no form fields to fill.',
    zh: '「{name}」里没有可以填写的表单。',
  },
  runError_badField: {
    en: 'What was filled in for “{name}” doesn’t fit this field.',
    zh: '「{name}」这一项填写的内容不符合要求。',
  },
  runError_emptyText: { en: 'There is no text to use.', zh: '没有可以用的文字。' },
  runError_passwordMissing: { en: 'No password was entered.', zh: '没有填密码。' },
  askPasswordMismatch: {
    en: 'The two passwords are different.',
    zh: '两次输入的密码不一样。',
  },
  askPasswordAgain: { en: 'Password again', zh: '再输一次' },
  runError_textTooLong: {
    en: 'The text is too long (at most {max} characters).',
    zh: '文字太长了（最多 {max} 个字）。',
  },
  runError_noRecords: {
    en: 'There are no records in “{name}” for this time.',
    zh: '「{name}」里这段时间没有记录。',
  },
  runError_doesNotFit: {
    en: '“{name}” does not fit on this paper. Cut it to an ID photo size first.',
    zh: '「{name}」放不进这张相纸。请先用「证件照」步骤裁成规格尺寸。',
  },
  runError_notFound: { en: 'Nothing was found in “{name}”.', zh: '在「{name}」里没有找到内容。' },
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
    en: '“{name}” has a password. Add the step “Remove PDF password” before this one.',
    zh: '「{name}」有密码。可以在前面加一步「去掉 PDF 密码」。',
  },
  runError_pdfRestricted: {
    en: '“{name}” opens without a password, but its author limited changes to it. Morph doesn’t remove such limits.',
    zh: '「{name}」不用密码就能打开，但作者限制了修改。Morph 不解除这种限制。',
  },
  runError_pdfPasswordUnsupported: {
    en: 'This phone can’t remove or add PDF passwords yet (iPhone only for now).',
    zh: '这台手机暂时不能去掉或加上 PDF 密码（目前只有 iPhone 能用）。',
  },
  runError_accessDenied: {
    en: '“{name}” could not be accessed. Check permissions and try again.',
    zh: '无法访问「{name}」，请检查权限后重试。',
  },
  runError_saveFailed: { en: 'Saving failed: {detail}', zh: '保存失败：{detail}' },
  runError_folderNotWritable: {
    en: 'Files can’t be saved into this folder. Choose another folder and try again.',
    zh: '不能存进这个文件夹，请换一个文件夹再试。',
  },
  runError_unsupportedAction: {
    en: 'This step is not supported: {action}',
    zh: '不支持这个步骤：{action}',
  },
  runError_unexpected: { en: 'Something went wrong: {detail}', zh: '出现错误：{detail}' },

  updateTool: { en: 'Update', zh: '更新' },
  updateSummary: { en: 'Updated {name}', zh: '更新了{name}工具' },

  // 运行页面
  runTitle: { en: 'Run', zh: '运行' },
  runCancel: { en: 'Stop', zh: '停止' },
  runProgress: { en: '{done} of {total}', zh: '{done}/{total}' },
  runFailedAt: { en: 'Stopped at step {n}', zh: '在第 {n} 步停下' },
  runSucceeded: { en: 'Done', zh: '完成' },
  runEdit: { en: 'Adjust settings', zh: '调整设置' },
  askTitle: { en: 'Before this step', zh: '这一步之前' },
  askName: { en: 'File name', zh: '文件名' },
  askInvalid: { en: 'Please check: {detail}', zh: '请检查：{detail}' },
  resultSave: { en: 'Save to files', zh: '存到文件' },
  resultSaved: { en: 'Saved', zh: '已保存' },
  resultShare: { en: 'Share', zh: '分享' },
  resultPhotos: { en: 'Save to Photos', zh: '存到相册' },
  resultPhotosDone: { en: 'Saved to Photos', zh: '已存到相册' },
  resultPrint: { en: 'Print', zh: '打印' },
  resultFolder: { en: 'Save to a folder', zh: '存到文件夹' },
  resultFolderNamed: { en: 'Save to “{name}”', zh: '存到「{name}」' },
  resultFolderDone: { en: 'Saved to “{name}”', zh: '已存到「{name}」' },
  resultFolderChange: { en: 'Other folder', zh: '换文件夹' },
  resultCopy: { en: 'Copy', zh: '复制' },
  resultCopied: { en: 'Copied', zh: '已复制' },
  resultTextNote: {
    en: 'This text stays on this device.',
    zh: '这段文字只留在这台设备上。',
  },
  resultPages: { en: '{n} pages', zh: '{n} 页' },
  resultCount: { en: '{n} files', zh: '{n} 个文件' },
  homeEntry: { en: 'Add a shortcut on the home page', zh: '在首页放一个入口' },
  notesTitle: { en: 'Good to know', zh: '需要你知道' },
  workflowWhere: {
    en: 'You will find it under Tools → Quick actions.',
    zh: '之后在「工具 → 快捷操作」里可以找到它。',
  },
  resultSmaller: { en: 'Was {from}, now {to}', zh: '原来 {from}，现在 {to}' },
  resultRecords: { en: '{n} records', zh: '{n} 条记录' },
  localDone: { en: 'Done', zh: '完成' },
  localNext: { en: 'Next', zh: '下一张' },
  toolMissing: { en: 'This tool is not available.', zh: '这个工具不可用。' },
  workflowsTitle: { en: 'Quick actions', zh: '快捷操作' },
  workflowsRowHint: {
    en: 'Ready-made and your own multi-step actions',
    zh: '现成的和你自己的多步操作',
  },
  packsTitle: { en: 'Downloads', zh: '已下载内容' },
  packsRowHint: { en: 'What was downloaded and the space it uses', zh: '下载过的内容和占用空间' },
  packsHint: {
    en: 'Some features (straightening photos, text recognition in more languages, PDF preview) download what they need the first time you use them. They work offline afterwards.',
    zh: '有些功能（拉正照片、更多语言的文字识别、PDF 预览）第一次用时要下载一些内容，之后不联网也能用。',
  },
  packsEmpty: { en: 'Nothing downloaded yet.', zh: '还没有下载过内容。' },
  packsTotal: { en: 'Using {size}', zh: '共占用 {size}' },
  packDelete: { en: 'Delete', zh: '删除' },
  packDeleteTitle: { en: 'Delete “{name}”?', zh: '删除「{name}」？' },
  packDeleteMessage: {
    en: 'You can download it again the next time a tool needs it.',
    zh: '下次用到时可以再下载。',
  },
  packDeleteWithLanguages: {
    en: 'Its {count} languages are deleted too. You can download them again the next time you need them.',
    zh: '它的 {count} 种语言也会一起删除。下次用到时可以再下载。',
  },

  // 图片与链接
  imagePlaceholder: { en: 'Tap to choose a photo', zh: '点按选择一张照片' },
  imageTitle: { en: 'Picture', zh: '图片' },
  imageMissing: {
    en: 'This picture is not on this device. Tap to choose another.',
    zh: '这张图片不在这台设备上，点按换一张。',
  },
  chooseImage: { en: 'Choose another photo', zh: '更换照片' },
  removeImage: { en: 'Remove photo', zh: '移除照片' },
  setImageSummary: { en: 'Set a picture', zh: '设置图片' },
  removeImageSummary: { en: 'Remove a picture', zh: '移除图片' },
  imageTooLarge: {
    en: 'This photo is larger than {mb} MB.',
    zh: '这张照片超过 {mb} MB。',
  },
  openLinkTitle: { en: 'Open link?', zh: '打开链接？' },
  openLinkMessage: { en: 'This opens {target} outside the app.', zh: '将在 App 外打开 {target}。' },
  openLink: { en: 'Open', zh: '打开' },

  // 用户数据
  noRecords: { en: 'Nothing here yet', zh: '还没有记录' },
  today: { en: 'Today', zh: '今天' },
  yesterday: { en: 'Yesterday', zh: '昨天' },
  fieldRequired: { en: 'Required', zh: '必填' },
  fieldInvalid: { en: 'Not a valid value', zh: '格式不对' },
  fieldTooLong: { en: 'Too long', zh: '太长了' },
  tableFull: {
    en: 'This table is full (10,000 entries).',
    zh: '这张表已满（1 万条）。',
  },
  useFullForm: {
    en: 'Some required fields aren’t in this form. Open the full form to add.',
    zh: '有必填项不在这个表单里，请用完整表单添加。',
  },
  recordDeleted: { en: 'Entry deleted', zh: '已删除一条记录' },
  newRecord: { en: 'New entry', zh: '新记录' },
  editRecord: { en: 'Edit entry', zh: '编辑记录' },
  save: { en: 'Save', zh: '保存' },
  delete: { en: 'Delete', zh: '删除' },
  tableMissing: {
    en: 'This data table is no longer part of the app. Its entries are kept in Settings → Data.',
    zh: '这张数据表已不在界面里，记录保存在「设置 → 数据」。',
  },
  dataTitle: { en: 'Data', zh: '数据' },
  dataRowHint: {
    en: 'Your entries: export, recently deleted',
    zh: '你记录的数据：导出、最近删除',
  },
  dataPrivacy: {
    en: 'Entries are stored only on this phone. The AI only sees the structure of your tables (names and fields), never what you enter.',
    zh: '记录只保存在这台手机上。AI 只能看到数据表的结构（表名和字段），永远看不到你填写的内容。',
  },
  dataTables: { en: 'Data tables', zh: '数据表' },
  unusedTables: { en: 'Not in the app', zh: '不在界面里的数据' },
  unusedTablesHint: {
    en: 'Tables that were removed from the app. Their entries come back if you go back to a time when the table was there.',
    zh: '已从界面移除的数据表。在改动记录里回到有这张表的时候，记录会回来。',
  },
  recentlyDeleted: { en: 'Recently deleted', zh: '最近删除' },
  recentlyDeletedHint: {
    en: 'Kept for 30 days, then removed for good.',
    zh: '保留 30 天，之后永久删除。',
  },
  recordCount: { en: '{count} entries', zh: '{count} 条记录' },
  exportCsv: { en: 'Export CSV', zh: '导出 CSV' },
  deleteForever: { en: 'Delete forever', zh: '永久删除' },
  deleteForeverConfirm: {
    en: 'Delete all {count} entries of “{name}”? This can’t be undone.',
    zh: '永久删除「{name}」的全部 {count} 条记录？此操作无法撤销。',
  },
  restore: { en: 'Restore', zh: '恢复' },
  nothingDeleted: { en: 'Nothing deleted recently', zh: '最近没有删除的记录' },
  unknownTable: { en: 'Table {id}', zh: '数据表 {id}' },
  pageMissing: { en: 'This page no longer exists.', zh: '这个页面已不存在。' },

  // 直接编辑（长按一块、调整顺序）
  editText: { en: 'Edit text', zh: '改文字' },
  editColor: { en: 'Color', zh: '颜色' },
  editAlign: { en: 'Alignment', zh: '对齐' },
  editSize: { en: 'Size', zh: '大小' },
  tone_default: { en: 'Default', zh: '默认' },
  tone_primary: { en: 'Primary', zh: '主色' },
  tone_secondary: { en: 'Secondary', zh: '辅助色' },
  tone_tertiary: { en: 'Tertiary', zh: '第三色' },
  tone_muted: { en: 'Muted', zh: '灰色' },
  align_start: { en: 'Left', zh: '靠左' },
  align_center: { en: 'Center', zh: '居中' },
  size_small: { en: 'Small', zh: '小' },
  size_medium: { en: 'Medium', zh: '中' },
  size_large: { en: 'Large', zh: '大' },
  moveUp: { en: 'Move up', zh: '上移' },
  moveDown: { en: 'Move down', zh: '下移' },
  arrange: { en: 'Reorder', zh: '调整顺序' },
  hide: { en: 'Hide', zh: '隐藏' },
  show: { en: 'Show', zh: '显示' },
  hiddenTag: { en: 'Hidden', zh: '已隐藏' },
  done: { en: 'Done', zh: '完成' },
  edit: { en: 'Edit', zh: '编辑' },
  editPage: { en: 'Edit page', zh: '编辑页面' },
  editHint: {
    en: 'Tap a block to change it, hold ≡ to move it, tap Done when finished.',
    zh: '点一块就能改，按住 ≡ 拖动换位置，改好点「完成」。',
  },
  discardEditTitle: { en: 'Discard your changes?', zh: '放弃这次的修改？' },
  discardEditMessage: {
    en: 'None of the changes made in edit mode will be kept.',
    zh: '这次编辑里的修改都不会保存。',
  },
  keepEditing: { en: 'Keep editing', zh: '继续编辑' },
  discard: { en: 'Discard', zh: '放弃' },
  tooManyEdits: {
    en: 'That’s a lot of changes at once. Tap Done to save them, then keep editing.',
    zh: '这次改动太多了。请先点「完成」保存，再继续编辑。',
  },
  editPageSummary: {
    en: 'Edit “{page}” ({count} changes)',
    zh: '编辑「{page}」（{count} 处修改）',
  },
  groupLabel: { en: 'Group', zh: '分组' },
  field_title: { en: 'Title', zh: '标题' },
  field_subtitle: { en: 'Subtitle', zh: '副标题' },
  field_text: { en: 'Text', zh: '文字' },
  field_label: { en: 'Button text', zh: '按钮文字' },
  field_caption: { en: 'Caption', zh: '说明' },
  field_placeholder: { en: 'Hint before a photo is chosen', zh: '未选照片时的提示' },
  optional: { en: 'optional', zh: '可不填' },
  richTextHint: {
    en: '**bold**, *italic*, [link](https://…), lines starting with - become a list',
    zh: '**粗体**、*斜体*、[链接](https://…)；以 - 开头的行是列表',
  },
  textRequired: { en: 'This can’t be empty', zh: '不能为空' },
  deleteComponentTitle: { en: 'Delete {label}?', zh: '删除{label}？' },
  deleteComponentMessage: {
    en: 'Cancel discards the whole edit; after saving you can still undo it.',
    zh: '点「取消」可以放弃这次编辑，保存后也能撤销。',
  },
  deleteGroupMessage: {
    en: 'The {count} parts inside it are deleted too. Cancel discards the whole edit; after saving you can still undo it.',
    zh: '里面的 {count} 块也会一起删除。点「取消」可以放弃这次编辑，保存后也能撤销。',
  },
  deleteDataMessage: {
    en: 'Your entries are kept (Settings → Data). Cancel discards the whole edit; after saving you can still undo it.',
    zh: '记录不会被删除（在「设置 → 数据」里）。点「取消」可以放弃这次编辑，保存后也能撤销。',
  },
  // AI 只改 App（D-113、D-124–D-130）
  readyTitle: { en: 'Your quick action is ready', zh: '快捷操作做好了' },
  readyRunNow: { en: 'Use it now', zh: '现在就用一次' },
  readyLater: { en: 'Not now', zh: '先不用' },
  readyHome: {
    en: 'There is also a shortcut on the home page: tap it next time.',
    zh: '首页上也放了入口，下次点一下就能用。',
  },
  askAIChange: { en: 'Ask AI to change it', zh: '让 AI 改这个' },
  readyFix: { en: 'Not quite right? Ask AI to change it', zh: '不太对？让 AI 改这个' },
  aboutWorkflow: { en: 'Changing “{name}”', zh: '要改的快捷操作：「{name}」' },
  aboutWorkflowHint: {
    en: 'Say how it should change, or try one of the examples below.',
    zh: '说说想怎么改它，也可以先试试下面的例子。',
  },
  aboutPlaceholder: { en: 'For example: {example}', zh: '例如：{example}' },
  aboutShared: {
    en: 'For the {what} you shared',
    zh: '给分享进来的 {what}',
    fr: 'Pour les {what} partagés',
  },
  aboutSharedHint: {
    en: 'Say what these files should become; AI makes a quick action for it. AI only knows what kind of files they are and how many.',
    zh: '说说想把这些文件变成什么，AI 会做一个快捷操作。AI 只知道文件的类型和个数。',
  },
  sharedPhotos: { en: '{n} photos', zh: '{n} 张照片' },
  sharedPdfs: { en: '{n} PDFs', zh: '{n} 个 PDF' },
  sharedOthers: { en: '{n} files', zh: '{n} 个文件' },
  habitTitle: { en: 'Often use {value}?', zh: '经常用「{value}」？' },
  habitBody: {
    en: 'Make it a quick action “{name}” on the home page, so next time it is one tap and no questions.',
    zh: '做成快捷操作「{name}」放到首页，下次点一下就好，不用再选。',
  },
  habitMake: { en: 'Make it', zh: '做一个' },
  habitNo: { en: 'No thanks', zh: '不用了' },
  habitMade: { en: 'Added “{name}” to the home page', zh: '已把「{name}」放到首页' },

  // ---- 翻译（D-170–D-176）：错误说明拼进「不支持这个步骤：…」/「需要的内容没有下载好：…」 ----
  translateNeedsFullApp: {
    en: 'Translate (it works in the full Morph app, not in this preview)',
    zh: '翻译（要在正式版 Morph 里用，这个预览版里没有本机翻译）',
  },
  translateOsTooOld: {
    en: 'Translate (needs iOS 18 or later)',
    zh: '翻译（需要 iOS 18 或更新的系统）',
  },
  translatePairUnsupported: {
    en: 'translating {from} into {to} (this phone can’t do it)',
    zh: '把{from}翻成{to}（这台手机不支持）',
  },
  translateDownloadAsk: {
    en: 'First use needs a download of about {mb} MB',
    zh: '首次使用需下载约 {mb} MB',
  },
  translateDownloadBody: {
    en: 'Translation languages: {langs}. After that it works offline. Wi-Fi is recommended.',
    zh: '翻译语言：{langs}。之后不联网也能用，建议连接 Wi-Fi。',
  },
  translateDownload: { en: 'Download', zh: '下载' },
  translateDownloadFailed: {
    en: 'the {langs} language files (check the connection and try again)',
    zh: '{langs}的翻译语言（请检查网络后再试）',
  },
  translateLanguageTitle: { en: 'Translation: {name}', zh: '翻译语言：{name}' },
  translateLanguageHint: {
    en: 'About 30 MB, for translating on this device (Google ML Kit).',
    zh: '约 30 MB，用来在本机翻译（Google ML Kit）。',
  },
  translateDeleteMessage: {
    en: 'You will be asked to download it again the next time you translate this language.',
    zh: '下次翻译这种语言时会再问你是否下载。',
  },
  translateNote: {
    en: 'Translated on this device — good for understanding the meaning. For official documents, use a professional translator.',
    zh: '本机翻译，适合看懂意思；正式文件请找专业翻译。',
  },
  // ---- 视频、音频和压缩 PDF（D-140–D-148）。音频工具的文字请另起一块，方便合并。----
  runPercent: { en: '{done}%', zh: '{done}%' },
  runError_needsFullApp: {
    en: 'Videos and audio can only be processed in the full Morph app, not in this preview.',
    zh: '视频和音频要在正式版 Morph 里处理，这个预览版里不行。',
  },
  backgroundNeedsSystem: {
    en: 'Background removal needs iOS 17 or later, or Android with Google Play services.',
    zh: '去背景需要 iOS 17 或更新版本，或带 Google Play 服务的 Android。',
  },
  backgroundDownload: { en: 'Download', zh: '下载' },
  backgroundDownloadAsk: { en: 'Download background removal?', zh: '下载去背景功能？' },
  backgroundDownloadBody: {
    en: 'Google Play services needs to download a model first. Photos stay on this device. After downloading, processing works offline.',
    zh: 'Google Play 服务需要先下载模型。照片留在本机，下载后可以离线处理。',
  },
  backgroundDownloadFailed: {
    en: 'The background removal model could not be downloaded. Check your connection and Google Play services, then try again.',
    zh: '去背景模型没下载成功。请检查网络和 Google Play 服务后重试。',
  },
  runError_backgroundFailed: {
    en: 'Could not remove the background from “{name}”. Try a clear photo with a distinct subject.',
    zh: '「{name}」没能去掉背景，请试一张主体清晰、和背景有区别的照片。',
  },
  runError_mediaUnsupported: {
    en: '“{name}” can’t be opened: the format isn’t supported, or it is copy-protected.',
    zh: '「{name}」打不开：格式不支持，或者有版权保护。',
  },
  runError_notEnoughSpace: {
    en: 'There isn’t enough space on this phone. About {gb} GB more is needed.',
    zh: '手机空间不够，还需要大约 {gb} GB。',
  },
  runError_targetTooSmall: {
    en: 'At {target}, “{name}” would be too blurry to watch. It needs at least {mb} MB, or trim it shorter first.',
    zh: '「{name}」压到 {target} 画面会看不清。至少要 {mb} MB，或者先剪短一点。',
  },
  runError_interrupted: {
    en: 'Morph went to the background, so this didn’t finish. Stay in Morph and tap “Run again”.',
    zh: '处理时切到了别的 App，没有完成。请留在 Morph 里，再点「再来一次」。',
  },
  // 长任务切到后台也继续（D-160–D-162）：运行页的提示，Android 通知栏的进度和完成通知。
  runCanLeave: {
    en: 'You can switch to another app; Morph keeps working in the background.',
    zh: '可以切到别的 App，Morph 会在后台接着处理。',
  },
  runStayInMorph: {
    en: 'Stay in Morph while this is being processed.',
    zh: '处理时请留在 Morph 里。',
  },
  bgPreparing: { en: 'Getting ready…', zh: '准备中…' },
  bgStep: { en: 'Step {n} of {total}: {step}', zh: '第 {n}/{total} 步：{step}' },
  bgDoneTitle: { en: '“{name}” is done', zh: '「{name}」处理完了' },
  bgDoneBody: { en: 'Tap to see the result.', zh: '点这里看结果。' },
  bgFailedTitle: { en: '“{name}” didn’t finish', zh: '「{name}」没有完成' },
  bgFailedBody: { en: 'Tap to see what happened.', zh: '点这里看看是怎么回事。' },
  mediaPlay: { en: 'Play', zh: '播放' },
  mediaDuration: { en: '{duration}', zh: '{duration}' },
  frameTitle: { en: 'Choose a frame', zh: '选一帧' },
  frameDone: { en: 'Save this frame', zh: '就要这一帧' },
  frameHint: {
    en: 'Tap the timeline, then adjust the time to choose a photo.',
    zh: '点时间轴选画面，再微调时间。',
  },
  trimTitle: { en: 'Trim', zh: '剪一段' },
  trimOf: { en: '{n} of {total}', zh: '第 {n}/{total} 个' },
  trimHint: {
    en: 'Drag the two handles to choose the part to keep.',
    zh: '拖动两边的把手，选出要留下的一段。',
  },
  trimStart: { en: 'Start', zh: '开始' },
  trimEnd: { en: 'End', zh: '结束' },
  trimLength: { en: '{length} kept', zh: '留下 {length}' },
  trimPlaySelection: { en: 'Play this part', zh: '只播放这一段' },
  trimPause: { en: 'Pause', zh: '暂停' },
  trimDone: { en: 'Done', zh: '完成' },
  trimNext: { en: 'Next', zh: '下一个' },
  sharedVideos: { en: '{n} videos', zh: '{n} 个视频' },
  sharedAudio: { en: '{n} audio files', zh: '{n} 个音频' },

  // AI 修改的草稿（D-190）
  draftDropped: {
    en: 'The app changed since you left the draft; {n} step(s) no longer fit and were removed.',
    zh: '离开草稿之后 App 又改过，有 {n} 步套不上了，已经去掉。',
  },
  draftFirstStep: {
    en: 'This is the first step of the draft. To drop the whole draft, delete it on the Change this app page.',
    zh: '这已经是草稿的第一步了。要整个丢掉，去「修改这个 App」删除草稿。',
  },
  draftEdit: { en: 'Change', zh: '修改' },
  draftBack: { en: 'Step back', zh: '退一步' },
  draftApply: { en: 'Apply', zh: '应用' },
  draftLeave: { en: 'Leave', zh: '离开' },
  draftLocked: {
    en: 'This is a draft. Apply it to use this.',
    zh: '这是草稿，应用之后才能用。',
  },
  draftReplyTitle: { en: 'Done. This is how it looks now', zh: '改好了，这是改完后的样子' },
  draftGuideHint: {
    en: 'Tap Apply to keep it, or Change to keep going.',
    zh: '点「应用」保留，点「修改」接着说。',
  },
  draftChatTitle: { en: 'Change the draft', zh: '修改草稿' },
  draftChatClose: { en: 'Hide', zh: '收起' },
  draftChatPlaceholder: { en: 'Say one more thing…', zh: '再说一句…' },
  draftSteppedBack: { en: 'Took back the last step.', zh: '退了一步。' },
  draftCard: { en: 'You have a draft · {n} step(s)', zh: '你有一份草稿 · {n} 步' },
  draftCardHint: {
    en: 'Look changes you ask for now continue this draft; quick actions, tools and data tables take effect right away.',
    zh: '新说的外观修改会接着改这份草稿；快捷操作、工具和数据表直接生效。',
  },
  draftContinue: { en: 'Continue', zh: '继续' },
  draftDelete: { en: 'Delete', zh: '删除' },
  draftDeleteTitle: { en: 'Delete this draft?', zh: '删掉这份草稿？' },
  draftDeleteBody: {
    en: 'All {n} step(s) of the draft are dropped. The app stays as it is.',
    zh: '草稿里的 {n} 步都会丢掉，App 不受影响。',
  },
  send: { en: 'Send', zh: '发送' },
  changeAsk: {
    en: 'What should change? One sentence is enough',
    zh: '想怎么改？说一句就行',
  },
  pickStyleChip: { en: 'Pick a style', zh: '换个风格' },
  draftRenderFailed: {
    en: 'The last change could not be shown, so it was taken back.',
    zh: '刚才那一步显示不出来，已经撤掉。',
  },

  // 功能和外观分开改（D-191）
  draftNoFunction: {
    en: 'The draft only changes the look. Quick actions, tools and data tables are changed on the Change this app page: they take effect right away and can be undone.',
    zh: '草稿里只改外观。快捷操作、工具和数据表要在「修改这个 App」里改：会直接生效，可以撤销。',
  },
  draftNoFunctionGo: { en: 'Say it on Change this app', zh: '去「修改这个 App」说' },
  functionNeedsDraft: {
    en: 'This change needs something from your draft. Apply the draft first, then say it again.',
    zh: '这个修改要用到草稿里还没应用的改动。先应用草稿，再说一次。',
  },
  nextTitle: { en: 'Keep going', zh: '接着改' },
  nextHint: {
    en: 'The rest of what you asked changes the look: tap to see it in a draft first.',
    zh: '这句话里剩下的是外观的修改，点一下先在草稿里看看效果。',
  },
  tableReadyTitle: { en: 'Your data table is ready', zh: '数据表做好了' },
  tableReadyRecord: { en: 'Add an entry now', zh: '现在就记一笔' },
  tableReadyWhere: {
    en: 'Entries stay on this device. You can also see the table in Settings → Data.',
    zh: '记录存在本机，在「设置 → 数据」里也能看到这张表。',
  },

  // 新手引导（D-149）
  guideSkip: { en: 'Skip', zh: '跳过' },
  guideNext: { en: 'Next', zh: '下一步' },
  guideStart: { en: 'Start', zh: '开始' },
  // 划屏介绍：每页一张图配一句话。
  guideIntro1: {
    en: 'Your own app. Change how it looks with one sentence, any way you like.',
    zh: '属于你的 App，用一句话随心所欲地改变界面',
  },
  guideIntro2: {
    en: 'Say one sentence and the whole app gets a new look.',
    zh: '说一句话，整个 App 换个样子',
  },
  guideIntro3: {
    en: 'Things that took several steps become one tap.',
    zh: '几步才能做完的事，变成点一下',
  },
  guideIntro4: {
    en: "Now it's your turn. Say your idea in one sentence.",
    zh: '现在轮到你了，用一句话说出你的想法',
  },
  guideIntroMiniTitle: { en: 'My day', zh: '我的一天' },
  guideIntroStyleAsk: { en: 'Make it neon', zh: '换成赛博霓虹风' },
  guideIntroBefore: { en: 'Before', zh: '以前' },
  guideIntroBeforeCount: { en: '5 steps · 2 apps', zh: '5 步 · 换 2 个 App' },
  guideIntroOld1: { en: 'Open Photos', zh: '打开相册' },
  guideIntroOld2: { en: 'Pick photos', zh: '挑照片' },
  guideIntroOld3: { en: 'Compress in another app', zh: '换个 App 压缩' },
  guideIntroOld4: { en: 'Rename', zh: '改名' },
  guideIntroOld5: { en: 'Share', zh: '分享' },
  guideIntroNow: { en: 'Send trip photos to friends', zh: '发旅行照片给朋友' },
  guideIntroAsk: { en: 'I want…', zh: '我想要……' },
  guideIntroIdea1: { en: 'Make the home page dark blue', zh: '首页换成深蓝色' },
  guideIntroIdea2: { en: 'Add a water check-in', zh: '加一个喝水打卡' },
  guideIntroIdea3: { en: 'Turn screenshots into a PDF', zh: '把截图整理成 PDF' },
  guideLookTitle: { en: 'Step 1 · Change this app', zh: '第 1 步 · 说一句话，改掉这个 App' },
  guideLookBody: {
    en: 'Tap one to try it. You see a preview first.',
    zh: '点一句试试，改之前会先给你看预览。',
  },
  guideGoalTitle: {
    en: 'Step 2 · What you have, what you want',
    zh: '第 2 步 · 说出你有什么、想要什么',
  },
  guideGoalBody: {
    en: 'One sentence becomes a quick action you can use right away.',
    zh: '一句话，做成一个能直接用的快捷操作。',
  },
  guideMore: { en: 'Or try', zh: '再试试' },
  guideUndoHint: {
    en: 'Don’t like the change? Tap Undo above to go back.',
    zh: '刚才的修改不喜欢？点上面的「撤销」就能退回去。',
  },
  guideLater: { en: 'Later', zh: '以后再说' },
  guideSkipAll: { en: 'Skip the guide', zh: '跳过引导' },
  guideTask: {
    en: 'Starter task: make a quick action with one sentence',
    zh: '新手任务：一句话做一个快捷操作',
  },
  guideAdded: { en: 'Added by AI', zh: 'AI 加的' },
  readyTryPhotos: { en: 'Try it with sample photos', zh: '用示例照片试一下' },
  readyTryPdfs: { en: 'Try it with sample contracts', zh: '用示例合同试一下' },
  readyRunOwn: { en: 'Use my own files', zh: '用我自己的文件' },
  runTryOwn: { en: 'Now try it with your own files', zh: '换成你自己的文件试试' },
  samplePhotos: { en: 'Sample photos ({n})', zh: '示例照片（{n} 张）' },
  samplePdfs: { en: 'Sample contracts ({n})', zh: '示例合同（{n} 份）' },
  settingsGuide: { en: 'Show the guide again', zh: '重新看新手引导' },
  settingsGuideHint: {
    en: 'The intro and two short exercises',
    zh: '划屏介绍和两个小练习',
  },
  // ---- 音频工具（D-150–D-156，音频会话）----
  runError_audioTooSmall: {
    en: 'At {target}, “{name}” would be too hard to understand. It needs at least {mb} MB, or trim it shorter first.',
    zh: '「{name}」压到 {target} 声音会听不清。至少要 {mb} MB，或者先剪短一点。',
  },
  runError_noAudio: { en: '“{name}” has no sound.', zh: '「{name}」里没有声音。' },
  // ---- 格式转换的缺口（D-183–D-186）----
  runError_formatUnsupported: {
    en: '“{name}” is a {format} file, which this phone can’t open. Convert it to MP4 on a computer first.',
    zh: '「{name}」是 {format} 格式，这台手机打不开。可以先在电脑上转成 MP4。',
  },
  // ---- 需求回收（D-189）----
  needSend: { en: 'Tell us you need this', zh: '把这个需求告诉我们' },
  needRetry: { en: 'Not sent. Try again', zh: '没发出去，再试一次' },
  needSent: {
    en: 'Thanks, we got it. New tools come through updates and downloads.',
    zh: '收到了，谢谢。新功能会通过更新和下载内容加进来。',
  },
  needPrivacy: {
    en: 'Only this sentence is sent to Morph — no files, records or settings.',
    zh: '只发送这一句话给 Morph，不含文件、记录和设置。',
  },
  needsSettingTitle: {
    en: 'Offer to send requests AI can’t do',
    zh: 'AI 做不到时，可以把需求告诉我们',
  },
  needsSettingNote: {
    en: 'Shows a button under the answer. Nothing is sent unless you tap it.',
    zh: '在回答下面显示一个按钮，你点了才会发送那一句话。',
  },
  // ---- 记一笔、附件和公式字段（D-187、D-188）----
  noAttachment: { en: 'No attachment', zh: '没有附件' },
  attachmentMissing: { en: 'The file was deleted', zh: '文件已经删掉了' },
  removeAttachment: { en: 'Remove', zh: '去掉' },
  runError_documentUnsupported: {
    en: '“{name}” is a {format} file. On this phone only Word documents (.docx) can be turned into PDFs.',
    zh: '「{name}」是 {format} 文件。这台手机上只能把 Word 文档（.docx）转成 PDF。',
  },
  runError_tooLong: {
    en: '“{name}” is too long for a GIF (at most {seconds} seconds). Trim it first.',
    zh: '「{name}」太长了，做不成 GIF（最长 {seconds} 秒）。请先剪一段。',
  },
  runError_noSpeech: {
    en: 'No speech was heard in “{name}”.',
    zh: '在「{name}」里没有听到说话。',
  },
  speechLangUnsupported: {
    en: 'This phone can’t recognize {lang} on the device.',
    zh: '这台手机不能在本机识别{lang}。',
  },
  speechUnavailable: {
    en: 'Speech recognition doesn’t work on this device (a simulator, or a system that is too old).',
    zh: '这台设备不能在本机做语音识别（模拟器，或者系统版本太旧）。',
  },
  speechDownloadAsk: {
    en: 'Recognizing {lang} needs a download first',
    zh: '第一次识别{lang}需要先下载',
  },
  speechDownloadBody: {
    en: 'The speech model comes from Apple. After that it works without the internet.',
    zh: '语音模型由苹果提供，下载后不联网也能用。',
  },
  speechDownload: { en: 'Download', zh: '下载' },
  speechDownloadFailed: {
    en: 'the speech model for {lang}',
    zh: '{lang}的语音模型',
  },
  speechNote: {
    en: 'Recognized on this device — words may be wrong, especially with noise or accents. Check it.',
    zh: '本机自动识别，有噪音或口音时可能有错字，请核对。',
  },
  audioMerged: { en: '{name} and {n} more', zh: '{name} 等 {n} 段' },
  trimWaveformLoading: { en: 'Reading the waveform…', zh: '正在读取波形…' },
  trimRingtone: {
    en: 'On Android you can then choose the saved file as a ringtone in Settings → Sounds; an iPhone app can’t set ringtones.',
    zh: '存好后，Android 可以在「设置 → 声音」里把它设成铃声；iPhone 不能由 App 设成铃声。',
  },
  recordTitle: { en: 'Record', zh: '录音' },
  recordMicrophone: { en: 'Microphone', zh: '麦克风' },
  recordFailed: {
    en: 'The microphone can’t be used right now (another app may be using it). Try again.',
    zh: '现在用不了麦克风（可能别的 App 正在用），请再试一次。',
  },
  recordStart: { en: 'Start recording', zh: '开始录音' },
  recordPause: { en: 'Pause', zh: '暂停' },
  recordResume: { en: 'Continue', zh: '继续录' },
  recordDone: { en: 'Done', zh: '完成' },
  recordHint: {
    en: 'It keeps recording when the screen locks. Tap Done when you have finished.',
    zh: '锁屏后会继续录。录完点「完成」。',
  },
  recordDiscardTitle: { en: 'Throw away this recording?', zh: '不要这段录音了？' },
  recordDiscard: { en: 'Throw away', zh: '不要了' },
  recordKeep: { en: 'Keep recording', zh: '继续录' },
} satisfies Record<string, Record<Locale, string> & { fr?: string }>;

export type StringKey = keyof typeof strings;

const PERMISSION_NAMES: Record<string, Record<Locale, string> & { fr?: string }> = {
  photos: { en: 'Photos', zh: '相册' },
  camera: { en: 'Camera', zh: '相机' },
  microphone: { en: 'Microphone', zh: '麦克风' },
  speech: { en: 'Speech recognition', zh: '语音识别' },
};

/** 运行错误的提示（detail 里的权限名等内部词换成用户看得懂的说法）。 */
export function runErrorText(
  locale: Locale,
  code: string,
  detail: Record<string, string | number> = {},
): string {
  const what =
    typeof detail.what === 'string' ? PERMISSION_NAMES[detail.what]?.[locale] : undefined;
  const key = `runError_${code}` as StringKey;
  if (!(key in strings)) return t(locale, 'runError_unexpected', { detail: code });
  return t(locale, key, { ...detail, ...(what ? { what } : {}) });
}

/** 改动记录里的时间（D-112）：今天 / 昨天 13:51，更早的显示日期，不显示秒。 */
export function formatWhen(locale: Locale, at: Date, now: Date): string {
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return t(locale, 'dateToday', { time });
  if (days === 1) return t(locale, 'dateYesterday', { time });
  const sameYear = at.getFullYear() === now.getFullYear();
  if (locale === 'zh')
    return `${sameYear ? '' : `${at.getFullYear()}年`}${at.getMonth() + 1}月${at.getDate()}日 ${time}`;
  const date = at.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date}, ${time}`;
}

export function t(
  locale: Locale,
  key: StringKey,
  vars: Record<string, string | number> = {},
): string {
  return strings[key][locale].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars[name] ?? `{${name}}`),
  );
}
