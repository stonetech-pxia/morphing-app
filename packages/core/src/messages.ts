import { FRENCH_PAIRS } from './french-pairs';
import type { Locale, Localized } from './schema';

export const strings = {
  trustNote: {
    en: 'No ads. No account needed to work with your files. Files are processed on this device. When you ask AI to change the app, it gets your request and the app’s settings — never your files or entries.',
    zh: '没有广告。处理文件不需要账号。文件在本机处理；AI 修改只接收你的要求和 App 配置，不接收文件或记录内容。',
    fr: 'Sans publicité. Aucun compte requis pour traiter vos fichiers. Le traitement reste sur votre appareil. L’IA reçoit votre demande et la configuration de l’application, jamais le contenu des fichiers ou des entrées.',
  },
  resultContinue: { en: 'Continue processing', zh: '接着处理', fr: 'Continuer le traitement' },
  resultIncoming: {
    en: 'For these results: {what}',
    zh: '接着处理这些结果：{what}',
    fr: 'Pour ces résultats : {what}',
  },
  chainMake: {
    en: 'Combine into one quick action',
    zh: '合成一个快捷操作',
    fr: 'Combiner en une action rapide',
  },
  chainAbout: {
    en: 'First “{first}”, then “{second}”',
    zh: '先「{first}」，再「{second}」',
    fr: 'D’abord « {first} », puis « {second} »',
  },
  chainSaveBuiltIn: {
    en: 'Saved “{first}” and “{second}” to combine them',
    zh: '保存了「{first}」和「{second}」，用来合成',
    fr: '« {first} » et « {second} » enregistrées pour les combiner',
  },
  chainRequest: {
    en: 'Create one quick action that combines these two in this order, without choosing files again between them.',
    zh: '按这个顺序合成一个快捷操作，中间不用重新选择文件。',
    fr: 'Créez une action rapide combinant ces deux actions dans cet ordre, sans sélectionner les fichiers à nouveau entre les deux.',
  },

  openMedia: { en: 'Open photo library', zh: '打开相册', fr: 'Ouvrir les photos' },
  openFiles: { en: 'Open files', zh: '打开文件', fr: 'Ouvrir les fichiers' },
  filePickFailed: {
    en: 'Could not open the picker. Please try again.',
    zh: '没能打开选择器，请重试。',
    fr: 'Impossible d’ouvrir le sélecteur. Réessayez.',
  },
  shareRecent: { en: 'Used before', zh: '最近用过', fr: 'Déjà utilisées' },
  shareSuggested: {
    en: 'Try one of these',
    zh: '可以试试这些',
    fr: 'Essayez l’une de ces actions',
  },
  shareUsed: { en: 'Used {n} times', zh: '用过 {n} 次', fr: 'Utilisé {n} fois' },
  shareDescribe: {
    en: 'Tell Morph what I need',
    zh: '我要自己说',
    fr: 'Décrire ce dont j’ai besoin',
  },
  shareSeeAll: { en: 'See all {n}', zh: '查看全部 {n} 个', fr: 'Tout voir ({n})' },
  sharePicked: {
    en: 'For the {what} you picked',
    zh: '给你选的 {what}',
    fr: 'Fichiers sélectionnés : {what}',
  },
  sharePlaceholder: {
    en: 'Say what you want, and Morph will do its best',
    zh: '说出你想要的，Morph 会努力完成你的需求',
    fr: 'Dites ce que vous voulez, Morph fera de son mieux pour y arriver',
  },
  shareExpand: { en: 'Show files', zh: '查看文件', fr: 'Voir les fichiers' },
  shareCollapse: { en: 'Hide files', zh: '收起文件', fr: 'Masquer les fichiers' },
  sharePreview: { en: 'Preview', zh: '预览', fr: 'Aperçu' },
  shareSummary: { en: '{n} files', zh: '{n} 个文件', fr: '{n} fichiers' },
  sharePhotoSummary: { en: '{n} photos', zh: '{n} 张照片', fr: '{n} photos' },
  loading: { en: 'Loading…', zh: '正在载入…', fr: 'Chargement…' },
  bootFailed: {
    en: 'The workspace could not be opened.',
    zh: '无法打开工作空间。',
    fr: 'L’espace de travail n’a pas pu être ouvert.',
  },

  // 修改流程
  changeTitle: { en: 'Change this app', zh: '修改这个 App', fr: 'Modifier cette application' },
  changeHint: {
    en: 'Describe what to change. You will see a preview before anything changes.',
    zh: '用一句话描述想怎么改。改之前会先给你看预览。',
    fr: 'Décrivez ce que vous voulez modifier. Vous verrez un aperçu avant toute modification.',
  },
  changePlaceholder: {
    en: 'e.g. Bigger text and no shadows',
    zh: '例如：字体大一点，去掉阴影',
    fr: 'ex. : Texte plus grand et sans ombres',
  },
  examples: { en: 'Try:', zh: '可以试试：', fr: 'Essayez :' },
  pickStyle: { en: 'Pick a style', zh: '选一个风格', fr: 'Choisissez un style' },
  preview: { en: 'Preview', zh: '预览', fr: 'Aperçu' },
  thinking: { en: 'Working on it…', zh: '正在生成修改…', fr: 'Modification en cours…' },
  planTitle: { en: 'Planned changes', zh: '将要做的修改', fr: 'Modifications prévues' },
  before: { en: 'Now', zh: '现在', fr: 'Actuel' },
  after: { en: 'After', zh: '改完后', fr: 'Après' },
  apply: { en: 'Make this change', zh: '确认修改', fr: 'Appliquer cette modification' },
  cancel: { en: 'Cancel', zh: '取消', fr: 'Annuler' },
  undo: { en: 'Undo', zh: '撤销', fr: 'Annuler' },
  close: { en: 'Close', zh: '关闭', fr: 'Fermer' },
  invalidPlan: {
    en: 'This change was blocked because it would break the app:',
    zh: '这次修改未通过校验，已被拦截：',
    fr: 'Cette modification a été bloquée car elle casserait l’application :',
  },
  previewFailed: {
    en: 'The preview could not be rendered.',
    zh: '预览渲染失败。',
    fr: 'Impossible d’afficher l’aperçu.',
  },
  applied: { en: 'Changed: {summary}', zh: '已改好：{summary}', fr: 'Modifié : {summary}' },
  conflict: {
    en: 'The app changed while you were previewing. Nothing was changed; please try again.',
    zh: '预览期间 App 已被修改，这次没有改，请重新生成。',
    fr: 'L’application a été modifiée pendant l’aperçu. Rien n’a été changé ; veuillez réessayer.',
  },
  rolledBack: {
    en: 'The change could not be displayed, so the app went back to how it was.',
    zh: '这次修改无法正常显示，已自动回到改之前的样子。',
    fr: 'La modification n’a pas pu être affichée. L’application est revenue à son état précédent.',
  },
  recovered: {
    en: 'The latest change was damaged, so the app went back to the last time it worked.',
    zh: '最近的修改已损坏，已自动回到最后一次能正常使用的样子。',
    fr: 'La dernière modification était endommagée. L’application est revenue à la dernière version qui fonctionnait.',
  },
  noPrevious: {
    en: 'There is no earlier change to undo.',
    zh: '前面没有可以撤销的修改了。',
    fr: 'Il n’y a plus de modification antérieure à annuler.',
  },
  aiUnavailable: {
    en: 'The AI service could not be reached. Nothing was changed; please try again later.',
    zh: '暂时连不上 AI 服务，没有做任何修改，请稍后再试。',
    fr: 'Impossible de joindre le service IA. Aucune modification n’a été apportée ; veuillez réessayer plus tard.',
  },
  aiRateLimited: {
    en: 'Too many requests in a short time. Please wait a minute and try again.',
    zh: '请求太频繁了，请等一分钟再试。',
    fr: 'Trop de requêtes en peu de temps. Veuillez patienter une minute, puis réessayer.',
  },
  aiDailyLimit: {
    en: 'Today’s AI request limit has been reached. Try again tomorrow.',
    zh: '今天的 AI 请求次数已用完，请明天再试。',
    fr: 'La limite de requêtes IA d’aujourd’hui a été atteinte. Réessayez demain.',
  },
  undoSummary: { en: 'Undo', zh: '撤销', fr: 'Annuler' },

  // 改动记录（D-112）
  historyTitle: { en: 'Change history', zh: '改动记录', fr: 'Historique des modifications' },
  current: { en: 'Now', zh: '现在的样子', fr: 'État actuel' },
  restoreThis: { en: 'Restore this version', zh: '回到这时候的样子', fr: 'Revenir à ce moment' },
  restoreSummary: { en: 'Back to {when}', zh: '回到 {when} 的样子', fr: 'Retour à {when}' },
  source_seed: { en: 'Start', zh: '一开始', fr: 'Début' },
  source_ai: { en: 'By AI', zh: 'AI 改的', fr: 'Par l’IA' },
  source_user: { en: 'By you', zh: '你改的', fr: 'Par vous' },
  source_restore: { en: 'Restored', zh: '回到之前', fr: 'Retour en arrière' },
  source_rollback: { en: 'Undone automatically', zh: '自动退回', fr: 'Annulé automatiquement' },
  source_recovery: { en: 'Fixed automatically', zh: '自动修复', fr: 'Corrigé automatiquement' },
  initialSummary: {
    en: 'The app as installed',
    zh: '刚装好的样子',
    fr: 'L’app telle qu’installée',
  },
  dateToday: { en: 'Today {time}', zh: '今天 {time}', fr: 'Aujourd’hui à {time}' },
  dateYesterday: { en: 'Yesterday {time}', zh: '昨天 {time}', fr: 'Hier à {time}' },

  // 工具目录
  toolsTitle: { en: 'Tools', zh: '工具', fr: 'Outils' },
  install: { en: 'Add', zh: '添加', fr: 'Ajouter' },
  open: { en: 'Open', zh: '打开', fr: 'Ouvrir' },
  installed: { en: 'Added', zh: '已添加', fr: 'Ajouté' },
  uninstall: { en: 'Remove', zh: '移除', fr: 'Retirer' },
  removeFromHome: { en: 'Remove from home', zh: '从首页移除入口', fr: 'Retirer de l’accueil' },
  addToHome: { en: 'Add to home', zh: '添加到首页', fr: 'Ajouter à l’accueil' },
  installSummary: { en: 'Added {name}', zh: '添加了{name}工具', fr: '{name} ajouté' },
  uninstallSummary: { en: 'Removed {name}', zh: '移除了{name}工具', fr: '{name} retiré' },
  uninstallTitle: { en: 'Remove {name}?', zh: '移除{name}工具？', fr: 'Retirer {name} ?' },
  removeCardSummary: {
    en: 'Removed {name} from home',
    zh: '从首页移除了{name}',
    fr: '{name} retiré de l’accueil',
  },
  addCardSummary: {
    en: 'Added {name} to home',
    zh: '把{name}放到了首页',
    fr: 'Ajouter {name} à l’accueil',
  },
  // 下载的工具（D-177）
  toolDownloadSize: { en: 'Downloads {size}', zh: '需要下载 {size}', fr: 'À télécharger : {size}' },
  toolDownloading: { en: 'Downloading…', zh: '正在下载…', fr: 'Téléchargement en cours…' },
  toolNeedsAppUpdate: {
    en: 'Needs a newer version of this app',
    zh: '需要先更新 App 才能添加',
    fr: 'Nécessite une version plus récente de cette app',
  },
  toolRevoked: { en: 'Paused', zh: '暂时停用', fr: 'En pause' },
  toolRevokedRun: {
    en: '“{name}” is paused for now, so this quick action can’t run. Try again later.',
    zh: '「{name}」暂时停用了，这个快捷操作现在不能用。过一阵再试试。',
    fr: '« {name} » est en pause pour le moment : cette action rapide ne peut pas s’exécuter. Réessayez plus tard.',
  },
  toolDownloadFailedTitle: {
    en: '“{name}” was not added',
    zh: '「{name}」没有添加',
    fr: 'Impossible d’ajouter « {name} »',
  },
  toolDownloadFailed: {
    en: 'It could not be downloaded. Check the network and try again.',
    zh: '没有下载成功。请检查网络后再试。',
    fr: 'Le téléchargement a échoué. Vérifiez la connexion et réessayez.',
  },
  toolDownloadRejected: {
    en: 'What was downloaded did not pass the safety check, so nothing was changed.',
    zh: '下载的内容没有通过安全检查，什么都没有改。',
    fr: 'Le contenu téléchargé n’a pas passé le contrôle de sécurité ; rien n’a été modifié.',
  },
  restoreNeedsTool: {
    en: 'This version uses {names}, which is not on this phone. Add it in Tools first, then restore.',
    zh: '这个版本用到了「{names}」，这台手机上还没有。先到「工具」里添加，再恢复。',
    fr: 'Cette version utilise {names}, qui n’est pas sur ce téléphone. Ajoutez d’abord dans « Outils », puis restaurez.',
  },
  listSeparator: { en: ', ', zh: '、', fr: ', ' },
  toolDownloadedHint: {
    en: 'A tool downloaded from the Morph catalog.',
    zh: '从 Morph 工具目录下载的工具。',
    fr: 'Outil téléchargé depuis le catalogue Morph.',
  },
  toolDeleteMessage: {
    en: 'You can download it again from Tools later.',
    zh: '以后可以在「工具」里再下载。',
    fr: 'Vous pourrez le retélécharger plus tard depuis « Outils ».',
  },
  toolDeleteAdded: {
    en: 'This tool is still added. Remove it in Tools first, then delete it here.',
    zh: '这个工具还在用。先到「工具」里移除它，再回来删除。',
    fr: 'Cet outil est encore ajouté. Retirez-le d’abord dans « Outils », puis supprimez-le ici.',
  },

  // 设置
  settingsTitle: { en: 'Settings', zh: '设置', fr: 'Paramètres' },
  thisApp: { en: 'This app', zh: '这个 App', fr: 'Cette app' },
  general: { en: 'General', zh: '通用', fr: 'Général' },
  changeRowHint: {
    en: 'Describe how the app should change',
    zh: '用一句话描述想怎么改',
    fr: 'Décrivez en une phrase comment modifier l’app',
  },
  historyRowHint: {
    en: 'Undo a change or go back to how the app was before',
    zh: '撤销修改，或回到之前任何时候的样子',
    fr: 'Annuler une modification ou revenir à un état antérieur de l’app',
  },
  toolsRowHint: {
    en: 'Add, open or remove tools',
    zh: '添加、打开或移除工具',
    fr: 'Ajouter, ouvrir ou retirer des outils',
  },
  openHistory: { en: 'Change history', zh: '改动记录', fr: 'Historique des modifications' },
  language: { en: 'Language', zh: '语言', fr: 'Langue' },
  languageValue: {
    en: 'English (follows system)',
    zh: '简体中文（跟随系统）',
    fr: 'Français (suit le système)',
  },
  aiEngine: { en: 'AI', zh: 'AI', fr: 'IA' },
  aiEngineRemote: {
    en: 'Claude via the Morph server',
    zh: 'Claude（通过 Morph 服务器）',
    fr: 'Claude via le serveur Morph',
  },
  aiEngineMock: {
    en: 'Built-in rules (offline mock)',
    zh: '内置规则（离线 mock）',
    fr: 'Règles intégrées (simulation hors ligne)',
  },
  aiEngineByok: {
    en: 'My own API key ({model})',
    zh: '我自己的 API key（{model}）',
    fr: 'Ma propre clé API ({model})',
  },

  // AI 设置
  aiSettingsTitle: { en: 'AI', zh: 'AI', fr: 'AI' },
  aiModeQuestion: {
    en: 'Which AI changes this app',
    zh: '用哪种 AI 修改这个 App',
    fr: 'Quelle IA modifie cette app',
  },
  aiModeMock: { en: 'Built-in rules', zh: '内置规则', fr: 'Règles intégrées' },
  aiModeMockNote: {
    en: 'Offline and free. Understands a fixed set of phrases.',
    zh: '离线、免费，只认识固定的几种说法。',
    fr: 'Hors ligne et gratuit. Ne comprend qu’un nombre fixe de formulations.',
  },
  aiModeServer: { en: 'Morph server', zh: 'Morph 服务器', fr: 'Serveur Morph' },
  aiModeServerNote: {
    en: 'Claude through {url}.',
    zh: '通过 {url} 调用 Claude。',
    fr: 'Claude via {url}.',
  },
  // 测试期服务器保存请求（D-240）：只在用 Morph 服务器时显示。
  aiServerStoredNote: {
    en: 'During the beta, what you say to the AI and the app’s settings are saved to improve Morph. Files and entries are never sent.',
    zh: '测试期间，你对 AI 说的话和界面配置会被保存，用来改进 Morph；文件和记录不会发送。',
    fr: 'Pendant la bêta, ce que vous dites à l’IA et la configuration de l’application sont enregistrés pour améliorer Morph. Les fichiers et les entrées ne sont jamais envoyés.',
  },
  aiModeByok: {
    en: 'My own API key',
    zh: '我自己的 API key',
    fr: 'Ma propre clé API',
  },
  aiModeByokNote: {
    en: 'Calls the provider you choose directly from this phone: Claude, or any OpenAI-compatible API. Usage is billed to your account with that provider.',
    zh: '从这台手机直接调用你选的 provider：Claude，或任意 OpenAI 兼容接口。费用由你在那家的账号支付。',
    fr: 'Appelle directement depuis ce téléphone le fournisseur de votre choix : Claude, ou toute API compatible OpenAI. L’usage est facturé sur votre compte chez ce fournisseur.',
  },
  // 自带 key 的两种 provider（D-241）
  byokProviderLabel: { en: 'Provider', zh: 'Provider', fr: 'Fournisseur' },
  byokProviderAnthropic: {
    en: 'Anthropic (Claude)',
    zh: 'Anthropic（Claude）',
    fr: 'Anthropic (Claude)',
  },
  byokProviderAnthropicNote: {
    en: 'Tested. Morph’s instructions to the AI are tuned for Claude.',
    zh: '测试过。Morph 给 AI 的说明是按 Claude 调的。',
    fr: 'Testé. Les instructions de Morph à l’IA sont réglées pour Claude.',
  },
  byokProviderOpenAI: {
    en: 'OpenAI-compatible API',
    zh: 'OpenAI 兼容接口',
    fr: 'API compatible OpenAI',
  },
  byokProviderOpenAINote: {
    en: 'OpenAI, OpenRouter, DeepSeek, Gemini, Groq, Ollama, LM Studio and others. Not tested.',
    zh: 'OpenAI、OpenRouter、DeepSeek、Gemini、Groq、Ollama、LM Studio 等。没有测试过。',
    fr: 'OpenAI, OpenRouter, DeepSeek, Gemini, Groq, Ollama, LM Studio et d’autres. Non testé.',
  },
  byokOtherWarning: {
    en: 'Morph is tested with Claude. Other models may misunderstand requests or refuse them more often. Every change is still checked before it is applied, and you can undo it.',
    zh: 'Morph 是用 Claude 测试的。其他模型可能更容易理解错或拒绝。每次修改应用前照样会检查，应用后也能撤销。',
    fr: 'Morph est testé avec Claude. D’autres modèles peuvent plus souvent mal comprendre une demande ou la refuser. Chaque modification est toujours vérifiée avant d’être appliquée, et vous pouvez l’annuler.',
  },
  byokSentNote: {
    en: 'When you ask for a change, what you say and the app’s settings are sent to {host}. Your files and entries are never sent.',
    zh: '请 AI 修改时，你说的话和界面配置会发送到 {host}；文件和记录不会发送。',
    fr: 'Quand vous demandez une modification, ce que vous dites et la configuration de l’application sont envoyés à {host}. Vos fichiers et entrées ne sont jamais envoyés.',
  },
  baseUrlLabel: { en: 'Base URL', zh: 'Base URL', fr: 'URL de base' },
  baseUrlPresets: {
    en: 'Fill in the address for',
    zh: '填入常见 provider 的地址',
    fr: 'Remplir l’adresse pour',
  },
  customModelLabel: { en: 'Model name', zh: '模型名', fr: 'Nom du modèle' },
  customModelPlaceholder: {
    en: 'As written in the provider’s docs',
    zh: '照 provider 文档里的写法填',
    fr: 'Tel qu’indiqué dans la documentation du fournisseur',
  },
  saveEndpoint: {
    en: 'Save address and model',
    zh: '保存地址和模型',
    fr: 'Enregistrer l’adresse et le modèle',
  },
  endpointSaved: { en: 'Saved.', zh: '已保存。', fr: 'Enregistré.' },
  baseUrlInvalid: {
    en: 'Enter a full address, for example https://api.openai.com/v1.',
    zh: '请填写完整地址，例如 https://api.openai.com/v1。',
    fr: 'Saisissez une adresse complète, par exemple https://api.openai.com/v1.',
  },
  baseUrlInsecure: {
    en: 'The address must start with https://. Plain http:// only works for localhost.',
    zh: '地址必须以 https:// 开头；http:// 只能用于 localhost。',
    fr: 'L’adresse doit commencer par https://. http:// ne fonctionne que pour localhost.',
  },
  customModelMissing: {
    en: 'Enter the model name.',
    zh: '请填写模型名。',
    fr: 'Saisissez le nom du modèle.',
  },
  otherKeyPlaceholder: {
    en: 'API key (not needed for local models)',
    zh: 'API key（本地模型可以不填）',
    fr: 'Clé API (inutile pour les modèles locaux)',
  },
  otherKeyFormatInvalid: {
    en: 'That doesn’t look like an API key (no spaces, at least 8 characters).',
    zh: '这看起来不是 API key（不能有空格，至少 8 个字符）。',
    fr: 'Ce n’est pas une clé API valide (sans espaces, au moins 8 caractères).',
  },
  otherKeyPrivacyNote: {
    en: 'The key is stored only in this phone’s secure storage (not synced or backed up to other devices) and is sent only to {host}. Changing the address deletes the key.',
    zh: 'key 只保存在这台手机的安全存储里（不会同步或备份到其他设备），只发送给 {host}。换地址时 key 会被删除。',
    fr: 'La clé n’est enregistrée que dans le stockage sécurisé de ce téléphone (non synchronisée ni sauvegardée sur d’autres appareils) et n’est envoyée qu’à {host}. Changer l’adresse supprime la clé.',
  },
  testOkOther: {
    en: 'Connected. The address and key work.',
    zh: '连接成功，地址和 key 都可以用。',
    fr: 'Connecté. L’adresse et la clé fonctionnent.',
  },
  apiKeyLabel: { en: 'API key', zh: 'API key', fr: 'API key' },
  apiKeySaved: {
    en: 'Saved (ends with {hint})',
    zh: '已保存（末四位 {hint}）',
    fr: 'Enregistrée (se termine par {hint})',
  },
  apiKeyPlaceholder: { en: 'sk-ant-…', zh: 'sk-ant-…', fr: 'sk-ant-…' },
  saveKey: { en: 'Save key', zh: '保存 key', fr: 'Enregistrer la clé' },
  deleteKey: { en: 'Delete key', zh: '删除 key', fr: 'Supprimer la clé' },
  keyFormatInvalid: {
    en: 'That doesn’t look like a Claude API key (it starts with sk-ant-).',
    zh: '这看起来不是 Claude API key（应以 sk-ant- 开头）。',
    fr: 'Ce n’est pas une clé API Claude valide (elle doit commencer par sk-ant-).',
  },
  modelLabel: { en: 'Model', zh: '模型', fr: 'Modèle' },
  perChange: {
    en: 'about ${cost} per change',
    zh: '每次修改约 ${cost}',
    fr: 'environ ${cost} par modification',
  },
  testConnection: { en: 'Test connection', zh: '测试连接', fr: 'Tester la connexion' },
  testOk: {
    en: 'Connected. The key works with this model.',
    zh: '连接成功，这个 key 可以使用所选模型。',
    fr: 'Connecté. La clé fonctionne avec ce modèle.',
  },
  keyPrivacyNote: {
    en: 'The key is stored only in this phone’s secure storage (not synced or backed up to other devices) and is sent only to api.anthropic.com. Set a spend limit in the Claude Console.',
    zh: 'key 只保存在这台手机的安全存储里（不会同步或备份到其他设备），只发送给 api.anthropic.com。建议在 Claude Console 设置花费上限。',
    fr: 'La clé n’est enregistrée que dans le stockage sécurisé de ce téléphone (non synchronisée ni sauvegardée sur d’autres appareils) et n’est envoyée qu’à api.anthropic.com. Définissez un plafond de dépenses dans la Claude Console.',
  },

  byokNoKey: {
    en: 'Add your Claude API key in Settings → AI first.',
    zh: '请先在「设置 → AI」里填写你的 Claude API key。',
    fr: 'Ajoutez d’abord votre clé API Claude dans « Paramètres → IA ».',
  },
  byokInvalidKey: {
    en: 'The API key is invalid or was deleted. Check it in Settings → AI.',
    zh: 'API key 无效或已被删除，请在「设置 → AI」里检查。',
    fr: 'La clé API est invalide ou a été supprimée. Vérifiez-la dans « Paramètres → IA ».',
  },
  byokPermission: {
    en: 'This API key isn’t allowed to use the selected model.',
    zh: '这个 API key 没有使用所选模型的权限。',
    fr: 'Cette clé API n’est pas autorisée à utiliser le modèle sélectionné.',
  },
  byokSpendLimit: {
    en: 'Your Claude Console spend limit has been reached. Nothing was changed.',
    zh: '已达到你在 Claude Console 设置的花费上限，没有做任何修改。',
    fr: 'Votre plafond de dépenses dans la Claude Console est atteint. Aucune modification n’a été effectuée.',
  },
  byokBusy: {
    en: 'Claude is busy right now. Nothing was changed; please try again shortly.',
    zh: 'Claude 服务暂时繁忙，没有做任何修改，请稍后再试。',
    fr: 'Claude est occupé pour le moment. Aucune modification n’a été effectuée ; réessayez dans un instant.',
  },
  byokModelNotFound: {
    en: 'The selected model wasn’t found. Choose another model in Settings → AI.',
    zh: '找不到所选模型，请在「设置 → AI」里换一个模型。',
    fr: 'Le modèle sélectionné est introuvable. Choisissez un autre modèle dans « Paramètres → IA ».',
  },
  byokUnavailable: {
    en: 'Couldn’t reach the Claude API. Nothing was changed; check the network and try again.',
    zh: '连不上 Claude API，没有做任何修改，请检查网络后再试。',
    fr: 'Impossible de joindre l’API Claude. Aucune modification n’a été effectuée ; vérifiez la connexion et réessayez.',
  },
  byokNoEndpoint: {
    en: 'Enter the provider’s address and model name in Settings → AI first.',
    zh: '请先在「设置 → AI」里填写 provider 的地址和模型名。',
    fr: 'Saisissez d’abord l’adresse du fournisseur et le nom du modèle dans « Paramètres → IA ».',
  },
  byokOtherSpendLimit: {
    en: 'Your account with this provider is out of credit or has reached its spend limit. Nothing was changed.',
    zh: '你在这家 provider 的余额不足或已达到花费上限，没有做任何修改。',
    fr: 'Votre compte chez ce fournisseur n’a plus de crédit ou a atteint son plafond de dépenses. Aucune modification n’a été effectuée.',
  },
  byokOtherBusy: {
    en: 'The AI provider is busy or had an error. Nothing was changed; please try again shortly.',
    zh: 'AI provider 暂时繁忙或出错，没有做任何修改，请稍后再试。',
    fr: 'Le fournisseur d’IA est occupé ou a rencontré une erreur. Aucune modification n’a été effectuée ; réessayez dans un instant.',
  },
  byokOtherUnavailable: {
    en: 'Couldn’t reach the AI provider, or it didn’t accept the request. Nothing was changed; check the address, the model name and the network.',
    zh: '连不上 AI provider，或它不接受这个请求，没有做任何修改。请检查地址、模型名和网络。',
    fr: 'Impossible de joindre le fournisseur d’IA, ou il n’a pas accepté la requête. Aucune modification n’a été effectuée ; vérifiez l’adresse, le nom du modèle et la connexion.',
  },
  aiBadOutput: {
    en: 'The AI’s answer couldn’t be used. Nothing was changed; try saying it another way.',
    zh: 'AI 返回的内容无法使用，没有做任何修改，请换个说法再试。',
    fr: 'La réponse de l’IA n’a pas pu être utilisée. Aucune modification n’a été effectuée ; reformulez votre demande.',
  },
  about: { en: 'About', zh: '关于', fr: 'À propos' },
  aboutValue: {
    en: 'Morph prototype · AGPL-3.0 · schema v{schema} · version #{revision}',
    zh: 'Morph 原型 · AGPL-3.0 · schema v{schema} · 版本 #{revision}',
    fr: 'Prototype Morph · AGPL-3.0 · schéma v{schema} · version #{revision}',
  },

  // 页面组件
  noFiles: { en: 'No files yet', zh: '还没有文件', fr: 'Aucun fichier pour l’instant' },
  run: { en: 'Start', zh: '开始', fr: 'Démarrer' },
  runAgain: { en: 'Run again', zh: '再来一次', fr: 'Relancer' },
  running: { en: 'Step {n}: {step}', zh: '第 {n} 步：{step}', fr: 'Étape {n} : {step}' },
  runDone: {
    en: 'Saved “{name}” ({pages} pages)',
    zh: '已保存「{name}」（{pages} 页）',
    fr: '« {name} » enregistré ({pages} pages)',
  },
  runCancelled: { en: 'Cancelled', zh: '已取消', fr: 'Annulé' },
  share: { en: 'Share / export', zh: '分享 / 导出', fr: 'Partager / exporter' },
  ok: { en: 'OK', zh: '确定', fr: 'OK' },
  shareInputStep: {
    en: 'Shared files ({n})',
    zh: '分享进来的文件（{n} 个）',
    fr: 'Fichiers partagés ({n})',
  },
  shareGone: {
    en: 'These files are no longer here. Please share them again.',
    zh: '这些文件已经不在了，请重新分享。',
    fr: 'Ces fichiers ne sont plus disponibles. Veuillez les partager à nouveau.',
  },
  runError_tooFew: {
    en: 'Choose at least {min} files.',
    zh: '请至少选择 {min} 个文件。',
    fr: 'Choisissez au moins {min} fichiers.',
  },
  runError_tooMany: {
    en: 'Choose at most {max} files.',
    zh: '最多选择 {max} 个文件。',
    fr: 'Choisissez au maximum {max} fichiers.',
  },
  runError_wrongType: {
    en: '“{name}” is not a {kind} file.',
    zh: '「{name}」不是 {kind} 文件。',
    fr: 'Format incompatible pour « {name} ». Format attendu : {kind}.',
  },
  runError_invalidWorkflow: {
    en: 'This quick action has a step that doesn’t fit. Adjust its settings and try again.',
    zh: '这个快捷操作里有接不上的步骤，请先调整设置再试。',
    fr: 'Cette action rapide contient une étape incompatible. Ajustez ses réglages et réessayez.',
  },
  runError_cameraUnavailable: {
    en: 'The camera is not available on this device.',
    zh: '这台设备上不能使用相机。',
    fr: 'L’appareil photo n’est pas disponible sur cet appareil.',
  },
  runError_permissionDenied: {
    en: 'Morph needs permission for this ({what}). You can allow it in the system Settings.',
    zh: '需要权限才能继续（{what}），可以在系统「设置」里允许。',
    fr: 'Morph a besoin de l’autorisation pour cette action ({what}). Vous pouvez l’accorder dans les Réglages du système.',
  },
  runError_packFailed: {
    en: 'The download didn’t finish: {detail}',
    zh: '需要的内容没有下载好：{detail}',
    fr: 'Le téléchargement n’a pas abouti : {detail}',
  },
  runError_targetNotMet: {
    en: 'Couldn’t get “{name}” under {target} (the smallest was {got}).',
    zh: '「{name}」无法压到 {target} 以内（最小只能到 {got}）。',
    fr: 'Impossible de compresser « {name} » sous {target} (le minimum atteint est {got}).',
  },
  runError_unsupportedText: {
    en: 'This text can’t be written into the PDF yet: {name}',
    zh: '这段文字暂时不能写进 PDF：{name}',
    fr: 'Ce texte ne peut pas encore être inscrit dans le PDF : {name}',
  },
  runError_badRange: {
    en: 'Those pages don’t exist in “{name}”.',
    zh: '「{name}」里没有这些页。',
    fr: 'Ces pages n’existent pas dans « {name} ».',
  },
  runError_noFormFields: {
    en: '“{name}” has no form fields to fill.',
    zh: '「{name}」里没有可以填写的表单。',
    fr: '« {name} » ne contient aucun formulaire à remplir.',
  },
  runError_badField: {
    en: 'The value entered for “{name}” doesn’t fit this field.',
    zh: '「{name}」这一项填写的内容不符合要求。',
    fr: 'Les données saisies pour « {name} » ne conviennent pas à ce champ.',
  },
  runError_emptyText: {
    en: 'There is no text to use.',
    zh: '没有可以用的文字。',
    fr: 'Aucun texte à utiliser.',
  },
  runError_passwordMissing: {
    en: 'No password was entered.',
    zh: '没有填密码。',
    fr: 'Aucun mot de passe saisi.',
  },
  askPasswordMismatch: {
    en: 'The two passwords are different.',
    zh: '两次输入的密码不一样。',
    fr: 'Les deux mots de passe ne correspondent pas.',
  },
  askPasswordAgain: { en: 'Password again', zh: '再输一次', fr: 'Confirmer le mot de passe' },
  runError_textTooLong: {
    en: 'The text is too long (at most {max} characters).',
    zh: '文字太长了（最多 {max} 个字）。',
    fr: 'Le texte est trop long (maximum {max} caractères).',
  },
  runError_noRecords: {
    en: 'There are no entries in “{name}” for this period.',
    zh: '「{name}」里这段时间没有记录。',
    fr: 'Aucune entrée dans « {name} » pour cette période.',
  },
  runError_doesNotFit: {
    en: '“{name}” does not fit on this paper. Cut it to an ID photo size first.',
    zh: '「{name}」放不进这张相纸。请先用「证件照」步骤裁成规格尺寸。',
    fr: '« {name} » ne rentre pas sur ce papier. Utilisez d’abord l’étape « Photo d’identité » pour le recadrer au format.',
  },
  runError_notFound: {
    en: 'Nothing was found in “{name}”.',
    zh: '在「{name}」里没有找到内容。',
    fr: 'Rien trouvé dans « {name} ».',
  },
  runError_tooLarge: {
    en: '“{name}” is larger than {mb} MB, which is not supported yet.',
    zh: '「{name}」超过 {mb} MB，暂不支持。',
    fr: '« {name} » dépasse {mb} Mo, ce qui n’est pas encore pris en charge.',
  },
  runError_tooLargeTotal: {
    en: 'The selected files add up to more than {mb} MB.',
    zh: '所选文件合计超过 {mb} MB。',
    fr: 'Les fichiers sélectionnés dépassent {mb} Mo au total.',
  },
  runError_unreadable: {
    en: '“{name}” could not be read. It may be damaged.',
    zh: '无法读取「{name}」，文件可能已损坏。',
    fr: 'Impossible de lire « {name} ». Le fichier est peut-être endommagé.',
  },
  runError_encrypted: {
    en: '“{name}” has a password. Add the step “Remove PDF password” before this one.',
    zh: '「{name}」有密码。可以在前面加一步「去掉 PDF 密码」。',
    fr: '« {name} » est protégé par un mot de passe. Ajoutez d’abord l’étape « Supprimer le mot de passe PDF ».',
  },
  runError_pdfRestricted: {
    en: '“{name}” opens without a password, but its author limited changes to it. Morph doesn’t remove such limits.',
    zh: '「{name}」不用密码就能打开，但作者限制了修改。Morph 不解除这种限制。',
    fr: '« {name} » s’ouvre sans mot de passe, mais son auteur a restreint les modifications. Morph ne lève pas ces restrictions.',
  },
  runError_pdfPasswordUnsupported: {
    en: 'This phone can’t remove or add PDF passwords yet (iPhone only for now).',
    zh: '这台手机暂时不能去掉或加上 PDF 密码（目前只有 iPhone 能用）。',
    fr: 'Ce téléphone ne peut pas encore supprimer ni ajouter de mot de passe PDF (iPhone uniquement pour l’instant).',
  },
  runError_accessDenied: {
    en: '“{name}” could not be accessed. Check permissions and try again.',
    zh: '无法访问「{name}」，请检查权限后重试。',
    fr: 'Impossible d’accéder à « {name} ». Vérifiez les autorisations et réessayez.',
  },
  runError_saveFailed: {
    en: 'Saving failed: {detail}',
    zh: '保存失败：{detail}',
    fr: 'Échec de l’enregistrement : {detail}',
  },
  runError_folderNotWritable: {
    en: 'Files can’t be saved into this folder. Choose another folder and try again.',
    zh: '不能存进这个文件夹，请换一个文件夹再试。',
    fr: 'Impossible d’enregistrer les fichiers dans ce dossier. Choisissez un autre dossier et réessayez.',
  },
  runError_noViewer: {
    en: 'No app on this phone can open this file.',
    zh: '这台手机上没有能打开这个文件的 App。',
    fr: 'Aucune app de ce téléphone ne peut ouvrir ce fichier.',
  },
  runError_unsupportedAction: {
    en: 'This step is not supported: {action}',
    zh: '不支持这个步骤：{action}',
    fr: 'Étape non prise en charge : {action}',
  },
  runError_unexpected: {
    en: 'Something went wrong: {detail}',
    zh: '出现错误：{detail}',
    fr: 'Une erreur s’est produite : {detail}',
  },

  updateTool: { en: 'Update', zh: '更新', fr: 'Mettre à jour' },
  updateSummary: { en: 'Updated {name}', zh: '更新了{name}工具', fr: '{name} mis à jour' },

  // 运行页面
  runTitle: { en: 'Run', zh: '运行', fr: 'Exécuter' },
  runCancel: { en: 'Stop', zh: '停止', fr: 'Arrêter' },
  runProgress: { en: '{done} of {total}', zh: '{done}/{total}', fr: '{done} sur {total}' },
  runFailedAt: { en: 'Stopped at step {n}', zh: '在第 {n} 步停下', fr: 'Arrêté à l’étape {n}' },
  runSucceeded: { en: 'Done', zh: '完成', fr: 'Terminé' },
  runEdit: { en: 'Adjust settings', zh: '调整设置', fr: 'Ajuster les réglages' },
  askTitle: { en: 'Before this step', zh: '这一步之前', fr: 'Avant cette étape' },
  askName: { en: 'File name', zh: '文件名', fr: 'Nom du fichier' },
  askInvalid: {
    en: 'Please check: {detail}',
    zh: '请检查：{detail}',
    fr: 'Veuillez vérifier : {detail}',
  },
  resultSave: { en: 'Save to files', zh: '存到文件', fr: 'Enregistrer dans Fichiers' },
  resultSaved: { en: 'Saved', zh: '已保存', fr: 'Enregistré' },
  resultShare: { en: 'Share', zh: '分享', fr: 'Partager' },
  resultPhotos: { en: 'Save to Photos', zh: '存到相册', fr: 'Enregistrer dans Photos' },
  resultPhotosDone: { en: 'Saved to Photos', zh: '已存到相册', fr: 'Enregistré dans Photos' },
  resultPrint: { en: 'Print', zh: '打印', fr: 'Imprimer' },
  resultFolder: { en: 'Save to a folder', zh: '存到文件夹', fr: 'Enregistrer dans un dossier' },
  resultFolderNamed: {
    en: 'Save to “{name}”',
    zh: '存到「{name}」',
    fr: 'Enregistrer dans « {name} »',
  },
  resultFolderDone: {
    en: 'Saved to “{name}”',
    zh: '已存到「{name}」',
    fr: 'Enregistré dans « {name} »',
  },
  resultFolderChange: { en: 'Other folder', zh: '换文件夹', fr: 'Autre dossier' },
  resultCopy: { en: 'Copy', zh: '复制', fr: 'Copier' },
  resultCopied: { en: 'Copied', zh: '已复制', fr: 'Copié' },
  resultTextNote: {
    en: 'This text stays on this device.',
    zh: '这段文字只留在这台设备上。',
    fr: 'Ce texte reste sur cet appareil.',
  },
  resultPages: { en: '{n} pages', zh: '{n} 页', fr: '{n} pages' },
  resultCount: { en: '{n} files', zh: '{n} 个文件', fr: '{n} fichiers' },
  homeEntry: {
    en: 'Add a shortcut on the home page',
    zh: '在首页放一个入口',
    fr: 'Ajouter un raccourci sur la page d’accueil',
  },
  notesTitle: { en: 'Good to know', zh: '需要你知道', fr: 'Bon à savoir' },
  workflowWhere: {
    en: 'You will find it under Tools → Quick actions.',
    zh: '之后在「工具 → 快捷操作」里可以找到它。',
    fr: 'Vous le trouverez ensuite dans Outils → Actions rapides.',
  },
  resultSmaller: {
    en: 'Was {from}, now {to}',
    zh: '原来 {from}，现在 {to}',
    fr: 'Était {from}, désormais {to}',
  },
  resultRecords: { en: '{n} entries', zh: '{n} 条记录', fr: '{n} entrées' },
  localDone: { en: 'Done', zh: '完成', fr: 'Terminé' },
  localNext: { en: 'Next', zh: '下一张', fr: 'Suivant' },
  toolMissing: {
    en: 'This tool is not available.',
    zh: '这个工具不可用。',
    fr: 'Cet outil n’est pas disponible.',
  },
  workflowsTitle: { en: 'Quick actions', zh: '快捷操作', fr: 'Actions rapides' },
  workflowsRowHint: {
    en: 'Ready-made and your own multi-step actions',
    zh: '现成的和你自己的多步操作',
    fr: 'Actions prêtes à l’emploi et vos propres actions en plusieurs étapes',
  },
  packsTitle: { en: 'Downloads', zh: '已下载内容', fr: 'Téléchargements' },
  packsRowHint: {
    en: 'What was downloaded and the space it uses',
    zh: '下载过的内容和占用空间',
    fr: 'Contenu téléchargé et espace utilisé',
  },
  packsHint: {
    en: 'Some features (straightening photos, text recognition in more languages, PDF preview) download what they need the first time you use them. They work offline afterwards.',
    zh: '有些功能（拉正照片、更多语言的文字识别、PDF 预览）第一次用时要下载一些内容，之后不联网也能用。',
    fr: 'Certaines fonctions (redressement des photos, reconnaissance de texte dans d’autres langues, aperçu PDF) téléchargent ce dont elles ont besoin lors de la première utilisation. Elles fonctionnent ensuite hors connexion.',
  },
  packsEmpty: {
    en: 'Nothing downloaded yet.',
    zh: '还没有下载过内容。',
    fr: 'Aucun téléchargement pour l’instant.',
  },
  packsTotal: { en: 'Using {size}', zh: '共占用 {size}', fr: 'Occupe {size}' },
  packDelete: { en: 'Delete', zh: '删除', fr: 'Supprimer' },
  packDeleteTitle: { en: 'Delete “{name}”?', zh: '删除「{name}」？', fr: 'Supprimer « {name} » ?' },
  packDeleteMessage: {
    en: 'You can download it again the next time a tool needs it.',
    zh: '下次用到时可以再下载。',
    fr: 'Vous pourrez le télécharger à nouveau la prochaine fois qu’un outil en aura besoin.',
  },
  packDeleteWithLanguages: {
    en: 'Its {count} languages are deleted too. You can download them again the next time you need them.',
    zh: '它的 {count} 种语言也会一起删除。下次用到时可以再下载。',
    fr: 'Ses {count} langues seront aussi supprimées. Vous pourrez les télécharger à nouveau la prochaine fois que vous en aurez besoin.',
  },

  // 图片与链接
  imagePlaceholder: {
    en: 'Tap to choose a photo',
    zh: '点按选择一张照片',
    fr: 'Touchez pour choisir une photo',
  },
  imageTitle: { en: 'Picture', zh: '图片', fr: 'Image' },
  imageMissing: {
    en: 'This picture is not on this device. Tap to choose another.',
    zh: '这张图片不在这台设备上，点按换一张。',
    fr: 'Cette image n’est pas sur cet appareil. Touchez pour en choisir une autre.',
  },
  chooseImage: { en: 'Choose another photo', zh: '更换照片', fr: 'Choisir une autre photo' },
  removeImage: { en: 'Remove photo', zh: '移除照片', fr: 'Retirer la photo' },
  setImageSummary: { en: 'Set a picture', zh: '设置图片', fr: 'Définir une image' },
  removeImageSummary: { en: 'Remove a picture', zh: '移除图片', fr: 'Retirer une image' },
  imageTooLarge: {
    en: 'This photo is larger than {mb} MB.',
    zh: '这张照片超过 {mb} MB。',
    fr: 'Cette photo dépasse {mb} Mo.',
  },
  openLinkTitle: { en: 'Open link?', zh: '打开链接？', fr: 'Ouvrir le lien ?' },
  openLinkMessage: {
    en: 'This opens {target} outside the app.',
    zh: '将在 App 外打开 {target}。',
    fr: 'Cela ouvrira {target} en dehors de l’application.',
  },
  openLink: { en: 'Open', zh: '打开', fr: 'Ouvrir' },

  // 用户数据
  noRecords: {
    en: 'Nothing here yet',
    zh: '还没有记录',
    fr: 'Aucune entrée pour l’instant',
  },
  today: { en: 'Today', zh: '今天', fr: 'Aujourd’hui' },
  yesterday: { en: 'Yesterday', zh: '昨天', fr: 'Hier' },
  fieldRequired: { en: 'Required', zh: '必填', fr: 'Obligatoire' },
  fieldInvalid: { en: 'Not a valid value', zh: '格式不对', fr: 'Format incorrect' },
  fieldTooLong: { en: 'Too long', zh: '太长了', fr: 'Trop long' },
  tableFull: {
    en: 'This table is full (10,000 entries).',
    zh: '这张表已满（1 万条）。',
    fr: 'Ce tableau est plein (10 000 entrées).',
  },
  useFullForm: {
    en: 'Some required fields aren’t in this form. Open the full form to add.',
    zh: '有必填项不在这个表单里，请用完整表单添加。',
    fr: 'Certains champs obligatoires ne figurent pas dans ce formulaire. Ouvrez le formulaire complet pour les ajouter.',
  },
  recordDeleted: { en: 'Entry deleted', zh: '已删除一条记录', fr: 'Enregistrement supprimé' },
  newRecord: { en: 'New entry', zh: '新记录', fr: 'Nouvelle entrée' },
  editRecord: { en: 'Edit entry', zh: '编辑记录', fr: 'Modifier l’entrée' },
  save: { en: 'Save', zh: '保存', fr: 'Enregistrer' },
  delete: { en: 'Delete', zh: '删除', fr: 'Supprimer' },
  tableMissing: {
    en: 'This data table is no longer part of the app. Its entries are kept in Settings → Data.',
    zh: '这张数据表已不在界面里，记录保存在「设置 → 数据」。',
    fr: 'Ce tableau de données ne fait plus partie de l’application. Ses entrées sont conservées dans Paramètres → Données.',
  },
  dataTitle: { en: 'Data', zh: '数据', fr: 'Données' },
  dataRowHint: {
    en: 'Your entries: export, recently deleted',
    zh: '你记录的数据：导出、最近删除',
    fr: 'Vos données : exporter, supprimées récemment',
  },
  dataPrivacy: {
    en: 'Entries are stored only on this phone. The AI only sees the structure of your tables (names and fields), never what you enter.',
    zh: '记录只保存在这台手机上。AI 只能看到数据表的结构（表名和字段），永远看不到你填写的内容。',
    fr: 'Les entrées sont stockées uniquement sur ce téléphone. L’IA ne voit que la structure de vos tableaux (noms et champs), jamais ce que vous saisissez.',
  },
  dataTables: { en: 'Data tables', zh: '数据表', fr: 'Tableaux de données' },
  unusedTables: {
    en: 'Not in the app',
    zh: '不在界面里的数据',
    fr: 'Données hors de l’application',
  },
  unusedTablesHint: {
    en: 'Tables that were removed from the app. Their entries come back if you go back to a time when the table was there.',
    zh: '已从界面移除的数据表。在改动记录里回到有这张表的时候，记录会回来。',
    fr: 'Tableaux retirés de l’application. Leurs entrées reviennent si vous revenez, dans l’historique des modifications, à une époque où ce tableau existait.',
  },
  recentlyDeleted: { en: 'Recently deleted', zh: '最近删除', fr: 'Supprimés récemment' },
  recentlyDeletedHint: {
    en: 'Kept for 30 days, then removed for good.',
    zh: '保留 30 天，之后永久删除。',
    fr: 'Conservé pendant 30 jours, puis supprimé définitivement.',
  },
  recordCount: { en: '{count} entries', zh: '{count} 条记录', fr: '{count} entrées' },
  exportCsv: { en: 'Export CSV', zh: '导出 CSV', fr: 'Exporter en CSV' },
  deleteForever: { en: 'Delete forever', zh: '永久删除', fr: 'Supprimer définitivement' },
  deleteForeverConfirm: {
    en: 'Delete all {count} entries of “{name}”? This can’t be undone.',
    zh: '永久删除「{name}」的全部 {count} 条记录？此操作无法撤销。',
    fr: 'Supprimer toutes les {count} entrées de « {name} » ? Cette action est irréversible.',
  },
  restore: { en: 'Restore', zh: '恢复', fr: 'Restaurer' },
  nothingDeleted: {
    en: 'Nothing deleted recently',
    zh: '最近没有删除的记录',
    fr: 'Aucune suppression récente',
  },
  unknownTable: { en: 'Table {id}', zh: '数据表 {id}', fr: 'Tableau {id}' },
  pageMissing: {
    en: 'This page no longer exists.',
    zh: '这个页面已不存在。',
    fr: 'Cette page n’existe plus.',
  },

  // 直接编辑（长按一块、调整顺序）
  editText: { en: 'Edit text', zh: '改文字', fr: 'Modifier le texte' },
  editColor: { en: 'Color', zh: '颜色', fr: 'Couleur' },
  editAlign: { en: 'Alignment', zh: '对齐', fr: 'Alignement' },
  editSize: { en: 'Size', zh: '大小', fr: 'Taille' },
  tone_default: { en: 'Default', zh: '默认', fr: 'Par défaut' },
  tone_primary: { en: 'Primary', zh: '主色', fr: 'Principale' },
  tone_secondary: { en: 'Secondary', zh: '辅助色', fr: 'Secondaire' },
  tone_tertiary: { en: 'Tertiary', zh: '第三色', fr: 'Tertiaire' },
  tone_muted: { en: 'Muted', zh: '灰色', fr: 'Grise' },
  align_start: { en: 'Left', zh: '靠左', fr: 'À gauche' },
  align_center: { en: 'Center', zh: '居中', fr: 'Centré' },
  size_small: { en: 'Small', zh: '小', fr: 'Petit' },
  size_medium: { en: 'Medium', zh: '中', fr: 'Moyen' },
  size_large: { en: 'Large', zh: '大', fr: 'Grand' },
  moveUp: { en: 'Move up', zh: '上移', fr: 'Monter' },
  moveDown: { en: 'Move down', zh: '下移', fr: 'Descendre' },
  arrange: { en: 'Reorder', zh: '调整顺序', fr: 'Réorganiser' },
  hide: { en: 'Hide', zh: '隐藏', fr: 'Masquer' },
  show: { en: 'Show', zh: '显示', fr: 'Afficher' },
  hiddenTag: { en: 'Hidden', zh: '已隐藏', fr: 'Masqué' },
  done: { en: 'Done', zh: '完成', fr: 'Terminé' },
  edit: { en: 'Edit', zh: '编辑', fr: 'Modifier' },
  editPage: { en: 'Edit page', zh: '编辑页面', fr: 'Modifier la page' },
  editHint: {
    en: 'Tap a block to change it, hold ≡ to move it, tap Done when finished.',
    zh: '点一块就能改，按住 ≡ 拖动换位置，改好点「完成」。',
    fr: 'Touchez un bloc pour le modifier, maintenez ≡ pour le déplacer, touchez « Terminé » une fois fini.',
  },
  discardEditTitle: {
    en: 'Discard your changes?',
    zh: '放弃这次的修改？',
    fr: 'Abandonner vos modifications ?',
  },
  discardEditMessage: {
    en: 'None of the changes made in edit mode will be kept.',
    zh: '这次编辑里的修改都不会保存。',
    fr: 'Les modifications faites en mode édition ne seront pas conservées.',
  },
  keepEditing: { en: 'Keep editing', zh: '继续编辑', fr: 'Continuer la modification' },
  discard: { en: 'Discard', zh: '放弃', fr: 'Abandonner' },
  tooManyEdits: {
    en: 'That’s a lot of changes at once. Tap Done to save them, then keep editing.',
    zh: '这次改动太多了。请先点「完成」保存，再继续编辑。',
    fr: 'Il y a trop de modifications à la fois. Touchez « Terminé » pour les enregistrer, puis continuez la modification.',
  },
  editPageSummary: {
    en: 'Edit “{page}” ({count} changes)',
    zh: '编辑「{page}」（{count} 处修改）',
    fr: 'Modifier « {page} » ({count} modifications)',
  },
  groupLabel: { en: 'Group', zh: '分组', fr: 'Groupe' },
  field_title: { en: 'Title', zh: '标题', fr: 'Titre' },
  field_subtitle: { en: 'Subtitle', zh: '副标题', fr: 'Sous-titre' },
  field_text: { en: 'Text', zh: '文字', fr: 'Texte' },
  field_label: { en: 'Button text', zh: '按钮文字', fr: 'Texte du bouton' },
  field_caption: { en: 'Caption', zh: '说明', fr: 'Légende' },
  field_placeholder: {
    en: 'Hint before a photo is chosen',
    zh: '未选照片时的提示',
    fr: 'Indication avant le choix d’une photo',
  },
  optional: { en: 'optional', zh: '可不填', fr: 'facultatif' },
  richTextHint: {
    en: '**bold**, *italic*, [link](https://…), lines starting with - become a list',
    zh: '**粗体**、*斜体*、[链接](https://…)；以 - 开头的行是列表',
    fr: '**gras**, *italique*, [lien](https://…), les lignes commençant par - deviennent une liste',
  },
  textRequired: { en: 'This can’t be empty', zh: '不能为空', fr: 'Ne peut pas être vide' },
  deleteComponentTitle: { en: 'Delete {label}?', zh: '删除{label}？', fr: 'Supprimer {label} ?' },
  deleteComponentMessage: {
    en: 'Cancel discards the whole edit; after saving you can still undo it.',
    zh: '点「取消」可以放弃这次编辑，保存后也能撤销。',
    fr: '« Annuler » abandonne toute la modification ; après enregistrement, vous pourrez encore l’annuler.',
  },
  deleteGroupMessage: {
    en: 'The {count} parts inside it are deleted too. Cancel discards the whole edit; after saving you can still undo it.',
    zh: '里面的 {count} 块也会一起删除。点「取消」可以放弃这次编辑，保存后也能撤销。',
    fr: 'Les {count} éléments qu’il contient seront aussi supprimés. « Annuler » abandonne toute la modification ; après enregistrement, vous pourrez encore l’annuler.',
  },
  deleteDataMessage: {
    en: 'Your entries are kept (Settings → Data). Cancel discards the whole edit; after saving you can still undo it.',
    zh: '记录不会被删除（在「设置 → 数据」里）。点「取消」可以放弃这次编辑，保存后也能撤销。',
    fr: 'Vos entrées sont conservées (Paramètres → Données). « Annuler » abandonne toute la modification ; après enregistrement, vous pourrez encore l’annuler.',
  },
  // AI 只改 App（D-113、D-124–D-130）
  readyTitle: {
    en: 'Your quick action is ready',
    zh: '快捷操作做好了',
    fr: 'Votre action rapide est prête',
  },
  readyRunNow: { en: 'Use it now', zh: '现在就用一次', fr: 'L’utiliser maintenant' },
  readyLater: { en: 'Not now', zh: '先不用', fr: 'Pas maintenant' },
  readyHome: {
    en: 'It’s also on the home page — tap it next time.',
    zh: '首页上也放了入口，下次点一下就能用。',
    fr: 'Un raccourci est aussi disponible sur l’accueil : appuyez dessus la prochaine fois.',
  },
  askAIChange: {
    en: 'Ask AI to change it',
    zh: '让 AI 改这个',
    fr: 'Demander à l’IA de la modifier',
  },
  readyFix: {
    en: 'Not quite right? Ask AI to change it',
    zh: '不太对？让 AI 改这个',
    fr: 'Pas tout à fait ? Demander à l’IA de la modifier',
  },
  aboutWorkflow: {
    en: 'Changing “{name}”',
    zh: '要改的快捷操作：「{name}」',
    fr: 'Action rapide à modifier : « {name} »',
  },
  aboutWorkflowHint: {
    en: 'Say how it should change, or try one of the examples below.',
    zh: '说说想怎么改它，也可以先试试下面的例子。',
    fr: 'Dites comment la modifier, ou essayez l’un des exemples ci-dessous.',
  },
  aboutPlaceholder: {
    en: 'For example: {example}',
    zh: '例如：{example}',
    fr: 'Par exemple : {example}',
  },
  aboutShared: {
    en: 'For the {what} you shared',
    zh: '给分享进来的 {what}',
    fr: 'Fichiers partagés : {what}',
  },
  sharedPhotos: { en: '{n} photos', zh: '{n} 张照片', fr: '{n} photos' },
  sharedPdfs: { en: '{n} PDFs', zh: '{n} 个 PDF', fr: '{n} PDF' },
  sharedOthers: { en: '{n} files', zh: '{n} 个文件', fr: '{n} fichiers' },
  habitTitle: {
    en: 'Often choose {value}?',
    zh: '经常用「{value}」？',
    fr: 'Souvent utiliser « {value} » ?',
  },
  habitBody: {
    en: 'Save it as a quick action “{name}” on the home page — next time it’s one tap, no questions.',
    zh: '做成快捷操作「{name}」放到首页，下次点一下就好，不用再选。',
    fr: 'Créer une action rapide « {name} » sur l’accueil : un seul appui la prochaine fois, sans rien demander.',
  },
  habitMake: { en: 'Make it', zh: '做一个', fr: 'Créer' },
  habitNo: { en: 'No thanks', zh: '不用了', fr: 'Non merci' },
  habitMade: {
    en: 'Added “{name}” to the home page',
    zh: '已把「{name}」放到首页',
    fr: '« {name} » ajouté à l’accueil',
  },

  // ---- 翻译（D-170–D-176）：错误说明拼进「不支持这个步骤：…」/「需要的内容没有下载好：…」 ----
  translateNeedsFullApp: {
    en: 'Translate (it works in the full Morph app, not in this preview)',
    zh: '翻译（要在正式版 Morph 里用，这个预览版里没有本机翻译）',
    fr: 'Traduire (disponible dans la version complète de Morph, pas dans cet aperçu)',
  },
  translateOsTooOld: {
    en: 'Translate (needs iOS 18 or later)',
    zh: '翻译（需要 iOS 18 或更新的系统）',
    fr: 'Traduire (nécessite iOS 18 ou une version ultérieure)',
  },
  translatePairUnsupported: {
    en: 'translating {from} into {to} (this phone can’t do it)',
    zh: '把{from}翻成{to}（这台手机不支持）',
    fr: 'Traduction de {from} vers {to} impossible sur ce téléphone',
  },
  translateDownloadAsk: {
    en: 'First use needs a download of about {mb} MB',
    zh: '首次使用需下载约 {mb} MB',
    fr: 'Le premier usage nécessite le téléchargement d’environ {mb} Mo',
  },
  translateDownloadBody: {
    en: 'Translation languages: {langs}. After that it works offline. Wi-Fi is recommended.',
    zh: '翻译语言：{langs}。之后不联网也能用，建议连接 Wi-Fi。',
    fr: 'Langues de traduction : {langs}. Ensuite, la traduction fonctionne hors connexion. Le Wi-Fi est conseillé.',
  },
  translateDownload: { en: 'Download', zh: '下载', fr: 'Télécharger' },
  translateDownloadFailed: {
    en: 'the {langs} language files (check the connection and try again)',
    zh: '{langs}的翻译语言（请检查网络后再试）',
    fr: 'les fichiers de langue {langs} (vérifiez la connexion, puis réessayez)',
  },
  translateLanguageTitle: {
    en: 'Translation: {name}',
    zh: '翻译语言：{name}',
    fr: 'Langue de traduction : {name}',
  },
  translateLanguageHint: {
    en: 'About 30 MB, for translating on this device (Google ML Kit).',
    zh: '约 30 MB，用来在本机翻译（Google ML Kit）。',
    fr: 'Environ 30 Mo, pour traduire sur cet appareil (Google ML Kit).',
  },
  translateDeleteMessage: {
    en: 'You will be asked to download it again the next time you translate this language.',
    zh: '下次翻译这种语言时会再问你是否下载。',
    fr: 'Il vous sera à nouveau proposé de le télécharger la prochaine fois que vous traduirez cette langue.',
  },
  translateNote: {
    en: 'Translated on this device — good for understanding the meaning. For official documents, use a professional translator.',
    zh: '本机翻译，适合看懂意思；正式文件请找专业翻译。',
    fr: 'Traduit sur l’appareil : utile pour comprendre le sens. Pour les documents officiels, faites appel à un traducteur professionnel.',
  },
  // ---- 视频、音频和压缩 PDF（D-140–D-148）。音频工具的文字请另起一块，方便合并。----
  runPercent: { en: '{done}%', zh: '{done}%', fr: '{done}%' },
  runError_needsFullApp: {
    en: 'Videos and audio can only be processed in the full Morph app, not in this preview.',
    zh: '视频和音频要在正式版 Morph 里处理，这个预览版里不行。',
    fr: 'Les vidéos et les fichiers audio ne peuvent être traités que dans la version complète de Morph, pas dans cet aperçu.',
  },
  subtitlesNeedApp: {
    en: 'Exporting timed captions needs an updated Morph app.',
    zh: '导出带时间的字幕需要更新后的 Morph App。',
    fr: 'L’export des sous-titres avec horodatage nécessite une version à jour de l’application Morph.',
  },
  subtitlesNote: {
    en: 'These are separate SRT files. Open them with the original video in a compatible player or editor. Review the words and timing; captions have not been burned into the picture.',
    zh: '这是单独的 SRT 文件，需要在支持的播放器或编辑器中与原视频一起打开。请核对文字和时间；字幕没有烧录进画面。',
    fr: 'Ce sont des fichiers SRT séparés. Ouvrez-les avec la vidéo d’origine dans un lecteur ou un éditeur compatible. Vérifiez le texte et la synchronisation ; les sous-titres ne sont pas intégrés à l’image.',
  },
  annotateTitle: { en: 'Mark up photo', zh: '标注图片', fr: 'Annoter la photo' },
  annotateText: { en: 'Text', zh: '文字', fr: 'Texte' },
  annotateArrow: { en: 'Arrow', zh: '箭头', fr: 'Flèche' },
  annotateBox: { en: 'Box', zh: '方框', fr: 'Cadre' },
  annotatePen: { en: 'Pen', zh: '画笔', fr: 'Stylo' },
  annotateColor: { en: 'Color {n}', zh: '颜色 {n}', fr: 'Couleur {n}' },
  annotateTextHint: {
    en: 'Type a short label',
    zh: '输入简短文字',
    fr: 'Saisissez un court libellé',
  },
  annotateTap: {
    en: 'Type a label, then tap the photo to place it. Undo to replace a mark.',
    zh: '先输入文字，再点图片放置。放错可撤销后重画。',
    fr: 'Saisissez un libellé, puis appuyez sur la photo pour le placer. Annulez pour remplacer une marque.',
  },
  annotateDrag: {
    en: 'Drag on the photo to draw. Undo to replace a mark.',
    zh: '在图片上拖动画。画错可撤销后重画。',
    fr: 'Faites glisser sur la photo pour dessiner. Annulez pour remplacer une marque.',
  },
  annotateCount: { en: '{n}/100 marks', zh: '{n}/100 处', fr: '{n}/100 marques' },
  annotateUndo: { en: 'Undo', zh: '撤销一个', fr: 'Annuler une' },
  imageAdjustmentNeedsApp: {
    en: 'Photo adjustment needs an updated Morph app.',
    zh: '图片调整需要更新后的 Morph App。',
    fr: 'La retouche de photo nécessite une version à jour de l’application Morph.',
  },
  backgroundNeedsSystem: {
    en: 'Background removal needs iOS 17 or later, or Android with Google Play services.',
    zh: '去背景需要 iOS 17 或更新版本，或带 Google Play 服务的 Android。',
    fr: 'Supprimer l’arrière-plan nécessite iOS 17 ou une version ultérieure, ou Android avec les services Google Play.',
  },
  backgroundDownload: { en: 'Download', zh: '下载', fr: 'Télécharger' },
  backgroundDownloadAsk: {
    en: 'Download background removal?',
    zh: '下载去背景功能？',
    fr: 'Télécharger la suppression de l’arrière-plan ?',
  },
  backgroundDownloadBody: {
    en: 'Google Play services needs to download a model first. Photos stay on this device. After downloading, processing works offline.',
    zh: 'Google Play 服务需要先下载模型。照片留在本机，下载后可以离线处理。',
    fr: 'Les services Google Play doivent d’abord télécharger un modèle. Les photos restent sur cet appareil. Après le téléchargement, le traitement fonctionne hors connexion.',
  },
  backgroundDownloadFailed: {
    en: 'The background removal model could not be downloaded. Check your connection and Google Play services, then try again.',
    zh: '去背景模型没下载成功。请检查网络和 Google Play 服务后重试。',
    fr: 'Le modèle de suppression de l’arrière-plan n’a pas pu être téléchargé. Vérifiez votre connexion et les services Google Play, puis réessayez.',
  },
  runError_backgroundFailed: {
    en: 'Could not remove the background from “{name}”. Try a clear photo with a distinct subject.',
    zh: '「{name}」没能去掉背景，请试一张主体清晰、和背景有区别的照片。',
    fr: 'Impossible de supprimer l’arrière-plan de « {name} ». Essayez une photo nette avec un sujet bien distinct.',
  },
  runError_mediaUnsupported: {
    en: '“{name}” can’t be opened: the format isn’t supported, or it is copy-protected.',
    zh: '「{name}」打不开：格式不支持，或者有版权保护。',
    fr: '« {name} » ne peut pas être ouvert : format non pris en charge ou protégé contre la copie.',
  },
  runError_mergeUnsupported: {
    en: 'These videos couldn’t be joined. Convert each one to MP4 first, then try again.',
    zh: '这几段视频没能拼在一起。可以先把每一段转成 MP4 再试。',
    fr: 'Impossible d’assembler ces vidéos. Convertissez d’abord chacune en MP4, puis réessayez.',
  },
  runError_notEnoughSpace: {
    en: 'There isn’t enough space on this phone. About {gb} GB more is needed.',
    zh: '手机空间不够，还需要大约 {gb} GB。',
    fr: 'Espace insuffisant sur ce téléphone. Il faut environ {gb} Go en plus.',
  },
  runError_targetTooSmall: {
    en: 'At {target}, “{name}” would be too blurry to watch. It needs at least {mb} MB, or trim it shorter first.',
    zh: '「{name}」压到 {target} 画面会看不清。至少要 {mb} MB，或者先剪短一点。',
    fr: 'À {target}, « {name} » serait trop flou pour être regardé. Il faut au moins {mb} Mo, ou le couper plus court d’abord.',
  },
  runError_interrupted: {
    en: 'Morph went to the background, so this didn’t finish. Stay in Morph and tap “Run again”.',
    zh: '处理时切到了别的 App，没有完成。请留在 Morph 里，再点「再来一次」。',
    fr: 'Morph est passé en arrière-plan, le traitement n’a donc pas abouti. Restez dans Morph et appuyez sur « Relancer ».',
  },
  // 长任务切到后台也继续（D-160–D-162）：运行页的提示，Android 通知栏的进度和完成通知。
  runCanLeave: {
    en: 'You can switch to another app; Morph keeps working in the background.',
    zh: '可以切到别的 App，Morph 会在后台接着处理。',
    fr: 'Vous pouvez passer à une autre application ; Morph continue de travailler en arrière-plan.',
  },
  runStayInMorph: {
    en: 'Stay in Morph while this is being processed.',
    zh: '处理时请留在 Morph 里。',
    fr: 'Restez dans Morph pendant le traitement.',
  },
  bgPreparing: { en: 'Getting ready…', zh: '准备中…', fr: 'Préparation…' },
  bgStep: {
    en: 'Step {n} of {total}: {step}',
    zh: '第 {n}/{total} 步：{step}',
    fr: 'Étape {n} sur {total} : {step}',
  },
  bgDoneTitle: { en: '“{name}” is done', zh: '「{name}」处理完了', fr: '« {name} » est terminé' },
  bgDoneBody: {
    en: 'Tap to see the result.',
    zh: '点这里看结果。',
    fr: 'Appuyez ici pour voir le résultat.',
  },
  bgFailedTitle: {
    en: '“{name}” didn’t finish',
    zh: '「{name}」没有完成',
    fr: '« {name} » n’a pas abouti',
  },
  bgFailedBody: {
    en: 'Tap to see what happened.',
    zh: '点这里看看是怎么回事。',
    fr: 'Touchez pour voir ce qui s’est passé.',
  },
  mediaPlay: { en: 'Play', zh: '播放', fr: 'Lire' },
  mediaDuration: { en: '{duration}', zh: '{duration}', fr: '{duration}' },
  frameTitle: { en: 'Choose a frame', zh: '选一帧', fr: 'Choisissez une image' },
  frameDone: { en: 'Save this frame', zh: '就要这一帧', fr: 'Conserver cette image' },
  frameHint: {
    en: 'Tap the timeline, then fine-tune the time to pick the frame.',
    zh: '点时间轴选画面，再微调时间。',
    fr: 'Touchez la ligne de temps, puis ajustez l’heure pour choisir une image.',
  },
  trimTitle: { en: 'Trim', zh: '剪一段', fr: 'Couper' },
  trimOf: { en: '{n} of {total}', zh: '第 {n}/{total} 个', fr: '{n} sur {total}' },
  trimHint: {
    en: 'Drag the two handles to choose the part to keep.',
    zh: '拖动两边的把手，选出要留下的一段。',
    fr: 'Faites glisser les deux poignées pour choisir la partie à conserver.',
  },
  trimStart: { en: 'Start', zh: '开始', fr: 'Démarrer' },
  trimEnd: { en: 'End', zh: '结束', fr: 'Fin' },
  trimLength: { en: '{length} kept', zh: '留下 {length}', fr: '{length} conservé' },
  trimPlaySelection: { en: 'Play this part', zh: '只播放这一段', fr: 'Lire ce passage seulement' },
  trimPause: { en: 'Pause', zh: '暂停', fr: 'Pause' },
  trimDone: { en: 'Done', zh: '完成', fr: 'Terminé' },
  trimNext: { en: 'Next', zh: '下一个', fr: 'Suivant' },
  sharedVideos: { en: '{n} videos', zh: '{n} 个视频', fr: '{n} vidéos' },
  sharedAudio: { en: '{n} audio files', zh: '{n} 个音频', fr: '{n} fichiers audio' },

  // AI 修改的草稿（D-190）
  draftDropped: {
    en: 'The app changed since you left the draft; {n} steps no longer fit and were removed.',
    zh: '离开草稿之后 App 又改过，有 {n} 步套不上了，已经去掉。',
    fr: 'L’app a changé depuis que vous avez quitté le brouillon ; {n} étapes ne correspondent plus et ont été supprimées.',
  },
  draftFirstStep: {
    en: 'This is the first step of the draft. To drop the whole draft, delete it on the Change this app page.',
    zh: '这已经是草稿的第一步了。要整个丢掉，去「修改这个 App」删除草稿。',
    fr: 'C’est la première étape du brouillon. Pour le supprimer entièrement, effacez-le depuis la page « Modifier cette app ».',
  },
  draftEdit: { en: 'Change', zh: '修改', fr: 'Modifier' },
  draftBack: { en: 'Step back', zh: '退一步', fr: 'Revenir en arrière' },
  draftApply: { en: 'Apply', zh: '应用', fr: 'Appliquer' },
  draftLeave: { en: 'Leave', zh: '离开', fr: 'Quitter' },
  draftLocked: {
    en: 'This is a draft. Apply it to use this.',
    zh: '这是草稿，应用之后才能用。',
    fr: 'Ceci est un brouillon. Appliquez-le pour l’utiliser.',
  },
  draftReplyTitle: {
    en: 'Done. This is how it looks now',
    zh: '改好了，这是改完后的样子',
    fr: 'C’est fait, voici le nouveau rendu',
  },
  draftChatTitle: { en: 'Change the draft', zh: '修改草稿', fr: 'Modifier le brouillon' },
  draftChatClose: { en: 'Hide', zh: '收起', fr: 'Masquer' },
  draftChatPlaceholder: { en: 'Say one more thing…', zh: '再说一句…', fr: 'Dites-en un peu plus…' },
  draftSteppedBack: {
    en: 'Undid the last step.',
    zh: '退了一步。',
    fr: 'Retour d’une étape effectué.',
  },
  draftCard: {
    en: 'You have a draft · {n} steps',
    zh: '你有一份草稿 · {n} 步',
    fr: 'Vous avez un brouillon · {n} étapes',
  },
  draftCardHint: {
    en: 'Changes to the look continue this draft; changes to quick actions, tools and data tables apply right away.',
    zh: '新说的外观修改会接着改这份草稿；快捷操作、工具和数据表直接生效。',
    fr: 'Les modifications d’apparence que vous demandez poursuivent ce brouillon ; les actions rapides, les outils et les tableaux de données prennent effet immédiatement.',
  },
  draftContinue: { en: 'Continue', zh: '继续', fr: 'Continuer' },
  draftDelete: { en: 'Delete', zh: '删除', fr: 'Supprimer' },
  draftDeleteTitle: {
    en: 'Delete this draft?',
    zh: '删掉这份草稿？',
    fr: 'Supprimer ce brouillon ?',
  },
  draftDeleteBody: {
    en: 'All {n} steps of the draft are dropped. The app stays as it is.',
    zh: '草稿里的 {n} 步都会丢掉，App 不受影响。',
    fr: 'Les {n} étapes du brouillon seront abandonnées. L’App ne change pas.',
  },
  send: { en: 'Send', zh: '发送', fr: 'Envoyer' },
  changeAsk: {
    en: 'What should change? One sentence is enough',
    zh: '想怎么改？说一句就行',
    fr: 'Que faut-il changer ? Une phrase suffit',
  },
  pickStyleChip: { en: 'Pick a style', zh: '换个风格', fr: 'Choisir un style' },
  draftRenderFailed: {
    en: 'The last change couldn’t be shown, so it was undone.',
    zh: '刚才那一步显示不出来，已经撤掉。',
    fr: 'La dernière modification n’a pas pu s’afficher, elle a donc été annulée.',
  },

  // 功能和外观分开改（D-191）
  draftNoFunction: {
    en: 'The draft only changes the look. Quick actions, tools and data tables are changed on the Change this app page: they take effect right away and can be undone.',
    zh: '草稿里只改外观。快捷操作、工具和数据表要在「修改这个 App」里改：会直接生效，可以撤销。',
    fr: 'Le brouillon ne modifie que l’apparence. Les actions rapides, les outils et les tableaux de données se modifient sur la page « Modifier cette App » : les changements prennent effet immédiatement et peuvent être annulés.',
  },
  draftNoFunctionGo: {
    en: 'Say it on Change this app',
    zh: '去「修改这个 App」说',
    fr: 'Passer par « Modifier cette App »',
  },
  functionNeedsDraft: {
    en: 'This change needs something from your draft. Apply the draft first, then say it again.',
    zh: '这个修改要用到草稿里还没应用的改动。先应用草稿，再说一次。',
    fr: 'Cette modification nécessite un élément de votre brouillon. Appliquez d’abord le brouillon, puis redites-le.',
  },
  nextTitle: { en: 'Keep going', zh: '接着改', fr: 'Continuer à modifier' },
  nextHint: {
    en: 'The rest of what you asked changes the look: tap to see it in a draft first.',
    zh: '这句话里剩下的是外观的修改，点一下先在草稿里看看效果。',
    fr: 'Le reste de votre demande modifie l’apparence : touchez pour voir le résultat d’abord dans un brouillon.',
  },
  tableReadyTitle: {
    en: 'Your data table is ready',
    zh: '数据表做好了',
    fr: 'Votre tableau de données est prêt',
  },
  tableReadyRecord: { en: 'Add an entry now', zh: '现在就记一笔', fr: 'Ajouter une entrée' },
  tableReadyWhere: {
    en: 'Entries stay on this device. You can also see the table in Settings → Data.',
    zh: '记录存在本机，在「设置 → 数据」里也能看到这张表。',
    fr: 'Les entrées restent sur cet appareil. Vous pouvez aussi voir le tableau dans « Paramètres → Données ».',
  },

  // 新手引导（D-149）
  guideSkip: { en: 'Skip', zh: '跳过', fr: 'Passer' },
  guideNext: { en: 'Next', zh: '下一步', fr: 'Suivant' },
  guideStart: { en: 'Start', zh: '开始', fr: 'Démarrer' },
  // 划屏介绍：每页一张图配一句话。
  guideIntro1: {
    en: 'Your own app. Change how it looks with one sentence, any way you like.',
    zh: '属于你的 App，用一句话随心所欲地改变界面',
    fr: 'Votre propre application. Changez son apparence en une phrase, comme bon vous semble.',
  },
  guideIntro2: {
    en: 'Say one sentence and the whole app gets a new look.',
    zh: '说一句话，整个 App 换个样子',
    fr: 'Dites une seule phrase et toute l’application prend un nouveau look.',
  },
  guideIntro3: {
    en: 'Things that took several steps become one tap.',
    zh: '几步才能做完的事，变成点一下',
    fr: 'Ce qui demandait plusieurs étapes se fait d’un seul appui.',
  },
  guideIntro4: {
    en: 'Now it’s your turn. Say your idea in one sentence.',
    zh: '现在轮到你了，用一句话说出你的想法',
    fr: 'À vous de jouer. Décrivez votre idée en une phrase.',
  },
  guideIntroMiniTitle: { en: 'My day', zh: '我的一天', fr: 'Ma journée' },
  guideIntroStyleAsk: { en: 'Make it neon', zh: '换成赛博霓虹风', fr: 'Style néon' },
  guideIntroBefore: { en: 'Before', zh: '以前', fr: 'Avant' },
  guideIntroBeforeCount: {
    en: '5 steps · 2 apps',
    zh: '5 步 · 换 2 个 App',
    fr: '5 étapes · 2 applis',
  },
  guideIntroOld1: { en: 'Open Photos', zh: '打开相册', fr: 'Ouvrir Photos' },
  guideIntroOld2: { en: 'Pick photos', zh: '挑照片', fr: 'Choisir des photos' },
  guideIntroOld3: {
    en: 'Compress in another app',
    zh: '换个 App 压缩',
    fr: 'Compresser dans une autre app',
  },
  guideIntroOld4: { en: 'Rename', zh: '改名', fr: 'Renommer' },
  guideIntroOld5: { en: 'Share', zh: '分享', fr: 'Partager' },
  guideIntroNow: {
    en: 'Send trip photos to friends',
    zh: '发旅行照片给朋友',
    fr: 'Envoyer des photos de voyage à des amis',
  },
  guideIntroAsk: { en: 'I want…', zh: '我想要……', fr: 'Je veux…' },
  guideIntroIdea1: {
    en: 'Make the home page dark blue',
    zh: '首页换成深蓝色',
    fr: 'Mettre la page d’accueil en bleu foncé',
  },
  guideIntroIdea2: {
    en: 'Add a water check-in',
    zh: '加一个喝水打卡',
    fr: 'Ajouter un suivi de l’eau',
  },
  guideIntroIdea3: {
    en: 'Turn screenshots into a PDF',
    zh: '把截图整理成 PDF',
    fr: 'Transformer des captures d’écran en PDF',
  },
  guideLookTitle: {
    en: 'Step 1',
    zh: '第 1 步',
    fr: 'Étape 1',
  },
  guideLookBody: {
    en: 'The app is empty for now. Start by adding two buttons.',
    zh: 'App 目前空荡荡的，先加两个按钮吧。',
    fr: 'L’app est vide pour l’instant. Commencez par ajouter deux boutons.',
  },
  guideGoalTitle: {
    en: 'Step 2',
    zh: '第 2 步',
    fr: 'Étape 2',
  },
  guideGoalBody: {
    en: 'This app takes the hassle out of working with files. Open the pictures or files you need to work on.',
    zh: '这个 App 能简化繁琐的文件处理，打开你需要处理的图片或者文件。',
    fr: 'Cette app simplifie les tâches fastidieuses sur les fichiers. Ouvrez les images ou les fichiers à traiter.',
  },
  guideLater: { en: 'Later', zh: '以后再说', fr: 'Plus tard' },
  guideSkipAll: { en: 'Skip the guide', zh: '跳过引导', fr: 'Passer le guide' },
  settingsGuide: { en: 'Show the guide again', zh: '重新看新手引导', fr: 'Revoir le guide' },
  settingsGuideHint: {
    en: 'The intro and two short exercises',
    zh: '划屏介绍和两个小练习',
    fr: 'Présentation et deux petits exercices',
  },
  // ---- 音频工具（D-150–D-156，音频会话）----
  runError_audioTooSmall: {
    en: 'At {target}, “{name}” would be too hard to understand. It needs at least {mb} MB, or trim it shorter first.',
    zh: '「{name}」压到 {target} 声音会听不清。至少要 {mb} MB，或者先剪短一点。',
    fr: 'À {target}, la voix de « {name} » serait trop difficile à entendre. Il faut au moins {mb} Mo, ou la couper plus court d’abord.',
  },
  runError_noAudio: {
    en: '“{name}” has no sound.',
    zh: '「{name}」里没有声音。',
    fr: '« {name} » n’a pas de son.',
  },
  // ---- 格式转换的缺口（D-183–D-186）----
  runError_formatUnsupported: {
    en: '“{name}” is a {format} file, which this phone can’t open. Convert it to MP4 on a computer first.',
    zh: '「{name}」是 {format} 格式，这台手机打不开。可以先在电脑上转成 MP4。',
    fr: '« {name} » est un fichier {format} que ce téléphone ne peut pas ouvrir. Convertissez-le d’abord en MP4 sur un ordinateur.',
  },
  // ---- 需求回收（D-189）----
  needSend: {
    en: 'Tell us you need this',
    zh: '把这个需求告诉我们',
    fr: 'Dites-nous que vous en avez besoin',
  },
  needRetry: { en: 'Not sent. Try again', zh: '没发出去，再试一次', fr: 'Non envoyé. Réessayez' },
  needSent: {
    en: 'Thanks, we got it. New tools come through updates and downloads.',
    zh: '收到了，谢谢。新功能会通过更新和下载内容加进来。',
    fr: 'Merci, c’est noté. Les nouveaux outils arriveront avec les mises à jour et les téléchargements.',
  },
  needPrivacy: {
    en: 'Only this sentence is sent to Morph — no files, entries or settings.',
    zh: '只发送这一句话给 Morph，不含文件、记录和设置。',
    fr: 'Seule cette phrase est envoyée à Morph — ni fichiers, ni entrées, ni réglages.',
  },
  needsSettingTitle: {
    en: 'Offer to send requests AI can’t do',
    zh: 'AI 做不到时，可以把需求告诉我们',
    fr: 'Proposer d’envoyer les demandes que l’IA ne sait pas traiter',
  },
  needsSettingNote: {
    en: 'Shows a button under the answer. Nothing is sent unless you tap it.',
    zh: '在回答下面显示一个按钮，你点了才会发送那一句话。',
    fr: 'Affiche un bouton sous la réponse. Rien n’est envoyé sans que vous appuyiez dessus.',
  },
  // ---- 记一笔、附件和公式字段（D-187、D-188）----
  noAttachment: { en: 'No attachment', zh: '没有附件', fr: 'Aucune pièce jointe' },
  attachmentMissing: {
    en: 'The file was deleted',
    zh: '文件已经删掉了',
    fr: 'Le fichier a été supprimé',
  },
  removeAttachment: { en: 'Remove', zh: '去掉', fr: 'Retirer' },
  runError_documentUnsupported: {
    en: '“{name}” is a {format} file. On this phone only Word documents (.docx) can be turned into PDFs.',
    zh: '「{name}」是 {format} 文件。这台手机上只能把 Word 文档（.docx）转成 PDF。',
    fr: '« {name} » est un fichier {format}. Sur ce téléphone, seuls les documents Word (.docx) peuvent être convertis en PDF.',
  },
  runError_tooLong: {
    en: '“{name}” is too long for a GIF (at most {seconds} seconds). Trim it first.',
    zh: '「{name}」太长了，做不成 GIF（最长 {seconds} 秒）。请先剪一段。',
    fr: '« {name} » est trop long pour un GIF (maximum {seconds} secondes). Coupez-le d’abord.',
  },
  runError_noSpeech: {
    en: 'No speech was heard in “{name}”.',
    zh: '在「{name}」里没有听到说话。',
    fr: 'Aucune parole n’a été entendue dans « {name} ».',
  },
  speechLangUnsupported: {
    en: 'This phone can’t recognize {lang} on the device.',
    zh: '这台手机不能在本机识别{lang}。',
    fr: 'Ce téléphone ne peut pas reconnaître {lang} sur l’appareil.',
  },
  speechUnavailable: {
    en: 'Speech recognition doesn’t work on this device (a simulator, or a system that is too old).',
    zh: '这台设备不能在本机做语音识别（模拟器，或者系统版本太旧）。',
    fr: 'La reconnaissance vocale ne fonctionne pas sur cet appareil (simulateur ou système trop ancien).',
  },
  speechDownloadAsk: {
    en: 'Recognizing {lang} needs a download first',
    zh: '第一次识别{lang}需要先下载',
    fr: 'La reconnaissance de {lang} nécessite d’abord un téléchargement',
  },
  speechDownloadBody: {
    en: 'The speech model comes from Apple. After that it works without the internet.',
    zh: '语音模型由苹果提供，下载后不联网也能用。',
    fr: 'Le modèle vocal provient d’Apple. Ensuite, il fonctionne sans connexion Internet.',
  },
  speechDownload: { en: 'Download', zh: '下载', fr: 'Télécharger' },
  speechDownloadFailed: {
    en: 'the speech model for {lang}',
    zh: '{lang}的语音模型',
    fr: 'le modèle vocal pour {lang}',
  },
  speechNote: {
    en: 'Recognized on this device — words may be wrong, especially with noise or accents. Check it.',
    zh: '本机自动识别，有噪音或口音时可能有错字，请核对。',
    fr: 'Reconnaissance effectuée sur cet appareil : des mots peuvent être erronés, surtout en cas de bruit ou d’accent. Vérifiez le texte.',
  },
  audioMerged: { en: '{name} and {n} more', zh: '{name} 等 {n} 段', fr: '{name} et {n} autres' },
  trimWaveformLoading: {
    en: 'Reading the waveform…',
    zh: '正在读取波形…',
    fr: 'Lecture de la forme d’onde…',
  },
  trimRingtone: {
    en: 'On Android you can then choose the saved file as a ringtone in Settings → Sounds; an iPhone app can’t set ringtones.',
    zh: '存好后，Android 可以在「设置 → 声音」里把它设成铃声；iPhone 不能由 App 设成铃声。',
    fr: 'Sur Android, vous pouvez ensuite choisir le fichier enregistré comme sonnerie dans Paramètres → Sons ; une app iPhone ne peut pas définir de sonnerie.',
  },
  recordTitle: { en: 'Record', zh: '录音', fr: 'Enregistrer' },
  recordMicrophone: { en: 'Microphone', zh: '麦克风', fr: 'Microphone' },
  recordFailed: {
    en: 'The microphone can’t be used right now (another app may be using it). Try again.',
    zh: '现在用不了麦克风（可能别的 App 正在用），请再试一次。',
    fr: 'Le microphone est indisponible pour le moment (une autre application l’utilise peut-être). Réessayez.',
  },
  recordStart: { en: 'Start recording', zh: '开始录音', fr: 'Commencer l’enregistrement' },
  recordPause: { en: 'Pause', zh: '暂停', fr: 'Pause' },
  recordResume: { en: 'Continue', zh: '继续录', fr: 'Reprendre' },
  recordDone: { en: 'Done', zh: '完成', fr: 'Terminé' },
  recordHint: {
    en: 'It keeps recording when the screen locks. Tap Done when you have finished.',
    zh: '锁屏后会继续录。录完点「完成」。',
    fr: 'L’enregistrement continue lorsque l’écran se verrouille. Appuyez sur « Terminer » une fois fini.',
  },
  recordDiscardTitle: {
    en: 'Discard this recording?',
    zh: '不要这段录音了？',
    fr: 'Supprimer cet enregistrement ?',
  },
  recordDiscard: { en: 'Discard', zh: '不要了', fr: 'Supprimer' },
  recordKeep: { en: 'Keep recording', zh: '继续录', fr: 'Continuer l’enregistrement' },
  // 按条件筛选（D-242）
  runError_noneMatched: {
    en: 'None of the {count} files meet the conditions of “Keep only some files”.',
    zh: '{count} 个文件都不满足「按条件筛选」的条件。',
    fr: 'Aucun des {count} fichiers ne remplit les conditions de « Filtrer les fichiers ».',
  },
} satisfies Record<string, Localized>;

