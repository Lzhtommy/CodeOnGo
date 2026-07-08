# CodeOnGo 设计决议（2026-07-06 grill-me 访谈定稿）

复刻 Claude 移动端 coding 体验的"随时随地 vibe coding"跨端 App，agent 运行时使用 Anthropic Managed Agents（beta `managed-agents-2026-04-01`）。

## 已定决策

| 维度 | 决议 |
|---|---|
| 产品定位 | 面向开发者的公开产品 |
| 计费 | 两阶段：Phase 1 BYOK（用户自带 Anthropic key）→ Phase 2 平台托管 key + 订阅 |
| 后端形态 | Phase 1 纯客户端直连 api.anthropic.com，key 只存设备安全存储，不经任何自有服务器 |
| 框架 | React Native + Expo，复用 `@anthropic-ai/sdk`。**暂锁 SDK 55**：SDK 56+ 的 expo-modules-jsi 需要 Swift 6.3（Xcode 26.4+ → macOS Tahoe 26.2+），开发机升级 macOS 后再回 SDK 57 |
| 工作区模型 | GitHub 仓库（`github_repository` resource 挂载）+ 空白项目（产物走 `/mnt/session/outputs/`）都支持 |
| 开 PR | agent 只 push 新分支；App 端持 GitHub token 直接调 GitHub REST 开 PR（绕开 MCP/vault） |
| GitHub 授权 | OAuth Device Flow（仅需 client_id，纯客户端可行）为主，手填 fine-grained PAT 备选 |
| 预览 | 约定 agent 构建自包含 preview.html 到 outputs，App 下载后 WebView 渲染；实时部署预览留 Phase 2 |
| Agent 策略 | App 托管单一 agent（首启在用户 workspace find-or-create，指纹变化走 `agents.update` 升版本），用户只暴露"自定义指令"文本框 |
| 权限模型 | 全工具 `always_allow` + unrestricted networking，全自动跑到底，UI 提供 interrupt；危险边界靠 PAT 最小 scope / 只 push 新分支 / PR 需用户确认 |
| 默认模型 | `claude-opus-4-8`（写死，MVP 无模型选择器） |
| MVP 范围 | 会话列表、新建 session（仓库/空白）、聊天流（thinking 可折叠 + 工具活动）、中断、diff 查看器、WebView 预览、推分支+代开 PR |
| 明确砍掉（Phase 2 候选） | 模型选择器、Outcome/rubric 模式、多 agent 人设、推送通知、实时部署预览 |

## 实现约定

1. Session 列表以 Anthropic `sessions.list()` 为唯一事实源，本地只缓存展示元数据。
2. Diff 获取用约定：system prompt 要求 agent 收尾把 `git diff` 写到 `/mnt/session/outputs/changes.diff`。
3. 事件消费三铁律（见 `src/lib/session.ts`）：stream-first、重连必做 consolidation（`events.list` + 按 ID 去重）、idle-break gate（`stop_reason.type === 'requires_action'` 不算终态）。
4. 绝不每次 session 前 `agents.create`——agent 是持久资源，bootstrap 一次，之后只 update 升版本。

## 已知风险

- **Web 版无法直连**（2026-07-08 实测）：Anthropic 只给 /v1/messages 等主端点开了浏览器 CORS，Managed Agents beta 端点（/v1/environments、/v1/sessions 等）预检 400 且无 allow-origin。Web 版只能等 Phase 2 后端代理；Expo web target 仅用于 UI 开发预览。
- **中国大陆网络**：api.anthropic.com 直连可达性因运营商而异，目标用户需自备代理。这也是 Phase 2 托管后端（可部署在可达区域）的额外卖点。

- Managed Agents 仍在 beta，API 面可能变动，SDK 升级通道要保持通畅。
- BYOK 要求用户已有 Anthropic API key，获客漏斗窄（Phase 2 解决）。
- iOS 后台会杀 SSE 长连接，恢复逻辑（consolidation）是体验生命线，需重点真机测试。

## Spike 状态（已验证）

- `@anthropic-ai/sdk@0.110.0` 含完整 Managed Agents beta 命名空间。
- SDK 引用 Node 内置模块（凭证解析路径），Metro 打包需 `metro.config.js` 的空 shim（已配）；App 始终显式传 apiKey，该路径不会触发。
- 原生端必须用 `expo/fetch`（RN 内置 fetch 不支持流式响应体），见 `src/lib/anthropic.ts`。
- iOS / Web bundle 均通过；tsc 零错误。
- API 全链路验证脚本：`ANTHROPIC_API_KEY=sk-ant-... npm run spike`（真实调用，产生少量费用）。
