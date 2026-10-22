import {
  CURRENT_SCHEMA_VERSION,
  HOME_PAGE_ID,
  pageTarget,
  type Locale,
  type Localized,
  type SystemTarget,
  type WorkspaceConfig,
} from './schema';

export const SYSTEM_TARGET_LABELS: Record<SystemTarget, Localized> = {
  tools: { en: 'Tools', zh: '工具' },
  ai: { en: 'AI', zh: 'AI 修改' },
  history: { en: 'History', zh: '历史' },
  settings: { en: 'Settings', zh: '设置' },
};

/** 首次启动时写入的默认工作空间（revision 1）。 */
export function createDefaultWorkspace(locale: Locale): WorkspaceConfig {
  const zh = locale === 'zh';
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    theme: { primaryColor: '#3B5BDB', mode: 'system' },
    shell: {
      nav: [pageTarget(HOME_PAGE_ID), 'tools', 'ai', 'history', 'settings'],
      floating: [],
    },
    pages: [
      {
        id: HOME_PAGE_ID,
        title: zh ? '首页' : 'Home',
        components: [
          {
            id: 'welcome',
            type: 'header',
            props: {
              title: zh ? '我的工作台' : 'My workspace',
              subtitle: zh
                ? '点「AI 修改」，用一句话改造这个 App'
                : 'Tap AI and describe how this app should change',
            },
          },
          { id: 'catalog', type: 'catalogLink', props: { title: zh ? '添加工具' : 'Add tools' } },
          {
            id: 'recent-files',
            type: 'fileList',
            props: { title: zh ? '最近文件' : 'Recent files', limit: 5 },
          },
        ],
      },
    ],
    tools: [],
    workflows: [],
  };
}