export const extractedMessages = {
  planner_This_request_can_t_be_handled_Try_desc_04270: {
    en: 'This request can’t be handled. Try describing how you want to change the app.',
    zh: '这个请求无法处理，请换一种说法描述你想怎么修改这个 App。',
    fr: 'Cette demande ne peut pas être traitée. Essayez de décrire comment vous voulez modifier l’application.',
  },
  prompt_English_fafbe: {
    en: 'English',
    zh: 'Simplified Chinese',
    fr: 'French',
  },
  describe_header_455aa: {
    en: 'header “{v0}”',
    zh: '标题「{v0}」',
    fr: 'en-tête « {v0} »',
  },
  describe_description_text_fccd4: {
    en: 'description text',
    zh: '说明文字',
    fr: 'texte de description',
  },
  describe_tool_card_80198: {
    en: '{v0} tool card',
    zh: '「{v0}」工具入口',
    fr: 'carte d’outil {v0}',
  },
  describe_Open_photo_library_47a7e: {
    en: 'Open photo library',
    zh: '打开相册',
    fr: 'Ouvrir la photothèque',
  },
  describe_Open_files_3477c: {
    en: 'Open files',
    zh: '打开文件',
    fr: 'Ouvrir les fichiers',
  },
  describe_tool_grid_e987a: {
    en: 'tool grid “{v0}”',
    zh: '工具宫格「{v0}」',
    fr: 'grille d’outils « {v0} »',
  },
  describe_tool_grid_1c74f: {
    en: 'tool grid',
    zh: '工具宫格',
    fr: 'grille d’outils',
  },
  describe_link_941e3: {
    en: '“{v0}” link',
    zh: '「{v0}」入口',
    fr: 'lien « {v0} »',
  },
  describe_file_list_a11dd: {
    en: 'file list “{v0}”',
    zh: '文件列表「{v0}」',
    fr: 'liste de fichiers « {v0} »',
  },
  describe_quick_action_list: {
    en: 'quick action list',
    zh: '快捷操作列表',
    fr: 'liste d’actions rapides',
  },
  describe_quick_action_list_kind: {
    en: '“{v0}” quick action list',
    zh: '「{v0}」快捷操作列表',
    fr: 'liste d’actions rapides « {v0} »',
  },
  describe_quick_action_1fb38: {
    en: 'quick action “{v0}”',
    zh: '快捷操作「{v0}」',
    fr: 'action rapide « {v0} »',
  },
  describe_button_d79ee: {
    en: 'button “{v0}”',
    zh: '按钮「{v0}」',
    fr: 'bouton « {v0} »',
  },
  describe_shortcut_b2616: {
    en: 'shortcut “{v0}”',
    zh: '快捷入口「{v0}」',
    fr: 'raccourci « {v0} »',
  },
  describe_notice_f50d5: {
    en: 'notice',
    zh: '提示框',
    fr: 'encadré',
  },
  describe_image_d5072: {
    en: 'image “{v0}”',
    zh: '图片「{v0}」',
    fr: 'image « {v0} »',
  },
  describe_image_df755: {
    en: 'image',
    zh: '图片',
    fr: 'image',
  },
  describe_divider_7fe10: {
    en: 'divider',
    zh: '分隔线',
    fr: 'séparateur',
  },
  describe_spacer_9a646: {
    en: 'spacer',
    zh: '空白间距',
    fr: 'espacement',
  },
  describe_list_0b528: {
    en: '“{v0}” list',
    zh: '「{v0}」的记录列表',
    fr: 'liste des entrées « {v0} »',
  },
  describe_form_f4ef1: {
    en: '“{v0}” form',
    zh: '「{v0}」的添加表单',
    fr: 'formulaire d’ajout « {v0} »',
  },
  describe_stat_c1587: {
    en: 'stat “{v0}”',
    zh: '统计「{v0}」',
    fr: 'statistique « {v0} »',
  },
  describe_stacked_00ce0: {
    en: 'stacked',
    zh: '竖排',
    fr: 'empilé',
  },
  describe_row_be7f8: {
    en: 'row',
    zh: '横排',
    fr: 'en ligne',
  },
  describe_grid_3f0e7: {
    en: 'grid',
    zh: '网格',
    fr: 'en grille',
  },
  describe__5caf2: {
    en: ' “{v0}”',
    zh: '「{v0}」',
    fr: ' « {v0} »',
  },
  describe_group_86cab: {
    en: '{v0} group{v1}',
    zh: '{v0}分组{v1}',
    fr: 'groupe {v0}{v1}',
  },
  describe__41054: {
    en: '{v0} → {v1}',
    zh: '{v0}改为{v1}',
    fr: '{v0} → {v1}',
  },
  describe_light_57222: {
    en: 'light',
    zh: '浅色',
    fr: 'clair',
  },
  describe_dark_12552: {
    en: 'dark',
    zh: '深色',
    fr: 'sombre',
  },
  describe_system_84963: {
    en: 'system',
    zh: '跟随系统',
    fr: 'système',
  },
  describe_Background_639fc: {
    en: 'Background',
    zh: '背景色',
    fr: 'Arrière-plan',
  },
  describe_Card_color_cb523: {
    en: 'Card color',
    zh: '卡片颜色',
    fr: 'Couleur des cartes',
  },
  describe_Text_color_af4a8: {
    en: 'Text color',
    zh: '文字颜色',
    fr: 'Couleur du texte',
  },
  describe_Secondary_color_844c7: {
    en: 'Secondary color',
    zh: '辅助色',
    fr: 'Couleur secondaire',
  },
  describe_Tertiary_color_dec1a: {
    en: 'Tertiary color',
    zh: '第三色',
    fr: 'Couleur tertiaire',
  },
  describe__441c2: {
    en: '“{v0}”',
    zh: '「{v0}」',
    fr: '« {v0} »',
  },
  describe_on_43dea: {
    en: '{v0} on “{v1}”',
    zh: '「{v1}」的{v0}',
    fr: '{v0} sur « {v1} »',
  },
  describe_Add_data_table_f79c6: {
    en: 'Add data table “{v0}” ({v1})',
    zh: '新建数据表「{v0}」（{v1}）',
    fr: 'Ajouter le tableau de données « {v0} » ({v1})',
  },
  describe_Rename_data_table_to_c585f: {
    en: 'Rename data table “{v0}” to “{v1}”',
    zh: '数据表「{v0}」改名为「{v1}」',
    fr: 'Renommer le tableau de données « {v0} » en « {v1} »',
  },
  describe_Change_the_icon_of_9c456: {
    en: 'Change the icon of “{v0}”',
    zh: '数据表「{v0}」换图标',
    fr: 'Changer l’icône de « {v0} »',
  },
  describe_Add_field_to_b8810: {
    en: 'Add field “{v0}” ({v1}) to “{v2}”',
    zh: '给「{v2}」加字段「{v0}」（{v1}）',
    fr: 'Ajouter le champ « {v0} » ({v1}) à « {v2} »',
  },
  describe_rename_to_08deb: {
    en: 'rename to “{v0}”',
    zh: '改名为「{v0}」',
    fr: 'renommer en « {v0} »',
  },
  describe_type_7382b: {
    en: 'type → {v0}',
    zh: '类型改为{v0}',
    fr: 'type → {v0}',
  },
  describe_options_64e79: {
    en: 'options → {v0}',
    zh: '选项改为 {v0}',
    fr: 'options → {v0}',
  },
  describe_update_settings_2aaf6: {
    en: 'update settings',
    zh: '调整设置',
    fr: 'Modifier les réglages',
  },
  describe_Move_field_of_to_position_aa798: {
    en: 'Move field “{v0}” of “{v1}” to position {v2}',
    zh: '把「{v1}」的字段「{v0}」移到第 {v2} 位',
    fr: 'Déplacer le champ « {v0} » de « {v1} » en position {v2}',
  },
  describe_Hide_field_of_existing_data_is_kept_4f9d1: {
    en: 'Hide field “{v0}” of “{v1}” (existing data is kept)',
    zh: '隐藏「{v1}」的字段「{v0}」（已有数据保留）',
    fr: 'Masquer le champ « {v0} » de « {v1} » (les données existantes sont conservées)',
  },
  describe_Remove_data_table_from_the_app_records_1a3d2: {
    en: 'Remove data table “{v0}” from the app (its entries are kept in Settings → Data)',
    zh: '把数据表「{v0}」移出界面（记录保留，可在「设置 → 数据」里查看和导出）',
    fr: 'Retirer le tableau de données « {v0} » de l’application (les entrées sont conservées, consultables et exportables dans Paramètres → Données)',
  },
  describe_Theme_color_8ee07: {
    en: 'Theme color → {v0}',
    zh: '主题色改为 {v0}',
    fr: 'Couleur du thème → {v0}',
  },
  describe_Appearance_b422e: {
    en: 'Appearance → {v0}',
    zh: '外观改为{v0}',
    fr: 'Apparence → {v0}',
  },
  describe_Dark_mode_74033: {
    en: 'Dark mode ',
    zh: '深色模式的',
    fr: 'Mode sombre ',
  },
  describe_dark_color: {
    en: 'Dark mode {v0}',
    zh: '深色模式的{v0}',
    fr: '{v0} (mode sombre)',
  },
  describe_default_82b64: {
    en: '{v0} → default',
    zh: '{v0}恢复默认',
    fr: '{v0} → par défaut',
  },
  describe__072d2: {
    en: '{v0} → {v1}',
    zh: '{v0}改为 {v1}',
    fr: '{v0} → {v1}',
  },
  describe_Switch_the_style_to_colors_fonts_corne_60590: {
    en: 'Switch the style to “{v0}” (colors, fonts, corners, cards and background)',
    zh: '样式换成「{v0}」风格（颜色、字体、圆角、卡片和背景）',
    fr: 'Passer au style « {v0} » (couleurs, polices, coins arrondis, cartes et arrière-plan)',
  },
  describe_Reset_the_style_to_the_default_colors__162af: {
    en: 'Reset the style to the default (colors, fonts, corners, spacing)',
    zh: '样式恢复为默认风格（颜色、字体、圆角、间距）',
    fr: 'Réinitialiser le style par défaut (couleurs, polices, coins arrondis, espacements)',
  },
  describe_Navigation_was_7f9d5: {
    en: 'Navigation → {v0} (was: {v1})',
    zh: '导航栏改为：{v0}（原来：{v1}）',
    fr: 'Navigation → {v0} (était : {v1})',
  },
  describe_Remove_all_floating_buttons_0029b: {
    en: 'Remove all floating buttons',
    zh: '去掉所有浮动按钮',
    fr: 'Supprimer tous les boutons flottants',
  },
  describe_Floating_buttons_d071d: {
    en: 'Floating buttons → {v0}',
    zh: '浮动按钮改为：{v0}',
    fr: 'Boutons flottants → {v0}',
  },
  describe_Add_page_blocks_80d1f: {
    en: 'Add page “{v0}” ({v1} blocks)',
    zh: '新建页面「{v0}」（{v1} 块内容）',
    fr: 'Ajouter la page « {v0} » ({v1} blocs)',
  },
  describe_Remove_page_files_are_not_affected_5abad: {
    en: 'Remove page “{v0}” (files are not affected)',
    zh: '删除页面「{v0}」（文件不受影响）',
    fr: 'Supprimer la page « {v0} » (les fichiers ne sont pas affectés)',
  },
  describe_Rename_page_to_5e2cc: {
    en: 'Rename page “{v0}” to “{v1}”',
    zh: '页面「{v0}」改名为「{v1}」',
    fr: 'Renommer la page « {v0} » en « {v1} »',
  },
  describe_Move_to_position_in_7eb22: {
    en: 'Move {v0} to position {v1} in {v2}',
    zh: '把{v0}移到{v2}第 {v1} 位',
    fr: 'Déplacer {v0} en position {v1} dans {v2}',
  },
  describe_new_picture_bf924: {
    en: 'new picture',
    zh: '更换图片',
    fr: 'nouvelle image',
  },
  describe_picture_removed_4fb32: {
    en: 'picture removed',
    zh: '移除图片',
    fr: 'image supprimée',
  },
  describe_removed_d5c25: {
    en: '{v0} removed',
    zh: '去掉{v0}',
    fr: 'Suppression : {v0}',
  },
  describe_Update_75049: {
    en: 'Update {v0}: {v1}',
    zh: '修改{v0}：{v1}',
    fr: 'Modifier {v0} : {v1}',
  },
  describe_default_9ef5c: {
    en: 'default',
    zh: '默认',
    fr: 'par défaut',
  },
  describe_Restyle_0b6e5: {
    en: 'Restyle {v0}: {v1}',
    zh: '调整{v0}的外观：{v1}',
    fr: 'Changer l’apparence de {v0} : {v1}',
  },
  describe_Add_to_f2026: {
    en: 'Add {v0} to {v1}',
    zh: '在{v1}添加{v0}',
    fr: 'Ajouter {v0} à {v1}',
  },
  describe_Remove_from_c2717: {
    en: 'Remove {v0} from “{v1}”',
    zh: '从「{v1}」移除{v0}',
    fr: 'Retirer {v0} de « {v1} »',
  },
  describe_Add_the_tool_adds_its_page_7a595: {
    en: 'Add the {v0} tool: adds its page',
    zh: '添加「{v0}」工具：新增工具页面',
    fr: 'Ajouter l’outil « {v0} » : ajoute sa page',
  },
  describe_Add_the_tool_adds_its_page_and_a_home__ec774: {
    en: 'Add the {v0} tool: adds its page and a home card',
    zh: '添加「{v0}」工具：新增工具页面和首页入口',
    fr: 'Ajouter l’outil « {v0} » : ajoute sa page et une carte à l’accueil',
  },
  describe_Remove_the_tool_removes_its_card_page__2fb97: {
    en: 'Remove the {v0} tool: removes its card, page and quick actions; your files are kept',
    zh: '移除「{v0}」工具：移除入口、页面和快捷操作，已有文件全部保留',
    fr: 'Retirer l’outil « {v0} » : supprime sa carte, sa page et ses actions rapides ; vos fichiers sont conservés',
  },
  describe__3ca25: {
    en: '“{v0}” – {v1}: {v2}',
    zh: '「{v0}」的「{v1}」：{v2}',
    fr: '« {v0} » – {v1} : {v2}',
  },
  describe_Update_c2f66: {
    en: 'Update “{v0}” – {v1}',
    zh: '调整「{v0}」的「{v1}」设置',
    fr: 'Modifier les réglages de « {v0} » – {v1}',
  },
  describe_asks_for_on_every_run_708a8: {
    en: '“{v0}” asks for {v1} on every run',
    zh: '「{v0}」每次运行时询问：{v1}',
    fr: '« {v0} » demande {v1} à chaque exécution',
  },
  describe_no_longer_asks_it_uses_the_saved_setti_a3369: {
    en: '“{v0}” – {v1} no longer asks; it uses the saved settings',
    zh: '「{v0}」的「{v1}」不再询问，直接使用设定值',
    fr: '« {v0} » – {v1} ne demande plus ; les réglages enregistrés sont utilisés',
  },
  describe_ready_made_61047: {
    en: ' (ready-made)',
    zh: '（现成的）',
    fr: ' (prêt à l’emploi)',
  },
  describe_New_quick_action_b4026: {
    en: 'New quick action “{v0}”{v1}: {v2}',
    zh: '新建快捷操作「{v0}」{v1}：{v2}',
    fr: 'Nouvelle action rapide « {v0} »{v1} : {v2}',
  },
  describe_Delete_the_quick_action_files_are_kept_deaf1: {
    en: 'Delete the quick action “{v0}” (files are kept)',
    zh: '删除快捷操作「{v0}」（文件不受影响）',
    fr: 'Supprimer l’action rapide « {v0} » (les fichiers sont conservés)',
  },
  describe_Rename_the_quick_action_to_e45a1: {
    en: 'Rename the quick action “{v0}” to “{v1}”',
    zh: '快捷操作「{v0}」改名为「{v1}」',
    fr: 'Renommer l’action rapide « {v0} » en « {v1} »',
  },
  describe_Move_to_step_in_885bf: {
    en: 'Move “{v0}” to step {v1} in “{v2}”',
    zh: '「{v2}」把「{v0}」移到第 {v1} 步',
    fr: 'Dans « {v2} », déplacer « {v0} » à l’étape {v1}',
  },
  describe_Rename_to_decb3: {
    en: 'Rename “{v0}” to “{v1}”',
    zh: '快捷操作「{v0}」改名为「{v1}」',
    fr: 'Renommer l’action rapide « {v0} » en « {v1} »',
  },
  describe_Steps_of_591ff: {
    en: 'Steps of “{v0}”: {v1}',
    zh: '「{v0}」的步骤：{v1}',
    fr: 'Étapes de « {v0} » : {v1}',
  },
  describe_Remove_step_from_8750c: {
    en: 'Remove step “{v0}” from “{v1}”',
    zh: '「{v1}」去掉步骤「{v0}」',
    fr: 'Dans « {v1} », retirer l’étape « {v0} »',
  },
  describe_can_t_be_removed_it_holds_the_AI_and_C_e58da: {
    en: '“{v0}” can’t be removed (it holds the AI and Change history entries), so it becomes a floating button',
    zh: '「{v0}」不能移除（AI 修改和改动记录的入口都在里面），已改为浮动按钮',
    fr: '« {v0} » ne peut pas être retiré (il contient les entrées IA et Historique des modifications), il devient donc un bouton flottant',
  },
  describe_Update_the_tool_to_the_latest_version__b20b4: {
    en: 'Update the {v0} tool to the latest version; your changes are kept',
    zh: '更新「{v0}」工具到最新版本；你改过的内容保留',
    fr: 'Mettre à jour l’outil « {v0} » vers la dernière version ; vos modifications sont conservées',
  },
  describe_Also_removes_card_s_that_ran_this_quic_5d29f: {
    en: 'Also removes {v0} cards that ran this quick action',
    zh: '同时移除 {v0} 个运行这个快捷操作的卡片',
    fr: 'Supprime aussi {v0} cartes ayant exécuté cette action rapide',
  },
  describe_Also_removes_block_s_that_showed_a7a30: {
    en: 'Also removes {v0} blocks that showed “{v1}”',
    zh: '同时移除 {v0} 块显示「{v1}」的内容',
    fr: 'Supprime aussi {v0} blocs affichant « {v1} »',
  },
  describe_Also_removes_button_s_or_shortcut_s_th_d4dc1: {
    en: 'Also removes {v0} buttons or shortcuts that opened “{v1}”',
    zh: '同时移除 {v0} 个指向「{v1}」的按钮或快捷入口',
    fr: 'Supprime aussi {v0} boutons ou raccourcis ouvrant « {v1} »',
  },
  describe_Go_back_to_when_happened_pages_navigat_cbdc3: {
    en: 'Go back to when “{v0}” happened: pages, navigation, theme and quick actions return to how they were',
    zh: '回到「{v0}」那时候的样子：页面、导航、主题和快捷操作都回到当时',
    fr: 'Revenir à l’état du moment de « {v0} » : pages, navigation, thème et actions rapides reviennent à ce qu’ils étaient alors',
  },
  describe_The_tool_s_card_and_quick_actions_will_a857b: {
    en: 'The {v0} tool’s card and quick actions will be removed; its files are kept and you can add it again',
    zh: '「{v0}」工具的入口和快捷操作会被移除；它用过和生成的文件都会保留，重新添加即可继续使用',
    fr: 'La carte et les actions rapides de l’outil « {v0} » seront supprimées ; ses fichiers, utilisés et générés, sont conservés ; il suffit de l’ajouter à nouveau pour continuer à l’utiliser',
  },
  describe_The_tool_comes_back_205fb: {
    en: 'The {v0} tool comes back',
    zh: '「{v0}」工具会重新出现',
    fr: 'L’outil « {v0} » réapparaît',
  },
  describe_The_table_leaves_the_app_its_entries_s_29282: {
    en: 'The “{v0}” table leaves the app; its entries stay in Settings → Data and come back with it',
    zh: '数据表「{v0}」会移出界面；记录保留在「设置 → 数据」，以后回到有它的时候数据还在',
    fr: 'Le tableau « {v0} » quitte l’application ; ses entrées restent dans Paramètres → Données et reviendront avec lui',
  },
  describe_The_table_comes_back_dd301: {
    en: 'The “{v0}” table comes back',
    zh: '数据表「{v0}」会重新出现',
    fr: 'Le tableau « {v0} » réapparaît',
  },
  describe_Your_files_and_entries_are_not_affecte_c87ef: {
    en: 'Your files and entries are not affected',
    zh: '你的文件和记录的数据不受影响',
    fr: 'Vos fichiers et entrées ne sont pas affectés',
  },
  describe_Your_files_are_not_affected_3c83c: {
    en: 'Your files are not affected',
    zh: '你的文件不受影响',
    fr: 'Vos fichiers ne sont pas affectés',
  },
  data_Attachment_6f6cf: {
    en: 'Attachment',
    zh: '附件',
    fr: 'Pièce jointe',
  },
  data_Yes_1f54e: {
    en: 'Yes',
    zh: '是',
    fr: 'Oui',
  },
  data_No_04a4b: {
    en: 'No',
    zh: '否',
    fr: 'Non',
  },
  data_Created_1626a: {
    en: 'Created',
    zh: '创建时间',
    fr: 'Création',
  },
  starter_Toolbox_802f3: {
    en: 'Toolbox',
    zh: '工具箱',
    fr: 'Boîte à outils',
  },
  starter_Manage_tools_f1487: {
    en: 'Manage tools',
    zh: '管理工具',
    fr: 'Gérer les outils',
  },
  defaults_Home_ec133: {
    en: 'Home',
    zh: '首页',
    fr: 'Accueil',
  },
  defaults_My_workspace_df4a5: {
    en: 'My workspace',
    zh: '我的工作台',
    fr: 'Mon espace de travail',
  },
  defaults_Tap_AI_and_describe_how_this_app_shoul_7d958: {
    en: 'Tap AI and describe how this app should change',
    zh: '点「AI 修改」，用一句话改造这个 App',
    fr: 'Touchez « IA » et décrivez en une phrase comment cette app doit changer.',
  },
  defaults_Add_tools_9c8e1: {
    en: 'Add tools',
    zh: '添加工具',
    fr: 'Ajouter des outils',
  },
  defaults_Recent_files_2d602: {
    en: 'Recent files',
    zh: '最近文件',
    fr: 'Fichiers récents',
  },
  presets_ID_photo_20f6d: {
    en: 'ID photo {date}',
    zh: '证件照-{date}',
    fr: 'Photo d’identité {date}',
  },
  presets_Documents_4ee07: {
    en: 'Documents {date}',
    zh: '材料-{date}',
    fr: 'Documents {date}',
  },
  presets_Scan_5b295: {
    en: 'Scan {date}',
    zh: '扫描-{date}',
    fr: 'Numérisation {date}',
  },
  presets_combined_7b1c7: {
    en: '{sourceName}-combined',
    zh: '{sourceName}-合并',
    fr: '{sourceName}-fusionné',
  },
  presets_Receipt_d832a: {
    en: 'Receipt {date}',
    zh: '收据-{date}',
    fr: 'Reçu {date}',
  },
  presets_Expenses_427ff: {
    en: 'Expenses {date:YYYY-MM}',
    zh: '报销单-{date:YYYY-MM}',
    fr: 'Dépenses {date:YYYY-MM}',
  },
  presets_Photos_c2260: {
    en: 'Photos {date}',
    zh: '照片-{date}',
    fr: 'Photos {date}',
  },
  presets_English_2d0eb: {
    en: '{sourceName}-English',
    zh: '{sourceName}-中文',
    fr: '{sourceName}-anglais',
  },
  presets_Translation_38e12: {
    en: 'Translation {date}',
    zh: '译文-{date}',
    fr: 'Traduction {date}',
  },
  presets_English_fe3af: {
    en: 'English {date}',
    zh: '英文-{date}',
    fr: 'Anglais {date}',
  },
  presets_Recording_cd46f: {
    en: 'Recording {date}',
    zh: '录音 {date}',
    fr: 'Enregistrement {date}',
  },
  presets_Voice_memo_d1e75: {
    en: 'Voice memo {date:YYYY-MM-DD_HH.mm}',
    zh: '语音备忘 {date:YYYY-MM-DD_HH.mm}',
    fr: 'Mémo vocal {date:YYYY-MM-DD_HH.mm}',
  },
  templates_Expenses_628c1: {
    en: 'Expenses',
    zh: '账目',
    fr: 'Dépenses',
  },
  templates_Amount_454fd: {
    en: 'Amount',
    zh: '金额',
    fr: 'Montant',
  },
  templates_USD_006d1: {
    en: 'USD',
    zh: 'CNY',
    fr: 'EUR',
  },
  templates_Category_74b40: {
    en: 'Category',
    zh: '分类',
    fr: 'Catégorie',
  },
  templates_Food_8ab5c: {
    en: 'Food',
    zh: '餐饮',
    fr: 'Restauration',
  },
  templates_Transport_a9c49: {
    en: 'Transport',
    zh: '交通',
    fr: 'Transport',
  },
  templates_Shopping_5cfd4: {
    en: 'Shopping',
    zh: '购物',
    fr: 'Achats',
  },
  templates_Home_38780: {
    en: 'Home',
    zh: '居家',
    fr: 'Maison',
  },
  templates_Fun_1e014: {
    en: 'Fun',
    zh: '娱乐',
    fr: 'Loisirs',
  },
  templates_Other_82cdf: {
    en: 'Other',
    zh: '其他',
    fr: 'Autre',
  },
  templates_Date_a50c7: {
    en: 'Date',
    zh: '日期',
    fr: 'Date',
  },
  templates_Note_4f584: {
    en: 'Note',
    zh: '备注',
    fr: 'Remarque',
  },
  templates_Budget_b41b1: {
    en: 'Budget',
    zh: '记账',
    fr: 'Budget',
  },
  templates_This_month_ef628: {
    en: 'This month',
    zh: '本月支出',
    fr: 'Ce mois-ci',
  },
  templates_Entries_3c27f: {
    en: 'Entries',
    zh: '本月笔数',
    fr: 'Saisies',
  },
  templates_Add_87da3: {
    en: 'Add',
    zh: '记一笔',
    fr: 'Ajouter',
  },
  templates_Nothing_yet_9f2eb: {
    en: 'Nothing yet',
    zh: '还没有记录',
    fr: 'Rien pour l’instant',
  },
  templates_To_dos_42048: {
    en: 'To-dos',
    zh: '待办',
    fr: 'À faire',
  },
  templates_Task_5fa9b: {
    en: 'Task',
    zh: '事项',
    fr: 'Tâche',
  },
  templates_Done_6f135: {
    en: 'Done',
    zh: '完成',
    fr: 'Terminé',
  },
  templates_Due_f5da7: {
    en: 'Due',
    zh: '截止日期',
    fr: 'Échéance',
  },
  templates_To_do_ca3e9: {
    en: 'To-do',
    zh: '待办',
    fr: 'À faire',
  },
  templates_Open_f1cc8: {
    en: 'Open',
    zh: '未完成',
    fr: 'Non terminées',
  },
  templates_Add_b7a68: {
    en: 'Add',
    zh: '添加',
    fr: 'Ajouter',
  },
  templates_No_tasks_c61dd: {
    en: 'No tasks',
    zh: '没有待办事项',
    fr: 'Aucune tâche',
  },
  templates_Books_936cc: {
    en: 'Books',
    zh: '书单',
    fr: 'Livres',
  },
  templates_Title_880a4: {
    en: 'Title',
    zh: '书名',
    fr: 'Titre',
  },
  templates_Author_746ae: {
    en: 'Author',
    zh: '作者',
    fr: 'Auteur',
  },
  templates_Status_d925f: {
    en: 'Status',
    zh: '状态',
    fr: 'Statut',
  },
  templates_Want_to_read_a7318: {
    en: 'Want to read',
    zh: '想读',
    fr: 'À lire',
  },
  templates_Reading_27c53: {
    en: 'Reading',
    zh: '在读',
    fr: 'En cours',
  },
  templates_Finished_08ced: {
    en: 'Finished',
    zh: '读完',
    fr: 'Lu',
  },
  templates_Rating_a0ed3: {
    en: 'Rating',
    zh: '评分',
    fr: 'Note',
  },
  templates_Notes_17714: {
    en: 'Notes',
    zh: '笔记',
    fr: 'Notes',
  },
  templates_Reading_758da: {
    en: 'Reading',
    zh: '读书清单',
    fr: 'Liste de lecture',
  },
  templates_Finished_efc6c: {
    en: 'Finished',
    zh: '已读完',
    fr: 'Terminés',
  },
  templates_Add_a_book_7ee61: {
    en: 'Add a book',
    zh: '添加一本书',
    fr: 'Ajouter un livre',
  },
  templates_No_books_yet_64371: {
    en: 'No books yet',
    zh: '还没有书',
    fr: 'Aucun livre pour l’instant',
  },
  templates_Title_5bdb7: {
    en: 'Title',
    zh: '标题',
    fr: 'Titre',
  },
  templates_Text_f1abc: {
    en: 'Text',
    zh: '正文',
    fr: 'Texte',
  },
  templates_New_note_b5bca: {
    en: 'New note',
    zh: '写笔记',
    fr: 'Nouvelle note',
  },
  templates_No_notes_yet_56f53: {
    en: 'No notes yet',
    zh: '还没有笔记',
    fr: 'Aucune note pour l’instant',
  },
  presets_Switch_to_the_style_aedda: {
    en: 'Switch to the {v0} style',
    zh: '换成{v0}风格',
    fr: 'Passer au style {v0}',
  },
  audio_Audio_2bfdb: {
    en: 'Audio',
    zh: '音频',
    fr: 'Audio',
  },
  audio_Audio_tools_ca3ac: {
    en: 'Audio tools',
    zh: '音频工具',
    fr: 'Outils audio',
  },
  audio_Everything_runs_on_this_device_nothing_de468: {
    en: 'Everything runs on this device; nothing is uploaded. Recognized text may have mistakes, so check it.',
    zh: '全部在本机处理，不会上传。识别出的文字可能有错字，请核对。',
    fr: 'Tout s’exécute sur cet appareil ; rien n’est envoyé. Le texte reconnu peut contenir des erreurs : vérifiez-le.',
  },
  audio_Audio_files_185dc: {
    en: 'Audio files',
    zh: '音频文件',
    fr: 'Fichiers audio',
  },
  video_Video_19238: {
    en: 'Video',
    zh: '视频',
    fr: 'Vidéo',
  },
  video_Video_tools_632fd: {
    en: 'Video tools',
    zh: '视频工具',
    fr: 'Outils vidéo',
  },
  video_Everything_runs_on_this_device_nothing_d4b96: {
    en: 'Everything runs on this device; nothing is uploaded.',
    zh: '全部在本机处理，不会上传。',
    fr: 'Tout s’exécute sur cet appareil ; rien n’est envoyé.',
  },
  video_Videos_0f33c: {
    en: 'Videos',
    zh: '视频文件',
    fr: 'Vidéos',
  },
  image_HEIC_to_JPG_64d8f: {
    en: 'HEIC to JPG',
    zh: 'HEIC 转 JPG',
    fr: 'HEIC vers JPG',
  },
  image_Copy_49a2a: {
    en: 'Copy',
    zh: '仅供办理使用',
    fr: 'Copie',
  },
  image_ID_photos_to_print_5dd87: {
    en: 'ID photos to print',
    zh: '证件照冲印排版',
    fr: 'Photos d’identité à imprimer',
  },
  image_Images_edfbd: {
    en: 'Images',
    zh: '图片',
    fr: 'Images',
  },
  image_Image_tools_2d55f: {
    en: 'Image tools',
    zh: '图片工具',
    fr: 'Outils image',
  },
  image_Everything_runs_on_this_device_Results_3f5b4: {
    en: 'Everything runs on this device. Results are saved only when you tap Save.',
    zh: '全部在本机处理，不会上传。点「存到文件」才会保存结果。',
    fr: 'Tout s’exécute sur cet appareil. Les résultats ne sont enregistrés que lorsque vous appuyez sur Enregistrer dans Fichiers.',
  },
  more_ZIP_files_d8402: {
    en: 'ZIP files',
    zh: '文件打包',
    fr: 'Fichiers ZIP',
  },
  more_Files_0e973: {
    en: 'Files {date}',
    zh: '文件-{date}',
    fr: 'Fichiers {date}',
  },
  more_ZIP_photos_b72f4: {
    en: 'ZIP photos',
    zh: '照片打包',
    fr: 'Photos en ZIP',
  },
  more_Photos_c2260: {
    en: 'Photos {date}',
    zh: '照片-{date}',
    fr: 'Photos {date}',
  },
  more_Unzip_cc21e: {
    en: 'Unzip',
    zh: '解压',
    fr: 'Décompresser',
  },
  more_Make_a_QR_code_7011a: {
    en: 'Make a QR code',
    zh: '生成二维码',
    fr: 'Créer un code QR',
  },
  more_Wi_Fi_QR_code_12af4: {
    en: 'Wi-Fi QR code',
    zh: 'Wi-Fi 二维码',
    fr: 'Code QR Wi-Fi',
  },
  more_Read_a_QR_code_df393: {
    en: 'Read a QR code',
    zh: '识别二维码',
    fr: 'Lire un code QR',
  },
  more_Text_to_PDF_ac970: {
    en: 'Text to PDF',
    zh: '文字转 PDF',
    fr: 'Texte en PDF',
  },
  scan_Scan_5b295: {
    en: 'Scan {date}',
    zh: '扫描-{date}',
    fr: 'Numérisation {date}',
  },
  scan_Scanner_08f22: {
    en: 'Scanner',
    zh: '扫描',
    fr: 'Numériser',
  },
  scan_Everything_runs_on_this_device_nothing_09e42: {
    en: 'Everything runs on this device; nothing is uploaded. Scanning uses the built-in document scanner; straightening photos may download what it needs the first time (it works offline after that).',
    zh: '全部在本机处理，不会上传。扫描用系统自带的文档扫描；拉正已有照片时，有的设备第一次要下载一些内容（之后不联网也能用）。',
    fr: 'Tout s’exécute sur cet appareil ; rien n’est envoyé. La numérisation utilise le scanneur de documents intégré au système ; pour redresser des photos existantes, certains appareils doivent télécharger des éléments la première fois (ensuite, cela fonctionne hors ligne).',
  },
  scan_Scans_7ac9d: {
    en: 'Scans',
    zh: '扫描件',
    fr: 'Numérisations',
  },
  ocr_Text_recognition_fe569: {
    en: 'Text recognition',
    zh: '文字识别',
    fr: 'Reconnaissance de texte',
  },
  ocr_Runs_on_this_device_the_text_is_never__38fca: {
    en: 'Runs on this device; the text is never uploaded. Most phones use built-in text recognition; otherwise each language is downloaded the first time you use it.',
    zh: '在本机识别，文字不会上传。大多数手机用系统自带的识别；不支持的语言第一次用时下载。',
    fr: 'S’exécute sur cet appareil ; le texte n’est jamais envoyé. La plupart des téléphones utilisent la reconnaissance intégrée au système ; sinon, chaque langue est téléchargée à la première utilisation.',
  },
  html_Created_1626a: {
    en: 'Created',
    zh: '创建时间',
    fr: 'Création',
  },
  html_Updated_74f0c: {
    en: 'Updated',
    zh: '修改时间',
    fr: 'Modifié',
  },
  html_records_3f794: {
    en: '{v0} entries',
    zh: '{v0} 条',
    fr: '{v0} entrées',
  },
  html_Total_08322: {
    en: 'Total',
    zh: '合计',
    fr: 'Total',
  },
  pdf_merged_19094: {
    en: '{sourceName}-merged',
    zh: '{sourceName}-合并',
    fr: '{sourceName}-fusionné',
  },
  pdf_COPY_3fef3: {
    en: 'COPY',
    zh: '副本',
    fr: 'COPIE',
  },
  pdf_PDF_tools_d81ee: {
    en: 'PDF tools',
    zh: 'PDF 工具',
    fr: 'Outils PDF',
  },
  pdf_Everything_runs_on_this_device_nothing_d4b96: {
    en: 'Everything runs on this device; nothing is uploaded.',
    zh: '全部在本机处理，不会上传。',
    fr: 'Tout s’exécute sur cet appareil ; rien n’est envoyé.',
  },
  pdf_PDF_files_2d348: {
    en: 'PDF files',
    zh: 'PDF 文件',
    fr: 'Fichiers PDF',
  },
  translate_Translate_6c51b: {
    en: 'Translate',
    zh: '翻译',
    fr: 'Traduire',
  },
  translate_Translates_on_this_device_the_text_is__027c8: {
    en: 'Translates on this device; the text is never uploaded. Good for understanding the meaning — for official documents, use a professional translator. The first use of a language may need a download.',
    zh: '在本机翻译，文字不会上传。适合看懂意思；正式文件请找专业翻译。第一次用某种语言时可能要下载。',
    fr: 'Traduction sur cet appareil ; le texte n’est jamais envoyé. Utile pour comprendre le sens ; pour les documents officiels, faites appel à un traducteur professionnel. La première utilisation d’une langue peut nécessiter un téléchargement.',
  },
  format_on_7f2b0: {
    en: 'on',
    zh: '开',
    fr: 'activé',
  },
  format_off_4b193: {
    en: 'off',
    zh: '关',
    fr: 'désactivé',
  },
  format_report_25207: {
    en: 'report',
    zh: '报告',
    fr: 'rapport',
  },
  format_e_g_248d5: {
    en: ' (e.g. {v0})',
    zh: '（例如 {v0}）',
    fr: ' (par ex. {v0})',
  },
  format_your_text_6c667: {
    en: '(your text)',
    zh: '（你写的文字）',
    fr: '(votre texte)',
  },
  mock_What_Morph_can_do_8f4f4: {
    en: 'What Morph can do',
    zh: 'Morph 可以做什么',
    fr: 'Ce que Morph peut faire',
  },
  goals_Trip_photos_4142c: {
    en: 'Trip photos {date}',
    zh: '旅行照片-{date}',
    fr: 'Photos de voyage {date}',
  },
  goals_Contracts_3f8a8: {
    en: 'Contracts {date}',
    zh: '合同-{date}',
    fr: 'Contrats {date}',
  },
  ShareScreen_Shared_with_Morph_bb8fe: {
    en: 'Shared with Morph',
    zh: '分享到 Morph',
    fr: 'Partagé avec Morph',
  },
  ShareScreen_Morph_only_takes_files_photos_PDFs_and_91f45: {
    en: 'Morph only takes files (photos, PDFs and so on), not text or links.',
    zh: 'Morph 只接收文件（照片、PDF 等），文字和网址不行。',
    fr: 'Morph n’accepte que les fichiers (photos, PDF, etc.), pas le texte ni les liens.',
  },
  ShareScreen_Close_59a26: {
    en: 'Close',
    zh: '关闭',
    fr: 'Fermer',
  },
  ShareScreen_just_made_ed6c1: {
    en: ' · just made',
    zh: ' · 刚做好',
    fr: ' · à l’instant',
  },
  ShareScreen_Run_5cab2: {
    en: 'Run',
    zh: '运行',
    fr: 'Exécuter',
  },
  ShareScreen_Needs_at_least_files_0ed9b: {
    en: 'Needs at least {v0} files',
    zh: '需要至少 {v0} 个文件',
    fr: 'Au moins {v0} fichiers requis',
  },
  ShareScreen_Takes_at_most_files_0fe59: {
    en: 'Takes at most {v0} files',
    zh: '最多 {v0} 个文件',
    fr: 'Maximum {v0} fichiers',
  },
  ShareScreen_Files_are_handled_on_this_device_only__c8099: {
    en: 'Files are handled on this device only; AI never sees their names or contents.',
    zh: '文件只在这台手机上处理，AI 看不到文件名和内容。',
    fr: 'Les fichiers sont traités uniquement sur cet appareil ; l’IA ne voit jamais leurs noms ni leur contenu.',
  },
  workflow_change_Delete_e4208: {
    en: 'Delete “{v0}”?',
    zh: '删除「{v0}」？',
    fr: 'Supprimer « {v0} » ?',
  },
  workflow_change_Your_files_are_kept_You_can_undo_this_e9492: {
    en: 'Your files are kept. You can undo this.',
    zh: '文件不受影响。删除后可以撤销。',
    fr: 'Vos fichiers sont conservés. Vous pouvez annuler cette action.',
  },
  workflow_change_Delete_8940a: {
    en: 'Delete',
    zh: '删除',
    fr: 'Supprimer',
  },
  RedactScreen_Hide_parts_9ca8f: {
    en: 'Hide parts',
    zh: '打码',
    fr: 'Masquer des zones',
  },
  RedactScreen_Drag_to_draw_boxes_over_names_numbers__e780a: {
    en: 'Drag to draw boxes over names, numbers or anything private.',
    zh: '用手指拖出方框，盖住姓名、号码等不想给别人看的地方。',
    fr: 'Faites glisser pour tracer des cadres sur les noms, numéros ou tout ce qui est privé.',
  },
  RedactScreen_boxes_4d76c: {
    en: '{v0} boxes',
    zh: '{v0} 处',
    fr: '{v0} zones',
  },
  RedactScreen_Undo_791a7: {
    en: 'Undo',
    zh: '撤销一个',
    fr: 'Annuler une',
  },
  CornersScreen_Adjust_corners_44eed: {
    en: 'Adjust corners',
    zh: '调整四个角',
    fr: 'Ajuster les coins',
  },
  CornersScreen_Found_the_edges_of_the_paper_Drag_the__2c34c: {
    en: 'Found the edges of the paper. Drag the corners if they are off.',
    zh: '已找到纸张的边。不对的话，拖动四个角。',
    fr: 'Bords du papier détectés. Faites glisser les coins si ce n’est pas correct.',
  },
  CornersScreen_Could_not_find_the_paper_Drag_the_four_f60d0: {
    en: 'Could not find the paper. Drag the four corners onto its corners.',
    zh: '没找到纸张的边，请把四个角拖到纸张的四个角上。',
    fr: 'Papier introuvable. Faites glisser les quatre coins sur ceux du papier.',
  },
  CornersScreen_Drag_the_dots_9312c: {
    en: 'Drag the dots',
    zh: '拖动圆点调整',
    fr: 'Faites glisser les points',
  },
  CornersScreen_The_corners_are_crossed_7c433: {
    en: 'The corners are crossed',
    zh: '四个角的位置不对',
    fr: 'Les coins sont croisés',
  },
  CornersScreen_Detected_c1138: {
    en: 'Detected',
    zh: '自动找到的',
    fr: 'Détecté',
  },
  CornersScreen_Whole_photo_a2dee: {
    en: 'Whole photo',
    zh: '整张照片',
    fr: 'Photo entière',
  },
  FillFormScreen_Fill_in_form_5d701: {
    en: 'Fill in form',
    zh: '填写表单',
    fr: 'Remplir le formulaire',
  },
  FillFormScreen_has_fields_to_fill_in_Use_Latin_letter_e3442: {
    en: '{v0}.{v1} has {v2} fields to fill in. Use Latin letters, digits and common symbols.',
    zh: '{v0}.{v1} 有 {v2} 个可以填写的字段。只能填英文字母、数字和常用符号。',
    fr: '{v0}.{v1} comporte {v2} champs à remplir. Utilisez des lettres latines, des chiffres et des symboles courants.',
  },
  FillFormScreen_This_form_can_only_hold_Latin_letters__179fb: {
    en: 'This form can only hold Latin letters, digits and common symbols.',
    zh: '这个表单只能写英文字母、数字和常用符号。',
    fr: 'Ce formulaire n’accepte que des lettres latines, des chiffres et des symboles courants.',
  },
  PagesScreen_Pages_ab40b: {
    en: 'Pages ({v0})',
    zh: '整理页面（{v0} 页）',
    fr: 'Organiser les pages ({v0})',
  },
  PagesScreen_Page_e76ad: {
    en: 'Page {v0}',
    zh: '第 {v0} 页',
    fr: 'Page {v0}',
  },
  PagesScreen_Rotated_41854: {
    en: 'Rotated {v0}°',
    zh: '旋转 {v0}°',
    fr: 'Rotation de {v0}°',
  },
  PagesScreen_Restore_removed_a7e1a: {
    en: 'Restore {v0} removed',
    zh: '恢复删掉的 {v0} 页',
    fr: 'Restaurer {v0} pages supprimées',
  },
  ReorderScreen_Order_7c116: {
    en: 'Order',
    zh: '排序',
    fr: 'Ordre',
  },
  RecordEntryScreen_Save_0e67b: {
    en: 'Save',
    zh: '记下',
    fr: 'Enregistrer',
  },
  RecordEntryScreen_Attachment_9a7fe: {
    en: 'Attachment: {v0}.{v1}',
    zh: '附件：{v0}.{v1}',
    fr: 'Pièce jointe : {v0}.{v1}',
  },
  RecordEntryScreen_Skip_this_one_d0de1: {
    en: 'Skip this one',
    zh: '这一个不记，看下一个',
    fr: 'Passer celui-ci',
  },
  SignScreen_Signature_4843e: {
    en: 'Signature',
    zh: '签名',
    fr: 'Signature',
  },
  SignScreen_Next_aa103: {
    en: 'Next',
    zh: '下一步',
    fr: 'Suivant',
  },
  SignScreen_Use_a_saved_signature_56e73: {
    en: 'Use a saved signature',
    zh: '用存好的签名',
    fr: 'Utiliser une signature enregistrée',
  },
  SignScreen_Sign_below_ee862: {
    en: 'Sign below',
    zh: '在下面写你的签名',
    fr: 'Signez ci-dessous',
  },
  SignScreen_Clear_643ff: {
    en: 'Clear',
    zh: '重写',
    fr: 'Effacer',
  },
  SignScreen_Keep_for_next_time_on_this_device_only_e4001: {
    en: 'Keep for next time (on this device only)',
    zh: '存起来下次用（只存在这台设备上）',
    fr: 'Conserver pour la prochaine fois (sur cet appareil uniquement)',
  },
  SignScreen_Place_signature_f02ea: {
    en: 'Place signature',
    zh: '放签名',
    fr: 'Placer la signature',
  },
  SignScreen_Page_of_75351: {
    en: 'Page {v0} of {v1}',
    zh: '第 {v0} / {v1} 页',
    fr: 'Page {v0} sur {v1}',
  },
  SignScreen_S_c6a9b: {
    en: 'S',
    zh: '小',
    fr: 'P',
  },
  SignScreen_M_e9efc: {
    en: 'M',
    zh: '中',
    fr: 'M',
  },
  SignScreen_L_56d2b: {
    en: 'L',
    zh: '大',
    fr: 'L',
  },
  SignScreen_Drag_the_signature_to_move_it_f7c5b: {
    en: 'Drag the signature to move it',
    zh: '拖动签名调整位置',
    fr: 'Faites glisser la signature pour la déplacer',
  },
  CropScreen_Crop_007d5: {
    en: 'Crop',
    zh: '裁剪',
    fr: 'Recadrer',
  },
  CropScreen_Reset_efa10: {
    en: 'Reset',
    zh: '重置',
    fr: 'Réinitialiser',
  },
  PasswordScreen_Open_c5147: {
    en: 'Open',
    zh: '打开',
    fr: 'Ouvrir',
  },
  PasswordScreen_This_PDF_needs_a_password_to_open_Morp_31218: {
    en: 'This PDF needs a password to open. Morph saves a copy without the password; the original stays as it is.',
    zh: '这个 PDF 要密码才能打开。输入密码后会另存一份没有密码的，原文件不变。',
    fr: 'Ce PDF nécessite un mot de passe pour s’ouvrir. Morph enregistre une copie sans mot de passe ; l’original reste inchangé.',
  },
  PasswordScreen_That_password_is_wrong_Try_again_74476: {
    en: 'That password is wrong. Try again.',
    zh: '密码不对，请再试一次。',
    fr: 'Mot de passe incorrect. Réessayez.',
  },
  PasswordScreen_The_password_is_not_saved_9f226: {
    en: 'The password is not saved.',
    zh: '密码不会保存。',
    fr: 'Le mot de passe n’est pas enregistré.',
  },
  PasswordScreen_Skip_this_one_71a32: {
    en: 'Skip this one',
    zh: '跳过这一个',
    fr: 'Ignorer celui-ci',
  },
  ParamForm_Choose_a_data_table_first_b5c9a: {
    en: 'Choose a data table first',
    zh: '先选数据表',
    fr: 'Choisissez d’abord un tableau de données',
  },
  WorkflowEditor_Adjusted_the_quick_action_3c10b: {
    en: 'Adjusted the quick action “{v0}”',
    zh: '调整了快捷操作「{v0}」',
    fr: 'Action rapide « {v0} » ajustée',
  },
  WorkflowEditor_copy_04014: {
    en: ' copy',
    zh: ' 副本',
    fr: ' copie',
  },
  WorkflowEditor_Copied_the_quick_action_a4506: {
    en: 'Copied the quick action “{v0}”',
    zh: '复制了快捷操作「{v0}」',
    fr: 'Action rapide « {v0} » copiée',
  },
  WorkflowEditor_Add_a_step_here_ffc74: {
    en: '+ Add a step here',
    zh: '＋ 在这里加一步',
    fr: '＋ Ajouter une étape ici',
  },
  WorkflowEditor_Name_4406f: {
    en: 'Name',
    zh: '名称',
    fr: 'Nom',
  },
  WorkflowEditor_You_do_this_step_by_hand_when_it_runs_97fbe: {
    en: 'You do this step by hand when it runs.',
    zh: '运行时你在手机上操作这一步。',
    fr: 'Vous effectuez cette étape à la main à chaque exécution.',
  },
  WorkflowEditor_The_password_is_asked_on_every_run_and_8f613: {
    en: 'The password is asked on every run and never saved.',
    zh: '密码在每次运行时问，不会保存。',
    fr: 'Le mot de passe est demandé à chaque exécution et n’est jamais enregistré.',
  },
  WorkflowEditor_Ask_on_every_run_16477: {
    en: 'Ask on every run:',
    zh: '每次运行时问：',
    fr: 'Demander à chaque exécution :',
  },
  WorkflowEditor_Check_the_settings_of_this_step_c9b47: {
    en: 'Check the settings of this step.',
    zh: '请检查这一步的设置。',
    fr: 'Vérifiez les réglages de cette étape.',
  },
  WorkflowEditor_Save_82522: {
    en: 'Save',
    zh: '保存',
    fr: 'Enregistrer',
  },
  WorkflowEditor_Discard_1a93f: {
    en: 'Discard',
    zh: '放弃修改',
    fr: 'Abandonner',
  },
  WorkflowEditor_Run_5cab2: {
    en: 'Run',
    zh: '运行',
    fr: 'Exécuter',
  },
  WorkflowEditor_Duplicate_6da85: {
    en: 'Duplicate',
    zh: '复制',
    fr: 'Dupliquer',
  },
  WorkflowEditor_Put_on_Home_d5bc4: {
    en: 'Put on Home',
    zh: '放到首页',
    fr: 'Ajouter à l’accueil',
  },
  WorkflowEditor_Put_on_Home_69b25: {
    en: 'Put “{v0}” on Home',
    zh: '把「{v0}」放到了首页',
    fr: '« {v0} » ajouté à l’accueil',
  },
  WorkflowEditor_Reset_to_the_original_6cfe2: {
    en: 'Reset to the original',
    zh: '恢复成原来的样子',
    fr: 'Rétablir l’original',
  },
  WorkflowEditor_Reset_to_the_preset_567aa: {
    en: 'Reset “{v0}” to the preset',
    zh: '「{v0}」恢复预设',
    fr: 'Rétablir le préréglage de « {v0} »',
  },
  WorkflowEditor_Delete_8940a: {
    en: 'Delete',
    zh: '删除',
    fr: 'Supprimer',
  },
  WorkflowEditor_Deleted_the_quick_action_a2984: {
    en: 'Deleted the quick action “{v0}”',
    zh: '删除了快捷操作「{v0}」',
    fr: 'Action rapide « {v0} » supprimée',
  },
  WorkflowEditor_Add_a_step_40731: {
    en: 'Add a step',
    zh: '加一步',
    fr: 'Ajouter une étape',
  },
  WorkflowEditor_Cancel_bd576: {
    en: 'Cancel',
    zh: '取消',
    fr: 'Annuler',
  },
  WorkflowEditor_No_step_fits_here_303a6: {
    en: 'No step fits here.',
    zh: '这里没有能接上的步骤。',
    fr: 'Aucune étape ne peut suivre ici.',
  },
  PackGate_The_download_did_not_finish_Check_the__9d7b7: {
    en: 'The download did not finish ({v0}). Check the connection and try again.',
    zh: '下载没有完成（{v0}）。请检查网络后重试。',
    fr: 'Le téléchargement n’a pas abouti ({v0}). Vérifiez votre connexion et réessayez.',
  },
  PackGate_First_use_needs_a_download_3c1d7: {
    en: 'First use needs a {v0} download',
    zh: '首次使用需下载 {v0}',
    fr: 'La première utilisation nécessite le téléchargement de {v0}.',
  },
  PackGate_After_that_it_works_offline_Wi_Fi_is_r_77ca7: {
    en: 'After that it works offline. Wi-Fi is recommended.',
    zh: '之后不联网也能用。建议连接 Wi-Fi。',
    fr: 'Ensuite, vous pouvez l’utiliser hors connexion. Le Wi-Fi est recommandé.',
  },
  PackGate_License_ff05c: {
    en: 'License: {v0}',
    zh: '许可证：{v0}',
    fr: 'Licence : {v0}',
  },
  PackGate_Cancel_bd576: {
    en: 'Cancel',
    zh: '取消',
    fr: 'Annuler',
  },
  io_Add_which_existing_file_a4bbf: {
    en: 'Add which existing file?',
    zh: '加上哪个已有的文件？',
    fr: 'Ajouter quel fichier existant ?',
  },
  io_It_goes_together_with_this_run_s_files_03244: {
    en: 'It goes together with this run’s files.',
    zh: '会和这次的文件合在一起。',
    fr: 'Il sera regroupé avec les fichiers de ce traitement.',
  },
  io_Last_one_15660: {
    en: 'Last one: “{v0}”',
    zh: '上次的「{v0}」',
    fr: 'Dernier : « {v0} »',
  },
  io_Choose_one_in_Files_e6073: {
    en: 'Choose one in Files',
    zh: '从「文件」里选一个',
    fr: 'Choisir dans « Fichiers »',
  },
  io_Start_a_new_one_this_time_6e970: {
    en: 'Start a new one this time',
    zh: '这次新开一份',
    fr: 'En commencer un nouveau cette fois',
  },
  io_taken_af2cf: {
    en: '{v0} taken',
    zh: '已拍 {v0} 张',
    fr: '{v0} photos prises',
  },
  io_Take_another_1b43d: {
    en: 'Take another',
    zh: '再拍一张',
    fr: 'En prendre une autre',
  },
  io_Done_6f135: {
    en: 'Done',
    zh: '完成',
    fr: 'Terminé',
  },
  io_Recording_1a04e: {
    en: 'Recording {date:YYYY-MM-DD_HH.mm}',
    zh: '录音 {date:YYYY-MM-DD_HH.mm}',
    fr: 'Enregistrement {date:YYYY-MM-DD_HH.mm}',
  },
  more_Text_6ebbd: {
    en: 'Text',
    zh: '文字',
    fr: 'Texte',
  },
  more_Network_name_1c98e: {
    en: 'Network name',
    zh: '网络名',
    fr: 'Nom du réseau',
  },
  more_Password_8_63_characters_1c4be: {
    en: 'Password (8–63 characters)',
    zh: '密码（8–63 个字符）',
    fr: 'Mot de passe (8–63 caractères)',
  },
  more_QR_code_0d124: {
    en: 'QR code',
    zh: '二维码',
    fr: 'Code QR',
  },
  WorkflowsScreen_Needs_at_least_files_0ed9b: {
    en: 'Needs at least {v0} files',
    zh: '需要至少 {v0} 个文件',
    fr: 'Au moins {v0} fichiers requis',
  },
  WorkflowsScreen_Takes_at_most_files_0fe59: {
    en: 'Takes at most {v0} files',
    zh: '最多 {v0} 个文件',
    fr: 'Maximum {v0} fichiers',
  },
  WorkflowsScreen_Cannot_use_these_files_d0ca3: {
    en: 'Cannot use these files',
    zh: '不适用于这批文件',
    fr: 'Impossible d’utiliser ces fichiers',
  },
  WorkflowsScreen_Run_5cab2: {
    en: 'Run',
    zh: '运行',
    fr: 'Exécuter',
  },
  WorkflowsScreen_Edit_ef7c8: {
    en: 'Edit',
    zh: '编辑',
    fr: 'Modifier',
  },
  WorkflowsScreen_The_first_run_downloads_what_it_needs__3a8fa: {
    en: 'The first run downloads what it needs; it works offline afterwards.',
    zh: '首次使用需要下载一些内容，之后不联网也能用。',
    fr: 'La première utilisation télécharge les éléments nécessaires ; ensuite, vous pouvez l’utiliser hors connexion.',
  },
  WorkflowsScreen_What_Morph_can_do_8f4f4: {
    en: 'What Morph can do',
    zh: 'Morph 可以做什么',
    fr: 'Ce que Morph peut faire',
  },
  WorkflowsScreen_Make_your_own_quick_action_8bc98: {
    en: 'Make your own quick action',
    zh: '做一个自己的快捷操作',
    fr: 'Créer votre propre action rapide',
  },
  ChangeScreen_and_d40e9: {
    en: ' and ',
    zh: '和',
    fr: ' et ',
  },
  _layout_What_Morph_can_do_8f4f4: {
    en: 'What Morph can do',
    zh: 'Morph 可以做什么',
    fr: 'Ce que Morph peut faire',
  },
  _kind__Category_not_found_5faf2: {
    en: 'Category not found',
    zh: '找不到这个分类',
    fr: 'Catégorie introuvable',
  },
  _id__This_quick_action_no_longer_exists_35f5a: {
    en: 'This quick action no longer exists.',
    zh: '这个快捷操作已经不在了。',
    fr: 'Cette action rapide n’existe plus.',
  },
} satisfies Record<string, Localized>;

