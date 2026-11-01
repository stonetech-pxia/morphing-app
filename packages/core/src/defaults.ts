import { t } from './messages';
import {
  CURRENT_SCHEMA_VERSION,
  HOME_PAGE_ID,
  pageTarget,
  type IconName,
  type Locale,
  type Localized,
  type SystemTarget,
  type WorkspaceConfig,
} from './schema';
import { FILES_TABLE } from './files-table';
import { DEFAULT_THEME } from './theme';

export const SYSTEM_TARGET_LABELS: Record<SystemTarget, Localized> = {
  quickActions: { en: 'What Morph can do', zh: 'Morph 可以做什么', fr: 'Ce que Morph peut faire' },
  tools: { en: 'Tools', zh: '工具', fr: 'Outils' },
  ai: { en: 'AI', zh: 'AI 修改', fr: 'IA' },
  history: { en: 'Changes', zh: '改动记录', fr: 'Modifications' },
  settings: { en: 'Settings', zh: '设置', fr: 'Paramètres' },
};

export const SYSTEM_TARGET_ICONS: Record<SystemTarget, IconName> = {
  quickActions: 'workflow',
  tools: 'apps',
  ai: 'sparkles',
  history: 'history',
  settings: 'settings',
};

/** 首次启动时写入的默认工作空间（revision 1）。 */
export function createDefaultWorkspace(locale: Locale): WorkspaceConfig {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    theme: JSON.parse(JSON.stringify(DEFAULT_THEME)) as WorkspaceConfig['theme'],
    nav: {
      bar: [pageTarget(HOME_PAGE_ID), 'tools', 'ai', 'history', 'settings'],
      floating: [],
    },
    data: { tables: [] },
    containers: {
      pages: [
        {
          id: HOME_PAGE_ID,
          title: t(locale, 'defaults_Home_ec133'),
          icon: 'home',
          blocks: [
            {
              id: 'welcome',
              look: 'header',
              show: {
                title: t(locale, 'defaults_My_workspace_df4a5'),
                subtitle: t(locale, 'defaults_Tap_AI_and_describe_how_this_app_shoul_7d958'),
              },
            },
            // 「添加工具」：主色标题、加号、大块（原 catalogLink，M7）。
            {
              id: 'catalog',
              look: 'entry',
              show: {
                title: t(locale, 'defaults_Add_tools_9c8e1'),
                icon: 'plus',
                shape: 'tile',
                accent: true,
              },
              opens: 'tools',
            },
            // 最近的文件：不是图片的用户文件（原 fileList 不写 mimeType）。
            {
              id: 'recent-files',
              look: 'files',
              show: { title: t(locale, 'defaults_Recent_files_2d602') },
              source: {
                table: FILES_TABLE,
                filter: [{ field: 'kind', op: 'isNot', value: 'image' }],
                limit: 5,
              },
            },
          ],
        },
      ],
    },
    tools: [],
    packages: [],
  };
}
