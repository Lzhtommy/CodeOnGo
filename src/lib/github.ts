import Constants from 'expo-constants';
import { KEYS, deleteItem, getItem, setItem } from './storage';

/**
 * GitHub 接入（纯客户端）：
 * - PAT 手填：验证后入安全存储
 * - OAuth Device Flow：只需 client_id（app.json extra.githubClientId），无服务端密钥
 * token 用于：session 挂载仓库（authorization_token）+ App 代开 PR（REST）
 */

const GH_API = 'https://api.github.com';

export interface GitHubUser {
  login: string;
  avatar_url: string;
}

export interface Repo {
  full_name: string; // owner/name
  html_url: string;
  default_branch: string;
  private: boolean;
  pushed_at: string;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

export function githubClientId(): string | null {
  const id = Constants.expoConfig?.extra?.githubClientId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

async function ghFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  });
}

/** 验证 token 并返回用户信息；无效抛错 */
export async function validateToken(token: string): Promise<GitHubUser> {
  const res = await ghFetch('/user', token);
  if (!res.ok) throw new Error(`GitHub token 无效（HTTP ${res.status}）`);
  const u = await res.json();
  return { login: u.login, avatar_url: u.avatar_url };
}

export async function saveToken(token: string): Promise<GitHubUser> {
  const user = await validateToken(token);
  await setItem(KEYS.githubToken, token);
  return user;
}

export async function getToken(): Promise<string | null> {
  return getItem(KEYS.githubToken);
}

export async function disconnect(): Promise<void> {
  await deleteItem(KEYS.githubToken);
}

/** Device Flow 第一步：拿 user_code 给用户去浏览器输入 */
export async function startDeviceFlow(): Promise<DeviceCodeResponse> {
  const clientId = githubClientId();
  if (!clientId) throw new Error('未配置 GitHub OAuth App client_id');
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'repo' }),
  });
  if (!res.ok) throw new Error(`device flow 启动失败（HTTP ${res.status}）`);
  return res.json();
}

/**
 * Device Flow 第二步：按 interval 轮询直到用户授权/超时。
 * 返回 access token（调用方负责 saveToken）。
 */
export async function pollDeviceFlow(
  device: DeviceCodeResponse,
  isCancelled: () => boolean,
): Promise<string> {
  const clientId = githubClientId();
  if (!clientId) throw new Error('未配置 GitHub OAuth App client_id');
  const deadline = Date.now() + device.expires_in * 1000;
  let intervalMs = device.interval * 1000;

  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error('已取消');
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = await res.json();
    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      intervalMs += 5000;
      continue;
    }
    throw new Error(`授权失败：${data.error_description ?? data.error}`);
  }
  throw new Error('授权超时，请重试');
}

/** 用户可写仓库，按最近 push 排序 */
export async function listRepos(token: string, query?: string): Promise<Repo[]> {
  const res = await ghFetch('/user/repos?sort=pushed&per_page=100', token);
  if (!res.ok) throw new Error(`拉取仓库列表失败（HTTP ${res.status}）`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let repos: Repo[] = (await res.json()).map((r: any) => ({
    full_name: r.full_name,
    html_url: r.html_url,
    default_branch: r.default_branch,
    private: r.private,
    pushed_at: r.pushed_at,
  }));
  if (query?.trim()) {
    const q = query.trim().toLowerCase();
    repos = repos.filter((r) => r.full_name.toLowerCase().includes(q));
  }
  return repos;
}

export interface CreatedPR {
  html_url: string;
  number: number;
}

export async function createPullRequest(
  token: string,
  repoFullName: string,
  params: { title: string; body: string; head: string; base: string },
): Promise<CreatedPR> {
  const res = await ghFetch(`/repos/${repoFullName}/pulls`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.errors?.[0]?.message ?? data?.message ?? `HTTP ${res.status}`;
    throw new Error(`创建 PR 失败：${msg}`);
  }
  return { html_url: data.html_url, number: data.number };
}