const dynamicMessages = {
  retry: {
    en: 'Retry',
    zh: '重试',
    fr: 'Réessayer',
  },
  sharedFilesReceived: {
    en: '{n} files received',
    zh: '收到 {n} 个文件',
    fr: '{n} fichiers reçus',
  },
  workflowFromTool: {
    en: 'This quick action comes with {name}. You can edit it; removing the tool also removes this action.',
    zh: '这个快捷操作来自「{name}」工具：可以修改，移除工具时会一起移除。',
    fr: 'Cette action rapide vient de l’outil « {name} ». Vous pouvez la modifier ; si vous retirez l’outil, elle est supprimée aussi.',
  },
  workflowInputRequired: {
    en: 'The first step has to pick photos or files, take text, or read entries.',
    zh: '第一步要选照片、选文件、输入文字或读取记录。',
    fr: 'La première étape doit être de choisir des photos ou fichiers, saisir un texte ou lire des entrées.',
  },
  workflowTypeMismatch: {
    en: 'This step doesn’t fit after the one before it.',
    zh: '这一步接不上前一步（类型不对）。',
    fr: 'Cette étape ne peut pas suivre la précédente : types incompatibles.',
  },
  pdfCompressionLimit: {
    en: '“{name}” can’t get under {target}',
    zh: '「{name}」压不到 {target}',
    fr: 'Impossible de réduire « {name} » sous {target}',
  },
  pdfCompressionChoice: {
    en: 'Keeping the text, the smallest is {got}. Turning the pages into pictures makes it smaller, but the text can no longer be selected or copied, and links and fillable fields stop working.',
    zh: '保留文字最多能压到 {got}。把每页转成图片能压得更小，但文字不能再选中、复制，链接和可以填写的表格也会失效。',
    fr: 'En conservant le texte, la taille minimale est {got}. Convertir les pages en images réduit davantage la taille, mais le texte ne peut plus être sélectionné ni copié, et les liens et champs à remplir ne fonctionnent plus.',
  },
  pdfTurnIntoPictures: {
    en: 'Turn into pictures',
    zh: '转成图片',
    fr: 'Convertir en images',
  },
  pdfKeepCurrent: {
    en: 'Keep the {got} one',
    zh: '就用 {got} 的',
    fr: 'Garder celui de {got}',
  },
  describeFieldChange: {
    en: '“{collection}” field “{name}”: {changes}',
    zh: '「{collection}」的字段「{name}」{changes}',
    fr: 'Champ « {name} » de « {collection} » : {changes}',
  },
  describePageIcon: {
    en: 'Page “{page}” icon → {icon}',
    zh: '页面「{page}」的图标{icon}',
    fr: 'Icône de la page « {page} » → {icon}',
  },
  describeNewIcon: {
    en: '{icon}',
    zh: '改为 {icon}',
    fr: '{icon}',
  },
  describeNoIcon: {
    en: 'none',
    zh: '去掉',
    fr: 'aucun',
  },
  describeStyleChange: {
    en: '{name} → {value}',
    zh: '{name}改为{value}',
    fr: '{name} → {value}',
  },
  describeHideComponent: {
    en: 'Hide {component}',
    zh: '隐藏{component}',
    fr: 'Masquer {component}',
  },
  describeShowComponent: {
    en: 'Show {component}',
    zh: '显示{component}',
    fr: 'Afficher {component}',
  },
  describeAddStep: {
    en: 'Add the step “{label}” to “{name}”{params}',
    zh: '「{name}」加一步「{label}」{params}',
    fr: 'Ajouter l’étape « {label} » à « {name} »{params}',
  },
  describeStepParameters: {
    en: ': {params}',
    zh: '：{params}',
    fr: ' : {params}',
  },
  describeUpdatedTool: {
    en: 'Update the {tool} tool: adds {names}; your changes are kept',
    zh: '更新「{tool}」工具：新增 {names}；你改过的内容保留',
    fr: 'Mettre à jour l’outil {tool} : ajoute {names} ; vos modifications sont conservées',
  },
  separatorList: {
    en: ', ',
    zh: '、',
    fr: ', ',
  },
  separatorComma: {
    en: ', ',
    zh: '，',
    fr: ', ',
  },
  separatorSemicolon: {
    en: '; ',
    zh: '；',
    fr: ' ; ',
  },
} satisfies Record<string, Localized>;

