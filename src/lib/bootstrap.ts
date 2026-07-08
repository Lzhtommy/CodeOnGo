import Anthropic from '@anthropic-ai/sdk';
import { agentDefinition, ENVIRONMENT_NAME } from '../config/agentConfig';
import { KEYS, getItem, setItem } from './storage';

/**
 * 首启 bootstrap：在用户自己的 workspace 里 find-or-create
 * environment + agent，ID 存设备本地。绝不在每次 session 前重建 agent。
 *
 * agent 配置指纹变化（App 升级内置 prompt / 用户改自定义指令）时走
 * agents.update 升版本，session 永远引用最新版。
 */

export interface BootstrapResult {
  environmentId: string;
  agentId: string;
}

async function ensureEnvironment(client: Anthropic): Promise<string> {
  const cached = await getItem(KEYS.environmentId);
  if (cached) return cached;

  // 环境名唯一：先找同名（换过设备的老用户），没有再建
  for await (const env of client.beta.environments.list()) {
    if (env.name === ENVIRONMENT_NAME) {
      await setItem(KEYS.environmentId, env.id);
      return env.id;
    }
  }

  const env = await client.beta.environments.create({
    name: ENVIRONMENT_NAME,
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  });
  await setItem(KEYS.environmentId, env.id);
  return env.id;
}

async function ensureAgent(client: Anthropic): Promise<string> {
  const customInstructions = await getItem(KEYS.customInstructions);
  const def = agentDefinition(customInstructions);

  let agentId = await getItem(KEYS.agentId);

  if (!agentId) {
    // 换设备场景：agent 名不唯一，按名字找我们托管的那一个
    for await (const agent of client.beta.agents.list()) {
      if (agent.name === def.name) {
        agentId = agent.id;
        break;
      }
    }
  }

  if (!agentId) {
    const agent = await client.beta.agents.create({
      name: def.name,
      model: def.model,
      system: def.system,
      tools: def.tools,
    });
    await setItem(KEYS.agentId, agent.id);
    await setItem(KEYS.agentFingerprint, def.fingerprint);
    return agent.id;
  }

  const storedFingerprint = await getItem(KEYS.agentFingerprint);
  if (storedFingerprint !== def.fingerprint) {
    // update 要求带当前 version 做乐观锁
    const current = await client.beta.agents.retrieve(agentId);
    await client.beta.agents.update(agentId, {
      version: current.version,
      name: def.name,
      model: def.model,
      system: def.system,
      tools: def.tools,
    });
    await setItem(KEYS.agentFingerprint, def.fingerprint);
  }
  await setItem(KEYS.agentId, agentId);
  return agentId;
}

export async function ensureBootstrap(client: Anthropic): Promise<BootstrapResult> {
  const environmentId = await ensureEnvironment(client);
  const agentId = await ensureAgent(client);
  return { environmentId, agentId };
}
