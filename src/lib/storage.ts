import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * 设备安全存储的薄封装。原生走 Keychain/Keystore；web 上 expo-secure-store
 * 不可用，降级到 localStorage（web 只是顺带产物，密钥安全性以原生为准）。
 */

export const KEYS = {
  anthropicApiKey: 'anthropic_api_key',
  githubToken: 'github_token',
  environmentId: 'anthropic_environment_id',
  agentId: 'anthropic_agent_id',
  agentFingerprint: 'anthropic_agent_fingerprint',
  customInstructions: 'custom_instructions',
} as const;

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