export const MESSAGES = { ...strings, ...extractedMessages, ...dynamicMessages };
export type StringKey = keyof typeof MESSAGES;

const SINGULAR_MESSAGES: Partial<Record<StringKey, Localized>> = {
  shareSummary: {
    en: '{n} file',
    zh: '{n} 个文件',
    fr: '{n} fichier',
  },
  sharePhotoSummary: {
    en: '{n} photo',
    zh: '{n} 张照片',
    fr: '{n} photo',
  },
  sharedFilesReceived: {
    en: '{n} file received',
    zh: '收到 {n} 个文件',
    fr: '{n} fichier reçu',
  },
  resultPages: {
    en: '{n} page',
    zh: '{n} 页',
    fr: '{n} page',
  },
  resultCount: {
    en: '{n} file',
    zh: '{n} 个文件',
    fr: '{n} fichier',
  },
  resultRecords: {
    en: '{n} entry',
    zh: '{n} 条记录',
    fr: '{n} entrée',
  },
  sharedPhotos: {
    en: '{n} photo',
    zh: '{n} 张照片',
    fr: '{n} photo',
  },
  sharedPdfs: {
    en: '{n} PDF',
    zh: '{n} 个 PDF',
    fr: '{n} PDF',
  },
  sharedOthers: {
    en: '{n} file',
    zh: '{n} 个文件',
    fr: '{n} fichier',
  },
  sharedVideos: {
    en: '{n} video',
    zh: '{n} 个视频',
    fr: '{n} vidéo',
  },
  sharedAudio: {
    en: '{n} audio file',
    zh: '{n} 个音频',
    fr: '{n} fichier audio',
  },
  shareInputStep: {
    en: 'Shared file ({n})',
    zh: '分享进来的文件（{n} 个）',
    fr: 'Fichier partagé ({n})',
  },
  audioMerged: {
    en: '{name} and {n} more',
    zh: '{name} 等 {n} 段',
    fr: '{name} et {n} autre',
  },
  draftCard: {
    en: 'You have a draft · {n} step',
    zh: '你有一份草稿 · {n} 步',
    fr: 'Vous avez un brouillon · {n} étape',
  },
  draftDropped: {
    en: 'The app changed since you left the draft; {n} step no longer fits and was removed.',
    zh: '离开草稿之后 App 又改过，有 {n} 步套不上了，已经去掉。',
    fr: 'L’app a changé depuis que vous avez quitté le brouillon ; {n} étape ne correspond plus et a été supprimée.',
  },
  draftDeleteBody: {
    en: 'The draft’s {n} step will be dropped. The app stays as it is.',
    zh: '草稿里的 {n} 步都会丢掉，App 不受影响。',
    fr: 'Le brouillon ({n} étape) sera supprimé. L’app ne change pas.',
  },
  describe_Also_removes_card_s_that_ran_this_quic_5d29f: {
    en: 'Also removes {v0} card that ran this quick action',
    zh: '同时移除 {v0} 个运行这个快捷操作的卡片',
    fr: 'Supprime aussi {v0} carte ayant exécuté cette action rapide',
  },
  describe_Also_removes_block_s_that_showed_a7a30: {
    en: 'Also removes {v0} block that showed “{v1}”',
    zh: '同时移除 {v0} 块显示「{v1}」的内容',
    fr: 'Supprime aussi {v0} bloc affichant « {v1} »',
  },
  describe_Also_removes_button_s_or_shortcut_s_th_d4dc1: {
    en: 'Also removes {v0} button or shortcut that opened “{v1}”',
    zh: '同时移除 {v0} 个指向「{v1}」的按钮或快捷入口',
    fr: 'Supprime aussi {v0} bouton ou raccourci ouvrant « {v1} »',
  },
  shareUsed: { en: 'Used {n} time', zh: '用过 {n} 次', fr: 'Utilisé {n} fois' },
  runDone: {
    en: 'Saved “{name}” ({pages} page)',
    zh: '已保存「{name}」（{pages} 页）',
    fr: '« {name} » enregistré ({pages} page)',
  },
  runError_tooFew: {
    en: 'Choose at least {min} file.',
    zh: '请至少选择 {min} 个文件。',
    fr: 'Choisissez au moins {min} fichier.',
  },
  runError_tooMany: {
    en: 'Choose at most {max} file.',
    zh: '最多选择 {max} 个文件。',
    fr: 'Choisissez au maximum {max} fichier.',
  },
  runError_tooLong: {
    en: '“{name}” is too long for a GIF (at most {seconds} second). Trim it first.',
    zh: '「{name}」太长了，做不成 GIF（最长 {seconds} 秒）。请先剪一段。',
    fr: '« {name} » est trop long pour un GIF (maximum {seconds} seconde). Coupez-le d’abord.',
  },
  packDeleteWithLanguages: {
    en: 'Its language is deleted too. You can download it again the next time you need it.',
    zh: '它的 {count} 种语言也会一起删除。下次用到时可以再下载。',
    fr: 'Sa langue sera aussi supprimée. Vous pourrez la télécharger à nouveau la prochaine fois que vous en aurez besoin.',
  },
  recordCount: { en: '{count} entry', zh: '{count} 条记录', fr: '{count} entrée' },
  deleteForeverConfirm: {
    en: 'Delete {count} entry of “{name}”? This can’t be undone.',
    zh: '永久删除「{name}」的全部 {count} 条记录？此操作无法撤销。',
    fr: 'Supprimer {count} entrée de « {name} » ? Cette action est irréversible.',
  },
  editPageSummary: {
    en: 'Edit “{page}” ({count} change)',
    zh: '编辑「{page}」（{count} 处修改）',
    fr: 'Modifier « {page} » ({count} modification)',
  },
  deleteGroupMessage: {
    en: 'The part inside it is deleted too. Cancel discards the whole edit; after saving you can still undo it.',
    zh: '里面的 {count} 块也会一起删除。点「取消」可以放弃这次编辑，保存后也能撤销。',
    fr: 'L’élément qu’il contient sera aussi supprimé. « Annuler » abandonne toute la modification ; après enregistrement, vous pourrez encore l’annuler.',
  },
  describe_Add_page_blocks_80d1f: {
    en: 'Add page “{v0}” ({v1} block)',
    zh: '新建页面「{v0}」（{v1} 块内容）',
    fr: 'Ajouter la page « {v0} » ({v1} bloc)',
  },
  html_records_3f794: { en: '{v0} entry', zh: '{v0} 条', fr: '{v0} entrée' },
  ShareScreen_Needs_at_least_files_0ed9b: {
    en: 'Needs at least {v0} file',
    zh: '需要至少 {v0} 个文件',
    fr: 'Au moins {v0} fichier requis',
  },
  ShareScreen_Takes_at_most_files_0fe59: {
    en: 'Takes at most {v0} file',
    zh: '最多 {v0} 个文件',
    fr: 'Maximum {v0} fichier',
  },
  RedactScreen_boxes_4d76c: { en: '{v0} box', zh: '{v0} 处', fr: '{v0} zone' },
  FillFormScreen_has_fields_to_fill_in_Use_Latin_letter_e3442: {
    en: '{v0}.{v1} has {v2} field to fill in. Use Latin letters, digits and common symbols.',
    zh: '{v0}.{v1} 有 {v2} 个可以填写的字段。只能填英文字母、数字和常用符号。',
    fr: '{v0}.{v1} comporte {v2} champ à remplir. Utilisez des lettres latines, des chiffres et des symboles courants.',
  },
  PagesScreen_Restore_removed_a7e1a: {
    en: 'Restore {v0} removed',
    zh: '恢复删掉的 {v0} 页',
    fr: 'Restaurer {v0} page supprimée',
  },
  io_taken_af2cf: { en: '{v0} taken', zh: '已拍 {v0} 张', fr: '{v0} photo prise' },
  WorkflowsScreen_Needs_at_least_files_0ed9b: {
    en: 'Needs at least {v0} file',
    zh: '需要至少 {v0} 个文件',
    fr: 'Au moins {v0} fichier requis',
  },
  WorkflowsScreen_Takes_at_most_files_0fe59: {
    en: 'Takes at most {v0} file',
    zh: '最多 {v0} 个文件',
    fr: 'Maximum {v0} fichier',
  },
  runError_noneMatched: {
    en: 'The file doesn’t meet the conditions of “Keep only some files”.',
    zh: '这个文件不满足「按条件筛选」的条件。',
    fr: 'Le fichier ne remplit pas les conditions de « Filtrer les fichiers ».',
  },
};

