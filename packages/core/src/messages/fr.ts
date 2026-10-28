// 法语文案。键和 en.ts 完全一致（MessageTable）；单数写法（0 和 1 都用单数）在 frSingular，键和 enSingular 一致。
// 术语：记录 = entrée，数据表 = tableau，Morph 的设置页 = Paramètres，录音 = enregistrement。
import type { MessageTable, SingularTable } from './en';

export const fr: MessageTable = {
  trustNote:
    'Sans publicité. Aucun compte requis pour traiter vos fichiers. Le traitement reste sur votre appareil. L’IA reçoit votre demande et la configuration de l’application, jamais le contenu des fichiers ou des entrées.',
  resultContinue: 'Continuer le traitement',
  resultIncoming: 'Pour ces résultats : {what}',
  chainMake: 'Combiner en une action rapide',
  chainAbout: 'D’abord « {first} », puis « {second} »',
  chainSaveBuiltIn: '« {first} » et « {second} » enregistrées pour les combiner',
  chainRequest:
    'Créez une action rapide combinant ces deux actions dans cet ordre, sans sélectionner les fichiers à nouveau entre les deux.',

  openMedia: 'Ouvrir les photos',
  openFiles: 'Ouvrir les fichiers',
  filePickFailed: 'Impossible d’ouvrir le sélecteur. Réessayez.',
  shareRecent: 'Déjà utilisées',
  shareSuggested: 'Essayez l’une de ces actions',
  shareUsed: 'Utilisé {n} fois',
  shareDescribe: 'Décrire ce dont j’ai besoin',
  shareSeeAll: 'Tout voir ({n})',
  sharePicked: 'Fichiers sélectionnés : {what}',
  sharePlaceholder: 'Dites ce que vous voulez, Morph fera de son mieux pour y arriver',
  shareExpand: 'Voir les fichiers',
  shareCollapse: 'Masquer les fichiers',
  sharePreview: 'Aperçu',
  shareSummary: '{n} fichiers',
  sharePhotoSummary: '{n} photos',
  loading: 'Chargement…',
  bootFailed: 'L’espace de travail n’a pas pu être ouvert.',

  // 修改流程
  changeTitle: 'Modifier cette application',
  changeHint:
    'Décrivez ce que vous voulez modifier. Vous verrez un aperçu avant toute modification.',
  changePlaceholder: 'ex. : Texte plus grand et sans ombres',
  examples: 'Essayez :',
  pickStyle: 'Choisissez un style',
  preview: 'Aperçu',
  thinking: 'Modification en cours…',
  planTitle: 'Modifications prévues',
  before: 'Actuel',
  after: 'Après',
  apply: 'Appliquer cette modification',
  cancel: 'Annuler',
  undo: 'Annuler',
  close: 'Fermer',
  invalidPlan: 'Cette modification a été bloquée car elle casserait l’application :',
  previewFailed: 'Impossible d’afficher l’aperçu.',
  applied: 'Modifié : {summary}',
  conflict:
    'L’application a été modifiée pendant l’aperçu. Rien n’a été changé ; veuillez réessayer.',
  rolledBack:
    'La modification n’a pas pu être affichée. L’application est revenue à son état précédent.',
  recovered:
    'La dernière modification était endommagée. L’application est revenue à la dernière version qui fonctionnait.',
  noPrevious: 'Il n’y a plus de modification antérieure à annuler.',
  aiUnavailable:
    'Impossible de joindre le service IA. Aucune modification n’a été apportée ; veuillez réessayer plus tard.',
  aiRateLimited: 'Trop de requêtes en peu de temps. Veuillez patienter une minute, puis réessayer.',
  aiDailyLimit: 'La limite de requêtes IA d’aujourd’hui a été atteinte. Réessayez demain.',
  undoSummary: 'Annuler',

  // 改动记录（D-112）
  historyTitle: 'Historique des modifications',
  current: 'État actuel',
  restoreThis: 'Revenir à ce moment',
  restoreSummary: 'Retour à {when}',
  source_seed: 'Début',
  source_ai: 'Par l’IA',
  source_user: 'Par vous',
  source_restore: 'Retour en arrière',
  source_rollback: 'Annulé automatiquement',
  source_recovery: 'Corrigé automatiquement',
  initialSummary: 'L’app telle qu’installée',
  dateToday: 'Aujourd’hui à {time}',
  dateYesterday: 'Hier à {time}',

  // 工具目录
  toolsTitle: 'Outils',
  install: 'Ajouter',
  open: 'Ouvrir',
  installed: 'Ajouté',
  uninstall: 'Retirer',
  removeFromHome: 'Retirer de l’accueil',
  addToHome: 'Ajouter à l’accueil',
  installSummary: '{name} ajouté',
  uninstallSummary: '{name} retiré',
  uninstallTitle: 'Retirer {name} ?',
  removeCardSummary: '{name} retiré de l’accueil',
  addCardSummary: 'Ajouter {name} à l’accueil',
  // 下载的工具（D-177）
  toolDownloadSize: 'À télécharger : {size}',
  toolDownloading: 'Téléchargement en cours…',
  toolNeedsAppUpdate: 'Nécessite une version plus récente de cette app',
  toolRevoked: 'En pause',
  toolRevokedRun:
    '« {name} » est en pause pour le moment : cette action rapide ne peut pas s’exécuter. Réessayez plus tard.',
  toolDownloadFailedTitle: 'Impossible d’ajouter « {name} »',
  toolDownloadFailed: 'Le téléchargement a échoué. Vérifiez la connexion et réessayez.',
  toolDownloadRejected:
    'Le contenu téléchargé n’a pas passé le contrôle de sécurité ; rien n’a été modifié.',
  restoreNeedsTool:
    'Cette version utilise {names}, qui n’est pas sur ce téléphone. Ajoutez d’abord dans « Outils », puis restaurez.',
  listSeparator: ', ',
  toolDownloadedHint: 'Outil téléchargé depuis le catalogue Morph.',
  toolDeleteMessage: 'Vous pourrez le retélécharger plus tard depuis « Outils ».',
  toolDeleteAdded:
    'Cet outil est encore ajouté. Retirez-le d’abord dans « Outils », puis supprimez-le ici.',

  // 设置
  settingsTitle: 'Paramètres',
  thisApp: 'Cette app',
  general: 'Général',
  changeRowHint: 'Décrivez en une phrase comment modifier l’app',
  historyRowHint: 'Annuler une modification ou revenir à un état antérieur de l’app',
  toolsRowHint: 'Ajouter, ouvrir ou retirer des outils',
  openHistory: 'Historique des modifications',
  language: 'Langue',
  languageValue: 'Français (suit le système)',
  aiEngine: 'IA',
  aiEngineRemote: 'Claude via le serveur Morph',
  aiEngineMock: 'Règles intégrées (simulation hors ligne)',
  aiEngineByok: 'Ma propre clé API ({model})',

  // AI 设置
  aiSettingsTitle: 'AI',
  aiModeQuestion: 'Quelle IA modifie cette app',
  aiModeMock: 'Règles intégrées',
  aiModeMockNote: 'Hors ligne et gratuit. Ne comprend qu’un nombre fixe de formulations.',
  aiModeServer: 'Serveur Morph',
  aiModeServerNote: 'Claude via {url}.',
  // 测试期服务器保存请求（D-240）：只在用 Morph 服务器时显示。
  aiServerStoredNote:
    'Pendant la bêta, ce que vous dites à l’IA et la configuration de l’application sont enregistrés pour améliorer Morph. Les fichiers et les entrées ne sont jamais envoyés.',
  aiModeByok: 'Ma propre clé API',
  aiModeByokNote:
    'Appelle directement depuis ce téléphone le fournisseur de votre choix : Claude, ou toute API compatible OpenAI. L’usage est facturé sur votre compte chez ce fournisseur.',
  // 自带 key 的两种 provider（D-241）
  byokProviderLabel: 'Fournisseur',
  byokProviderAnthropic: 'Anthropic (Claude)',
  byokProviderAnthropicNote: 'Testé. Les instructions de Morph à l’IA sont réglées pour Claude.',
  byokProviderOpenAI: 'API compatible OpenAI',
  byokProviderOpenAINote:
    'OpenAI, OpenRouter, DeepSeek, Gemini, Groq, Ollama, LM Studio et d’autres. Non testé.',
  byokOtherWarning:
    'Morph est testé avec Claude. D’autres modèles peuvent plus souvent mal comprendre une demande ou la refuser. Chaque modification est toujours vérifiée avant d’être appliquée, et vous pouvez l’annuler.',
  byokSentNote:
    'Quand vous demandez une modification, ce que vous dites et la configuration de l’application sont envoyés à {host}. Vos fichiers et entrées ne sont jamais envoyés.',
  baseUrlLabel: 'URL de base',
  baseUrlPresets: 'Remplir l’adresse pour',
  customModelLabel: 'Nom du modèle',
  customModelPlaceholder: 'Tel qu’indiqué dans la documentation du fournisseur',
  saveEndpoint: 'Enregistrer l’adresse et le modèle',
  endpointSaved: 'Enregistré.',
  baseUrlInvalid: 'Saisissez une adresse complète, par exemple https://api.openai.com/v1.',
  baseUrlInsecure:
    'L’adresse doit commencer par https://. http:// ne fonctionne que pour localhost.',
  customModelMissing: 'Saisissez le nom du modèle.',
  otherKeyPlaceholder: 'Clé API (inutile pour les modèles locaux)',
  otherKeyFormatInvalid: 'Ce n’est pas une clé API valide (sans espaces, au moins 8 caractères).',
  otherKeyPrivacyNote:
    'La clé n’est enregistrée que dans le stockage sécurisé de ce téléphone (non synchronisée ni sauvegardée sur d’autres appareils) et n’est envoyée qu’à {host}. Changer l’adresse supprime la clé.',
  testOkOther: 'Connecté. L’adresse et la clé fonctionnent.',
  apiKeyLabel: 'API key',
  apiKeySaved: 'Enregistrée (se termine par {hint})',
  apiKeyPlaceholder: 'sk-ant-…',
  saveKey: 'Enregistrer la clé',
  deleteKey: 'Supprimer la clé',
  keyFormatInvalid: 'Ce n’est pas une clé API Claude valide (elle doit commencer par sk-ant-).',
  modelLabel: 'Modèle',
  perChange: 'environ ${cost} par modification',
  testConnection: 'Tester la connexion',
  testOk: 'Connecté. La clé fonctionne avec ce modèle.',
  keyPrivacyNote:
    'La clé n’est enregistrée que dans le stockage sécurisé de ce téléphone (non synchronisée ni sauvegardée sur d’autres appareils) et n’est envoyée qu’à api.anthropic.com. Définissez un plafond de dépenses dans la Claude Console.',

  byokNoKey: 'Ajoutez d’abord votre clé API Claude dans « Paramètres → IA ».',
  byokInvalidKey:
    'La clé API est invalide ou a été supprimée. Vérifiez-la dans « Paramètres → IA ».',
  byokPermission: 'Cette clé API n’est pas autorisée à utiliser le modèle sélectionné.',
  byokSpendLimit:
    'Votre plafond de dépenses dans la Claude Console est atteint. Aucune modification n’a été effectuée.',
  byokBusy:
    'Claude est occupé pour le moment. Aucune modification n’a été effectuée ; réessayez dans un instant.',
  byokModelNotFound:
    'Le modèle sélectionné est introuvable. Choisissez un autre modèle dans « Paramètres → IA ».',
  byokUnavailable:
    'Impossible de joindre l’API Claude. Aucune modification n’a été effectuée ; vérifiez la connexion et réessayez.',
  byokNoEndpoint:
    'Saisissez d’abord l’adresse du fournisseur et le nom du modèle dans « Paramètres → IA ».',
  byokOtherSpendLimit:
    'Votre compte chez ce fournisseur n’a plus de crédit ou a atteint son plafond de dépenses. Aucune modification n’a été effectuée.',
  byokOtherBusy:
    'Le fournisseur d’IA est occupé ou a rencontré une erreur. Aucune modification n’a été effectuée ; réessayez dans un instant.',
  byokOtherUnavailable:
    'Impossible de joindre le fournisseur d’IA, ou il n’a pas accepté la requête. Aucune modification n’a été effectuée ; vérifiez l’adresse, le nom du modèle et la connexion.',
  aiBadOutput:
    'La réponse de l’IA n’a pas pu être utilisée. Aucune modification n’a été effectuée ; reformulez votre demande.',
  about: 'À propos',
  aboutValue: 'Prototype Morph · AGPL-3.0 · schéma v{schema} · version #{revision}',

  // 页面组件
  noFiles: 'Aucun fichier pour l’instant',
  run: 'Démarrer',
  runAgain: 'Relancer',
  running: 'Étape {n} : {step}',
  runDone: '« {name} » enregistré ({pages} pages)',
  runCancelled: 'Annulé',
  share: 'Partager / exporter',
  ok: 'OK',
  shareInputStep: 'Fichiers partagés ({n})',
  shareGone: 'Ces fichiers ne sont plus disponibles. Veuillez les partager à nouveau.',
  runError_tooFew: 'Choisissez au moins {min} fichiers.',
  runError_tooMany: 'Choisissez au maximum {max} fichiers.',
  runError_wrongType: 'Format incompatible pour « {name} ». Format attendu : {kind}.',
  runError_invalidWorkflow:
    'Cette action rapide contient une étape incompatible. Ajustez ses réglages et réessayez.',
  runError_cameraUnavailable: 'L’appareil photo n’est pas disponible sur cet appareil.',
  runError_permissionDenied:
    'Morph a besoin de l’autorisation pour cette action ({what}). Vous pouvez l’accorder dans les Réglages du système.',
  runError_packFailed: 'Le téléchargement n’a pas abouti : {detail}',
  runError_targetNotMet:
    'Impossible de compresser « {name} » sous {target} (le minimum atteint est {got}).',
  runError_unsupportedText: 'Ce texte ne peut pas encore être inscrit dans le PDF : {name}',
  runError_badRange: 'Ces pages n’existent pas dans « {name} ».',
  runError_noFormFields: '« {name} » ne contient aucun formulaire à remplir.',
  runError_badField: 'Les données saisies pour « {name} » ne conviennent pas à ce champ.',
  runError_emptyText: 'Aucun texte à utiliser.',
  runError_passwordMissing: 'Aucun mot de passe saisi.',
  askPasswordMismatch: 'Les deux mots de passe ne correspondent pas.',
  askPasswordAgain: 'Confirmer le mot de passe',
  runError_textTooLong: 'Le texte est trop long (maximum {max} caractères).',
  runError_noRecords: 'Aucune entrée dans « {name} » pour cette période.',
  runError_doesNotFit:
    '« {name} » ne rentre pas sur ce papier. Utilisez d’abord l’étape « Photo d’identité » pour le recadrer au format.',
  runError_notFound: 'Rien trouvé dans « {name} ».',
  runError_tooLarge: '« {name} » dépasse {mb} Mo, ce qui n’est pas encore pris en charge.',
  runError_tooLargeTotal: 'Les fichiers sélectionnés dépassent {mb} Mo au total.',
  runError_unreadable: 'Impossible de lire « {name} ». Le fichier est peut-être endommagé.',
  runError_encrypted:
    '« {name} » est protégé par un mot de passe. Ajoutez d’abord l’étape « Supprimer le mot de passe PDF ».',
  runError_pdfRestricted:
    '« {name} » s’ouvre sans mot de passe, mais son auteur a restreint les modifications. Morph ne lève pas ces restrictions.',
  runError_pdfPasswordUnsupported:
    'Ce téléphone ne peut pas encore supprimer ni ajouter de mot de passe PDF (iPhone uniquement pour l’instant).',
  runError_accessDenied:
    'Impossible d’accéder à « {name} ». Vérifiez les autorisations et réessayez.',
  runError_saveFailed: 'Échec de l’enregistrement : {detail}',
  runError_folderNotWritable:
    'Impossible d’enregistrer les fichiers dans ce dossier. Choisissez un autre dossier et réessayez.',
  runError_noViewer: 'Aucune app de ce téléphone ne peut ouvrir ce fichier.',
  runError_previewFailed:
    'Impossible d’afficher l’aperçu de ce fichier. Les actions rapides ci-dessous restent disponibles.',
  runError_unsupportedAction: 'Étape non prise en charge : {action}',
  runError_unexpected: 'Une erreur s’est produite : {detail}',

  updateTool: 'Mettre à jour',
  updateSummary: '{name} mis à jour',

  // 运行页面
  runTitle: 'Exécuter',
  runCancel: 'Arrêter',
  runProgress: '{done} sur {total}',
  runItemImage: 'image {n} sur {total}',
  runItemFile: 'fichier {n} sur {total}',
  runFailedAt: 'Arrêté à l’étape {n}',
  runSucceeded: 'Terminé',
  runEdit: 'Ajuster les réglages',
  askTitle: 'Avant cette étape',
  askName: 'Nom du fichier',
  askInvalid: 'Veuillez vérifier : {detail}',
  resultSave: 'Enregistrer dans Fichiers',
  resultSaved: 'Enregistré',
  resultShare: 'Partager',
  resultPhotos: 'Enregistrer dans Photos',
  resultPhotosDone: 'Enregistré dans Photos',
  resultPrint: 'Imprimer',
  resultFolder: 'Enregistrer dans un dossier',
  resultFolderNamed: 'Enregistrer dans « {name} »',
  resultFolderDone: 'Enregistré dans « {name} »',
  resultFolderChange: 'Autre dossier',
  resultCopy: 'Copier',
  resultCopied: 'Copié',
  resultTextNote: 'Ce texte reste sur cet appareil.',
  resultPages: '{n} pages',
  resultCount: '{n} fichiers',
  homeEntry: 'Ajouter un raccourci sur la page d’accueil',
  notesTitle: 'Bon à savoir',
  workflowWhere: 'Vous le trouverez ensuite dans Outils → Actions rapides.',
  resultSmaller: 'Était {from}, désormais {to}',
  resultRecords: '{n} entrées',
  localDone: 'Terminé',
  localNext: 'Suivant',
  toolMissing: 'Cet outil n’est pas disponible.',
  workflowsTitle: 'Actions rapides',
  workflowsRowHint: 'Actions prêtes à l’emploi et vos propres actions en plusieurs étapes',
  packsTitle: 'Téléchargements',
  packsRowHint: 'Contenu téléchargé et espace utilisé',
  packsHint:
    'Certaines fonctions (redressement des photos, reconnaissance de texte dans d’autres langues, aperçu PDF) téléchargent ce dont elles ont besoin lors de la première utilisation. Elles fonctionnent ensuite hors connexion.',
  packsEmpty: 'Aucun téléchargement pour l’instant.',
  packsTotal: 'Occupe {size}',
  packDelete: 'Supprimer',
  packDeleteTitle: 'Supprimer « {name} » ?',
  packDeleteMessage:
    'Vous pourrez le télécharger à nouveau la prochaine fois qu’un outil en aura besoin.',
  packDeleteWithLanguages:
    'Ses {count} langues seront aussi supprimées. Vous pourrez les télécharger à nouveau la prochaine fois que vous en aurez besoin.',

  // 图片与链接
  imagePlaceholder: 'Touchez pour choisir une photo',
  imageTitle: 'Image',
  imageMissing: 'Cette image n’est pas sur cet appareil. Touchez pour en choisir une autre.',
  chooseImage: 'Choisir une autre photo',
  removeImage: 'Retirer la photo',
  setImageSummary: 'Définir une image',
  removeImageSummary: 'Retirer une image',
  imageTooLarge: 'Cette photo dépasse {mb} Mo.',
  fileSlotPlaceholder: 'Touchez pour choisir un fichier',
  fileSlotMissing: 'Ce fichier n’est pas sur cet appareil. Touchez pour en choisir un autre.',
  fileSlotFromPhotos: 'Depuis Photos',
  fileSlotFromFiles: 'Depuis Fichiers',
  fileSlotChoose: 'Choisir un fichier',
  fileSlotReplace: 'Remplacer le fichier',
  fileSlotRemove: 'Retirer le fichier',
  backdropSection: 'Image de fond',
  pageBackdropSection: 'Image de fond de la page',
  backdropChoose: 'Choisir une image',
  backdropReplace: 'Remplacer l’image',
  backdropRemove: 'Retirer l’image',
  backdropOff: 'Désactiver l’image de fond',
  backdropOverlayLabel: 'Voile sur l’image',
  fileSlotSection: 'Fichier',
  setFileSummary: 'Définir un fichier',
  removeFileSummary: 'Retirer un fichier',
  fileSlotTooLarge: 'Ce fichier dépasse {gb} Go.',
  fileSlotNoSpace: 'Pas assez d’espace libre sur ce téléphone pour garder une copie de ce fichier.',
  fileSlotCopyFailed: 'Impossible de copier ce fichier dans Morph.',
  openLinkTitle: 'Ouvrir le lien ?',
  openLinkMessage: 'Cela ouvrira {target} en dehors de l’application.',
  openLink: 'Ouvrir',

  // 用户数据
  noRecords: 'Aucune entrée pour l’instant',
  today: 'Aujourd’hui',
  yesterday: 'Hier',
  fieldRequired: 'Obligatoire',
  fieldInvalid: 'Format incorrect',
  fieldTooLong: 'Trop long',
  tableFull: 'Ce tableau est plein (10 000 entrées).',
  useFullForm:
    'Certains champs obligatoires ne figurent pas dans ce formulaire. Ouvrez le formulaire complet pour les ajouter.',
  recordDeleted: 'Enregistrement supprimé',
  newRecord: 'Nouvelle entrée',
  editRecord: 'Modifier l’entrée',
  save: 'Enregistrer',
  delete: 'Supprimer',
  tableMissing:
    'Ce tableau de données ne fait plus partie de l’application. Ses entrées sont conservées dans Paramètres → Données.',
  dataTitle: 'Données',
  storageTitle: 'Stockage',
  storageRowHint: 'Photos et fichiers conservés par Morph, et où ils servent',
  storageSummary: '{n} fichiers · {size}',
  storageEmpty:
    'Morph n’a encore aucun fichier enregistré. Les photos et fichiers ajoutés aux entrées, aux emplacements de fichier et aux images sont conservés ici.',
  storageIntro:
    'Les fichiers que Morph garde sur ce téléphone et où ils sont utilisés. Vous seul voyez cette page.',
  storageCleanup: 'Nettoyer {n} fichiers inutilisés ({size})',
  storageCleanupTitle: 'Supprimer {n} fichiers inutilisés ?',
  storageCleanupMessage:
    'Ils occupent {size}. Aucune entrée, page ni composant ne les utilise. Les fichiers utilisés seulement par d’anciennes versions sont aussi supprimés : restaurer ces versions ne les fera pas revenir. Les résultats enregistrés par les actions rapides ne sont pas concernés. Action irréversible.',
  storageUsedInRecord: '{table} · {title}',
  storageUsedInDeletedRecord: '{table} · {title} (supprimée récemment)',
  storageUsedInComponent: '{page} · {component}',
  storageUsedAsBackdrop: '{page} · image de fond',
  storageTableGone: 'Tableau retiré',
  storageOldVersionsOnly: 'Utilisé seulement par d’anciennes versions',
  storageUnused: 'Utilisé nulle part',
  storageQuickActionResult: 'Enregistré par une action rapide',
  storageKindImage: 'Photo',
  storageKindVideo: 'Vidéo',
  storageKindAudio: 'Audio',
  storageKindPdf: 'PDF',
  storageKindOther: 'Fichier',
  storagePreview: 'Aperçu',
  storageDeleteTitle: 'Supprimer « {name} » ?',
  storageDeleteUsed:
    'Il est utilisé à {n} endroits. Ils indiqueront que le fichier n’existe plus, et restaurer une ancienne version ne le fera pas revenir. Action irréversible.',
  storageDeleteUnused:
    'Restaurer une ancienne version ne le fera pas revenir. Action irréversible.',
  dataRowHint:
    'Vos données : exporter, supprimées récemment, configuration de l’app, mémoire de pré-remplissage',
  dataPrivacy:
    'Les entrées sont stockées uniquement sur ce téléphone. L’IA ne voit que la structure de vos tableaux (noms et champs), jamais ce que vous saisissez.',
  dataTables: 'Tableaux de données',
  unusedTables: 'Données hors de l’application',
  unusedTablesHint:
    'Tableaux retirés de l’application. Leurs entrées reviennent si vous revenez, dans l’historique des modifications, à une époque où ce tableau existait.',
  recentlyDeleted: 'Supprimés récemment',
  recentlyDeletedHint: 'Conservé pendant 30 jours, puis supprimé définitivement.',
  recordCount: '{count} entrées',
  exportCsv: 'Exporter en CSV',
  deleteForever: 'Supprimer définitivement',
  deleteForeverConfirm:
    'Supprimer toutes les {count} entrées de « {name} » ? Cette action est irréversible.',
  restore: 'Restaurer',
  nothingDeleted: 'Aucune suppression récente',
  unknownTable: 'Tableau {id}',
  pageMissing: 'Cette page n’existe plus.',
  // Paramètres → Données : export de la configuration, mémoire de pré-remplissage (D-244)
  appConfigTitle: 'Configuration de l’app',
  appConfigHint:
    'Pages, structure des tableaux, actions rapides et rappels, dans un seul fichier. Vos entrées et vos fichiers n’y sont pas.',
  exportAppConfig: 'Exporter la configuration de l’app',
  prefillMemoryTitle: 'Mémoire de pré-remplissage',
  prefillMemoryHint:
    'Quand vous ajoutez une entrée, Morph retient la mise en page des documents enregistrés : après quelle étiquette se trouve une valeur, à peu près sur quelle ligne, et le nom du commerce. Les montants et les dates ne sont pas conservés. Stockée uniquement sur ce téléphone, jamais envoyée à l’IA. Le fichier exporté sert aussi de sauvegarde : « Restaurer depuis un fichier » la remet en place.',
  prefillMemoryCount: '{count} mises en page de documents mémorisées',
  prefillMemoryNone: 'Aucune mise en page mémorisée pour l’instant',
  prefillMemoryExport: 'Exporter',
  prefillMemoryRestore: 'Restaurer depuis un fichier',
  prefillMemoryClear: 'Effacer',
  prefillMemoryClearConfirm:
    'Effacer toute la mémoire de pré-remplissage ? Morph devra tout réapprendre. Cette action est irréversible.',
  prefillMemoryRestoreConfirm:
    'Remplacer la mémoire de pré-remplissage actuelle par celle de ce fichier ({count} mises en page) ?',
  prefillMemoryRestoreInvalid:
    'Ce fichier n’est pas une mémoire de pré-remplissage exportée par Morph. Rien n’a été restauré.',
  prefillMemoryRestored: '{count} mises en page restaurées.',
  dataModelDownloadAsk: 'Télécharger la reconnaissance des dates et des montants ?',
  dataModelDownloadBody:
    'Google doit d’abord télécharger le modèle de reconnaissance pour cette langue. La reconnaissance se fait sur ce téléphone et le texte n’est pas envoyé ; après le téléchargement, elle fonctionne hors ligne. Sans ce modèle, Morph pré-remplit quand même avec ses propres règles.',
  dataModelDownload: 'Télécharger',

  // 直接编辑（长按一块、调整顺序）
  editText: 'Modifier le texte',
  editColor: 'Couleur',
  editAlign: 'Alignement',
  editSize: 'Taille',
  tone_default: 'Par défaut',
  tone_primary: 'Principale',
  tone_secondary: 'Secondaire',
  tone_tertiary: 'Tertiaire',
  tone_muted: 'Grise',
  align_start: 'À gauche',
  align_center: 'Centré',
  size_small: 'Petit',
  size_medium: 'Moyen',
  size_large: 'Grand',
  moveUp: 'Monter',
  moveDown: 'Descendre',
  arrange: 'Réorganiser',
  hide: 'Masquer',
  show: 'Afficher',
  hiddenTag: 'Masqué',
  done: 'Terminé',
  edit: 'Modifier',
  editPage: 'Modifier la page',
  editHint:
    'Touchez un bloc pour le modifier, maintenez ≡ pour le déplacer, touchez « Terminé » une fois fini.',
  discardEditTitle: 'Abandonner vos modifications ?',
  discardEditMessage: 'Les modifications faites en mode édition ne seront pas conservées.',
  keepEditing: 'Continuer la modification',
  discard: 'Abandonner',
  tooManyEdits:
    'Il y a trop de modifications à la fois. Touchez « Terminé » pour les enregistrer, puis continuez la modification.',
  editPageSummary: 'Modifier « {page} » ({count} modifications)',
  groupLabel: 'Groupe',
  field_title: 'Titre',
  field_subtitle: 'Sous-titre',
  field_text: 'Texte',
  field_label: 'Texte du bouton',
  field_caption: 'Légende',
  field_hint: 'Indication avant le choix d’un fichier',
  field_placeholder: 'Indication avant le choix d’une photo',
  optional: 'facultatif',
  richTextHint:
    '**gras**, *italique*, [lien](https://…), les lignes commençant par - deviennent une liste',
  textRequired: 'Ne peut pas être vide',
  deleteComponentTitle: 'Supprimer {label} ?',
  deleteComponentMessage:
    '« Annuler » abandonne toute la modification ; après enregistrement, vous pourrez encore l’annuler.',
  deleteGroupMessage:
    'Les {count} éléments qu’il contient seront aussi supprimés. « Annuler » abandonne toute la modification ; après enregistrement, vous pourrez encore l’annuler.',
  deleteDataMessage:
    'Vos entrées sont conservées (Paramètres → Données). « Annuler » abandonne toute la modification ; après enregistrement, vous pourrez encore l’annuler.',
  // AI 只改 App（D-113、D-124–D-130）
  readyTitle: 'Votre action rapide est prête',
  readyRunNow: 'L’utiliser maintenant',
  readyLater: 'Pas maintenant',
  readyHome: 'Un raccourci est aussi disponible sur l’accueil : appuyez dessus la prochaine fois.',
  askAIChange: 'Demander à l’IA de la modifier',
  readyFix: 'Pas tout à fait ? Demander à l’IA de la modifier',
  aboutWorkflow: 'Action rapide à modifier : « {name} »',
  aboutWorkflowHint: 'Dites comment la modifier, ou essayez l’un des exemples ci-dessous.',
  aboutPlaceholder: 'Par exemple : {example}',
  aboutShared: 'Fichiers partagés : {what}',
  sharedPhotos: '{n} photos',
  sharedPdfs: '{n} PDF',
  sharedOthers: '{n} fichiers',
  habitTitle: 'Souvent utiliser « {value} » ?',
  habitBody:
    'Créer une action rapide « {name} » sur l’accueil : un seul appui la prochaine fois, sans rien demander.',
  habitMake: 'Créer',
  habitNo: 'Non merci',
  habitMade: '« {name} » ajouté à l’accueil',

  // ---- 翻译（D-170–D-176）：错误说明拼进「不支持这个步骤：…」/「需要的内容没有下载好：…」 ----
  translateNeedsFullApp:
    'Traduire (disponible dans la version complète de Morph, pas dans cet aperçu)',
  translateOsTooOld: 'Traduire (nécessite iOS 18 ou une version ultérieure)',
  translatePairUnsupported: 'Traduction de {from} vers {to} impossible sur ce téléphone',
  translateDownloadAsk: 'Le premier usage nécessite le téléchargement d’environ {mb} Mo',
  translateDownloadBody:
    'Langues de traduction : {langs}. Ensuite, la traduction fonctionne hors connexion. Le Wi-Fi est conseillé.',
  translateDownload: 'Télécharger',
  translateDownloadFailed: 'les fichiers de langue {langs} (vérifiez la connexion, puis réessayez)',
  translateLanguageTitle: 'Langue de traduction : {name}',
  translateLanguageHint: 'Environ 30 Mo, pour traduire sur cet appareil (Google ML Kit).',
  translateDeleteMessage:
    'Il vous sera à nouveau proposé de le télécharger la prochaine fois que vous traduirez cette langue.',
  translateNote:
    'Traduit sur l’appareil : utile pour comprendre le sens. Pour les documents officiels, faites appel à un traducteur professionnel.',
  // ---- 视频、音频和压缩 PDF（D-140–D-148）。音频工具的文字请另起一块，方便合并。----
  runPercent: '{done}%',
  runError_needsFullApp:
    'Les vidéos et les fichiers audio ne peuvent être traités que dans la version complète de Morph, pas dans cet aperçu.',
  subtitlesNeedApp:
    'L’export des sous-titres avec horodatage nécessite une version à jour de l’application Morph.',
  subtitlesNote:
    'Ce sont des fichiers SRT séparés. Ouvrez-les avec la vidéo d’origine dans un lecteur ou un éditeur compatible. Vérifiez le texte et la synchronisation ; les sous-titres ne sont pas intégrés à l’image.',
  annotateTitle: 'Annoter la photo',
  annotateText: 'Texte',
  annotateArrow: 'Flèche',
  annotateBox: 'Cadre',
  annotatePen: 'Stylo',
  annotateColor: 'Couleur {n}',
  annotateTextHint: 'Saisissez un court libellé',
  annotateTap:
    'Saisissez un libellé, puis appuyez sur la photo pour le placer. Annulez pour remplacer une marque.',
  annotateDrag: 'Faites glisser sur la photo pour dessiner. Annulez pour remplacer une marque.',
  annotateCount: '{n}/100 marques',
  annotateUndo: 'Annuler une',
  imageAdjustmentNeedsApp:
    'La retouche de photo nécessite une version à jour de l’application Morph.',
  backgroundNeedsSystem:
    'Supprimer l’arrière-plan nécessite iOS 17 ou une version ultérieure, ou Android avec les services Google Play.',
  backgroundDownload: 'Télécharger',
  backgroundDownloadAsk: 'Télécharger la suppression de l’arrière-plan ?',
  backgroundDownloadBody:
    'Les services Google Play doivent d’abord télécharger un modèle. Les photos restent sur cet appareil. Après le téléchargement, le traitement fonctionne hors connexion.',
  backgroundDownloadFailed:
    'Le modèle de suppression de l’arrière-plan n’a pas pu être téléchargé. Vérifiez votre connexion et les services Google Play, puis réessayez.',
  runError_backgroundFailed:
    'Impossible de supprimer l’arrière-plan de « {name} ». Essayez une photo nette avec un sujet bien distinct.',
  runError_mediaUnsupported:
    '« {name} » ne peut pas être ouvert : format non pris en charge ou protégé contre la copie.',
  runError_mergeUnsupported:
    'Impossible d’assembler ces vidéos. Convertissez d’abord chacune en MP4, puis réessayez.',
  runError_notEnoughSpace: 'Espace insuffisant sur ce téléphone. Il faut environ {gb} Go en plus.',
  runError_targetTooSmall:
    'À {target}, « {name} » serait trop flou pour être regardé. Il faut au moins {mb} Mo, ou le couper plus court d’abord.',
  runError_interrupted:
    'Morph est passé en arrière-plan, le traitement n’a donc pas abouti. Restez dans Morph et appuyez sur « Relancer ».',
  // 长任务切到后台也继续（D-160–D-162）：运行页的提示，Android 通知栏的进度和完成通知。
  runCanLeave:
    'Vous pouvez passer à une autre application ; Morph continue de travailler en arrière-plan.',
  runStayInMorph: 'Restez dans Morph pendant le traitement.',
  bgPreparing: 'Préparation…',
  bgStep: 'Étape {n} sur {total} : {step}',
  bgDoneTitle: '« {name} » est terminé',
  bgDoneBody: 'Appuyez ici pour voir le résultat.',
  bgFailedTitle: '« {name} » n’a pas abouti',
  bgFailedBody: 'Touchez pour voir ce qui s’est passé.',
  mediaPlay: 'Lire',
  mediaDuration: '{duration}',
  frameTitle: 'Choisissez une image',
  frameDone: 'Conserver cette image',
  frameHint: 'Touchez la ligne de temps, puis ajustez l’heure pour choisir une image.',
  trimTitle: 'Couper',
  trimOf: '{n} sur {total}',
  trimHint: 'Faites glisser les deux poignées pour choisir la partie à conserver.',
  trimStart: 'Démarrer',
  trimEnd: 'Fin',
  trimLength: '{length} conservé',
  trimPlaySelection: 'Lire ce passage seulement',
  trimPause: 'Pause',
  trimDone: 'Terminé',
  trimNext: 'Suivant',
  sharedVideos: '{n} vidéos',
  sharedAudio: '{n} fichiers audio',

  // AI 修改的草稿（D-190）
  draftDropped:
    'L’app a changé depuis que vous avez quitté le brouillon ; {n} étapes ne correspondent plus et ont été supprimées.',
  draftFirstStep:
    'C’est la première étape du brouillon. Pour le supprimer entièrement, effacez-le depuis la page « Modifier cette app ».',
  draftEdit: 'Modifier',
  draftBack: 'Revenir en arrière',
  draftApply: 'Appliquer',
  draftLeave: 'Quitter',
  draftLocked: 'Ceci est un brouillon. Appliquez-le pour l’utiliser.',
  draftReplyTitle: 'C’est fait, voici le nouveau rendu',
  draftChatTitle: 'Modifier le brouillon',
  draftChatClose: 'Masquer',
  draftChatPlaceholder: 'Dites-en un peu plus…',
  draftSteppedBack: 'Retour d’une étape effectué.',
  draftCard: 'Vous avez un brouillon · {n} étapes',
  draftCardHint:
    'Les modifications d’apparence que vous demandez poursuivent ce brouillon ; les actions rapides, les outils et les tableaux de données prennent effet immédiatement.',
  draftContinue: 'Continuer',
  draftDelete: 'Supprimer',
  draftDeleteTitle: 'Supprimer ce brouillon ?',
  draftDeleteBody: 'Les {n} étapes du brouillon seront abandonnées. L’App ne change pas.',
  send: 'Envoyer',
  changeAsk: 'Que faut-il changer ? Une phrase suffit',
  pickStyleChip: 'Choisir un style',
  draftRenderFailed: 'La dernière modification n’a pas pu s’afficher, elle a donc été annulée.',

  // 功能和外观分开改（D-191）
  draftNoFunction:
    'Le brouillon ne modifie que l’apparence. Les actions rapides, les outils et les tableaux de données se modifient sur la page « Modifier cette App » : les changements prennent effet immédiatement et peuvent être annulés.',
  draftNoFunctionGo: 'Passer par « Modifier cette App »',
  functionNeedsDraft:
    'Cette modification nécessite un élément de votre brouillon. Appliquez d’abord le brouillon, puis redites-le.',
  nextTitle: 'Continuer à modifier',
  nextHint:
    'Le reste de votre demande modifie l’apparence : touchez pour voir le résultat d’abord dans un brouillon.',
  tableReadyTitle: 'Votre tableau de données est prêt',
  tableReadyRecord: 'Ajouter une entrée',
  tableReadyWhere:
    'Les entrées restent sur cet appareil. Vous pouvez aussi voir le tableau dans « Paramètres → Données ».',

  // 新手引导（D-149）
  guideSkip: 'Passer',
  guideNext: 'Suivant',
  guideStart: 'Démarrer',
  // 划屏介绍：每页一张图配一句话。
  guideIntro1:
    'Votre propre application. Changez son apparence en une phrase, comme bon vous semble.',
  guideIntro2: 'Dites une seule phrase et toute l’application prend un nouveau look.',
  guideIntro3: 'Ce qui demandait plusieurs étapes se fait d’un seul appui.',
  guideIntro4: 'À vous de jouer. Décrivez votre idée en une phrase.',
  guideIntroMiniTitle: 'Ma journée',
  guideIntroStyleAsk: 'Style néon',
  guideIntroBefore: 'Avant',
  guideIntroBeforeCount: '5 étapes · 2 applis',
  guideIntroOld1: 'Ouvrir Photos',
  guideIntroOld2: 'Choisir des photos',
  guideIntroOld3: 'Compresser dans une autre app',
  guideIntroOld4: 'Renommer',
  guideIntroOld5: 'Partager',
  guideIntroNow: 'Envoyer des photos de voyage à des amis',
  guideIntroAsk: 'Je veux…',
  guideIntroIdea1: 'Mettre la page d’accueil en bleu foncé',
  guideIntroIdea2: 'Ajouter un suivi de l’eau',
  guideIntroIdea3: 'Transformer des captures d’écran en PDF',
  guideLookTitle: 'Étape 1',
  guideLookBody: 'L’app est vide pour l’instant. Commencez par ajouter deux boutons.',
  guideGoalTitle: 'Étape 2',
  guideGoalBody:
    'Cette app simplifie les tâches fastidieuses sur les fichiers. Ouvrez les images ou les fichiers à traiter.',
  guideLater: 'Plus tard',
  guideSkipAll: 'Passer le guide',
  // 引导第 3 步：样板 App（D-260）。
  guideSamplesTitle: 'Étape 3',
  guideSamplesBody:
    'Vous pouvez aussi faire de Morph votre propre app. Choisissez-en une pour essayer.',
  sampleDraftInput: 'Utiliser l’app modèle « {name} »',
  sampleReadyTitle: '« {name} » est prête',
  sampleReadyBody: 'Pour l’adapter à vos besoins, demandez à l’IA de continuer à la modifier.',
  sampleReadyChange: 'Modifier avec l’IA',
  sampleReadyDismiss: 'Compris',
  sampleFailed: 'Impossible d’ajouter cette app modèle. Essayez-en une autre.',
  sampleContinuePrompt: 'En partant de « {name} », modifier ceci : ',
  settingsGuide: 'Revoir le guide',
  settingsGuideHint: 'Présentation et deux petits exercices',
  // ---- 音频工具（D-150–D-156，音频会话）----
  runError_audioTooSmall:
    'À {target}, la voix de « {name} » serait trop difficile à entendre. Il faut au moins {mb} Mo, ou la couper plus court d’abord.',
  runError_noAudio: '« {name} » n’a pas de son.',
  // ---- 格式转换的缺口（D-183–D-186）----
  runError_formatUnsupported:
    '« {name} » est un fichier {format} que ce téléphone ne peut pas ouvrir. Convertissez-le d’abord en MP4 sur un ordinateur.',
  // ---- 需求回收（D-189）----
  needSend: 'Dites-nous que vous en avez besoin',
  needRetry: 'Non envoyé. Réessayez',
  needSent:
    'Merci, c’est noté. Les nouveaux outils arriveront avec les mises à jour et les téléchargements.',
  needPrivacy: 'Seule cette phrase est envoyée à Morph — ni fichiers, ni entrées, ni réglages.',
  needsSettingTitle: 'Proposer d’envoyer les demandes que l’IA ne sait pas traiter',
  needsSettingNote:
    'Affiche un bouton sous la réponse. Rien n’est envoyé sans que vous appuyiez dessus.',
  // ---- 记一笔、附件和公式字段（D-187、D-188）----
  noAttachment: 'Aucune pièce jointe',
  attachmentMissing: 'Le fichier a été supprimé',
  removeAttachment: 'Retirer',
  attachmentAdd: 'Ajouter des photos ou des fichiers',
  attachmentTakePhoto: 'Prendre une photo',
  attachmentMoveUp: 'Monter',
  attachmentMoveDown: 'Descendre',
  attachmentsFull: '{n} fichiers au maximum',
  runError_documentUnsupported:
    '« {name} » est un fichier {format}. Sur ce téléphone, seuls les documents Word (.docx) peuvent être convertis en PDF.',
  runError_tooLong:
    '« {name} » est trop long pour un GIF (maximum {seconds} secondes). Coupez-le d’abord.',
  runError_noSpeech: 'Aucune parole n’a été entendue dans « {name} ».',
  speechLangUnsupported: 'Ce téléphone ne peut pas reconnaître {lang} sur l’appareil.',
  speechUnavailable:
    'La reconnaissance vocale ne fonctionne pas sur cet appareil (simulateur ou système trop ancien).',
  speechDownloadAsk: 'La reconnaissance de {lang} nécessite d’abord un téléchargement',
  speechDownloadBody:
    'Le modèle vocal provient d’Apple. Ensuite, il fonctionne sans connexion Internet.',
  speechDownload: 'Télécharger',
  speechDownloadFailed: 'le modèle vocal pour {lang}',
  speechNote:
    'Reconnaissance effectuée sur cet appareil : des mots peuvent être erronés, surtout en cas de bruit ou d’accent. Vérifiez le texte.',
  // ---- 文字转语音（D-270）：错误说明拼进「不支持这个步骤：…」----
  speakNoVoice:
    'lecture à voix haute ({lang}) : ce téléphone n’a pas de voix pour cette langue ; ajoutez-en une dans les réglages du téléphone (iPhone : Accessibilité → Contenu énoncé → Voix ; Android : Synthèse vocale)',
  speakNotDownloaded:
    'lecture à voix haute ({lang}) : la voix n’est pas encore téléchargée ; téléchargez-la dans les réglages du téléphone, sous Synthèse vocale, puis réessayez',
  speakNoEngine:
    'lecture à voix haute : ce téléphone n’a pas de moteur de synthèse vocale ; installez-en ou activez-en un, par exemple Services de reconnaissance et de synthèse vocales de Google',
  speakLanguageUnknown:
    'lecture à voix haute : la langue du texte n’a pas été reconnue ; choisissez-la dans cette étape',
  audioMerged: '{name} et {n} autres',
  trimWaveformLoading: 'Lecture de la forme d’onde…',
  trimRingtone:
    'Sur Android, vous pouvez ensuite choisir le fichier enregistré comme sonnerie dans Paramètres → Sons ; une app iPhone ne peut pas définir de sonnerie.',
  recordTitle: 'Enregistrer',
  recordMicrophone: 'Microphone',
  recordFailed:
    'Le microphone est indisponible pour le moment (une autre application l’utilise peut-être). Réessayez.',
  recordStart: 'Commencer l’enregistrement',
  recordPause: 'Pause',
  recordResume: 'Reprendre',
  recordDone: 'Terminé',
  recordHint:
    'L’enregistrement continue lorsque l’écran se verrouille. Appuyez sur « Terminer » une fois fini.',
  recordDiscardTitle: 'Supprimer cet enregistrement ?',
  recordDiscard: 'Supprimer',
  recordKeep: 'Continuer l’enregistrement',
  // 按条件筛选（D-242）
  runError_noneMatched:
    'Aucun des {count} fichiers ne remplit les conditions de « Filtrer les fichiers ».',
  // 分组后各出一份（D-243）
  groupUndated: 'Sans date',

  // 命名用识别出的文字（D-244）
  runError_needsRecognition:
    'Ce nom de fichier utilise du texte reconnu dans le fichier, et cet appareil ne peut pas reconnaître le texte lui-même. Utilisez l’app Morph complète, ou retirez cette partie du nom.',
  // 统计按选项分组（D-248）
  statNoChoice: 'Non renseigné',
  // 图表（D-249）
  describeChart: 'graphique « {v0} »',
  // D-254：更新的 App 加的组件，这个版本不认识，原样保留。
  describeUnknownComponent: 'contenu d’une version plus récente de cette app',
  unknownComponent:
    'Une version plus récente de cette app est nécessaire pour afficher ce contenu.',
  chartOther: 'Autres',
  chartEmpty: 'Aucune entrée à afficher pour l’instant',
  chartPoint: '{label} : {value}',
  chartShare: '{value} ({percent})',
  // 表和表之间引用（D-250）
  linkDeleted: 'Entrée supprimée',
  linkNone: 'Aucun lien',
  linkChoose: 'Choisir…',
  linkSearch: 'Rechercher',
  linkClear: 'Retirer le lien',
  linkEmptyTable: '« {name} » ne contient encore aucune entrée.',
  // 提醒（D-251）
  describeAddReminder: 'Ajouter le rappel « {title} » ({when})',
  describeUpdateReminder: 'Modifier le rappel « {title} »',
  describeRemoveReminder: 'Retirer le rappel « {title} »',
  // 手机桌面（D-271）
  describeHomeScreenOn:
    'Mettre « {name} » sur l’écran d’accueil du téléphone : appuyez longuement sur l’icône Morph pour la voir',
  describeHomeScreenOff: 'Retirer « {name} » de l’écran d’accueil du téléphone',
  homeScreenTitle: 'Sur l’écran d’accueil du téléphone',
  homeScreenIos:
    'Appuyez longuement sur l’icône Morph sur l’écran d’accueil pour voir « {name} ». Touchez-la pour la lancer tout de suite.',
  homeScreenAndroid:
    'Appuyez longuement sur l’icône Morph pour voir « {name} », ou donnez-lui sa propre icône sur l’écran d’accueil.',
  homeScreenPin: 'Ajouter à l’écran d’accueil',
  homeScreenPinFailed:
    'Cet écran d’accueil ne peut pas ajouter l’icône. Appuyez longuement sur l’icône Morph à la place.',
  homeScreenAdd: 'Mettre sur l’écran d’accueil',
  homeScreenRemove: 'Retirer de l’écran d’accueil',
  homeScreenAdded: '« {name} » ajoutée à l’écran d’accueil',
  homeScreenRemoved: '« {name} » retirée de l’écran d’accueil',
  homeScreenFull:
    'Le menu de l’écran d’accueil contient au plus 4 actions rapides. Retirez-en une d’abord.',
  homeScreenGone: 'Cette action rapide n’est plus sur l’écran d’accueil.',
  describeRemovedReminders: 'Retire aussi les rappels qui en dépendaient : {names}',
  reminderWhenDaily: 'tous les jours à {time}',
  reminderWhenWeekly: 'chaque {days} à {time}',
  reminderWhenDate: '{n} jours avant « {field} » dans « {table} », à {time}',
  weekday1: 'lundi',
  weekday2: 'mardi',
  weekday3: 'mercredi',
  weekday4: 'jeudi',
  weekday5: 'vendredi',
  weekday6: 'samedi',
  weekday7: 'dimanche',
  reminderDueToday: 'Une entrée de « {table} » arrive à échéance aujourd’hui',
  reminderDueIn: 'Une entrée de « {table} » arrive à échéance dans {n} jours ({date})',
  remindersTitle: 'Rappels',
  remindersHint:
    'Les rappels sont des notifications sur cet appareil. En toucher un ouvre seulement la page ou l’action rapide ; rien ne s’exécute tout seul. Pour ajouter ou modifier un rappel, demandez à l’IA (par exemple « rappelle-moi tous les jours à 9 h de noter mes dépenses »).',
  remindersNone: 'Aucun rappel pour l’instant',
  remindersOff:
    'Les notifications de Morph sont désactivées. Activez-les dans les Réglages du système pour recevoir les rappels.',
  reminderRemove: 'Retirer',
  reminderOpenTitle: 'Depuis votre rappel',
  reminderOpenRun: 'Démarrer',
  // D-256：按钮、快捷入口打开的快捷操作（只摆出来，用户点「开始」才运行）。
  openQuickActionTitle: 'Action rapide',
  openQuickActionMissing: 'Cette action rapide n’est plus dans l’app.',
  reminderOpenMissing: 'L’action rapide de ce rappel n’est plus dans l’app.',
  remindersRowHint: '{n} rappels',
  // 样板 App（D-260）：放不下时不套用，说明原因。
  sampleTooManyTables:
    '« {name} » a besoin de nouveaux tableaux, mais l’app approche de la limite de 20. Supprimez les tableaux inutiles, puis réessayez.',
  sampleTooManyPages:
    '« {name} » a besoin de nouvelles pages, mais l’app approche de la limite de 20. Supprimez les pages inutiles, puis réessayez.',
  sampleTooManyWorkflows:
    '« {name} » a besoin de nouvelles actions rapides, mais l’app approche de la limite de 100. Supprimez celles que vous n’utilisez plus, puis réessayez.',
  sampleTooManyReminders:
    '« {name} » a besoin de nouveaux rappels, mais l’app approche de la limite de 20. Supprimez des rappels dans Paramètres → Rappels, puis réessayez.',
  sampleHomeFull:
    '« {name} » a besoin d’une place sur l’accueil, mais il est plein. Retirez un élément de l’accueil, puis réessayez.',

  // ==== 从界面代码里抽出来的文案（键名是「文件_英文开头_哈希」） ====
  planner_This_request_can_t_be_handled_Try_desc_04270:
    'Cette demande ne peut pas être traitée. Essayez de décrire comment vous voulez modifier l’application.',
  prompt_English_fafbe: 'French',
  describe_header_455aa: 'en-tête « {v0} »',
  describe_description_text_fccd4: 'texte de description',
  describe_tool_card_80198: 'carte d’outil {v0}',
  describe_Open_photo_library_47a7e: 'Ouvrir la photothèque',
  describe_Open_files_3477c: 'Ouvrir les fichiers',
  describe_tool_grid_e987a: 'grille d’outils « {v0} »',
  describe_tool_grid_1c74f: 'grille d’outils',
  describe_link_941e3: 'lien « {v0} »',
  describe_file_list_a11dd: 'liste de fichiers « {v0} »',
  describe_quick_action_list: 'liste d’actions rapides',
  describe_quick_action_list_kind: 'liste d’actions rapides « {v0} »',
  describe_quick_action_1fb38: 'action rapide « {v0} »',
  describe_button_d79ee: 'bouton « {v0} »',
  describe_shortcut_b2616: 'raccourci « {v0} »',
  describeFileSlot: 'emplacement de fichier « {v0} »',
  describe_notice_f50d5: 'encadré',
  describe_image_d5072: 'image « {v0} »',
  describe_image_df755: 'image',
  describe_divider_7fe10: 'séparateur',
  describe_spacer_9a646: 'espacement',
  describe_list_0b528: 'liste des entrées « {v0} »',
  describe_form_f4ef1: 'formulaire d’ajout « {v0} »',
  describe_stat_c1587: 'statistique « {v0} »',
  describe_stacked_00ce0: 'empilé',
  describe_row_be7f8: 'en ligne',
  describe_grid_3f0e7: 'en grille',
  describe__5caf2: ' « {v0} »',
  describe_group_86cab: 'groupe {v0}{v1}',
  describe__41054: '{v0} → {v1}',
  describe_light_57222: 'clair',
  describe_dark_12552: 'sombre',
  describe_system_84963: 'système',
  describe_Background_639fc: 'Arrière-plan',
  describe_Card_color_cb523: 'Couleur des cartes',
  describe_Text_color_af4a8: 'Couleur du texte',
  describe_Secondary_color_844c7: 'Couleur secondaire',
  describe_Tertiary_color_dec1a: 'Couleur tertiaire',
  describe__441c2: '« {v0} »',
  describe_on_43dea: '{v0} sur « {v1} »',
  describe_Add_data_table_f79c6: 'Ajouter le tableau de données « {v0} » ({v1})',
  describe_Rename_data_table_to_c585f: 'Renommer le tableau de données « {v0} » en « {v1} »',
  describe_Change_the_icon_of_9c456: 'Changer l’icône de « {v0} »',
  describe_Add_field_to_b8810: 'Ajouter le champ « {v0} » ({v1}) à « {v2} »',
  describe_rename_to_08deb: 'renommer en « {v0} »',
  describe_type_7382b: 'type → {v0}',
  describe_options_64e79: 'options → {v0}',
  describe_update_settings_2aaf6: 'Modifier les réglages',
  describe_Move_field_of_to_position_aa798:
    'Déplacer le champ « {v0} » de « {v1} » en position {v2}',
  describe_Hide_field_of_existing_data_is_kept_4f9d1:
    'Masquer le champ « {v0} » de « {v1} » (les données existantes sont conservées)',
  describe_Remove_data_table_from_the_app_records_1a3d2:
    'Retirer le tableau de données « {v0} » de l’application (les entrées sont conservées, consultables et exportables dans Paramètres → Données)',
  describe_Theme_color_8ee07: 'Couleur du thème → {v0}',
  describe_Appearance_b422e: 'Apparence → {v0}',
  describe_Dark_mode_74033: 'Mode sombre ',
  describe_dark_color: '{v0} (mode sombre)',
  describe_default_82b64: '{v0} → par défaut',
  describe__072d2: '{v0} → {v1}',
  describe_Switch_the_style_to_colors_fonts_corne_60590:
    'Passer au style « {v0} » (couleurs, polices, coins arrondis, cartes et arrière-plan)',
  describe_Reset_the_style_to_the_default_colors__162af:
    'Réinitialiser le style par défaut (couleurs, polices, coins arrondis, espacements)',
  describe_Navigation_was_7f9d5: 'Navigation → {v0} (était : {v1})',
  describe_Remove_all_floating_buttons_0029b: 'Supprimer tous les boutons flottants',
  describe_Floating_buttons_d071d: 'Boutons flottants → {v0}',
  describe_Add_page_blocks_80d1f: 'Ajouter la page « {v0} » ({v1} blocs)',
  describe_Remove_page_files_are_not_affected_5abad:
    'Supprimer la page « {v0} » (les fichiers ne sont pas affectés)',
  describe_Rename_page_to_5e2cc: 'Renommer la page « {v0} » en « {v1} »',
  describe_Move_to_position_in_7eb22: 'Déplacer {v0} en position {v1} dans {v2}',
  describe_new_picture_bf924: 'nouvelle image',
  describeNewFile: 'nouveau fichier',
  describeFileRemoved: 'fichier retiré',
  describe_picture_removed_4fb32: 'image supprimée',
  describe_removed_d5c25: 'Suppression : {v0}',
  describe_Update_75049: 'Modifier {v0} : {v1}',
  describe_default_9ef5c: 'par défaut',
  describe_Restyle_0b6e5: 'Changer l’apparence de {v0} : {v1}',
  describe_Add_to_f2026: 'Ajouter {v0} à {v1}',
  describe_Remove_from_c2717: 'Retirer {v0} de « {v1} »',
  describe_Add_the_tool_adds_its_page_7a595: 'Ajouter l’outil « {v0} » : ajoute sa page',
  describe_Add_the_tool_adds_its_page_and_a_home__ec774:
    'Ajouter l’outil « {v0} » : ajoute sa page et une carte à l’accueil',
  describe_Remove_the_tool_removes_its_card_page__2fb97:
    'Retirer l’outil « {v0} » : supprime sa carte, sa page et ses actions rapides ; vos fichiers sont conservés',
  describe__3ca25: '« {v0} » – {v1} : {v2}',
  describe_Update_c2f66: 'Modifier les réglages de « {v0} » – {v1}',
  describe_asks_for_on_every_run_708a8: '« {v0} » demande {v1} à chaque exécution',
  describe_no_longer_asks_it_uses_the_saved_setti_a3369:
    '« {v0} » – {v1} ne demande plus ; les réglages enregistrés sont utilisés',
  describe_ready_made_61047: ' (prêt à l’emploi)',
  describe_New_quick_action_b4026: 'Nouvelle action rapide « {v0} »{v1} : {v2}',
  describe_Delete_the_quick_action_files_are_kept_deaf1:
    'Supprimer l’action rapide « {v0} » (les fichiers sont conservés)',
  describe_Rename_the_quick_action_to_e45a1: 'Renommer l’action rapide « {v0} » en « {v1} »',
  describe_Move_to_step_in_885bf: 'Dans « {v2} », déplacer « {v0} » à l’étape {v1}',
  describe_Rename_to_decb3: 'Renommer l’action rapide « {v0} » en « {v1} »',
  describe_Steps_of_591ff: 'Étapes de « {v0} » : {v1}',
  describe_Remove_step_from_8750c: 'Dans « {v1} », retirer l’étape « {v0} »',
  describe_can_t_be_removed_it_holds_the_AI_and_C_e58da:
    '« {v0} » ne peut pas être retiré (il contient les entrées IA et Historique des modifications), il devient donc un bouton flottant',
  describe_Update_the_tool_to_the_latest_version__b20b4:
    'Mettre à jour l’outil « {v0} » vers la dernière version ; vos modifications sont conservées',
  describe_Also_removes_card_s_that_ran_this_quic_5d29f:
    'Supprime aussi {v0} cartes ayant exécuté cette action rapide',
  describe_Also_removes_block_s_that_showed_a7a30: 'Supprime aussi {v0} blocs affichant « {v1} »',
  describe_Also_removes_button_s_or_shortcut_s_th_d4dc1:
    'Supprime aussi {v0} boutons ou raccourcis ouvrant « {v1} »',
  describe_Go_back_to_when_happened_pages_navigat_cbdc3:
    'Revenir à l’état du moment de « {v0} » : pages, navigation, thème et actions rapides reviennent à ce qu’ils étaient alors',
  describe_The_tool_s_card_and_quick_actions_will_a857b:
    'La carte et les actions rapides de l’outil « {v0} » seront supprimées ; ses fichiers, utilisés et générés, sont conservés ; il suffit de l’ajouter à nouveau pour continuer à l’utiliser',
  describe_The_tool_comes_back_205fb: 'L’outil « {v0} » réapparaît',
  describe_The_table_leaves_the_app_its_entries_s_29282:
    'Le tableau « {v0} » quitte l’application ; ses entrées restent dans Paramètres → Données et reviendront avec lui',
  describe_The_table_comes_back_dd301: 'Le tableau « {v0} » réapparaît',
  describe_Your_files_and_entries_are_not_affecte_c87ef:
    'Vos fichiers et entrées ne sont pas affectés',
  describe_Your_files_are_not_affected_3c83c: 'Vos fichiers ne sont pas affectés',
  data_attachments: '{n} pièces jointes',
  data_Yes_1f54e: 'Oui',
  data_No_04a4b: 'Non',
  data_Created_1626a: 'Création',
  starter_Toolbox_802f3: 'Boîte à outils',
  starter_Manage_tools_f1487: 'Gérer les outils',
  defaults_Home_ec133: 'Accueil',
  defaults_My_workspace_df4a5: 'Mon espace de travail',
  defaults_Tap_AI_and_describe_how_this_app_shoul_7d958:
    'Touchez « IA » et décrivez en une phrase comment cette app doit changer.',
  defaults_Add_tools_9c8e1: 'Ajouter des outils',
  defaults_Recent_files_2d602: 'Fichiers récents',
  presets_ID_photo_20f6d: 'Photo d’identité {date}',
  presets_Documents_4ee07: 'Documents {date}',
  presets_Scan_5b295: 'Numérisation {date}',
  presets_combined_7b1c7: '{sourceName}-fusionné',
  presets_Receipt_d832a: 'Reçu {date}',
  presets_Expenses_427ff: 'Dépenses {date:YYYY-MM}',
  presets_Photos_c2260: 'Photos {date}',
  presets_English_2d0eb: '{sourceName}-anglais',
  presets_Translation_38e12: 'Traduction {date}',
  presets_English_fe3af: 'Anglais {date}',
  presets_Recording_cd46f: 'Enregistrement {date}',
  presets_Voice_memo_d1e75: 'Mémo vocal {date:YYYY-MM-DD_HH.mm}',
  presets_Switch_to_the_style_aedda: 'Passer au style {v0}',
  audio_Audio_2bfdb: 'Audio',
  audio_Audio_tools_ca3ac: 'Outils audio',
  audio_Everything_runs_on_this_device_nothing_de468:
    'Tout s’exécute sur cet appareil ; rien n’est envoyé. Le texte reconnu peut contenir des erreurs : vérifiez-le.',
  audio_Audio_files_185dc: 'Fichiers audio',
  video_Video_19238: 'Vidéo',
  video_Video_tools_632fd: 'Outils vidéo',
  video_Everything_runs_on_this_device_nothing_d4b96:
    'Tout s’exécute sur cet appareil ; rien n’est envoyé.',
  video_Videos_0f33c: 'Vidéos',
  image_HEIC_to_JPG_64d8f: 'HEIC vers JPG',
  image_Copy_49a2a: 'Copie',
  image_ID_photos_to_print_5dd87: 'Photos d’identité à imprimer',
  image_Images_edfbd: 'Images',
  image_Image_tools_2d55f: 'Outils image',
  image_Everything_runs_on_this_device_Results_3f5b4:
    'Tout s’exécute sur cet appareil. Les résultats ne sont enregistrés que lorsque vous appuyez sur Enregistrer dans Fichiers.',
  more_ZIP_files_d8402: 'Fichiers ZIP',
  more_Files_0e973: 'Fichiers {date}',
  more_ZIP_photos_b72f4: 'Photos en ZIP',
  more_Photos_c2260: 'Photos {date}',
  more_Unzip_cc21e: 'Décompresser',
  more_Make_a_QR_code_7011a: 'Créer un code QR',
  more_Wi_Fi_QR_code_12af4: 'Code QR Wi-Fi',
  more_Read_a_QR_code_df393: 'Lire un code QR',
  more_Text_to_PDF_ac970: 'Texte en PDF',
  scan_Scan_5b295: 'Numérisation {date}',
  scan_Scanner_08f22: 'Numériser',
  scan_Everything_runs_on_this_device_nothing_09e42:
    'Tout s’exécute sur cet appareil ; rien n’est envoyé. La numérisation utilise le scanneur de documents intégré au système ; pour redresser des photos existantes, certains appareils doivent télécharger des éléments la première fois (ensuite, cela fonctionne hors ligne).',
  scan_Scans_7ac9d: 'Numérisations',
  ocr_Text_recognition_fe569: 'Reconnaissance de texte',
  ocr_Runs_on_this_device_the_text_is_never__38fca:
    'S’exécute sur cet appareil ; le texte n’est jamais envoyé. Le modèle de reconnaissance de texte (environ 30 Mo) est téléchargé à la première utilisation ; le coréen, le russe et le vietnamien utilisent la reconnaissance intégrée au téléphone ou un téléchargement séparé.',
  html_Created_1626a: 'Création',
  html_Updated_74f0c: 'Modifié',
  html_records_3f794: '{v0} entrées',
  html_Total_08322: 'Total',
  pdf_merged_19094: '{sourceName}-fusionné',
  pdf_COPY_3fef3: 'COPIE',
  pdf_PDF_tools_d81ee: 'Outils PDF',
  pdf_Everything_runs_on_this_device_nothing_d4b96:
    'Tout s’exécute sur cet appareil ; rien n’est envoyé.',
  pdf_PDF_files_2d348: 'Fichiers PDF',
  translate_Translate_6c51b: 'Traduire',
  translate_Translates_on_this_device_the_text_is__027c8:
    'Traduction sur cet appareil ; le texte n’est jamais envoyé. Utile pour comprendre le sens ; pour les documents officiels, faites appel à un traducteur professionnel. La première utilisation d’une langue peut nécessiter un téléchargement.',
  format_on_7f2b0: 'activé',
  format_off_4b193: 'désactivé',
  format_report_25207: 'rapport',
  format_e_g_248d5: ' (par ex. {v0})',
  format_your_text_6c667: '(votre texte)',
  ShareScreen_Shared_with_Morph_bb8fe: 'Partagé avec Morph',
  ShareScreen_Morph_only_takes_files_photos_PDFs_and_91f45:
    'Morph n’accepte que les fichiers (photos, PDF, etc.), pas le texte ni les liens.',
  ShareScreen_Close_59a26: 'Fermer',
  ShareScreen_just_made_ed6c1: ' · à l’instant',
  ShareScreen_Run_5cab2: 'Exécuter',
  ShareScreen_Needs_at_least_files_0ed9b: 'Au moins {v0} fichiers requis',
  ShareScreen_Takes_at_most_files_0fe59: 'Maximum {v0} fichiers',
  ShareScreen_Files_are_handled_on_this_device_only__c8099:
    'Les fichiers sont traités uniquement sur cet appareil ; l’IA ne voit jamais leurs noms ni leur contenu.',
  workflow_change_Delete_e4208: 'Supprimer « {v0} » ?',
  workflow_change_Your_files_are_kept_You_can_undo_this_e9492:
    'Vos fichiers sont conservés. Vous pouvez annuler cette action.',
  workflow_change_Delete_8940a: 'Supprimer',
  RedactScreen_Hide_parts_9ca8f: 'Masquer des zones',
  RedactScreen_Drag_to_draw_boxes_over_names_numbers__e780a:
    'Faites glisser pour tracer des cadres sur les noms, numéros ou tout ce qui est privé.',
  RedactScreen_boxes_4d76c: '{v0} zones',
  RedactScreen_Undo_791a7: 'Annuler une',
  CornersScreen_Adjust_corners_44eed: 'Ajuster les coins',
  CornersScreen_Found_the_edges_of_the_paper_Drag_the__2c34c:
    'Bords du papier détectés. Faites glisser les coins si ce n’est pas correct.',
  CornersScreen_Could_not_find_the_paper_Drag_the_four_f60d0:
    'Papier introuvable. Faites glisser les quatre coins sur ceux du papier.',
  CornersScreen_Drag_the_dots_9312c: 'Faites glisser les points',
  CornersScreen_The_corners_are_crossed_7c433: 'Les coins sont croisés',
  CornersScreen_Detected_c1138: 'Détecté',
  CornersScreen_Whole_photo_a2dee: 'Photo entière',
  FillFormScreen_Fill_in_form_5d701: 'Remplir le formulaire',
  FillFormScreen_has_fields_to_fill_in_Use_Latin_letter_e3442:
    '{v0}.{v1} comporte {v2} champs à remplir. Utilisez des lettres latines, des chiffres et des symboles courants.',
  FillFormScreen_This_form_can_only_hold_Latin_letters__179fb:
    'Ce formulaire n’accepte que des lettres latines, des chiffres et des symboles courants.',
  PagesScreen_Pages_ab40b: 'Organiser les pages ({v0})',
  PagesScreen_Page_e76ad: 'Page {v0}',
  PagesScreen_Rotated_41854: 'Rotation de {v0}°',
  PagesScreen_Restore_removed_a7e1a: 'Restaurer {v0} pages supprimées',
  ReorderScreen_Order_7c116: 'Ordre',
  RecordEntryScreen_Save_0e67b: 'Enregistrer',
  RecordEntryScreen_Attachment_9a7fe: 'Pièce jointe : {v0}.{v1}',
  RecordEntryScreen_Skip_this_one_d0de1: 'Passer celui-ci',
  SignScreen_Signature_4843e: 'Signature',
  SignScreen_Next_aa103: 'Suivant',
  SignScreen_Use_a_saved_signature_56e73: 'Utiliser une signature enregistrée',
  SignScreen_Sign_below_ee862: 'Signez ci-dessous',
  SignScreen_Clear_643ff: 'Effacer',
  SignScreen_Keep_for_next_time_on_this_device_only_e4001:
    'Conserver pour la prochaine fois (sur cet appareil uniquement)',
  SignScreen_Place_signature_f02ea: 'Placer la signature',
  SignScreen_Page_of_75351: 'Page {v0} sur {v1}',
  SignScreen_S_c6a9b: 'P',
  SignScreen_M_e9efc: 'M',
  SignScreen_L_56d2b: 'L',
  SignScreen_Drag_the_signature_to_move_it_f7c5b: 'Faites glisser la signature pour la déplacer',
  CropScreen_Crop_007d5: 'Recadrer',
  CropScreen_Reset_efa10: 'Réinitialiser',
  PasswordScreen_Open_c5147: 'Ouvrir',
  PasswordScreen_This_PDF_needs_a_password_to_open_Morp_31218:
    'Ce PDF nécessite un mot de passe pour s’ouvrir. Morph enregistre une copie sans mot de passe ; l’original reste inchangé.',
  PasswordScreen_That_password_is_wrong_Try_again_74476: 'Mot de passe incorrect. Réessayez.',
  PasswordScreen_The_password_is_not_saved_9f226: 'Le mot de passe n’est pas enregistré.',
  PasswordScreen_Skip_this_one_71a32: 'Ignorer celui-ci',
  ParamForm_Choose_a_data_table_first_b5c9a: 'Choisissez d’abord un tableau de données',
  WorkflowEditor_Adjusted_the_quick_action_3c10b: 'Action rapide « {v0} » ajustée',
  WorkflowEditor_copy_04014: ' copie',
  WorkflowEditor_Copied_the_quick_action_a4506: 'Action rapide « {v0} » copiée',
  WorkflowEditor_Add_a_step_here_ffc74: '＋ Ajouter une étape ici',
  WorkflowEditor_Name_4406f: 'Nom',
  WorkflowEditor_You_do_this_step_by_hand_when_it_runs_97fbe:
    'Vous effectuez cette étape à la main à chaque exécution.',
  WorkflowEditor_The_password_is_asked_on_every_run_and_8f613:
    'Le mot de passe est demandé à chaque exécution et n’est jamais enregistré.',
  WorkflowEditor_Ask_on_every_run_16477: 'Demander à chaque exécution :',
  WorkflowEditor_Check_the_settings_of_this_step_c9b47: 'Vérifiez les réglages de cette étape.',
  WorkflowEditor_Save_82522: 'Enregistrer',
  WorkflowEditor_Discard_1a93f: 'Abandonner',
  WorkflowEditor_Run_5cab2: 'Exécuter',
  WorkflowEditor_Duplicate_6da85: 'Dupliquer',
  WorkflowEditor_Put_on_Home_d5bc4: 'Ajouter à l’accueil',
  WorkflowEditor_Put_on_Home_69b25: '« {v0} » ajouté à l’accueil',
  WorkflowEditor_Reset_to_the_original_6cfe2: 'Rétablir l’original',
  WorkflowEditor_Reset_to_the_preset_567aa: 'Rétablir le préréglage de « {v0} »',
  WorkflowEditor_Delete_8940a: 'Supprimer',
  WorkflowEditor_Deleted_the_quick_action_a2984: 'Action rapide « {v0} » supprimée',
  WorkflowEditor_Add_a_step_40731: 'Ajouter une étape',
  WorkflowEditor_Cancel_bd576: 'Annuler',
  WorkflowEditor_No_step_fits_here_303a6: 'Aucune étape ne peut suivre ici.',
  PackGate_The_download_did_not_finish_Check_the__9d7b7:
    'Le téléchargement n’a pas abouti ({v0}). Vérifiez votre connexion et réessayez.',
  PackGate_First_use_needs_a_download_3c1d7:
    'La première utilisation nécessite le téléchargement de {v0}.',
  PackGate_After_that_it_works_offline_Wi_Fi_is_r_77ca7:
    'Ensuite, vous pouvez l’utiliser hors connexion. Le Wi-Fi est recommandé.',
  PackGate_License_ff05c: 'Licence : {v0}',
  PackGate_Cancel_bd576: 'Annuler',
  packOptionalHint: 'Vous pouvez aussi continuer sans ; cette étape s’en passe simplement.',
  packSkip: 'Continuer sans',
  io_Add_which_existing_file_a4bbf: 'Ajouter quel fichier existant ?',
  io_It_goes_together_with_this_run_s_files_03244:
    'Il sera regroupé avec les fichiers de ce traitement.',
  io_Last_one_15660: 'Dernier : « {v0} »',
  io_Choose_one_in_Files_e6073: 'Choisir dans « Fichiers »',
  io_Start_a_new_one_this_time_6e970: 'En commencer un nouveau cette fois',
  io_taken_af2cf: '{v0} photos prises',
  io_Take_another_1b43d: 'En prendre une autre',
  io_Done_6f135: 'Terminé',
  io_Recording_1a04e: 'Enregistrement {date:YYYY-MM-DD_HH.mm}',
  more_Text_6ebbd: 'Texte',
  more_Network_name_1c98e: 'Nom du réseau',
  more_Password_8_63_characters_1c4be: 'Mot de passe (8–63 caractères)',
  more_QR_code_0d124: 'Code QR',
  WorkflowsScreen_Needs_at_least_files_0ed9b: 'Au moins {v0} fichiers requis',
  WorkflowsScreen_Takes_at_most_files_0fe59: 'Maximum {v0} fichiers',
  WorkflowsScreen_Cannot_use_these_files_d0ca3: 'Impossible d’utiliser ces fichiers',
  WorkflowsScreen_Run_5cab2: 'Exécuter',
  WorkflowsScreen_Edit_ef7c8: 'Modifier',
  WorkflowsScreen_The_first_run_downloads_what_it_needs__3a8fa:
    'La première utilisation télécharge les éléments nécessaires ; ensuite, vous pouvez l’utiliser hors connexion.',
  WorkflowsScreen_What_Morph_can_do_8f4f4: 'Ce que Morph peut faire',
  WorkflowsScreen_Make_your_own_quick_action_8bc98: 'Créer votre propre action rapide',
  ChangeScreen_and_d40e9: ' et ',
  _layout_What_Morph_can_do_8f4f4: 'Ce que Morph peut faire',
  _kind__Category_not_found_5faf2: 'Catégorie introuvable',
  _id__This_quick_action_no_longer_exists_35f5a: 'Cette action rapide n’existe plus.',

  // ==== 其他文案 ====
  retry: 'Réessayer',
  sharedFilesReceived: '{n} fichiers reçus',
  workflowFromTool:
    'Cette action rapide vient de l’outil « {name} ». Vous pouvez la modifier ; si vous retirez l’outil, elle est supprimée aussi.',
  workflowInputRequired:
    'La première étape doit être de choisir des photos ou fichiers, saisir un texte ou lire des entrées.',
  workflowTypeMismatch: 'Cette étape ne peut pas suivre la précédente : types incompatibles.',
  pdfCompressionLimit: 'Impossible de réduire « {name} » sous {target}',
  pdfCompressionChoice:
    'En conservant le texte, la taille minimale est {got}. Convertir les pages en images réduit davantage la taille, mais le texte ne peut plus être sélectionné ni copié, et les liens et champs à remplir ne fonctionnent plus.',
  pdfTurnIntoPictures: 'Convertir en images',
  pdfKeepCurrent: 'Garder celui de {got}',
  describeFieldChange: 'Champ « {name} » de « {collection} » : {changes}',
  describePageBackdrop: 'Page « {page} » : {change}',
  describeBackdropOn: 'image de fond activée (appui long pour choisir l’image)',
  describeBackdropOff: 'image de fond désactivée',
  describeBackdropPicture: 'nouvelle image de fond',
  describeBackdropPictureRemoved: 'image de fond retirée',
  describeBackdropOverlay: 'voile sur l’image {level}',
  overlay_light: 'léger',
  overlay_medium: 'moyen',
  overlay_strong: 'fort',
  describePageIcon: 'Icône de la page « {page} » → {icon}',
  describeNewIcon: '{icon}',
  describeNoIcon: 'aucun',
  describeStyleChange: '{name} → {value}',
  describeHideComponent: 'Masquer {component}',
  describeShowComponent: 'Afficher {component}',
  describeAddStep: 'Ajouter l’étape « {label} » à « {name} »{params}',
  describeStepParameters: ' : {params}',
  describeUpdatedTool:
    'Mettre à jour l’outil {tool} : ajoute {names} ; vos modifications sont conservées',
  separatorList: ', ',
  separatorComma: ', ',
  separatorSemicolon: ' ; ',

  // 扫描件转 Excel（D-272）
  runError_tableUnsupported:
    'Cet appareil ne sait pas encore lire les grilles dans cette langue. Choisissez une autre langue pour « Convertir en classeur Excel ».',
  resultTableEdit: 'Voir et modifier',
  resultTablesMissing:
    'Aucune grille à lignes n’a été trouvée aux pages {pages} : tout leur contenu a été inclus.',
  tableSheetName: 'Page {n}',
  tableEditorHint: 'Touchez une cellule pour la sélectionner, touchez-la encore pour la modifier',
  tableRedo: 'Rétablir',
  tableEditCell: 'Modifier la cellule',
  tableEditText: 'Modifier le texte',
  tableSource: 'Original',
  tableNoSource: 'Pas d’original pour cette cellule (elle a été ajoutée ici).',
  tableScopeTables: 'Grilles seulement',
  tableScopeAll: 'Tout le contenu',
  tableInsertRowAbove: 'Insérer une ligne au-dessus',
  tableInsertRowBelow: 'Insérer une ligne en dessous',
  tableDeleteRow: 'Supprimer cette ligne',
  tableInsertColumnLeft: 'Insérer une colonne à gauche',
  tableInsertColumnRight: 'Insérer une colonne à droite',
  tableDeleteColumn: 'Supprimer cette colonne',
  tableDeleteText: 'Supprimer ce texte',
  tableSelectFirst: 'Touchez d’abord une cellule de cette grille.',
  tableEmpty: 'Rien n’a été reconnu sur cette page.',
  tableReadOnly:
    'Cette page compte plus de {max} cellules : ici, elle peut seulement être consultée. Pour la modifier, ouvrez le fichier dans une autre application.',
  tableSaveFailed: 'Les modifications n’ont pas pu être enregistrées : {error}',
};

