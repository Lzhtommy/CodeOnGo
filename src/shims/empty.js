// Node 内置模块在 RN 环境下的空 shim。
// @anthropic-ai/sdk 的凭证模块会动态 import('node:fs') 读取 `ant auth login`
// 的本地 profile —— 该路径仅在不显式传 apiKey 时触发，App 始终显式传 key，
// 所以这里给空实现让 Metro 能完成打包即可。
module.exports = {};