/** 哪个参数决定单复数（默认是 n）。 */
const PLURAL_COUNT_VARIABLE: Partial<Record<StringKey, string>> = {
  describe_Also_removes_card_s_that_ran_this_quic_5d29f: 'v0',
  describe_Also_removes_block_s_that_showed_a7a30: 'v0',
  describe_Also_removes_button_s_or_shortcut_s_th_d4dc1: 'v0',
  runDone: 'pages',
  runError_tooFew: 'min',
  runError_tooMany: 'max',
  runError_tooLong: 'seconds',
  packDeleteWithLanguages: 'count',
  recordCount: 'count',
  deleteForeverConfirm: 'count',
  editPageSummary: 'count',
  deleteGroupMessage: 'count',
  describe_Add_page_blocks_80d1f: 'v1',
  html_records_3f794: 'v0',
  ShareScreen_Needs_at_least_files_0ed9b: 'v0',
  ShareScreen_Takes_at_most_files_0fe59: 'v0',
  RedactScreen_boxes_4d76c: 'v0',
  FillFormScreen_has_fields_to_fill_in_Use_Latin_letter_e3442: 'v2',
  PagesScreen_Restore_removed_a7e1a: 'v0',
  io_taken_af2cf: 'v0',
  WorkflowsScreen_Needs_at_least_files_0ed9b: 'v0',
  WorkflowsScreen_Takes_at_most_files_0fe59: 'v0',
  runError_noneMatched: 'count',
};

