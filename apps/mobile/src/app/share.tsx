import { FilePreviewScreen } from '@/share/FilePreviewScreen';
import { useIncoming } from '@/share/incoming';
import { ShareScreen } from '@/share/ShareScreen';

/** 收到文件（D-117）：一份直接看预览页（D-457），多份进收件页面。 */
export default function ShareRoute() {
  const count = useIncoming((s) => s.share?.files.length ?? 0);
  return count === 1 ? <FilePreviewScreen /> : <ShareScreen />;
}
