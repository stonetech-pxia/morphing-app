import { Stack, useLocalSearchParams } from 'expo-router';

import { DeskScreen } from '@/desk/DeskScreen';

/** 文件房间（D-339）：桌上的文件、版本栈和工具栏。页面自己画顶栏（撤销、重做、完成）。 */
export default function DeskRoute() {
  const { deskId } = useLocalSearchParams<{ deskId: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <DeskScreen key={deskId} deskId={deskId} />
    </>
  );
}