/**
 * 是否用单数（CLDR 的 one）。手写而不用 Intl.PluralRules：App 的 Hermes 引擎没有它，调用会直接抛错。
 * 法语 0 和小于 2 的数是单数，英文只有 1，中文不分单复数。
 */
export function isSingular(locale: Locale, n: number): boolean {
  if (locale === 'fr') return n >= 0 && n < 2;
  if (locale === 'en') return n === 1;
  return false;
}

export function t(
  locale: Locale,
  key: StringKey,
  vars: Record<string, string | number> = {},
): string {
  const count = vars[PLURAL_COUNT_VARIABLE[key] ?? 'n'];
  const text =
    typeof count === 'number' && isSingular(locale, count)
      ? (SINGULAR_MESSAGES[key] ?? MESSAGES[key])
      : MESSAGES[key];
  // 不分组：版本号、年份这类数字不能写成「12 345」。
  return (text[locale] ?? text.en).replace(/\{(\w+)\}/g, (_, name: string) =>
    typeof vars[name] === 'number' && locale === 'fr'
      ? FRENCH_NUMBER.format(vars[name] as number)
      : String(vars[name] ?? `{${name}}`),
  );
}

const FRENCH_NUMBER = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 4,
  useGrouping: false,
});

/** 兼容工具定义中已有的英文/中文名称对；迁移完成前统一在此回退。 */
export function pairText(locale: Locale, pair: readonly [string, string]): string {
  return locale === 'zh' ? pair[1] : locale === 'fr' ? (FRENCH_PAIRS[pair[0]] ?? pair[0]) : pair[0];
}
