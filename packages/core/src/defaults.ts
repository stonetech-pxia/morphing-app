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
import { DEFAULT_THEME } from './theme';

export const SYSTEM_TARGET_LABELS: Record<SystemTarget, Localized> = {
  quickActions: { en: 'What Morph can do', zh: 'Morph 可以做什么' },
  tools: { en: 'Tools', zh: '工具' },
  ai: { en: 'AI', zh: 'AI 修改' },
  history: { en: 'Changes', zh: '改动记录' },
  settings: { en: 'Settings', zh: '设置' },
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
    shell: {
      nav: [pageTarget(HOME_PAGE_ID), 'tools', 'ai', 'history', 'settings'],
      floating: [],
    },
    pages: [
      {
        id: HOME_PAGE_ID,
        title: t(locale, 'defaults_Home_ec133'),
        icon: 'home',
        components: [
          {
            id: 'welcome',
            type: 'header',
            props: {
              title: t(locale, 'defaults_My_workspace_df4a5'),
              subtitle: t(locale, 'defaults_Tap_AI_and_describe_how_this_app_shoul_7d958'),
            },
          },
          {
            id: 'catalog',
            type: 'catalogLink',
            props: { title: t(locale, 'defaults_Add_tools_9c8e1') },
          },
          {
            id: 'recent-files',
            type: 'fileList',
            props: { title: t(locale, 'defaults_Recent_files_2d602'), limit: 5 },
          },
        ],
      },
    ],
    tools: [],
    workflows: [],
    collections: [],
  };
}
