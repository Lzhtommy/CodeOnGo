# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# CodeOnGo 项目约定

- 架构与产品决策见 DECISIONS.md —— 改动前先读，与其冲突的实现需先确认。
- 目录结构：src/config（agent 定义与指纹）、src/lib（anthropic 客户端 / bootstrap / session 事件驱动 / storage）、src/ui（屏幕组件）、scripts/spike.mjs（Node 端 API 链路验证）。
- Managed Agents 事件消费必须遵守 src/lib/session.ts 头注释的三条铁律（stream-first / consolidation / idle-break gate）。
- 新增 Node 内置模块引用会打崩 Metro，shim 列表在 metro.config.js。
