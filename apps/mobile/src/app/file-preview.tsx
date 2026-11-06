import { useLocalSearchParams } from 'expo-router';

import { FilePreviewScreen } from '@/share/FilePreviewScreen';

/** 从多个文件的收件页面点进来看其中一个（D-457）：只看，不放工具。 */
export default function FilePreviewRoute() {
  const { index } = useLocalSearchParams<{ index?: string }>();
  return <FilePreviewScreen index={Number(index ?? 0)} />;
}
