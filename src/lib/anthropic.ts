import Anthropic from '@anthropic-ai/sdk';
import { Platform } from 'react-native';

/**
 * 直连 Anthropic 的客户端工厂。
 *
 * 关键点：RN 内置 fetch 不支持流式响应体，SSE 会整段缓冲到结束才返回。
 * expo/fetch（WinterCG 兼容，SDK 52+）支持 ReadableStream，原生端必须用它。
 * Web 端浏览器原生 fetch 本身就支持流式。
 */
export function createClient(apiKey: string): Anthropic {
  let fetchImpl: unknown;
  if (Platform.OS !== 'web') {
    fetchImpl = require('expo/fetch').fetch;
  }
  return new Anthropic({
    apiKey,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: fetchImpl as any,
    dangerouslyAllowBrowser: true, // key 由用户本人持有并存在本人设备上（BYOK）
  });
}
