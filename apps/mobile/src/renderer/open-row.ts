import type { useRouter } from 'expo-router';

// 打开一条记录：编辑页，或者给一条记录用的页面（D-342）。

export function openEditor(
  router: ReturnType<typeof useRouter>,
  collectionId: string,
  recordId?: string,
) {
  router.push({
    pathname: '/record/[collectionId]',
    params: recordId ? { collectionId, recordId } : { collectionId },
  });
}

/** 点一条记录：opens 是页面 ID 时打开给这条记录用的页面（D-342），"record" 或不写时打开编辑页。 */
export function openRow(
  router: ReturnType<typeof useRouter>,
  opens: string | undefined,
  collectionId: string,
  recordId: string,
) {
  if (opens !== undefined && opens !== 'record')
    router.push({ pathname: '/page/[pageId]', params: { pageId: opens, record: recordId } });
  else openEditor(router, collectionId, recordId);
}
