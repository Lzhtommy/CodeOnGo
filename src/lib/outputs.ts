import Anthropic from '@anthropic-ai/sdk';

/**
 * 产物桥：列出并下载 agent 写到 /mnt/session/outputs/ 的文件。
 * 注意：session 落 idle 后有 1-3 秒索引延迟，list 为空时需重试。
 */

export interface OutputFile {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string | null;
}

const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01';

export async function listOutputs(
  client: Anthropic,
  sessionId: string,
  opts?: { retries?: number; retryDelayMs?: number },
): Promise<OutputFile[]> {
  const retries = opts?.retries ?? 4;
  const retryDelayMs = opts?.retryDelayMs ?? 1500;

  // 索引是逐文件异步出现的（idle 后 1-3 秒），"一有文件就返回"会漏掉后到的。
  // 轮询直到连续两次数量一致（稳定）或重试耗尽。
  let prev: OutputFile[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    const files: OutputFile[] = [];
    const page = await client.beta.files.list({
      scope_id: sessionId,
      betas: [MANAGED_AGENTS_BETA],
    });
    for await (const f of page) {
      files.push({
        id: f.id,
        filename: f.filename,
        sizeBytes: f.size_bytes,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mimeType: (f as any).mime_type ?? null,
      });
    }
    if (files.length > 0 && files.length === prev.length) return files;
    prev = files;
  }
  return prev;
}

export async function downloadText(client: Anthropic, fileId: string): Promise<string> {
  const res = await client.beta.files.download(fileId, {
    betas: [MANAGED_AGENTS_BETA],
  });
  return res.text();
}

export async function downloadBase64(client: Anthropic, fileId: string): Promise<string> {
  const res = await client.beta.files.download(fileId, {
    betas: [MANAGED_AGENTS_BETA],
  });
  const buf = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const btoaFn: (s: string) => string = (globalThis as any).btoa;
  return btoaFn(binary);
}

export function findOutput(files: OutputFile[], name: string): OutputFile | undefined {
  return files.find((f) => f.filename === name || f.filename.endsWith(`/${name}`));
}

const TEXT_EXTENSIONS = /\.(txt|md|json|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|css|html|xml|yaml|yml|toml|sh|diff|patch|csv|log|sql)$/i;

export function isTextFile(f: OutputFile): boolean {
  if (f.mimeType?.startsWith('text/')) return true;
  return TEXT_EXTENSIONS.test(f.filename);
}
