#!/usr/bin/env node
/**
 * Issues #1-#9 的 API 级端到端验证（App 内同构逻辑的 Node 侧复现）。
 *
 * 用法：ANTHROPIC_API_KEY=... GITHUB_TOKEN=... REPO=owner/name node scripts/verify-issues.mjs
 *
 * 验证矩阵：
 *  #1 sessions.list 数据源
 *  #6 空白 session 产物：outputs 列表（scope_id + 双 beta 头 + 索引重试）与下载
 *  #7 preview.html 约定产出 + diff 解析器（对真实 changes.diff）
 *  #5 github_repository 挂载：读 README、改代码、push 分支
 *  #9 push 分支检测（事件正则）+ REST 创建 PR（验证后关闭 PR、删分支清理）
 *  #2/#3/#4/#8 为客户端 UI 行为，由 tsc/bundle + 真机走查覆盖，此处不重复
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

const require = createRequire(import.meta.url);

// 编译 src/lib 为 CJS 供本脚本复用（保证验证的是 App 同一份逻辑）
execSync(
  'npx tsc src/lib/diff.ts src/lib/events.ts --module commonjs --target es2020 --outDir /tmp/codeongo-verify --skipLibCheck',
  { stdio: 'inherit' },
);
const { parseUnifiedDiff } = require('/tmp/codeongo-verify/diff.js');
const { detectPushedBranch } = require('/tmp/codeongo-verify/events.js');

const REPO = process.env.REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!process.env.ANTHROPIC_API_KEY || !GITHUB_TOKEN || !REPO) {
  console.error('需要 ANTHROPIC_API_KEY / GITHUB_TOKEN / REPO 环境变量');
  process.exit(1);
}

const MA_BETA = 'managed-agents-2026-04-01';
const client = new Anthropic();
const results = [];
const ok = (name) => {
  results.push([name, true]);
  console.log(`✅ ${name}`);
};
const fail = (name, err) => {
  results.push([name, false]);
  console.error(`❌ ${name}:`, err?.message ?? err);
};

async function ensureIds() {
  let envId, agentId;
  for await (const e of client.beta.environments.list()) if (e.name === 'codeongo') envId = e.id;
  for await (const a of client.beta.agents.list())
    if (a.name === 'CodeOnGo Coding Agent') agentId = a.id;
  if (!envId || !agentId) throw new Error('先跑 npm run spike 完成 bootstrap');
  return { envId, agentId };
}

async function driveTurn(sessionId, text, pushedBranches) {
  const stream = await client.beta.sessions.events.stream(sessionId);
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
  });
  const seen = new Set();
  for await (const ev of client.beta.sessions.events.list(sessionId)) if (ev.id) seen.add(ev.id);
  for await (const ev of stream) {
    if (ev.id && !seen.has(ev.id)) {
      seen.add(ev.id);
      const branch = detectPushedBranch(ev);
      if (branch && pushedBranches) pushedBranches.push(branch);
      if (ev.type === 'agent.tool_use') {
        console.log('  [tool]', ev.name, JSON.stringify(ev.input ?? {}).slice(0, 100));
      }
      if (ev.type === 'session.error') console.error('  [error]', JSON.stringify(ev.error));
    }
    if (ev.type === 'session.status_terminated') return 'terminated';
    if (ev.type === 'session.status_idle') {
      if (ev.stop_reason?.type === 'requires_action') continue;
      return 'idle';
    }
  }
  return 'dropped';
}

async function listOutputsWithRetry(sessionId, retries = 6) {
  // 与 src/lib/outputs.ts 同逻辑：轮询到文件数稳定，防止索引未完成时提前返回
  let prev = [];
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    const files = [];
    const page = await client.beta.files.list({ scope_id: sessionId, betas: [MA_BETA] });
    for await (const f of page) files.push(f);
    if (files.length > 0 && files.length === prev.length) return files;
    prev = files;
  }
  return prev;
}

async function archiveSafely(sessionId) {
  for (let i = 0; i < 10; i++) {
    const s = await client.beta.sessions.retrieve(sessionId);
    if (s.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await client.beta.sessions.archive(sessionId).catch(() => {});
}

const gh = (path, init) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });

const { envId, agentId } = await ensureIds();

// ── #1 sessions.list ──────────────────────────────────────────
try {
  const page = await client.beta.sessions.list();
  let n = 0;
  for await (const s of page) {
    n++;
    if (n >= 3) break;
  }
  ok(`#1 sessions.list 可用（取样 ${n} 条）`);
} catch (e) {
  fail('#1 sessions.list', e);
}

// ── #6/#7 空白 session：outputs + preview 约定 ────────────────
let blankSession;
try {
  blankSession = await client.beta.sessions.create({
    agent: agentId,
    environment_id: envId,
    title: 'verify: outputs bridge',
  });
  console.log('blank session:', blankSession.id);
  const outcome = await driveTurn(
    blankSession.id,
    '在 /mnt/session/outputs/ 下创建两个文件：notes.txt 内容为 "outputs bridge ok"；preview.html 为一个自包含的 HTML 页面（内联 CSS，显示大字 CodeOnGo Verify）。创建完立即结束，不要多余动作。',
  );
  if (outcome !== 'idle') throw new Error(`turn outcome: ${outcome}`);
  const files = await listOutputsWithRetry(blankSession.id);
  const names = files.map((f) => f.filename);
  console.log('  outputs:', names.join(', '));
  const notes = files.find((f) => f.filename.endsWith('notes.txt'));
  const preview = files.find((f) => f.filename.endsWith('preview.html'));
  if (!notes || !preview) throw new Error(`产物缺失: ${names.join(',')}`);
  const notesText = await (await client.beta.files.download(notes.id, { betas: [MA_BETA] })).text();
  if (!notesText.includes('outputs bridge ok')) throw new Error('notes.txt 内容不符');
  const previewText = await (
    await client.beta.files.download(preview.id, { betas: [MA_BETA] })
  ).text();
  if (!previewText.toLowerCase().includes('<html') && !previewText.includes('CodeOnGo'))
    throw new Error('preview.html 内容可疑');
  ok('#6 outputs 列表（scope_id+重试）与文本下载');
  ok('#7 preview.html 产出约定（WebView 渲染源就绪）');
} catch (e) {
  fail('#6/#7 outputs 桥', e);
} finally {
  if (blankSession) await archiveSafely(blankSession.id);
}

// ── #5/#9 仓库挂载 + push + PR ────────────────────────────────
if (process.env.SKIP_REPO === '1') {
  console.log('\n══ 验证汇总 ══');
  for (const [name, passed] of results) console.log(`${passed ? '✅' : '❌'} ${name}`);
  process.exit(results.every(([, p]) => p) ? 0 : 1);
}
const VERIFY_BRANCH = 'codeongo-verify';
let repoSession;
const pushedBranches = [];
try {
  repoSession = await client.beta.sessions.create({
    agent: agentId,
    environment_id: envId,
    title: 'verify: repo mount',
    resources: [
      {
        type: 'github_repository',
        url: `https://github.com/${REPO}`,
        authorization_token: GITHUB_TOKEN,
      },
    ],
  });
  console.log('repo session:', repoSession.id);
  const outcome = await driveTurn(
    repoSession.id,
    `在挂载的仓库中：1) 读 README 或项目说明，告诉我这个项目是什么（一句话）；2) 新建分支 ${VERIFY_BRANCH}，在仓库根目录创建 VERIFY.md 写一行 "verified by CodeOnGo"，提交并 push 该分支（git push origin ${VERIFY_BRANCH}）；3) 把 git diff 主分支的输出写到 /mnt/session/outputs/changes.diff。全部完成后结束。`,
    pushedBranches,
  );
  if (outcome !== 'idle') throw new Error(`turn outcome: ${outcome}`);
  ok('#5 github_repository 挂载 + agent 读改仓库');

  // push 分支检测（App 内 PR 卡片的触发条件）
  if (!pushedBranches.includes(VERIFY_BRANCH))
    throw new Error(`未从事件中检测到 push 分支（got: ${pushedBranches.join(',')}）`);
  ok('#9 detectPushedBranch 从真实事件流检出分支');

  // changes.diff 下载 + 解析器
  const files = await listOutputsWithRetry(repoSession.id);
  const diffFile = files.find((f) => f.filename.endsWith('changes.diff'));
  if (!diffFile) throw new Error('changes.diff 未产出');
  const rawDiff = await (
    await client.beta.files.download(diffFile.id, { betas: [MA_BETA] })
  ).text();
  const parsed = parseUnifiedDiff(rawDiff);
  const verifyMd = parsed.find((f) => f.path.endsWith('VERIFY.md'));
  if (!verifyMd || verifyMd.additions < 1)
    throw new Error(`diff 解析异常: ${parsed.map((f) => f.path).join(',')}`);
  ok(`#7 diff 解析器（${parsed.length} 个文件，VERIFY.md +${verifyMd.additions}）`);

  // GitHub 侧确认分支存在 → 建 PR（App 同款 REST 调用）
  const branchRes = await gh(`/repos/${REPO}/branches/${VERIFY_BRANCH}`);
  if (!branchRes.ok) throw new Error(`GitHub 上分支不存在（HTTP ${branchRes.status}）`);
  const repoInfo = await (await gh(`/repos/${REPO}`)).json();
  const prRes = await gh(`/repos/${REPO}/pulls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'CodeOnGo verify（自动验证，即将关闭）',
      body: '由 scripts/verify-issues.mjs 自动创建，用于验证 issue #9 的 PR 链路。',
      head: VERIFY_BRANCH,
      base: repoInfo.default_branch,
    }),
  });
  const pr = await prRes.json();
  if (!prRes.ok) throw new Error(`创建 PR 失败: ${pr.message}`);
  console.log('  PR:', pr.html_url);
  ok('#9 REST 创建 PR');

  // 清理：关 PR、删分支
  await gh(`/repos/${REPO}/pulls/${pr.number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  });
  await gh(`/repos/${REPO}/git/refs/heads/${VERIFY_BRANCH}`, { method: 'DELETE' });
  console.log('  已清理：PR 关闭、分支删除');
} catch (e) {
  fail('#5/#9 仓库线', e);
} finally {
  if (repoSession) await archiveSafely(repoSession.id);
}

// ── 汇总 ─────────────────────────────────────────────────────
console.log('\n══ 验证汇总 ══');
for (const [name, passed] of results) console.log(`${passed ? '✅' : '❌'} ${name}`);
process.exit(results.every(([, p]) => p) ? 0 : 1);
