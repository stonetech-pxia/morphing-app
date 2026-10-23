import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { SecretStore } from './settings';

// 只在本机解锁时可读，且不随备份迁移到其他设备。
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const secureSecretStore: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  delete: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};

// 只用于 Morph 服务器按设备限额（D-132）：首次使用时随机生成，不含任何设备信息。
let deviceId: Promise<string | null> | undefined;
export function getDeviceId(): Promise<string | null> {
  deviceId ??= (async () => {
    const saved = await secureSecretStore.get('morph.deviceId');
    if (saved) return saved;
    const fresh = randomUUID();
    await secureSecretStore.set('morph.deviceId', fresh);
    return fresh;
  })().catch(() => null);
  return deviceId;
}
