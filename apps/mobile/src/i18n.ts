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
    en: '“{name}” is password-protected, which is not supported yet.',
    zh: '「{name}」有密码保护，暂不支持。',
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
  aboutShared: { en: 'For the {what} you shared', zh: '给分享进来的 {what}' },
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
} satisfies Record<string, Record<Locale, string>>;

export type StringKey = keyof typeof strings;

const PERMISSION_NAMES: Record<string, Record<Locale, string>> = {
  photos: { en: 'Photos', zh: '相册' },
  camera: { en: 'Camera', zh: '相机' },
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
