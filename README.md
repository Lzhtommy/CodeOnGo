# CodeOnGo

**随时随地 vibe coding** —— 复刻 Claude 移动端 coding 体验的跨端 App。在手机上发一句指令，agent 在云端全自动跑到底：读仓库、改代码、推分支、开 PR，你锁屏也不打断。

Agent 运行时基于 Anthropic **Managed Agents**（beta `managed-agents-2026-04-01`），客户端用 React Native + Expo 构建，iOS / Android / Web 同一套代码。

> 架构与产品决策的完整记录见 [`DECISIONS.md`](./DECISIONS.md)，工程约定见 [`AGENTS.md`](./AGENTS.md)。

## 特性

- **会话管理**：以 Anthropic `sessions.list()` 为唯一事实源，续聊、后台恢复。
- **两种工作区**：挂载 GitHub 仓库（`github_repository` resource），或空白项目（产物走 `/mnt/session/outputs/`）。
- **流式聊天**：实时 SSE 流，thinking 可折叠 + 工具活动展示，随时可中断（interrupt）。
- **Diff 查看器**：agent 收尾把 `git diff` 写到 `outputs/changes.diff`，App 解析并渲染。
- **WebView 预览**：agent 构建自包含 `preview.html`，App 下载后本地渲染。
- **推分支 + 代开 PR**：agent 只 push 新分支；App 端持 GitHub token 直接调 GitHub REST 开 PR。
- **自定义指令**：用户可在设置里追加自定义 system prompt，指纹变化自动触发 `agents.update` 升版本。

## 架构

Phase 1 是**纯客户端直连**：不经任何自有服务器，Anthropic key 只存设备安全存储（Keychain / Keystore）。这就是 BYOK（Bring Your Own Key）—— 用户自带 Anthropic API key。

```
手机 App (Expo/RN)
  ├── 直连 api.anthropic.com  ── Managed Agents（environment / agent / session / events）
  └── 直连 api.github.com     ── 仓库授权 + 代开 PR（REST）
```

- **默认模型**：`claude-opus-4-8`（MVP 写死，无模型选择器）。
- **Agent 策略**：App 托管单一持久 agent，首启在用户 workspace find-or-create，配置指纹变化才 `agents.update` 升版本 —— 绝不每次 session 前重建。
- **计费路线**：Phase 1 BYOK → Phase 2 平台托管 key + 订阅（含后端代理，解决 Web 端 CORS 与网络可达性）。

## 目录结构

```
App.tsx                 顶层路由（list / chat / settings / repoPicker / diff / preview / text）
src/config/             agent 定义与指纹（agentConfig.ts）
src/lib/                anthropic 客户端 / bootstrap / session 事件驱动 / github / outputs / diff / storage
src/ui/                 屏幕组件（ChatScreen / DiffScreen / PreviewScreen / ...）
src/shims/              Metro 用的 Node 内置模块空 shim
scripts/spike.mjs       Node 端 API 全链路 spike
scripts/verify-issues.mjs  Issues #1-#9 的 API 级端到端验证
```

## 开始使用

前置：Node 22+、一个 Anthropic API key（BYOK）。

```bash
npm install

# 启动开发服务器（Metro）
npm start          # 交互式选择 iOS / Android / Web

# 或指定平台
npm run ios
npm run android
npm run web        # 仅用于 UI 开发预览，见下方 Web 限制
```

首次进入 App 输入 Anthropic API key，即可新建 session 开始 coding。要用 GitHub 仓库工作区，需先在设置里连接 GitHub（手填 fine-grained PAT，或注册 OAuth App 后填 `app.json` 的 `extra.githubClientId` 启用 Device Flow）。

### API 链路验证脚本

无需启动 App，直接在 Node 里验证 Managed Agents 全链路（**会产生少量 API 费用**）：

```bash
# 基础 spike：bootstrap → 空白 session → 一轮流式对话
ANTHROPIC_API_KEY=sk-ant-... npm run spike

# Issues #1-#9 端到端验证（仓库挂载 / 产物桥 / diff / push / 开 PR）
ANTHROPIC_API_KEY=... GITHUB_TOKEN=... REPO=owner/name node scripts/verify-issues.mjs
```

## 工程约定（重要）

改代码前请先读 `DECISIONS.md` 与 `AGENTS.md`。几条核心铁律：

1. **事件消费三铁律**（见 `src/lib/session.ts` 头注释）：
   - *Stream-first*：先开 SSE 流再发消息。
   - *Consolidation*：每次(重)连先拉 `events.list()` 历史，按 event ID 去重，否则断流窗口内事件永久丢失。
   - *Idle-break gate*：`stop_reason.type === 'requires_action'` 是等客户端动作的瞬时 idle，不算终态，要继续消费。
2. **原生端必须用 `expo/fetch`**：RN 内置 fetch 不支持流式响应体，SSE 会整段缓冲到结束才返回（见 `src/lib/anthropic.ts`）。
3. **Metro 空 shim**：`@anthropic-ai/sdk` 引用了 Node 内置模块（仅凭证解析路径用到），新增引用会打崩 Metro，shim 列表在 `metro.config.js`。
4. **agent 是持久资源**：bootstrap 一次，之后只 `update` 升版本，绝不每次 session 前 `agents.create`。

## 已知限制

- **Web 版无法直连 Managed Agents**（2026-07-08 实测）：Anthropic 只给 `/v1/messages` 等主端点开了浏览器 CORS，Managed Agents beta 端点预检失败且无 allow-origin。Web target 仅用于 UI 开发预览，完整功能需等 Phase 2 后端代理。
- **SDK 暂锁 55**：SDK 56+ 的 `expo-modules-jsi` 需要 Swift 6.3（Xcode 26.4+ → macOS Tahoe 26.2+），开发机升级后再回 SDK 57。
- **网络可达性**：`api.anthropic.com` 直连在部分地区可达性因运营商而异，目标用户需自备代理（Phase 2 托管后端可缓解）。

## 状态

MVP（issues #1–#9）已实现：session 列表/续聊、后台恢复、GitHub 连接、仓库挂载、产物桥、diff 查看器、WebView 预览、代开 PR、自定义指令。详见 `DECISIONS.md` 的「MVP 状态」章节。

## License

[MIT](./LICENSE)