export const frSingular: SingularTable = {
  runItemImage: 'image {n} sur {total}',
  runItemFile: 'fichier {n} sur {total}',
  storageSummary: '{n} fichier · {size}',
  storageCleanup: 'Nettoyer {n} fichier inutilisé ({size})',
  storageCleanupTitle: 'Supprimer {n} fichier inutilisé ?',
  storageCleanupMessage:
    'Il occupe {size}. Aucune entrée, page ni composant ne l’utilise. Un fichier utilisé seulement par d’anciennes versions est aussi supprimé : restaurer ces versions ne le fera pas revenir. Les résultats enregistrés par les actions rapides ne sont pas concernés. Action irréversible.',
  storageDeleteUsed:
    'Il est utilisé à {n} endroit. Celui-ci indiquera que le fichier n’existe plus, et restaurer une ancienne version ne le fera pas revenir. Action irréversible.',
  attachmentsFull: '{n} fichier au maximum',
  data_attachments: '{n} pièce jointe',
  shareSummary: '{n} fichier',
  sharePhotoSummary: '{n} photo',
  sharedFilesReceived: '{n} fichier reçu',
  resultPages: '{n} page',
  resultCount: '{n} fichier',
  resultRecords: '{n} entrée',
  sharedPhotos: '{n} photo',
  sharedPdfs: '{n} PDF',
  sharedOthers: '{n} fichier',
  sharedVideos: '{n} vidéo',
  sharedAudio: '{n} fichier audio',
  shareInputStep: 'Fichier partagé ({n})',
  audioMerged: '{name} et {n} autre',
  draftCard: 'Vous avez un brouillon · {n} étape',
  draftDropped:
    'L’app a changé depuis que vous avez quitté le brouillon ; {n} étape ne correspond plus et a été supprimée.',
  draftDeleteBody: 'Le brouillon ({n} étape) sera supprimé. L’app ne change pas.',
  describe_Also_removes_card_s_that_ran_this_quic_5d29f:
    'Supprime aussi {v0} carte ayant exécuté cette action rapide',
  describe_Also_removes_block_s_that_showed_a7a30: 'Supprime aussi {v0} bloc affichant « {v1} »',
  describe_Also_removes_button_s_or_shortcut_s_th_d4dc1:
    'Supprime aussi {v0} bouton ou raccourci ouvrant « {v1} »',
  shareUsed: 'Utilisé {n} fois',
  runDone: '« {name} » enregistré ({pages} page)',
  runError_tooFew: 'Choisissez au moins {min} fichier.',
  runError_tooMany: 'Choisissez au maximum {max} fichier.',
  runError_tooLong:
    '« {name} » est trop long pour un GIF (maximum {seconds} seconde). Coupez-le d’abord.',
  packDeleteWithLanguages:
    'Sa langue sera aussi supprimée. Vous pourrez la télécharger à nouveau la prochaine fois que vous en aurez besoin.',
  recordCount: '{count} entrée',
  prefillMemoryCount: '{count} mise en page de document mémorisée',
  prefillMemoryRestoreConfirm:
    'Remplacer la mémoire de pré-remplissage actuelle par celle de ce fichier ({count} mise en page) ?',
  prefillMemoryRestored: '{count} mise en page restaurée.',
  deleteForeverConfirm: 'Supprimer {count} entrée de « {name} » ? Cette action est irréversible.',
  editPageSummary: 'Modifier « {page} » ({count} modification)',
  deleteGroupMessage:
    'L’élément qu’il contient sera aussi supprimé. « Annuler » abandonne toute la modification ; après enregistrement, vous pourrez encore l’annuler.',
  describe_Add_page_blocks_80d1f: 'Ajouter la page « {v0} » ({v1} bloc)',
  html_records_3f794: '{v0} entrée',
  ShareScreen_Needs_at_least_files_0ed9b: 'Au moins {v0} fichier requis',
  ShareScreen_Takes_at_most_files_0fe59: 'Maximum {v0} fichier',
  RedactScreen_boxes_4d76c: '{v0} zone',
  FillFormScreen_has_fields_to_fill_in_Use_Latin_letter_e3442:
    '{v0}.{v1} comporte {v2} champ à remplir. Utilisez des lettres latines, des chiffres et des symboles courants.',
  PagesScreen_Restore_removed_a7e1a: 'Restaurer {v0} page supprimée',
  io_taken_af2cf: '{v0} photo prise',
  WorkflowsScreen_Needs_at_least_files_0ed9b: 'Au moins {v0} fichier requis',
  WorkflowsScreen_Takes_at_most_files_0fe59: 'Maximum {v0} fichier',
  runError_noneMatched: 'Le fichier ne remplit pas les conditions de « Filtrer les fichiers ».',
  reminderWhenDate: '{n} jour avant « {field} » dans « {table} », à {time}',
  reminderDueIn: 'Une entrée de « {table} » arrive à échéance dans {n} jour ({date})',
  remindersRowHint: '{n} rappel',
  resultTablesMissing:
    'Aucune grille à lignes n’a été trouvée à la page {pages} : tout son contenu a été inclus.',
};
