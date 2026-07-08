import Anthropic from '@anthropic-ai/sdk';

/**
 * Session 事件驱动层。三条铁律（来自 Managed Agents 客户端模式）：
 * 1. Stream-first：先开 SSE 流再发消息，流不回放开流之前的事件。
 * 2. Consolidation：每次(重)连都先拉 events.list() 历史，按 event ID 去重，
 *    否则断流窗口内的事件永久丢失（若丢的是 tool 确认类事件会死锁）。
 * 3. Idle-break gate：不能见 status_idle 就停 —— stop_reason.type ===
 *    'requires_action' 是等客户端动作的瞬时 idle，要继续消费。
 */

// SDK 的事件联合类型很宽，spike 阶段用结构化的宽类型访问
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SessionEvent = any;

export type TurnOutcome = 'idle' | 'terminated' | 'dropped';

export interface SessionSummary {
  id: string;
  title: string | null;
  status: 'rescheduling' | 'running' | 'idle' | 'terminated';
  updatedAt: string;
}

export async function listSessions(client: Anthropic): Promise<SessionSummary[]> {
  const sessions: SessionSummary[] = [];
  for await (const s of await client.beta.sessions.list()) {
    if (s.archived_at) continue;
    sessions.push({ id: s.id, title: s.title, status: s.status, updatedAt: s.updated_at });
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}

export async function createBlankSession(
  client: Anthropic,
  agentId: string,
  environmentId: string,
  title: string,
): Promise<string> {
  const session = await client.beta.sessions.create({
    agent: agentId, // 字符串简写 → 永远用 agent 最新版本
    environment_id: environmentId,
    title,
  });
  return session.id;
}

export interface RepoMount {
  fullName: string; // owner/name
  defaultBranch: string;
}

/** 仓库模式 session：github_repository resource 挂载（创建会阻塞到 clone 完成） */
export async function createRepoSession(
  client: Anthropic,
  agentId: string,
  environmentId: string,
  repo: RepoMount,
  githubToken: string,
  title: string,
): Promise<string> {
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title,
    resources: [
      {
        type: 'github_repository',
        url: `https://github.com/${repo.fullName}`,
        authorization_token: githubToken,
        checkout: { type: 'branch', name: repo.defaultBranch },
      },
    ],
  });
  return session.id;
}

export async function sendUserMessage(client: Anthropic, sessionId: string, text: string) {
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
  });
}

export async function interrupt(client: Anthropic, sessionId: string) {
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.interrupt' }],
  });
}

export interface ConsumeOptions {
  client: Anthropic;
  sessionId: string;
  /** 跨轮次、跨重连共享的已见事件 ID 集合 */
  seen: Set<string>;
  onEvent: (event: SessionEvent) => void;
  /** 开流成功、发送 kickoff 消息的时机（保证 stream-first 顺序） */
  afterStreamOpen?: () => Promise<void>;
  isCancelled?: () => boolean;
}

/**
 * 打开流 → 拉历史去重 → 消费直到终态。
 * 返回 'dropped' 表示流意外断开且未见终态，调用方应重连（再次调用本函数）。
 */
export async function consumeUntilSettled(opts: ConsumeOptions): Promise<TurnOutcome> {
  const { client, sessionId, seen, onEvent } = opts;

  const stream = await client.beta.sessions.events.stream(sessionId);

  if (opts.afterStreamOpen) await opts.afterStreamOpen();

  // Consolidation：流已在服务端缓冲，先补历史
  for await (const ev of client.beta.sessions.events.list(sessionId)) {
    if (ev.id && !seen.has(ev.id)) {
      seen.add(ev.id);
      onEvent(ev);
    }
  }

  for await (const ev of stream as AsyncIterable<SessionEvent>) {
    if (opts.isCancelled?.()) return 'dropped';

    // interrupt 事件可能没有 id —— 去重只拦渲染，终态判断必须每个事件都跑
    const isNew = !ev.id || !seen.has(ev.id);
    if (isNew) {
      if (ev.id) seen.add(ev.id);
      onEvent(ev);
    }

    if (ev.type === 'session.status_terminated') return 'terminated';
    if (ev.type === 'session.status_idle') {
      if (ev.stop_reason?.type === 'requires_action') continue; // 等客户端动作的瞬时 idle
      return 'idle'; // end_turn / retries_exhausted —— 本轮结束
    }
  }
  return 'dropped';
}

async function consumeWithReconnect(
  opts: Omit<ConsumeOptions, 'afterStreamOpen'> & {
    maxReconnects?: number;
    onFirstStreamOpen?: () => Promise<void>;
  },
): Promise<TurnOutcome> {
  const maxReconnects = opts.maxReconnects ?? 5;
  let firstOpenDone = false;

  for (let attempt = 0; attempt <= maxReconnects; attempt++) {
    try {
      const outcome = await consumeUntilSettled({
        ...opts,
        afterStreamOpen: async () => {
          if (!firstOpenDone) {
            firstOpenDone = true;
            await opts.onFirstStreamOpen?.();
          }
        },
      });
      if (outcome !== 'dropped') return outcome;
      if (opts.isCancelled?.()) return 'dropped';
    } catch (err) {
      if (opts.isCancelled?.() || attempt === maxReconnects) throw err;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
    }
  }
  return 'dropped';
}

/**
 * 跑一轮：stream-first 发消息，断流自动重连（consolidation 保证不丢事件），
 * 直到 session 落到真正的 idle/terminated。
 */
export async function runTurn(
  opts: Omit<ConsumeOptions, 'afterStreamOpen'> & { text: string; maxReconnects?: number },
): Promise<TurnOutcome> {
  return consumeWithReconnect({
    ...opts,
    onFirstStreamOpen: () => sendUserMessage(opts.client, opts.sessionId, opts.text),
  });
}

/**
 * 只挂上去消费不发消息：用于打开历史 session（补历史）与回前台恢复。
 * running 的 session 会一直消费到落 idle；本就 idle 的 session 补完历史即返回。
 */
export async function attachSession(
  opts: Omit<ConsumeOptions, 'afterStreamOpen'> & { maxReconnects?: number },
): Promise<TurnOutcome> {
  const status = (await opts.client.beta.sessions.retrieve(opts.sessionId)).status;

  // 非运行态：只补历史，不必挂流等待
  if (status !== 'running' && status !== 'rescheduling') {
    for await (const ev of opts.client.beta.sessions.events.list(opts.sessionId)) {
      if (ev.id && !opts.seen.has(ev.id)) {
        opts.seen.add(ev.id);
        opts.onEvent(ev);
      }
    }
    return status === 'terminated' ? 'terminated' : 'idle';
  }

  return consumeWithReconnect(opts);
}
