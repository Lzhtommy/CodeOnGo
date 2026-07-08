const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// @anthropic-ai/sdk 引用了若干 Node 内置模块（仅在 Node 凭证解析路径用到，
// App 显式传 apiKey 不会触碰）。RN 没有这些模块，统一指到空 shim。
const emptyShim = path.resolve(__dirname, 'src/shims/empty.js');
const NODE_BUILTINS = new Set([
  'node:fs',
  'node:fs/promises',
  'node:path',
  'node:os',
  'node:crypto',
  'node:child_process',
  'node:util',
  'node:stream',
  'fs',
  'fs/promises',
  'path',
  'os',
  'crypto',
  'child_process',
]);

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (NODE_BUILTINS.has(moduleName)) {
    return { type: 'sourceFile', filePath: emptyShim };
  }
  if (defaultResolveRequest) return defaultResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
