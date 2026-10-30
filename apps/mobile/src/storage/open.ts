import { openDatabaseAsync } from 'expo-sqlite';

import { SQLiteWorkspaceRepo, migrateDatabase } from './sqlite';

// 打开本机数据库（只打开一次）：界面启动和提醒按钮的后台处理（D-318）共用一个。

let opened: Promise<SQLiteWorkspaceRepo> | null = null;

export function openRepo(): Promise<SQLiteWorkspaceRepo> {
  opened ??= (async () => {
    const db = await openDatabaseAsync('morph.db');
    await migrateDatabase(db);
    return new SQLiteWorkspaceRepo(db);
  })().catch((e: unknown) => {
    opened = null;
    throw e;
  });
  return opened;
}
