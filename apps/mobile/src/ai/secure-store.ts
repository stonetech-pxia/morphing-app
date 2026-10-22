import * as SecureStore from 'expo-secure-store';

import type { SecretStore } from './settings';

// 只在本机解锁时可读，且不随备份迁移到其他设备。
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const secureSecretStore: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  delete: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
