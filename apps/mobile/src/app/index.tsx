import { CURRENT_SCHEMA_VERSION } from '@morph/core';
import { StyleSheet, Text, View } from 'react-native';

// M0 占位首页：证明 App 能启动并读取 @morph/core。M1 将替换为按 WorkspaceConfig 渲染的页面。
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Morph</Text>
      <Text style={styles.body}>M0 骨架已运行 · schema v{CURRENT_SCHEMA_VERSION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
  },
  title: { fontSize: 28, fontWeight: '600', color: '#111111' },
  body: { fontSize: 16, color: '#444444' },
});
