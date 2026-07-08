#!/usr/bin/env node
/**
 * API 链路 spike：bootstrap（environment + agent）→ 空白 session → 一轮流式对话。
 * 与 App 内逻辑同构（stream-first / consolidation / idle-break gate），
 * 用于在 Node 里先验证 Managed Agents 全链路，再到真机上验 RN 的 SSE。
 *
 * 用法：ANTHROPIC_API_KEY=sk-ant-... node scripts/spike.mjs [prompt]
 * 结束后自动 archive session（session 是一次性资源，agent/environment 保留复用）。
 */
import Anthropic from '@anthropic-ai/sdk';

const ENVIRONMENT_NAME = 'codeongo';
const AGENT_NAME = 'CodeOnGo Coding Agent';
const PROMPT =
  process.argv[2] ??
  '用一句话自我介绍，然后在 /workspace 下创建 hello.txt 写入 "hello from CodeOnGo"，再 cat 出来确认。';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('请设置 ANTHROPIC_API_KEY 环境变量');
  process.exit(1);
}

const client = new Anthropic();

async function ensureEnvironment() {
  for await (const env of client.beta.environments.list()) {
    if (env.name === ENVIRONMENT_NAME) return env.id;
  }
  const env = await client.beta.environments.create({
    name: ENVIRONMENT_NAME,
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  });
  console.log('created environment', env.id);
  return env.id;
}

async function ensureAgent() {
  for await (const agent of client.beta.agents.list()) {
    if (agent.name === AGENT_NAME) return agent.id;
  }
  const agent = await client.beta.agents.create({
    name: AGENT_NAME,
    model: 'claude-opus-4-8',
    system: 'You are CodeOnGo, a coding agent driven from a mobile app. Keep narration brief.',
    tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }],
  });
  console.log('created agent', agent.id, 'version', agent.version);
  return agent.id;
}

const envId = await ensureEnvironment();
const agentId = await ensureAgent();
console.log('environment:', envId, ' agent:', agentId);

const session = await client.beta.sessions.create({
  agent: agentId,
  environment_id: envId,
  title: 'spike',
});
console.log('session:', session.id);
console.log(`Console: https://platform.claude.com/workspaces/default/sessions/${session.id}\n`);

// Stream-first：先开流再发 kickoff
const stream = await client.beta.sessions.events.stream(session.id);
await client.beta.sessions.events.send(session.id, {
  events: [{ type: 'user.message', content: [{ type: 'text', text: PROMPT }] }],
});

const seen = new Set();
for await (const ev of client.beta.sessions.events.list(session.id)) {
  if (ev.id) seen.add(ev.id); // consolidation：历史已读，流上重复的跳过渲染
}

for await (const ev of stream) {
  const isNew = !ev.id || !seen.has(ev.id);
  if (isNew && ev.id) seen.add(ev.id);

  if (isNew) {
    switch (ev.type) {
      case 'agent.message':
        console.log('\n[agent]', (ev.content ?? []).map((b) => b.text ?? '').join(''));
        break;
      case 'agent.thinking':
        console.log('[thinking]', (ev.content ?? []).map((b) => b.thinking ?? b.text ?? '').join('').slice(0, 200));
        break;
      case 'agent.tool_use':
        console.log('[tool]', ev.name, JSON.stringify(ev.input ?? {}).slice(0, 160));
        break;
      case 'session.error':
        console.error('[error]', JSON.stringify(ev.error ?? ev));
        break;
      case 'span.model_request_end':
        if (ev.model_usage) {
          const u = ev.model_usage;
          console.log(`[usage] in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens}`);
        }
        break;
    }
  }

  // 终态判断对每个事件都跑（包括去重跳过渲染的）
  if (ev.type === 'session.status_terminated') {
    console.log('\nsession terminated');
    break;
  }
  if (ev.type === 'session.status_idle') {
    if (ev.stop_reason?.type === 'requires_action') continue;
    console.log('\nidle, stop_reason:', ev.stop_reason?.type);
    break;
  }
}

// 收尾：等状态落盘后 archive（session 属一次性资源；agent/environment 保留）
for (let i = 0; i < 10; i++) {
  const s = await client.beta.sessions.retrieve(session.id);
  if (s.status !== 'running') break;
  await new Promise((r) => setTimeout(r, 300));
}
await client.beta.sessions.archive(session.id);
console.log('session archived. spike 完成 ✅');
