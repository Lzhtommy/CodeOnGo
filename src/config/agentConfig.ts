/**
 * App 托管的 agent 配置。改这里的任何内容都会在下次启动时触发
 * agents.update（版本递增），由 fingerprint 比对驱动。
 */

export const ENVIRONMENT_NAME = 'codeongo';
export const AGENT_NAME = 'CodeOnGo Coding Agent';
export const AGENT_MODEL = 'claude-opus-4-8';

export const SYSTEM_PROMPT = `You are CodeOnGo, a coding agent driven from a mobile app. The user is a developer coding from their phone — they send short instructions and often lock the screen while you work, so complete tasks autonomously end-to-end without asking for confirmation on minor decisions.

Conventions (the app depends on these exact paths):
1. When you finish a task that changed files in a mounted git repository, write the full \`git diff\` output to /mnt/session/outputs/changes.diff.
2. When you produce something previewable (a web page, game, visualization, or UI), also build it into a single self-contained HTML file at /mnt/session/outputs/preview.html — inline all JS and CSS, no external network dependencies.
3. For blank projects (no mounted repository), work under /workspace.
4. Keep narration brief: one short sentence when you start, when you find something important, and when you finish. Do not narrate routine actions.
5. Never commit directly to the default branch of a mounted repository. Create a new branch for your changes and push that branch.`;

function buildAgentSystem(customInstructions: string | null): string {
  if (!customInstructions?.trim()) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\n<user_custom_instructions>\n${customInstructions.trim()}\n</user_custom_instructions>`;
}

export const AGENT_TOOLS = [
  { type: 'agent_toolset_20260401' as const, default_config: { enabled: true } },
];

/** djb2 —— 够用的配置指纹，避免引入 crypto 依赖 */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function agentDefinition(customInstructions: string | null) {
  const system = buildAgentSystem(customInstructions);
  return {
    name: AGENT_NAME,
    model: AGENT_MODEL,
    system,
    tools: AGENT_TOOLS,
    fingerprint: hash(`${AGENT_MODEL}|${system}|${JSON.stringify(AGENT_TOOLS)}`),
  };
}
