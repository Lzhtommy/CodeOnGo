import type { SessionEvent } from './session';

/** 聊天流渲染项 —— 历史加载与实时流共用同一套映射 */

export type ItemKind = 'user' | 'agent' | 'thinking' | 'tool' | 'error';

export interface ChatItem {
  id: string;
  kind: ItemKind;
  text: string;
}

/** 从事件 content 块里抽出可显示文本（兼容 text / thinking 块） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(ev: any): string {
  const blocks = Array.isArray(ev.content) ? ev.content : [];
  const parts = blocks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => b?.text ?? b?.thinking ?? '')
    .filter(Boolean);
  if (parts.length) return parts.join('\n');
  return typeof ev.thinking === 'string' ? ev.thinking : '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeToolInput(input: any): string {
  if (!input || typeof input !== 'object') return '';
  const s = JSON.stringify(input);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

export function eventToItem(ev: SessionEvent): ChatItem | null {
  switch (ev.type) {
    case 'user.message': {
      // 历史加载时用户消息也来自事件流；实时轮次已本地乐观渲染，由调用方去重
      const text = extractText(ev);
      return text ? { id: ev.id, kind: 'user', text } : null;
    }
    case 'agent.message': {
      const text = extractText(ev);
      return text ? { id: ev.id, kind: 'agent', text } : null;
    }
    case 'agent.thinking': {
      const text = extractText(ev);
      return text ? { id: ev.id, kind: 'thinking', text } : null;
    }
    case 'agent.tool_use':
      return {
        id: ev.id,
        kind: 'tool',
        text: `${ev.name ?? 'tool'}  ${summarizeToolInput(ev.input)}`,
      };
    case 'session.error':
      return {
        id: ev.id ?? `err-${Math.random().toString(36).slice(2)}`,
        kind: 'error',
        text: ev.error?.message ?? JSON.stringify(ev.error ?? ev),
      };
    default:
      return null; // tool_result / span.* / status 事件不进消息列表
  }
}

/**
 * 从 bash 工具事件里提取 agent push 过的分支名（供代开 PR 卡片预填）。
 * 匹配 `git push origin <branch>` / `git push -u origin <branch>` 等常见形态。
 */
export function detectPushedBranch(ev: SessionEvent): string | null {
  if (ev.type !== 'agent.tool_use' || ev.name !== 'bash') return null;
  const cmd: string = ev.input?.command ?? '';
  if (!cmd.includes('git push')) return null;
  const m = cmd.match(
    /git push(?:\s+(?:-u|--set-upstream|--force|-f|--force-with-lease))*\s+\S+\s+(?:HEAD:)?([\w./-]+)/,
  );
  const branch = m?.[1] ?? null;
  if (!branch || branch === 'HEAD') return null;
  return branch.replace(/^refs\/heads\//, '');
}
